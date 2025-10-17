use anyhow::{anyhow, Result};
use sha2::{Digest, Sha256};
use std::path::Path;
use tokio::fs;
use tokio::io::AsyncReadExt;

/// File metadata information commonly needed across the application
#[derive(Debug, Clone)]
pub struct FileInfo {
    pub exists: bool,
    pub is_dir: bool,
    pub is_file: bool,
    pub size: u64,
}

/// Compute SHA-256 hash of a file's contents
/// This is the canonical implementation used throughout the codebase
pub async fn sha256_file_hash(path: &Path) -> Result<String> {
    let mut file = fs::File::open(path).await?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 8192];

    loop {
        let bytes_read = file.read(&mut buffer).await?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }

    let result = hasher.finalize();
    Ok(format!("{result:x}"))
}

/// Get comprehensive file metadata information
pub async fn get_file_info(path: &Path) -> FileInfo {
    match fs::metadata(path).await {
        Ok(meta) => FileInfo {
            exists: true,
            is_dir: meta.is_dir(),
            is_file: meta.is_file(),
            size: meta.len(),
        },
        Err(_) => FileInfo {
            exists: false,
            is_dir: false,
            is_file: false,
            size: 0,
        },
    }
}

/// Extract filename from path, returns error if invalid
pub fn extract_filename(path: &Path) -> Result<&str> {
    path.file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| anyhow!("Invalid filename in path: {}", path.display()))
}

/// Open file and get metadata concurrently
/// Returns (file_handle, metadata)
pub async fn open_file_with_metadata(path: &Path) -> Result<(fs::File, std::fs::Metadata)> {
    let (file, meta) = tokio::join!(fs::File::open(path), fs::metadata(path));
    Ok((file?, meta?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_get_file_info_nonexistent() {
        let info = get_file_info(Path::new("/nonexistent/path/test.txt")).await;
        assert!(!info.exists);
        assert!(!info.is_file);
        assert!(!info.is_dir);
        assert_eq!(info.size, 0);
    }

    #[test]
    fn test_extract_filename() {
        let path = Path::new("/path/to/file.txt");
        assert_eq!(extract_filename(path).unwrap(), "file.txt");

        let path = Path::new("file.txt");
        assert_eq!(extract_filename(path).unwrap(), "file.txt");
    }
}
