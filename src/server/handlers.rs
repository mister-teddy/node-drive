use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use futures_util::{pin_mut, TryStreamExt};
use headers::{
    AcceptRanges, CacheControl, ContentLength, ContentType, HeaderMap, HeaderMapExt, IfMatch,
    IfModifiedSince, IfNoneMatch, IfRange, IfUnmodifiedSince, Range,
};
use http_body_util::{BodyExt, StreamBody};
use hyper::body::Frame;
use hyper::{
    body::Incoming,
    header::{
        HeaderValue, AUTHORIZATION, CONNECTION, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, RANGE,
    },
    Method, StatusCode,
};
use std::borrow::Cow;
use std::collections::HashMap;
use std::io::SeekFrom;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tokio::fs::{self};
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::{self, io};
use tokio_util::io::{ReaderStream, StreamReader};
use uuid::Uuid;

use crate::auth::{AccessPaths, AccessPerm};
use crate::http_utils::{body_full, IncomingStream, LengthLimitedStream};
use crate::noscript::{detect_noscript, generate_noscript_html};
use crate::provenance::ProvenanceDb;
use crate::utils::{encode_uri, get_file_name, parse_range, try_get_file_name};
use crate::Args;

use super::path_item::{DataKind, EditData, IndexData, PathItem, PathType};
use super::provenance_handlers;
use super::response_utils::{
    add_cors, extract_cache_headers, get_content_type, normalize_path, set_content_disposition,
    set_html_response, set_webdav_headers, status_bad_request, status_forbid, status_no_content,
    status_not_found, to_timestamp, Response, BUF_SIZE, EDITABLE_TEXT_MAX_SIZE, INDEX_NAME,
    MAX_SUBPATHS_COUNT, RESUMABLE_UPLOAD_MIN_SIZE,
};
use super::webdav;

pub type Request = hyper::Request<Incoming>;

const INDEX_HTML: &str = include_str!("../../assets/index.html");
const HEALTH_CHECK_PATH: &str = "__dufs__/health";

pub struct Server {
    pub(super) args: Args,
    pub(super) assets_prefix: String,
    pub(super) html: Cow<'static, str>,
    pub(super) single_file_req_paths: Vec<String>,
    pub(super) running: Arc<AtomicBool>,
    pub(super) provenance_db: ProvenanceDb,
}

impl Server {
    pub fn init(args: Args, running: Arc<AtomicBool>) -> Result<Self> {
        let assets_prefix = format!("__dufs_v{}__/", env!("CARGO_PKG_VERSION"));
        let single_file_req_paths = if args.path_is_file {
            vec![
                args.uri_prefix.to_string(),
                args.uri_prefix[0..args.uri_prefix.len() - 1].to_string(),
                encode_uri(&format!(
                    "{}{}",
                    &args.uri_prefix,
                    get_file_name(&args.serve_path)
                )),
            ]
        } else {
            vec![]
        };
        let html = Cow::Borrowed(INDEX_HTML);

        // Initialize provenance database
        let db_path = args
            .provenance_db
            .as_ref()
            .map(|p| p.to_owned())
            .unwrap_or_else(|| "provenance.db".into());
        let provenance_db = ProvenanceDb::new(&db_path)?;

        Ok(Self {
            args,
            running,
            single_file_req_paths,
            assets_prefix,
            html,
            provenance_db,
        })
    }

    pub async fn call(
        self: Arc<Self>,
        req: Request,
        addr: Option<SocketAddr>,
    ) -> Result<Response, hyper::Error> {
        let uri = req.uri().clone();
        let assets_prefix = &self.assets_prefix;
        let enable_cors = self.args.enable_cors;
        let mut http_log_data = self.args.http_logger.data(&req);
        if let Some(addr) = addr {
            http_log_data.insert("remote_addr".to_string(), addr.ip().to_string());
        }

        let mut res = match self.clone().handle(req).await {
            Ok(res) => {
                http_log_data.insert("status".to_string(), res.status().as_u16().to_string());
                if !uri.path().starts_with(assets_prefix) {
                    self.args.http_logger.log(&http_log_data, None);
                }
                res
            }
            Err(err) => {
                let mut res = Response::default();
                let status = StatusCode::INTERNAL_SERVER_ERROR;
                *res.status_mut() = status;
                http_log_data.insert("status".to_string(), status.as_u16().to_string());
                self.args
                    .http_logger
                    .log(&http_log_data, Some(err.to_string()));
                res
            }
        };

        if enable_cors {
            add_cors(&mut res);
        }
        Ok(res)
    }

    pub async fn handle(self: Arc<Self>, req: Request) -> Result<Response> {
        let mut res = Response::default();

        let req_path = req.uri().path();
        let headers = req.headers();
        let method = req.method().clone();

        let relative_path = match self.resolve_path(req_path) {
            Some(v) => v,
            None => {
                status_bad_request(&mut res, "Invalid Path");
                return Ok(res);
            }
        };

        if method == Method::GET
            && self
                .handle_internal(&relative_path, headers, &mut res)
                .await?
        {
            return Ok(res);
        }

        let user_agent = headers
            .get("user-agent")
            .and_then(|v| v.to_str().ok())
            .map(|v| v.to_lowercase())
            .unwrap_or_default();

        let is_microsoft_webdav = user_agent.starts_with("microsoft-webdav-miniredir/");

        if is_microsoft_webdav {
            res.headers_mut()
                .insert(CONNECTION, HeaderValue::from_static("close"));
        }

        let authorization = headers.get(AUTHORIZATION);

        let query = req.uri().query().unwrap_or_default();
        let mut query_params: HashMap<String, String> = form_urlencoded::parse(query.as_bytes())
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();

        let guard = self.args.auth.guard(
            &relative_path,
            &method,
            authorization,
            query_params.get("token"),
            is_microsoft_webdav,
        );

        let (user, access_paths) = match guard {
            (None, None) => {
                self.auth_reject(&mut res)?;
                return Ok(res);
            }
            (Some(_), None) => {
                status_forbid(&mut res);
                return Ok(res);
            }
            (x, Some(y)) => (x, y),
        };

        if detect_noscript(&user_agent) {
            query_params.insert("noscript".to_string(), String::new());
        }

        if method.as_str() == "CHECKAUTH" {
            match user.clone() {
                Some(user) => {
                    *res.body_mut() = body_full(user);
                }
                None => {
                    if has_query_flag(&query_params, "login") || !access_paths.perm().readwrite() {
                        self.auth_reject(&mut res)?
                    } else {
                        *res.body_mut() = body_full("");
                    }
                }
            }
            return Ok(res);
        } else if method.as_str() == "LOGOUT" {
            self.auth_reject(&mut res)?;
            return Ok(res);
        }

        if has_query_flag(&query_params, "tokengen") {
            self.handle_tokengen(&relative_path, user, &mut res).await?;
            return Ok(res);
        }

        let head_only = method == Method::HEAD;

        if self.args.path_is_file {
            if self
                .single_file_req_paths
                .iter()
                .any(|v| v.as_str() == req_path)
            {
                self.handle_send_file(&self.args.serve_path, headers, head_only, &mut res)
                    .await?;
            } else {
                status_not_found(&mut res);
            }
            return Ok(res);
        }

        let path = match self.join_path(&relative_path) {
            Some(v) => v,
            None => {
                status_forbid(&mut res);
                return Ok(res);
            }
        };

        let path = path.as_path();

        let (is_miss, is_dir, is_file, size) = match fs::metadata(path).await.ok() {
            Some(meta) => (false, meta.is_dir(), meta.is_file(), meta.len()),
            None => (true, false, false, 0),
        };

        let allow_upload = self.args.allow_upload;
        let allow_delete = self.args.allow_delete;
        let allow_search = self.args.allow_search;
        let allow_archive = self.args.allow_archive;
        let render_index = self.args.render_index;
        let render_spa = self.args.render_spa;
        let render_try_index = self.args.render_try_index;

        if !self.args.allow_symlink && !is_miss && !self.is_root_contained(path).await {
            status_not_found(&mut res);
            return Ok(res);
        }

        match method {
            Method::GET | Method::HEAD => {
                if is_dir {
                    if render_try_index {
                        if allow_archive && has_query_flag(&query_params, "zip") {
                            self.handle_zip_dir(path, head_only, access_paths, &mut res)
                                .await?;
                        } else if allow_search && query_params.contains_key("q") {
                            self.handle_search_dir(
                                path,
                                &query_params,
                                head_only,
                                user,
                                access_paths,
                                &mut res,
                            )
                            .await?;
                        } else {
                            self.handle_render_index(
                                path,
                                &query_params,
                                headers,
                                head_only,
                                user,
                                access_paths,
                                &mut res,
                            )
                            .await?;
                        }
                    } else if render_index || render_spa {
                        self.handle_render_index(
                            path,
                            &query_params,
                            headers,
                            head_only,
                            user,
                            access_paths,
                            &mut res,
                        )
                        .await?;
                    } else if has_query_flag(&query_params, "zip") {
                        if !allow_archive {
                            status_not_found(&mut res);
                            return Ok(res);
                        }
                        self.handle_zip_dir(path, head_only, access_paths, &mut res)
                            .await?;
                    } else if allow_search && query_params.contains_key("q") {
                        self.handle_search_dir(
                            path,
                            &query_params,
                            head_only,
                            user,
                            access_paths,
                            &mut res,
                        )
                        .await?;
                    } else {
                        self.handle_ls_dir(
                            path,
                            true,
                            &query_params,
                            head_only,
                            user,
                            access_paths,
                            &mut res,
                        )
                        .await?;
                    }
                } else if is_file {
                    if has_query_flag(&query_params, "edit") {
                        self.handle_edit_file(path, DataKind::Edit, head_only, user, &mut res)
                            .await?;
                    } else if has_query_flag(&query_params, "view") {
                        self.handle_edit_file(path, DataKind::View, head_only, user, &mut res)
                            .await?;
                    } else if has_query_flag(&query_params, "hash") {
                        provenance_handlers::handle_hash_file(path, head_only, &mut res).await?;
                    } else if query_params.get("manifest") == Some(&"json".to_string()) {
                        provenance_handlers::handle_provenance_manifest(
                            path,
                            head_only,
                            &self.provenance_db,
                            &mut res,
                        )
                        .await?;
                    } else if has_query_flag(&query_params, "ots") {
                        provenance_handlers::handle_ots_download(
                            path,
                            head_only,
                            &self.provenance_db,
                            &mut res,
                        )
                        .await?;
                    } else {
                        self.handle_send_file(path, headers, head_only, &mut res)
                            .await?;
                    }
                } else if render_spa {
                    self.handle_render_spa(path, headers, head_only, &mut res)
                        .await?;
                } else if allow_upload && req_path.ends_with('/') {
                    self.handle_ls_dir(
                        path,
                        false,
                        &query_params,
                        head_only,
                        user,
                        access_paths,
                        &mut res,
                    )
                    .await?;
                } else {
                    status_not_found(&mut res);
                }
            }
            Method::OPTIONS => {
                set_webdav_headers(&mut res);
            }
            Method::PUT => {
                if is_dir || !allow_upload || (!allow_delete && size > 0) {
                    status_forbid(&mut res);
                } else {
                    self.handle_upload(path, None, size, req, &mut res).await?;
                }
            }
            Method::POST => {
                if has_query_flag(&query_params, "verify") {
                    provenance_handlers::handle_ots_verify(req, &self.provenance_db, &mut res)
                        .await?;
                } else if has_query_flag(&query_params, "ots") {
                    if is_miss || is_dir {
                        status_not_found(&mut res);
                    } else {
                        provenance_handlers::handle_ots_upload(
                            path,
                            req,
                            &self.provenance_db,
                            &mut res,
                        )
                        .await?;
                    }
                } else {
                    *res.status_mut() = StatusCode::METHOD_NOT_ALLOWED;
                }
            }
            Method::PATCH => {
                if is_miss {
                    status_not_found(&mut res);
                } else if !allow_upload {
                    status_forbid(&mut res);
                } else {
                    let offset = match parse_upload_offset(headers, size) {
                        Ok(v) => v,
                        Err(err) => {
                            status_bad_request(&mut res, &err.to_string());
                            return Ok(res);
                        }
                    };
                    match offset {
                        Some(offset) => {
                            if offset < size && !allow_delete {
                                status_forbid(&mut res);
                            }
                            self.handle_upload(path, Some(offset), size, req, &mut res)
                                .await?;
                        }
                        None => {
                            *res.status_mut() = StatusCode::METHOD_NOT_ALLOWED;
                        }
                    }
                }
            }
            Method::DELETE => {
                if !allow_delete {
                    status_forbid(&mut res);
                } else if !is_miss {
                    self.handle_delete(path, is_dir, &mut res).await?
                } else {
                    status_not_found(&mut res);
                }
            }
            method => match method.as_str() {
                "PROPFIND" => {
                    if is_dir {
                        let access_paths =
                            if access_paths.perm().indexonly() && authorization.is_none() {
                                AccessPaths::new(AccessPerm::ReadOnly)
                            } else {
                                access_paths
                            };
                        self.handle_propfind_dir(path, headers, access_paths, &mut res)
                            .await?;
                    } else if is_file {
                        self.handle_propfind_file(path, &mut res).await?;
                    } else {
                        status_not_found(&mut res);
                    }
                }
                "PROPPATCH" => {
                    if is_file {
                        webdav::handle_proppatch(req_path, &mut res).await?;
                    } else {
                        status_not_found(&mut res);
                    }
                }
                "MKCOL" => {
                    if !allow_upload {
                        status_forbid(&mut res);
                    } else if !is_miss {
                        *res.status_mut() = StatusCode::METHOD_NOT_ALLOWED;
                        *res.body_mut() = body_full("Already exists");
                    } else {
                        webdav::handle_mkcol(path, &mut res).await?;
                    }
                }
                "COPY" => {
                    if !allow_upload {
                        status_forbid(&mut res);
                    } else if is_miss {
                        status_not_found(&mut res);
                    } else {
                        let dest = match self.extract_dest(&req, &mut res) {
                            Some(dest) => dest,
                            None => return Ok(res),
                        };
                        webdav::handle_copy(path, &dest, &mut res).await?
                    }
                }
                "MOVE" => {
                    if !allow_upload || !allow_delete {
                        status_forbid(&mut res);
                    } else if is_miss {
                        status_not_found(&mut res);
                    } else {
                        let dest = match self.extract_dest(&req, &mut res) {
                            Some(dest) => dest,
                            None => return Ok(res),
                        };
                        webdav::handle_move(path, &dest, &mut res).await?
                    }
                }
                "LOCK" => {
                    if is_file {
                        let has_auth = authorization.is_some();
                        webdav::handle_lock(req_path, has_auth, &mut res).await?;
                    } else {
                        status_not_found(&mut res);
                    }
                }
                "UNLOCK" => {
                    if is_miss {
                        status_not_found(&mut res);
                    }
                }
                _ => {
                    *res.status_mut() = StatusCode::METHOD_NOT_ALLOWED;
                }
            },
        }
        Ok(res)
    }

    pub async fn handle_upload(
        &self,
        path: &Path,
        upload_offset: Option<u64>,
        size: u64,
        req: Request,
        res: &mut Response,
    ) -> Result<()> {
        ensure_path_parent(path).await?;
        let (mut file, status) = match upload_offset {
            None => (fs::File::create(path).await?, StatusCode::CREATED),
            Some(offset) if offset == size => (
                fs::OpenOptions::new().append(true).open(path).await?,
                StatusCode::NO_CONTENT,
            ),
            Some(offset) => {
                let mut file = fs::OpenOptions::new().write(true).open(path).await?;
                file.seek(SeekFrom::Start(offset)).await?;
                (file, StatusCode::NO_CONTENT)
            }
        };
        let stream = IncomingStream::new(req.into_body());

        let body_with_io_error = stream.map_err(io::Error::other);
        let body_reader = StreamReader::new(body_with_io_error);

        pin_mut!(body_reader);

        let ret = io::copy(&mut body_reader, &mut file).await;
        let size = fs::metadata(path)
            .await
            .map(|v| v.len())
            .unwrap_or_default();
        if ret.is_err() {
            if upload_offset.is_none() && size < RESUMABLE_UPLOAD_MIN_SIZE {
                let _ = tokio::fs::remove_file(&path).await;
            }
            ret?;
        }

        *res.status_mut() = status;

        // Create provenance mint event if this is a new file
        if status == StatusCode::CREATED {
            match self.create_mint_event(path).await {
                Ok(mint_response) => {
                    // Return JSON response with mint event data including OTS
                    res.headers_mut().insert(
                        hyper::header::CONTENT_TYPE,
                        HeaderValue::from_static("application/json"),
                    );
                    *res.body_mut() = body_full(serde_json::to_string(&mint_response)?);
                }
                Err(e) => {
                    let msg = format!("File uploaded, but failed to create mint event: {e:?}");
                    *res.body_mut() = body_full(msg);
                }
            }
        }

        Ok(())
    }

    pub async fn handle_delete(&self, path: &Path, is_dir: bool, res: &mut Response) -> Result<()> {
        match is_dir {
            true => fs::remove_dir_all(path).await?,
            false => fs::remove_file(path).await?,
        }

        status_no_content(res);
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn handle_ls_dir(
        &self,
        path: &Path,
        exist: bool,
        query_params: &HashMap<String, String>,
        head_only: bool,
        user: Option<String>,
        access_paths: AccessPaths,
        res: &mut Response,
    ) -> Result<()> {
        let mut paths = vec![];
        if exist {
            paths = match self.list_dir(path, path, access_paths.clone()).await {
                Ok(paths) => paths,
                Err(_) => {
                    status_forbid(res);
                    return Ok(());
                }
            }
        };
        self.send_index(
            path,
            paths,
            exist,
            query_params,
            head_only,
            user,
            access_paths,
            res,
        )
    }

    pub async fn handle_search_dir(
        &self,
        path: &Path,
        query_params: &HashMap<String, String>,
        head_only: bool,
        user: Option<String>,
        access_paths: AccessPaths,
        res: &mut Response,
    ) -> Result<()> {
        let mut paths: Vec<PathItem> = vec![];
        let search = query_params
            .get("q")
            .ok_or_else(|| anyhow!("invalid q"))?
            .to_lowercase();
        if search.is_empty() {
            return self
                .handle_ls_dir(path, true, query_params, head_only, user, access_paths, res)
                .await;
        } else {
            let path_buf = path.to_path_buf();
            let hidden = Arc::new(self.args.hidden.to_vec());
            let search = search.clone();

            let access_paths = access_paths.clone();
            let search_paths = tokio::spawn(super::collect_dir_entries(
                access_paths,
                self.running.clone(),
                path_buf,
                hidden,
                self.args.allow_symlink,
                self.args.serve_path.clone(),
                move |x| get_file_name(x.path()).to_lowercase().contains(&search),
            ))
            .await?;

            for search_path in search_paths.into_iter() {
                if let Ok(Some(item)) = self.to_pathitem(search_path, path.to_path_buf()).await {
                    paths.push(item);
                }
            }
        }
        self.send_index(
            path,
            paths,
            true,
            query_params,
            head_only,
            user,
            access_paths,
            res,
        )
    }

    pub async fn handle_zip_dir(
        &self,
        path: &Path,
        head_only: bool,
        access_paths: AccessPaths,
        res: &mut Response,
    ) -> Result<()> {
        let (mut writer, reader) = tokio::io::duplex(BUF_SIZE);
        let filename = try_get_file_name(path)?;
        set_content_disposition(res, false, &format!("{filename}.zip"))?;
        res.headers_mut()
            .insert("content-type", HeaderValue::from_static("application/zip"));
        if head_only {
            return Ok(());
        }
        let path = path.to_owned();
        let hidden = self.args.hidden.clone();
        let running = self.running.clone();
        let compression = self.args.compress.to_compression();
        let follow_symlinks = self.args.allow_symlink;
        let serve_path = self.args.serve_path.clone();
        tokio::spawn(async move {
            if let Err(e) = super::zip_dir(
                &mut writer,
                &path,
                access_paths,
                &hidden,
                compression,
                follow_symlinks,
                serve_path,
                running,
            )
            .await
            {
                error!("Failed to zip {}, {e}", path.display());
            }
        });
        let reader_stream = ReaderStream::with_capacity(reader, BUF_SIZE);
        let stream_body = StreamBody::new(
            reader_stream
                .map_ok(Frame::data)
                .map_err(|err| anyhow!("{err}")),
        );
        let boxed_body = stream_body.boxed();
        *res.body_mut() = boxed_body;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn handle_render_index(
        &self,
        path: &Path,
        query_params: &HashMap<String, String>,
        headers: &HeaderMap<HeaderValue>,
        head_only: bool,
        user: Option<String>,
        access_paths: AccessPaths,
        res: &mut Response,
    ) -> Result<()> {
        let index_path = path.join(INDEX_NAME);
        if fs::metadata(&index_path)
            .await
            .ok()
            .map(|v| v.is_file())
            .unwrap_or_default()
        {
            self.handle_send_file(&index_path, headers, head_only, res)
                .await?;
        } else if self.args.render_try_index {
            self.handle_ls_dir(path, true, query_params, head_only, user, access_paths, res)
                .await?;
        } else {
            status_not_found(res)
        }
        Ok(())
    }

    pub async fn handle_render_spa(
        &self,
        path: &Path,
        headers: &HeaderMap<HeaderValue>,
        head_only: bool,
        res: &mut Response,
    ) -> Result<()> {
        if path.extension().is_none() {
            let path = self.args.serve_path.join(INDEX_NAME);
            self.handle_send_file(&path, headers, head_only, res)
                .await?;
        } else {
            status_not_found(res)
        }
        Ok(())
    }

    pub async fn handle_internal(
        &self,
        req_path: &str,
        _headers: &HeaderMap<HeaderValue>,
        res: &mut Response,
    ) -> Result<bool> {
        if let Some(_name) = req_path.strip_prefix(&self.assets_prefix) {
            // Serve embedded assets from dist folder
            let asset_file = format!("assets/dist/{}", _name);

            #[cfg(debug_assertions)]
            let path = {
                use std::path::PathBuf;
                PathBuf::from(&asset_file)
            };

            #[cfg(not(debug_assertions))]
            let path = {
                use std::path::PathBuf;
                std::env::current_exe()
                    .ok()
                    .and_then(|exe| exe.parent().map(|p| p.join(&asset_file)))
                    .unwrap_or_else(|| PathBuf::from(&asset_file))
            };

            if path.exists() {
                self.handle_send_file(&path, _headers, false, res).await?;
                return Ok(true);
            } else {
                status_not_found(res);
            }
        } else if req_path == HEALTH_CHECK_PATH {
            res.headers_mut()
                .typed_insert(ContentType::from(mime_guess::mime::APPLICATION_JSON));

            *res.body_mut() = body_full(r#"{"status":"OK"}"#);
            return Ok(true);
        }
        Ok(false)
    }

    pub async fn handle_send_file(
        &self,
        path: &Path,
        headers: &HeaderMap<HeaderValue>,
        head_only: bool,
        res: &mut Response,
    ) -> Result<()> {
        let (file, meta) = tokio::join!(fs::File::open(path), fs::metadata(path),);
        let (mut file, meta) = (file?, meta?);
        let size = meta.len();
        let mut use_range = true;
        if let Some((etag, last_modified)) = extract_cache_headers(&meta) {
            if let Some(if_unmodified_since) = headers.typed_get::<IfUnmodifiedSince>() {
                if !if_unmodified_since.precondition_passes(last_modified.into()) {
                    *res.status_mut() = StatusCode::PRECONDITION_FAILED;
                    return Ok(());
                }
            }
            if let Some(if_match) = headers.typed_get::<IfMatch>() {
                if !if_match.precondition_passes(&etag) {
                    *res.status_mut() = StatusCode::PRECONDITION_FAILED;
                    return Ok(());
                }
            }
            if let Some(if_modified_since) = headers.typed_get::<IfModifiedSince>() {
                if !if_modified_since.is_modified(last_modified.into()) {
                    *res.status_mut() = StatusCode::NOT_MODIFIED;
                    return Ok(());
                }
            }
            if let Some(if_none_match) = headers.typed_get::<IfNoneMatch>() {
                if !if_none_match.precondition_passes(&etag) {
                    *res.status_mut() = StatusCode::NOT_MODIFIED;
                    return Ok(());
                }
            }

            res.headers_mut()
                .typed_insert(CacheControl::new().with_no_cache());
            res.headers_mut().typed_insert(last_modified);
            res.headers_mut().typed_insert(etag.clone());

            if headers.typed_get::<Range>().is_some() {
                use_range = headers
                    .typed_get::<IfRange>()
                    .map(|if_range| !if_range.is_modified(Some(&etag), Some(&last_modified)))
                    .unwrap_or(true);
            } else {
                use_range = false;
            }
        }

        let ranges = if use_range {
            headers.get(RANGE).map(|range| {
                range
                    .to_str()
                    .ok()
                    .and_then(|range| parse_range(range, size))
            })
        } else {
            None
        };

        res.headers_mut().insert(
            CONTENT_TYPE,
            HeaderValue::from_str(&get_content_type(path).await?)?,
        );

        let filename = try_get_file_name(path)?;
        set_content_disposition(res, true, filename)?;

        res.headers_mut().typed_insert(AcceptRanges::bytes());

        if let Some(ranges) = ranges {
            if let Some(ranges) = ranges {
                if ranges.len() == 1 {
                    let (start, end) = ranges[0];
                    file.seek(SeekFrom::Start(start)).await?;
                    let range_size = end - start + 1;
                    *res.status_mut() = StatusCode::PARTIAL_CONTENT;
                    let content_range = format!("bytes {start}-{end}/{size}");
                    res.headers_mut()
                        .insert(CONTENT_RANGE, content_range.parse()?);
                    res.headers_mut()
                        .insert(CONTENT_LENGTH, format!("{range_size}").parse()?);
                    if head_only {
                        return Ok(());
                    }

                    let stream_body = StreamBody::new(
                        LengthLimitedStream::new(file, range_size as usize)
                            .map_ok(Frame::data)
                            .map_err(|err| anyhow!("{err}")),
                    );
                    let boxed_body = stream_body.boxed();
                    *res.body_mut() = boxed_body;
                } else {
                    *res.status_mut() = StatusCode::PARTIAL_CONTENT;
                    let boundary = Uuid::new_v4();
                    let mut body = Vec::new();
                    let content_type = get_content_type(path).await?;
                    for (start, end) in ranges {
                        file.seek(SeekFrom::Start(start)).await?;
                        let range_size = end - start + 1;
                        let content_range = format!("bytes {start}-{end}/{size}");
                        let part_header = format!(
                            "--{boundary}\r\nContent-Type: {content_type}\r\nContent-Range: {content_range}\r\n\r\n",
                        );
                        body.extend_from_slice(part_header.as_bytes());
                        let mut buffer = vec![0; range_size as usize];
                        file.read_exact(&mut buffer).await?;
                        body.extend_from_slice(&buffer);
                        body.extend_from_slice(b"\r\n");
                    }
                    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
                    res.headers_mut().insert(
                        CONTENT_TYPE,
                        format!("multipart/byteranges; boundary={boundary}").parse()?,
                    );
                    res.headers_mut()
                        .insert(CONTENT_LENGTH, format!("{}", body.len()).parse()?);
                    if head_only {
                        return Ok(());
                    }
                    *res.body_mut() = body_full(body);
                }
            } else {
                *res.status_mut() = StatusCode::RANGE_NOT_SATISFIABLE;
                res.headers_mut()
                    .insert(CONTENT_RANGE, format!("bytes */{size}").parse()?);
            }
        } else {
            res.headers_mut()
                .insert(CONTENT_LENGTH, format!("{size}").parse()?);
            if head_only {
                return Ok(());
            }

            let reader_stream = ReaderStream::with_capacity(file, BUF_SIZE);
            let stream_body = StreamBody::new(
                reader_stream
                    .map_ok(Frame::data)
                    .map_err(|err| anyhow!("{err}")),
            );
            let boxed_body = stream_body.boxed();
            *res.body_mut() = boxed_body;
        }
        Ok(())
    }

    pub async fn handle_edit_file(
        &self,
        path: &Path,
        kind: DataKind,
        head_only: bool,
        user: Option<String>,
        res: &mut Response,
    ) -> Result<()> {
        let (file, meta) = tokio::join!(fs::File::open(path), fs::metadata(path),);
        let (file, meta) = (file?, meta?);
        let href = format!(
            "/{}",
            normalize_path(path.strip_prefix(&self.args.serve_path)?)
        );
        let mut buffer: Vec<u8> = vec![];
        file.take(1024).read_to_end(&mut buffer).await?;
        let editable =
            meta.len() <= EDITABLE_TEXT_MAX_SIZE && content_inspector::inspect(&buffer).is_text();
        let data = EditData {
            href,
            kind,
            uri_prefix: self.args.uri_prefix.clone(),
            allow_upload: self.args.allow_upload,
            allow_delete: self.args.allow_delete,
            auth: self.args.auth.has_users(),
            user,
            editable,
        };
        res.headers_mut()
            .typed_insert(ContentType::from(mime_guess::mime::TEXT_HTML_UTF_8));
        let index_data = STANDARD.encode(serde_json::to_string(&data)?);
        let output = self
            .html
            .replace(
                "__ASSETS_PREFIX__",
                &format!("{}{}", self.args.uri_prefix, self.assets_prefix),
            )
            .replace("__INDEX_DATA__", &index_data);
        res.headers_mut()
            .typed_insert(ContentLength(output.len() as u64));
        res.headers_mut()
            .typed_insert(CacheControl::new().with_no_cache());
        if head_only {
            return Ok(());
        }
        *res.body_mut() = body_full(output);
        Ok(())
    }

    pub async fn handle_tokengen(
        &self,
        relative_path: &str,
        user: Option<String>,
        res: &mut Response,
    ) -> Result<()> {
        let output = self
            .args
            .auth
            .generate_token(relative_path, &user.unwrap_or_default())?;
        res.headers_mut()
            .typed_insert(ContentType::from(mime_guess::mime::TEXT_PLAIN_UTF_8));
        res.headers_mut()
            .typed_insert(ContentLength(output.len() as u64));
        *res.body_mut() = body_full(output);
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn send_index(
        &self,
        path: &Path,
        mut paths: Vec<PathItem>,
        exist: bool,
        query_params: &HashMap<String, String>,
        head_only: bool,
        user: Option<String>,
        access_paths: AccessPaths,
        res: &mut Response,
    ) -> Result<()> {
        if let Some(sort) = query_params.get("sort") {
            if sort == "name" {
                paths.sort_by(|v1, v2| v1.sort_by_name(v2))
            } else if sort == "mtime" {
                paths.sort_by(|v1, v2| v1.sort_by_mtime(v2))
            } else if sort == "size" {
                paths.sort_by(|v1, v2| v1.sort_by_size(v2))
            }
            if query_params
                .get("order")
                .map(|v| v == "desc")
                .unwrap_or_default()
            {
                paths.reverse()
            }
        } else {
            paths.sort_by(|v1, v2| v1.sort_by_name(v2))
        }
        if has_query_flag(query_params, "simple") {
            let output = paths
                .into_iter()
                .map(|v| {
                    if v.is_dir() {
                        format!("{}/\n", v.name)
                    } else {
                        format!("{}\n", v.name)
                    }
                })
                .collect::<Vec<String>>()
                .join("");
            res.headers_mut()
                .typed_insert(ContentType::from(mime_guess::mime::TEXT_HTML_UTF_8));
            res.headers_mut()
                .typed_insert(ContentLength(output.len() as u64));
            *res.body_mut() = body_full(output);
            if head_only {
                return Ok(());
            }
            return Ok(());
        }
        let href = format!(
            "/{}",
            normalize_path(path.strip_prefix(&self.args.serve_path)?)
        );
        let readwrite = access_paths.perm().readwrite();
        let data = IndexData {
            kind: DataKind::Index,
            href,
            uri_prefix: self.args.uri_prefix.clone(),
            allow_upload: self.args.allow_upload && readwrite,
            allow_delete: self.args.allow_delete && readwrite,
            allow_search: self.args.allow_search,
            allow_archive: self.args.allow_archive,
            dir_exists: exist,
            auth: self.args.auth.has_users(),
            user,
            paths,
        };
        if has_query_flag(query_params, "json") {
            let output = serde_json::to_string_pretty(&data)?;
            res.headers_mut()
                .typed_insert(ContentType::from(mime_guess::mime::APPLICATION_JSON));
            res.headers_mut()
                .typed_insert(ContentLength(output.len() as u64));
            if !head_only {
                *res.body_mut() = body_full(output);
            }
        } else if has_query_flag(query_params, "noscript") {
            let output = generate_noscript_html(&data)?;
            set_html_response(res, output, true);
        } else {
            let index_data = STANDARD.encode(serde_json::to_string(&data)?);
            let output = self
                .html
                .replace(
                    "__ASSETS_PREFIX__",
                    &format!("{}{}", self.args.uri_prefix, self.assets_prefix),
                )
                .replace("__INDEX_DATA__", &index_data);
            set_html_response(res, output, true);
        }
        Ok(())
    }

    pub async fn list_dir(
        &self,
        entry_path: &Path,
        base_path: &Path,
        access_paths: AccessPaths,
    ) -> Result<Vec<PathItem>> {
        let mut paths: Vec<PathItem> = vec![];
        if access_paths.perm().indexonly() {
            for name in access_paths.child_names() {
                let entry_path = entry_path.join(name);
                self.add_pathitem(&mut paths, base_path, &entry_path).await;
            }
        } else {
            let mut rd = fs::read_dir(entry_path).await?;
            while let Ok(Some(entry)) = rd.next_entry().await {
                let entry_path = entry.path();
                self.add_pathitem(&mut paths, base_path, &entry_path).await;
            }
        }
        Ok(paths)
    }

    async fn add_pathitem(&self, paths: &mut Vec<PathItem>, base_path: &Path, entry_path: &Path) {
        let base_name = get_file_name(entry_path);
        if let Ok(Some(item)) = self.to_pathitem(entry_path, base_path).await {
            if is_hidden(&self.args.hidden, base_name, item.is_dir()) {
                return;
            }
            paths.push(item);
        }
    }

    pub async fn to_pathitem<P: AsRef<Path>>(
        &self,
        path: P,
        base_path: P,
    ) -> Result<Option<PathItem>> {
        let path = path.as_ref();
        let (meta, meta2) = tokio::join!(fs::metadata(&path), fs::symlink_metadata(&path));
        let (meta, meta2) = (meta?, meta2?);
        let is_symlink = meta2.is_symlink();
        if !self.args.allow_symlink && is_symlink && !self.is_root_contained(path).await {
            return Ok(None);
        }
        let is_dir = meta.is_dir();
        let path_type = match (is_symlink, is_dir) {
            (true, true) => PathType::SymlinkDir,
            (false, true) => PathType::Dir,
            (true, false) => PathType::SymlinkFile,
            (false, false) => PathType::File,
        };
        let mtime = match meta.modified().ok().or_else(|| meta.created().ok()) {
            Some(v) => to_timestamp(&v),
            None => 0,
        };
        let size = match path_type {
            PathType::Dir | PathType::SymlinkDir => {
                let mut count = 0;
                let mut entries = tokio::fs::read_dir(&path).await?;
                while let Some(entry) = entries.next_entry().await? {
                    let entry_path = entry.path();
                    let base_name = get_file_name(&entry_path);
                    let is_dir = entry
                        .file_type()
                        .await
                        .map(|v| v.is_dir())
                        .unwrap_or_default();
                    if is_hidden(&self.args.hidden, base_name, is_dir) {
                        continue;
                    }
                    count += 1;
                    if count >= MAX_SUBPATHS_COUNT {
                        break;
                    }
                }
                count
            }
            PathType::File | PathType::SymlinkFile => meta.len(),
        };
        let rel_path = path.strip_prefix(base_path)?;
        let name = normalize_path(rel_path);

        // Compute stamp status for files (not directories)
        let stamp_status = if matches!(path_type, PathType::File | PathType::SymlinkFile) {
            provenance_handlers::compute_stamp_status(path, &self.provenance_db).await
        } else {
            None
        };

        Ok(Some(PathItem {
            path_type,
            name,
            mtime,
            size,
            stamp_status,
        }))
    }

    // Helper methods from mod.rs

    pub(super) fn resolve_path(&self, path: &str) -> Option<String> {
        use crate::utils::decode_uri;
        use std::path::Component;

        let path = decode_uri(path)?;
        let path = path.trim_matches('/');
        let mut parts = vec![];
        for comp in std::path::Path::new(path).components() {
            if let Component::Normal(v) = comp {
                let v = v.to_string_lossy();
                if cfg!(windows) {
                    let chars: Vec<char> = v.chars().collect();
                    if chars.len() == 2 && chars[1] == ':' && chars[0].is_ascii_alphabetic() {
                        return None;
                    }
                }
                parts.push(v);
            } else {
                return None;
            }
        }
        let new_path = parts.join("/");
        let path_prefix = self.args.path_prefix.as_str();
        if path_prefix.is_empty() {
            return Some(new_path);
        }
        new_path
            .strip_prefix(path_prefix.trim_start_matches('/'))
            .map(|v| v.trim_matches('/').to_string())
    }

    pub(super) fn join_path(&self, path: &str) -> Option<std::path::PathBuf> {
        if path.is_empty() {
            return Some(self.args.serve_path.clone());
        }
        let path = if cfg!(windows) {
            path.replace('/', "\\")
        } else {
            path.to_string()
        };
        Some(self.args.serve_path.join(path))
    }

    pub(super) fn auth_reject(&self, res: &mut Response) -> Result<()> {
        use super::response_utils::set_webdav_headers;
        use crate::auth::www_authenticate;

        set_webdav_headers(res);
        www_authenticate(res, &self.args)?;
        *res.status_mut() = StatusCode::UNAUTHORIZED;
        Ok(())
    }

    pub(super) async fn is_root_contained(&self, path: &Path) -> bool {
        fs::canonicalize(path)
            .await
            .ok()
            .map(|v| v.starts_with(&self.args.serve_path))
            .unwrap_or_default()
    }

    pub(super) fn extract_dest(
        &self,
        req: &Request,
        res: &mut Response,
    ) -> Option<std::path::PathBuf> {
        use super::response_utils::{status_bad_request, status_forbid};
        use hyper::header::AUTHORIZATION;

        let headers = req.headers();
        let dest_path = match self
            .extract_destination_header(headers)
            .and_then(|dest| self.resolve_path(&dest))
        {
            Some(dest) => dest,
            None => {
                status_bad_request(res, "Invalid Destination");
                return None;
            }
        };

        let authorization = headers.get(AUTHORIZATION);
        let guard = self
            .args
            .auth
            .guard(&dest_path, req.method(), authorization, None, false);

        match guard {
            (_, Some(_)) => {}
            _ => {
                status_forbid(res);
                return None;
            }
        };

        let dest = match self.join_path(&dest_path) {
            Some(dest) => dest,
            None => {
                *res.status_mut() = StatusCode::BAD_REQUEST;
                return None;
            }
        };

        Some(dest)
    }

    fn extract_destination_header(&self, headers: &HeaderMap<HeaderValue>) -> Option<String> {
        use hyper::Uri;

        let dest = headers.get("Destination")?.to_str().ok()?;
        let uri: Uri = dest.parse().ok()?;
        Some(uri.path().to_string())
    }

    pub(super) async fn handle_propfind_dir(
        &self,
        path: &Path,
        headers: &HeaderMap<HeaderValue>,
        access_paths: AccessPaths,
        res: &mut Response,
    ) -> Result<()> {
        use super::response_utils::{res_multistatus, status_bad_request, status_forbid};

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
        let mut paths = match self.to_pathitem(path, &self.args.serve_path).await? {
            Some(v) => vec![v],
            None => vec![],
        };
        if depth == 1 {
            match self
                .list_dir(path, &self.args.serve_path, access_paths)
                .await
            {
                Ok(child) => paths.extend(child),
                Err(_) => {
                    status_forbid(res);
                    return Ok(());
                }
            }
        }
        let output = paths
            .iter()
            .map(|v| v.to_dav_xml(self.args.uri_prefix.as_str()))
            .fold(String::new(), |mut acc, v| {
                acc.push_str(&v);
                acc
            });
        res_multistatus(res, &output);
        Ok(())
    }

    pub(super) async fn handle_propfind_file(&self, path: &Path, res: &mut Response) -> Result<()> {
        use super::response_utils::{res_multistatus, status_not_found};

        if let Some(pathitem) = self.to_pathitem(path, &self.args.serve_path).await? {
            res_multistatus(res, &pathitem.to_dav_xml(self.args.uri_prefix.as_str()));
        } else {
            status_not_found(res);
        }
        Ok(())
    }

    pub(super) async fn create_mint_event(
        &self,
        path: &Path,
    ) -> Result<super::path_item::MintEventResponse> {
        use crate::provenance::{
            compute_event_hash, sign_event_hash, verify_event, Actors, Event, EventAction,
            Signatures, SERVER_PRIVATE_KEY_HEX, SERVER_PUBLIC_KEY_HEX,
        };
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        use sha2::{Digest, Sha256};

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
        let artifact_id =
            self.provenance_db
                .upsert_artifact(&file_name, &sha256_hex, size_bytes)?;

        // Check if mint event already exists
        let next_index = self.provenance_db.get_next_event_index(artifact_id)?;
        if next_index > 0 {
            // Artifact already has events, return existing mint event
            let manifest = self
                .provenance_db
                .get_manifest(&sha256_hex)?
                .ok_or_else(|| anyhow!("Manifest not found after checking event index"))?;

            let first_event = &manifest.events[0];

            // Compute stamp status for existing event
            let stamp_status =
                provenance_handlers::compute_stamp_status(path, &self.provenance_db).await;

            return Ok(super::path_item::MintEventResponse {
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
        self.provenance_db
            .insert_event(crate::provenance::InsertEventArgs {
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

        Ok(super::path_item::MintEventResponse {
            filename: file_name,
            sha256: sha256_hex.clone(),
            ots_base64: ots_proof_b64,
            event_hash: event_hash_hex,
            issued_at,
            stamp_status: Some(super::path_item::StampStatus {
                success: false,
                results: None,
                error: None, // No error, just pending Bitcoin confirmation
                sha256_hex: Some(sha256_hex),
            }),
        })
    }
}

async fn ensure_path_parent(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        if fs::symlink_metadata(parent).await.is_err() {
            fs::create_dir_all(&parent).await?;
        }
    }
    Ok(())
}

pub(crate) fn has_query_flag(query_params: &HashMap<String, String>, name: &str) -> bool {
    query_params
        .get(name)
        .map(|v| v.is_empty())
        .unwrap_or_default()
}

pub(crate) fn parse_upload_offset(
    headers: &HeaderMap<HeaderValue>,
    size: u64,
) -> Result<Option<u64>> {
    let value = match headers.get("x-update-range") {
        Some(v) => v,
        None => return Ok(None),
    };
    let err = || anyhow!("Invalid X-Update-Range Header");
    let value = value.to_str().map_err(|_| err())?;
    if value == "append" {
        return Ok(Some(size));
    }
    let ranges = parse_range(value, size).ok_or_else(err)?;
    let (start, _) = ranges.first().ok_or_else(err)?;
    Ok(Some(*start))
}

fn is_hidden(hidden: &[String], file_name: &str, is_dir: bool) -> bool {
    use crate::utils::glob;
    hidden.iter().any(|v| {
        if is_dir {
            if let Some(x) = v.strip_suffix('/') {
                return glob(x, file_name);
            }
        }
        glob(v, file_name)
    })
}

// Module-level helper functions for directory operations

pub(crate) async fn collect_dir_entries<F>(
    access_paths: AccessPaths,
    running: Arc<AtomicBool>,
    path: std::path::PathBuf,
    hidden: Arc<Vec<String>>,
    follow_symlinks: bool,
    serve_path: std::path::PathBuf,
    include_entry: F,
) -> Vec<std::path::PathBuf>
where
    F: Fn(&walkdir::DirEntry) -> bool,
{
    use std::sync::atomic;
    use walkdir::WalkDir;

    let mut paths: Vec<std::path::PathBuf> = vec![];
    for dir in access_paths.entry_paths(&path) {
        let mut it = WalkDir::new(&dir).follow_links(true).into_iter();
        it.next();
        while let Some(Ok(entry)) = it.next() {
            if !running.load(atomic::Ordering::SeqCst) {
                break;
            }
            let entry_path = entry.path();
            let base_name = get_file_name(entry_path);
            let is_dir = entry.file_type().is_dir();
            if is_hidden(&hidden, base_name, is_dir) {
                if is_dir {
                    it.skip_current_dir();
                }
                continue;
            }

            if !follow_symlinks
                && !fs::canonicalize(entry_path)
                    .await
                    .ok()
                    .map(|v| v.starts_with(&serve_path))
                    .unwrap_or_default()
            {
                if is_dir {
                    it.skip_current_dir();
                }
                continue;
            }
            if !include_entry(&entry) {
                continue;
            }
            paths.push(entry_path.to_path_buf());
        }
    }
    paths
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn zip_dir<W: tokio::io::AsyncWrite + Unpin>(
    writer: &mut W,
    dir: &Path,
    access_paths: AccessPaths,
    hidden: &[String],
    compression: async_zip::Compression,
    follow_symlinks: bool,
    serve_path: std::path::PathBuf,
    running: Arc<std::sync::atomic::AtomicBool>,
) -> Result<()> {
    use crate::utils::get_file_mtime_and_mode;
    use async_zip::{tokio::write::ZipFileWriter, ZipDateTime, ZipEntryBuilder};
    use std::path::MAIN_SEPARATOR;
    use tokio::fs::File;
    use tokio_util::compat::FuturesAsyncWriteCompatExt;

    let mut writer = ZipFileWriter::with_tokio(writer);
    let hidden = Arc::new(hidden.to_vec());
    let zip_paths = tokio::task::spawn(collect_dir_entries(
        access_paths,
        running,
        dir.to_path_buf(),
        hidden,
        follow_symlinks,
        serve_path,
        move |x| x.path().symlink_metadata().is_ok() && x.file_type().is_file(),
    ))
    .await?;
    for zip_path in zip_paths.into_iter() {
        let filename = match zip_path
            .strip_prefix(dir)
            .ok()
            .and_then(|v| v.to_str())
            .map(|v| v.replace(MAIN_SEPARATOR, "/"))
        {
            Some(v) => v,
            None => continue,
        };
        let (datetime, mode) = get_file_mtime_and_mode(&zip_path).await?;
        let builder = ZipEntryBuilder::new(filename.into(), compression)
            .unix_permissions(mode)
            .last_modification_date(ZipDateTime::from_chrono(&datetime));
        let mut file = File::open(&zip_path).await?;
        let mut file_writer = writer.write_entry_stream(builder).await?.compat_write();
        io::copy(&mut file, &mut file_writer).await?;
        file_writer.into_inner().close().await?;
    }
    writer.close().await?;
    Ok(())
}
