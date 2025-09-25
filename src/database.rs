use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{Column, Pool, Row, Sqlite, SqlitePool};
use uuid::Uuid;

use crate::models::{Document, QueryResult};

#[derive(Debug, Clone)]
pub struct Database {
    pool: Pool<Sqlite>,
}

impl Database {
    pub async fn new(database_url: &str) -> Result<Self, sqlx::Error> {
        let pool = SqlitePool::connect(database_url).await?;

        // Create documents table if it doesn't exist
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                collection TEXT NOT NULL,
                data TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            "#,
        )
        .execute(&pool)
        .await?;

        // Create indexes for better performance
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_collection ON documents(collection)")
            .execute(&pool)
            .await?;

        sqlx::query("CREATE INDEX IF NOT EXISTS idx_created_at ON documents(created_at)")
            .execute(&pool)
            .await?;

        let database = Database { pool };

        // Seed default apps if none exist
        database.seed_default_apps().await?;

        Ok(database)
    }

    pub async fn create_document(
        &self,
        collection: &str,
        data: Value,
    ) -> Result<Document, sqlx::Error> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let data_str = serde_json::to_string(&data).unwrap();

        let document = Document {
            id: id.clone(),
            collection: collection.to_string(),
            data,
            created_at: now,
            updated_at: now,
        };

        sqlx::query(
            r#"
            INSERT INTO documents (id, collection, data, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            "#,
        )
        .bind(&id)
        .bind(collection)
        .bind(&data_str)
        .bind(&now.to_rfc3339())
        .bind(&now.to_rfc3339())
        .execute(&self.pool)
        .await?;

        Ok(document)
    }

    pub async fn get_document(
        &self,
        collection: &str,
        id: &str,
    ) -> Result<Option<Document>, sqlx::Error> {
        let row = sqlx::query(
            r#"
            SELECT id, collection, data, created_at, updated_at
            FROM documents
            WHERE collection = ? AND id = ?
            "#,
        )
        .bind(collection)
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;

        match row {
            Some(row) => {
                let data: Value = serde_json::from_str(row.get("data")).unwrap();
                let created_at = DateTime::parse_from_rfc3339(row.get("created_at"))
                    .unwrap()
                    .with_timezone(&Utc);
                let updated_at = DateTime::parse_from_rfc3339(row.get("updated_at"))
                    .unwrap()
                    .with_timezone(&Utc);

                Ok(Some(Document {
                    id: row.get("id"),
                    collection: row.get("collection"),
                    data,
                    created_at,
                    updated_at,
                }))
            }
            None => Ok(None),
        }
    }

    pub async fn update_document(
        &self,
        collection: &str,
        id: &str,
        data: Value,
    ) -> Result<Option<Document>, sqlx::Error> {
        let now = Utc::now();
        let data_str = serde_json::to_string(&data).unwrap();

        let affected_rows = sqlx::query(
            r#"
            UPDATE documents
            SET data = ?, updated_at = ?
            WHERE collection = ? AND id = ?
            "#,
        )
        .bind(data_str)
        .bind(now.to_rfc3339())
        .bind(collection)
        .bind(id)
        .execute(&self.pool)
        .await?
        .rows_affected();

        if affected_rows == 0 {
            Ok(None)
        } else {
            self.get_document(collection, id).await
        }
    }

    pub async fn delete_document(&self, collection: &str, id: &str) -> Result<bool, sqlx::Error> {
        let affected_rows = sqlx::query(
            r#"
            DELETE FROM documents
            WHERE collection = ? AND id = ?
            "#,
        )
        .bind(collection)
        .bind(id)
        .execute(&self.pool)
        .await?
        .rows_affected();

        Ok(affected_rows > 0)
    }

    pub async fn list_documents(
        &self,
        collection: &str,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<QueryResult, sqlx::Error> {
        let limit = limit.unwrap_or(100).min(1000); // Cap at 1000 for performance
        let offset = offset.unwrap_or(0);

        let rows = sqlx::query(
            r#"
            SELECT id, collection, data, created_at, updated_at
            FROM documents
            WHERE collection = ?
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
            "#,
        )
        .bind(collection)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?;

        let documents: Vec<Document> = rows
            .into_iter()
            .map(|row| {
                let data: Value = serde_json::from_str(row.get("data")).unwrap();
                let created_at = DateTime::parse_from_rfc3339(row.get("created_at"))
                    .unwrap()
                    .with_timezone(&Utc);
                let updated_at = DateTime::parse_from_rfc3339(row.get("updated_at"))
                    .unwrap()
                    .with_timezone(&Utc);

                Document {
                    id: row.get("id"),
                    collection: row.get("collection"),
                    data,
                    created_at,
                    updated_at,
                }
            })
            .collect();

        let count_row = sqlx::query("SELECT COUNT(*) as count FROM documents WHERE collection = ?")
            .bind(collection)
            .fetch_one(&self.pool)
            .await?;

        Ok(QueryResult {
            documents,
            count: count_row.get("count"),
        })
    }

    pub async fn list_collections(&self) -> Result<Vec<String>, sqlx::Error> {
        let rows = sqlx::query("SELECT DISTINCT collection FROM documents ORDER BY collection")
            .fetch_all(&self.pool)
            .await?;

        Ok(rows.into_iter().map(|row| row.get("collection")).collect())
    }

    pub async fn execute_raw_query(
        &self,
        query: &str,
    ) -> Result<Vec<serde_json::Value>, sqlx::Error> {
        let trimmed_query = query.trim().to_lowercase();

        // Only allow SELECT and PRAGMA queries for security
        if !trimmed_query.starts_with("select") && !trimmed_query.starts_with("pragma") {
            return Err(sqlx::Error::Configuration(
                "Only SELECT and PRAGMA queries are allowed".into(),
            ));
        }

        let rows = sqlx::query(query).fetch_all(&self.pool).await?;

        let mut results = Vec::new();

        for row in rows {
            let mut json_row = serde_json::Map::new();

            // Get all column names and values
            for (i, column) in row.columns().iter().enumerate() {
                let column_name = column.name();

                // Try to get the value as different types
                let value = if let Ok(val) = row.try_get::<String, _>(i) {
                    serde_json::Value::String(val)
                } else if let Ok(val) = row.try_get::<i64, _>(i) {
                    serde_json::Value::Number(val.into())
                } else if let Ok(val) = row.try_get::<f64, _>(i) {
                    serde_json::Value::Number(serde_json::Number::from_f64(val).unwrap_or(0.into()))
                } else if let Ok(val) = row.try_get::<bool, _>(i) {
                    serde_json::Value::Bool(val)
                } else {
                    // If we can't convert it, try as string or null
                    row.try_get::<Option<String>, _>(i)
                        .map(|opt| {
                            opt.map(serde_json::Value::String)
                                .unwrap_or(serde_json::Value::Null)
                        })
                        .unwrap_or(serde_json::Value::Null)
                };

                json_row.insert(column_name.to_string(), value);
            }

            results.push(serde_json::Value::Object(json_row));
        }

        Ok(results)
    }

    pub async fn reset_database(&self) -> Result<(), sqlx::Error> {
        // Drop the documents table
        sqlx::query("DROP TABLE IF EXISTS documents")
            .execute(&self.pool)
            .await?;

        // Recreate the documents table with indexes
        sqlx::query(
            r#"
            CREATE TABLE documents (
                id TEXT PRIMARY KEY,
                collection TEXT NOT NULL,
                data TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        // Recreate indexes
        sqlx::query("CREATE INDEX idx_collection ON documents(collection)")
            .execute(&self.pool)
            .await?;

        sqlx::query("CREATE INDEX idx_created_at ON documents(created_at)")
            .execute(&self.pool)
            .await?;

        // Re-seed default apps after reset
        self.seed_default_apps().await?;

        Ok(())
    }
}