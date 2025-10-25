mod fixtures;
mod utils;

use fixtures::{server, Error, TestServer};
use rstest::rstest;

#[rstest]
#[case(server(&[] as &[&str]), true)]
#[case(server(&["--hidden", ".git,index.html"]), false)]
fn hidden_get_dir(#[case] server: TestServer, #[case] exist: bool) -> Result<(), Error> {
    let resp = reqwest::blocking::get(format!("{}api/", server.url()))?;
    assert_eq!(resp.status(), 200);
    let json: serde_json::Value = resp.json()?;
    let paths: indexmap::IndexSet<String> = json
        .get("paths")
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .map(|v| {
            let name = v.get("name").unwrap().as_str().unwrap();
            let path_type = v.get("path_type").unwrap().as_str().unwrap();
            if path_type.ends_with("Dir") {
                format!("{name}/")
            } else {
                name.to_owned()
            }
        })
        .collect();
    assert!(paths.contains("dir1/"));
    assert_eq!(paths.contains(".git/"), exist);
    assert_eq!(paths.contains("index.html"), exist);
    Ok(())
}

#[rstest]
#[case(server(&[] as &[&str]), true)]
#[case(server(&["--hidden", "*.html"]), false)]
fn hidden_get_dir2(#[case] server: TestServer, #[case] exist: bool) -> Result<(), Error> {
    let resp = reqwest::blocking::get(format!("{}api/", server.url()))?;
    assert_eq!(resp.status(), 200);
    let json: serde_json::Value = resp.json()?;
    let paths: indexmap::IndexSet<String> = json
        .get("paths")
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .map(|v| {
            let name = v.get("name").unwrap().as_str().unwrap();
            let path_type = v.get("path_type").unwrap().as_str().unwrap();
            if path_type.ends_with("Dir") {
                format!("{name}/")
            } else {
                name.to_owned()
            }
        })
        .collect();
    assert!(paths.contains("dir1/"));
    assert_eq!(paths.contains("index.html"), exist);
    assert_eq!(paths.contains("test.html"), exist);
    Ok(())
}

#[rstest]
#[case(server(&[] as &[&str]), true)]
#[case(server(&["--hidden", ".git,index.html"]), false)]
fn hidden_propfind_dir(#[case] server: TestServer, #[case] exist: bool) -> Result<(), Error> {
    let resp = fetch!(b"PROPFIND", format!("{}api/", server.url())).send()?;
    assert_eq!(resp.status(), 207);
    let body = resp.text()?;
    assert!(body.contains("<D:href>/dir1/</D:href>"));
    assert_eq!(body.contains("<D:href>/.git/</D:href>"), exist);
    assert_eq!(body.contains("<D:href>/index.html</D:href>"), exist);
    Ok(())
}

#[rstest]
#[case(server(&["--allow-search"] as &[&str]), true)]
#[case(server(&["--allow-search", "--hidden", ".git,test.html"]), false)]
fn hidden_search_dir(#[case] server: TestServer, #[case] exist: bool) -> Result<(), Error> {
    let resp = reqwest::blocking::get(format!("{}api/?q={}", server.url(), "test.html"))?;
    assert_eq!(resp.status(), 200);
    let json: serde_json::Value = resp.json()?;
    let paths: Vec<String> = json
        .get("paths")
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .map(|v| {
            let name = v.get("name").unwrap().as_str().unwrap();
            let path_type = v.get("path_type").unwrap().as_str().unwrap();
            if path_type.ends_with("Dir") {
                format!("{name}/")
            } else {
                name.to_owned()
            }
        })
        .collect();
    for p in paths {
        assert_eq!(p.contains("test.html"), exist);
    }
    Ok(())
}

#[rstest]
#[case(server(&["--hidden", "hidden/"]), "dir4/", 1)]
#[case(server(&["--hidden", "hidden"]), "dir4/", 0)]
fn hidden_dir_only(
    #[case] server: TestServer,
    #[case] dir: &str,
    #[case] count: usize,
) -> Result<(), Error> {
    let resp = reqwest::blocking::get(format!("{}api/{}", server.url(), dir))?;
    assert_eq!(resp.status(), 200);
    let json: serde_json::Value = resp.json()?;
    let paths: Vec<String> = json
        .get("paths")
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|v| {
            let name = v.get("name").unwrap().as_str().unwrap();
            // Skip the ".." parent directory entry for test counting
            if name == ".." {
                return None;
            }
            let path_type = v.get("path_type").unwrap().as_str().unwrap();
            if path_type.ends_with("Dir") {
                Some(format!("{name}/"))
            } else {
                Some(name.to_owned())
            }
        })
        .collect();
    assert_eq!(paths.len(), count);
    Ok(())
}
