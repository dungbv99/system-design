.PHONY: build run stop clean logs \
        build-live run-live stop-live clean-live logs-live \
        build-jobs run-jobs stop-jobs clean-jobs logs-jobs \
        build-stock run-stock stop-stock clean-stock logs-stock crawl-now \
        build-java build-go deps test test-java test-go \
        new-go-service

# ── file-storage (file-storage/docker-compose.yml) ────────────────────────

build:
	docker compose -f file-storage/docker-compose.yml build

run:
	docker compose -f file-storage/docker-compose.yml up -d

stop:
	docker compose -f file-storage/docker-compose.yml down

clean:
	docker compose -f file-storage/docker-compose.yml down -v

logs:
	docker compose -f file-storage/docker-compose.yml logs -f

# ── live-streaming (live-streaming/docker-compose.yml) ────────────────────

build-live:
	docker compose -f live-streaming/docker-compose.yml build

run-live:
	docker compose -f live-streaming/docker-compose.yml up -d

stop-live:
	docker compose -f live-streaming/docker-compose.yml down

clean-live:
	docker compose -f live-streaming/docker-compose.yml down -v

logs-live:
	docker compose -f live-streaming/docker-compose.yml logs -f

# ── job-scheduler (job-scheduler/docker-compose.yml) ─────────────────────

build-jobs:
	docker compose -f job-scheduler/docker-compose.yml build

run-jobs:
	docker compose -f job-scheduler/docker-compose.yml up -d

stop-jobs:
	docker compose -f job-scheduler/docker-compose.yml down

clean-jobs:
	docker compose -f job-scheduler/docker-compose.yml down -v

logs-jobs:
	docker compose -f job-scheduler/docker-compose.yml logs -f

# ── Builds without Docker ─────────────────────────────────────────────────

build-java:
	mvn package -DskipTests

GO_DIRS := file-storage/sync-gateway live-streaming/stream-api live-streaming/chat-service

# ── stock-analytics (stock-analytics/docker-compose.yml) ─────────────────

build-stock:
	docker compose -f stock-analytics/docker-compose.yml build

run-stock:
	docker compose -f stock-analytics/docker-compose.yml up -d

stop-stock:
	docker compose -f stock-analytics/docker-compose.yml down

clean-stock:
	docker compose -f stock-analytics/docker-compose.yml down -v

logs-stock:
	docker compose -f stock-analytics/docker-compose.yml logs -f

# Trigger an immediate crawl without waiting for the daily schedule
crawl-now:
	docker compose -f stock-analytics/docker-compose.yml run --rm \
	  -e RUN_NOW=1 crawler python main.py

# Run the React dev server (proxies /api to localhost:8090)
dev-frontend-stock:
	cd stock-analytics/frontend && npm install && npm run dev

# ── Frontend (dev only) ───────────────────────────────────────────────────

dev-frontend:
	cd live-streaming/frontend && npm install && npm run dev

build-go:
	@for dir in $(GO_DIRS); do \
	  echo "Building $$dir..."; \
	  (cd "$$dir" && go build ./...); \
	done

deps:
	@for dir in $(GO_DIRS); do \
	  echo "go mod tidy: $$dir"; \
	  (cd "$$dir" && go mod tidy); \
	done

# ── Tests ─────────────────────────────────────────────────────────────────

test-java:
	mvn test

test-go:
	@for dir in $(GO_DIRS); do \
	  echo "Testing $$dir..."; \
	  (cd "$$dir" && go test ./...); \
	done

test: test-java test-go

# ── Scaffolding ───────────────────────────────────────────────────────────
# Usage: make new-go-service PROJECT=live-streaming NAME=my-service

new-go-service:
	@[ "$(PROJECT)" ] && [ "$(NAME)" ] || \
	  (echo "Usage: make new-go-service PROJECT=<file-storage|live-streaming> NAME=<name>" && exit 1)
	mkdir -p $(PROJECT)/$(NAME)
	cd $(PROJECT)/$(NAME) && go mod init github.com/example/system-design/$(NAME)
	@echo "Created $(PROJECT)/$(NAME)/ — add it to $(PROJECT)/docker-compose.yml"
