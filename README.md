# Node Drive

**Digital ownership, made possible with Bitcoin**

Node Drive is a fork of [dufs](https://github.com/sigoden/dufs), enhanced with a universal provenance layer for digital content. It combines the power of file sharing with cryptographic proof of authenticity, authorship, and ownership anchored to Bitcoin's blockchain.

## Vision

We're building a universal provenance layer for digital content—files, posts, AI-generated images and videos—that lets anyone:

- **Verify authenticity**: Confirm content is intact, who claimed it, and when
- **Prove authorship**: Cryptographically anchored to Bitcoin time using OpenTimestamps
- **Transfer ownership**: Maintain a clear, tamper-evident chain of custody

This goes beyond simple timestamping. It's a cheap, open, infinitely scalable intellectual property layer for the internet. In an era of generative AI, knowing who created what, and when, is critical.

## How It Works

**Digital fingerprint (file) + Your signature → Anchored in Bitcoin (OpenTimestamps)**

1. **Digital fingerprint**: Hash the file (SHA-256) in the browser to reduce server load
2. **Your signature**: Sign that hash with your private key
3. **Bitcoin timestamp**: Anchor the event on Bitcoin using OpenTimestamps (OTS)
4. **Ownership log**: Store a single JSON manifest with the file's fingerprint and an append-only list of signed events (mint, transfers), each with its own OTS proof

### File Layout

For each verified file, Node Drive maintains two files:

- `artifact.bin` - The original file
- `artifact.json` - The provenance manifest containing complete history and embedded OTS proofs

## Digital Provenance

### Data Model

**Manifest** (`provenance.manifest/v1`)
- `artifact`: file name, size, sha256_hex
- `events[]`: ordered, append-only list of events

**Event** (`provenance.event/v1`)
- `index`: Sequential number (0, 1, 2, ...)
- `action`: "mint" | "transfer"
- `artifact_sha256_hex`: Must match manifest.artifact.sha256_hex
- `prev_event_hash_hex`: null for first event, otherwise prior event's hash
- `actors`: Cryptographic keys involved (creator/prev_owner/new_owner)
- `issued_at`: ISO-8601 timestamp
- `event_hash_hex`: SHA-256 of canonical event (excludes signatures, ots_proof_b64, event_hash_hex)
- `signatures`: Detached signatures over event_hash_hex
- `ots_proof_b64`: Embedded OpenTimestamps proof

### Verification Flow

1. Re-hash file → must equal `artifact.sha256_hex`
2. For each event:
   - Recompute `event_hash_hex` from canonical event
   - Verify `prev_event_hash_hex` links correctly
   - Verify all listed signatures over `event_hash_hex`
   - Verify `ots_proof_b64` → Bitcoin block/time
3. Current owner = last valid event's actor (e.g., `new_owner_pubkey_hex`)

### Scalability

- **OTS batching**: Millions → billions of events in one Bitcoin transaction
- **Proof size**: Small (KB), logarithmic growth

## Features

All original dufs features, plus:

- **Digital provenance tracking** with Bitcoin timestamping
- **Cryptographic proof** of file integrity and ownership
- **Content-addressed storage** using file hashes
- **Visual verification badges** showing timestamp and integrity status
- **User-friendly hash representation** (e.g., `qw50 •••`)
- **Dual-mode display**: Simple view for users, detailed cryptographic view for verification
- Static file serving with drag-and-drop upload
- Download folders as zip
- Resumable/partial uploads/downloads
- Access control and authentication
- HTTPS and WebDAV support
- Search and edit capabilities

## UI/UX Enhancements

Node Drive provides an intuitive interface for viewing provenance:

**User-Friendly View:**
```
✅ File not altered: qw50 •••
✅ Filed verified by me
✅ Verified on Bitcoin on 9/25/2025 1:00p
```

**Cryptographic Details View:**
- SHA-256 hash (full): `qw50meuwuvkwfem96lxxss9s4nzd8j4z7wp`
- Ownership public key: `3s3fkwfem96lxxss9s4nzd8j4z7wp`
- OpenTimestamps proof anchored in Bitcoin block #850321

## File Sharing

Node Drive uses **IPv6 addresses** for decentralized file sharing with optional domain support:

```
https://[2001:db8::1]/files/bafybehashhashhashabc123/file1.txt
https://node.website/files/bafybehashhashhashabc123/file1.txt
```

The PWA can point to user servers while providing self-healing capabilities if IP addresses change.

## Install

### With cargo

```bash
cargo install node-drive
```

### With docker

```bash
docker run -v `pwd`:/data -p 5000:5000 --rm node-drive /data -A
```

### Binaries

Download from [Github Releases](https://github.com/your-repo/node-drive/releases), unzip and add to your $PATH.

## Quick Start

Serve current directory with all features enabled:

```bash
node-drive -A
```

Serve with provenance tracking:

```bash
node-drive --enable-provenance
```

Use HTTPS for secure connections:

```bash
node-drive --tls-cert my.crt --tls-key my.key
```

## API

All dufs API endpoints are supported, plus provenance-specific endpoints:

### Upload with Provenance

```sh
curl -T file.pdf http://127.0.0.1:5000/file.pdf?provenance=true
```

### Verify File Integrity

```sh
curl http://127.0.0.1:5000/file.pdf?verify
```

### Get Provenance Manifest

```sh
curl http://127.0.0.1:5000/file.pdf.json
```

## Technical Implementation

Node Drive is built using:

- **Rust** (via dufs fork) for high-performance file serving
- **OpenTimestamps** for Bitcoin blockchain anchoring
- **SHA-256** hashing for content addressing
- **ECDSA** signatures for ownership proof
- **JSON** manifests for provenance storage

When uploading files:
1. File identifier is created from content hash (computed in browser)
2. File becomes permanent and verifiable on the network
3. OpenTimestamps proof anchors the upload time to Bitcoin blockchain
4. Provenance manifest tracks all subsequent events

## Architecture

```
Browser (hash file) → Node Drive Server → OpenTimestamps
                            ↓
                     Bitcoin Blockchain
                            ↓
                    Permanent Proof
```

## License

Copyright (c) 2025 Node Drive contributors.
Based on [dufs](https://github.com/sigoden/dufs) © 2022-2024 dufs-developers.

Node Drive is made available under the terms of either the MIT License or the Apache License 2.0, at your option.

See the LICENSE-APACHE and LICENSE-MIT files for license details.

---

**Built for a world where digital ownership matters.**