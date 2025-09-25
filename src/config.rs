use std::env;

/// Configuration constants for the application
pub struct Config;

impl Config {
    /// Anthropic API base URL
    pub const ANTHROPIC_API_BASE_URL: &'static str = "https://api.anthropic.com/v1";

    /// Anthropic API version header value
    pub const ANTHROPIC_API_VERSION: &'static str = "2023-06-01";

    /// Default model for Anthropic API calls
    pub const DEFAULT_MODEL: &'static str = "claude-3-haiku-20240307";

    /// Get the Anthropic API key from environment
    pub fn anthropic_api_key() -> Result<String, String> {
        env::var("ANTHROPIC_API_KEY").map_err(|_| {
            "ANTHROPIC_API_KEY environment variable is required".to_string()
        })
    }

    /// Get the full URL for the models endpoint
    pub fn anthropic_models_url() -> String {
        format!("{}/models", Self::ANTHROPIC_API_BASE_URL)
    }

    /// Get the full URL for the messages endpoint
    pub fn anthropic_messages_url() -> String {
        format!("{}/messages", Self::ANTHROPIC_API_BASE_URL)
    }
}