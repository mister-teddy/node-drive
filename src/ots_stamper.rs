use anyhow::{anyhow, Result};
use base64::Engine;
use opentimestamps::{
    attestation::Attestation,
    op::Op,
    ser::{Deserializer, DigestType},
    timestamp::{Step, StepData, Timestamp},
    DetachedTimestampFile,
};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Cursor;

const DEFAULT_CALENDAR_URLS: &[&str] = &[
    "https://a.pool.opentimestamps.org",
    "https://b.pool.opentimestamps.org",
    "https://a.pool.eternitywall.com",
    "https://ots.btc.catallaxy.com",
];

const MAX_RESPONSE_SIZE: usize = 10_000;

// Default block explorer for verification
const DEFAULT_ESPLORA_URL: &str = "https://blockstream.info/api";

// Maximum size for upgrade responses from calendar servers
const MAX_UPGRADE_RESPONSE_SIZE: usize = 10_000;

/// Verification result for a single attestation
#[derive(Debug, Clone, Serialize)]
pub struct VerificationResult {
    pub chain: String,
    pub timestamp: u64,
    pub height: u64,
}

/// Creates an OpenTimestamps proof by contacting calendar servers
pub async fn create_timestamp(digest: &[u8]) -> Result<Vec<u8>> {
    // Add random nonce (16 bytes) to the digest
    // Generate nonce before any await points to avoid Send issues
    let nonce: [u8; 16] = {
        let mut rng = rand::thread_rng();
        rng.gen()
    }; // rng is dropped here, before any await

    // Create timestamp with nonce
    let mut nonce_digest = Vec::new();
    nonce_digest.extend_from_slice(digest);
    nonce_digest.extend_from_slice(&nonce);

    // Hash the nonce-appended digest
    let mut hasher = Sha256::new();
    hasher.update(&nonce_digest);
    let merkle_root = hasher.finalize();

    // Submit to calendar servers
    let mut timestamp_data = None;
    let mut errors = Vec::new();

    for calendar_url in DEFAULT_CALENDAR_URLS {
        match submit_to_calendar(calendar_url, &merkle_root).await {
            Ok(data) => {
                timestamp_data = Some(data);
                break; // Successfully got response from one calendar
            }
            Err(e) => {
                errors.push(format!("{}: {}", calendar_url, e));
                continue;
            }
        }
    }

    let timestamp_data = timestamp_data.ok_or_else(|| {
        anyhow!(
            "Failed to get timestamp from any calendar server. Errors: {}",
            errors.join(", ")
        )
    })?;

    // Build the timestamp structure using the opentimestamps crate API
    // Parse the calendar server response to get the continuation of the timestamp
    // The calendar response is a partial timestamp starting from merkle_root
    let calendar_timestamp = {
        // Create a temporary OTS file with just the merkle root and calendar response
        let mut temp_ots = Vec::new();
        temp_ots.extend_from_slice(
            b"\x00OpenTimestamps\x00\x00Proof\x00\xbf\x89\xe2\xe8\x84\xe8\x92\x94",
        );
        temp_ots.push(0x01); // version
        temp_ots.push(0x08); // SHA256
        temp_ots.extend_from_slice(&merkle_root);
        temp_ots.extend_from_slice(&timestamp_data);

        let cursor = Cursor::new(temp_ots);
        let parsed = DetachedTimestampFile::from_reader(cursor)?;
        parsed.timestamp
    };

    // Build the complete timestamp starting from the original digest
    // Step 1: Append nonce operation
    let append_step = Step {
        data: StepData::Op(Op::Append(nonce.to_vec())),
        output: nonce_digest.to_vec(),
        next: vec![
            // Step 2: SHA256 hash operation
            Step {
                data: StepData::Op(Op::Sha256),
                output: merkle_root.to_vec(),
                next: vec![calendar_timestamp.first_step],
            },
        ],
    };

    // Create the complete timestamp
    let timestamp = Timestamp {
        start_digest: digest.to_vec(),
        first_step: append_step,
    };

    // Create the detached timestamp file
    let detached_timestamp = DetachedTimestampFile {
        digest_type: DigestType::Sha256,
        timestamp,
    };

    // Serialize to bytes
    let mut result = Vec::new();
    detached_timestamp.to_writer(&mut result)?;

    Ok(result)
}

/// Submit digest to a calendar server and return the timestamp
async fn submit_to_calendar(url: &str, digest: &[u8]) -> Result<Vec<u8>> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()?;

    let response = client
        .post(format!("{}/digest", url))
        .header("Accept", "application/vnd.opentimestamps.v1")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(digest.to_vec())
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(anyhow!(
            "Calendar server returned error: {}",
            response.status()
        ));
    }

    let response_bytes = response.bytes().await?;

    if response_bytes.len() > MAX_RESPONSE_SIZE {
        return Err(anyhow!(
            "Response too large: {} bytes (max {})",
            response_bytes.len(),
            MAX_RESPONSE_SIZE
        ));
    }

    Ok(response_bytes.to_vec())
}

/// Recursively collect all attestations from a timestamp
fn collect_attestations(step: &Step) -> Vec<Attestation> {
    let mut attestations = Vec::new();

    match &step.data {
        StepData::Attestation(att) => {
            attestations.push(att.clone());
        }
        StepData::Fork | StepData::Op(_) => {
            for next_step in &step.next {
                attestations.extend(collect_attestations(next_step));
            }
        }
    }

    attestations
}

/// Check if a timestamp is complete (has at least one verified attestation)
fn is_timestamp_complete(step: &Step) -> bool {
    let attestations = collect_attestations(step);
    attestations
        .iter()
        .any(|att| matches!(att, Attestation::Bitcoin { .. }))
}

/// Collect all pending attestations with their commitments
fn collect_pending_attestations(step: &Step, commitment: &[u8]) -> Vec<(Vec<u8>, String)> {
    let mut pending = Vec::new();

    match &step.data {
        StepData::Attestation(Attestation::Pending { uri }) => {
            pending.push((commitment.to_vec(), uri.clone()));
        }
        StepData::Fork | StepData::Op(_) => {
            for next_step in &step.next {
                pending.extend(collect_pending_attestations(next_step, &next_step.output));
            }
        }
        _ => {}
    }

    pending
}

/// Query a calendar server for an upgraded timestamp
async fn query_calendar_for_upgrade(calendar_url: &str, commitment: &[u8]) -> Result<Timestamp> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()?;

    let commitment_hex = hex::encode(commitment);
    let url = format!("{}/timestamp/{}", calendar_url, commitment_hex);

    let response = client
        .get(&url)
        .header("Accept", "application/vnd.opentimestamps.v1")
        .send()
        .await?;

    if response.status() == 404 {
        return Err(anyhow!("Commitment not found on calendar server"));
    }

    if !response.status().is_success() {
        return Err(anyhow!(
            "Calendar server returned error: {}",
            response.status()
        ));
    }

    let response_bytes = response.bytes().await?;

    if response_bytes.len() > MAX_UPGRADE_RESPONSE_SIZE {
        return Err(anyhow!(
            "Response too large: {} bytes (max {})",
            response_bytes.len(),
            MAX_UPGRADE_RESPONSE_SIZE
        ));
    }

    // Parse the timestamp from the response
    let cursor = Cursor::new(&response_bytes);
    let mut deser = Deserializer::new(cursor);
    let upgraded_timestamp = Timestamp::deserialize(&mut deser, commitment.to_vec())
        .map_err(|e| anyhow!("Failed to parse upgraded timestamp: {}", e))?;

    Ok(upgraded_timestamp)
}

/// Merge an upgraded timestamp into the original timestamp
/// This combines the operations and attestations from the upgraded timestamp
/// This is equivalent to the JavaScript library's Timestamp.merge() method
fn merge_timestamps(original: &mut Step, upgraded: &Step) -> bool {
    // Get attestations from both timestamps
    let original_attestations = collect_attestations(original);
    let upgraded_attestations = collect_attestations(upgraded);

    // Check if upgraded timestamp has new attestations
    let has_new_attestations = upgraded_attestations.iter().any(|upgraded_att| {
        !original_attestations.iter().any(|orig_att| {
            // Compare attestations - if they're both Bitcoin attestations at same height, they're the same
            match (orig_att, upgraded_att) {
                (Attestation::Bitcoin { height: h1 }, Attestation::Bitcoin { height: h2 }) => {
                    h1 == h2
                }
                _ => false,
            }
        })
    });

    if !has_new_attestations {
        return false; // No new attestations to merge
    }

    // Actually merge the step trees
    // The merge happens by adding all the steps from the upgraded timestamp to the original
    // We need to recursively merge the next steps
    merge_step_recursive(original, upgraded)
}

/// Recursively merge steps from upgraded timestamp into original
/// This follows the same logic as the JavaScript Timestamp.merge() method
fn merge_step_recursive(original: &mut Step, upgraded: &Step) -> bool {
    let mut changed = false;

    // Match based on the step data type
    match (&original.data, &upgraded.data) {
        // If both are attestations, check if we need to add the upgraded one
        (StepData::Attestation(_), StepData::Attestation(_)) => {
            // If they're different attestations, we can't merge at this level
            // This shouldn't happen if the paths match
            return false;
        }
        // If both are operations or forks, merge the next steps
        (StepData::Op(_), StepData::Op(_)) | (StepData::Fork, StepData::Fork) => {
            // For each next step in upgraded, find or create matching step in original
            for upgraded_next in &upgraded.next {
                // Try to find a matching step in original.next
                let mut found_match = false;

                for original_next in &mut original.next {
                    // Check if the steps match (same operation/attestation type and output)
                    if steps_match(original_next, upgraded_next) {
                        // Recursively merge
                        if merge_step_recursive(original_next, upgraded_next) {
                            changed = true;
                        }
                        found_match = true;
                        break;
                    }
                }

                // If no match found, add the upgraded step to original
                if !found_match {
                    original.next.push(upgraded_next.clone());
                    changed = true;
                }
            }
        }
        // Mixed types - can't merge
        _ => return false,
    }

    changed
}

/// Check if two steps match (have same operation/attestation and output)
fn steps_match(step1: &Step, step2: &Step) -> bool {
    // Steps match if they have the same data type and same output
    if step1.output != step2.output {
        return false;
    }

    match (&step1.data, &step2.data) {
        (StepData::Op(op1), StepData::Op(op2)) => {
            // Check if operations are the same type
            std::mem::discriminant(op1) == std::mem::discriminant(op2)
        }
        (StepData::Fork, StepData::Fork) => true,
        (
            StepData::Attestation(Attestation::Bitcoin { height: h1 }),
            StepData::Attestation(Attestation::Bitcoin { height: h2 }),
        ) => h1 == h2,
        (
            StepData::Attestation(Attestation::Pending { uri: u1 }),
            StepData::Attestation(Attestation::Pending { uri: u2 }),
        ) => u1 == u2,
        (
            StepData::Attestation(Attestation::Unknown { tag: t1, .. }),
            StepData::Attestation(Attestation::Unknown { tag: t2, .. }),
        ) => t1 == t2,
        _ => false,
    }
}

/// Upgrade a timestamp by querying calendar servers for new attestations
/// This is equivalent to the JS library's upgradeTimestamp function
pub async fn upgrade_timestamp(detached_ots: &mut DetachedTimestampFile) -> Result<bool> {
    // Check if timestamp is already complete
    if is_timestamp_complete(&detached_ots.timestamp.first_step) {
        return Ok(false); // No upgrade needed
    }

    // Collect all pending attestations
    let pending = collect_pending_attestations(
        &detached_ots.timestamp.first_step,
        &detached_ots.timestamp.start_digest,
    );

    if pending.is_empty() {
        return Ok(false); // No pending attestations to upgrade
    }

    let mut changed = false;
    let mut errors = Vec::new();

    // Try to upgrade each pending attestation
    for (commitment, calendar_url) in pending {
        // Skip if not in default calendar list
        // if !DEFAULT_CALENDAR_URLS.contains(&calendar_url.as_str()) {
        //     continue;
        // }

        match query_calendar_for_upgrade(&calendar_url, &commitment).await {
            Ok(upgraded_timestamp) => {
                detached_ots.timestamp = upgraded_timestamp.clone(); // Ensure we have the latest timestamp
                                                                     // Try to merge the upgraded timestamp
                if merge_timestamps(
                    &mut detached_ots.timestamp.first_step,
                    &upgraded_timestamp.first_step,
                ) {
                    changed = true;
                }
            }
            Err(e) => {
                errors.push(format!("{}: {}", calendar_url, e));
                // Continue with other calendars even if one fails
            }
        }
    }

    if !changed && !errors.is_empty() {
        info!(
            "Failed to upgrade timestamp from calendars: {}",
            errors.join(", ")
        );
    }

    Ok(changed)
}

/// Esplora API block response
#[derive(Debug, Deserialize)]
struct EsploraBlock {
    timestamp: u64,
    height: u64,
    merkle_root: String,
}

/// Find the path to a Bitcoin attestation and return the attested digest
/// This traverses the step tree to find a Bitcoin attestation and returns the digest at that point
fn find_bitcoin_attestation_digest(step: &Step, target_height: u64) -> Option<Vec<u8>> {
    match &step.data {
        StepData::Attestation(Attestation::Bitcoin { height })
            if *height as u64 == target_height =>
        {
            // Found the attestation - return the digest at this point
            // The step.output contains the value that should match the merkle root
            return Some(step.output.clone());
        }
        StepData::Fork | StepData::Op(_) => {
            // Recursively search in next steps
            for next_step in &step.next {
                if let Some(digest) = find_bitcoin_attestation_digest(next_step, target_height) {
                    return Some(digest);
                }
            }
        }
        _ => {}
    }
    None
}

/// Verify a Bitcoin attestation against the blockchain using Esplora API
async fn verify_bitcoin_attestation(height: u64, step: &Step) -> Result<VerificationResult> {
    // Query Esplora API for block at this height
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()?;

    let url = format!("{}/block-height/{}", DEFAULT_ESPLORA_URL, height);
    let block_hash = client.get(&url).send().await?.text().await?;

    // Get block details
    let block_url = format!("{}/block/{}", DEFAULT_ESPLORA_URL, block_hash.trim());
    let response = client.get(&block_url).send().await?;

    let block: EsploraBlock = response.json().await?;

    // Find the digest at the Bitcoin attestation point
    if let Some(attested_digest) = find_bitcoin_attestation_digest(step, height) {
        // Decode the merkle root from hex
        let merkle_root = hex::decode(&block.merkle_root)
            .map_err(|e| anyhow!("Failed to decode merkle root: {}", e))?;

        // Verify that the attested digest matches the merkle root
        if attested_digest != merkle_root {
            return Err(anyhow!(
                "Merkle root mismatch! Expected: {}, Got: {}",
                hex::encode(&merkle_root),
                hex::encode(&attested_digest)
            ));
        }

        info!(
            "✓ Verified Bitcoin attestation at height {} - merkle root matches",
            height
        );
    } else {
        return Err(anyhow!(
            "Could not find attestation digest for height {}",
            height
        ));
    }

    Ok(VerificationResult {
        chain: "bitcoin".to_string(),
        timestamp: block.timestamp,
        height: block.height,
    })
}

/// Verify all attestations and return verification results
/// This is the equivalent of the JS library's verify function
/// It performs: digest check, upgrade timestamp, and blockchain verification
pub async fn verify_timestamp(
    ots_proof_b64: &str,
    artifact_sha256_hex: &str,
) -> Result<Vec<VerificationResult>> {
    // Decode base64 OTS proof
    let ots_bytes = base64::engine::general_purpose::STANDARD
        .decode(ots_proof_b64)
        .map_err(|e| anyhow!("Failed to decode base64 OTS proof: {}", e))?;

    // Decode hex artifact hash
    let artifact_digest = hex::decode(artifact_sha256_hex)
        .map_err(|e| anyhow!("Failed to decode artifact SHA256: {}", e))?;

    // Parse the OTS file
    let cursor = Cursor::new(&ots_bytes);
    let mut detached_ots = DetachedTimestampFile::from_reader(cursor)
        .map_err(|e| anyhow!("Failed to parse OTS file: {}", e))?;

    // Verify the digest matches (critical check - must match original file)
    if detached_ots.timestamp.start_digest != artifact_digest {
        return Err(anyhow!(
            "File does not match original! Expected digest: {}",
            hex::encode(&artifact_digest)
        ));
    }

    // Try to upgrade the timestamp by fetching new attestations from calendar servers
    // This is equivalent to the JS library's upgradeTimestamp call
    match upgrade_timestamp(&mut detached_ots).await {
        Ok(upgraded) => {
            if upgraded {
                info!("Timestamp upgraded with new attestations from calendar servers");
            }
        }
        Err(e) => {
            // Log but don't fail - we can still verify with existing attestations
            info!("Failed to upgrade timestamp: {}", e);
        }
    }

    // Collect all attestations from the (possibly upgraded) timestamp
    let attestations = collect_attestations(&detached_ots.timestamp.first_step);

    if attestations.is_empty() {
        return Err(anyhow!("No attestations found in timestamp"));
    }

    let mut results = Vec::new();

    // Verify each attestation against the blockchain
    for attestation in attestations {
        match attestation {
            Attestation::Bitcoin { height } => {
                // For Bitcoin attestations, verify against blockchain with merkle root check
                match verify_bitcoin_attestation(height as u64, &detached_ots.timestamp.first_step)
                    .await
                {
                    Ok(result) => results.push(result),
                    Err(e) => {
                        // Log error but continue with other attestations
                        eprintln!("Failed to verify Bitcoin attestation: {}", e);
                    }
                }
            }
            Attestation::Pending { .. } => {
                // Pending attestations are not yet confirmed
                eprintln!("Skipping pending attestation (could not upgrade)");
            }
            Attestation::Unknown { .. } => {
                // Unknown attestation types
                eprintln!("Skipping unknown attestation");
            }
        }
    }

    if results.is_empty() {
        return Err(anyhow!("No verified attestations found"));
    }

    Ok(results)
}
