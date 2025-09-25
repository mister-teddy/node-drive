use crate::AppState;
use crate::models::{DashboardLayoutResponse, DashboardLayoutResponseLinks, SaveDashboardLayoutRequest};
use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
    Json as JsonBody,
};


const LAYOUT_ID: &str = "default_layout";

pub async fn get_dashboard_layout(
    State(app_state): State<AppState>,
) -> Result<Json<DashboardLayoutResponse>, StatusCode> {
    // Try to find existing layout document
    let layouts_result = app_state
        .database
        .list_documents("dashboard_layouts", Some(100), Some(0))
        .await;

    let layouts = match layouts_result {
        Ok(result) => result,
        Err(e) => {
            tracing::error!("Failed to list dashboard layouts: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    // Find the default layout
    let layout_doc = layouts
        .documents
        .into_iter()
        .find(|doc| doc.data.get("id").and_then(|v| v.as_str()) == Some(LAYOUT_ID));

    match layout_doc {
        Some(doc) => {
            let response = DashboardLayoutResponse {
                data: doc.into(),
                links: DashboardLayoutResponseLinks {
                    self_link: "/api/dashboard/layout".to_string(),
                },
            };
            Ok(Json(response))
        }
        None => {
            // Create a default empty layout document for conversion
            let default_doc = crate::models::Document {
                id: "temp".to_string(),
                collection: "dashboard_layouts".to_string(),
                data: serde_json::json!({
                    "id": LAYOUT_ID,
                    "widgets": [],
                    "updated_at": null
                }),
                created_at: chrono::Utc::now(),
                updated_at: chrono::Utc::now(),
            };
            let response = DashboardLayoutResponse {
                data: default_doc.into(),
                links: DashboardLayoutResponseLinks {
                    self_link: "/api/dashboard/layout".to_string(),
                },
            };
            Ok(Json(response))
        }
    }
}

pub async fn save_dashboard_layout(
    State(app_state): State<AppState>,
    JsonBody(req): JsonBody<SaveDashboardLayoutRequest>,
) -> Result<Json<DashboardLayoutResponse>, StatusCode> {
    let now = chrono::Utc::now().to_rfc3339();

    // Check if layout already exists
    let layouts_result = app_state
        .database
        .list_documents("dashboard_layouts", Some(100), Some(0))
        .await;

    let layouts = match layouts_result {
        Ok(result) => result,
        Err(e) => {
            tracing::error!("Failed to list dashboard layouts: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    let existing_layout = layouts
        .documents
        .into_iter()
        .find(|doc| doc.data.get("id").and_then(|v| v.as_str()) == Some(LAYOUT_ID));

    let layout_data = serde_json::json!({
        "id": LAYOUT_ID,
        "widgets": req.widgets,
        "updated_at": now
    });

    match existing_layout {
        Some(existing) => {
            // Update existing layout
            match app_state
                .database
                .update_document("dashboard_layouts", &existing.id, layout_data)
                .await
            {
                Ok(Some(updated_doc)) => {
                    let response = DashboardLayoutResponse {
                        data: updated_doc.into(),
                        links: DashboardLayoutResponseLinks {
                            self_link: "/api/dashboard/layout".to_string(),
                        },
                    };
                    Ok(Json(response))
                }
                Ok(None) => Err(StatusCode::NOT_FOUND),
                Err(e) => {
                    tracing::error!("Failed to update dashboard layout: {}", e);
                    Err(StatusCode::INTERNAL_SERVER_ERROR)
                }
            }
        }
        None => {
            // Create new layout
            match app_state
                .database
                .create_document("dashboard_layouts", layout_data)
                .await
            {
                Ok(created_doc) => {
                    let response = DashboardLayoutResponse {
                        data: created_doc.into(),
                        links: DashboardLayoutResponseLinks {
                            self_link: "/api/dashboard/layout".to_string(),
                        },
                    };
                    Ok(Json(response))
                }
                Err(e) => {
                    tracing::error!("Failed to create dashboard layout: {}", e);
                    Err(StatusCode::INTERNAL_SERVER_ERROR)
                }
            }
        }
    }
}