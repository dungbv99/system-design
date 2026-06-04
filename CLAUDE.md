# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Polyglot system-design portfolio. Each top-level folder is one independent project with its own `docker-compose.yml`. Java modules share the root `pom.xml`; Go services each have their own `go.mod`.

## Repo layout

```
system-design/
├── pom.xml                          ← Maven parent (Java modules only)
├── Makefile                         ← unified commands for all projects
│
├── file-storage/                    ← Project 1: content-addressed file storage
│   ├── docker-compose.yml           ← postgres + redis + file-storage + sync-gateway
│   ├── Dockerfile                   ← Java build (context must be repo root)
│   ├── src/                         ← Java 17 / Spring Boot 3
│   └── sync-gateway/                ← Go 1.22: WebSocket → Redis pub/sub
│
├── job-scheduler/                   ← Project 3: distributed job scheduler
│   ├── docker-compose.yml           ← postgres + redis + job-service + 3 schedulers + 3 workers
│   ├── job-service/                 ← Go 1.22: REST API for job submission & status
│   ├── scheduler/                   ← Go 1.22: Raft leader election, job dispatch, fault recovery
│   ├── worker/                      ← Go 1.22: job execution, heartbeat, retry logic
│   └── db/init.sql                  ← schema
│
├── live-streaming/                  ← Project 2: live streaming platform
│   ├── docker-compose.yml           ← all live-streaming services
│   ├── stream-api/                  ← Go 1.22: REST API, auth, SRS webhooks
│   ├── chat-service/                ← Go 1.22: WebSocket chat, Redis fanout
│   ├── srs/srs.conf                 ← SRS media server (RTMP ingest + HLS)
│   └── nginx/nginx.conf             ← HLS segment server
│
└── stock-analytics/                 ← Project 4: daily stock data crawler
    ├── docker-compose.yml           ← postgres + crawler
    ├── db/init.sql                  ← schema (symbols, quotes, foreign, fundamentals, news)
    └── crawler/                     ← Python 3.12: Fireant API crawler, daily scheduler
```

## Projects

### file-storage (`file-storage/docker-compose.yml`)

| Service | Language | Port | Role |
|---|---|---|---|
| `file-storage` | Java 17 / Spring Boot 3 | 8080 | REST API, block storage, auth |
| `sync-gateway` | Go 1.22 | 8081 | WebSocket → Redis pub/sub |

Infrastructure: **PostgreSQL :5432**, **Redis :6379**

### job-scheduler (`job-scheduler/docker-compose.yml`)

| Service | Language | Port | Role |
|---|---|---|---|
| `job-service` | Go 1.22 | 8085 | REST API — submit, query, cancel jobs |
| `scheduler-1/2` | Go 1.22 | — | Leader election + job dispatch + fault recovery |
| `worker-1/2/3` | Go 1.22 | — | Job execution, heartbeat, retry (4 slots each = 12 total) |
| `frontend` | nginx | 3000 | Dashboard UI (proxies /api/ → job-service) |

Infrastructure: **PostgreSQL :5434**, **Redis :6381**

**Job priority:** 0=critical · 1=high · 2=normal · 3=background

```bash
# Submit jobs
curl -X POST http://localhost:8085/api/jobs \
  -H 'Content-Type: application/json' \
  -d '{"name":"my-job","payload":"{}","priority":1,"max_retries":3}'

# List jobs
curl http://localhost:8085/api/jobs?status=RUNNING

# Check workers
curl http://localhost:8085/api/workers
```

**Job lifecycle:** PENDING → ASSIGNED → RUNNING → COMPLETED | FAILED → (retry) → DEAD

### live-streaming (`live-streaming/docker-compose.yml`)

| Service | Language | Port | Role |
|---|---|---|---|
| `stream-api` | Go 1.22 | 8082 | Channel management, auth, SRS webhooks |
| `chat-service` | Go 1.22 | 8083 | WebSocket chat, Redis fanout, viewer count |
| `srs` | C++ (Docker image) | 1935 | RTMP ingest → HLS segments |
| `nginx-hls` | nginx (Docker image) | 8084 | HLS segment server |

Infrastructure: **PostgreSQL :5433**, **Redis :6380**

### stock-analytics (`stock-analytics/docker-compose.yml`)

| Service | Language | Port | Role |
|---|---|---|---|
| `crawler` | Python 3.12 | — | Daily Fireant API crawler; stores to PostgreSQL |

Infrastructure: **PostgreSQL :5435**

**Data collected:** symbols, daily OHLCV, foreign investor flow, quarterly fundamentals, news

**Required:** Set `FIREANT_TOKEN` in `docker-compose.yml` before running.
Get your token: log into fireant.vn → DevTools → Network → any request → copy `Authorization` header.

```bash
make run-stock       # start postgres + crawler (waits for scheduled time)
make crawl-now       # trigger an immediate crawl right now
make logs-stock      # follow crawler logs
```

**Tables:** `symbols`, `daily_quotes`, `foreign_trading`, `fundamentals`, `news`, `crawl_runs`

## Commands

```bash
# file-storage
make build      # docker build
make run        # docker compose up -d
make stop       # docker compose down
make clean      # down -v (removes volumes)
make logs       # follow logs

# live-streaming
make build-live
make run-live
make stop-live
make clean-live
make logs-live

# Without Docker
make build-java          # mvn package -DskipTests
make build-go            # go build in all Go services
make deps                # go mod tidy in all Go services
make test                # all tests (Java + Go)

# Scaffold a new Go service
make new-go-service PROJECT=live-streaming NAME=analytics-worker
make new-go-service PROJECT=file-storage   NAME=thumbnail-service
```

## Streamer workflow (live-streaming)

```
1. POST http://localhost:8082/api/auth/register   → JWT + channel created
2. GET  http://localhost:8082/api/channels/me/stream-key → RTMP stream key
3. Push: rtmp://localhost:1935/live/{streamKey}   (OBS / ffmpeg)
4. Watch: http://localhost:8084/live/{streamKey}/index.m3u8
5. Chat:  ws://localhost:8083/ws/{channelId}?token=<jwt>
```

## Adding a new Java module

1. Create `<module>/pom.xml` referencing root as parent.
2. Add `<module>new-module</module>` to root `pom.xml`.
3. Add a `Dockerfile` (build context = repo root to access parent `pom.xml`).
4. Add to the relevant project's `docker-compose.yml`.

## Adding a new Go service

```bash
make new-go-service PROJECT=<file-storage|live-streaming> NAME=<name>
make deps
# then add the service to the project's docker-compose.yml
```
