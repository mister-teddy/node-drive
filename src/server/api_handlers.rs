use anyhow::Result;
use headers::{ContentLength, ContentType, HeaderMapExt};
use std::collections::HashMap;
use std::path::Path;

use crate::auth::AccessPaths;
use crate::http_utils::body_full;
use crate::server::path_item::{DataKind, IndexData, PathItem};
use crate::server::response_utils::{normalize_path, status_forbid, Response};

use super::handlers::{has_query_flag, Server};

impl Server {
    /// Handles API requests for directory listings
    /// Returns JSON data for directory contents
    #[allow(clippy::too_many_arguments)]
    pub async fn handle_api_index(
        &self,
        path: &Path,
        exist: bool,
        query_params: &HashMap<String, String>,
        head_only: bool,
        user: Option<String>,
        access_paths: AccessPaths,
        res: &mut Response,
    ) -> Result<()> {
        // Get directory listing
        let mut paths = if exist {
            match self
                .list_dir(path, &self.args.serve_path, access_paths.clone())
                .await
            {
                Ok(paths) => paths,
                Err(_) => {
                    status_forbid(res);
                    return Ok(());
                }
            }
        } else {
            vec![]
        };

        // Sort paths
        self.sort_paths(&mut paths, query_params);

        // Handle simple text format
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
                .typed_insert(ContentType::from(mime_guess::mime::TEXT_PLAIN_UTF_8));
            res.headers_mut()
                .typed_insert(ContentLength(output.len() as u64));
            if !head_only {
                *res.body_mut() = body_full(output);
            }
            return Ok(());
        }

        // Build JSON response
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

        // Return JSON
        let output = serde_json::to_string_pretty(&data)?;
        res.headers_mut()
            .typed_insert(ContentType::from(mime_guess::mime::APPLICATION_JSON));
        res.headers_mut()
            .typed_insert(ContentLength(output.len() as u64));
        if !head_only {
            *res.body_mut() = body_full(output);
        }

        Ok(())
    }

    /// Handles API search requests
    /// Returns JSON data for search results
    pub async fn handle_api_search(
        &self,
        path: &Path,
        query_params: &HashMap<String, String>,
        head_only: bool,
        user: Option<String>,
        access_paths: AccessPaths,
        res: &mut Response,
    ) -> Result<()> {
        use crate::utils::get_file_name;
        use anyhow::anyhow;
        use std::sync::Arc;

        let search = query_params
            .get("q")
            .ok_or_else(|| anyhow!("invalid q"))?
            .to_lowercase();

        if search.is_empty() {
            return self
                .handle_api_index(path, true, query_params, head_only, user, access_paths, res)
                .await;
        }

        let path_buf = path.to_path_buf();
        let hidden = Arc::new(self.args.hidden.to_vec());
        let search_clone = search.clone();

        let access_paths_clone = access_paths.clone();
        let search_paths = tokio::spawn(super::handlers::collect_dir_entries(
            access_paths_clone,
            self.running.clone(),
            path_buf.clone(),
            hidden,
            self.args.allow_symlink,
            self.args.serve_path.clone(),
            move |x| {
                get_file_name(x.path())
                    .to_lowercase()
                    .contains(&search_clone)
            },
        ))
        .await?;

        let mut paths: Vec<PathItem> = vec![];
        for search_path in search_paths.into_iter() {
            if let Ok(Some(item)) = self.to_pathitem(search_path, path_buf.clone()).await {
                paths.push(item);
            }
        }

        // Sort results
        self.sort_paths(&mut paths, query_params);

        // Handle simple text format
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
                .typed_insert(ContentType::from(mime_guess::mime::TEXT_PLAIN_UTF_8));
            res.headers_mut()
                .typed_insert(ContentLength(output.len() as u64));
            if !head_only {
                *res.body_mut() = body_full(output);
            }
            return Ok(());
        }

        // Return as JSON
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
            dir_exists: true,
            auth: self.args.auth.has_users(),
            user,
            paths,
        };

        let output = serde_json::to_string_pretty(&data)?;
        res.headers_mut()
            .typed_insert(ContentType::from(mime_guess::mime::APPLICATION_JSON));
        res.headers_mut()
            .typed_insert(ContentLength(output.len() as u64));
        if !head_only {
            *res.body_mut() = body_full(output);
        }

        Ok(())
    }

    /// Helper function to sort paths based on query parameters
    fn sort_paths(&self, paths: &mut [PathItem], query_params: &HashMap<String, String>) {
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
    }
}
