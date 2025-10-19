//! Run file server with different args

mod fixtures;
mod utils;

use fixtures::{server, Error, TestServer};
use rstest::rstest;

#[rstest]
fn path_prefix_index(#[with(&["--path-prefix", "xyz"])] server: TestServer) -> Result<(), Error> {
    let resp = reqwest::blocking::get(format!("{}xyz/api/", server.url()))?;
    // The API now returns JSON directly
    assert_eq!(resp.status(), 200);
    let json: serde_json::Value = resp.json()?;
    let paths = json.get("paths").unwrap().as_array().unwrap();
    assert!(!paths.is_empty());
    Ok(())
}

#[rstest]
fn path_prefix_file(#[with(&["--path-prefix", "xyz"])] server: TestServer) -> Result<(), Error> {
    let resp = reqwest::blocking::get(format!("{}xyz/api/index.html", server.url()))?;
    assert_eq!(resp.status(), 200);
    assert_eq!(resp.text()?, "This is index.html");
    Ok(())
}

#[rstest]
fn path_prefix_propfind(
    #[with(&["--path-prefix", "xyz"])] server: TestServer,
) -> Result<(), Error> {
    let resp = fetch!(b"PROPFIND", format!("{}xyz/api/", server.url())).send()?;
    let text = resp.text()?;
    assert!(text.contains("<D:href>/xyz/</D:href>"));
    Ok(())
}
