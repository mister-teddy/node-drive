use std::env;
use std::sync::Arc;

#[tokio::main]
async fn main() {
    dotenv::dotenv().ok();
    tracing_subscriber::fmt::init();

    // Initialize database
    let database_url = env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite:data.db".to_string());
    let database = Arc::new(
        mini_server::database::Database::new(&database_url)
            .await
            .expect("Failed to initialize database"),
    );

    tracing::info!("Database initialized at: {}", database_url);

    let port = env::var("PORT").unwrap_or_else(|_| "10000".to_string());
    let addr = format!("0.0.0.0:{}", port);

    tracing::info!("Listening on {}", addr);

    let app = mini_server::create_router(database);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
