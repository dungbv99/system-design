.PHONY: build run stop clean logs \
        build-live run-live stop-live clean-live logs-live \
        build-jobs run-jobs stop-jobs clean-jobs logs-jobs \
        build-stock run-stock stop-stock clean-stock logs-stock crawl-now \
        mark-vn100 backtest backtest-3a backtest-3a-quick backtest-quick \
        backtest-3b backtest-holdout backtest-cpcv backtest-montecarlo backtest-robustness backtest-robust deploy-method methods \
        optimize live-scan full-pipeline clean-backtest backtest-progress claude-optimize claude-optimize-quick \
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

# ── Backtest / optimization methods ──────────────────────────────────────
# ĐANG DÙNG: 3a (walk-forward trượt). Mỗi phương pháp sẽ là 1 file riêng trong
# crawler/methods/ khi được cài đặt.  `make methods` để xem toàn bộ danh sách.

# 3a — Walk-forward trượt [HIỆN DÙNG]: train 3 năm → test năm kế, 1000 samples (~2-6h)
backtest-3a:
	@bash stock-analytics/scripts/run_backtest.sh $(CAPITAL) 1000
backtest: backtest-3a            # alias mặc định = phương pháp đang dùng (3a)

# 3a nhanh — 100 samples (~30-60 phút) để kiểm tra pipeline
backtest-3a-quick:
	@bash stock-analytics/scripts/run_backtest.sh $(CAPITAL) 100
backtest-quick: backtest-3a-quick

# Các phương pháp khác — CHƯA CÀI ĐẶT (mỗi cái = 1 file trong crawler/methods/)
backtest-3b:
	@echo "3b walk-forward neo — chưa cài đặt → crawler/methods/walk_forward_anchored.py"
backtest-holdout:
	@echo "2  holdout (train/test 1 lần) — chưa cài đặt → crawler/methods/holdout.py"
backtest-cpcv:
	@echo "6  combinatorial purged CV — chưa cài đặt → crawler/methods/cpcv.py"
backtest-montecarlo:
	@echo "7  Monte Carlo (độ tin cậy) — chưa cài đặt → crawler/methods/montecarlo.py"
backtest-robustness:
	@echo "8  robustness/sensitivity — chưa cài đặt → crawler/methods/robustness.py"

# 8+4+7 — Robust pipeline [ĐÃ CÀI ĐẶT]: plateau search → continuous → Monte Carlo.
# Vars: CAPITAL, SAMPLES (stage-1 candidates), MC (monte-carlo paths), START (yyyy-mm-dd)
SAMPLES ?= 200
MC      ?= 2000
START   ?= 2014-01-01
backtest-robust:
	@bash stock-analytics/scripts/run_robust_pipeline.sh $(CAPITAL) $(SAMPLES) $(MC) $(START)

# Deploy params tốt nhất của 1 phương pháp (đã lưu ở method_params) → optimized_params
# (bộ đang chạy live mà Buy Now + VN100 BT dùng).  Vd: make deploy-method METHOD=8+4+7
METHOD ?= 8+4+7
deploy-method:
	docker exec $(CRAWLER_CONTAINER) python3 -c \
	  "import os; from store import Store; s=Store(os.environ['DB_DSN']); \
	   s.ensure_wyckoff_opt_tables(); s.deploy_method_params('$(METHOD)'); \
	   print('deployed method $(METHOD) -> optimized_params (live)')"

# Liệt kê các phương pháp backtest / tối ưu
methods:
	@echo "Phương pháp backtest / tối ưu params (đang dùng = 3a):"
	@echo "  3a  make backtest-3a          Walk-forward trượt          [ĐANG DÙNG]"
	@echo "      make backtest-3a-quick    3a nhanh (100 samples)"
	@echo "  3b  make backtest-3b          Walk-forward neo (anchored) [chưa cài đặt]"
	@echo "  2   make backtest-holdout     Holdout train/test 1 lần    [chưa cài đặt]"
	@echo "  6   make backtest-cpcv        Combinatorial Purged CV     [chưa cài đặt]"
	@echo "  4   (tab VN100 BT)            Continuous fixed-params     [đã có]"
	@echo "  7   make backtest-montecarlo  Monte Carlo độ tin cậy      [chưa cài đặt]"
	@echo "  8   make backtest-robustness  Robustness / sensitivity    [chưa cài đặt]"
	@echo "  ★   make backtest-robust      Pipeline 8+4+7 (combo)      [ĐÃ CÀI ĐẶT]"
	@echo ""
	@echo "  Deploy params 1 phương pháp (method_params → optimized_params live):"
	@echo "      make deploy-method METHOD=8+4+7   (hoặc METHOD=3a)"

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

# Iterative Optuna refinement loop (README §9.5 / §18.2).
# bash orchestrates: Optuna does the numeric search (0 tokens), bash checks the
# stop conditions (0 tokens), and Claude is called once per iteration — stateless,
# short-lived — only to freeze params / narrow ranges. The README is never
# re-read and context never accumulates across iterations.
# Runs headless in the background. Run `make run-stock` first.
#   Tunables: MAX_ITER (default 10), CLAUDE_MODEL (default sonnet).
claude-optimize:
	@echo "Iterative optimization (bash-orchestrated)..."
	@mkdir -p stock-analytics/output
	@nohup bash stock-analytics/scripts/optimize_loop.sh > stock-analytics/output/claude_optimize.log 2>&1 & echo "Loop dang chay PID: $$!"
	@echo "Xem tien trinh : tail -f stock-analytics/output/claude_optimize.log"
	@echo "Xem ket qua    : tail -f stock-analytics/output/optimization_log.md"

# Single-iteration test run (background, nohup): 1 backtest → 1 Claude adjustment → edit.
# Use it to verify the whole pipeline end-to-end before launching the full loop.
claude-optimize-quick:
	@echo "Test 1 vong (backtest -> claude -> edit), chay nen (nohup)..."
	@mkdir -p stock-analytics/output
	@MAX_ITER=1 QUICK_TEST=1 nohup bash stock-analytics/scripts/optimize_loop.sh > stock-analytics/output/claude_optimize_quick.log 2>&1 & echo "Quick test dang chay PID: $$!"
	@echo "Xem tien trinh : tail -f stock-analytics/output/claude_optimize_quick.log"

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
