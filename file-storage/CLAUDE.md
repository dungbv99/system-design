# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Setup database (requires PostgreSQL at localhost:5432, user/pass: postgres)
./setup-db.sh

# Run the application
mvn spring-boot:run

# Build (skip tests)
mvn package -DskipTests

# Run tests
mvn test

# Run a single test class
mvn test -Dtest=ClassName

# Compile only
mvn compile
```

The app runs on `http://localhost:8080`. Flyway runs `V1__initial_schema.sql` automatically on first start. The block store is created at `./blocks/` on startup.

## Architecture

Spring Boot 3 REST API + WebSocket server. All configuration lives in `src/main/resources/application.yml`. The `app.*` namespace (typed into `AppProperties`) controls JWT, block storage path, upload limits, and version GC.

**Layers:**
- `controller/` — thin REST layer; extracts `UserPrincipal` from security context, delegates to services
- `service/` — all business logic; transactional
- `repository/` — Spring Data JPA; `BlockRepository` has a custom `@Modifying` `adjustRefCount` query
- `model/` — JPA entities; `StringListConverter` serializes `List<String>` as JSON text in columns (`block_list`, `block_hashes`, `uploaded_hashes`)
- `security/` — stateless JWT via `JwtAuthFilter` (servlet filter) + `JwtTokenProvider`; `UserPrincipal` is the `Authentication` object placed in the security context
- `websocket/` — `SyncWebSocketHandler` authenticates via JWT query param (`?token=`); `ConnectionManager` maintains a `ConcurrentHashMap<userId, Set<WebSocketSession>>`

**Core flows:**

*Upload (3-step resumable with deduplication):*
1. `POST /api/upload/init` — client declares all block hashes; server returns only the `missingBlocks` hashes (blocks not yet in the store)
2. `PUT /api/upload/{id}/block/{index}` — server verifies SHA-256 of received bytes matches declared hash; stores to `./blocks/{hash[0:2]}/{hash}`
3. `POST /api/upload/{id}/commit` — creates `FileVersion` record, increments `ref_count` on all referenced blocks, appends to `change_log`, triggers WebSocket broadcast, GCs old versions if over `max-versions-per-file`

*Sync:* `change_log` is an append-only BIGSERIAL ledger. Devices poll `GET /api/sync/changes?since={cursor}` and update their `sync_cursor` via `PATCH /api/sync/device/{id}/cursor`. Every write path calls `SyncService.appendLog()`, which also calls `ConnectionManager.broadcastAsync()` to push to all connected WebSocket sessions for that user.

*Conflict resolution:* `MergeService` implements a diff3-style 3-way text merge (LCS-based). Binary conflicts result in a forked version rather than a merge. This is wired into `UploadService` but the merge decision logic lives in `MergeService`.

**Block GC:** `ref_count` on `blocks` table tracks how many `file_versions` reference each block. When `VersionService.deleteVersion()` or the GC in `UploadService.gcOldVersions()` removes a version, it decrements ref counts and deletes blocks with `ref_count <= 0` from both the DB and disk.

**Public endpoints (no auth):** `/api/auth/**`, `/api/shares/link/**`, `GET /actuator/health`. Everything else requires `Authorization: Bearer <jwt>`.

**Error handling:** Services throw `AppException(HttpStatus, message)`. `GlobalExceptionHandler` catches it and returns `{timestamp, status, error, message}`. Validation errors from `@Valid` return `{..., fields: {fieldName: message}}`. Never throw raw exceptions from service layer.

**Chunking:** `ChunkerService` runs CDC server-side using a rolling hash with `BOUNDARY_MASK = (1 << 13) - 1` (~8 KB average boundary). The file-level `content_hash` stored in `file_versions` is SHA-256 over the concatenated block hash strings (not over file bytes) — clients computing this hash must follow the same approach.

## Key constraints

- `jpa.hibernate.ddl-auto: validate` — Hibernate validates schema against entities but never modifies it. All schema changes must go through a new Flyway migration file in `src/main/resources/db/migration/`.
- Block storage keys use two-level sharding: `{hash[0:2]}/{hash}` on disk, same pattern stored as `storage_key` in the DB.
- Upload sessions track `uploadedHashes` as a JSON list (via `StringListConverter`). Deduped blocks are pre-marked as uploaded at init time so commit validation works correctly for fully-deduped files.
- `change_log.seq` is a `BIGSERIAL` primary key — never reused, monotonically increasing per user; clients must treat it as a cursor, not a count.