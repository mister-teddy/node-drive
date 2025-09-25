#![recursion_limit = "512"]

use aide::axum::{
    routing::{delete, get, get_with, post, post_with, put, put_with},
    ApiRouter, IntoApiResponse,
};
use aide::openapi::OpenApi;
use axum::http::{Method, StatusCode};
use axum::{response::Redirect, Extension, Json, Router};
use reqwest::Client;
use std::{env, sync::Arc};
use tower_http::cors::{Any, CorsLayer};

pub mod ai;
pub mod config;
pub mod database;
pub mod handlers;
pub mod models;
pub mod openapi;
pub mod seed;

#[derive(Clone)]
pub struct AppState {
    pub client: Client,
    pub database: Arc<database::Database>,
}

pub async fn redirect_to_frontend() -> Result<Redirect, StatusCode> {
    let frontend_url = env::var("FRONTEND_URL")
        .unwrap_or_else(|_| "https://node-alpha-lovat.vercel.app/".to_string());
    Ok(Redirect::permanent(&frontend_url))
}

async fn serve_openapi(Extension(api): Extension<OpenApi>) -> impl IntoApiResponse {
    Json(api)
}

pub fn create_router(database: Arc<database::Database>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers(Any);

    let mut api = openapi::create_openapi_spec();

    let api_router = create_api_router();

    let app = ApiRouter::new()
        .api_route(
            "/docs/openapi.json",
            get_with(serve_openapi, |op| {
                op.description("Get OpenAPI specification")
            }),
        )
        .nest("/api", api_router.into())
        .finish_api(&mut api)
        .layer(Extension(api))
        .merge(
            Router::new()
                .route("/", axum::routing::get(redirect_to_frontend))
                .route("/generate", axum::routing::post(ai::generate_code_stream))
                .route(
                    "/generate/modify",
                    axum::routing::post(ai::modify_code_stream),
                ),
        )
        .layer(cors)
        .with_state(AppState {
            client: Client::new(),
            database,
        });

    app
}

fn create_api_router() -> ApiRouter<AppState> {
    ApiRouter::new()
        // AI endpoints
        .api_route("/models", get(ai::list_models))
        // Database endpoints
        .api_route("/db", get(handlers::list_collections))
        .api_route("/db/:collection", post(handlers::create_document))
        .api_route("/db/:collection", get(handlers::list_documents))
        .api_route("/db/:collection/:id", get(handlers::get_document))
        .api_route("/db/:collection/:id", put(handlers::update_document))
        .api_route("/db/:collection/:id", delete(handlers::delete_document))
        .api_route("/db/reset", post(handlers::reset_database))
        .api_route("/query", post(handlers::execute_query))
        .api_route("/reset", post(handlers::reset_database))
        // Project endpoints
        .api_route("/projects", post(handlers::create_project))
        .api_route("/projects", get(handlers::list_projects))
        .api_route("/projects/:project_id", get(handlers::get_project))
        .api_route("/projects/:project_id", put(handlers::update_project))
        .api_route("/projects/:project_id", delete(handlers::delete_project))
        .api_route(
            "/projects/:project_id/versions",
            post(handlers::create_version),
        )
        .api_route(
            "/projects/:project_id/versions",
            get(handlers::list_versions),
        )
        .api_route(
            "/projects/:project_id/release",
            post(handlers::release_version),
        )
        .api_route(
            "/projects/:project_id/convert",
            post(handlers::convert_to_app),
        )
        // Published projects endpoint
        .api_route(
            "/published-projects",
            get(handlers::list_published_projects),
        )
        // Dashboard endpoints
        .api_route("/dashboard/layout", get(handlers::get_dashboard_layout))
        .api_route("/dashboard/layout", put(handlers::save_dashboard_layout))
        // App endpoints
        .api_route("/apps", get_with(handlers::list_apps, |op| {
            op.summary("List all apps")
                .description("Get a paginated list of all applications")
                .tag("Apps")
        }))
        .api_route("/apps", post_with(handlers::create_app, |op| {
            op.summary("Create new app")
                .description("Create a new application")
                .tag("Apps")
        }))
        .api_route(
            "/apps/:app_id/source",
            put_with(handlers::update_app_source_code, |op| {
                op.summary("Update app source code")
                    .description("Update the source code of an existing application")
                    .tag("Apps")
            }),
        )
}
