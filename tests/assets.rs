mod fixtures;
mod utils;

use fixtures::{server, Error, TestServer};
use rstest::rstest;

#[rstest]
fn asset_js(server: TestServer) -> Result<(), Error> {
    let url = format!("{}index.js", server.url());
    let resp = reqwest::blocking::get(url)?;
    assert_eq!(resp.status(), 200);
    assert_eq!(
        resp.headers().get("content-type").unwrap(),
        "text/javascript; charset=UTF-8"
    );
    Ok(())
}

#[rstest]
fn asset_css(server: TestServer) -> Result<(), Error> {
    let url = format!("{}index.css", server.url());
    let resp = reqwest::blocking::get(url)?;
    assert_eq!(resp.status(), 200);
    assert_eq!(
        resp.headers().get("content-type").unwrap(),
        "text/css; charset=UTF-8"
    );
    Ok(())
}

#[rstest]
#[ignore = "Path prefix feature needs additional work to rewrite SPA asset paths"]
fn assets_with_prefix(#[with(&["--path-prefix", "xyz"])] server: TestServer) -> Result<(), Error> {
    let resp = reqwest::blocking::get(format!("{}xyz/", server.url()))?;
    let index_js = "/xyz/index.js";
    let index_css = "/xyz/index.css";
    let favicon_ico = "/xyz/favicon.ico";
    let text = resp.text()?;
    assert!(text.contains(&format!(r#"href="{index_css}""#)));
    assert!(text.contains(&format!(r#"href="{favicon_ico}""#)));
    assert!(text.contains(&format!(r#"src="{index_js}""#)));
    Ok(())
}

#[rstest]
#[ignore = "Path prefix feature needs additional work to rewrite SPA asset paths"]
fn asset_js_with_prefix(
    #[with(&["--path-prefix", "xyz"])] server: TestServer,
) -> Result<(), Error> {
    let url = format!("{}xyz/index.js", server.url());
    let resp = reqwest::blocking::get(url)?;
    assert_eq!(resp.status(), 200);
    assert_eq!(
        resp.headers().get("content-type").unwrap(),
        "text/javascript; charset=UTF-8"
    );
    Ok(())
}
