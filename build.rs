use std::path::Path;
use std::process::Command;

fn main() {
    let assets_dir = Path::new("assets");

    // Tell Cargo to rerun this build script if any files in assets/src change
    println!("cargo:rerun-if-changed=assets/src");
    println!("cargo:rerun-if-changed=assets/package.json");
    println!("cargo:rerun-if-changed=assets/pnpm-lock.yaml");

    // Check if assets directory exists
    if !assets_dir.exists() {
        println!("cargo:warning=assets directory not found, skipping frontend build");
        return;
    }

    // Check if pnpm is installed
    let pnpm_check = Command::new("pnpm").arg("--version").output();

    if pnpm_check.is_err() {
        println!("cargo:warning=pnpm not found, skipping frontend build. Install pnpm with: npm install -g pnpm");
        return;
    }

    println!("cargo:warning=Building frontend assets with pnpm...");

    // Run pnpm install
    let install_status = Command::new("pnpm")
        .arg("install")
        .current_dir(assets_dir)
        .status()
        .expect("Failed to execute pnpm install");

    if !install_status.success() {
        panic!("pnpm install failed");
    }

    // Run pnpm build
    let build_status = Command::new("pnpm")
        .arg("run")
        .arg("build")
        .env("NODE_ENV", "development")
        .current_dir(assets_dir)
        .status()
        .expect("Failed to execute pnpm build");

    if !build_status.success() {
        panic!("pnpm build failed");
    }

    println!("cargo:warning=Frontend assets built successfully");
}
