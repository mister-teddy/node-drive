use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use headers::{ContentLength, ContentType, HeaderMapExt};
use http_body_util::BodyExt;
use hyper::{
    header::{HeaderValue, CONTENT_LENGTH, CONTENT_TYPE},
    StatusCode,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

use crate::file_utils;
use crate::http_utils::body_full;
use crate::provenance::ProvenanceDb;
use crate::provenance_utils;

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
    // Get manifest using unified utility function
    match provenance_utils::get_manifest_for_file(provenance_db, path).await? {
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

    // Get artifact from database using unified utility
    let (artifact_id, _, _) =
        match provenance_utils::get_artifact_by_path(provenance_db, path).await? {
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
    // Get manifest using unified utility
    let manifest = match provenance_utils::get_manifest_for_file(provenance_db, path).await? {
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
    let filename = file_utils::extract_filename(path)?;
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

pub async fn handle_ots_info(
    path: &Path,
    head_only: bool,
    provenance_db: &ProvenanceDb,
    res: &mut Response,
) -> Result<()> {
    use crate::ots_stamper;

    // Get artifact and manifest from database using unified utility
    let (artifact_id, _, sha256_hex) =
        match provenance_utils::get_artifact_by_path(provenance_db, path).await? {
            Some(result) => result,
            None => {
                status_not_found(res);
                return Ok(());
            }
        };

    // Get manifest using path-based lookup
    let manifest = match provenance_utils::get_manifest_for_file(provenance_db, path).await? {
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

    let event_index = manifest.events.len().saturating_sub(1) as u32;
    let latest_event = &manifest.events[event_index as usize];
    let mut ots_proof_b64 = latest_event.ots_proof_b64.clone();

    // Try to upgrade the OTS proof if it's not already verified
    // This ensures we always show the latest, upgraded proof with Bitcoin attestations
    if latest_event.verified_chain.is_none() {
        match ots_stamper::verify_timestamp(&ots_proof_b64, &sha256_hex).await {
            Ok(verification_response) => {
                // If timestamp was upgraded, use the upgraded version and save it
                if let Some(ref upgraded_ots_b64) = verification_response.upgraded_ots_b64 {
                    ots_proof_b64 = upgraded_ots_b64.clone();

                    // Save upgraded OTS to database
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
                            "Upgraded OTS proof for {} before displaying info",
                            sha256_hex
                        );
                    } else {
                        let _ = provenance_db.update_ots_proof(
                            artifact_id,
                            event_index,
                            upgraded_ots_b64,
                        );
                    }
                } else if let Some(first_result) = verification_response.results.first() {
                    // No upgrade needed, but cache verification results
                    let _ = provenance_db.update_verification_result(
                        artifact_id,
                        event_index,
                        &first_result.chain,
                        first_result.timestamp as i64,
                        first_result.height,
                    );
                }
            }
            Err(e) => {
                // Upgrade failed, but we can still show the current proof
                warn!("Failed to upgrade OTS proof for {}: {}", sha256_hex, e);
            }
        }
    }

    // Generate OTS info from the (possibly upgraded) proof
    let ots_info = match ots_stamper::generate_ots_info(&ots_proof_b64) {
        Ok(info) => info,
        Err(e) => {
            *res.status_mut() = StatusCode::INTERNAL_SERVER_ERROR;
            *res.body_mut() = body_full(format!("Failed to parse OTS proof: {}", e));
            return Ok(());
        }
    };

    // Return JSON response
    let json = serde_json::to_string_pretty(&ots_info)?;
    res.headers_mut()
        .typed_insert(ContentType::from(mime_guess::mime::APPLICATION_JSON));
    res.headers_mut()
        .typed_insert(ContentLength(json.len() as u64));

    if head_only {
        return Ok(());
    }

    *res.body_mut() = body_full(json);
    Ok(())
}

pub async fn handle_ots_verify(
    req: Request,
    _provenance_db: &ProvenanceDb,
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
            // NOTE: We don't save verification results here since this endpoint
            // doesn't have access to file path. Verification results are saved
            // via the per-file OTS info endpoint instead.

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
    let output = file_utils::sha256_file_hash(path).await?;
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

pub async fn compute_stamp_status(
    path: &Path,
    provenance_db: &ProvenanceDb,
) -> Option<StampStatus> {
    use crate::ots_stamper;

    // Get artifact from database by file path
    let (artifact_id, sha256_hex) =
        match provenance_utils::get_artifact_by_path(provenance_db, path)
            .await
            .ok()?
        {
            Some((id, _artifact, hash)) => (id, hash),
            None => {
                // File not in provenance system yet
                return None;
            }
        };

    // Get manifest from database
    let path_str = path.to_str()?;
    let manifest = match provenance_db
        .get_manifest_by_path(path_str)
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
            // artifact_id already obtained above
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
