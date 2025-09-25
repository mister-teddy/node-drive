use axum::extract::State;
use axum::http::StatusCode;
use axum::response::sse::{Event, Sse};
use axum::Json;
use futures::stream::Stream;
use reqwest::Client;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use std::time::Duration;

use crate::config::Config;
use crate::AppState;

#[derive(Debug, Clone)]
pub enum RequestMethod {
    Get,
    Post,
}

#[derive(Debug, Clone)]
pub enum ResponseHandling {
    Standard,
    Streaming,
}

/// Send a request to Anthropic API with configurable method and response handling
pub async fn anthropic_request(
    client: &Client,
    method: RequestMethod,
    endpoint_url: &str,
    body: Option<&serde_json::Value>,
    response_handling: ResponseHandling,
) -> Result<reqwest::Response, Box<dyn std::error::Error + Send + Sync>> {
    let api_key = Config::anthropic_api_key().map_err(|e| e)?;

    let mut request_builder = match method {
        RequestMethod::Get => client.get(endpoint_url),
        RequestMethod::Post => client.post(endpoint_url),
    };

    request_builder = request_builder
        .header("x-api-key", api_key)
        .header("anthropic-version", Config::ANTHROPIC_API_VERSION);

    if let RequestMethod::Post = method {
        request_builder = request_builder.header("Content-Type", "application/json");
        if let Some(body) = body {
            request_builder = request_builder.json(body);
        }
    }

    let response = request_builder
        .send()
        .await
        .map_err(|e| format!("Failed to send request to Anthropic API: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());

        match response_handling {
            ResponseHandling::Standard => {
                tracing::error!("Anthropic API error: {} - {}", status, error_text);
                return Err(format!("Anthropic API error: {}", status).into());
            }
            ResponseHandling::Streaming => {
                return Err(format!("Anthropic API error: {} - {}", status, error_text).into());
            }
        }
    }

    Ok(response)
}

#[derive(Deserialize, JsonSchema)]
pub struct GenerateRequest {
    pub prompt: String,
    pub model: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
pub struct ModifyCodeRequest {
    pub existing_code: String,
    pub modification_prompt: String,
    pub model: Option<String>,
}

#[derive(Serialize, Deserialize, JsonSchema)]
pub struct AppMetadata {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub price: f64,
    pub icon: String,
}

#[derive(Serialize, Deserialize, JsonSchema)]
pub struct AnthropicModel {
    pub id: String,
    pub display_name: String,
    pub created_at: String,
    #[serde(rename = "type")]
    pub model_type: String,
}

#[derive(Serialize, Deserialize, JsonSchema)]
pub struct ModelsResponse {
    pub data: Vec<AnthropicModel>,
    pub has_more: bool,
    pub first_id: Option<String>,
    pub last_id: Option<String>,
}

#[derive(Serialize, Deserialize, JsonSchema)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub power: u8,                     // 1-5 rating for model capability
    pub cost: u8,                      // 1-5 rating for resource consumption (1=cheap, 5=expensive)
    pub speed: u8,                     // 1-5 rating for response speed (1=slow, 5=fast)
    pub special_label: Option<String>, // "flagship", "most powerful", etc.
}

#[derive(Serialize, Deserialize, JsonSchema)]
pub struct ModelInfoResponse {
    pub data: Vec<ModelInfo>,
    pub has_more: bool,
    pub first_id: Option<String>,
    pub last_id: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct AnthropicResponse {
    pub content: Option<Vec<AnthropicContent>>,
}

#[derive(Serialize, Deserialize)]
pub struct AnthropicContent {
    pub text: String,
    #[serde(rename = "type")]
    pub content_type: String,
}

#[derive(Serialize, Deserialize)]
pub struct StreamingEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub message: Option<StreamingMessage>,
    pub delta: Option<StreamingDelta>,
}

#[derive(Serialize, Deserialize)]
pub struct StreamingMessage {
    pub id: Option<String>,
    #[serde(rename = "type")]
    pub message_type: Option<String>,
    pub role: Option<String>,
    pub content: Option<Vec<StreamingContent>>,
}

#[derive(Serialize, Deserialize)]
pub struct StreamingContent {
    #[serde(rename = "type")]
    pub content_type: String,
    pub text: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct StreamingDelta {
    #[serde(rename = "type")]
    pub delta_type: Option<String>,
    pub text: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct UsageInfo {
    pub input_tokens: i32,
    pub output_tokens: i32,
}

#[derive(Serialize, Deserialize)]
pub struct StreamingUsage {
    pub usage: Option<UsageInfo>,
}

#[derive(Serialize)]
pub struct AnthropicMessage {
    pub role: String,
    pub content: Vec<AnthropicMessageContent>,
}

#[derive(Serialize)]
pub struct AnthropicMessageContent {
    #[serde(rename = "type")]
    pub content_type: String,
    pub text: String,
}

// Prefill tokens to help guide the AI response format
const PREFILL_TOKENS: &str = "function";

// Model metadata with power ratings and special labels
fn get_model_metadata(model_id: &str) -> ModelInfo {
    match model_id {
        "claude-3-haiku-20240307" => ModelInfo {
            id: model_id.to_string(),
            name: "Claude 3 Haiku".to_string(),
            description: "Fast and cost-effective for simple tasks".to_string(),
            icon: "⚡".to_string(),
            power: 2,
            cost: 1,
            speed: 5,
            special_label: None,
        },
        "claude-3-5-haiku-20241022" => ModelInfo {
            id: model_id.to_string(),
            name: "Claude 3.5 Haiku".to_string(),
            description: "Enhanced speed and intelligence".to_string(),
            icon: "🚀".to_string(),
            power: 3,
            cost: 2,
            speed: 5,
            special_label: Some("latest".to_string()),
        },
        "claude-3-5-sonnet-20241022" => ModelInfo {
            id: model_id.to_string(),
            name: "Claude 3.5 Sonnet".to_string(),
            description: "Balanced performance and capability".to_string(),
            icon: "🎼".to_string(),
            power: 4,
            cost: 3,
            speed: 4,
            special_label: Some("flagship".to_string()),
        },
        "claude-sonnet-4-20250514" => ModelInfo {
            id: model_id.to_string(),
            name: "Claude Sonnet 4".to_string(),
            description: "Most advanced model with superior intelligence".to_string(),
            icon: "🧠".to_string(),
            power: 5,
            cost: 4,
            speed: 3,
            special_label: Some("most powerful".to_string()),
        },
        "claude-3-opus-20240229" => ModelInfo {
            id: model_id.to_string(),
            name: "Claude 3 Opus".to_string(),
            description: "Powerful model for complex tasks".to_string(),
            icon: "💎".to_string(),
            power: 5,
            cost: 5,
            speed: 2,
            special_label: None,
        },
        _ => ModelInfo {
            id: model_id.to_string(),
            name: format!("Model {}", model_id),
            description: "Advanced AI model".to_string(),
            icon: "🤖".to_string(),
            power: 3,
            cost: 3,
            speed: 3,
            special_label: None,
        },
    }
}

pub async fn list_models(
    State(app_state): State<AppState>,
) -> Result<Json<ModelInfoResponse>, (StatusCode, String)> {
    let response = anthropic_request(
        &app_state.client,
        RequestMethod::Get,
        &Config::anthropic_models_url(),
        None,
        ResponseHandling::Standard,
    )
    .await
    .map_err(|e| {
        tracing::error!("Failed to get models: {}", e);
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to get models: {}", e),
        )
    })?;

    let models_response: ModelsResponse = response.json().await.map_err(|e| {
        tracing::error!("Failed to parse models response: {}", e);
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to parse models response".to_string(),
        )
    })?;

    // Map API response to our ModelInfo format with metadata
    let mut model_infos: Vec<ModelInfo> = models_response
        .data
        .into_iter()
        .map(|model| get_model_metadata(&model.id))
        .collect();

    // Sort by power (descending) then name
    model_infos.sort_by(|a, b| {
        let power_cmp = b.power.cmp(&a.power); // Descending order (most powerful first)
        if power_cmp == std::cmp::Ordering::Equal {
            a.name.cmp(&b.name)
        } else {
            power_cmp
        }
    });

    let response = ModelInfoResponse {
        data: model_infos,
        has_more: models_response.has_more,
        first_id: models_response.first_id,
        last_id: models_response.last_id,
    };

    Ok(Json(response))
}

// Helper function to get model recommendations
pub fn get_model_recommendations(models: &[ModelInfo]) -> serde_json::Value {
    let most_cost_effective = models.iter().min_by_key(|m| m.cost);
    let most_powerful = models.iter().max_by_key(|m| m.power);

    serde_json::json!({
        "mostCostEffective": most_cost_effective,
        "mostPowerful": most_powerful
    })
}

// Helper function to create request body for streaming
fn create_streaming_request_body(
    model: &str,
    system_message: &str,
    messages: Vec<AnthropicMessage>,
) -> serde_json::Value {
    serde_json::json!({
        "model": model,
        "max_tokens": 4096,
        "temperature": 1.0,
        "system": system_message,
        "messages": messages,
        "stream": true,
    })
}

// Helper function to send streaming request to Anthropic API
async fn send_streaming_request(
    app_state: &AppState,
    body: &serde_json::Value,
) -> Result<reqwest::Response, String> {
    anthropic_request(
        &app_state.client,
        RequestMethod::Post,
        &Config::anthropic_messages_url(),
        Some(body),
        ResponseHandling::Streaming,
    )
    .await
    .map_err(|e| format!("Failed to send streaming request: {}", e))
}

// Helper function to process streaming response
fn process_streaming_response(
    response: reqwest::Response,
    completion_message: String,
) -> impl Stream<Item = Result<Event, Infallible>> {
    async_stream::stream! {
        yield Ok(Event::default().data("Streaming response from Anthropic API..."));

        use futures::StreamExt;
        let mut stream = response.bytes_stream();
        let mut buffer = String::new();
        let mut first_token = true;
        let mut usage_info: Option<UsageInfo> = None;

        while let Some(chunk_result) = stream.next().await {
            let bytes = match chunk_result {
                Ok(bytes) => bytes,
                Err(e) => {
                    tracing::error!("Error reading stream chunk: {}", e);
                    yield Ok(Event::default().data(format!("Error: Stream error - {}", e)));
                    return;
                }
            };

            let chunk_str = match std::str::from_utf8(&bytes) {
                Ok(s) => s,
                Err(e) => {
                    tracing::error!("Invalid UTF-8 in chunk: {}", e);
                    continue;
                }
            };

            buffer.push_str(chunk_str);

            // Process complete lines from the buffer
            while let Some(newline_pos) = buffer.find('\n') {
                let line = buffer[..newline_pos].trim().to_string();
                buffer = buffer[newline_pos + 1..].to_string();

                if line.is_empty() {
                    continue;
                }

                if line.starts_with("data: ") {
                    let data_part = &line[6..]; // Remove "data: " prefix

                    if data_part == "[DONE]" {
                        yield Ok(Event::default().data(&completion_message));
                        return;
                    }

                    // Try to parse the JSON
                    match serde_json::from_str::<StreamingEvent>(data_part) {
                        Ok(event) => {
                            match event.event_type.as_str() {
                                "message_start" => {
                                    yield Ok(Event::default().data("Starting message generation..."));
                                }
                                "content_block_delta" => {
                                    if let Some(delta) = event.delta {
                                        if let Some(mut text) = delta.text {
                                            // Prepend the prefill tokens to the first token to fix the missing character issue
                                            if first_token {
                                                text = format!("{}{}", PREFILL_TOKENS, text);
                                                first_token = false;
                                            }

                                            // Send the token as it arrives
                                            let token_event = serde_json::json!({
                                                "type": "token",
                                                "text": text
                                            });
                                            yield Ok(Event::default().event("token").data(serde_json::to_string(&token_event).unwrap_or_default()));
                                        }
                                    }
                                }
                                "message_delta" => {
                                    // Try to extract usage information from message_delta events
                                    if let Ok(usage_event) = serde_json::from_str::<StreamingUsage>(data_part) {
                                        if let Some(usage) = usage_event.usage {
                                            usage_info = Some(usage);
                                        }
                                    }
                                }
                                "message_stop" => {
                                    // Send usage information before completing
                                    if let Some(usage) = &usage_info {
                                        let usage_event = serde_json::json!({
                                            "type": "usage",
                                            "input_tokens": usage.input_tokens,
                                            "output_tokens": usage.output_tokens
                                        });
                                        yield Ok(Event::default().event("usage").data(serde_json::to_string(&usage_event).unwrap_or_default()));
                                    }
                                    yield Ok(Event::default().data(&completion_message));
                                    return;
                                }
                                _ => {
                                    // Try to parse any event for usage information
                                    if let Ok(usage_event) = serde_json::from_str::<StreamingUsage>(data_part) {
                                        if let Some(usage) = usage_event.usage {
                                            usage_info = Some(usage);
                                        }
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            tracing::debug!("Could not parse streaming event: {} (data: {})", e, data_part);
                            // Don't yield an error for parsing failures, just continue
                        }
                    }
                }
            }
        }

        yield Ok(Event::default().data("Stream ended"));
    }
}

pub async fn generate_code_stream(
    State(app_state): State<AppState>,
    Json(payload): Json<GenerateRequest>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, (axum::http::StatusCode, String)> {
    // Validate API key early
    Config::anthropic_api_key().map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e))?;

    let stream = async_stream::stream! {
        // Send initial status
        yield Ok(Event::default().data("Starting generation..."));
        tokio::time::sleep(Duration::from_millis(100)).await;

        yield Ok(Event::default().data("Preparing request to Anthropic API..."));
        tokio::time::sleep(Duration::from_millis(100)).await;

        let system_message = include_str!("../prompts/app-renderer.txt");

        let messages = vec![
            AnthropicMessage {
                role: "user".to_string(),
                content: vec![AnthropicMessageContent {
                    content_type: "text".to_string(),
                    text: payload.prompt.clone(),
                }],
            },
            AnthropicMessage {
                role: "assistant".to_string(),
                content: vec![AnthropicMessageContent {
                    content_type: "text".to_string(),
                    text: PREFILL_TOKENS.to_string(),
                }],
            },
        ];

        let model = payload.model.as_deref().unwrap_or(Config::DEFAULT_MODEL);
        let body = create_streaming_request_body(model, &system_message, messages);

        yield Ok(Event::default().data("Sending request to Anthropic API..."));

        let response = match send_streaming_request(&app_state, &body).await {
            Ok(response) => response,
            Err(e) => {
                tracing::error!("Request failed: {}", e);
                yield Ok(Event::default().data(format!("Error: {}", e)));
                return;
            }
        };

        let response_stream = process_streaming_response(response, "Generation complete!".to_string());
        let mut response_stream = std::pin::Pin::from(Box::new(response_stream));

        use futures::StreamExt;
        while let Some(event) = response_stream.next().await {
            yield event;
        }
    };

    Ok(Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(1))
            .text("keep-alive-text"),
    ))
}

pub async fn modify_code_stream(
    State(app_state): State<AppState>,
    Json(payload): Json<ModifyCodeRequest>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, (axum::http::StatusCode, String)> {
    // Validate API key early
    Config::anthropic_api_key().map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e))?;

    let stream = async_stream::stream! {
        // Send initial status
        yield Ok(Event::default().data("Starting code modification..."));
        tokio::time::sleep(Duration::from_millis(100)).await;

        yield Ok(Event::default().data("Preparing request to Anthropic API..."));
        tokio::time::sleep(Duration::from_millis(100)).await;

        let system_message = format!("{}\n\n{}", include_str!("../prompts/code-modifier.txt"), include_str!("../prompts/app-renderer.txt"));

        // Create a comprehensive prompt that includes both the existing code and modification request
        let combined_prompt = format!(
            "Here is the existing React component code that needs to be modified:\n\n```javascript\n{}\n```\n\nModification request: {}\n\nPlease output the complete modified component code.",
            payload.existing_code,
            payload.modification_prompt
        );

        let messages = vec![
            AnthropicMessage {
                role: "user".to_string(),
                content: vec![AnthropicMessageContent {
                    content_type: "text".to_string(),
                    text: combined_prompt,
                }],
            },
            AnthropicMessage {
                role: "assistant".to_string(),
                content: vec![AnthropicMessageContent {
                    content_type: "text".to_string(),
                    text: PREFILL_TOKENS.to_string(),
                }],
            },
        ];

        let model = payload.model.as_deref().unwrap_or(Config::DEFAULT_MODEL);
        let body = create_streaming_request_body(model, &system_message, messages);

        yield Ok(Event::default().data("Sending request to Anthropic API..."));

        let response = match send_streaming_request(&app_state, &body).await {
            Ok(response) => response,
            Err(e) => {
                tracing::error!("Request failed: {}", e);
                yield Ok(Event::default().data(format!("Error: {}", e)));
                return;
            }
        };

        let response_stream = process_streaming_response(response, "Code modification complete!".to_string());
        let mut response_stream = std::pin::Pin::from(Box::new(response_stream));

        use futures::StreamExt;
        while let Some(event) = response_stream.next().await {
            yield event;
        }
    };

    Ok(Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(1))
            .text("keep-alive-text"),
    ))
}

pub async fn generate_metadata_from_prompt(
    app_state: &AppState,
    prompt: &str,
    model: &Option<String>,
) -> Result<AppMetadata, StatusCode> {
    let metadata_prompt = format!(include_str!("../prompts/metadata-extractor.txt"), prompt);

    let messages = vec![AnthropicMessage {
        role: "user".to_string(),
        content: vec![AnthropicMessageContent {
            content_type: "text".to_string(),
            text: metadata_prompt,
        }],
    }];

    let model = model.as_deref().unwrap_or(Config::DEFAULT_MODEL);

    let body = serde_json::json!({
        "model": model,
        "max_tokens": 1024,
        "temperature": 0.3,
        "messages": messages,
    });

    let response = anthropic_request(
        &app_state.client,
        RequestMethod::Post,
        &Config::anthropic_messages_url(),
        Some(&body),
        ResponseHandling::Standard,
    )
    .await
    .map_err(|e| {
        tracing::error!("Failed to send request to Anthropic: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let anthropic_response: AnthropicResponse = response.json().await.map_err(|e| {
        tracing::error!("Failed to parse Anthropic response: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let content = anthropic_response
        .content
        .as_ref()
        .and_then(|c| c.first())
        .ok_or_else(|| {
            tracing::error!("No content in response");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // Extract JSON from the response (handle markdown code blocks)
    let json_text = if content.text.contains("```json") {
        // Extract JSON from markdown code block
        let start = content.text.find("```json").unwrap() + 7;
        let end = content.text.rfind("```").unwrap_or(content.text.len());
        content.text[start..end].trim()
    } else if content.text.contains("```") {
        // Extract JSON from generic code block
        let start = content.text.find("```").unwrap() + 3;
        let end = content.text.rfind("```").unwrap_or(content.text.len());
        content.text[start..end].trim()
    } else if content.text.trim().starts_with('{') {
        // Raw JSON response
        content.text.trim()
    } else {
        // Try to find JSON object in the text
        if let Some(start) = content.text.find('{') {
            if let Some(end) = content.text.rfind('}') {
                &content.text[start..=end]
            } else {
                content.text.trim()
            }
        } else {
            content.text.trim()
        }
    };

    let metadata: AppMetadata = serde_json::from_str(json_text).map_err(|e| {
        tracing::error!(
            "Failed to parse metadata JSON: {}. Raw response: {}",
            e,
            content.text
        );
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(metadata)
}
