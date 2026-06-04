"""
HTTP API for the stock crawler.
Runs in a background thread alongside the daily scheduler.

Endpoints:
  GET  /api/health
  GET  /api/stats
  GET  /api/crawl/status
  GET  /api/crawl/runs?limit=30
  POST /api/crawl                    body: {"date": "YYYY-MM-DD", "jobs": [...]}
  POST /api/symbols/{symbol}/history  on-demand full history fetch for one symbol
"""

import logging
import threading
from datetime import date, datetime, timedelta
from typing import Optional

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

log = logging.getLogger(__name__)

ALL_JOBS = ["symbols", "quotes", "foreign", "news", "fundamentals", "history"]


# ── Crawl state (shared between API and scheduler threads) ────────────────────

class CrawlState:
    def __init__(self):
        self._lock    = threading.Lock()
        self.running  = False
        self.run_date: Optional[str]       = None
        self.jobs:     list[str]           = []
        self.started:  Optional[datetime]  = None

    def acquire(self, target: str, jobs: list[str]) -> bool:
        with self._lock:
            if self.running:
                return False
            self.running  = True
            self.run_date = target
            self.jobs     = jobs
            self.started  = datetime.utcnow()
            return True

    def release(self):
        with self._lock:
            self.running = False

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "running":    self.running,
                "date":       self.run_date,
                "jobs":       list(self.jobs),
                "started_at": self.started.isoformat() if self.started else None,
            }


# ── Request / response schemas ────────────────────────────────────────────────

class CrawlRequest(BaseModel):
    date:  date
    jobs:  list[str] = ["symbols", "quotes", "foreign", "news"]
    years: int       = 0   # 0 = all time (from 2000-01-01); N = last N years


# ── App factory ───────────────────────────────────────────────────────────────

def create_app(crawler, store, state: CrawlState) -> FastAPI:
    app = FastAPI(title="Stock Crawler API")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ── health ────────────────────────────────────────────────────────────────

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    # ── stats ─────────────────────────────────────────────────────────────────

    @app.get("/api/stats")
    def get_stats():
        return store.get_stats()

    # ── crawl status ──────────────────────────────────────────────────────────

    @app.get("/api/crawl/status")
    def crawl_status():
        return state.snapshot()

    # ── market data ───────────────────────────────────────────────────────────

    @app.get("/api/symbols/list")
    def list_symbols(q: str = "", limit: int = 50, offset: int = 0, exchange: str = "", symbols: str = ""):
        syms = [s.strip().upper() for s in symbols.split(",") if s.strip()] if symbols else None
        return store.get_symbols_with_prices(q, limit, offset, exchange, syms)

    @app.get("/api/symbols/{symbol}/quotes")
    def symbol_quotes(symbol: str, days: int = 60):
        return store.get_symbol_quotes(symbol, days)

    # ── crawl history ─────────────────────────────────────────────────────────

    @app.get("/api/crawl/runs")
    def crawl_runs(limit: int = 30):
        return store.get_crawl_runs(limit)

    # ── incremental update ────────────────────────────────────────────────────

    @app.get("/api/crawl/update-info")
    def update_info():
        """Return the date range that /crawl/update would fetch."""
        last = store.get_latest_quote_date()
        today = date.today()
        start = (last - timedelta(days=1)) if last else date(2000, 1, 1)
        return {
            "latest_date": str(last) if last else None,
            "from_date":   str(start),
            "to_date":     str(today),
            "up_to_date":  start > today,
        }

    @app.post("/api/crawl/update", status_code=202)
    def trigger_update():
        """Crawl OHLCV from the day after latest stored quote up to today."""
        if not state.acquire(str(date.today()), ["update"]):
            raise HTTPException(409, "A crawl is already running")

        def run():
            try:
                crawler.crawl_update(date.today())
            except Exception as e:
                log.error("update crawl failed: %s", e)
            finally:
                state.release()

        threading.Thread(target=run, daemon=True).start()
        return {"message": "update crawl started"}

    # ── on-demand per-symbol crawl ────────────────────────────────────────────

    @app.post("/api/symbols/{symbol}/history", status_code=202)
    def fetch_symbol_history(symbol: str):
        """Backward-compat: fetch price history only for one symbol."""
        sym = symbol.strip().upper()

        def run():
            log.info("on-demand history start: %s", sym)
            end   = date.today()
            start = date(2000, 1, 1)
            try:
                quotes = crawler.client.get_historical_quotes(sym, start, end)
                if not quotes:
                    log.warning("on-demand history %s: no data returned by API", sym)
                    return
                n = store.upsert_quotes(sym, quotes)
                log.info("on-demand history %s: %d rows stored", sym, n)
            except Exception as e:
                log.error("on-demand history %s failed: %s", sym, e)

        threading.Thread(target=run, daemon=True).start()
        return {"message": f"history fetch started for {sym}", "symbol": sym}

    @app.post("/api/symbols/{symbol}/crawl", status_code=202)
    def crawl_single_symbol(symbol: str):
        """Fetch all data (history + fundamentals) for one symbol."""
        sym = symbol.strip().upper()
        if not sym:
            from fastapi import HTTPException
            raise HTTPException(400, "Symbol must not be empty")

        def run():
            crawler.crawl_symbol(sym, date.today())

        threading.Thread(target=run, daemon=True).start()
        return {"message": f"crawl started for {sym}", "symbol": sym}

    # ── backfill missing history ──────────────────────────────────────────────

    @app.post("/api/crawl/backfill-missing", status_code=202)
    def backfill_missing():
        """Fetch full history for all symbols that have no quote data yet."""
        if not state.acquire(str(date.today()), ["history:new"]):
            raise HTTPException(409, "A crawl is already running")

        def run():
            try:
                crawler.crawl_missing_history(date.today())
            except Exception as e:
                log.error("backfill-missing failed: %s", e)
            finally:
                state.release()

        threading.Thread(target=run, daemon=True).start()
        return {"message": "backfill started for symbols with no history"}

    # ── trigger crawl ─────────────────────────────────────────────────────────

    @app.post("/api/crawl", status_code=202)
    def trigger_crawl(req: CrawlRequest):
        unknown = [j for j in req.jobs if j not in ALL_JOBS]
        if unknown:
            raise HTTPException(400, f"Unknown jobs: {unknown}. Valid: {ALL_JOBS}")

        target = str(req.date)
        if not state.acquire(target, req.jobs):
            raise HTTPException(409, "A crawl is already running")

        def run():
            log.info("API-triggered crawl: date=%s jobs=%s", target, req.jobs)
            try:
                if "symbols"      in req.jobs: crawler.crawl_symbols(req.date)
                if "quotes"       in req.jobs: crawler.crawl_market_data(req.date)
                if "history"      in req.jobs: crawler.crawl_history(req.date, years=req.years)
                if "news"         in req.jobs: crawler.crawl_news(req.date)
                if "fundamentals" in req.jobs: crawler.crawl_fundamentals(req.date)
            except Exception as e:
                log.error("API crawl failed: %s", e)
            finally:
                state.release()

        threading.Thread(target=run, daemon=True).start()
        return {"message": "crawl started", "date": target, "jobs": req.jobs}

    return app


# ── Server launcher ───────────────────────────────────────────────────────────

def start_server(crawler, store, state: CrawlState, port: int = 8090):
    app = create_app(crawler, store, state)
    config = uvicorn.Config(app, host="0.0.0.0", port=port, log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    log.info("crawler API listening on :%d", port)
    return thread
