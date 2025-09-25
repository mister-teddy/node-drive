use serde_json::json;

use crate::database::Database;

impl Database {
    pub async fn seed_default_apps(&self) -> Result<(), sqlx::Error> {
        // Check if any apps already exist
        let existing_apps = self.list_documents("apps", Some(1), Some(0)).await?;

        if existing_apps.documents.is_empty() {
            tracing::info!("No apps found, seeding default apps");

            let default_apps = vec![
                json!({
                    "id": "notepad",
                    "name": "Notepad",
                    "description": "A simple notepad for quick notes and ideas.",
                    "version": "1.0.0",
                    "price": 0,
                    "icon": "📝",
                    "installed": 1,
                    "source_code": include_str!("../templates/notepad.js")
                }),
                json!({
                    "id": "db-viewer",
                    "name": "DB Viewer",
                    "description": "Browse and manage your database collections and documents.",
                    "version": "1.0.0",
                    "price": 0,
                    "icon": "🗃️",
                    "installed": 1,
                    "source_code": include_str!("../templates/db-viewer.js")
                }),
                json!({
                    "id": "to-do-list",
                    "name": "To-Do List",
                    "description": "Manage your tasks and stay organized.",
                    "version": "1.2.3",
                    "price": 2.99,
                    "icon": "✅",
                    "installed": 0
                }),
                json!({
                    "id": "calendar",
                    "name": "Calendar",
                    "description": "View and schedule your events easily.",
                    "version": "2.1.0",
                    "price": 4.99,
                    "icon": "📅",
                    "installed": 0
                }),
                json!({
                    "id": "chess",
                    "name": "Chess",
                    "description": "Play chess and challenge your mind.",
                    "version": "1.8.7",
                    "price": 7.50,
                    "icon": "♟️",
                    "installed": 0
                }),
                json!({
                    "id": "file-drive",
                    "name": "File Drive",
                    "description": "Store and access your files securely.",
                    "version": "3.0.2",
                    "price": 9.99,
                    "icon": "🗂️",
                    "installed": 0
                }),
                json!({
                    "id": "calculator",
                    "name": "Calculator",
                    "description": "Perform quick calculations and solve equations.",
                    "version": "2.4.1",
                    "price": 1.99,
                    "icon": "🧮",
                    "installed": 0
                }),
                json!({
                    "id": "stocks",
                    "name": "Stocks",
                    "description": "Track stock prices and market trends.",
                    "version": "1.5.9",
                    "price": 8.99,
                    "icon": "📈",
                    "installed": 0
                }),
            ];

            for app_data in default_apps {
                self.create_document("apps", app_data).await?;
            }

            tracing::info!("Successfully seeded {} default apps", 8);
        } else {
            tracing::info!("Apps already exist, skipping seeding");
        }

        Ok(())
    }
}
