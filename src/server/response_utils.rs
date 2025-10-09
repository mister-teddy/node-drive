use anyhow::Result;
use headers::{
    AccessControlAllowCredentials, AccessControlAllowOrigin, CacheControl, ContentLength,
    ContentType, ETag, HeaderMapExt, LastModified,
};
use http_body_util::combinators::BoxBody;
use hyper::{
    body::Bytes,
    header::{HeaderValue, CONTENT_DISPOSITION},
    StatusCode,
};
use std::fs::Metadata;
use std::path::Path;
use std::time::SystemTime;
use tokio::fs;
use tokio::io::AsyncReadExt;

use crate::http_utils::body_full;
use crate::utils::encode_uri;

pub type Response = hyper::Response<BoxBody<Bytes, anyhow::Error>>;

pub const BUF_SIZE: usize = 65536;
pub const EDITABLE_TEXT_MAX_SIZE: u64 = 4194304; // 4M
pub const RESUMABLE_UPLOAD_MIN_SIZE: u64 = 20971520; // 20M
pub const INDEX_NAME: &str = "index.html";
pub const MAX_SUBPATHS_COUNT: u64 = 1000;

pub fn add_cors(res: &mut Response) {
    res.headers_mut()
        .typed_insert(AccessControlAllowOrigin::ANY);
    res.headers_mut()
        .typed_insert(AccessControlAllowCredentials);
    res.headers_mut().insert(
        "Access-Control-Allow-Methods",
        HeaderValue::from_static("*"),
    );
    res.headers_mut().insert(
        "Access-Control-Allow-Headers",
        HeaderValue::from_static("Authorization,*"),
    );
    res.headers_mut().insert(
        "Access-Control-Expose-Headers",
        HeaderValue::from_static("Authorization,*"),
    );
}

pub fn res_multistatus(res: &mut Response, content: &str) {
    *res.status_mut() = StatusCode::MULTI_STATUS;
    res.headers_mut().insert(
        "content-type",
        HeaderValue::from_static("application/xml; charset=utf-8"),
    );
    *res.body_mut() = body_full(format!(
        r#"<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:">
{content}
</D:multistatus>"#,
    ));
}

pub fn status_forbid(res: &mut Response) {
    *res.status_mut() = StatusCode::FORBIDDEN;
    *res.body_mut() = body_full("Forbidden");
}

pub fn status_not_found(res: &mut Response) {
    *res.status_mut() = StatusCode::NOT_FOUND;
    *res.body_mut() = body_full("Not Found");
}

pub fn status_no_content(res: &mut Response) {
    *res.status_mut() = StatusCode::NO_CONTENT;
}

pub fn status_bad_request(res: &mut Response, body: &str) {
    *res.status_mut() = StatusCode::BAD_REQUEST;
    if !body.is_empty() {
        *res.body_mut() = body_full(body.to_string());
    }
}

pub fn set_content_disposition(res: &mut Response, inline: bool, filename: &str) -> Result<()> {
    let kind = if inline { "inline" } else { "attachment" };
    let filename: String = filename
        .chars()
        .map(|ch| {
            if ch.is_ascii_control() && ch != '\t' {
                ' '
            } else {
                ch
            }
        })
        .collect();
    let value = if filename.is_ascii() {
        HeaderValue::from_str(&format!("{kind}; filename=\"{filename}\"",))?
    } else {
        HeaderValue::from_str(&format!(
            "{kind}; filename=\"{}\"; filename*=UTF-8''{}",
            filename,
            encode_uri(&filename),
        ))?
    };
    res.headers_mut().insert(CONTENT_DISPOSITION, value);
    Ok(())
}

pub fn set_webdav_headers(res: &mut Response) {
    res.headers_mut().insert(
        "Allow",
        HeaderValue::from_static(
            "GET,HEAD,PUT,OPTIONS,DELETE,PATCH,PROPFIND,COPY,MOVE,CHECKAUTH,LOGOUT",
        ),
    );
    res.headers_mut()
        .insert("DAV", HeaderValue::from_static("1, 2, 3"));
}

pub fn set_json_response(res: &mut Response, content: String) {
    res.headers_mut()
        .typed_insert(ContentType::from(mime_guess::mime::APPLICATION_JSON));
    res.headers_mut()
        .typed_insert(ContentLength(content.len() as u64));
    *res.body_mut() = body_full(content);
}

pub fn set_html_response(res: &mut Response, content: String, no_cache: bool) {
    res.headers_mut()
        .typed_insert(ContentType::from(mime_guess::mime::TEXT_HTML_UTF_8));
    res.headers_mut()
        .typed_insert(ContentLength(content.len() as u64));
    if no_cache {
        res.headers_mut()
            .typed_insert(CacheControl::new().with_no_cache());
    }
    res.headers_mut().insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    *res.body_mut() = body_full(content);
}

pub fn to_timestamp(time: &SystemTime) -> u64 {
    time.duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn normalize_path<P: AsRef<Path>>(path: P) -> String {
    let path = path.as_ref().to_str().unwrap_or_default();
    if cfg!(windows) {
        path.replace('\\', "/")
    } else {
        path.to_string()
    }
}

pub fn extract_cache_headers(meta: &Metadata) -> Option<(ETag, LastModified)> {
    let mtime = meta.modified().ok().or_else(|| meta.created().ok())?;
    let timestamp = to_timestamp(&mtime);
    let size = meta.len();
    let etag = format!(r#""{timestamp}-{size}""#).parse::<ETag>().ok()?;
    let last_modified = LastModified::from(mtime);
    Some((etag, last_modified))
}

pub async fn get_content_type(path: &Path) -> Result<String> {
    let mut buffer: Vec<u8> = vec![];
    fs::File::open(path)
        .await?
        .take(1024)
        .read_to_end(&mut buffer)
        .await?;
    let mime = mime_guess::from_path(path).first();
    let is_text = content_inspector::inspect(&buffer).is_text();
    let content_type = if is_text {
        let mut detector = chardetng::EncodingDetector::new();
        detector.feed(&buffer, buffer.len() < 1024);
        let (enc, confident) = detector.guess_assess(None, true);
        let charset = if confident {
            format!("; charset={}", enc.name())
        } else {
            "".into()
        };
        match mime {
            Some(m) => format!("{m}{charset}"),
            None => format!("text/plain{charset}"),
        }
    } else {
        match mime {
            Some(m) => m.to_string(),
            None => "application/octet-stream".into(),
        }
    };
    Ok(content_type)
}
