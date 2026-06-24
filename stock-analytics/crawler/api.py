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
    slots:      int       = 12
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

    # ── Quarterly report analysis (Vietstock BCTC → Gemini / Claude) ─────────

    store.ensure_report_analyses_table()
    store.ensure_derivatives_tables()
    report_jobs: dict[str, dict] = {}          # "SYMBOL:provider" → {status, error}
    report_lock = threading.Lock()

    PROVIDER_KEYS = {"gemini": "GEMINI_API_KEY", "claude": "ANTHROPIC_API_KEY"}

    def _provider_or_400(provider: str) -> str:
        p = (provider or "gemini").strip().lower()
        if p not in PROVIDER_KEYS:
            raise HTTPException(400, f"provider phải là 'gemini' hoặc 'claude', nhận: {p}")
        return p

    @app.get("/api/symbols/{symbol}/report-analysis")
    def get_report_analysis(symbol: str, provider: str = "gemini"):
        """
        Latest cached quarterly-report analysis for one symbol + provider,
        plus the state of any in-flight analysis job:
          {status: 'running'|'error'|'ready'|'none', ...row, error}
        """
        sym = symbol.strip().upper()
        prov = _provider_or_400(provider)
        key = f"{sym}:{prov}"
        with report_lock:
            job = dict(report_jobs.get(key) or {})
        row = store.get_latest_report_analysis(sym, provider=prov)
        if job.get("status") == "running":
            return {"status": "running"}
        if job.get("status") == "error":
            return {"status": "error", "error": job.get("error", "unknown"),
                    **({"previous": row} if row else {})}
        if row:
            return {"status": "ready", **row}
        return {"status": "none"}

    @app.post("/api/symbols/{symbol}/report-analysis", status_code=202)
    def compute_report_analysis(symbol: str, provider: str = "gemini"):
        """
        Crawl the latest quarterly BCTC from Vietstock and analyze it with the
        chosen provider (background job). Cached per (symbol, year, quarter,
        provider) — if the newest report was already analyzed, the job
        finishes instantly.
        """
        sym = symbol.strip().upper()
        prov = _provider_or_400(provider)
        key = f"{sym}:{prov}"
        import os as _os
        env_key = PROVIDER_KEYS[prov]
        if not _os.environ.get(env_key, "").strip():
            raise HTTPException(400, f"{env_key} chưa được cấu hình cho service crawler")
        with report_lock:
            if report_jobs.get(key, {}).get("status") == "running":
                raise HTTPException(409, f"Analysis for {sym} ({prov}) is already running")
            report_jobs[key] = {"status": "running"}

        def run():
            import report_analysis as ra
            try:
                report = ra.fetch_latest_report(sym)
                year, quarter = report["year"], report["quarter"]
                if store.get_report_analysis(sym, year, quarter, provider=prov):
                    log.info("report %s/%s: Q%s/%s already analyzed (cache hit)",
                             sym, prov, quarter, year)
                else:
                    wyckoff = store.get_wyckoff_signal(sym)
                    quotes  = store.get_symbol_quotes(sym, days=30)
                    prompt  = ra.build_prompt(sym, report["title"], wyckoff, quotes)
                    log.info("report %s/%s: analyzing '%s' (%d KB)",
                             sym, prov, report["title"], len(report["pdf_bytes"]) // 1024)
                    analyze = ra.analyze_with_claude if prov == "claude" else ra.analyze_with_gemini
                    text, model = analyze(report["pdf_bytes"], prompt)
                    store.upsert_report_analysis(sym, year, quarter, report["title"],
                                                 report["url"], model, text,
                                                 provider=prov)
                    log.info("report %s/%s: analysis stored (%d chars)", sym, prov, len(text))
                with report_lock:
                    report_jobs[key] = {"status": "done"}
            except ra.ReportError as e:
                log.error("report %s/%s: %s", sym, prov, e)
                with report_lock:
                    report_jobs[key] = {"status": "error", "error": str(e)}
            except Exception as e:
                log.exception("report %s/%s: unexpected failure", sym, prov)
                with report_lock:
                    report_jobs[key] = {"status": "error", "error": f"Lỗi không mong đợi: {e}"}

        threading.Thread(target=run, daemon=True).start()
        return {"message": f"Report analysis started for {sym} ({prov})",
                "symbol": sym, "provider": prov}

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

    # ── Wyckoff-Optimized: regime, backtest, live signal ──────────────────────
    # NOTE: these literal /api/backtest/* routes MUST be registered before the
    # /api/backtest/{symbol} catch-all below, or FastAPI matches "runs",
    # "params", "progress", "run" as a {symbol} (first-registered wins).

    @app.get("/api/regime/latest")
    def regime_latest():
        store.ensure_wyckoff_opt_tables()
        return store.get_regime() or {"regime": "SIDEWAYS", "note": "no regime computed yet"}

    @app.get("/api/regime/history")
    def regime_history(days: int = 365):
        store.ensure_wyckoff_opt_tables()
        return store.get_regime_history(days)

    @app.get("/api/backtest/runs")
    def backtest_runs(limit: int = 20):
        store.ensure_wyckoff_opt_tables()
        return store.get_backtest_runs(limit)

    @app.get("/api/backtest/trades/{run_id}")
    def backtest_trades(run_id: int):
        store.ensure_wyckoff_opt_tables()
        return store.get_backtest_trades(run_id)

    @app.get("/api/backtest/params")
    def backtest_params():
        store.ensure_wyckoff_opt_tables()
        return store.get_optimized_params()

    @app.get("/api/methods")
    def list_methods():
        """Registry of optimization methods that have stored best-params, plus
        which one is currently deployed live (drives Buy Now + VN100 BT)."""
        store.ensure_wyckoff_opt_tables()
        return {"active": store.get_active_method(),
                "methods": store.get_method_params()}

    @app.post("/api/methods/deploy")
    def deploy_method(method: str):
        """Make a registered method the live set: copy its params into
        optimized_params and mark it active."""
        store.ensure_wyckoff_opt_tables()
        try:
            store.deploy_method_params(method)
        except ValueError as e:
            raise HTTPException(404, str(e))
        return {"active": store.get_active_method(), "method": method}

    @app.get("/api/backtest/progress")
    def backtest_progress():
        """Live backtest progress: {active, phase, overall_pct, eta_sec, …}.

        Prefers the in-process tracker (when the backtest was started via
        POST /api/backtest/run, it runs in this same process); falls back to the
        on-disk file when a backtest was launched out-of-process (`make backtest`)."""
        import progress
        live = progress.get()
        snap = live.snapshot() if live.active else progress.read()
        snap["running"] = state.snapshot().get("running", False)
        return snap

    @app.post("/api/backtest/run", status_code=202)
    def trigger_backtest(capital: float = 1_000_000_000, regime: str = "ALL", samples: int = 200):
        """Kick off a full walk-forward backtest in the background. Poll
        /api/backtest/runs for completion."""
        if not state.acquire(str(date.today()), ["backtest"]):
            raise HTTPException(409, "A crawl/backtest is already running")

        def run():
            try:
                import opt_backtest
                store.ensure_wyckoff_opt_tables()
                opt_backtest.run_full_backtest(store, capital=capital,
                                               n_random_samples=samples)
            except Exception as e:
                log.error("backtest run failed: %s", e)
            finally:
                state.release()

        threading.Thread(target=run, daemon=True).start()
        return {"status": "started", "message": "Backtest running in background",
                "capital": capital, "samples": samples}

    @app.get("/api/wyckoff-opt/{symbol}")
    def wyckoff_opt_signal(symbol: str):
        """Live optimized signal for a symbol using the current regime's params."""
        import dataclasses

        import wyckoff_opt
        store.ensure_wyckoff_opt_tables()
        sym = symbol.strip().upper()
        reg_row = store.get_regime()
        regime = reg_row["regime"] if reg_row else None
        params = store.get_optimized_params(regime) if regime else dict(wyckoff_opt.DEFAULT_PARAMS)
        bars = store.get_symbol_quotes(sym, days=400)
        if not bars:
            raise HTTPException(404, f"No quote data for {sym}")
        index_bars = store.get_symbol_quotes("VNINDEX", days=400)
        sig = wyckoff_opt.run_live_signal(sym, bars, index_bars or None, params, regime)
        return dataclasses.asdict(sig)

    @app.get("/api/buy-now")
    def buy_now(universe: str = "vn100", max_gap: float = 5.0, rsi_max: float = 80.0):
        """Scan a universe with the CURRENT optimized model and split into three
        actionable buckets that mirror a real entry decision *right now*:

          - buyable:  would enter at the current price now — a fresh breakout (BUY),
                      or a Markup pullback still close to MA20 (gap ≤ ``max_gap`` %)
                      and not blown-off (RSI ≤ ``rsi_max``).
          - extended: passes the score gate but price has already run too far above
                      MA20 (gap > ``max_gap``) or is overbought — "wait for a dip".
                      Kept separate so it doesn't pollute the buyable list.
          - watch:    1-2 confirmations away (score in [min-2, min-1]).

        The split enforces the strategy's own "buy dips to MA20" rule, so the
        buyable list shows only names whose price is at a level we'd actually
        enter today — not every stock that merely happens to be in an uptrend.

        ``universe``: "vn100" (default) scans the VN100; "all" scans every symbol
        that has quote data (indices excluded).
        """
        import wyckoff_opt
        store.ensure_wyckoff_opt_tables()
        reg_row = store.get_regime()
        regime = reg_row["regime"] if reg_row else None
        params = store.get_optimized_params(regime) if regime else dict(wyckoff_opt.DEFAULT_PARAMS)
        min_score = int(params.get("min_signal_score", 4))

        # Pseudo-symbols (indices) that live in daily_quotes but aren't tradable.
        _INDICES = {"VNINDEX", "VN30", "VN100", "HNXINDEX", "HNX30",
                    "UPCOMINDEX", "VNXALL", "VNALL", "VN30F1M", "VN30F2M"}
        if universe.lower() == "all":
            symbols = [s for s in store.get_symbols_with_quotes() if s not in _INDICES]
        else:
            symbols = store.get_vn100_symbols()
        meta = store.get_symbols_meta(symbols)
        index_bars = store.get_symbol_quotes("VNINDEX", days=400) or None

        buyable, extended, watch = [], [], []
        for sym in symbols:
            bars = store.get_symbol_quotes(sym, days=400)
            if not bars:
                continue
            try:
                s = wyckoff_opt.run_live_signal(sym, bars, index_bars, params, regime)
            except Exception:  # noqa: BLE001
                continue
            if s.signal not in ("BUY", "HOLD") or s.score < min_score - 2:
                continue
            m = meta.get(sym, {})
            entry = s.entry_price or s.current_price
            gap = ((s.current_price - entry) / entry * 100) if (entry and s.current_price) else None
            rr = ((s.resistance - entry) / (entry - s.stop_loss)
                  if s.resistance and s.stop_loss and entry and entry > s.stop_loss else None)
            row = {
                "symbol": sym, "name": m.get("name"), "exchange": m.get("exchange"),
                "signal": s.signal, "score": s.score, "phase": s.phase, "sub_phase": s.sub_phase,
                "current_price": s.current_price, "entry_price": entry, "stop_loss": s.stop_loss,
                "resistance": s.resistance, "rsi": s.rsi, "rs": s.rs, "atr": s.atr,
                "gap_pct": round(gap, 2) if gap is not None else None,
                "rr": round(rr, 1) if rr is not None else None,
                "description": s.description,
            }
            if s.score < min_score:
                watch.append(row)
                continue
            # Score-qualified → is the price still at a level we'd enter today?
            near_entry = (s.signal == "BUY") or (gap is not None and gap <= max_gap)
            not_blown  = (s.rsi is None) or (s.rsi <= rsi_max)
            reasons = []
            if gap is not None and gap > max_gap:
                reasons.append(f"gap +{gap:.1f}% > {max_gap:g}% (đã chạy xa MA20)")
            if s.rsi is not None and s.rsi > rsi_max:
                reasons.append(f"RSI {s.rsi:.0f} > {rsi_max:g} (quá mua)")
            if near_entry and not_blown:
                buyable.append(row)
            else:
                row["skip_reasons"] = reasons
                extended.append(row)

        buyable.sort(key=lambda r: (r["score"], -(r["gap_pct"] or 0)), reverse=True)
        extended.sort(key=lambda r: (r["gap_pct"] if r["gap_pct"] is not None else 1e9))
        watch.sort(key=lambda r: r["score"], reverse=True)
        return {"regime": regime or "n/a", "min_score": min_score,
                "universe": universe.lower(), "scanned": len(symbols),
                "max_gap": max_gap, "rsi_max": rsi_max,
                "buyable": buyable, "extended": extended, "watch": watch}

    # ── Backtest (single-symbol Wyckoff walk-forward) ─────────────────────────

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

    # ── VN100 backtest with the CURRENT optimized Wyckoff model ───────────────

    @app.get("/api/vn100-model-backtest")
    def get_vn100_model_backtest():
        """Latest stored model backtest (trades + performance), or null."""
        return store.get_latest_portfolio_backtest()

    @app.post("/api/vn100-model-backtest", status_code=202)
    def run_vn100_model_backtest(start_date: str = "2018-01-01",
                                 capital: float = 1_000_000_000.0):
        """Replay the current per-regime optimized model over VN100 (background).
        First run builds the snapshot context (~10 min) then caches it; re-runs
        are fast. Poll GET /api/crawl/status, then GET this endpoint."""
        if not state.acquire(str(date.today()), ["vn100_model_backtest"]):
            raise HTTPException(409, "A crawl/backtest is already running")

        def run():
            try:
                crawler.run_vn100_model_backtest(start_date=start_date, capital=capital)
            except Exception as e:  # noqa: BLE001
                log.error("vn100 model backtest failed: %s", e)
            finally:
                state.release()

        threading.Thread(target=run, daemon=True).start()
        return {"message": "vn100 model backtest started", "start_date": start_date}

    # ── Derivatives (VN30F1M / VN30F2M / VN30 index) ──────────────────────────

    @app.get("/api/derivatives/quotes/{symbol}")
    def derivatives_quotes(symbol: str, days: int = 120):
        return store.get_derivatives_quotes(symbol.strip().upper(), days)

    @app.get("/api/derivatives/basis")
    def derivatives_basis(days: int = 90):
        return store.get_basis(days)

    @app.get("/api/derivatives/oi/{symbol}")
    def derivatives_oi(symbol: str, days: int = 90):
        return store.get_derivatives_oi(symbol.strip().upper(), days)

    @app.get("/api/derivatives/intraday/{symbol}")
    def derivatives_intraday(symbol: str, tf: str = "5", days: int = 10):
        """Live intraday candles (not stored). tf ∈ {1,5,15,30,1H}."""
        import client
        if tf not in client.ENTRADE_RESOLUTIONS or tf == "1D":
            raise HTTPException(400, f"tf must be one of {[k for k in client.ENTRADE_RESOLUTIONS if k != '1D']}")
        try:
            return client.fetch_derivatives_intraday(symbol.strip().upper(), tf, days)
        except Exception as e:
            log.error("intraday %s/%s failed: %s", symbol, tf, e)
            raise HTTPException(502, f"Failed to fetch intraday data: {e}")

    @app.get("/api/derivatives/summary")
    def derivatives_summary():
        """One-call payload for the Derivatives tab: latest VN30F1M quote, latest
        basis row, and the Wyckoff + Multi-factor signals for VN30F1M."""
        quote = store.get_derivatives_quotes("VN30F1M", days=1)
        basis = store.get_basis(days=1)
        return {
            "quote":       quote[0] if quote else None,
            "basis":       basis[0] if basis else None,
            "wyckoff":     store.get_wyckoff_signal("VN30F1M"),
            "multifactor": store.get_multifactor_signal("VN30F1M"),
        }

    @app.post("/api/derivatives/compute", status_code=202)
    def compute_derivatives():
        """Re-crawl VN30 derivatives and recompute basis + signals (background)."""
        if not state.acquire(str(date.today()), ["derivatives"]):
            raise HTTPException(409, "A crawl is already running")

        def run():
            try:
                crawler.crawl_derivatives(date.today())
            except Exception as e:
                log.error("derivatives compute failed: %s", e)
            finally:
                state.release()

        threading.Thread(target=run, daemon=True).start()
        return {"message": "derivatives crawl started"}

    # ── Mutual funds (fmarket equity funds & holdings) ────────────────────────

    @app.get("/api/funds")
    def get_funds():
        """All equity funds with their current top stock holdings."""
        store.ensure_funds_tables()
        return store.get_funds_with_holdings()

    @app.post("/api/funds/refresh", status_code=202)
    def refresh_funds():
        """Re-crawl the equity-fund list and holdings from fmarket (background job)."""
        if not state.acquire(str(date.today()), ["funds"]):
            raise HTTPException(409, "A crawl is already running")

        def run():
            try:
                crawler.crawl_fund_holdings(date.today())
            except Exception as e:
                log.error("fund refresh failed: %s", e)
            finally:
                state.release()

        threading.Thread(target=run, daemon=True).start()
        return {"message": "fund refresh started"}

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
