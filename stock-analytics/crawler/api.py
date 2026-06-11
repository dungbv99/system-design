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

ALL_JOBS = ["symbols", "quotes", "foreign", "news", "fundamentals", "history", "wyckoff", "multifactor", "predictions"]


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


class PortfolioBacktestRequest(BaseModel):
    symbols:    list[str] = []          # empty → backend VN100 default
    label:      str       = "VN100 Wyckoff 2018+"
    start_date: date      = date(2018, 1, 1)
    capital:    float     = 1_000_000_000.0
    slots:      int       = 8
    cost_pct:   float     = 0.3
    min_hold:   int       = 3
    lot_size:   int       = 100


class BuyRequest(BaseModel):
    symbol:    str
    quantity:  int            = 1000
    buy_price: Optional[float] = None   # None → assume buy at latest close
    note:      Optional[str]   = None


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

    # ── Wyckoff signals ───────────────────────────────────────────────────────

    @app.get("/api/symbols/{symbol}/wyckoff")
    def symbol_wyckoff(symbol: str):
        """Return stored Wyckoff analysis for one symbol."""
        result = store.get_wyckoff_signal(symbol.strip().upper())
        if not result:
            raise HTTPException(404, f"No Wyckoff analysis for {symbol.upper()}. "
                                     "POST /api/symbols/{symbol}/wyckoff to compute.")
        return result

    @app.post("/api/symbols/{symbol}/wyckoff", status_code=202)
    def compute_symbol_wyckoff(symbol: str):
        """Compute and persist Wyckoff analysis for one symbol."""
        sym = symbol.strip().upper()

        def run():
            bars = store.get_symbol_quotes(sym, days=300)
            if not bars:
                log.warning("wyckoff %s: no quote data", sym)
                return
            import wyckoff as w
            analysis = w.analyze(sym, bars, lookback=260)
            store.upsert_wyckoff_signal(analysis)
            log.info("wyckoff %s: phase=%s signal=%s/%s last_event=%s",
                     sym, analysis.phase, analysis.signal,
                     analysis.signal_strength, analysis.last_event)

        threading.Thread(target=run, daemon=True).start()
        return {"message": f"Wyckoff analysis started for {sym}", "symbol": sym}

    @app.get("/api/wyckoff/signals")
    def wyckoff_signals(
        signal: str = "",
        phase:  str = "",
        limit:  int = 50,
        offset: int = 0,
    ):
        """
        List all stored Wyckoff signals, sorted by signal strength.

        Query params:
          signal — filter by BUY | SHORT | WAIT | HOLD
          phase  — filter by phase name (partial match)
          limit  — max results (default 50)
          offset — pagination offset
        """
        return store.get_wyckoff_signals(signal=signal, phase=phase,
                                         limit=limit, offset=offset)

    @app.post("/api/wyckoff/compute", status_code=202)
    def compute_all_wyckoff(exchanges: str = ""):
        """
        Recompute Wyckoff signals (runs in background).

        exchanges — comma-separated board list (e.g. 'HOSE,HNX').
                    Omit it, or pass 'all', to analyse EVERY symbol that has
                    quote data across all boards (HOSE, HNX, UPCOM, OTC, …).
        """
        if not state.acquire(str(date.today()), ["wyckoff"]):
            raise HTTPException(409, "A crawl is already running")

        raw = exchanges.strip().lower()
        if raw in ("", "all", "*"):
            exch_list = None
        else:
            exch_list = [e.strip().upper() for e in exchanges.split(",") if e.strip()]
        scope = "all symbols with quotes" if exch_list is None else exch_list

        def run():
            try:
                crawler.compute_wyckoff(exchanges=exch_list)
            except Exception as e:
                log.error("wyckoff compute failed: %s", e)
            finally:
                state.release()

        threading.Thread(target=run, daemon=True).start()
        return {"message": f"Wyckoff analysis started for {scope}",
                "exchanges": exch_list or "all"}

    # ── Multi-factor signals ──────────────────────────────────────────────────

    @app.get("/api/symbols/{symbol}/multifactor")
    def symbol_multifactor(symbol: str):
        """Return stored multi-factor analysis for one symbol."""
        result = store.get_multifactor_signal(symbol.strip().upper())
        if not result:
            raise HTTPException(404, f"No multi-factor analysis for {symbol.upper()}. "
                                     "POST /api/symbols/{symbol}/multifactor to compute.")
        return result

    @app.post("/api/symbols/{symbol}/multifactor", status_code=202)
    def compute_symbol_multifactor(symbol: str):
        """Compute and persist multi-factor analysis for one symbol."""
        sym = symbol.strip().upper()

        def run():
            bars = store.get_symbol_quotes(sym, days=300)
            if not bars:
                log.warning("multifactor %s: no quote data", sym)
                return
            import multi_factor as mf
            analysis = mf.analyze(sym, bars)
            store.upsert_multifactor_signal(analysis)
            log.info("multifactor %s: signal=%s/%s score=%d agreed=%d",
                     sym, analysis.signal, analysis.confidence,
                     analysis.total_score, analysis.factors_agreed)

        threading.Thread(target=run, daemon=True).start()
        return {"message": f"Multi-factor analysis started for {sym}", "symbol": sym}

    @app.get("/api/multifactor/signals")
    def multifactor_signals(
        signal:     str = "",
        min_score:  int = 0,
        confidence: str = "",
        limit:      int = 50,
        offset:     int = 0,
    ):
        """
        List all stored multi-factor signals, sorted by total score descending.

        Query params:
          signal     — filter by BUY | WATCH | AVOID
          min_score  — minimum total_score (0–100)
          confidence — filter by HIGH | MEDIUM | LOW
          limit      — max results (default 50)
          offset     — pagination offset
        """
        return store.get_multifactor_signals(
            signal=signal, min_score=min_score, confidence=confidence,
            limit=limit, offset=offset,
        )

    @app.post("/api/multifactor/compute", status_code=202)
    def compute_all_multifactor(exchanges: str = ""):
        """
        Recompute multi-factor signals (runs in background).

        exchanges — comma-separated board list (e.g. 'HOSE,HNX').
                    Omit it, or pass 'all', to analyse EVERY symbol that has
                    quote data across all boards.
        """
        if not state.acquire(str(date.today()), ["multifactor"]):
            raise HTTPException(409, "A crawl is already running")

        raw = exchanges.strip().lower()
        if raw in ("", "all", "*"):
            exch_list = None
        else:
            exch_list = [e.strip().upper() for e in exchanges.split(",") if e.strip()]
        scope = "all symbols with quotes" if exch_list is None else exch_list

        def run():
            try:
                crawler.compute_multifactor(exchanges=exch_list)
            except Exception as e:
                log.error("multifactor compute failed: %s", e)
            finally:
                state.release()

        threading.Thread(target=run, daemon=True).start()
        return {"message": f"Multi-factor analysis started for {scope}",
                "exchanges": exch_list or "all"}

    # ── Paper trades (assumed buys, performance review) ───────────────────────

    @app.get("/api/portfolio")
    def list_portfolio(status: str = ""):
        """List assumed buys with live performance. status=OPEN|CLOSED to filter."""
        return store.list_paper_trades(status=status.strip().upper())

    @app.post("/api/portfolio", status_code=201)
    def add_portfolio(req: BuyRequest):
        sym = req.symbol.strip().upper()
        if not sym:
            raise HTTPException(400, "Symbol must not be empty")
        if req.quantity <= 0:
            raise HTTPException(400, "Quantity must be positive")

        buy_price = req.buy_price
        if buy_price is None:
            buy_price = store.get_latest_close(sym)
            if buy_price is None:
                raise HTTPException(404, f"No price data for {sym} to assume a buy")

        # Snapshot the current Wyckoff plan (entry/stop/target) for later review.
        wy = store.get_wyckoff_signal(sym) or {}
        trade_id = store.add_paper_trade(
            symbol=sym,
            buy_price=buy_price,
            quantity=req.quantity,
            entry_price=wy.get("entry_price"),
            stop_loss=wy.get("stop_loss"),
            target=wy.get("resistance"),
            phase=wy.get("phase"),
            signal=wy.get("signal"),
            note=req.note,
        )
        log.info("paper trade #%d: BUY %d %s @ %.2f", trade_id, req.quantity, sym, buy_price)
        return {"id": trade_id, "symbol": sym, "buy_price": buy_price, "quantity": req.quantity}

    @app.post("/api/portfolio/{trade_id}/close", status_code=200)
    def close_portfolio(trade_id: int):
        mark = store.close_paper_trade(trade_id)
        if mark is None:
            raise HTTPException(409, "Trade not found, already closed, or has no price data")
        return {"id": trade_id, "close_price": mark}

    @app.delete("/api/portfolio/{trade_id}", status_code=200)
    def delete_portfolio(trade_id: int):
        if not store.delete_paper_trade(trade_id):
            raise HTTPException(404, "Trade not found")
        return {"id": trade_id, "deleted": True}

    # ── Backtest ──────────────────────────────────────────────────────────────

    @app.get("/api/backtest/{symbol}")
    def symbol_backtest(
        symbol:   str,
        strategy: str = "both",   # signal_replay | event_trades | both
        lookback: int = 260,
        horizon:  int = 20,       # max hold (bars) for signal_replay
        max_hold: int = 60,       # max hold (bars) for event_trades
        step:     int = 5,        # walk-forward step in bars
    ):
        """
        Walk-forward Wyckoff backtest for one symbol.

        Runs synchronously — may take a few seconds for long histories.
        Returns signal_replay and/or event_trades result objects.
        """
        sym  = symbol.strip().upper()
        bars = store.get_symbol_quotes(sym, days=9999)
        if not bars:
            raise HTTPException(404, f"No price data for {sym}")
        import backtest as bt
        result = bt.run_backtest(
            sym, bars,
            strategy=strategy, lookback=lookback,
            horizon=horizon, max_hold=max_hold, step=step,
        )
        return result

    # ── Portfolio backtest (Wyckoff over a basket, e.g. VN100) ────────────────

    @app.get("/api/portfolio-backtest")
    def get_portfolio_backtest():
        """Return the most recent stored portfolio backtest, or null if none."""
        return store.get_latest_portfolio_backtest()

    @app.post("/api/portfolio-backtest", status_code=202)
    def run_portfolio_backtest(req: PortfolioBacktestRequest):
        """Run a Wyckoff portfolio backtest over a basket (background job)."""
        if not state.acquire(str(date.today()), ["portfolio_backtest"]):
            raise HTTPException(409, "A crawl is already running")

        syms = [s.strip().upper() for s in req.symbols if s.strip()] if req.symbols else None

        def run():
            try:
                crawler.run_portfolio_backtest(
                    symbols=syms,
                    label=req.label,
                    start_date=str(req.start_date),
                    capital=req.capital,
                    slots=req.slots,
                    cost_pct=req.cost_pct,
                    min_hold=req.min_hold,
                    lot_size=req.lot_size,
                )
            except Exception as e:
                log.error("portfolio backtest failed: %s", e)
            finally:
                state.release()

        threading.Thread(target=run, daemon=True).start()
        return {"message": "portfolio backtest started", "label": req.label}

    # ── XGBoost predictions ───────────────────────────────────────────────────

    @app.get("/api/symbols/{symbol}/prediction")
    def symbol_prediction(symbol: str, horizon: int = 5):
        result = store.get_symbol_prediction(symbol.strip().upper(), horizon)
        if not result:
            raise HTTPException(
                404,
                f"No prediction for {symbol.upper()}. "
                "POST /api/predictions/compute to generate.",
            )
        return result

    @app.get("/api/predictions")
    def list_predictions(
        signal: str = "",
        horizon: int = 5,
        limit: int = 50,
        offset: int = 0,
    ):
        """
        List latest XGBoost predictions sorted by score descending.

        Query params:
          signal  — filter by BUY | HOLD
          horizon — forecast horizon in days (default 5)
          limit   — max results (default 50)
          offset  — pagination offset
        """
        return store.get_predictions(
            signal=signal, horizon=horizon, limit=limit, offset=offset
        )

    @app.post("/api/predictions/compute", status_code=202)
    def compute_predictions(exchanges: str = "HOSE,HNX"):
        """
        Train XGBoost on all history and generate predictions (runs in background).

        exchanges — comma-separated list, default HOSE,HNX.
        """
        if not state.acquire(str(date.today()), ["predictions"]):
            raise HTTPException(409, "A crawl is already running")

        exch_list = [e.strip().upper() for e in exchanges.split(",") if e.strip()]

        def run():
            try:
                import predict as predict_engine
                symbols   = store.get_all_symbols(exchanges=exch_list)
                predictor = predict_engine.Predictor(store)
                n = predictor.run(symbols)
                log.info("predictions: stored %d rows", n)
            except Exception as e:
                log.error("predictions compute failed: %s", e)
            finally:
                state.release()

        threading.Thread(target=run, daemon=True).start()
        return {"message": f"prediction started for {exch_list}", "exchanges": exch_list}

    # ── index / sector compositions ───────────────────────────────────────────

    @app.get("/api/index-compositions")
    def index_compositions():
        """Return live index/sector symbol lists from SSI iboard indexGroups."""
        try:
            return crawler.client.get_index_compositions()
        except Exception as e:
            log.error("index-compositions failed: %s", e)
            raise HTTPException(502, f"Failed to fetch compositions from SSI: {e}")

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
