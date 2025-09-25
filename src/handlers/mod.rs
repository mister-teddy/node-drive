pub mod apps;
pub mod dashboard;
pub mod database;
pub mod docs;
pub mod projects;

// Re-export database handlers
pub use database::*;

// Re-export project handlers
pub use projects::*;

// Re-export app handlers
pub use apps::*;

// Re-export dashboard handlers
pub use dashboard::*;

// docs handlers deprecated - using aide for OpenAPI generation