use anyhow::Result;
use headers::{HeaderMap, HeaderMapExt};
use hyper::{header::HeaderValue, StatusCode};
use std::path::Path;
use tokio::fs;
use uuid::Uuid;

use crate::auth::AccessPaths;
use crate::http_utils::body_full;

use super::path_item::PathItem;
use super::response_utils::{
    res_multistatus, status_bad_request, status_forbid, status_no_content, status_not_found,
    Response,
};
use super::Request;

pub async fn handle_propfind_dir(
    path: &Path,
    headers: &HeaderMap<HeaderValue>,
    serve_path: &Path,
    uri_prefix: &str,
    access_paths: AccessPaths,
    to_pathitem: impl Fn(
        &Path,
        &Path,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<Option<PathItem>>> + Send>,
    >,
    list_dir: impl Fn(
        &Path,
        &Path,
        AccessPaths,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<Vec<PathItem>>> + Send>,
    >,
    res: &mut Response,
) -> Result<()> {
    let depth: u32 = match headers.get("depth") {
        Some(v) => match v.to_str().ok().and_then(|v| v.parse().ok()) {
            Some(0) => 0,
            Some(1) => 1,
            _ => {
                status_bad_request(res, "Invalid depth: only 0 and 1 are allowed.");
                return Ok(());
            }
        },
        None => 1,
    };
    let mut paths = match to_pathitem(path, serve_path).await? {
        Some(v) => vec![v],
        None => vec![],
    };
    if depth == 1 {
        match list_dir(path, serve_path, access_paths).await {
            Ok(child) => paths.extend(child),
            Err(_) => {
                status_forbid(res);
                return Ok(());
            }
        }
    }
    let output =
        paths
            .iter()
            .map(|v| v.to_dav_xml(uri_prefix))
            .fold(String::new(), |mut acc, v| {
                acc.push_str(&v);
                acc
            });
    res_multistatus(res, &output);
    Ok(())
}

pub async fn handle_propfind_file(
    path: &Path,
    serve_path: &Path,
    uri_prefix: &str,
    to_pathitem: impl Fn(
        &Path,
        &Path,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<Option<PathItem>>> + Send>,
    >,
    res: &mut Response,
) -> Result<()> {
    if let Some(pathitem) = to_pathitem(path, serve_path).await? {
        res_multistatus(res, &pathitem.to_dav_xml(uri_prefix));
    } else {
        status_not_found(res);
    }
    Ok(())
}

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

pub async fn handle_move(path: &Path, dest: &Path, res: &mut Response) -> Result<()> {
    ensure_path_parent(dest).await?;
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
