use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
    Json as JsonBody,
};
use uuid::Uuid;

use crate::models::{ListQuery, AppListResponse, AppListMeta, AppListLinks, AppResponse, AppResponseLinks, CreateAppRequest, UpdateAppSourceCodeRequest};
use crate::AppState;

pub async fn create_app(
    State(app_state): State<AppState>,
    JsonBody(req): JsonBody<CreateAppRequest>,
) -> Result<Json<AppResponse>, StatusCode> {
    let app_id = Uuid::new_v4().to_string();

    let app_data = serde_json::json!({
        "id": app_id,
        "name": req.name,
        "description": req.description,
        "version": req.version,
        "price": req.price,
        "icon": req.icon,
        "installed": 1,
        "source_code": req.source_code,
        "prompt": req.prompt,
        "model": req.model,
        "status": "draft",
        "created_at": chrono::Utc::now().to_rfc3339()
    });

    match app_state.database.create_document("apps", app_data).await {
        Ok(document) => {
            let response = AppResponse {
                data: document.into(),
                links: AppResponseLinks {
                    self_link: format!("/api/apps/{}", app_id),
                },
            };
            Ok(Json(response))
        },
        Err(e) => {
            tracing::error!("Failed to create app: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn update_app_source_code(
    State(app_state): State<AppState>,
    Path(app_id): Path<String>,
    JsonBody(req): JsonBody<UpdateAppSourceCodeRequest>,
) -> Result<Json<AppResponse>, StatusCode> {
    // First get the existing app
    let apps_result = app_state.database.list_documents("apps", Some(1000), Some(0)).await;
    let apps = match apps_result {
        Ok(result) => result,
        Err(e) => {
            tracing::error!("Failed to list apps: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    // Find the app by its data.id field
    let app_document = apps.documents
        .into_iter()
        .find(|doc| {
            doc.data.get("id").and_then(|v| v.as_str()) == Some(&app_id)
        });

    let mut app_document = match app_document {
        Some(doc) => doc,
        None => return Err(StatusCode::NOT_FOUND),
    };

    // Update the source_code field
    if let Some(data_obj) = app_document.data.as_object_mut() {
        data_obj.insert("source_code".to_string(), serde_json::Value::String(req.source_code));
    }

    match app_state.database.update_document("apps", &app_document.id, app_document.data).await {
        Ok(Some(updated_document)) => {
            let response = AppResponse {
                data: updated_document.into(),
                links: AppResponseLinks {
                    self_link: format!("/api/apps/{}", app_id),
                },
            };
            Ok(Json(response))
        },
        Ok(None) => Err(StatusCode::NOT_FOUND),
        Err(e) => {
            tracing::error!("Failed to update app: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn list_apps(
    State(app_state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> Result<Json<AppListResponse>, StatusCode> {
    let limit = query.limit.unwrap_or(100);
    let offset = query.offset.unwrap_or(0);

    match app_state
        .database
        .list_documents("apps", Some(limit), Some(offset))
        .await
    {
        Ok(result) => {
            let response = AppListResponse {
                data: result.documents.into_iter().map(|doc| doc.into()).collect(),
                meta: AppListMeta {
                    count: result.count,
                    limit,
                    offset,
                },
                links: AppListLinks {
                    self_link: format!("/api/apps?limit={}&offset={}", limit, offset),
                    collection: "/api/apps".to_string(),
                },
            };
            Ok(Json(response))
        },
        Err(e) => {
            tracing::error!("Failed to list apps: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}