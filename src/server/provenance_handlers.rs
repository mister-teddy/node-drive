use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use headers::{ContentLength, ContentType, HeaderMapExt};
use http_body_util::BodyExt;
use hyper::{
    header::{HeaderValue, CONTENT_LENGTH, CONTENT_TYPE},
    StatusCode,
};
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use uuid::Uuid;

use crate::file_utils;
use crate::http_utils::body_full;
use crate::provenance::{generate_share_signature, verify_share_signature, ProvenanceDb, SERVER_PRIVATE_KEY_HEX, SERVER_PUBLIC_KEY_HEX};
use crate::provenance_utils;

use super::path_item::StampStatus;
use super::response_utils::{
    set_content_disposition, set_json_response, status_bad_request, status_not_found, Response,
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
    let (artifact_id, artifact, sha256_hex) =
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
    if artifact.verified_chain.is_none() {
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
    use chrono::{DateTime, Duration, Utc};

    // Throttle interval: only check calendar servers once every 5 minutes per file
    const CHECK_THROTTLE_MINUTES: i64 = 5;

    // Get artifact from database by file path
    let (artifact_id, artifact) =
        match provenance_utils::get_artifact_by_path(provenance_db, path)
            .await
            .ok()?
        {
            Some((id, artifact, _hash)) => (id, artifact),
            None => {
                // File not in provenance system yet
                return None;
            }
        };

    let sha256_hex = artifact.sha256_hex.clone();

    // OPTIMIZATION 1: Check if we have cached verification results in artifacts table
    if let (Some(chain), Some(timestamp), Some(height)) = (
        &artifact.verified_chain,
        artifact.verified_timestamp,
        artifact.verified_height,
    ) {
        // Return cached verification results without any database joins or network calls
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
            sha256_hex: Some(sha256_hex),
        });
    }

    // OPTIMIZATION 2: Check last_check_at to throttle network calls
    if let Some(ref last_check_str) = artifact.last_check_at {
        if let Ok(last_check) = DateTime::parse_from_rfc3339(last_check_str) {
            let now = Utc::now();
            let elapsed = now.signed_duration_since(last_check);

            if elapsed < Duration::minutes(CHECK_THROTTLE_MINUTES) {
                // Too soon since last check, return pending status without network calls
                return Some(StampStatus {
                    success: false,
                    results: None,
                    error: None, // No error means it's just pending
                    sha256_hex: Some(sha256_hex),
                });
            }
        }
    }

    // Get manifest to access the latest OTS proof
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
    let event_index = manifest.events.len().saturating_sub(1) as u32;

    // Update last_check_at to prevent repeated checks
    let _ = provenance_db.update_last_check_at(artifact_id);

    // No cached results and throttle expired, need to verify the OTS proof (network calls)
    match ots_stamper::verify_timestamp(
        &latest_event.ots_proof_b64,
        &latest_event.artifact_sha256_hex,
    )
    .await
    {
        Ok(verification_response) => {
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
                sha256_hex: Some(sha256_hex),
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

/// Handle share creation request (POST /api/<file>?share)
pub async fn handle_create_share(
    path: &Path,
    user: Option<String>,
    provenance_db: &ProvenanceDb,
    res: &mut Response,
) -> Result<()> {
    // Get file hash - file must exist
    let file_sha256_hex = match file_utils::sha256_file_hash(path).await {
        Ok(hash) => hash,
        Err(e) => {
            error!("Failed to hash file {:?}: {}", path, e);
            status_not_found(res);
            return Ok(());
        }
    };

    // Generate unique share ID
    let share_id = Uuid::new_v4().to_string();
    let timestamp = chrono::Utc::now().to_rfc3339();

    // Sign the share with server's private key
    // In a production system, this should use the authenticated user's key
    let share_signature = match generate_share_signature(
        &file_sha256_hex,
        &share_id,
        &timestamp,
        SERVER_PRIVATE_KEY_HEX,
    ) {
        Ok(sig) => sig,
        Err(e) => {
            error!("Failed to generate share signature: {}", e);
            *res.status_mut() = StatusCode::INTERNAL_SERVER_ERROR;
            *res.body_mut() = body_full(format!("Failed to generate signature: {}", e));
            return Ok(());
        }
    };

    // Get the file path as string
    let file_path = match path.to_str() {
        Some(p) => p,
        None => {
            error!("Invalid UTF-8 in file path: {:?}", path);
            status_bad_request(res, "Invalid file path");
            return Ok(());
        }
    };

    // Store in database with the same timestamp used for signature
    match provenance_db.create_share(
        &share_id,
        file_path,
        &file_sha256_hex,
        &timestamp,
        user.as_deref(),
        SERVER_PUBLIC_KEY_HEX,
        &share_signature,
    ) {
        Ok(_) => {},
        Err(e) => {
            error!("Failed to create share in database: {}", e);
            *res.status_mut() = StatusCode::INTERNAL_SERVER_ERROR;
            *res.body_mut() = body_full(format!("Database error: {}. Try deleting provenance.db and restarting.", e));
            return Ok(());
        }
    }

    // Return share info
    #[derive(Serialize)]
    struct ShareResponse {
        success: bool,
        share_id: String,
        share_url: String,
        created_at: String,
        owner_pubkey: String,
        signature: String,
        file_sha256: String,
    }

    let response = ShareResponse {
        success: true,
        share_id: share_id.clone(),
        share_url: format!("/share/{}", share_id),
        created_at: timestamp,
        owner_pubkey: SERVER_PUBLIC_KEY_HEX.to_string(),
        signature: share_signature,
        file_sha256: file_sha256_hex,
    };

    let json = serde_json::to_string(&response)?;
    set_json_response(res, json);

    Ok(())
}

/// Handle shared file access (GET /share/<id>)
pub async fn handle_shared_file_access(
    share_id: &str,
    head_only: bool,
    provenance_db: &ProvenanceDb,
    res: &mut Response,
) -> Result<()> {
    // Get share info from database
    let share_info = match provenance_db.get_share(share_id)? {
        Some(info) => info,
        None => {
            status_not_found(res);
            return Ok(());
        }
    };

    // Check if share is active
    if !share_info.is_active {
        status_not_found(res);
        return Ok(());
    }

    // Get the file path
    let file_path = Path::new(&share_info.file_path);

    // Check if file exists
    if !file_path.exists() {
        status_not_found(res);
        return Ok(());
    }

    // Verify the share signature using the stored hash
    // This ensures the signature verification works even if the file has changed
    let is_valid = verify_share_signature(
        &share_info.file_sha256_hex,
        share_id,
        &share_info.created_at,
        &share_info.share_signature_hex,
        &share_info.owner_pubkey_hex,
    )?;

    if !is_valid {
        status_bad_request(res, "Invalid share signature");
        return Ok(());
    }

    // Record the download
    let _ = provenance_db.record_share_download(share_id, None, None, None);

    // Serve the file with share metadata in headers
    res.headers_mut().insert(
        "X-Share-Id",
        HeaderValue::from_str(share_id)?,
    );
    res.headers_mut().insert(
        "X-Owner-Pubkey",
        HeaderValue::from_str(&share_info.owner_pubkey_hex)?,
    );
    res.headers_mut().insert(
        "X-Share-Signature",
        HeaderValue::from_str(&share_info.share_signature_hex)?,
    );
    res.headers_mut().insert(
        "X-File-SHA256",
        HeaderValue::from_str(&share_info.file_sha256_hex)?,
    );

    // Read and return the file
    let file_data = tokio::fs::read(file_path).await?;
    let filename = file_utils::extract_filename(file_path)?;

    res.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    set_content_disposition(res, true, &filename)?;
    res.headers_mut().insert(
        CONTENT_LENGTH,
        format!("{}", file_data.len()).parse()?,
    );

    if head_only {
        return Ok(());
    }

    *res.body_mut() = body_full(file_data);
    Ok(())
}

/// Handle share info request (GET /api/<file>?share_info)
pub async fn handle_share_info(
    path: &Path,
    provenance_db: &ProvenanceDb,
    res: &mut Response,
) -> Result<()> {
    let file_path = path.to_str().ok_or_else(|| anyhow!("Invalid file path"))?;

    // Get all active shares for this file
    let shares = provenance_db.get_shares_for_file(file_path)?;

    #[derive(Serialize)]
    struct ShareInfoResponse {
        success: bool,
        shares: Vec<ShareInfoItem>,
    }

    #[derive(Serialize)]
    struct ShareInfoItem {
        share_id: String,
        share_url: String,
        created_at: String,
        shared_by: Option<String>,
        owner_pubkey: String,
        downloads: usize,
    }

    let mut share_items = Vec::new();
    for share in shares {
        // Get download count
        let downloads = provenance_db
            .get_distribution_chain(&share.share_id)?
            .len();

        share_items.push(ShareInfoItem {
            share_id: share.share_id.clone(),
            share_url: format!("/share/{}", share.share_id),
            created_at: share.created_at,
            shared_by: share.shared_by,
            owner_pubkey: share.owner_pubkey_hex,
            downloads,
        });
    }

    let response = ShareInfoResponse {
        success: true,
        shares: share_items,
    };

    let json = serde_json::to_string(&response)?;
    set_json_response(res, json);

    Ok(())
}

/// Handle share deletion (DELETE /api/<file>?share=<share_id>)
pub async fn handle_delete_share(
    share_id: &str,
    user: Option<String>,
    provenance_db: &ProvenanceDb,
    res: &mut Response,
) -> Result<()> {
    // Get share info to verify ownership
    let share_info = match provenance_db.get_share(share_id)? {
        Some(info) => info,
        None => {
            status_not_found(res);
            return Ok(());
        }
    };

    // In production, verify that the user owns this share
    // For now, we allow anyone authenticated to delete (or check if shared_by matches user)
    if let (Some(ref shared_by), Some(ref current_user)) = (share_info.shared_by, user) {
        if shared_by != current_user {
            *res.status_mut() = StatusCode::FORBIDDEN;
            *res.body_mut() = body_full("You don't have permission to delete this share");
            return Ok(());
        }
    }

    // Deactivate the share
    provenance_db.deactivate_share(share_id)?;

    #[derive(Serialize)]
    struct DeleteResponse {
        success: bool,
        message: String,
    }

    let response = DeleteResponse {
        success: true,
        message: format!("Share {} has been deleted", share_id),
    };

    let json = serde_json::to_string(&response)?;
    set_json_response(res, json);

    Ok(())
}

/// Handle distribution chain request (GET /share/<id>/chain)
pub async fn handle_distribution_chain(
    share_id: &str,
    provenance_db: &ProvenanceDb,
    res: &mut Response,
) -> Result<()> {
    // Verify share exists
    if provenance_db.get_share(share_id)?.is_none() {
        status_not_found(res);
        return Ok(());
    }

    // Get distribution chain
    let chain = provenance_db.get_distribution_chain(share_id)?;

    #[derive(Serialize)]
    struct ChainResponse {
        success: bool,
        share_id: String,
        downloads: Vec<crate::provenance::DownloadRecord>,
    }

    let response = ChainResponse {
        success: true,
        share_id: share_id.to_string(),
        downloads: chain,
    };

    let json = serde_json::to_string(&response)?;
    set_json_response(res, json);

    Ok(())
}
