# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Node Drive is a fork of [dufs](https://github.com/sigoden/dufs), enhanced with a **digital provenance layer** for files using Bitcoin timestamping via OpenTimestamps. It's a Rust-based file server that provides static serving, uploading, WebDAV support, and cryptographic proof of file authenticity and ownership.

**Key Enhancement**: The project aims to add a universal provenance layer where files are cryptographically signed, timestamped to Bitcoin blockchain, and maintain a tamper-evident chain of custody through JSON manifests.

## Build Commands

```bash
# Build the project
cargo build

# Build for release (optimized)
cargo build --release

# Run locally (serves current directory on port 5000)
cargo run

# Run with specific options
cargo run -- -A                    # Allow all operations
cargo run -- --allow-upload        # Allow uploads only
cargo run -- -p 8080               # Custom port
cargo run -- --tls-cert cert.pem --tls-key key.pem  # HTTPS

# Run tests
cargo test                         # All tests
cargo test --all                   # All tests including integration
cargo test --test http             # Specific test file
cargo test test_name               # Specific test

# Linting
cargo clippy --all --all-targets

# Formatting
cargo fmt --all                    # Format code
cargo fmt --all --check            # Check formatting without changing
```

## Architecture

### Core Module Structure

The codebase is organized into distinct modules with clear responsibilities:

**`main.rs`** (306 lines)
- Entry point that orchestrates server initialization
- Handles command-line argument parsing via `build_cli()`
- Manages TCP/TLS listeners and spawns server tasks
- Implements graceful shutdown via `shutdown_signal()`
- Creates multiple server instances for different bind addresses (IPv4/IPv6/Unix sockets)

**`server.rs`** (1940 lines - largest module)
- Core HTTP request handling and routing logic
- Implements the `Server` struct with `call()` and `handle()` methods
- Request routing: GET (file serving, directory listing), PUT/POST (upload), DELETE, WebDAV methods (PROPFIND, PROPPATCH, MKCOL, COPY, MOVE, LOCK, UNLOCK)
- Directory rendering with JSON, HTML, and XML outputs
- File operations: upload (including resumable), download, archive (zip), hash generation
- Query parameters: `?simple`, `?json`, `?q=search`, `?zip`, `?hash`
- Internal routes under `__dufs_v{version}__/` for assets and health checks
- Built-in assets (HTML/CSS/JS) embedded via `include_str!()` and `include_bytes!()`

**`args.rs`** (738 lines)
- CLI argument definitions using `clap`
- Configuration file parsing (YAML format)
- Environment variable support (all options prefixed with `DUFS_`)
- `Args` struct contains all runtime configuration
- Merges CLI args, config files, and env vars with proper precedence
- Validates paths, ports, and other options

**`auth.rs`** (725 lines)
- Authentication and authorization system
- Supports both Basic and Digest HTTP authentication
- `AccessControl` struct manages user permissions
- `AccessPaths` defines read/write permissions per path
- Hashed password support (sha-512 only, format: `$6$...`)
- Token-based authentication for WebDAV clients
- Ed25519 signing for cryptographic operations (prepared for provenance feature)
- Permission checks integrated with HTTP methods

**`http_logger.rs`** (106 lines)
- Customizable HTTP request logging
- Template-based format: `$remote_addr`, `$remote_user`, `$request`, `$status`, `$http_*`
- Logs to stdout or file

**`http_utils.rs`** (105 lines)
- HTTP utility functions for body handling
- Stream processing for chunked uploads/downloads
- Length-limited streams to prevent memory exhaustion

**`utils.rs`** (186 lines)
- File system utilities: path encoding/decoding, glob matching
- Time utilities: file modification times, Unix timestamps
- TLS certificate loading (when `tls` feature enabled)
- SHA-256 hashing utilities (foundation for provenance features)

**`logger.rs`** (61 lines)
- Simple logging setup using the `log` crate
- Configurable log output to file or stderr

**`noscript.rs`** (103 lines)
- Detects browsers with JavaScript disabled
- Generates fallback HTML with form-based file uploads

### Request Flow

```
Client Request
    ↓
main.rs: TCP/TLS listener accepts connection
    ↓
Server::call() - Entry point with error handling and CORS
    ↓
Server::handle() - Core routing logic
    ↓
├─ Resolve path (URI → filesystem)
├─ Check internal routes (__dufs__/health, assets)
├─ Authentication/Authorization (auth.rs)
└─ Route by HTTP method:
    ├─ GET    → handle_ls() or handle_send_file()
    ├─ PUT    → handle_upload()
    ├─ DELETE → handle_delete()
    ├─ Other  → handle_webdav() (PROPFIND, MKCOL, etc.)
    ↓
Response (with CORS headers if enabled)
```

### Authentication Flow

1. Client sends request with optional `Authorization` header or `?token=` query param
2. `AccessControl::guard()` validates credentials:
   - For Digest auth: verifies nonce, response hash, and timestamp
   - For Basic auth: decodes base64 and checks username:password
   - For hashed passwords: uses `sha-crypt` to verify `$6$` format
3. Returns `GuardType::Reject` (401), `Guest`, or `Authenticated(user, perm)`
4. Permission check: `AccessPaths::perm()` validates path + HTTP method against user's access rules

### Test Infrastructure

Tests use `rstest` fixtures to create temporary directories with pre-populated files. Key test modules:
- `fixtures.rs`: Shared test utilities, temp directory setup, server spawning
- `http.rs`: HTTP method tests (GET, PUT, DELETE, etc.)
- `auth.rs`: Authentication and authorization tests
- `webdav.rs`: WebDAV protocol compliance tests
- Integration tests spawn actual servers on random ports and use `reqwest` for HTTP calls

## Provenance Features (Planned/In Progress)

The README.md describes a digital provenance system that is **not yet implemented** in the Rust codebase. The design includes:

### Data Model
- **Manifest** (`provenance.manifest/v1`): JSON file tracking artifact metadata and events
- **Event** (`provenance.event/v1`): Append-only log of "mint" and "transfer" actions
- Each event includes: SHA-256 hash, signatures (ECDSA/Ed25519), OpenTimestamps proof (base64)
- Chain validation: each event references previous event's hash

### File Layout
- `artifact.bin` - Original file
- `artifact.json` - Provenance manifest with embedded OTS proofs

### Implementation Notes
When implementing provenance features:
- SHA-256 hashing is already available via `sha2` crate (see `utils.rs`)
- Ed25519 signatures via `ed25519-dalek` crate (see `auth.rs` for token signing example)
- OpenTimestamps integration will need new dependency
- Browser-side hashing recommended to reduce server load
- Query parameters like `?provenance=true` can trigger manifest creation
- WebDAV `PROPPATCH` could store provenance metadata

## Development Notes

### Feature Flags
- `tls`: Enables HTTPS support with rustls (default: enabled)
- To disable TLS: `cargo build --no-default-features`

### Environment Variables
All CLI options can be set via env vars prefixed with `DUFS_`:
- `DUFS_SERVE_PATH=.`
- `DUFS_PORT=5000`
- `DUFS_AUTH="admin:pass@/:rw"`
- `DUFS_ALLOW_UPLOAD=true`

### Assets Customization
- Built-in assets in `assets/` directory are embedded at compile time
- Override at runtime with `--assets` flag pointing to custom directory
- Must include `index.html` with placeholders: `__INDEX_DATA__`, `__ASSETS_PREFIX__`

### Release Build Optimizations
Profile in `Cargo.toml` uses aggressive optimizations:
- LTO enabled, single codegen unit
- Panic=abort, symbols stripped
- Results in smaller, faster binaries

### CI/CD
GitHub Actions (`.github/workflows/`):
- **ci.yaml**: Runs on PR/push, executes tests + clippy + rustfmt on Ubuntu/macOS/Windows
- **release.yaml**: Builds multi-platform binaries, creates GitHub releases

### Common Pitfalls
- **Path handling**: Always use `decode_uri()` and `encode_uri()` from `utils.rs` for URI ↔ filesystem path conversions
- **Authentication**: Digest auth is default; hashed passwords don't work with digest auth (limitation documented)
- **Resumable uploads**: Only enabled for files >20MB (see `RESUMABLE_UPLOAD_MIN_SIZE`)
- **Archive downloads**: Directory zipping happens on-the-fly using `async_zip`, limited to 1000 sub-paths