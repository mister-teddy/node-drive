mod fixtures;
mod utils;

use fixtures::{port, tmpdir, wait_for_port, Error};

use assert_cmd::prelude::*;
use assert_fs::fixture::TempDir;
use rstest::rstest;
use std::io::Read;
use std::process::{Command, Stdio};

#[rstest]
#[case(&["--log-format", ""])]
fn no_log(tmpdir: TempDir, port: u16, #[case] args: &[&str]) -> Result<(), Error> {
    let mut child = Command::cargo_bin("node-drive")?
        .arg(tmpdir.path())
        .arg("-p")
        .arg(port.to_string())
        .args(args)
        .stdout(Stdio::piped())
        .spawn()?;

    wait_for_port(port);

    let stdout = child.stdout.as_mut().expect("Failed to get stdout");

    let resp = fetch!(b"GET", &format!("http://localhost:{port}")).send()?;
    assert_eq!(resp.status(), 200);

    let mut buf = [0; 2048];
    let buf_len = stdout.read(&mut buf)?;
    let output = std::str::from_utf8(&buf[0..buf_len])?;

    assert_eq!(output.lines().last().unwrap(), "");

    child.kill()?;
    Ok(())
}
