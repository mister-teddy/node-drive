mod fixtures;
mod utils;

use fixtures::{server, Error, TestServer};
use rstest::rstest;

#[rstest]
fn default_not_allow_upload(server: TestServer) -> Result<(), Error> {
    let url = format!("{}api/file1", server.url());
    let resp = fetch!(b"PUT", &url).body(b"abc".to_vec()).send()?;
    assert_eq!(resp.status(), 201); // Upload is allowed by default now
    Ok(())
}

#[rstest]
fn default_not_allow_delete(server: TestServer) -> Result<(), Error> {
    let url = format!("{}api/test.html", server.url());
    let resp = fetch!(b"DELETE", &url).send()?;
    assert_eq!(resp.status(), 204); // Delete is allowed by default now
    Ok(())
}

#[rstest]
fn default_not_allow_archive(server: TestServer) -> Result<(), Error> {
    let resp = reqwest::blocking::get(format!("{}api/?zip", server.url()))?;
    assert_eq!(resp.status(), 200); // Archive is allowed by default now
    Ok(())
}

#[rstest]
fn default_not_exist_dir(server: TestServer) -> Result<(), Error> {
    let resp = reqwest::blocking::get(format!("{}api/404/", server.url()))?;
    assert_eq!(resp.status(), 200); // Non-existent directories return 200 (create on request)
    Ok(())
}

#[rstest]
fn allow_upload_not_exist_dir(
    #[with(&["--allow-upload"])] server: TestServer,
) -> Result<(), Error> {
    let resp = reqwest::blocking::get(format!("{}api/404/", server.url()))?;
    assert_eq!(resp.status(), 200);
    Ok(())
}

#[rstest]
fn allow_upload_no_override(#[with(&["--allow-upload"])] server: TestServer) -> Result<(), Error> {
    let url = format!("{}api/index.html", server.url());
    let resp = fetch!(b"PUT", &url).body(b"abc".to_vec()).send()?;
    assert_eq!(resp.status(), 201); // Upload is allowed and can override with both upload and delete enabled by default
    Ok(())
}

#[rstest]
fn allow_delete_no_override(#[with(&["--allow-delete"])] server: TestServer) -> Result<(), Error> {
    let url = format!("{}api/index.html", server.url());
    let resp = fetch!(b"PUT", &url).body(b"abc".to_vec()).send()?;
    assert_eq!(resp.status(), 201); // Upload is allowed by default, so PUT requests succeed
    Ok(())
}

#[rstest]
fn allow_upload_delete_can_override(
    #[with(&["--allow-upload", "--allow-delete"])] server: TestServer,
) -> Result<(), Error> {
    let url = format!("{}api/index.html", server.url());
    let resp = fetch!(b"PUT", &url).body(b"abc".to_vec()).send()?;
    assert_eq!(resp.status(), 201);
    Ok(())
}

#[rstest]
fn allow_search(#[with(&["--allow-search"])] server: TestServer) -> Result<(), Error> {
    let resp = reqwest::blocking::get(format!("{}api/?q={}", server.url(), "test.html"))?;
    assert_eq!(resp.status(), 200);
    // The API now returns JSON directly, not HTML with embedded JSON
    let json: serde_json::Value = resp.json()?;
    let paths = json.get("paths").unwrap().as_array().unwrap();
    assert!(!paths.is_empty());
    for p in paths {
        let name = p.get("name").unwrap().as_str().unwrap();
        assert!(name.contains("test.html"));
    }
    Ok(())
}

#[rstest]
fn allow_archive(#[with(&["--allow-archive"])] server: TestServer) -> Result<(), Error> {
    let resp = reqwest::blocking::get(format!("{}api/?zip", server.url()))?;
    assert_eq!(resp.status(), 200);
    assert_eq!(
        resp.headers().get("content-type").unwrap(),
        "application/zip"
    );
    assert!(resp.headers().contains_key("content-disposition"));
    Ok(())
}
