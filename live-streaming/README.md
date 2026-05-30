# Live Streaming Platform

A self-hosted live streaming platform built with Go, React, and Docker. Stream from OBS or any RTMP client, watch in the browser with HLS, and chat in real time.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser                              │
│   http://localhost:3000  (React + HLS.js + WebSocket)       │
└────────────┬───────────────────────────┬────────────────────┘
             │ /api/*  (REST)            │ ws://localhost:8083
             ▼                           ▼
    ┌─────────────────┐        ┌──────────────────┐
    │   stream-api    │        │   chat-service   │
    │   Go · :8082    │        │   Go · :8083     │
    │                 │        │                  │
    │ - Auth (JWT)    │        │ - WebSocket      │
    │ - Channels      │        │ - Redis pub/sub  │
    │ - SRS webhooks  │        │ - Viewer count   │
    └────────┬────────┘        └────────┬─────────┘
             │                          │
             ▼                          ▼
    ┌─────────────────┐        ┌──────────────────┐
    │   PostgreSQL    │        │     Redis        │
    │   :5433         │        │     :6380        │
    └─────────────────┘        └──────────────────┘

Streamer (OBS / ffmpeg)
    │  rtmp://localhost:1935/live/{streamKey}
    ▼
┌──────────┐   HLS segments   ┌───────────────┐
│   SRS    │ ───────────────► │  nginx-hls    │
│  :1935   │  /data/hls/      │  :8084        │
└──────────┘  (Docker volume) └───────────────┘
```

### Services

| Service | Language | Port | Description |
|---|---|---|---|
| `frontend` | React + TypeScript | 3000 | Web UI (Browse, Watch, Dashboard) |
| `stream-api` | Go 1.22 | 8082 | REST API — auth, channels, stream key validation |
| `chat-service` | Go 1.22 | 8083 | WebSocket chat with Redis pub/sub fanout |
| `srs` | C++ (Docker) | 1935 | RTMP ingest, converts to HLS segments |
| `nginx-hls` | nginx | 8084 | Serves HLS segments to browsers |
| `postgres` | PostgreSQL 15 | 5433 | Users, channels, stream sessions |
| `redis` | Redis 7 | 6380 | Chat pub/sub, viewer counts, chat history |

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- (Optional) [ffmpeg](https://ffmpeg.org/) for streaming from terminal
- (Optional) [OBS Studio](https://obsproject.com/) for streaming from desktop

## Getting Started

### 1. Start all services

```bash
docker compose up --build -d
```

Wait ~15 seconds for PostgreSQL and Redis to become healthy.

### 2. Open the app

```
http://localhost:3000
```

### 3. Create an account

Click **Sign up** and register. A channel is automatically created for your account.

### 4. Get your stream key

Go to **Dashboard** → **Stream Setup** → click **Show** next to Stream Key, then **Copy**.

### 5. Start streaming

**Option A — OBS Studio:**
1. Settings → Stream → Service: `Custom`
2. Server: `rtmp://localhost:1935/live`
3. Stream Key: *(paste from Dashboard)*
4. Click **Start Streaming**

**Option B — ffmpeg (webcam):**
```bash
STREAM_KEY="your-stream-key-here"

ffmpeg \
  -f avfoundation -framerate 30 -video_size 1280x720 -i "0:1" \
  -c:v libx264 -preset veryfast -tune zerolatency -b:v 2000k -g 60 \
  -c:a aac -b:a 128k \
  -f flv "rtmp://localhost:1935/live/$STREAM_KEY"
```

**Option B — ffmpeg (test stream, no camera):**
```bash
STREAM_KEY="your-stream-key-here"

ffmpeg -re \
  -f lavfi -i "testsrc2=size=1280x720:rate=30" \
  -f lavfi -i "sine=frequency=440" \
  -c:v libx264 -preset veryfast -b:v 1000k -g 60 \
  -c:a aac -b:a 128k \
  -f flv "rtmp://localhost:1935/live/$STREAM_KEY"
```

### 6. Watch the stream

Go to **http://localhost:3000** → **Browse** → click your channel.

After starting your stream, it takes ~6 seconds for the first HLS segments to appear.

## Project Structure

```
live-streaming/
├── docker-compose.yml       ← start everything with one command
│
├── stream-api/              ← Go REST API
│   ├── main.go              ← server setup and routing
│   ├── model.go             ← GORM models (User, Channel, StreamSession)
│   ├── auth.go              ← register, login, JWT signing
│   ├── channel.go           ← channel CRUD, stream key management
│   ├── stream_event.go      ← SRS webhook handlers (on_publish / on_unpublish)
│   └── middleware.go        ← JWT auth middleware, JSON helpers
│
├── chat-service/            ← Go WebSocket server
│   └── main.go              ← JWT auth, viewer count, rate limiting, Redis fanout
│
├── frontend/                ← React + TypeScript
│   └── src/
│       ├── pages/           ← Home, Watch, Login, Register, Dashboard
│       └── components/      ← Navbar, VideoPlayer, ChatBox, ChannelCard
│
├── srs/srs.conf             ← SRS media server config (RTMP + HLS + webhooks)
└── nginx/nginx.conf         ← HLS segment server config (CORS headers)
```

## API Reference

### Auth

```
POST /api/auth/register   { username, email, password }  → { token, userId, username }
POST /api/auth/login      { username, password }          → { token, userId, username }
```

### Channels

```
GET    /api/channels                    → list live channels
GET    /api/channels/:id                → get channel by ID
GET    /api/channels/me          [auth] → my channel
GET    /api/channels/me/stream-key [auth] → { streamKey, rtmpUrl }
PATCH  /api/channels/me          [auth] → update title
POST   /api/channels/me/stream-key/regenerate [auth] → new stream key
```

### Chat (WebSocket)

```
ws://localhost:8083/ws/:channelId?token=<jwt>
```

- Sends last 50 messages on connect
- Rate limited to 1 message per 2 seconds
- Messages: `{ username, content, timestamp }`

### Internal (called by SRS, not for clients)

```
POST /internal/stream/start   ← SRS on_publish hook
POST /internal/stream/end     ← SRS on_unpublish hook
```

## How Stream Key Auth Works

SRS calls `POST /internal/stream/start` before accepting any publisher. `stream-api` checks if the stream key exists in the database:

- Key found → returns `{"code": 0}` → SRS accepts the stream
- Key not found → returns `{"code": 1}` → SRS disconnects the publisher immediately

This means only registered users with valid keys can go live.

## Useful Commands

```bash
# Start
docker compose up -d

# Stop
docker compose down

# Stop and wipe all data (volumes)
docker compose down -v

# View logs for a specific service
docker compose logs -f stream-api
docker compose logs -f chat-service
docker compose logs -f srs

# Rebuild a single service after code change
docker compose build stream-api && docker compose up -d stream-api

# List available cameras (macOS)
ffmpeg -f avfoundation -list_devices true -i "" 2>&1
```

## Known Limitations

- **~4 second latency** — HLS segments are 2 seconds each with a 3-segment buffer. For sub-second latency, WebRTC ingest would be needed.
- **Single server** — no CDN, no horizontal scaling. Suitable for local development and small-scale use.
- **No VOD** — streams are not recorded. Past streams only retain metadata (peak viewers, duration).
