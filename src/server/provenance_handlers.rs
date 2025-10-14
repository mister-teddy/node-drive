use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use headers::{ContentLength, ContentType, HeaderMapExt};
use http_body_util::BodyExt;
use hyper::{
    header::{HeaderValue, CONTENT_LENGTH, CONTENT_TYPE},
    StatusCode,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::Path;
use tokio::fs;

use crate::http_utils::body_full;
use crate::provenance::ProvenanceDb;

use super::path_item::StampStatus;
use super::response_utils::{
    set_content_disposition, set_json_response, status_not_found, Response,
};

pub type Request = hyper::Request<hyper::body::Incoming>;

pub async fn handle_provenance_manifest(
    path: &Path,
    head_only: bool,
    provenance_db: &ProvenanceDb,
    res: &mut Response,
) -> Result<()> {
    // Compute file hash
    let file_data = tokio::fs::read(path).await?;
    let mut hasher = Sha256::new();
    hasher.update(&file_data);
    let hash_bytes = hasher.finalize();
    let sha256_hex = hex::encode(hash_bytes);

    // Retrieve manifest from database
    match provenance_db.get_manifest(&sha256_hex)? {
        Some(manifest) => {
            let json = serde_json::to_string_pretty(&manifest)?;
            res.headers_mut()
                .typed_insert(ContentType::from(mime_guess::mime::APPLICATION_JSON));
            res.headers_mut()
                .typed_insert(ContentLength(json.len() as u64));
            if !head_only {
                *res.body_mut() = body_full(json);
            }
            Ok(())
        }
        None => {
            status_not_found(res);
            Ok(())
        }
    }
}

pub async fn handle_ots_upload(
    path: &Path,
    req: Request,
    provenance_db: &ProvenanceDb,
    res: &mut Response,
) -> Result<()> {
    // Read the OTS bytes from request body
    let body_bytes = req
        .into_body()
        .collect()
        .await
        .map_err(|e| anyhow!("Failed to read request body: {}", e))?
        .to_bytes();

    // Compute file hash
    let file_data = tokio::fs::read(path).await?;
    let mut hasher = Sha256::new();
    hasher.update(&file_data);
    let hash_bytes = hasher.finalize();
    let sha256_hex = hex::encode(hash_bytes);

    // Get artifact from database
    let (artifact_id, _) = match provenance_db.get_artifact(&sha256_hex)? {
        Some(result) => result,
        None => {
            status_not_found(res);
            return Ok(());
        }
    };

    // Get the latest event for this artifact
    let next_index = provenance_db.get_next_event_index(artifact_id)?;
    if next_index == 0 {
        status_not_found(res);
        return Ok(());
    }

    // Update the OTS proof for the most recent event
    let ots_proof_b64 = STANDARD.encode(&body_bytes);

    // Update the database
    provenance_db.update_ots_proof(artifact_id, next_index - 1, &ots_proof_b64)?;

    *res.status_mut() = StatusCode::OK;
    *res.body_mut() = body_full("OTS proof uploaded successfully");
    Ok(())
}

pub async fn handle_ots_download(
    path: &Path,
    head_only: bool,
    provenance_db: &ProvenanceDb,
    res: &mut Response,
) -> Result<()> {
    // Compute file hash
    let file_data = tokio::fs::read(path).await?;
    let mut hasher = Sha256::new();
    hasher.update(&file_data);
    let hash_bytes = hasher.finalize();
    let sha256_hex = hex::encode(hash_bytes);

    // Get manifest from database
    let manifest = match provenance_db.get_manifest(&sha256_hex)? {
        Some(m) => m,
        None => {
            status_not_found(res);
            return Ok(());
        }
    };

    // Get the latest event's OTS proof
    if manifest.events.is_empty() {
        status_not_found(res);
        return Ok(());
    }

    let latest_event = &manifest.events[manifest.events.len() - 1];
    let ots_bytes = STANDARD
        .decode(&latest_event.ots_proof_b64)
        .map_err(|e| anyhow!("Failed to decode OTS proof: {}", e))?;

    // Set response headers for download
    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| anyhow!("Invalid filename"))?;
    let ots_filename = format!("{}.ots", filename);
    res.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    set_content_disposition(res, false, &ots_filename)?;
    res.headers_mut()
        .insert(CONTENT_LENGTH, format!("{}", ots_bytes.len()).parse()?);

    if head_only {
        return Ok(());
    }

    *res.body_mut() = body_full(ots_bytes);
    Ok(())
}

pub async fn handle_ots_verify(
    req: Request,
    provenance_db: &ProvenanceDb,
    res: &mut Response,
) -> Result<()> {
    use crate::ots_stamper;

    // Parse JSON request body
    #[derive(Deserialize)]
    struct VerifyRequest {
        ots_proof_base64: String,
        artifact_sha256: String,
    }

    #[derive(Serialize, Clone)]
    struct ChainResult {
        timestamp: u64,
        height: u64,
    }

    #[derive(Serialize)]
    struct VerifyResponse {
        success: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        results: Option<HashMap<String, ChainResult>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    }

    let body_bytes = req
        .into_body()
        .collect()
        .await
        .map_err(|e| anyhow!("Failed to read request body: {}", e))?
        .to_bytes();

    let verify_req: VerifyRequest = serde_json::from_slice(&body_bytes)
        .map_err(|e| anyhow!("Failed to parse JSON request: {}", e))?;

    // Call full verification function (verifies against blockchain)
    let result =
        ots_stamper::verify_timestamp(&verify_req.ots_proof_base64, &verify_req.artifact_sha256)
            .await;

    // Convert result to JSON response matching JS library format
    let response = match result {
        Ok(verification_response) => {
            // If timestamp was upgraded, save it back to the database along with verification results
            if let Some(ref upgraded_ots_b64) = verification_response.upgraded_ots_b64 {
                // Get manifest and update the latest event's OTS proof
                if let Ok(Some(manifest)) = provenance_db.get_manifest(&verify_req.artifact_sha256)
                {
                    if let Some((artifact_id, _)) = provenance_db
                        .get_artifact(&verify_req.artifact_sha256)
                        .ok()
                        .flatten()
                    {
                        let event_index = manifest.events.len().saturating_sub(1) as u32;

                        // Save both upgraded OTS and verification results if available
                        if let Some(first_result) = verification_response.results.first() {
                            let _ = provenance_db.update_ots_proof_and_verification(
                                artifact_id,
                                event_index,
                                upgraded_ots_b64,
                                &first_result.chain,
                                first_result.timestamp as i64,
                                first_result.height,
                            );
                            info!(
                                "Saved upgraded OTS proof and verification results for artifact {}",
                                &verify_req.artifact_sha256
                            );
                        } else {
                            let _ = provenance_db.update_ots_proof(
                                artifact_id,
                                event_index,
                                upgraded_ots_b64,
                            );
                            info!(
                                "Saved upgraded OTS proof for artifact {}",
                                &verify_req.artifact_sha256
                            );
                        }
                    }
                }
            } else if let Some(first_result) = verification_response.results.first() {
                // No upgrade, but cache verification results
                if let Ok(Some(manifest)) = provenance_db.get_manifest(&verify_req.artifact_sha256)
                {
                    if let Some((artifact_id, _)) = provenance_db
                        .get_artifact(&verify_req.artifact_sha256)
                        .ok()
                        .flatten()
                    {
                        let event_index = manifest.events.len().saturating_sub(1) as u32;
                        let _ = provenance_db.update_verification_result(
                            artifact_id,
                            event_index,
                            &first_result.chain,
                            first_result.timestamp as i64,
                            first_result.height,
                        );
                    }
                }
            }

            // Group results by chain
            let mut results_map: HashMap<String, ChainResult> = HashMap::new();

            for vr in verification_response.results {
                let chain_result = ChainResult {
                    timestamp: vr.timestamp,
                    height: vr.height,
                };

                // If this chain already exists, keep the earlier timestamp
                results_map
                    .entry(vr.chain)
                    .and_modify(|existing| {
                        if vr.timestamp < existing.timestamp {
                            *existing = chain_result.clone();
                        }
                    })
                    .or_insert(chain_result);
            }

            VerifyResponse {
                success: true,
                results: Some(results_map),
                error: None,
            }
        }
        Err(e) => VerifyResponse {
            success: false,
            results: None,
            error: Some(e.to_string()),
        },
    };

    // Return JSON response
    let json = serde_json::to_string(&response)?;
    set_json_response(res, json);

    Ok(())
}

pub async fn handle_hash_file(path: &Path, head_only: bool, res: &mut Response) -> Result<()> {
    let output = sha256_file(path).await?;
    res.headers_mut()
        .typed_insert(ContentType::from(mime_guess::mime::TEXT_HTML_UTF_8));
    res.headers_mut()
        .typed_insert(ContentLength(output.len() as u64));
    if head_only {
        return Ok(());
    }
    *res.body_mut() = body_full(output);
    Ok(())
}

async fn sha256_file(path: &Path) -> Result<String> {
    use tokio::io::AsyncReadExt;

    let mut file = fs::File::open(path).await?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 8192];

    loop {
        let bytes_read = file.read(&mut buffer).await?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }

    let result = hasher.finalize();
    Ok(format!("{result:x}"))
}

/// Try to get cached artifact_id from XATTR
fn get_artifact_id_from_xattr(path: &Path) -> Option<i64> {
    xattr::get(path, "user.provenance.artifact_id")
        .ok()
        .flatten()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .and_then(|s| s.parse::<i64>().ok())
}

/// Store artifact_id in XATTR for future lookups
pub fn set_artifact_id_in_xattr(path: &Path, artifact_id: i64) {
    if let Err(e) = xattr::set(
        path,
        "user.provenance.artifact_id",
        artifact_id.to_string().as_bytes(),
    ) {
        debug!(
            "Failed to set XATTR for {}: {} (filesystem may not support extended attributes)",
            path.display(),
            e
        );
    } else {
        debug!(
            "Cached artifact_id {} in XATTR for {}",
            artifact_id,
            path.display()
        );
    }
}

/// Clear artifact_id from XATTR (call when file is modified or deleted)
pub fn clear_artifact_id_from_xattr(path: &Path) {
    if let Err(e) = xattr::remove(path, "user.provenance.artifact_id") {
        // Ignore errors - file might not have had XATTR, or filesystem doesn't support it
        debug!("Could not remove XATTR from {}: {}", path.display(), e);
    }
}

pub async fn compute_stamp_status(
    path: &Path,
    provenance_db: &ProvenanceDb,
) -> Option<StampStatus> {
    use crate::ots_stamper;

    // Try fast path: get artifact_id from XATTR cache
    let sha256_hex = if let Some(cached_artifact_id) = get_artifact_id_from_xattr(path) {
        // XATTR cache hit - get hash from database using artifact_id
        debug!("XATTR cache hit for {}", path.display());
        match provenance_db.get_artifact_by_id(cached_artifact_id) {
            Ok(Some((_filename, hash, _size))) => {
                debug!("Retrieved hash from DB: {}", &hash[..8]);
                hash
            }
            _ => {
                // XATTR points to non-existent artifact, clear stale cache and fall through
                debug!("Stale XATTR cache for {} - clearing", path.display());
                clear_artifact_id_from_xattr(path);
                // Fall through to slow path
                None?
            }
        }
    } else {
        // XATTR cache miss - need to hash the file
        debug!("XATTR cache miss for {} - computing hash", path.display());
        let sha256_hex = sha256_file(path).await.ok()?;

        // Get artifact from database by hash
        let (artifact_id, _) = match provenance_db.get_artifact(&sha256_hex) {
            Ok(Some(result)) => result,
            _ => {
                // File not in provenance system yet
                return None;
            }
        };

        // Populate XATTR cache for next time
        set_artifact_id_in_xattr(path, artifact_id);

        sha256_hex
    };

    // Get manifest from database
    let manifest = match provenance_db
        .get_manifest(&sha256_hex)
        .inspect_err(|e| {
            warn!("Failed to get manifest for {}: {}", sha256_hex, e);
        })
        .ok()?
    {
        Some(m) => m,
        None => {
            return None;
        }
    };

    // Get the latest event
    if manifest.events.is_empty() {
        return None;
    }

    let latest_event = &manifest.events[manifest.events.len() - 1];

    // OPTIMIZATION: Check if we have cached verification results
    if let (Some(chain), Some(timestamp), Some(height)) = (
        &latest_event.verified_chain,
        latest_event.verified_timestamp,
        latest_event.verified_height,
    ) {
        // Return cached verification results without network calls
        let mut results_map = serde_json::Map::new();
        let chain_result = serde_json::json!({
            "timestamp": timestamp as u64,
            "height": height,
        });
        results_map.insert(chain.clone(), chain_result);

        return Some(StampStatus {
            success: true,
            results: Some(serde_json::Value::Object(results_map)),
            error: None,
            sha256_hex: Some(sha256_hex.clone()),
        });
    }

    // No cached results, need to verify the OTS proof (this makes network calls)
    match ots_stamper::verify_timestamp(
        &latest_event.ots_proof_b64,
        &latest_event.artifact_sha256_hex,
    )
    .await
    {
        Ok(verification_response) => {
            // Get artifact_id for database updates
            let (artifact_id, _) = provenance_db.get_artifact(&sha256_hex).ok().flatten()?;
            let event_index = manifest.events.len().saturating_sub(1) as u32;

            // If timestamp was upgraded AND we have verification results, save both
            if let Some(ref upgraded_ots_b64) = verification_response.upgraded_ots_b64 {
                if let Some(first_result) = verification_response.results.first() {
                    // Save upgraded OTS and verification results together
                    let _ = provenance_db.update_ots_proof_and_verification(
                        artifact_id,
                        event_index,
                        upgraded_ots_b64,
                        &first_result.chain,
                        first_result.timestamp as i64,
                        first_result.height,
                    );
                } else {
                    // Just save upgraded OTS without verification results
                    let _ =
                        provenance_db.update_ots_proof(artifact_id, event_index, upgraded_ots_b64);
                }
            } else if let Some(first_result) = verification_response.results.first() {
                // No upgrade, but we have verification results to cache
                let _ = provenance_db.update_verification_result(
                    artifact_id,
                    event_index,
                    &first_result.chain,
                    first_result.timestamp as i64,
                    first_result.height,
                );
            }

            // Build results map matching the verify endpoint format
            let mut results_map = serde_json::Map::new();

            for vr in verification_response.results {
                let chain_result = serde_json::json!({
                    "timestamp": vr.timestamp,
                    "height": vr.height,
                });
                results_map.insert(vr.chain, chain_result);
            }

            Some(StampStatus {
                success: true,
                results: Some(serde_json::Value::Object(results_map)),
                error: None,
                sha256_hex: Some(sha256_hex.clone()),
            })
        }
        Err(_) => {
            // Verification failed or pending
            Some(StampStatus {
                success: false,
                results: None,
                error: None, // No error means it's just pending
                sha256_hex: Some(sha256_hex),
            })
        }
    }
}
