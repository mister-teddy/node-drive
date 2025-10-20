/// Server routing logic
/// This module defines all available routes in the application

use hyper::Method;

/// Represents all possible routes in the application
#[derive(Debug, Clone, PartialEq)]
pub enum Route {
    // ============================================================================
    // Internal/System Routes
    // ============================================================================
    /// Health check endpoint: /__dufs__/health
    HealthCheck,

    /// Built-in assets: /__dufs_vX.X.X__/*
    Asset { name: String },

    /// Auth check: CHECKAUTH method
    CheckAuth,

    /// Logout: LOGOUT method
    Logout,

    /// Token generation: ?tokengen query parameter
    TokenGen { path: String },

    // ============================================================================
    // API Routes (JSON responses)
    // ============================================================================
    /// API directory listing: GET/HEAD /api/* (directories only)
    ApiIndex { path: String },

    /// API search: GET/HEAD /api/*?q=search
    ApiSearch { path: String, query: String },

    // ============================================================================
    // HTML/Static Routes
    // ============================================================================
    /// Serve static SPA index.html for directories: GET/HEAD /*/ (directories)
    SpaIndex { path: String },

    // ============================================================================
    // File Operations
    // ============================================================================
    /// Send file: GET/HEAD /path/to/file
    SendFile { path: String },

    /// Edit file: GET/HEAD /path/to/file?edit
    EditFile { path: String },

    /// View file: GET/HEAD /path/to/file?view
    ViewFile { path: String },

    /// File hash: GET/HEAD /path/to/file?hash
    FileHash { path: String },

    /// Upload file: PUT /path/to/file
    UploadFile { path: String },

    /// Resume upload: PATCH /path/to/file
    ResumeUpload { path: String },

    /// Delete file/dir: DELETE /path
    Delete { path: String, is_dir: bool },

    // ============================================================================
    // Directory Operations
    // ============================================================================
    /// Zip directory: GET/HEAD /path/to/dir?zip
    ZipDirectory { path: String },

    /// Create directory: MKCOL /path/to/dir
    MakeDirectory { path: String },

    // ============================================================================
    // Provenance Routes
    // ============================================================================
    /// Provenance manifest: GET/HEAD /path/to/file?manifest=json
    ProvenanceManifest { path: String },

    /// OTS info: GET/HEAD /path/to/file?ots-info
    OtsInfo { path: String },

    /// Download OTS: GET/HEAD /path/to/file?ots
    OtsDownload { path: String },

    /// Upload OTS: POST /path/to/file?ots
    OtsUpload { path: String },

    /// Verify OTS: POST ?verify
    OtsVerify,

    /// Download provenance database: GET /__dufs__/provenance-db
    DownloadProvenanceDb,

    // ============================================================================
    // WebDAV Routes
    // ============================================================================
    /// WebDAV PROPFIND for directory
    PropfindDir { path: String },

    /// WebDAV PROPFIND for file
    PropfindFile { path: String },

    /// WebDAV PROPPATCH
    Proppatch { path: String },

    /// WebDAV COPY
    Copy { path: String },

    /// WebDAV MOVE
    Move { path: String },

    /// WebDAV LOCK
    Lock { path: String },

    /// WebDAV UNLOCK
    Unlock { path: String },

    /// WebDAV OPTIONS
    Options,

    // ============================================================================
    // Fallback
    // ============================================================================
    /// Not found
    NotFound,
}

impl Route {
    /// Parse a request into a Route
    /// This function contains all routing logic in one place
    pub fn from_request(
        method: &Method,
        req_path: &str,
        relative_path: &str,
        query_params: &std::collections::HashMap<String, String>,
        assets_prefix: &str,
        is_dir: bool,
        is_file: bool,
        is_miss: bool,
    ) -> Self {
        use super::handlers::has_query_flag;

        // Check for special query parameters first
        if has_query_flag(query_params, "tokengen") {
            return Route::TokenGen {
                path: relative_path.to_string(),
            };
        }

        // Check for special methods
        match method.as_str() {
            "CHECKAUTH" => return Route::CheckAuth,
            "LOGOUT" => return Route::Logout,
            "OPTIONS" => return Route::Options,
            _ => {}
        }

        // Internal routes (/__dufs__/*)
        if req_path == super::handlers::HEALTH_CHECK_PATH {
            return Route::HealthCheck;
        }

        if req_path == super::handlers::PROVENANCE_DB_PATH {
            return Route::DownloadProvenanceDb;
        }

        if let Some(name) = req_path.strip_prefix(assets_prefix) {
            return Route::Asset {
                name: name.to_string(),
            };
        }

        // API routes (/api/*)
        if req_path.starts_with("/api/") && matches!(method, &Method::GET | &Method::HEAD) {
            let api_path = req_path[5..].to_string(); // Remove "/api/" prefix

            if query_params.contains_key("q") {
                return Route::ApiSearch {
                    path: api_path,
                    query: query_params.get("q").unwrap_or(&String::new()).to_string(),
                };
            } else {
                return Route::ApiIndex { path: api_path };
            }
        }

        // POST routes
        if method == Method::POST {
            if has_query_flag(query_params, "verify") {
                return Route::OtsVerify;
            }
            if has_query_flag(query_params, "ots") {
                return Route::OtsUpload {
                    path: relative_path.to_string(),
                };
            }
        }

        // GET/HEAD routes
        if matches!(method, &Method::GET | &Method::HEAD) {
            // Directory routes
            if is_dir {
                if has_query_flag(query_params, "zip") {
                    return Route::ZipDirectory {
                        path: relative_path.to_string(),
                    };
                }

                if query_params.contains_key("q") {
                    // Search is now only via API
                    return Route::NotFound;
                }

                // Serve SPA index.html for directories
                return Route::SpaIndex {
                    path: relative_path.to_string(),
                };
            }

            // File routes
            if is_file {
                if has_query_flag(query_params, "edit") {
                    return Route::EditFile {
                        path: relative_path.to_string(),
                    };
                }
                if has_query_flag(query_params, "view") {
                    return Route::ViewFile {
                        path: relative_path.to_string(),
                    };
                }
                if has_query_flag(query_params, "hash") {
                    return Route::FileHash {
                        path: relative_path.to_string(),
                    };
                }
                if query_params.get("manifest") == Some(&"json".to_string()) {
                    return Route::ProvenanceManifest {
                        path: relative_path.to_string(),
                    };
                }
                if has_query_flag(query_params, "ots-info") {
                    return Route::OtsInfo {
                        path: relative_path.to_string(),
                    };
                }
                if has_query_flag(query_params, "ots") {
                    return Route::OtsDownload {
                        path: relative_path.to_string(),
                    };
                }

                return Route::SendFile {
                    path: relative_path.to_string(),
                };
            }

            // Missing file/directory - could be upload target or 404
            if !is_miss {
                return Route::NotFound;
            }
        }

        // PUT - upload
        if method == Method::PUT {
            return Route::UploadFile {
                path: relative_path.to_string(),
            };
        }

        // PATCH - resume upload
        if method == Method::PATCH {
            return Route::ResumeUpload {
                path: relative_path.to_string(),
            };
        }

        // DELETE
        if method == Method::DELETE {
            return Route::Delete {
                path: relative_path.to_string(),
                is_dir,
            };
        }

        // WebDAV methods
        match method.as_str() {
            "PROPFIND" => {
                if is_dir {
                    return Route::PropfindDir {
                        path: relative_path.to_string(),
                    };
                } else if is_file {
                    return Route::PropfindFile {
                        path: relative_path.to_string(),
                    };
                }
            }
            "PROPPATCH" => {
                return Route::Proppatch {
                    path: relative_path.to_string(),
                };
            }
            "MKCOL" => {
                return Route::MakeDirectory {
                    path: relative_path.to_string(),
                };
            }
            "COPY" => {
                return Route::Copy {
                    path: relative_path.to_string(),
                };
            }
            "MOVE" => {
                return Route::Move {
                    path: relative_path.to_string(),
                };
            }
            "LOCK" => {
                return Route::Lock {
                    path: relative_path.to_string(),
                };
            }
            "UNLOCK" => {
                return Route::Unlock {
                    path: relative_path.to_string(),
                };
            }
            _ => {}
        }

        Route::NotFound
    }
}
