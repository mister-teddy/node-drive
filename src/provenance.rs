use anyhow::Result;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, Mutex};

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
    pub file_name: String,
    pub size_bytes: u64,
    pub sha256_hex: String,
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

        conn.execute(
            "CREATE TABLE IF NOT EXISTS artifacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_name TEXT NOT NULL,
                sha256_hex TEXT NOT NULL UNIQUE,
                size_bytes INTEGER NOT NULL,
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

    /// Insert or update artifact
    pub fn upsert_artifact(
        &self,
        file_name: &str,
        sha256_hex: &str,
        size_bytes: u64,
    ) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO artifacts (file_name, sha256_hex, size_bytes, created_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(sha256_hex) DO UPDATE SET
                file_name = ?1,
                size_bytes = ?3",
            params![file_name, sha256_hex, size_bytes, now],
        )?;

        let artifact_id = conn.last_insert_rowid();
        Ok(artifact_id)
    }

    /// Get artifact by SHA-256 hash
    pub fn get_artifact(&self, sha256_hex: &str) -> Result<Option<(i64, Artifact)>> {
        let conn = self.conn.lock().unwrap();

        let mut stmt = conn.prepare(
            "SELECT id, file_name, size_bytes, sha256_hex FROM artifacts WHERE sha256_hex = ?1",
        )?;

        let mut rows = stmt.query(params![sha256_hex])?;

        if let Some(row) = rows.next()? {
            let id: i64 = row.get(0)?;
            let artifact = Artifact {
                file_name: row.get(1)?,
                size_bytes: row.get(2)?,
                sha256_hex: row.get(3)?,
            };
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
            "SELECT id, index_num, action, artifact_sha256_hex, prev_event_hash_hex, issued_at, event_hash_hex, ots_proof_b64
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
            });
        }

        Ok(events)
    }

    /// Generate complete manifest for an artifact
    pub fn get_manifest(&self, sha256_hex: &str) -> Result<Option<Manifest>> {
        let (artifact_id, artifact) = match self.get_artifact(sha256_hex)? {
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

    /// Get the last event hash for an artifact
    #[allow(dead_code)]
    pub fn get_last_event_hash(&self, artifact_id: i64) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();

        let mut stmt = conn.prepare(
            "SELECT event_hash_hex FROM events WHERE artifact_id = ?1 ORDER BY index_num DESC LIMIT 1"
        )?;

        let mut rows = stmt.query(params![artifact_id])?;

        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
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
}

/// Compute event hash according to spec (canonical event excluding signatures, ots_proof_b64, event_hash_hex)
pub fn compute_event_hash(
    index: u32,
    action: &EventAction,
    artifact_sha256_hex: &str,
    prev_event_hash_hex: Option<&str>,
    actors: &Actors,
    issued_at: &str,
) -> String {
    use sha2::{Digest, Sha256};

    let mut hasher = Sha256::new();

    // Build canonical representation
    hasher.update(format!("index:{}", index).as_bytes());
    hasher.update(format!("action:{:?}", action).as_bytes());
    hasher.update(format!("artifact_sha256_hex:{}", artifact_sha256_hex).as_bytes());

    if let Some(prev) = prev_event_hash_hex {
        hasher.update(format!("prev_event_hash_hex:{}", prev).as_bytes());
    } else {
        hasher.update(b"prev_event_hash_hex:null");
    }

    if let Some(ref creator) = actors.creator_pubkey_hex {
        hasher.update(format!("creator_pubkey_hex:{}", creator).as_bytes());
    }
    if let Some(ref prev_owner) = actors.prev_owner_pubkey_hex {
        hasher.update(format!("prev_owner_pubkey_hex:{}", prev_owner).as_bytes());
    }
    if let Some(ref new_owner) = actors.new_owner_pubkey_hex {
        hasher.update(format!("new_owner_pubkey_hex:{}", new_owner).as_bytes());
    }

    hasher.update(format!("issued_at:{}", issued_at).as_bytes());

    let result = hasher.finalize();
    hex::encode(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_db_creation() -> Result<()> {
        let db = ProvenanceDb::new(":memory:")?;

        // Test artifact insertion
        let artifact_id = db.upsert_artifact("test.txt", "abc123", 1024)?;

        assert!(artifact_id > 0);

        Ok(())
    }

    #[test]
    fn test_event_insertion() -> Result<()> {
        let db = ProvenanceDb::new(":memory:")?;

        let artifact_id = db.upsert_artifact("test.txt", "abc123", 1024)?;

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

        let artifact_id = db.upsert_artifact("test.txt", "abc123", 1024)?;

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

        let manifest = db.get_manifest("abc123")?.unwrap();

        assert_eq!(manifest.artifact.sha256_hex, "abc123");
        assert_eq!(manifest.events.len(), 1);
        assert_eq!(manifest.events[0].index, 0);

        Ok(())
    }
}
