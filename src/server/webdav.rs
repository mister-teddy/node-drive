use anyhow::Result;
use hyper::{header::HeaderValue, StatusCode};
use std::path::Path;
use tokio::fs;
use uuid::Uuid;

use crate::http_utils::body_full;

use super::response_utils::{res_multistatus, status_forbid, status_no_content, Response};

pub async fn handle_mkcol(path: &Path, res: &mut Response) -> Result<()> {
    fs::create_dir_all(path).await?;
    *res.status_mut() = StatusCode::CREATED;
    Ok(())
}

pub async fn handle_copy(path: &Path, dest: &Path, res: &mut Response) -> Result<()> {
    let meta = fs::symlink_metadata(path).await?;
    if meta.is_dir() {
        status_forbid(res);
        return Ok(());
    }

    ensure_path_parent(dest).await?;
    fs::copy(path, dest).await?;
    status_no_content(res);
    Ok(())
}

pub async fn handle_move(
    path: &Path,
    dest: &Path,
    res: &mut Response,
    provenance_db: Option<&crate::provenance::ProvenanceDb>,
) -> Result<()> {
    ensure_path_parent(dest).await?;

    // Update provenance database if available
    if let Some(db) = provenance_db {
        let old_path_str = path.to_string_lossy().to_string();
        let new_path_str = dest.to_string_lossy().to_string();

        // Update the file_path in the database to reflect the move
        if let Err(e) = db.update_artifact_path(&old_path_str, &new_path_str) {
            // Log the error but don't fail the move operation
            eprintln!(
                "Warning: Failed to update provenance database for moved file: {}",
                e
            );
        }
    }

    // Perform the actual file system move
    fs::rename(path, dest).await?;
    status_no_content(res);
    Ok(())
}

pub async fn handle_lock(req_path: &str, auth: bool, res: &mut Response) -> Result<()> {
    let token = if auth {
        format!("opaquelocktoken:{}", Uuid::new_v4())
    } else {
        chrono::Utc::now().timestamp().to_string()
    };

    res.headers_mut().insert(
        "content-type",
        HeaderValue::from_static("application/xml; charset=utf-8"),
    );
    res.headers_mut()
        .insert("lock-token", format!("<{token}>").parse()?);

    *res.body_mut() = body_full(format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock>
<D:locktoken><D:href>{token}</D:href></D:locktoken>
<D:lockroot><D:href>{req_path}</D:href></D:lockroot>
</D:activelock></D:lockdiscovery></D:prop>"#
    ));
    Ok(())
}

pub async fn handle_proppatch(req_path: &str, res: &mut Response) -> Result<()> {
    let output = format!(
        r#"<D:response>
<D:href>{req_path}</D:href>
<D:propstat>
<D:prop>
</D:prop>
<D:status>HTTP/1.1 403 Forbidden</D:status>
</D:propstat>
</D:response>"#
    );
    res_multistatus(res, &output);
    Ok(())
}

async fn ensure_path_parent(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        if fs::symlink_metadata(parent).await.is_err() {
            fs::create_dir_all(&parent).await?;
        }
    }
    Ok(())
}
