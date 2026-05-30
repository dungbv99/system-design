.PHONY: build run stop clean logs \
        build-live run-live stop-live clean-live logs-live \
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

# ── Builds without Docker ─────────────────────────────────────────────────

build-java:
	mvn package -DskipTests

GO_DIRS := file-storage/sync-gateway live-streaming/stream-api live-streaming/chat-service

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
