use crate::ai::generate_metadata_from_prompt;
use crate::models::{
    ListQuery, ProjectResponse, ProjectResponseLinks, ProjectListResponse, ProjectListMeta, ProjectListLinks,
    ProjectVersionResponse, ProjectVersionResponseLinks, ProjectVersionListResponse, ProjectVersionListMeta, ProjectVersionListLinks,
    AppResponse, AppResponseLinks
};
use crate::AppState;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
    Json as JsonBody,
};
use schemars::JsonSchema;
use serde::Deserialize;
use uuid::Uuid;

#[derive(Deserialize, JsonSchema)]
pub struct CreateProjectRequest {
    pub prompt: String,
    pub model: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
pub struct CreateVersionRequest {
    pub prompt: String,
    pub source_code: String,
    pub model: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
pub struct UpdateProjectRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub status: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
pub struct ConvertToAppRequest {
    pub version: i32,
    pub price: Option<f64>,
}

#[derive(Deserialize, JsonSchema)]
pub struct ReleaseVersionRequest {
    pub version_number: i32,
    pub price: Option<f64>,
}

pub async fn create_project(
    State(app_state): State<AppState>,
    JsonBody(req): JsonBody<CreateProjectRequest>,
) -> Result<Json<ProjectResponse>, StatusCode> {
    // Generate metadata from the prompt first
    let metadata = generate_metadata_from_prompt(&app_state, &req.prompt, &req.model).await?;

    let project_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // Create the project document with generated metadata
    let project_data = serde_json::json!({
        "id": project_id,
        "name": metadata.name,
        "description": metadata.description,
        "icon": metadata.icon,
        "status": "draft",
        "current_version": 0,
        "initial_prompt": req.prompt,
        "initial_model": req.model,
        "created_at": now,
        "updated_at": now
    });

    // Create project document only
    match app_state
        .database
        .create_document("projects", project_data)
        .await
    {
        Ok(project_doc) => {
            let response = ProjectResponse {
                data: project_doc.into(),
                links: ProjectResponseLinks {
                    self_link: format!("/api/projects/{}", project_id),
                    versions: Some(format!("/api/projects/{}/versions", project_id)),
                },
            };
            Ok(Json(response))
        },
        Err(e) => {
            tracing::error!("Failed to create project: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn list_projects(
    State(app_state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> Result<Json<ProjectListResponse>, StatusCode> {
    let limit = query.limit.unwrap_or(100);
    let offset = query.offset.unwrap_or(0);

    match app_state
        .database
        .list_documents("projects", Some(limit), Some(offset))
        .await
    {
        Ok(result) => {
            let response = ProjectListResponse {
                data: result.documents.into_iter().map(|doc| doc.into()).collect(),
                meta: ProjectListMeta {
                    count: result.count,
                    limit,
                    offset,
                },
                links: ProjectListLinks {
                    self_link: format!("/api/projects?limit={}&offset={}", limit, offset),
                    collection: "/api/projects".to_string(),
                },
            };
            Ok(Json(response))
        },
        Err(e) => {
            tracing::error!("Failed to list projects: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn get_project(
    State(app_state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<ProjectResponse>, StatusCode> {
    // Find project by data.id field
    let projects_result = app_state
        .database
        .list_documents("projects", Some(1000), Some(0))
        .await;
    let projects = match projects_result {
        Ok(result) => result,
        Err(e) => {
            tracing::error!("Failed to list projects: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    let project_doc = projects
        .documents
        .into_iter()
        .find(|doc| doc.data.get("id").and_then(|v| v.as_str()) == Some(&project_id));

    let project_doc = match project_doc {
        Some(doc) => doc,
        None => return Err(StatusCode::NOT_FOUND),
    };

    // Get the current version to check if source_code needs generation
    let current_version = project_doc
        .data
        .get("current_version")
        .and_then(|v| v.as_i64())
        .unwrap_or(0) as i32;

    // Find the current version document
    let versions_result = app_state
        .database
        .list_documents("project_versions", Some(1000), Some(0))
        .await;
    let versions = match versions_result {
        Ok(result) => result,
        Err(e) => {
            tracing::error!("Failed to list project versions: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    // Get all versions for this project first
    let all_versions: Vec<_> = versions
        .documents
        .into_iter()
        .filter(|doc| doc.data.get("project_id").and_then(|v| v.as_str()) == Some(&project_id))
        .collect();

    // Handle case where there are no versions (current_version = 0)
    if current_version == 0 {
        tracing::info!(
            "Project {} has no versions yet - ready for initial code generation",
            project_id
        );
    }

    // Prepare enriched project data without version-specific fields
    let mut enriched_project_data = project_doc.data.clone();
    if let Some(data_obj) = enriched_project_data.as_object_mut() {
        // Remove version-specific fields from project level
        data_obj.remove("source_code");
        data_obj.remove("prompt");
        data_obj.remove("model");

        // Add versions array
        data_obj.insert(
            "versions".to_string(),
            serde_json::to_value(&all_versions).unwrap_or_default(),
        );
    }

    let enriched_project_doc = crate::models::Document {
        id: project_doc.id.clone(),
        collection: project_doc.collection.clone(),
        data: enriched_project_data,
        created_at: project_doc.created_at,
        updated_at: project_doc.updated_at,
    };

    let mut project: crate::models::Project = enriched_project_doc.into();

    // Convert the all_versions Vec<Document> to Vec<ProjectVersion>
    project.versions = Some(all_versions.into_iter().map(|doc| doc.into()).collect());

    let response = ProjectResponse {
        data: project,
        links: ProjectResponseLinks {
            self_link: format!("/api/projects/{}", project_id),
            versions: Some(format!("/api/projects/{}/versions", project_id)),
        },
    };
    Ok(Json(response))
}

pub async fn update_project(
    State(app_state): State<AppState>,
    Path(project_id): Path<String>,
    JsonBody(req): JsonBody<UpdateProjectRequest>,
) -> Result<Json<ProjectResponse>, StatusCode> {
    // Find the project by its data.id field
    let projects_result = app_state
        .database
        .list_documents("projects", Some(1000), Some(0))
        .await;
    let projects = match projects_result {
        Ok(result) => result,
        Err(e) => {
            tracing::error!("Failed to list projects: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    let project_document = projects
        .documents
        .into_iter()
        .find(|doc| doc.data.get("id").and_then(|v| v.as_str()) == Some(&project_id));

    let mut project_document = match project_document {
        Some(doc) => doc,
        None => return Err(StatusCode::NOT_FOUND),
    };

    // Update fields if provided
    if let Some(data_obj) = project_document.data.as_object_mut() {
        if let Some(name) = req.name {
            data_obj.insert("name".to_string(), serde_json::Value::String(name));
        }
        if let Some(description) = req.description {
            data_obj.insert(
                "description".to_string(),
                serde_json::Value::String(description),
            );
        }
        if let Some(icon) = req.icon {
            data_obj.insert("icon".to_string(), serde_json::Value::String(icon));
        }
        if let Some(status) = req.status {
            data_obj.insert("status".to_string(), serde_json::Value::String(status));
        }
        data_obj.insert(
            "updated_at".to_string(),
            serde_json::Value::String(chrono::Utc::now().to_rfc3339()),
        );
    }

    match app_state
        .database
        .update_document("projects", &project_document.id, project_document.data)
        .await
    {
        Ok(Some(updated_document)) => {
            let response = ProjectResponse {
                data: updated_document.into(),
                links: ProjectResponseLinks {
                    self_link: format!("/api/projects/{}", project_id),
                    versions: Some(format!("/api/projects/{}/versions", project_id)),
                },
            };
            Ok(Json(response))
        },
        Ok(None) => Err(StatusCode::NOT_FOUND),
        Err(e) => {
            tracing::error!("Failed to update project: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn delete_project(
    State(app_state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    // Find and delete the project
    let projects_result = app_state
        .database
        .list_documents("projects", Some(1000), Some(0))
        .await;
    let projects = match projects_result {
        Ok(result) => result,
        Err(e) => {
            tracing::error!("Failed to list projects: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    let project_document = projects
        .documents
        .into_iter()
        .find(|doc| doc.data.get("id").and_then(|v| v.as_str()) == Some(&project_id));

    let project_document = match project_document {
        Some(doc) => doc,
        None => return Err(StatusCode::NOT_FOUND),
    };

    match app_state
        .database
        .delete_document("projects", &project_document.id)
        .await
    {
        Ok(true) => {
            // Also delete all versions for this project
            // Note: In a production system, you might want to do this in a transaction
            let versions_result = app_state
                .database
                .list_documents("project_versions", Some(1000), Some(0))
                .await;
            if let Ok(versions) = versions_result {
                for version_doc in versions.documents {
                    if let Some(version_project_id) =
                        version_doc.data.get("project_id").and_then(|v| v.as_str())
                    {
                        if version_project_id == project_id {
                            let _ = app_state
                                .database
                                .delete_document("project_versions", &version_doc.id)
                                .await;
                        }
                    }
                }
            }
            Ok(StatusCode::NO_CONTENT)
        }
        Ok(false) => Err(StatusCode::NOT_FOUND),
        Err(e) => {
            tracing::error!("Failed to delete project: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn create_version(
    State(app_state): State<AppState>,
    Path(project_id): Path<String>,
    JsonBody(req): JsonBody<CreateVersionRequest>,
) -> Result<Json<ProjectVersionResponse>, StatusCode> {
    // Get current project to determine next version number
    let projects_result = app_state
        .database
        .list_documents("projects", Some(1000), Some(0))
        .await;
    let projects = match projects_result {
        Ok(result) => result,
        Err(e) => {
            tracing::error!("Failed to list projects: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    let project_document = projects
        .documents
        .into_iter()
        .find(|doc| doc.data.get("id").and_then(|v| v.as_str()) == Some(&project_id));

    let mut project_document = match project_document {
        Some(doc) => doc,
        None => return Err(StatusCode::NOT_FOUND),
    };

    let current_version = project_document
        .data
        .get("current_version")
        .and_then(|v| v.as_i64())
        .unwrap_or(0) as i32;

    let next_version = current_version + 1;
    let version_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // Create new version
    let version_data = serde_json::json!({
        "id": version_id,
        "project_id": project_id,
        "version_number": next_version,
        "prompt": req.prompt,
        "source_code": req.source_code,
        "model": req.model,
        "created_at": now
    });

    match app_state
        .database
        .create_document("project_versions", version_data)
        .await
    {
        Ok(version_doc) => {
            // Update project's current_version
            if let Some(data_obj) = project_document.data.as_object_mut() {
                data_obj.insert(
                    "current_version".to_string(),
                    serde_json::Value::Number(next_version.into()),
                );
                data_obj.insert("updated_at".to_string(), serde_json::Value::String(now));
            }

            let _ = app_state
                .database
                .update_document("projects", &project_document.id, project_document.data)
                .await;

            let response = ProjectVersionResponse {
                data: version_doc.into(),
                links: ProjectVersionResponseLinks {
                    self_link: format!("/api/projects/{}/versions/{}", project_id, next_version),
                    project: format!("/api/projects/{}", project_id),
                },
            };
            Ok(Json(response))
        }
        Err(e) => {
            tracing::error!("Failed to create project version: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn list_versions(
    State(app_state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<ProjectVersionListResponse>, StatusCode> {
    let versions_result = app_state
        .database
        .list_documents("project_versions", Some(1000), Some(0))
        .await;
    let versions = match versions_result {
        Ok(result) => result,
        Err(e) => {
            tracing::error!("Failed to list project versions: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    let project_versions: Vec<_> = versions
        .documents
        .into_iter()
        .filter(|doc| doc.data.get("project_id").and_then(|v| v.as_str()) == Some(&project_id))
        .collect();

    let count = project_versions.len() as i64;
    let project_id_for_links = project_id.clone();

    let response = ProjectVersionListResponse {
        data: project_versions.into_iter().map(|doc| doc.into()).collect(),
        meta: ProjectVersionListMeta {
            count,
            project_id,
        },
        links: ProjectVersionListLinks {
            self_link: format!("/api/projects/{}/versions", project_id_for_links),
            project: format!("/api/projects/{}", project_id_for_links),
        },
    };
    Ok(Json(response))
}

pub async fn release_version(
    State(app_state): State<AppState>,
    Path(project_id): Path<String>,
    JsonBody(req): JsonBody<ReleaseVersionRequest>,
) -> Result<Json<AppResponse>, StatusCode> {
    // Get project
    let projects_result = app_state
        .database
        .list_documents("projects", Some(1000), Some(0))
        .await;
    let projects = match projects_result {
        Ok(result) => result,
        Err(e) => {
            tracing::error!("Failed to list projects: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    let project_doc = projects
        .documents
        .into_iter()
        .find(|doc| doc.data.get("id").and_then(|v| v.as_str()) == Some(&project_id));

    let project_doc = match project_doc {
        Some(doc) => doc,
        None => return Err(StatusCode::NOT_FOUND),
    };

    // Get the specific version
    let versions_result = app_state
        .database
        .list_documents("project_versions", Some(1000), Some(0))
        .await;
    let versions = match versions_result {
        Ok(result) => result,
        Err(e) => {
            tracing::error!("Failed to list project versions: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    let version_doc = versions.documents.into_iter().find(|doc| {
        doc.data.get("project_id").and_then(|v| v.as_str()) == Some(&project_id)
            && doc.data.get("version_number").and_then(|v| v.as_i64())
                == Some(req.version_number as i64)
    });

    let version_doc = match version_doc {
        Some(doc) => doc,
        None => return Err(StatusCode::NOT_FOUND),
    };

    // Create app from project version
    let app_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let app_data = serde_json::json!({
        "id": app_id,
        "name": project_doc.data.get("name").unwrap_or(&serde_json::Value::String("Untitled App".to_string())),
        "description": project_doc.data.get("description").unwrap_or(&serde_json::Value::String("".to_string())),
        "version": req.version_number,
        "price": req.price.unwrap_or(0.0),
        "icon": project_doc.data.get("icon").unwrap_or(&serde_json::Value::String("📱".to_string())),
        "installed": 1,
        "source_code": version_doc.data.get("source_code").unwrap_or(&serde_json::Value::String("".to_string())),
        "prompt": version_doc.data.get("prompt").unwrap_or(&serde_json::Value::String("".to_string())),
        "model": version_doc.data.get("model"),
        "status": "published",
        "project_id": project_id,
        "project_version": req.version_number,
        "created_at": now
    });

    match app_state.database.create_document("apps", app_data).await {
        Ok(app_doc) => {
            let response = AppResponse {
                data: app_doc.into(),
                links: AppResponseLinks {
                    self_link: format!("/api/apps/{}", app_id),
                },
            };
            Ok(Json(response))
        },
        Err(e) => {
            tracing::error!("Failed to release version as app: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn convert_to_app(
    State(app_state): State<AppState>,
    Path(project_id): Path<String>,
    JsonBody(req): JsonBody<ConvertToAppRequest>,
) -> Result<Json<AppResponse>, StatusCode> {
    // Get project
    let projects_result = app_state
        .database
        .list_documents("projects", Some(1000), Some(0))
        .await;
    let projects = match projects_result {
        Ok(result) => result,
        Err(e) => {
            tracing::error!("Failed to list projects: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    let project_doc = projects
        .documents
        .into_iter()
        .find(|doc| doc.data.get("id").and_then(|v| v.as_str()) == Some(&project_id));

    let project_doc = match project_doc {
        Some(doc) => doc,
        None => return Err(StatusCode::NOT_FOUND),
    };

    // Get the specific version
    let versions_result = app_state
        .database
        .list_documents("project_versions", Some(1000), Some(0))
        .await;
    let versions = match versions_result {
        Ok(result) => result,
        Err(e) => {
            tracing::error!("Failed to list project versions: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    let version_doc = versions.documents.into_iter().find(|doc| {
        doc.data.get("project_id").and_then(|v| v.as_str()) == Some(&project_id)
            && doc.data.get("version_number").and_then(|v| v.as_i64()) == Some(req.version as i64)
    });

    let version_doc = match version_doc {
        Some(doc) => doc,
        None => return Err(StatusCode::NOT_FOUND),
    };

    // Create app from project version
    let app_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let app_data = serde_json::json!({
        "id": app_id,
        "name": project_doc.data.get("name").unwrap_or(&serde_json::Value::String("Untitled App".to_string())),
        "description": project_doc.data.get("description").unwrap_or(&serde_json::Value::String("".to_string())),
        "version": req.version,
        "price": req.price.unwrap_or(0.0),
        "icon": project_doc.data.get("icon").unwrap_or(&serde_json::Value::String("📱".to_string())),
        "installed": 1,
        "source_code": version_doc.data.get("source_code").unwrap_or(&serde_json::Value::String("".to_string())),
        "prompt": version_doc.data.get("prompt").unwrap_or(&serde_json::Value::String("".to_string())),
        "model": version_doc.data.get("model"),
        "status": "published",
        "project_id": project_id,
        "project_version": req.version,
        "created_at": now
    });

    match app_state.database.create_document("apps", app_data).await {
        Ok(app_doc) => {
            let response = AppResponse {
                data: app_doc.into(),
                links: AppResponseLinks {
                    self_link: format!("/api/apps/{}", app_id),
                },
            };
            Ok(Json(response))
        },
        Err(e) => {
            tracing::error!("Failed to convert project to app: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn list_published_projects(
    State(app_state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> Result<Json<ProjectListResponse>, StatusCode> {
    // Get all projects from the database (we need to get all first, then filter)
    let projects_result = app_state
        .database
        .list_documents("projects", None, None)
        .await;
    let projects = match projects_result {
        Ok(result) => result,
        Err(e) => {
            tracing::error!("Failed to list projects: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    // Get all versions for enrichment
    let versions_result = app_state
        .database
        .list_documents("project_versions", None, None)
        .await;
    let versions = match versions_result {
        Ok(result) => result,
        Err(e) => {
            tracing::error!("Failed to list project versions: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    // Filter for published projects and enrich with version data
    let all_published_projects: Vec<serde_json::Value> = projects
        .documents
        .into_iter()
        .filter(|doc| {
            doc.data
                .get("status")
                .and_then(|v| v.as_str())
                .map(|s| s == "published")
                .unwrap_or(false)
        })
        .map(|doc| {
            let project_id = doc.data.get("id").and_then(|v| v.as_str()).unwrap_or("");

            // Find all versions for this project
            let project_versions: Vec<_> = versions
                .documents
                .iter()
                .filter(|version_doc| {
                    version_doc.data.get("project_id").and_then(|v| v.as_str()) == Some(project_id)
                })
                .map(|version_doc| &version_doc.data)
                .collect();

            // Create project data in the format expected by the frontend
            let project_data = serde_json::json!({
                "id": doc.data.get("id").unwrap_or(&serde_json::Value::Null),
                "name": doc.data.get("name").unwrap_or(&serde_json::Value::String("Untitled".to_string())),
                "description": doc.data.get("description").unwrap_or(&serde_json::Value::String("".to_string())),
                "icon": doc.data.get("icon").unwrap_or(&serde_json::Value::String("📱".to_string())),
                "status": doc.data.get("status").unwrap_or(&serde_json::Value::String("published".to_string())),
                "current_version": doc.data.get("current_version").unwrap_or(&serde_json::Value::Number(0.into())),
                "initial_prompt": doc.data.get("initial_prompt").unwrap_or(&serde_json::Value::String("".to_string())),
                "initial_model": doc.data.get("initial_model"),
                "created_at": doc.data.get("created_at").unwrap_or(&serde_json::Value::String(doc.created_at.to_rfc3339())),
                "updated_at": doc.data.get("updated_at").unwrap_or(&serde_json::Value::String(doc.updated_at.to_rfc3339())),
                "versions": project_versions
            });

            project_data
        })
        .collect();

    let total_count = all_published_projects.len() as i64;

    // Apply pagination after filtering
    let limit = query.limit.unwrap_or(100) as usize;
    let offset = query.offset.unwrap_or(0) as usize;

    let published_projects: Vec<serde_json::Value> = all_published_projects
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect();

    // Convert serde_json::Value projects to Project structs
    let projects: Vec<crate::models::Project> = published_projects.into_iter().map(|project_data| {
        // Create a mock Document to use the From<Document> trait
        let doc = crate::models::Document {
            id: project_data.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            collection: "projects".to_string(),
            data: project_data,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        };
        doc.into()
    }).collect();

    let response = ProjectListResponse {
        data: projects,
        meta: ProjectListMeta {
            count: total_count,
            limit: query.limit.unwrap_or(100),
            offset: query.offset.unwrap_or(0),
        },
        links: ProjectListLinks {
            self_link: "/api/published-projects".to_string(),
            collection: "/api/projects".to_string(),
        },
    };
    Ok(Json(response))
}
