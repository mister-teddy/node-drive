use anyhow::Result;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// Static server keypair for signing (to be replaced with proper key management later)
/// This is a demo keypair - in production, use a securely stored key
pub const SERVER_PRIVATE_KEY_HEX: &str =
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
pub const SERVER_PUBLIC_KEY_HEX: &str =
    "02506bc1dc099358e5137292f4efdd57e400f29ba5132aa5d12b18dac1c1f6aaba";

/// Provenance manifest following provenance.manifest/v1 spec
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    #[serde(rename = "type")]
    pub manifest_type: String,
    pub artifact: Artifact,
    pub events: Vec<Event>,
}

/// Artifact metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Artifact {
    #[serde(skip)]
    pub file_path: PathBuf,
    pub sha256_hex: String,
}

impl Artifact {
    /// Create artifact from file path and hash
    pub fn new(file_path: PathBuf, sha256_hex: String) -> Self {
        Self {
            file_path,
            sha256_hex,
        }
    }
}

/// Provenance event following provenance.event/v1 spec
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    #[serde(rename = "type")]
    pub event_type: String,
    pub index: u32,
    pub action: EventAction,
    pub artifact_sha256_hex: String,
    pub prev_event_hash_hex: Option<String>,
    pub actors: Actors,
    pub issued_at: String,
    pub event_hash_hex: String,
    pub signatures: Signatures,
    pub ots_proof_b64: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verified_chain: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verified_timestamp: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verified_height: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_verified_at: Option<String>,
}

/// Event action type
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EventAction {
    Mint,
    Transfer,
}

/// Actors involved in an event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Actors {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub creator_pubkey_hex: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prev_owner_pubkey_hex: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_owner_pubkey_hex: Option<String>,
}

/// Signatures over event_hash_hex
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Signatures {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub creator_sig_hex: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prev_owner_sig_hex: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_owner_sig_hex: Option<String>,
}

/// Arguments for inserting a provenance event
pub struct InsertEventArgs<'a> {
    pub artifact_id: i64,
    pub index: u32,
    pub action: &'a EventAction,
    pub artifact_sha256_hex: &'a str,
    pub prev_event_hash_hex: Option<&'a str>,
    pub issued_at: &'a str,
    pub event_hash_hex: &'a str,
    pub ots_proof_b64: &'a str,
    pub actors: &'a Actors,
    pub signatures: &'a Signatures,
}

/// Thread-safe database connection wrapper
#[derive(Clone)]
pub struct ProvenanceDb {
    conn: Arc<Mutex<Connection>>,
}

impl ProvenanceDb {
    /// Initialize database with schema
    pub fn new<P: AsRef<Path>>(path: P) -> Result<Self> {
        let conn = Connection::open(path)?;

        // Enable foreign key constraints
        conn.execute("PRAGMA foreign_keys = ON", [])?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS artifacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path TEXT NOT NULL UNIQUE,
                sha256_hex TEXT NOT NULL,
                created_at TEXT NOT NULL
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                artifact_id INTEGER NOT NULL,
                index_num INTEGER NOT NULL,
                action TEXT NOT NULL CHECK(action IN ('mint', 'transfer')),
                artifact_sha256_hex TEXT NOT NULL,
                prev_event_hash_hex TEXT,
                issued_at TEXT NOT NULL,
                event_hash_hex TEXT NOT NULL UNIQUE,
                ots_proof_b64 TEXT NOT NULL,
                verified_chain TEXT,
                verified_timestamp INTEGER,
                verified_height INTEGER,
                last_verified_at TEXT,
                FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE,
                UNIQUE(artifact_id, index_num)
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS event_actors (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id INTEGER NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('creator', 'prev_owner', 'new_owner')),
                pubkey_hex TEXT NOT NULL,
                FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS event_signatures (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id INTEGER NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('creator', 'prev_owner', 'new_owner')),
                signature_hex TEXT NOT NULL,
                FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
            )",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_artifacts_sha256 ON artifacts(sha256_hex)",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_artifacts_file_path ON artifacts(file_path)",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_events_artifact ON events(artifact_id)",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_event_actors_event ON event_actors(event_id)",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_event_signatures_event ON event_signatures(event_id)",
            [],
        )?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    /// Insert or update artifact by file path
    pub fn upsert_artifact(&self, file_path: &str, sha256_hex: &str) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();

        let artifact_id: i64 = conn.query_row(
            r#"
            INSERT INTO artifacts (file_path, sha256_hex, created_at)
            VALUES (?1, ?2, ?3)
            ON CONFLICT(file_path) DO UPDATE SET
                sha256_hex = excluded.sha256_hex
            RETURNING id
            "#,
            params![file_path, sha256_hex, now],
            |row| row.get(0),
        )?;

        Ok(artifact_id)
    }

    /// Get artifact by file path
    pub fn get_artifact_by_path(&self, file_path: &str) -> Result<Option<(i64, Artifact)>> {
        let conn = self.conn.lock().unwrap();

        let mut stmt =
            conn.prepare("SELECT id, file_path, sha256_hex FROM artifacts WHERE file_path = ?1")?;

        let mut rows = stmt.query(params![file_path])?;

        if let Some(row) = rows.next()? {
            let id: i64 = row.get(0)?;
            let file_path_str: String = row.get(1)?;
            let sha256_hex: String = row.get(2)?;
            let artifact = Artifact::new(PathBuf::from(file_path_str), sha256_hex);
            Ok(Some((id, artifact)))
        } else {
            Ok(None)
        }
    }

    /// Insert a new provenance event
    pub fn insert_event(&self, args: InsertEventArgs) -> Result<i64> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;

        let action_str = match args.action {
            EventAction::Mint => "mint",
            EventAction::Transfer => "transfer",
        };

        tx.execute(
            "INSERT INTO events (artifact_id, index_num, action, artifact_sha256_hex, prev_event_hash_hex, issued_at, event_hash_hex, ots_proof_b64)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                args.artifact_id,
                args.index,
                action_str,
                args.artifact_sha256_hex,
                args.prev_event_hash_hex,
                args.issued_at,
                args.event_hash_hex,
                args.ots_proof_b64
            ],
        )?;

        let event_id = tx.last_insert_rowid();

        // Insert actors
        if let Some(ref creator) = args.actors.creator_pubkey_hex {
            tx.execute(
                "INSERT INTO event_actors (event_id, role, pubkey_hex) VALUES (?1, 'creator', ?2)",
                params![event_id, creator],
            )?;
        }
        if let Some(ref prev_owner) = args.actors.prev_owner_pubkey_hex {
            tx.execute(
                "INSERT INTO event_actors (event_id, role, pubkey_hex) VALUES (?1, 'prev_owner', ?2)",
                params![event_id, prev_owner],
            )?;
        }
        if let Some(ref new_owner) = args.actors.new_owner_pubkey_hex {
            tx.execute(
                "INSERT INTO event_actors (event_id, role, pubkey_hex) VALUES (?1, 'new_owner', ?2)",
                params![event_id, new_owner],
            )?;
        }

        // Insert signatures
        if let Some(ref creator_sig) = args.signatures.creator_sig_hex {
            tx.execute(
                "INSERT INTO event_signatures (event_id, role, signature_hex) VALUES (?1, 'creator', ?2)",
                params![event_id, creator_sig],
            )?;
        }
        if let Some(ref prev_owner_sig) = args.signatures.prev_owner_sig_hex {
            tx.execute(
                "INSERT INTO event_signatures (event_id, role, signature_hex) VALUES (?1, 'prev_owner', ?2)",
                params![event_id, prev_owner_sig],
            )?;
        }
        if let Some(ref new_owner_sig) = args.signatures.new_owner_sig_hex {
            tx.execute(
                "INSERT INTO event_signatures (event_id, role, signature_hex) VALUES (?1, 'new_owner', ?2)",
                params![event_id, new_owner_sig],
            )?;
        }

        tx.commit()?;
        Ok(event_id)
    }

    /// Get all events for an artifact, ordered by index
    fn get_events(&self, artifact_id: i64) -> Result<Vec<Event>> {
        let conn = self.conn.lock().unwrap();

        let mut stmt = conn.prepare(
            "SELECT id, index_num, action, artifact_sha256_hex, prev_event_hash_hex, issued_at, event_hash_hex, ots_proof_b64,
                    verified_chain, verified_timestamp, verified_height, last_verified_at
             FROM events
             WHERE artifact_id = ?1
             ORDER BY index_num ASC"
        )?;

        let mut rows = stmt.query(params![artifact_id])?;
        let mut events = Vec::new();

        while let Some(row) = rows.next()? {
            let event_id: i64 = row.get(0)?;
            let index: u32 = row.get(1)?;
            let action: String = row.get(2)?;
            let artifact_sha256_hex: String = row.get(3)?;
            let prev_event_hash_hex: Option<String> = row.get(4)?;
            let issued_at: String = row.get(5)?;
            let event_hash_hex: String = row.get(6)?;
            let ots_proof_b64: String = row.get(7)?;
            let verified_chain: Option<String> = row.get(8)?;
            let verified_timestamp: Option<i64> = row.get(9)?;
            let verified_height: Option<u64> = row.get(10)?;
            let last_verified_at: Option<String> = row.get(11)?;

            // Get actors
            let mut actors_stmt =
                conn.prepare("SELECT role, pubkey_hex FROM event_actors WHERE event_id = ?1")?;
            let mut actors_rows = actors_stmt.query(params![event_id])?;
            let mut actors = Actors {
                creator_pubkey_hex: None,
                prev_owner_pubkey_hex: None,
                new_owner_pubkey_hex: None,
            };

            while let Some(actor_row) = actors_rows.next()? {
                let role: String = actor_row.get(0)?;
                let pubkey: String = actor_row.get(1)?;
                match role.as_str() {
                    "creator" => actors.creator_pubkey_hex = Some(pubkey),
                    "prev_owner" => actors.prev_owner_pubkey_hex = Some(pubkey),
                    "new_owner" => actors.new_owner_pubkey_hex = Some(pubkey),
                    _ => {}
                }
            }

            // Get signatures
            let mut sigs_stmt = conn
                .prepare("SELECT role, signature_hex FROM event_signatures WHERE event_id = ?1")?;
            let mut sigs_rows = sigs_stmt.query(params![event_id])?;
            let mut signatures = Signatures {
                creator_sig_hex: None,
                prev_owner_sig_hex: None,
                new_owner_sig_hex: None,
            };

            while let Some(sig_row) = sigs_rows.next()? {
                let role: String = sig_row.get(0)?;
                let signature: String = sig_row.get(1)?;
                match role.as_str() {
                    "creator" => signatures.creator_sig_hex = Some(signature),
                    "prev_owner" => signatures.prev_owner_sig_hex = Some(signature),
                    "new_owner" => signatures.new_owner_sig_hex = Some(signature),
                    _ => {}
                }
            }

            let action = match action.as_str() {
                "mint" => EventAction::Mint,
                "transfer" => EventAction::Transfer,
                _ => continue,
            };

            events.push(Event {
                event_type: "provenance.event/v1".to_string(),
                index,
                action,
                artifact_sha256_hex,
                prev_event_hash_hex,
                actors,
                issued_at,
                event_hash_hex,
                signatures,
                ots_proof_b64,
                verified_chain,
                verified_timestamp,
                verified_height,
                last_verified_at,
            });
        }

        Ok(events)
    }

    /// Generate complete manifest for an artifact by file path
    pub fn get_manifest_by_path(&self, file_path: &str) -> Result<Option<Manifest>> {
        let (artifact_id, artifact) = match self.get_artifact_by_path(file_path)? {
            Some(result) => result,
            None => return Ok(None),
        };

        let events = self.get_events(artifact_id)?;

        Ok(Some(Manifest {
            manifest_type: "provenance.manifest/v1".to_string(),
            artifact,
            events,
        }))
    }

    /// Get the next event index for an artifact
    pub fn get_next_event_index(&self, artifact_id: i64) -> Result<u32> {
        let conn = self.conn.lock().unwrap();

        let mut stmt = conn.prepare("SELECT MAX(index_num) FROM events WHERE artifact_id = ?1")?;

        let max_index: Option<u32> = stmt.query_row(params![artifact_id], |row| row.get(0))?;

        Ok(max_index.map(|i| i + 1).unwrap_or(0))
    }

    /// Update the OTS proof for a specific event
    pub fn update_ots_proof(
        &self,
        artifact_id: i64,
        event_index: u32,
        ots_proof_b64: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();

        conn.execute(
            "UPDATE events SET ots_proof_b64 = ?1 WHERE artifact_id = ?2 AND index_num = ?3",
            params![ots_proof_b64, artifact_id, event_index],
        )?;

        Ok(())
    }

    /// Update verification results for a specific event
    pub fn update_verification_result(
        &self,
        artifact_id: i64,
        event_index: u32,
        chain: &str,
        timestamp: i64,
        height: u64,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "UPDATE events
             SET verified_chain = ?1,
                 verified_timestamp = ?2,
                 verified_height = ?3,
                 last_verified_at = ?4
             WHERE artifact_id = ?5 AND index_num = ?6",
            params![
                chain,
                timestamp,
                height as i64,
                now,
                artifact_id,
                event_index
            ],
        )?;

        Ok(())
    }

    /// Update both OTS proof and verification results in a single transaction
    pub fn update_ots_proof_and_verification(
        &self,
        artifact_id: i64,
        event_index: u32,
        ots_proof_b64: &str,
        chain: &str,
        timestamp: i64,
        height: u64,
    ) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let now = chrono::Utc::now().to_rfc3339();

        tx.execute(
            "UPDATE events
             SET ots_proof_b64 = ?1,
                 verified_chain = ?2,
                 verified_timestamp = ?3,
                 verified_height = ?4,
                 last_verified_at = ?5
             WHERE artifact_id = ?6 AND index_num = ?7",
            params![
                ots_proof_b64,
                chain,
                timestamp,
                height as i64,
                now,
                artifact_id,
                event_index
            ],
        )?;

        tx.commit()?;
        Ok(())
    }
}

/// Canonical event representation (excluding signature, hash, and OTS proof)
#[derive(Debug, Serialize)]
struct CanonicalEvent {
    #[serde(rename = "type")]
    event_type: String,
    index: u32,
    action: String,
    artifact_sha256_hex: String,
    prev_event_hash_hex: Option<String>,
    actors: serde_json::Value,
    issued_at: String,
}

/// Compute event hash according to spec (canonical event excluding signatures, ots_proof_b64, event_hash_hex)
///
/// This creates a deterministic, canonical JSON representation by:
/// 1. Including only core event fields (excluding signatures, hash, and OTS proof)
/// 2. Serializing to JSON with sorted keys
/// 3. Hashing the resulting JSON string
pub fn compute_event_hash(
    index: u32,
    action: &EventAction,
    artifact_sha256_hex: &str,
    prev_event_hash_hex: Option<&str>,
    actors: &Actors,
    issued_at: &str,
) -> String {
    use sha2::{Digest, Sha256};

    // Convert action to lowercase string
    let action_str = match action {
        EventAction::Mint => "mint",
        EventAction::Transfer => "transfer",
    };

    // Build actors JSON with sorted keys
    let mut actors_map = serde_json::Map::new();
    if let Some(ref creator) = actors.creator_pubkey_hex {
        actors_map.insert(
            "creator_pubkey_hex".to_string(),
            serde_json::Value::String(creator.clone()),
        );
    }
    if let Some(ref new_owner) = actors.new_owner_pubkey_hex {
        actors_map.insert(
            "new_owner_pubkey_hex".to_string(),
            serde_json::Value::String(new_owner.clone()),
        );
    }
    if let Some(ref prev_owner) = actors.prev_owner_pubkey_hex {
        actors_map.insert(
            "prev_owner_pubkey_hex".to_string(),
            serde_json::Value::String(prev_owner.clone()),
        );
    }

    // Create canonical event
    let canonical = CanonicalEvent {
        event_type: "provenance.event/v1".to_string(),
        index,
        action: action_str.to_string(),
        artifact_sha256_hex: artifact_sha256_hex.to_string(),
        prev_event_hash_hex: prev_event_hash_hex.map(|s| s.to_string()),
        actors: serde_json::Value::Object(actors_map),
        issued_at: issued_at.to_string(),
    };

    // Serialize to JSON with sorted keys (serde_json maintains insertion order, we built it sorted)
    let canonical_json =
        serde_json::to_string(&canonical).expect("Failed to serialize canonical event");

    // Hash the canonical JSON
    let mut hasher = Sha256::new();
    hasher.update(canonical_json.as_bytes());
    let result = hasher.finalize();

    hex::encode(result)
}

/// Sign an event hash with a secp256k1 private key
///
/// # Arguments
/// * `event_hash_hex` - The hex-encoded event hash to sign
/// * `private_key_hex` - The hex-encoded secp256k1 private key
///
/// # Returns
/// Hex-encoded DER signature
pub fn sign_event_hash(event_hash_hex: &str, private_key_hex: &str) -> Result<String> {
    use secp256k1::{ecdsa::Signature, Message, Secp256k1, SecretKey};

    // Decode hex inputs
    let event_hash_bytes = hex::decode(event_hash_hex)
        .map_err(|e| anyhow::anyhow!("Failed to decode event hash: {}", e))?;
    let private_key_bytes = hex::decode(private_key_hex)
        .map_err(|e| anyhow::anyhow!("Failed to decode private key: {}", e))?;

    // Create secp256k1 context
    let secp = Secp256k1::new();

    // Parse private key
    let secret_key = SecretKey::from_slice(&private_key_bytes)
        .map_err(|e| anyhow::anyhow!("Invalid private key: {}", e))?;

    // Create message from hash (must be exactly 32 bytes)
    if event_hash_bytes.len() != 32 {
        return Err(anyhow::anyhow!("Event hash must be 32 bytes"));
    }
    let message = Message::from_digest_slice(&event_hash_bytes)
        .map_err(|e| anyhow::anyhow!("Invalid message: {}", e))?;

    // Sign the message
    let signature: Signature = secp.sign_ecdsa(&message, &secret_key);

    // Serialize signature to DER format and encode as hex
    Ok(hex::encode(signature.serialize_der()))
}

/// Verify an ECDSA signature over an event hash
///
/// # Arguments
/// * `event_hash_hex` - The hex-encoded event hash that was signed
/// * `signature_hex` - The hex-encoded DER signature
/// * `public_key_hex` - The hex-encoded compressed public key
///
/// # Returns
/// `Ok(true)` if signature is valid, `Ok(false)` if invalid, `Err` on parsing errors
pub fn verify_event_signature(
    event_hash_hex: &str,
    signature_hex: &str,
    public_key_hex: &str,
) -> Result<bool> {
    use secp256k1::{ecdsa::Signature, Message, PublicKey, Secp256k1};

    // Decode hex inputs
    let event_hash_bytes = hex::decode(event_hash_hex)
        .map_err(|e| anyhow::anyhow!("Failed to decode event hash: {}", e))?;
    let signature_bytes = hex::decode(signature_hex)
        .map_err(|e| anyhow::anyhow!("Failed to decode signature: {}", e))?;
    let public_key_bytes = hex::decode(public_key_hex)
        .map_err(|e| anyhow::anyhow!("Failed to decode public key: {}", e))?;

    // Create secp256k1 context
    let secp = Secp256k1::new();

    // Parse signature
    let signature = Signature::from_der(&signature_bytes)
        .map_err(|e| anyhow::anyhow!("Invalid signature: {}", e))?;

    // Parse public key
    let public_key = PublicKey::from_slice(&public_key_bytes)
        .map_err(|e| anyhow::anyhow!("Invalid public key: {}", e))?;

    // Create message from hash (must be exactly 32 bytes)
    if event_hash_bytes.len() != 32 {
        return Err(anyhow::anyhow!("Event hash must be 32 bytes"));
    }
    let message = Message::from_digest_slice(&event_hash_bytes)
        .map_err(|e| anyhow::anyhow!("Invalid message: {}", e))?;

    // Verify signature
    match secp.verify_ecdsa(&message, &signature, &public_key) {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

/// Verify a complete event's integrity and signature
///
/// This function:
/// 1. Recomputes the canonical event hash
/// 2. Verifies it matches the stored event_hash_hex
/// 3. Verifies the signature over the event hash
///
/// # Returns
/// * `Ok(true)` - Event is valid (hash matches and signature verifies)
/// * `Ok(false)` - Event is invalid (hash mismatch or signature fails)
/// * `Err` - Error during verification (missing data, parsing errors, etc.)
pub fn verify_event(event: &Event) -> Result<bool> {
    // Recompute canonical event hash
    let computed_hash = compute_event_hash(
        event.index,
        &event.action,
        &event.artifact_sha256_hex,
        event.prev_event_hash_hex.as_deref(),
        &event.actors,
        &event.issued_at,
    );

    // Check if hash matches
    if computed_hash != event.event_hash_hex {
        return Ok(false);
    }

    // Verify signature based on event type
    match event.action {
        EventAction::Mint => {
            // For mint events, verify creator signature
            match (
                &event.signatures.creator_sig_hex,
                &event.actors.creator_pubkey_hex,
            ) {
                (Some(sig), Some(pubkey)) => {
                    verify_event_signature(&event.event_hash_hex, sig, pubkey)
                }
                _ => Err(anyhow::anyhow!(
                    "Mint event missing creator signature or public key"
                )),
            }
        }
        EventAction::Transfer => {
            // For transfer events, verify both prev_owner and new_owner signatures
            let prev_valid = match (
                &event.signatures.prev_owner_sig_hex,
                &event.actors.prev_owner_pubkey_hex,
            ) {
                (Some(sig), Some(pubkey)) => {
                    verify_event_signature(&event.event_hash_hex, sig, pubkey)?
                }
                _ => {
                    return Err(anyhow::anyhow!(
                        "Transfer event missing prev_owner signature or public key"
                    ))
                }
            };

            let new_valid = match (
                &event.signatures.new_owner_sig_hex,
                &event.actors.new_owner_pubkey_hex,
            ) {
                (Some(sig), Some(pubkey)) => {
                    verify_event_signature(&event.event_hash_hex, sig, pubkey)?
                }
                _ => {
                    return Err(anyhow::anyhow!(
                        "Transfer event missing new_owner signature or public key"
                    ))
                }
            };

            Ok(prev_valid && new_valid)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_db_creation() -> Result<()> {
        let db = ProvenanceDb::new(":memory:")?;

        // Test artifact insertion
        let artifact_id = db.upsert_artifact("/tmp/test.txt", "abc123")?;

        assert!(artifact_id > 0);

        Ok(())
    }

    #[test]
    fn test_event_insertion() -> Result<()> {
        let db = ProvenanceDb::new(":memory:")?;

        let artifact_id = db.upsert_artifact("/tmp/test.txt", "abc123")?;

        let actors = Actors {
            creator_pubkey_hex: Some("02a1bc".to_string()),
            prev_owner_pubkey_hex: None,
            new_owner_pubkey_hex: None,
        };

        let signatures = Signatures {
            creator_sig_hex: Some("3045".to_string()),
            prev_owner_sig_hex: None,
            new_owner_sig_hex: None,
        };

        let args = InsertEventArgs {
            artifact_id,
            index: 0,
            action: &EventAction::Mint,
            artifact_sha256_hex: "abc123",
            prev_event_hash_hex: None,
            issued_at: "2025-09-25T14:12:34Z",
            event_hash_hex: "event_hash_1",
            ots_proof_b64: "ots_proof_base64",
            actors: &actors,
            signatures: &signatures,
        };

        let event_id = db.insert_event(args)?;

        assert!(event_id > 0);

        Ok(())
    }

    #[test]
    fn test_manifest_generation() -> Result<()> {
        let db = ProvenanceDb::new(":memory:")?;

        let artifact_id = db.upsert_artifact("/tmp/test.txt", "abc123")?;

        let actors = Actors {
            creator_pubkey_hex: Some("02a1bc".to_string()),
            prev_owner_pubkey_hex: None,
            new_owner_pubkey_hex: None,
        };

        let signatures = Signatures {
            creator_sig_hex: Some("3045".to_string()),
            prev_owner_sig_hex: None,
            new_owner_sig_hex: None,
        };

        let args = InsertEventArgs {
            artifact_id,
            index: 0,
            action: &EventAction::Mint,
            artifact_sha256_hex: "abc123",
            prev_event_hash_hex: None,
            issued_at: "2025-09-25T14:12:34Z",
            event_hash_hex: "event_hash_1",
            ots_proof_b64: "ots_proof_base64",
            actors: &actors,
            signatures: &signatures,
        };

        db.insert_event(args)?;

        let manifest = db.get_manifest_by_path("/tmp/test.txt")?.unwrap();

        assert_eq!(manifest.artifact.sha256_hex, "abc123");
        assert_eq!(manifest.events.len(), 1);
        assert_eq!(manifest.events[0].index, 0);

        Ok(())
    }

    #[test]
    fn test_canonical_event_hash_deterministic() {
        // Test that canonical hash is deterministic regardless of how actors are constructed
        let actors1 = Actors {
            creator_pubkey_hex: Some("02a1bc".to_string()),
            prev_owner_pubkey_hex: None,
            new_owner_pubkey_hex: None,
        };

        let actors2 = Actors {
            new_owner_pubkey_hex: None,
            creator_pubkey_hex: Some("02a1bc".to_string()),
            prev_owner_pubkey_hex: None,
        };

        let hash1 = compute_event_hash(
            0,
            &EventAction::Mint,
            "abc123",
            None,
            &actors1,
            "2025-09-25T14:12:34Z",
        );

        let hash2 = compute_event_hash(
            0,
            &EventAction::Mint,
            "abc123",
            None,
            &actors2,
            "2025-09-25T14:12:34Z",
        );

        assert_eq!(hash1, hash2, "Canonical hash should be deterministic");
    }

    #[test]
    fn test_canonical_event_hash_different_for_different_data() {
        let actors = Actors {
            creator_pubkey_hex: Some("02a1bc".to_string()),
            prev_owner_pubkey_hex: None,
            new_owner_pubkey_hex: None,
        };

        let hash1 = compute_event_hash(
            0,
            &EventAction::Mint,
            "abc123",
            None,
            &actors,
            "2025-09-25T14:12:34Z",
        );

        let hash2 = compute_event_hash(
            1, // Different index
            &EventAction::Mint,
            "abc123",
            None,
            &actors,
            "2025-09-25T14:12:34Z",
        );

        assert_ne!(
            hash1, hash2,
            "Different data should produce different hashes"
        );
    }

    #[test]
    fn test_secp256k1_sign_and_verify() -> Result<()> {
        use secp256k1::Secp256k1;

        // Generate a random keypair for testing
        let secp = Secp256k1::new();
        let (secret_key, public_key) = secp.generate_keypair(&mut rand::thread_rng());

        // Convert to hex
        let private_key_hex = hex::encode(secret_key.secret_bytes());
        let public_key_hex = hex::encode(public_key.serialize());

        // Create a sample event hash
        let actors = Actors {
            creator_pubkey_hex: Some(public_key_hex.clone()),
            prev_owner_pubkey_hex: None,
            new_owner_pubkey_hex: None,
        };

        let event_hash = compute_event_hash(
            0,
            &EventAction::Mint,
            "abc123",
            None,
            &actors,
            "2025-09-25T14:12:34Z",
        );

        // Sign the event hash
        let signature = sign_event_hash(&event_hash, &private_key_hex)?;

        // Verify the signature
        let is_valid = verify_event_signature(&event_hash, &signature, &public_key_hex)?;

        assert!(is_valid, "Signature should be valid");

        Ok(())
    }

    #[test]
    fn test_secp256k1_verify_invalid_signature() -> Result<()> {
        use secp256k1::Secp256k1;

        // Generate two different keypairs
        let secp = Secp256k1::new();
        let (secret_key1, public_key1) = secp.generate_keypair(&mut rand::thread_rng());
        let (_secret_key2, public_key2) = secp.generate_keypair(&mut rand::thread_rng());

        let private_key_hex = hex::encode(secret_key1.secret_bytes());
        let public_key1_hex = hex::encode(public_key1.serialize());
        let public_key2_hex = hex::encode(public_key2.serialize());

        // Create event hash and sign with keypair1
        let actors = Actors {
            creator_pubkey_hex: Some(public_key1_hex.clone()),
            prev_owner_pubkey_hex: None,
            new_owner_pubkey_hex: None,
        };

        let event_hash = compute_event_hash(
            0,
            &EventAction::Mint,
            "abc123",
            None,
            &actors,
            "2025-09-25T14:12:34Z",
        );

        let signature = sign_event_hash(&event_hash, &private_key_hex)?;

        // Try to verify with keypair2's public key (should fail)
        let is_valid = verify_event_signature(&event_hash, &signature, &public_key2_hex)?;

        assert!(
            !is_valid,
            "Signature should be invalid with wrong public key"
        );

        Ok(())
    }

    #[test]
    fn test_verify_complete_mint_event() -> Result<()> {
        use secp256k1::Secp256k1;

        // Generate keypair
        let secp = Secp256k1::new();
        let (secret_key, public_key) = secp.generate_keypair(&mut rand::thread_rng());

        let private_key_hex = hex::encode(secret_key.secret_bytes());
        let public_key_hex = hex::encode(public_key.serialize());

        // Create actors
        let actors = Actors {
            creator_pubkey_hex: Some(public_key_hex.clone()),
            prev_owner_pubkey_hex: None,
            new_owner_pubkey_hex: None,
        };

        // Compute canonical event hash
        let event_hash = compute_event_hash(
            0,
            &EventAction::Mint,
            "abc123",
            None,
            &actors,
            "2025-09-25T14:12:34Z",
        );

        // Sign the hash
        let signature = sign_event_hash(&event_hash, &private_key_hex)?;

        // Create complete event
        let event = Event {
            event_type: "provenance.event/v1".to_string(),
            index: 0,
            action: EventAction::Mint,
            artifact_sha256_hex: "abc123".to_string(),
            prev_event_hash_hex: None,
            actors: actors.clone(),
            issued_at: "2025-09-25T14:12:34Z".to_string(),
            event_hash_hex: event_hash.clone(),
            signatures: Signatures {
                creator_sig_hex: Some(signature),
                prev_owner_sig_hex: None,
                new_owner_sig_hex: None,
            },
            ots_proof_b64: "AAA...".to_string(),
            verified_chain: None,
            verified_timestamp: None,
            verified_height: None,
            last_verified_at: None,
        };

        // Verify complete event
        let is_valid = verify_event(&event)?;

        assert!(is_valid, "Complete mint event should be valid");

        Ok(())
    }

    #[test]
    fn test_verify_event_with_tampered_hash() -> Result<()> {
        use secp256k1::Secp256k1;

        // Generate keypair
        let secp = Secp256k1::new();
        let (secret_key, public_key) = secp.generate_keypair(&mut rand::thread_rng());

        let private_key_hex = hex::encode(secret_key.secret_bytes());
        let public_key_hex = hex::encode(public_key.serialize());

        // Create actors
        let actors = Actors {
            creator_pubkey_hex: Some(public_key_hex.clone()),
            prev_owner_pubkey_hex: None,
            new_owner_pubkey_hex: None,
        };

        // Compute canonical event hash
        let event_hash = compute_event_hash(
            0,
            &EventAction::Mint,
            "abc123",
            None,
            &actors,
            "2025-09-25T14:12:34Z",
        );

        // Sign the hash
        let signature = sign_event_hash(&event_hash, &private_key_hex)?;

        // Create event with TAMPERED hash
        let event = Event {
            event_type: "provenance.event/v1".to_string(),
            index: 0,
            action: EventAction::Mint,
            artifact_sha256_hex: "abc123".to_string(),
            prev_event_hash_hex: None,
            actors: actors.clone(),
            issued_at: "2025-09-25T14:12:34Z".to_string(),
            event_hash_hex: "0000000000000000000000000000000000000000000000000000000000000000"
                .to_string(), // TAMPERED!
            signatures: Signatures {
                creator_sig_hex: Some(signature),
                prev_owner_sig_hex: None,
                new_owner_sig_hex: None,
            },
            ots_proof_b64: "AAA...".to_string(),
            verified_chain: None,
            verified_timestamp: None,
            verified_height: None,
            last_verified_at: None,
        };

        // Verification should fail
        let is_valid = verify_event(&event)?;

        assert!(!is_valid, "Event with tampered hash should be invalid");

        Ok(())
    }
}
