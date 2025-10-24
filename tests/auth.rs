mod digest_auth_util;
mod fixtures;
mod utils;

use digest_auth_util::send_with_digest_auth;
use fixtures::{server, Error, TestServer};
use indexmap::IndexSet;
use rstest::rstest;

#[rstest]
fn no_auth(
    #[with(&["--auth", "user:pass@/:rw", "--allow-upload", "--allow-delete", "--allow-search", "--allow-archive", "--allow-symlink"])]
    server: TestServer,
) -> Result<(), Error> {
    let resp = reqwest::blocking::get(format!("{}api/", server.url()))?;
    assert_eq!(resp.status(), 401);
    let values: Vec<&str> = resp
        .headers()
        .get_all("www-authenticate")
        .iter()
        .map(|v| v.to_str().unwrap())
        .collect();
    assert!(values[0].starts_with("Digest"));
    assert!(values[1].starts_with("Basic"));

    let url = format!("{}api/file1", server.url());
    let resp = fetch!(b"PUT", &url).body(b"abc".to_vec()).send()?;
    assert_eq!(resp.status(), 401);
    Ok(())
}

#[rstest]
#[case(server(&["--auth", "user:pass@/:rw", "--allow-upload", "--allow-delete", "--allow-search", "--allow-archive", "--allow-symlink"]), "user", "pass")]
#[case(server(&["--auth", "user:pa:ss@1@/:rw", "--allow-upload", "--allow-delete", "--allow-search", "--allow-archive", "--allow-symlink"]), "user", "pa:ss@1")]
fn auth(#[case] server: TestServer, #[case] user: &str, #[case] pass: &str) -> Result<(), Error> {
    let url = format!("{}api/file1", server.url());
    let resp = fetch!(b"PUT", &url).body(b"abc".to_vec()).send()?;
    assert_eq!(resp.status(), 401);
    let resp = send_with_digest_auth(fetch!(b"PUT", &url).body(b"abc".to_vec()), user, pass)?;
    assert_eq!(resp.status(), 201);
    Ok(())
}

#[rstest]
fn invalid_auth(
    #[with(&["-a", "user:pass@/:rw", "-a", "@/", "--allow-upload", "--allow-delete", "--allow-search", "--allow-archive", "--allow-symlink"])]
    server: TestServer,
) -> Result<(), Error> {
    let resp = fetch!(b"GET", format!("{}api/", server.url()))
        .basic_auth("user", Some("-"))
        .send()?;
    assert_eq!(resp.status(), 401);
    let resp = fetch!(b"GET", format!("{}api/", server.url()))
        .basic_auth("-", Some("pass"))
        .send()?;
    assert_eq!(resp.status(), 401);
    let resp = fetch!(b"GET", format!("{}api/", server.url()))
        .header("Authorization", "Basic Og==")
        .send()?;
    assert_eq!(resp.status(), 401);
    Ok(())
}

#[rstest]
#[case(server(&["--auth", "user:$6$gQxZwKyWn/ZmWEA2$4uV7KKMnSUnET2BtWTj/9T5.Jq3h/MdkOlnIl5hdlTxDZ4MZKmJ.kl6C.NL9xnNPqC4lVHC1vuI0E5cLpTJX81@/:rw", "--allow-upload", "--allow-delete", "--allow-search", "--allow-archive", "--allow-symlink"]), "user", "pass")]
#[case(server(&["--auth", "user:$6$YV1J6OHZAAgbzCbS$V55ZEgvJ6JFdz1nLO4AD696PRHAJYhfQf.Gy2HafrCz5itnbgNTtTgfUSqZrt4BJ7FcpRfSt/QZzAan68pido0@/:rw", "--allow-upload", "--allow-delete", "--allow-search", "--allow-archive", "--allow-symlink"]), "user", "pa:ss@1")]
fn auth_hashed_password(
    #[case] server: TestServer,
    #[case] user: &str,
    #[case] pass: &str,
) -> Result<(), Error> {
    let url = format!("{}api/file1", server.url());
    let resp = fetch!(b"PUT", &url).body(b"abc".to_vec()).send()?;
    assert_eq!(resp.status(), 401);
    if let Err(err) = send_with_digest_auth(fetch!(b"PUT", &url).body(b"abc".to_vec()), user, pass)
    {
        assert_eq!(
            err.to_string(),
            r#"Missing "realm" in header: Basic realm="DUFS""#
        );
    }
    let resp = fetch!(b"PUT", &url)
        .body(b"abc".to_vec())
        .basic_auth(user, Some(pass))
        .send()?;
    assert_eq!(resp.status(), 201);
    Ok(())
}

#[rstest]
fn auth_and_public(
    #[with(&["-a", "user:pass@/:rw", "-a", "@/", "--allow-upload", "--allow-delete", "--allow-search", "--allow-archive", "--allow-symlink"])]
    server: TestServer,
) -> Result<(), Error> {
    let url = format!("{}api/file1", server.url());
    let resp = fetch!(b"PUT", &url).body(b"abc".to_vec()).send()?;
    assert_eq!(resp.status(), 401);
    let resp = send_with_digest_auth(fetch!(b"PUT", &url).body(b"abc".to_vec()), "user", "pass")?;
    assert_eq!(resp.status(), 201);
    let resp = fetch!(b"GET", &url).send()?;
    assert_eq!(resp.status(), 200);
    assert_eq!(resp.text()?, "abc");
    Ok(())
}

#[rstest]
fn auth_skip(#[with(&["--auth", "@/"])] server: TestServer) -> Result<(), Error> {
    let resp = reqwest::blocking::get(format!("{}api/", server.url()))?;
    assert_eq!(resp.status(), 200);
    Ok(())
}

#[rstest]
fn auth_skip_on_options_method(
    #[with(&["--auth", "user:pass@/:rw"])] server: TestServer,
) -> Result<(), Error> {
    let url = format!("{}api/index.html", server.url());
    let resp = fetch!(b"OPTIONS", &url).send()?;
    assert_eq!(resp.status(), 200);
    Ok(())
}

#[rstest]
fn auth_skip_if_no_auth_user(server: TestServer) -> Result<(), Error> {
    let url = format!("{}api/index.html", server.url());
    let resp = fetch!(b"GET", &url)
        .basic_auth("user", Some("pass"))
        .send()?;
    assert_eq!(resp.status(), 200);
    Ok(())
}

#[rstest]
fn auth_no_skip_if_anonymous(
    #[with(&["--auth", "@/:ro"])] server: TestServer,
) -> Result<(), Error> {
    let url = format!("{}api/index.html", server.url());
    let resp = fetch!(b"GET", &url)
        .basic_auth("user", Some("pass"))
        .send()?;
    assert_eq!(resp.status(), 401);
    let resp = fetch!(b"GET", &url).send()?;
    assert_eq!(resp.status(), 200);
    let resp = fetch!(b"DELETE", &url)
        .basic_auth("user", Some("pass"))
        .send()?;
    assert_eq!(resp.status(), 401);
    Ok(())
}

#[rstest]
fn auth_check(
    #[with(&["--auth", "user:pass@/:rw", "--auth", "user2:pass2@/", "--allow-upload", "--allow-delete", "--allow-search", "--allow-archive", "--allow-symlink"])]
    server: TestServer,
) -> Result<(), Error> {
    let url = format!("{}api/", server.url());
    let resp = fetch!(b"CHECKAUTH", &url).send()?;
    assert_eq!(resp.status(), 401);
    let resp = send_with_digest_auth(fetch!(b"CHECKAUTH", &url), "user", "pass")?;
    assert_eq!(resp.status(), 200);
    let resp = send_with_digest_auth(fetch!(b"CHECKAUTH", &url), "user2", "pass2")?;
    assert_eq!(resp.status(), 200);
    Ok(())
}

#[rstest]
fn auth_check2(
    #[with(&["--auth", "user:pass@/:rw|user2:pass2@/", "--allow-upload", "--allow-delete", "--allow-search", "--allow-archive", "--allow-symlink"])]
    server: TestServer,
) -> Result<(), Error> {
    let url = format!("{}api/", server.url());
    let resp = fetch!(b"CHECKAUTH", &url).send()?;
    assert_eq!(resp.status(), 401);
    let resp = send_with_digest_auth(fetch!(b"CHECKAUTH", &url), "user", "pass")?;
    assert_eq!(resp.status(), 200);
    let resp = send_with_digest_auth(fetch!(b"CHECKAUTH", &url), "user2", "pass2")?;
    assert_eq!(resp.status(), 200);
    Ok(())
}

#[rstest]
fn auth_check3(
    #[with(&["--auth", "user:pass@/:rw", "--auth", "@/dir1:rw", "--allow-upload", "--allow-delete", "--allow-search", "--allow-archive", "--allow-symlink"])]
    server: TestServer,
) -> Result<(), Error> {
    let url = format!("{}api/dir1/", server.url());
    let resp = fetch!(b"CHECKAUTH", &url).send()?;
    assert_eq!(resp.status(), 200);
    let resp = fetch!(b"CHECKAUTH", format!("{url}?login")).send()?;
    assert_eq!(resp.status(), 401);
    Ok(())
}

#[rstest]
fn auth_logout(
    #[with(&["--auth", "user:pass@/:rw", "--allow-upload", "--allow-delete", "--allow-search", "--allow-archive", "--allow-symlink"])]
    server: TestServer,
) -> Result<(), Error> {
    let url = format!("{}api/index.html", server.url());
    let resp = fetch!(b"LOGOUT", &url).send()?;
    assert_eq!(resp.status(), 401);
    let resp = send_with_digest_auth(fetch!(b"LOGOUT", &url), "user", "pass")?;
    assert_eq!(resp.status(), 401);
    Ok(())
}

#[rstest]
fn auth_readonly(
    #[with(&["--auth", "user:pass@/:rw", "--auth", "user2:pass2@/", "--allow-upload", "--allow-delete", "--allow-search", "--allow-archive", "--allow-symlink"])]
    server: TestServer,
) -> Result<(), Error> {
    let url = format!("{}api/index.html", server.url());
    let resp = fetch!(b"GET", &url).send()?;
    assert_eq!(resp.status(), 401);
    let resp = send_with_digest_auth(fetch!(b"GET", &url), "user2", "pass2")?;
    assert_eq!(resp.status(), 200);
    let url = format!("{}api/file1", server.url());
    let resp = send_with_digest_auth(fetch!(b"PUT", &url).body(b"abc".to_vec()), "user2", "pass2")?;
    assert_eq!(resp.status(), 403);
    Ok(())
}

#[rstest]
fn auth_nest(
    #[with(&["--auth", "user:pass@/:rw", "--auth", "user2:pass2@/", "--auth", "user3:pass3@/dir1:rw", "--allow-upload", "--allow-delete", "--allow-search", "--allow-archive", "--allow-symlink"])]
    server: TestServer,
) -> Result<(), Error> {
    let url = format!("{}api/dir1/file1", server.url());
    let resp = fetch!(b"PUT", &url).body(b"abc".to_vec()).send()?;
    assert_eq!(resp.status(), 401);
    let resp = send_with_digest_auth(fetch!(b"PUT", &url).body(b"abc".to_vec()), "user3", "pass3")?;
    assert_eq!(resp.status(), 201);
    let resp = send_with_digest_auth(fetch!(b"PUT", &url).body(b"abc".to_vec()), "user", "pass")?;
    assert_eq!(resp.status(), 201);
    Ok(())
}

#[rstest]
fn auth_nest_share(
    #[with(&["--auth", "@/", "--auth", "user:pass@/:rw", "--auth", "user3:pass3@/dir1:rw", "--allow-upload", "--allow-delete", "--allow-search", "--allow-archive", "--allow-symlink"])]
    server: TestServer,
) -> Result<(), Error> {
    let url = format!("{}api/index.html", server.url());
    let resp = fetch!(b"GET", &url).send()?;
    assert_eq!(resp.status(), 200);
    Ok(())
}

#[rstest]
#[case(server(&["--auth", "user:pass@/:rw", "--allow-upload", "--allow-delete", "--allow-search", "--allow-archive", "--allow-symlink"]), "user", "pass")]
#[case(server(&["--auth", "u1:p1@/:rw", "--allow-upload", "--allow-delete", "--allow-search", "--allow-archive", "--allow-symlink"]), "u1", "p1")]
fn auth_basic(
    #[case] server: TestServer,
    #[case] user: &str,
    #[case] pass: &str,
) -> Result<(), Error> {
    let url = format!("{}api/file1", server.url());
    let resp = fetch!(b"PUT", &url).body(b"abc".to_vec()).send()?;
    assert_eq!(resp.status(), 401);
    let resp = fetch!(b"PUT", &url)
        .body(b"abc".to_vec())
        .basic_auth(user, Some(pass))
        .send()?;
    assert_eq!(resp.status(), 201);
    Ok(())
}

#[rstest]
fn auth_webdav_move(
    #[with(&["--auth", "user:pass@/:rw", "--auth", "user3:pass3@/dir1:rw", "--allow-upload", "--allow-delete", "--allow-search", "--allow-archive", "--allow-symlink"])]
    server: TestServer,
) -> Result<(), Error> {
    let origin_url = format!("{}api/dir1/test.html", server.url());
    let new_url = format!("{}api/test2.html", server.url());
    let resp = send_with_digest_auth(
        fetch!(b"MOVE", &origin_url).header("Destination", &new_url),
        "user3",
        "pass3",
    )?;
    assert_eq!(resp.status(), 403);
    Ok(())
}

#[rstest]
fn auth_webdav_copy(
    #[with(&["--auth", "user:pass@/:rw", "--auth", "user3:pass3@/dir1:rw", "--allow-upload", "--allow-delete", "--allow-search", "--allow-archive", "--allow-symlink"])]
    server: TestServer,
) -> Result<(), Error> {
    let origin_url = format!("{}api/dir1/test.html", server.url());
    let new_url = format!("{}api/test2.html", server.url());
    let resp = send_with_digest_auth(
        fetch!(b"COPY", &origin_url).header("Destination", &new_url),
        "user3",
        "pass3",
    )?;
    assert_eq!(resp.status(), 403);
    Ok(())
}

#[rstest]
fn auth_path_prefix(
    #[with(&["--auth", "user:pass@/:rw", "--path-prefix", "xyz", "--allow-upload", "--allow-delete", "--allow-search", "--allow-archive", "--allow-symlink"])]
    server: TestServer,
) -> Result<(), Error> {
    let url = format!("{}xyz/api/index.html", server.url());
    let resp = fetch!(b"GET", &url).send()?;
    assert_eq!(resp.status(), 401);
    let resp = send_with_digest_auth(fetch!(b"GET", &url), "user", "pass")?;
    assert_eq!(resp.status(), 200);
    Ok(())
}

#[rstest]
fn auth_partial_index(
    #[with(&["--auth", "user:pass@/dir1:rw,/dir2:rw", "--allow-upload", "--allow-delete", "--allow-search", "--allow-archive", "--allow-symlink"])]
    server: TestServer,
) -> Result<(), Error> {
    let resp = send_with_digest_auth(
        fetch!(b"GET", format!("{}api/", server.url())),
        "user",
        "pass",
    )?;
    assert_eq!(resp.status(), 200);
    // API now returns JSON directly
    let json: serde_json::Value = resp.json()?;
    let paths: IndexSet<String> = json
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
    assert_eq!(paths, IndexSet::from(["dir1/".into(), "dir2/".into()]));
    let resp = send_with_digest_auth(
        fetch!(b"GET", format!("{}api/?q={}", server.url(), "test.html")),
        "user",
        "pass",
    )?;
    assert_eq!(resp.status(), 200);
    // API now returns JSON directly
    let json: serde_json::Value = resp.json()?;
    let paths: IndexSet<String> = json
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
    assert_eq!(
        paths,
        IndexSet::from(["dir1/test.html".into(), "dir2/test.html".into()])
    );
    Ok(())
}

#[rstest]
fn no_auth_propfind_dir(
    #[with(&["--auth", "admin:admin@/:rw", "--auth", "@/dir-assets", "--allow-upload", "--allow-delete", "--allow-search", "--allow-archive", "--allow-symlink"])]
    server: TestServer,
) -> Result<(), Error> {
    let resp = fetch!(b"PROPFIND", format!("{}api/", server.url())).send()?;
    assert_eq!(resp.status(), 207);
    let body = resp.text()?;
    assert!(body.contains("<D:href>/dir-assets/</D:href>"));
    assert!(body.contains("<D:href>/dir1/</D:href>"));
    Ok(())
}

#[rstest]
fn auth_propfind_dir(
    #[with(&["--auth", "admin:admin@/:rw", "--auth", "user:pass@/dir-assets", "--allow-upload", "--allow-delete", "--allow-search", "--allow-archive", "--allow-symlink"])]
    server: TestServer,
) -> Result<(), Error> {
    let resp = send_with_digest_auth(
        fetch!(b"PROPFIND", format!("{}api/", server.url())),
        "user",
        "pass",
    )?;
    assert_eq!(resp.status(), 207);
    let body = resp.text()?;
    assert!(body.contains("<D:href>/dir-assets/</D:href>"));
    assert!(!body.contains("<D:href>/dir1/</D:href>"));
    Ok(())
}

#[rstest]
fn auth_data(
    #[with(&["-a", "user:pass@/:rw", "-a", "@/", "--allow-upload", "--allow-delete", "--allow-search", "--allow-archive", "--allow-symlink"])]
    server: TestServer,
) -> Result<(), Error> {
    let resp = reqwest::blocking::get(format!("{}api/", server.url()))?;
    // API now returns JSON directly
    let json: serde_json::Value = resp.json()?;
    assert_eq!(json["allow_delete"], serde_json::Value::Bool(false));
    assert_eq!(json["allow_upload"], serde_json::Value::Bool(false));
    let resp = fetch!(b"GET", format!("{}api/", server.url()))
        .basic_auth("user", Some("pass"))
        .send()?;
    // API now returns JSON directly
    let json: serde_json::Value = resp.json()?;
    assert_eq!(json["allow_delete"], serde_json::Value::Bool(true));
    assert_eq!(json["allow_upload"], serde_json::Value::Bool(true));
    Ok(())
}

#[rstest]
fn auth_shadow(
    #[with(&["--auth", "user:pass@/:rw", "-a", "@/dir1", "--allow-upload", "--allow-delete", "--allow-search", "--allow-archive", "--allow-symlink"])]
    server: TestServer,
) -> Result<(), Error> {
    let url = format!("{}api/dir1/test.txt", server.url());
    let resp = fetch!(b"PUT", &url).body(b"abc".to_vec()).send()?;
    assert_eq!(resp.status(), 401);

    let resp = send_with_digest_auth(fetch!(b"PUT", &url).body(b"abc".to_vec()), "user", "pass")?;
    assert_eq!(resp.status(), 201);

    Ok(())
}

#[rstest]
fn token_auth(#[with(&["-a", "user:pass@/"])] server: TestServer) -> Result<(), Error> {
    let url = format!("{}api/index.html", server.url());
    let resp = fetch!(b"GET", &url).send()?;
    assert_eq!(resp.status(), 401);
    let url = format!("{}api/index.html?tokengen", server.url());
    let resp = fetch!(b"GET", &url)
        .basic_auth("user", Some("pass"))
        .send()?;
    let token = resp.text()?;
    let url = format!("{}api/index.html?token={token}", server.url());
    let resp = fetch!(b"GET", &url).send()?;
    assert_eq!(resp.status(), 200);
    Ok(())
}
