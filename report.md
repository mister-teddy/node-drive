# Database Query Analysis Report

## Summary

When a request is made to `/` (root directory listing), the system makes **N+1 SELECT queries** per file in the directory, where N is the number of files.

## Request Flow for GET /

1. **Request arrives** → `Server::handle()` at line 151
2. **Directory listing** → `handle_ls_dir()` at line 607
3. **List directory entries** → `list_dir()` at line 1654
4. **Convert to PathItem** → `to_pathitem()` at line 1686 (called for each file)
5. **Compute stamp status** → `compute_stamp_status()` at line 1748 (called for each file)

## Database Queries in `compute_stamp_status()` (lines 1748-1823)

For **each file** in the directory, the following queries are executed:

### Query 1: Get Manifest (line 1759)
```rust
let manifest = match self.provenance_db.get_manifest(&sha256_hex).ok()? {
```

This calls `ProvenanceDb::get_manifest()` in `src/provenance.rs:390`, which executes:

### Query 2: Get Artifact (line 391)
```rust
let (artifact_id, artifact) = match self.get_artifact(sha256_hex)? {
```
Location: `src/provenance.rs:207-227`
```sql
SELECT id, file_name, size_bytes, sha256_hex
FROM artifacts
WHERE sha256_hex = ?1
```

### Query 3: Get Events (line 396)
```rust
let events = self.get_events(artifact_id)?;
```
Location: `src/provenance.rs:301-387`
```sql
SELECT id, index_num, action, artifact_sha256_hex, prev_event_hash_hex, issued_at, event_hash_hex, ots_proof_b64
FROM events
WHERE artifact_id = ?1
ORDER BY index_num ASC
```

### Query 4-N: Get Event Actors (lines 325-343)
**For each event**, a separate query:
```sql
SELECT role, pubkey_hex
FROM event_actors
WHERE event_id = ?1
```
Location: `src/provenance.rs:325-343`

### Query N+1-M: Get Event Signatures (lines 346-364)
**For each event**, another separate query:
```sql
SELECT role, signature_hex
FROM event_signatures
WHERE event_id = ?1
```
Location: `src/provenance.rs:346-364`

### Additional Query on Verification Success (lines 1783-1791)
If OTS verification succeeds with an upgrade:
```sql
-- Another call to get_artifact
SELECT id, file_name, size_bytes, sha256_hex
FROM artifacts
WHERE sha256_hex = ?1
```

## Total Query Count for Single Request to /

For a directory with **F files**, where each file has **E events**:

- **Base queries per file**: 3 queries (get_artifact, get_events, update query if needed)
- **Event-related queries**: 2E queries per file (actors + signatures for each event)
- **Total**: **F × (3 + 2E)** queries

### Example Scenarios

Assuming **~1ms per SQLite query** (typical for indexed lookups on local SSD):

| Files | Events/File | Total Queries | Estimated Time |
|-------|-------------|---------------|----------------|
| 10    | 1           | 50            | ~50ms          |
| 100   | 1           | 500           | ~500ms (0.5s)  |
| 1000  | 1           | 5,000         | ~5s            |
| 10    | 5           | 130           | ~130ms         |
| 100   | 5           | 1,300         | ~1.3s          |

**Note**: These are conservative estimates. Actual time may be higher due to:
- File I/O overhead (reading files to compute SHA-256)
- Mutex contention on the database connection
- OTS verification overhead (network calls to Bitcoin nodes)
- Additional file system operations

## N+1 Query Problem Locations

### Primary N+1 Problem
**File**: `src/server.rs:1734`
```rust
let stamp_status = if matches!(path_type, PathType::File | PathType::SymlinkFile) {
    self.compute_stamp_status(path).await  // ← Called for EVERY file
} else {
    None
};
```

### Secondary N+1 Problem
**File**: `src/provenance.rs:314-343` and `346-364`
```rust
while let Some(row) = rows.next()? {
    let event_id: i64 = row.get(0)?;

    // ← Query actors for THIS event
    let mut actors_stmt = conn.prepare("SELECT role, pubkey_hex FROM event_actors WHERE event_id = ?1")?;

    // ← Query signatures for THIS event
    let mut sigs_stmt = conn.prepare("SELECT role, signature_hex FROM event_signatures WHERE event_id = ?1")?;
}
```

## Recommendations (Prioritized by Impact)

### CRITICAL - Fix Network Calls (99% of the problem)

1. **Make stamp status lazy/opt-in**:
   - Don't compute `stamp_status` by default in directory listings
   - Only compute when user explicitly requests it via `?stamps=true` query parameter
   - Or load stamp status asynchronously via separate API calls from the frontend

2. **Cache OTS verification results**:
   - Store verification results in database with timestamp
   - Only re-verify after X hours (e.g., 24 hours)
   - Add a `last_verified_at` column to events table

3. **Skip upgrade attempts for recent timestamps**:
   - Bitcoin confirmations take ~10 minutes minimum
   - Don't call `upgrade_timestamp()` for timestamps less than 1 hour old
   - Add logic to check `issued_at` before attempting upgrade

### HIGH - Optimize Database Queries

4. **Batch manifest queries**: Query all manifests for all files in the directory in one or two queries
5. **Use JOINs**: Fetch events with their actors and signatures using LEFT JOIN queries instead of separate queries per event
6. **Add indexes**: Ensure indexes exist on foreign keys (already present in schema)

### MEDIUM - Additional Optimizations

7. **Parallel processing**: Process stamp status for multiple files concurrently
8. **Cache file hashes**: Store SHA-256 in database keyed by (path, mtime, size) to avoid re-reading files

## Current Performance Impact

- Every directory listing triggers database queries for every file
- For large directories (100+ files), this results in 500+ queries per page load
- Each query involves SQLite connection locking (mutex at `src/provenance.rs:94`)
- Sequential processing means no parallelization of queries

## CRITICAL: Network Calls on Every Directory Listing

**The real performance bottleneck is even worse than database queries.**

For **EVERY file** in the directory, `compute_stamp_status()` makes a **network call** to verify the OTS timestamp:

### Location: `src/server.rs:1774-1778`
```rust
// Verify the OTS proof
match ots_stamper::verify_timestamp(
    &latest_event.ots_proof_b64,
    &latest_event.artifact_sha256_hex,
)
.await
```

### What `verify_timestamp()` does:
Location: `src/ots_stamper.rs:511-541`

1. **Parses the OTS proof** (local, fast)
2. **Calls `upgrade_timestamp()`** (src/ots_stamper.rs:540)
3. **Makes HTTP requests to OpenTimestamps calendar servers** (src/ots_stamper.rs:221-246)
   - 30-second timeout per request
   - Multiple calendar servers may be queried
   - Each file triggers these network calls

### Actual Performance for 10 Files:

| Component | Time per File | Total for 10 Files |
|-----------|---------------|-------------------|
| Read entire file for SHA-256 | ~5-50ms (depends on size) | 50-500ms |
| Database queries (5 queries) | ~5ms | 50ms |
| **OTS calendar HTTP requests** | **100-500ms** | **1-5 seconds** |
| Bitcoin explorer queries (if verified) | 100-500ms | 1-5 seconds |
| **TOTAL** | **~210-1050ms** | **~2.1-10.5 seconds** |

### Why it takes 5-7 seconds for 10 files:

1. **Each file triggers**:
   - File read to compute SHA-256
   - 5 database queries (artifact, events, actors, signatures)
   - **Network call to OTS calendar servers** (with 30s timeout) - to upgrade pending attestations
   - **Network call to Bitcoin explorer** (Blockstream.info API) - to cryptographically verify the timestamp

2. **Serialized execution**: All operations run sequentially (not in parallel)

3. **Network latency**: Calendar servers and Bitcoin explorers may be slow or timing out

4. **No caching**: Every page load re-verifies all timestamps from scratch

### Why Bitcoin explorer calls are necessary:

**Purpose**: Cryptographic proof that the file existed at a specific time

The `verify_bitcoin_attestation()` function (src/ots_stamper.rs:455-506):

1. **Queries Blockstream.info API** for the Bitcoin block at a specific height
2. **Retrieves the merkle root** from that block
3. **Compares the merkle root** to the digest in the OTS proof
4. **If they match**: Proves the file's hash was included in that Bitcoin block
5. **Returns**: The block timestamp (Unix epoch) and height

**This is the core security feature of OpenTimestamps** - it provides tamper-proof evidence that a file existed at a specific point in time by anchoring it to the Bitcoin blockchain.

However, **this verification is NOT needed on every directory listing**. The verification only needs to happen:
- When a user explicitly requests verification (e.g., clicking "Verify" button)
- Periodically in the background (e.g., once per day)
- When displaying detailed provenance information for a specific file

Currently, it's running on **every page load for every file**, which is completely unnecessary.
