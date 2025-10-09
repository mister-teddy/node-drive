use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use headers::{ContentLength, ContentType, HeaderMapExt};
use http_body_util::BodyExt;
use hyper::{
    body::Bytes,
    header::{HeaderValue, CONTENT_LENGTH, CONTENT_TYPE},
    StatusCode,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::Path;
use tokio::fs;

use crate::http_utils::body_full;
use crate::provenance::{
    compute_event_hash, sign_event_hash, verify_event, Actors, Event, EventAction, InsertEventArgs,
    ProvenanceDb, Signatures, SERVER_PRIVATE_KEY_HEX, SERVER_PUBLIC_KEY_HEX,
};

use super::path_item::{MintEventResponse, StampStatus};
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

pub async fn create_mint_event(
    path: &Path,
    provenance_db: &ProvenanceDb,
    compute_stamp_status: impl Fn(
        &Path,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Option<StampStatus>> + Send>,
    >,
) -> Result<MintEventResponse> {
    // Read file and compute SHA-256 hash
    let file_data = tokio::fs::read(path).await?;
    let mut hasher = Sha256::new();
    hasher.update(&file_data);
    let hash_bytes = hasher.finalize();
    let sha256_hex = hex::encode(hash_bytes);

    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| anyhow!("Invalid filename"))?
        .to_string();
    let size_bytes = file_data.len() as u64;

    // Insert or update artifact
    let artifact_id = provenance_db.upsert_artifact(&file_name, &sha256_hex, size_bytes)?;

    // Check if mint event already exists
    let next_index = provenance_db.get_next_event_index(artifact_id)?;
    if next_index > 0 {
        // Artifact already has events, return existing mint event
        let manifest = provenance_db
            .get_manifest(&sha256_hex)?
            .ok_or_else(|| anyhow!("Manifest not found after checking event index"))?;

        let first_event = &manifest.events[0];

        // Compute stamp status for existing event
        let stamp_status = compute_stamp_status(path).await;

        return Ok(MintEventResponse {
            filename: file_name,
            sha256: sha256_hex,
            ots_base64: first_event.ots_proof_b64.clone(),
            event_hash: first_event.event_hash_hex.clone(),
            issued_at: first_event.issued_at.clone(),
            stamp_status,
        });
    }

    // Use server's static keypair for signing
    let actors = Actors {
        creator_pubkey_hex: Some(SERVER_PUBLIC_KEY_HEX.to_string()),
        prev_owner_pubkey_hex: None,
        new_owner_pubkey_hex: None,
    };

    let issued_at = chrono::Utc::now().to_rfc3339();

    // Compute canonical event hash
    let event_hash_hex = compute_event_hash(
        0,
        &EventAction::Mint,
        &sha256_hex,
        None,
        &actors,
        &issued_at,
    );

    // Sign the event hash with server's private key
    let creator_signature = sign_event_hash(&event_hash_hex, SERVER_PRIVATE_KEY_HEX)
        .map_err(|e| anyhow!("Failed to sign event: {}", e))?;

    let signatures = Signatures {
        creator_sig_hex: Some(creator_signature),
        prev_owner_sig_hex: None,
        new_owner_sig_hex: None,
    };

    // Generate real OpenTimestamps proof using our Rust implementation
    let digest =
        hex::decode(&sha256_hex).map_err(|e| anyhow!("Failed to decode SHA256 hex: {}", e))?;

    let ots_bytes = match crate::ots_stamper::create_timestamp(&digest).await {
        Ok(bytes) => bytes,
        Err(e) => {
            warn!("Failed to create OTS proof for mint event: {}", e);
            // Fall back to placeholder if OTS stamping fails
            Vec::from(b"PLACEHOLDER_OTS_PROOF" as &[u8])
        }
    };

    let ots_proof_b64 = STANDARD.encode(&ots_bytes);

    // Insert mint event
    provenance_db.insert_event(InsertEventArgs {
        artifact_id,
        index: 0,
        action: &EventAction::Mint,
        artifact_sha256_hex: &sha256_hex,
        prev_event_hash_hex: None,
        issued_at: &issued_at,
        event_hash_hex: &event_hash_hex,
        ots_proof_b64: &ots_proof_b64,
        actors: &actors,
        signatures: &signatures,
    })?;

    // Verify the event we just created
    let created_event = Event {
        event_type: "provenance.event/v1".to_string(),
        index: 0,
        action: EventAction::Mint,
        artifact_sha256_hex: sha256_hex.clone(),
        prev_event_hash_hex: None,
        actors: actors.clone(),
        issued_at: issued_at.clone(),
        event_hash_hex: event_hash_hex.clone(),
        signatures: signatures.clone(),
        ots_proof_b64: ots_proof_b64.clone(),
        verified_chain: None,
        verified_timestamp: None,
        verified_height: None,
        last_verified_at: None,
    };

    match verify_event(&created_event) {
        Ok(true) => {
            info!(
                "Created and verified mint event for {} ({})",
                file_name,
                &sha256_hex[..8]
            );
        }
        Ok(false) => {
            warn!(
                "Mint event verification failed for {} ({})",
                file_name,
                &sha256_hex[..8]
            );
        }
        Err(e) => {
            warn!("Error verifying mint event for {}: {}", file_name, e);
        }
    }

    Ok(MintEventResponse {
        filename: file_name,
        sha256: sha256_hex.clone(),
        ots_base64: ots_proof_b64,
        event_hash: event_hash_hex,
        issued_at,
        stamp_status: Some(StampStatus {
            success: false,
            results: None,
            error: None, // No error, just pending Bitcoin confirmation
            sha256_hex: Some(sha256_hex),
        }),
    })
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

pub async fn compute_stamp_status(
    path: &Path,
    provenance_db: &ProvenanceDb,
) -> Option<StampStatus> {
    use crate::ots_stamper;

    // Compute file hash
    let file_data = tokio::fs::read(path).await.ok()?;
    let mut hasher = Sha256::new();
    hasher.update(&file_data);
    let hash_bytes = hasher.finalize();
    let sha256_hex = hex::encode(hash_bytes);

    // Get manifest from database
    let manifest = match provenance_db.get_manifest(&sha256_hex).ok()? {
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
