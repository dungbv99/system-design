.PHONY: build run stop clean logs \
        build-live run-live stop-live clean-live logs-live \
        build-jobs run-jobs stop-jobs clean-jobs logs-jobs \
        build-stock run-stock stop-stock clean-stock logs-stock crawl-now \
        mark-vn100 backtest backtest-quick optimize live-scan full-pipeline clean-backtest backtest-progress claude-optimize \
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

# ── Wyckoff-Optimized pipeline (README_WYCKOFF_OPTIMIZED.md §18) ──────────
# All targets exec inside the running crawler container (run `make run-stock`
# first). Results land in stock-analytics/output/. CAPITAL is in VND.
CRAWLER_CONTAINER := stock-analytics-crawler-1
CAPITAL           ?= 1000000000

# Mark the VN100 basket in the DB (idempotent; falls back to the static list).
mark-vn100:
	docker exec $(CRAWLER_CONTAINER) python3 -c \
	  "from store import Store; import os, sector_rotation as sr; \
	   print('marked', Store(os.environ['DB_DSN']).mark_vn100(sr.VN100), 'VN100 symbols')"

# Full walk-forward backtest (2014-2025) — 1000 samples, ~2-6h.
backtest:
	@bash stock-analytics/scripts/run_backtest.sh $(CAPITAL) 1000

# Quick backtest — 100 samples, ~30-60 min.
backtest-quick:
	@bash stock-analytics/scripts/run_backtest.sh $(CAPITAL) 100

# Optimize per regime and save params (assumes data already loaded).
optimize:
	docker exec $(CRAWLER_CONTAINER) python3 -c \
	  "import os, opt_backtest; from store import Store; \
	   opt_backtest.optimize_and_save(Store(os.environ['DB_DSN']), $(CAPITAL))"

# Live signal scan for today using the current regime's optimized params.
live-scan:
	docker exec $(CRAWLER_CONTAINER) python3 -c \
	  "import os; from store import Store; from main import run_live_wyckoff_opt; \
	   run_live_wyckoff_opt(Store(os.environ['DB_DSN']))"

# Backtest + write result files to output/ (and Claude analysis if API key set).
full-pipeline:
	@$(MAKE) backtest CAPITAL=$(CAPITAL)
	@bash stock-analytics/scripts/after_backtest.sh
	@echo "" && echo "DONE — results in stock-analytics/output/" && ls -lh stock-analytics/output/

clean-backtest:
	docker exec $(CRAWLER_CONTAINER) python3 -c \
	  "import os; from store import Store; \
	   Store(os.environ['DB_DSN']).clean_backtest_runs(); print('cleaned')"

# Print live backtest progress as X/100% (poll this while a backtest runs).
backtest-progress:
	@curl -s http://localhost:8090/api/backtest/progress | python3 -c \
	  "import sys,json; d=json.load(sys.stdin); \
	   eta=d.get('eta_sec'); \
	   print(f\"{d.get('overall_pct',0):.1f}/100%  [{d.get('phase') or '-'}] \" \
	         f\"{d.get('phase_current',0)}/{d.get('phase_total',0)}  \" \
	         f\"elapsed={d.get('elapsed_sec',0)}s\" + (f' eta~{eta}s' if eta else '') + \
	         ('' if d.get('active') or d.get('running') else '  (idle)'))"

# Iterative Optuna refinement loop driven by Claude (README §9.5 / §18.2).
# Runs headless in the background; tweaks TUNE_PARAMS/FIXED_PARAMS each pass and
# logs progress to stock-analytics/output/. Run `make run-stock` first.
claude-optimize:
	@echo "Claude bat dau iterative optimization..."
	@mkdir -p stock-analytics/output
	@nohup claude -p --permission-mode acceptEdits "Read stock-analytics/README_WYCKOFF_OPTIMIZED.md Section 9 for the full strategy. Read stock-analytics/crawler/wyckoff_opt.py for DEFAULT_PARAMS and FIXED_PARAMS. Read stock-analytics/crawler/optimizer.py for TUNE_PARAMS and Optuna setup. Do this iterative loop (max 10 iterations): ITERATION START: 1. Run: make backtest-quick 2. Read stock-analytics/output/backtest_result.json 3. Analyze: - annual_return < 20% -> loosen entry (lower rsi_entry_max, lower min_signal_score) - max_drawdown > 25% -> tighten stops (raise atr_stop_mult, lower atr_trail_pct) - win_rate < 55% -> tighten entry (raise min_signal_score, lower rsi_entry_max) - 2022 return < -5% -> lower downtrend_drawdown_pct (detect downtrend earlier) - indicator IC < 0.02 -> note which indicators are weak (do not remove yet) 4. Decide which params to FREEZE (move from TUNE_PARAMS to FIXED_PARAMS) 5. Narrow the range of remaining TUNE_PARAMS 6. Edit stock-analytics/crawler/wyckoff_opt.py and stock-analytics/crawler/optimizer.py with changes 7. Append to stock-analytics/output/optimization_log.md: iteration number, changes made, reason, results 8. REPEAT from step 1 STOP when: annual_return >= 20% AND max_drawdown <= 25% AND win_rate >= 55% AND sharpe >= 1.0 OR after 10 iterations. Write final summary to stock-analytics/output/optimization_log.md with best params found." > stock-analytics/output/claude_optimize.log 2>&1 & echo "Claude dang chay PID: $$!"
	@echo "Xem tien trinh : tail -f stock-analytics/output/claude_optimize.log"
	@echo "Xem ket qua    : tail -f stock-analytics/output/optimization_log.md"

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
