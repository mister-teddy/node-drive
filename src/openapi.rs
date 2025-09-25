use aide::openapi::{Info, OpenApi};

/// Create OpenAPI specification using aide
pub fn create_openapi_spec() -> OpenApi {
    OpenApi {
        info: Info {
            title: "Mini Server API".to_string(),
            version: "0.1.0".to_string(),
            description: Some("P2P App Ecosystem - decentralized web store API for creating, distributing, and purchasing apps via peer-to-peer network".to_string()),
            ..Info::default()
        },
        ..OpenApi::default()
    }
}
