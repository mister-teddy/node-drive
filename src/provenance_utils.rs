use anyhow::Result;
use std::path::Path;

use crate::provenance::{Artifact, Manifest, ProvenanceDb};

/// Get artifact from database by file path
/// Returns None if file is not in the provenance system
pub async fn get_artifact_by_path(
    db: &ProvenanceDb,
    path: &Path,
) -> Result<Option<(i64, Artifact, String)>> {
    let path_str = path
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("Invalid UTF-8 in path"))?;

    match db.get_artifact_by_path(path_str)? {
        Some((artifact_id, artifact)) => {
            let sha256_hex = artifact.sha256_hex.clone();
            Ok(Some((artifact_id, artifact, sha256_hex)))
        }
        None => Ok(None),
    }
}

/// Get complete manifest for a file
/// Returns None if file is not in the provenance system
pub async fn get_manifest_for_file(db: &ProvenanceDb, path: &Path) -> Result<Option<Manifest>> {
    let path_str = path
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("Invalid UTF-8 in path"))?;
    db.get_manifest_by_path(path_str)
}
