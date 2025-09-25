use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct Document {
    pub id: String,
    pub collection: String,
    #[schemars(schema_with = "json_value_schema")]
    pub data: Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct CreateDocumentRequest {
    #[schemars(schema_with = "json_value_schema")]
    pub data: Value,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct UpdateDocumentRequest {
    #[schemars(schema_with = "json_value_schema")]
    pub data: Value,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct QueryResult {
    pub documents: Vec<Document>,
    pub count: i64,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct QueryRequest {
    pub query: String,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct ApiResponse<T> where T: JsonSchema {
    pub data: T,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub links: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct ErrorResponse {
    pub error: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct MessageResponse {
    pub message: String,
}

/// Schema function for serde_json::Value to generate a proper JSON schema
fn json_value_schema(_gen: &mut schemars::gen::SchemaGenerator) -> schemars::schema::Schema {
    use schemars::schema::*;
    Schema::Object(SchemaObject {
        metadata: Some(Box::new(Metadata {
            description: Some("Any JSON value".to_string()),
            ..Default::default()
        })),
        instance_type: None,
        ..Default::default()
    })
}

// Conversion functions between Document and typed structs
impl From<Document> for App {
    fn from(doc: Document) -> Self {
        let data = &doc.data;
        App {
            id: data.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            name: data.get("name").and_then(|v| v.as_str()).unwrap_or("Untitled App").to_string(),
            description: data.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            version: data.get("version")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| data.get("version")
                    .and_then(|v| v.as_i64())
                    .map(|i| i.to_string())
                    .unwrap_or_else(|| "1".to_string())),
            price: data.get("price").and_then(|v| v.as_f64()).unwrap_or(0.0),
            icon: data.get("icon").and_then(|v| v.as_str()).unwrap_or("📱").to_string(),
            installed: data.get("installed").and_then(|v| v.as_i64()).unwrap_or(1) as i32,
            source_code: data.get("source_code").and_then(|v| v.as_str()).map(|s| s.to_string()),
            prompt: data.get("prompt").and_then(|v| v.as_str()).map(|s| s.to_string()),
            model: data.get("model").and_then(|v| v.as_str()).map(|s| s.to_string()),
            status: data.get("status").and_then(|v| v.as_str()).unwrap_or("draft").to_string(),
            project_id: data.get("project_id").and_then(|v| v.as_str()).map(|s| s.to_string()),
            project_version: data.get("project_version").and_then(|v| v.as_i64()).map(|i| i as i32),
            created_at: data.get("created_at")
                .and_then(|v| v.as_str())
                .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or(doc.created_at),
        }
    }
}

impl From<Document> for Project {
    fn from(doc: Document) -> Self {
        let data = &doc.data;
        Project {
            id: data.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            name: data.get("name").and_then(|v| v.as_str()).unwrap_or("Untitled Project").to_string(),
            description: data.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            icon: data.get("icon").and_then(|v| v.as_str()).unwrap_or("📋").to_string(),
            status: data.get("status").and_then(|v| v.as_str()).unwrap_or("draft").to_string(),
            current_version: data.get("current_version").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
            initial_prompt: data.get("initial_prompt").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            initial_model: data.get("initial_model").and_then(|v| v.as_str()).map(|s| s.to_string()),
            created_at: data.get("created_at")
                .and_then(|v| v.as_str())
                .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or(doc.created_at),
            updated_at: data.get("updated_at")
                .and_then(|v| v.as_str())
                .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or(doc.updated_at),
            versions: None, // Will be populated separately when needed
        }
    }
}

impl From<Document> for ProjectVersion {
    fn from(doc: Document) -> Self {
        let data = &doc.data;
        ProjectVersion {
            id: data.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            project_id: data.get("project_id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            version_number: data.get("version_number").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
            prompt: data.get("prompt").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            source_code: data.get("source_code").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            model: data.get("model").and_then(|v| v.as_str()).map(|s| s.to_string()),
            created_at: data.get("created_at")
                .and_then(|v| v.as_str())
                .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or(doc.created_at),
        }
    }
}

impl From<Document> for DashboardLayout {
    fn from(doc: Document) -> Self {
        let data = &doc.data;
        let widgets: Vec<DashboardWidget> = data.get("widgets")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();

        DashboardLayout {
            id: data.get("id").and_then(|v| v.as_str()).unwrap_or("default_layout").to_string(),
            widgets,
            updated_at: data.get("updated_at")
                .and_then(|v| v.as_str())
                .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or(doc.updated_at),
        }
    }
}

// Project domain models
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub status: String,
    pub current_version: i32,
    pub initial_prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub initial_model: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub versions: Option<Vec<ProjectVersion>>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct ProjectVersion {
    pub id: String,
    pub project_id: String,
    pub version_number: i32,
    pub prompt: String,
    pub source_code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub created_at: DateTime<Utc>,
}

// Project-related requests
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct CreateProjectRequest {
    pub prompt: String,
    pub model: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct UpdateProjectRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct CreateVersionRequest {
    pub prompt: String,
    pub source_code: String,
    pub model: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct ReleaseVersionRequest {
    pub version_number: i32,
    pub price: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct ConvertToAppRequest {
    pub version: i32,
    pub price: Option<f64>,
}

// App domain models
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct App {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub price: f64,
    pub icon: String,
    pub installed: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_version: Option<i32>,
    pub created_at: DateTime<Utc>,
}

// App-related requests
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct CreateAppRequest {
    pub prompt: String,
    pub model: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub price: f64,
    pub icon: String,
    pub source_code: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct UpdateAppSourceCodeRequest {
    pub source_code: String,
}

// Dashboard domain models
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct DashboardLayout {
    pub id: String,
    pub widgets: Vec<DashboardWidget>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct DashboardWidget {
    pub id: String,
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    pub min_w: Option<i32>,
    pub min_h: Option<i32>,
    pub max_w: Option<i32>,
    pub max_h: Option<i32>,
    pub no_resize: Option<bool>,
    pub no_move: Option<bool>,
}

// Dashboard-related requests
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct SaveDashboardLayoutRequest {
    pub widgets: Vec<DashboardWidget>,
}

// AI Models
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub speed: u8,
    pub power: u8,
    pub cost: u8,
    pub special_label: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct ModelInfoResponse {
    pub data: Vec<ModelInfo>,
    pub has_more: bool,
    pub first_id: Option<String>,
    pub last_id: Option<String>,
}

// Standard API responses
#[derive(Debug, Serialize, JsonSchema)]
pub struct CollectionListResponse {
    pub data: Vec<String>,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct DocumentListResponse {
    pub data: Vec<Document>,
    pub has_more: bool,
    pub first_id: Option<String>,
    pub last_id: Option<String>,
}

// Generic typed list response for database operations
#[derive(Debug, Serialize, JsonSchema)]
pub struct TypedListResponse<T> where T: JsonSchema {
    pub data: Vec<T>,
    pub has_more: bool,
    pub first_id: Option<String>,
    pub last_id: Option<String>,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct SuccessResponse {
    pub message: String,
}

// App response types
#[derive(Debug, Serialize, JsonSchema)]
pub struct AppListResponse {
    pub data: Vec<App>,
    pub meta: AppListMeta,
    pub links: AppListLinks,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct AppListMeta {
    pub count: i64,
    pub limit: i64,
    pub offset: i64,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct AppListLinks {
    #[serde(rename = "self")]
    pub self_link: String,
    pub collection: String,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct AppResponse {
    pub data: App,
    pub links: AppResponseLinks,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct AppResponseLinks {
    #[serde(rename = "self")]
    pub self_link: String,
}

// Project response types
#[derive(Debug, Serialize, JsonSchema)]
pub struct ProjectListResponse {
    pub data: Vec<Project>,
    pub meta: ProjectListMeta,
    pub links: ProjectListLinks,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct ProjectListMeta {
    pub count: i64,
    pub limit: i64,
    pub offset: i64,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct ProjectListLinks {
    #[serde(rename = "self")]
    pub self_link: String,
    pub collection: String,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct ProjectResponse {
    pub data: Project,
    pub links: ProjectResponseLinks,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct ProjectResponseLinks {
    #[serde(rename = "self")]
    pub self_link: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub versions: Option<String>,
}

// Project Version response types
#[derive(Debug, Serialize, JsonSchema)]
pub struct ProjectVersionListResponse {
    pub data: Vec<ProjectVersion>,
    pub meta: ProjectVersionListMeta,
    pub links: ProjectVersionListLinks,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct ProjectVersionListMeta {
    pub count: i64,
    pub project_id: String,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct ProjectVersionListLinks {
    #[serde(rename = "self")]
    pub self_link: String,
    pub project: String,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct ProjectVersionResponse {
    pub data: ProjectVersion,
    pub links: ProjectVersionResponseLinks,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct ProjectVersionResponseLinks {
    #[serde(rename = "self")]
    pub self_link: String,
    pub project: String,
}

// Dashboard response types
#[derive(Debug, Serialize, JsonSchema)]
pub struct DashboardLayoutResponse {
    pub data: DashboardLayout,
    pub links: DashboardLayoutResponseLinks,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct DashboardLayoutResponseLinks {
    #[serde(rename = "self")]
    pub self_link: String,
}