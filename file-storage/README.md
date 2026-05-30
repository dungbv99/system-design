# File Storage System

Scalable file storage with sync, versioning, and conflict resolution.

Built with **Spring Boot 3**, **PostgreSQL**, **Flyway**, and **WebSocket**.

---

## Architecture

```
Client (Desktop / Mobile / Web)
    │
    ▼
API Gateway (Spring Boot :8080)
    ├── /api/auth        JWT register / login / device
    ├── /api/nodes       File & folder tree CRUD
    ├── /api/upload      Resumable chunked upload (dedup)
    ├── /api/download    Block manifest + file download
    ├── /api/sync        Change-log polling + WebSocket push
    ├── /api/versions    Version history + restore
    └── /api/shares      User & link sharing
         │
         ▼
    PostgreSQL (metadata + change log)
    Local FS   (content-addressed blocks: ./blocks/{hash[:2]}/{hash})
```

### Key Design Decisions

| Feature | Approach |
|---|---|
| Chunking | Content-Defined Chunking (CDC) with rolling hash |
| Dedup | SHA-256 content-addressed block store |
| Sync | Global monotonic `change_log` + WebSocket push |
| Versioning | Append-only version chain (immutable) |
| Conflict | 3-way merge for text; fork for binary |
| GC | Ref-counted blocks; async cleanup on version limit |

---

## Quick Start

### 1. Prerequisites

- Java 17+
- Maven 3.8+
- PostgreSQL running at `localhost:5432` (user: `postgres`, pass: `postgres`)

### 2. Create the database

```bash
./setup-db.sh
# or manually:
psql -U postgres -c "CREATE DATABASE filestorage;"
```

### 3. Run the application

```bash
mvn spring-boot:run
```

Flyway auto-runs `V1__initial_schema.sql` on first start.

---

## API Reference

### Auth

```bash
# Register
curl -X POST http://localhost:8080/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","password":"secret123","deviceName":"MacBook","platform":"darwin"}'

# Login
curl -X POST http://localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","password":"secret123","deviceName":"iPhone","platform":"ios"}'
```

Response includes `token` (JWT) and `deviceId`. Use `Authorization: Bearer <token>` for all further requests.

---

### File Tree

```bash
export TOKEN="<your-jwt>"

# List root
curl http://localhost:8080/api/nodes -H "Authorization: Bearer $TOKEN"

# Create folder
curl -X POST http://localhost:8080/api/nodes/folder \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Documents","parentId":null}'

# Get node
curl http://localhost:8080/api/nodes/{nodeId} -H "Authorization: Bearer $TOKEN"

# Rename
curl -X PATCH http://localhost:8080/api/nodes/{nodeId} \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"New Name"}'

# Delete
curl -X DELETE http://localhost:8080/api/nodes/{nodeId} -H "Authorization: Bearer $TOKEN"
```

---

### Upload (3-step resumable flow)

#### Step 1 — Init (dedup check)

```bash
# First, chunk your file client-side and compute SHA-256 per chunk
curl -X POST http://localhost:8080/api/upload/init \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "fileName": "report.pdf",
    "parentId": null,
    "deviceId": "<deviceId>",
    "blockHashes": ["<sha256_chunk0>", "<sha256_chunk1>", ...],
    "totalSize": 1048576
  }'

# Response: { "uploadId": "...", "missingBlocks": ["<only these need uploading>"] }
```

#### Step 2 — Upload missing blocks only

```bash
# For each block in missingBlocks:
curl -X PUT http://localhost:8080/api/upload/{uploadId}/block/{index} \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/octet-stream' \
  --data-binary @chunk_0.bin
```

#### Step 3 — Commit

```bash
curl -X POST http://localhost:8080/api/upload/{uploadId}/commit \
  -H "Authorization: Bearer $TOKEN"

# Response: FileVersion with id, versionNumber, contentHash, blockList
```

---

### Download

```bash
# Get block manifest for a version
curl http://localhost:8080/api/download/{versionId}/manifest \
  -H "Authorization: Bearer $TOKEN"

# Download a single block (cacheable — content-addressed)
curl http://localhost:8080/api/download/block/{hash} \
  -H "Authorization: Bearer $TOKEN" \
  -o chunk.bin

# Download the complete assembled file
curl http://localhost:8080/api/download/{versionId}/file \
  -H "Authorization: Bearer $TOKEN" \
  -o output.pdf
```

---

### Sync (change log polling)

```bash
# Poll changes since cursor (0 = everything)
curl "http://localhost:8080/api/sync/changes?since=0" \
  -H "Authorization: Bearer $TOKEN"

# Update device cursor after applying events
curl -X PATCH "http://localhost:8080/api/sync/device/{deviceId}/cursor?cursor=42" \
  -H "Authorization: Bearer $TOKEN"
```

#### Real-time WebSocket

```
ws://localhost:8080/api/sync/ws?token=<jwt>
```

Server pushes JSON frames on every change:
```json
{"seq":42,"nodeId":"...","op":"update","versionId":"...","occurredAt":"..."}
```

Clients send `{"type":"ping"}` for keep-alive.

---

### Version History

```bash
# List all versions (newest first)
curl http://localhost:8080/api/versions/{nodeId} -H "Authorization: Bearer $TOKEN"

# Get specific version
curl http://localhost:8080/api/versions/{nodeId}/3 -H "Authorization: Bearer $TOKEN"

# Restore version 2 (creates a new v_n+1 with the same blocks)
curl -X POST "http://localhost:8080/api/versions/{nodeId}/2/restore?deviceId={deviceId}" \
  -H "Authorization: Bearer $TOKEN"

# Delete an old version (decrements block ref counts, GCs orphans)
curl -X DELETE http://localhost:8080/api/versions/{nodeId}/1 -H "Authorization: Bearer $TOKEN"
```

---

### Sharing

```bash
# Share with a specific user (edit access)
curl -X POST http://localhost:8080/api/shares \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"nodeId":"...","shareType":"user","granteeEmail":"bob@example.com","permission":"edit"}'

# Create a public link share (read-only)
curl -X POST http://localhost:8080/api/shares \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"nodeId":"...","shareType":"link","permission":"read","expiresAt":"2026-12-31T00:00:00Z"}'

# Access via link (no auth needed)
curl http://localhost:8080/api/shares/link/{token}

# List / revoke
curl http://localhost:8080/api/shares -H "Authorization: Bearer $TOKEN"
curl -X DELETE http://localhost:8080/api/shares/{shareId} -H "Authorization: Bearer $TOKEN"
```

---

## Configuration

All settings in `src/main/resources/application.yml`:

| Property | Default | Description |
|---|---|---|
| `spring.datasource.url` | `jdbc:postgresql://localhost:5432/filestorage` | Database URL |
| `app.jwt.secret` | (see yml) | HS256 signing key (change in production!) |
| `app.jwt.expiration-ms` | `86400000` | Token TTL (24h) |
| `app.storage.blocks-path` | `./blocks` | Local block store root |
| `app.upload.max-block-size` | `8388608` | CDC max chunk (8 MB) |
| `app.upload.min-block-size` | `524288` | CDC min chunk (512 KB) |
| `app.upload.max-versions-per-file` | `100` | Versions kept before GC |
| `app.upload.session-expiry-hours` | `24` | Upload session TTL |

---

## Database Schema

```
users          → identity, quota
devices        → per-user sync clients with cursor
nodes          → file/folder tree (soft-delete)
file_versions  → immutable version chain per file
blocks         → content-addressed block store (ref-counted)
upload_sessions → resumable upload state
change_log     → BIGSERIAL event ledger for sync
shares         → access control grants
```

Flyway migration: `src/main/resources/db/migration/V1__initial_schema.sql`
