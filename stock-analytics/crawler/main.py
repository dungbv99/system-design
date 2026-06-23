"""
Stock Analytics Crawler
-----------------------
Runs once per day after market close and fetches:
  • All listed symbols (refresh)
  • Daily OHLCV for every symbol
  • Quarterly fundamentals (only on the 1st of each month)

Uses vnstock (no authentication required — public data source).

Schedule: daily at CRAWL_HOUR:CRAWL_MINUTE UTC (default 08:00 = 15:00 ICT,
          i.e. ~30 min after Vietnam market close at 14:30 ICT).

Environment variables:
  DB_DSN        PostgreSQL DSN (default: postgresql://postgres:postgres@postgres:5432/stock)
  CRAWL_HOUR    UTC hour to run daily crawl (default: 8)
  CRAWL_MINUTE  UTC minute (default: 0)
  RATE_LIMIT_MS Milliseconds between per-symbol API calls (default: 200)
  WORKERS       Number of parallel symbol fetches (default: 5)
  RUN_NOW       Set to "1" to trigger an immediate crawl on startup
"""

import logging
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone

import derivatives as derivatives_engine
import multi_factor as multifactor_engine
import wyckoff as wyckoff_engine

from api import CrawlState, start_server
from client import FireantClient, fetch_derivatives_oi, fetch_derivatives_quotes
from store import Store

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

DB_DSN       = os.environ.get("DB_DSN", "postgresql://postgres:postgres@postgres:5432/stock")
CRAWL_HOUR   = int(os.environ.get("CRAWL_HOUR",   "8"))
CRAWL_MINUTE = int(os.environ.get("CRAWL_MINUTE", "0"))
RATE_MS      = int(os.environ.get("RATE_LIMIT_MS", "200"))
WORKERS      = int(os.environ.get("WORKERS", "5"))
RUN_NOW      = os.environ.get("RUN_NOW", "0") == "1"
API_PORT     = int(os.environ.get("API_PORT", "8090"))

# VN100 constituents (VN30 + VN Midcap). HOSE rebalances quarterly; this is a
# representative static list used for the portfolio backtest basket.
VN100 = [
    # VN30
    "ACB", "BID", "BSR", "CTG", "FPT", "GAS", "GVR", "HDB", "HPG", "LPB",
    "MBB", "MSN", "MWG", "PLX", "SAB", "SHB", "SSB", "SSI", "STB", "TCB",
    "TPB", "VCB", "VHM", "VIB", "VIC", "VJC", "VNM", "VPB", "VPL", "VRE",
    # VN Midcap
    "ANV", "BAF", "BCM", "BMP", "BSI", "BVH", "BWE", "CII", "CMG", "CTD",
    "CTR", "CTS", "DBC", "DCM", "DGW", "DIG", "DPM", "DSE", "DXG", "DXS",
    "EIB", "EVF", "FRT", "FTS", "GEE", "GEX", "GMD", "HAG", "HCM", "HDC",
    "HDG", "HHV", "HSG", "HT1", "IMP", "KBC", "KDC", "KDH", "KOS", "MSB",
    "NAB", "NKG", "NLG", "NT2", "NVL", "OCB", "PAN", "PC1", "PDR", "PHR",
    "PNJ", "POW", "PVD", "PVT", "REE", "SBT", "SCS", "SIP", "SJS", "SZC",
    "TCH", "VCG", "VCI", "VGC", "VHC", "VIX", "VND", "VPI", "VSC", "VTP",
]


# ── Crawl jobs ────────────────────────────────────────────────────────────────

class Crawler:
    def __init__(self, client: FireantClient, store: Store):
        self.client = client
        self.store  = store

    # ── 1. Symbols ────────────────────────────────────────────────────────────

    def crawl_symbols(self, run_date: date):
        run_id = self.store.start_run("symbols", run_date)
        try:
            symbols = self.client.get_symbols()
            if not symbols:
                raise RuntimeError("No symbols returned — check token or API endpoint")
            count = self.store.upsert_symbols(symbols)
            log.info("symbols: upserted %d rows", count)
            self.store.finish_run(run_id, count)
        except Exception as e:
            log.error("crawl_symbols failed: %s", e)
            self.store.finish_run(run_id, 0, str(e))
            raise

    # ── 2. Daily quotes (single day) ─────────────────────────────────────────

    def crawl_market_data(self, run_date: date):
        """Fetch OHLCV for every symbol for a single trading day."""
        self._crawl_quotes_range(run_date, run_date, job_label="quotes")

    # ── 3. Historical backfill ────────────────────────────────────────────────

    # Earliest possible date for Vietnamese stocks (HOSE opened 2000-07-28)
    HISTORY_START = date(2000, 1, 1)

    def crawl_history(self, run_date: date, years: int = 0):
        """Fetch full price history for every symbol.

        years=0  → all time (from 2000-01-01)
        years=N  → last N years
        """
        if years > 0:
            start = date(run_date.year - years, run_date.month, run_date.day)
        else:
            start = self.HISTORY_START
        self._crawl_quotes_range(start, run_date, job_label="history")

    CRAWL_EXCHANGES = ["HOSE", "HNX", "UPCOM"]

    def _crawl_quotes_range(
        self,
        start: date,
        end: date,
        job_label: str = "quotes",
        symbols: list[str] | None = None,
    ):
        if symbols is None:
            symbols = self.store.get_all_symbols(exchanges=self.CRAWL_EXCHANGES)
        if not symbols:
            log.warning("No symbols in DB — run crawl_symbols first")
            return

        run_id  = self.store.start_run(job_label, end)
        total   = 0
        errors  = 0

        def fetch_one(sym: str) -> tuple[str, int, str | None]:
            try:
                quotes = self.client.get_historical_quotes(sym, start, end)
                n = self.store.upsert_quotes(sym, quotes)
                time.sleep(RATE_MS / 1000)
                return sym, n, None
            except Exception as e:
                return sym, 0, str(e)

        log.info("%s: fetching %d symbols from %s to %s", job_label, len(symbols), start, end)
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futures = {pool.submit(fetch_one, s): s for s in symbols}
            done = 0
            for fut in as_completed(futures):
                sym, n, err = fut.result()
                done += 1
                if err:
                    errors += 1
                    log.warning("[%d/%d] %s: %s", done, len(symbols), sym, err)
                else:
                    total += n
                if done % 100 == 0:
                    log.info("[%d/%d] rows=%d errors=%d", done, len(symbols), total, errors)

        log.info("%s done: %d rows (%d errors)", job_label, total, errors)
        self.store.finish_run(run_id, total)

    # ── 3b. Auto-backfill history for newly discovered symbols ────────────────

    def crawl_missing_history(self, run_date: date):
        """Fetch full price history for any symbol that has no quote data yet.

        Called automatically after crawl_symbols so that newly listed tickers
        get their history populated without any manual intervention.
        """
        symbols = self.store.get_symbols_without_quotes()
        if not symbols:
            log.info("crawl_missing_history: all symbols already have data")
            return
        log.info("crawl_missing_history: backfilling %d symbols with no history", len(symbols))
        self._crawl_quotes_range(
            self.HISTORY_START, run_date,
            job_label="history:new",
            symbols=symbols,
        )

    # ── 3. News ───────────────────────────────────────────────────────────────

    def crawl_news(self, run_date: date):
        symbols = self.store.get_all_symbols(exchanges=self.CRAWL_EXCHANGES)
        run_id  = self.store.start_run("news", run_date)
        total   = 0

        def fetch_news(sym: str) -> tuple[int, str | None]:
            try:
                posts = self.client.get_news(symbol=sym, limit=5)
                n = self.store.upsert_news(posts)
                time.sleep(RATE_MS / 1000)
                return n, None
            except Exception as e:
                return 0, str(e)

        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futures = {pool.submit(fetch_news, s): s for s in symbols}
            for fut in as_completed(futures):
                n, err = fut.result()
                if err:
                    log.debug("news %s: %s", futures[fut], err)
                total += n

        log.info("news done: %d rows", total)
        self.store.finish_run(run_id, total)

    # ── 4. Fundamentals (monthly) ─────────────────────────────────────────────

    def crawl_fundamentals(self, run_date: date):
        symbols = self.store.get_all_symbols(exchanges=self.CRAWL_EXCHANGES)
        run_id  = self.store.start_run("fundamentals", run_date)
        total   = 0
        errors  = 0

        def fetch_fund(sym: str) -> tuple[int, str | None]:
            try:
                items = self.client.get_fundamentals(sym)
                n = self.store.upsert_fundamentals(sym, items)
                time.sleep(RATE_MS / 1000)
                return n, None
            except Exception as e:
                return 0, str(e)

        log.info("fundamentals: fetching %d symbols…", len(symbols))
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futures = {pool.submit(fetch_fund, s): s for s in symbols}
            done = 0
            for fut in as_completed(futures):
                n, err = fut.result()
                done += 1
                if err:
                    errors += 1
                    log.debug("fundamentals %s: %s", futures[fut], err)
                else:
                    total += n
                if done % 100 == 0:
                    log.info("[%d/%d] fundamental rows=%d", done, len(symbols), total)

        log.info("fundamentals done: %d rows (%d errors)", total, errors)
        self.store.finish_run(run_id, total)

    # ── Incremental update (last crawled date → today) ───────────────────────

    def crawl_update(self, today: date):
        """Re-fetch OHLCV for all symbols up to today and upsert.

        Always runs — ON CONFLICT (symbol, date) DO UPDATE means existing rows
        are overwritten with fresh data, so this is safe to call multiple times
        per day (e.g. to pick up final closing prices after an intraday fetch).
        Goes back one extra day to catch any late API corrections.
        """
        last  = self.store.get_latest_quote_date()
        start = (last - timedelta(days=1)) if last else self.HISTORY_START
        log.info("crawl_update: %s → %s", start, today)
        # Use all symbols that already have price data — the exchange field is
        # empty for most symbols returned by Vietcap, so an exchange filter
        # would silently skip ~1700 major stocks (VCB, HPG, ACB, etc.).
        symbols = self.store.get_symbols_with_quotes()
        self._crawl_quotes_range(start, today, job_label="update", symbols=symbols)

    # ── Per-symbol on-demand crawl ────────────────────────────────────────────

    def crawl_symbol(self, symbol: str, run_date: date) -> dict:
        """Fetch all available data for one symbol: history + fundamentals.

        Returns a dict with job → row count (or error string).
        """
        sym = symbol.strip().upper()
        log.info("crawl_symbol start: %s", sym)
        results: dict = {}

        # Price history (full, from 2000)
        run_id = self.store.start_run(f"history:{sym}", run_date)
        try:
            quotes = self.client.get_historical_quotes(sym, self.HISTORY_START, run_date)
            n = self.store.upsert_quotes(sym, quotes)
            self.store.finish_run(run_id, n)
            results["history"] = n
            log.info("crawl_symbol %s history: %d rows", sym, n)
        except Exception as e:
            self.store.finish_run(run_id, 0, str(e))
            results["history"] = f"error: {e}"
            log.error("crawl_symbol %s history: %s", sym, e)

        # Fundamentals
        run_id = self.store.start_run(f"fundamentals:{sym}", run_date)
        try:
            items = self.client.get_fundamentals(sym)
            n = self.store.upsert_fundamentals(sym, items)
            self.store.finish_run(run_id, n)
            results["fundamentals"] = n
            log.info("crawl_symbol %s fundamentals: %d rows", sym, n)
        except Exception as e:
            self.store.finish_run(run_id, 0, str(e))
            results["fundamentals"] = f"error: {e}"
            log.error("crawl_symbol %s fundamentals: %s", sym, e)

        log.info("crawl_symbol done: %s → %s", sym, results)
        return results

    # ── XGBoost prediction ────────────────────────────────────────────────────

    def compute_predictions(
        self,
        symbols: list[str] | None = None,
        exchanges: list[str] | None = None,
    ):
        """Train XGBoost on all OHLCV history and persist today's predictions.

        Reads only from the DB (no external API calls).
        exchanges — defaults to HOSE + HNX if not specified.
        """
        if symbols is None:
            exch = exchanges or ["HOSE", "HNX"]
            symbols = self.store.get_all_symbols(exchanges=exch)
        if not symbols:
            log.warning("compute_predictions: no symbols found")
            return

        import predict as predict_engine
        predictor = predict_engine.Predictor(self.store)
        n = predictor.run(symbols)
        log.info("compute_predictions: stored %d predictions", n)

    # ── Wyckoff analysis ──────────────────────────────────────────────────────

    def compute_wyckoff(
        self,
        symbols: list[str] | None = None,
        exchanges: list[str] | None = None,
    ):
        """Run Wyckoff phase detection for every symbol and persist results.

        Reads the last 300 daily bars per symbol from the DB (no external API
        calls) and upserts one row per symbol into wyckoff_signals.

        symbols   — explicit list to analyse; overrides exchanges.
        exchanges — if given, only analyse symbols on those exchanges.
                    If omitted, analyses EVERY symbol that has quote data
                    (all boards — HOSE, HNX, UPCOM, OTC, unclassified).
        """
        if symbols is None:
            if exchanges:
                symbols = self.store.get_all_symbols(exchanges=exchanges)
            else:
                # "all symbols" = every symbol that actually has bars in
                # daily_quotes, regardless of exchange classification.
                symbols = self.store.get_symbols_with_quotes()
        if not symbols:
            log.warning("compute_wyckoff: no symbols found")
            return

        # Load the optimized params for the current market regime ONCE — every
        # symbol this run is scored with the same regime-specific param set, so
        # wyckoff_signals reflects the optimized model (README §9). Falls back to
        # DEFAULT_PARAMS when no backtest has stored params yet.
        import wyckoff_opt
        reg_row    = self.store.get_regime()
        regime     = reg_row["regime"] if reg_row else None
        # get_optimized_params(None) returns an all-regimes mapping, not a flat
        # param dict — guard with DEFAULT_PARAMS when no regime is known.
        params     = self.store.get_optimized_params(regime) if regime else dict(wyckoff_opt.DEFAULT_PARAMS)
        lookback   = int(params.get("lookback", 260))
        index_bars = self.store.get_symbol_quotes("VNINDEX", days=400) or None
        self.store.ensure_wyckoff_signal_columns()   # add `score` column if missing

        log.info("wyckoff: analysing %d symbols with optimized params (regime=%s)",
                 len(symbols), regime or "n/a")
        done = errors = 0

        def analyse_one(sym: str) -> tuple[str, str | None]:
            try:
                bars = self.store.get_symbol_quotes(sym, days=400)
                if not bars:
                    return sym, "no data"
                # Full descriptive record from the base engine, computed once …
                analysis = wyckoff_engine.analyze(sym, bars, lookback=lookback)
                # … then reused to overlay the optimized BUY/WAIT decision +
                # entry/stop so the stored signal matches the backtested model.
                opt = wyckoff_opt.run_live_signal(sym, bars, index_bars, params,
                                                  regime, base=analysis)
                analysis.signal      = opt.signal
                analysis.entry_price = opt.entry_price
                analysis.stop_loss   = opt.stop_loss
                analysis.resistance  = opt.resistance   # guarded target (None if no level above entry)
                analysis.target      = opt.resistance
                analysis.score       = opt.score   # optimized confirmation score (0-8)
                if (analysis.target is not None and analysis.entry_price
                        and analysis.stop_loss is not None
                        and analysis.entry_price > analysis.stop_loss):
                    analysis.rr_ratio = round(
                        (analysis.target - analysis.entry_price)
                        / (analysis.entry_price - analysis.stop_loss), 2)
                self.store.upsert_wyckoff_signal(analysis)
                return sym, None
            except Exception as e:
                return sym, str(e)

        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futures = {pool.submit(analyse_one, s): s for s in symbols}
            for fut in as_completed(futures):
                sym, err = fut.result()
                done += 1
                if err:
                    errors += 1
                    log.debug("wyckoff %s: %s", sym, err)
                if done % 200 == 0:
                    log.info("wyckoff [%d/%d] errors=%d", done, len(symbols), errors)

        log.info("wyckoff done: %d symbols (%d errors)", done - errors, errors)

    # ── Multi-factor analysis ─────────────────────────────────────────────────

    def compute_multifactor(
        self,
        symbols: list[str] | None = None,
        exchanges: list[str] | None = None,
    ):
        """Run the multi-factor scoring engine for every symbol and persist results.

        Reads the last 300 daily bars per symbol from the DB (no external API
        calls) and upserts one row per symbol into multifactor_signals.

        symbols   — explicit list to analyse; overrides exchanges.
        exchanges — if given, only analyse symbols on those exchanges.
                    If omitted, analyses EVERY symbol that has quote data.
        """
        if symbols is None:
            if exchanges:
                symbols = self.store.get_all_symbols(exchanges=exchanges)
            else:
                symbols = self.store.get_symbols_with_quotes()
        if not symbols:
            log.warning("compute_multifactor: no symbols found")
            return

        log.info("multifactor: analysing %d symbols", len(symbols))
        done = errors = 0

        def analyse_one(sym: str) -> tuple[str, str | None]:
            try:
                bars = self.store.get_symbol_quotes(sym, days=300)
                if not bars:
                    return sym, "no data"
                analysis = multifactor_engine.analyze(sym, bars)
                self.store.upsert_multifactor_signal(analysis)
                return sym, None
            except Exception as e:
                return sym, str(e)

        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futures = {pool.submit(analyse_one, s): s for s in symbols}
            for fut in as_completed(futures):
                sym, err = fut.result()
                done += 1
                if err:
                    errors += 1
                    log.debug("multifactor %s: %s", sym, err)
                if done % 200 == 0:
                    log.info("multifactor [%d/%d] errors=%d", done, len(symbols), errors)

        log.info("multifactor done: %d symbols (%d errors)", done - errors, errors)

    # ── Portfolio backtest (Wyckoff over a basket, e.g. VN100) ────────────────

    def run_portfolio_backtest(
        self,
        symbols:    list[str] | None = None,
        label:      str   = "VN100 Wyckoff 2018+",
        start_date: str   = "2018-01-01",
        capital:    float = 1_000_000_000.0,
        slots:      int   = 12,
        cost_pct:   float = 0.3,
        min_hold:   int   = 3,
        lot_size:   int   = 100,
    ) -> int:
        """Backtest the Wyckoff signal_replay strategy across `symbols` from
        `start_date`, simulate one shared cash account, and persist the result.

        Returns the stored backtest id.
        """
        import portfolio_backtest as pbt

        syms = symbols or VN100
        log.info("portfolio backtest '%s': %d symbols from %s", label, len(syms), start_date)

        # Load bars for every symbol (parallel DB reads).
        symbol_bars: dict[str, list[dict]] = {}

        def load(sym: str) -> tuple[str, list[dict]]:
            return sym, self.store.get_symbol_quotes(sym, days=9999)

        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            for fut in as_completed([pool.submit(load, s) for s in syms]):
                sym, bars = fut.result()
                if bars:
                    symbol_bars[sym] = bars

        result = pbt.run_portfolio_backtest(
            symbol_bars, start_date=start_date, capital=capital,
            slots=slots, cost_pct=cost_pct, min_hold=min_hold, lot_size=lot_size,
        )
        bid = self.store.save_portfolio_backtest(label, result)
        s = result["summary"]
        log.info(
            "portfolio backtest done #%d: %d trades, total %.1f%%, CAGR %.1f%%, maxDD %.1f%%",
            bid, s["executed_trades"], s["total_return_pct"], s["cagr_pct"], s["max_drawdown_pct"],
        )
        return bid

    # ── Derivatives (VN30F1M / VN30F2M / VN30 index) ──────────────────────────

    DERIV_SYMBOLS = ("VN30F1M", "VN30F2M", "VN30")

    def crawl_derivatives(self, run_date: date) -> int:
        """Crawl VN30 futures + index, compute basis/spread, and run the existing
        Wyckoff + Multi-factor engines on VN30F1M.

        Reuses the KBS provider for OHLCV; OI is optional and skipped gracefully.
        """
        run_id = self.store.start_run("derivatives", run_date)
        try:
            start = run_date - timedelta(days=2400)   # ~6.5y — Entrade serves from 2020
            total = 0

            # 1. Full-history OHLCV for F1M, F2M and the VN30 spot index (Entrade).
            for symbol in self.DERIV_SYMBOLS:
                quotes = fetch_derivatives_quotes(symbol, start, run_date)
                total += self.store.upsert_derivatives_quotes(symbol, quotes)
                log.info("derivatives %s: %d rows", symbol, len(quotes))

            # 2. Open Interest for the live front-month contract (KBS).
            for symbol in ("VN30F1M", "VN30F2M"):
                oi_rows = fetch_derivatives_oi(symbol, run_date - timedelta(days=300), run_date)
                if oi_rows:
                    self.store.upsert_derivatives_oi(symbol, oi_rows)

            # 3. Basis & spread over the full overlapping history.
            f1m  = self.store.get_derivatives_quotes("VN30F1M", days=9999)
            f2m  = self.store.get_derivatives_quotes("VN30F2M", days=9999)
            vn30 = self.store.get_derivatives_quotes("VN30", days=9999)
            basis_rows = derivatives_engine.compute_basis(f1m, f2m, vn30)
            self.store.upsert_basis(basis_rows)
            log.info("derivatives: %d basis rows", len(basis_rows))

            # 4. Wyckoff + Multi-factor on VN30F1M (reuses the stock engines).
            bars = self.store.get_derivatives_quotes("VN30F1M", days=300)
            if len(bars) >= 30:
                self.store.upsert_wyckoff_signal(
                    wyckoff_engine.analyze("VN30F1M", bars, lookback=260))
                self.store.upsert_multifactor_signal(
                    multifactor_engine.analyze("VN30F1M", bars))
            else:
                log.warning("derivatives: only %d VN30F1M bars — skipping signals", len(bars))

            self.store.finish_run(run_id, total)
            return total
        except Exception as e:
            log.error("crawl_derivatives failed: %s", e)
            self.store.finish_run(run_id, 0, str(e))
            raise

    # ── Market index OHLCV (VNINDEX) — Entrade ────────────────────────────────

    INDEX_SYMBOLS = ("VNINDEX",)

    def crawl_market_index(self, run_date: date, symbols: tuple[str, ...] | None = None,
                           start_date: date | None = None) -> int:
        """Crawl market-index OHLCV (VNINDEX) into `daily_quotes`.

        Stored like any symbol so the Wyckoff/regime engines can read it via
        `get_symbol_quotes`. Primary source is SSI iboard (full history from
        index inception — VNINDEX from 2000-07-28); falls back to Entrade
        (~2020+) if SSI fails. A placeholder row is upserted into `symbols`
        first to satisfy the daily_quotes FK.
        """
        from client import Symbol, fetch_index_history
        syms = symbols or self.INDEX_SYMBOLS
        start = start_date or date(2000, 1, 1)
        run_id = self.store.start_run("market_index", run_date)
        total = 0
        try:
            for sym in syms:
                self.store.upsert_symbols([Symbol(symbol=sym, name=sym, exchange="INDEX")])
                try:
                    quotes = fetch_index_history(sym, start, run_date)
                    src = "SSI"
                except Exception as e:  # noqa: BLE001
                    log.warning("market index %s: SSI failed (%s), falling back to Entrade", sym, e)
                    quotes = fetch_derivatives_quotes(sym, run_date - timedelta(days=2600), run_date)
                    src = "Entrade"
                n = self.store.upsert_quotes(sym, quotes)
                total += n
                log.info("market index %s via %s: %d rows (%s → %s)", sym, src, n,
                         quotes[0].date if quotes else "-",
                         quotes[-1].date if quotes else "-")
            self.store.finish_run(run_id, total)
            return total
        except Exception as e:
            log.error("crawl_market_index failed: %s", e)
            self.store.finish_run(run_id, 0, str(e))
            raise

    # ── Mutual fund holdings (fmarket) ────────────────────────────────────────

    def crawl_fund_holdings(self, run_date: date) -> int:
        """Refresh the equity-fund list and every fund's top stock holdings.

        Replaces the funds/fund_holdings tables wholesale so de-listed funds
        and stocks a fund no longer holds disappear.
        """
        run_id = self.store.start_run("funds", run_date)
        try:
            self.store.ensure_funds_tables()
            funds = self.client.get_stock_funds()
            if not funds:
                log.warning("fund crawl: fmarket returned no equity funds")
                self.store.finish_run(run_id, 0)
                return 0

            holdings_by_fund: dict[int, list] = {}

            def load(f):
                try:
                    return f.fund_id, self.client.get_fund_holdings(f.fund_id)
                except Exception as e:
                    log.warning("fund holdings %s (%d) failed: %s", f.short_name, f.fund_id, e)
                    return f.fund_id, []

            with ThreadPoolExecutor(max_workers=WORKERS) as pool:
                for fut in as_completed([pool.submit(load, f) for f in funds]):
                    fid, hs = fut.result()
                    holdings_by_fund[fid] = hs

            nf, nh = self.store.replace_funds(funds, holdings_by_fund)
            self.store.finish_run(run_id, nf)
            log.info("fund crawl done: %d funds, %d holdings", nf, nh)
            return nf
        except Exception as e:
            self.store.finish_run(run_id, 0, str(e))
            log.error("fund crawl failed: %s", e)
            raise

    # ── Full daily run ────────────────────────────────────────────────────────

    def run_daily(self, run_date: date):
        log.info("═══ daily crawl starting for %s ═══", run_date)
        t0 = time.monotonic()

        # Always refresh symbol list first
        self.crawl_symbols(run_date)

        # Auto-backfill history for any symbol that has no data yet
        self.crawl_missing_history(run_date)

        # Market data (OHLCV) for the target date
        self.crawl_market_data(run_date)

        # Latest news for every symbol
        self.crawl_news(run_date)

        # Fundamentals only on the 1st of each month (heavy — ~1100 API calls)
        if run_date.day == 1:
            log.info("1st of month — crawling fundamentals")
            self.crawl_fundamentals(run_date)

        # Wyckoff phase analysis — pure in-memory, no external calls
        self.compute_wyckoff()

        # Multi-factor scoring — pure in-memory, no external calls
        self.compute_multifactor()

        # XGBoost predictions — train on history, score today's snapshot
        self.compute_predictions()

        # Mutual-fund holdings (fmarket) — best-effort, must not break the run
        try:
            self.crawl_fund_holdings(run_date)
        except Exception as e:
            log.error("fund holdings crawl failed (continuing): %s", e)

        # Derivatives (VN30F1M/F2M/VN30) — best-effort, must not break the run
        try:
            self.crawl_derivatives(run_date)
        except Exception as e:
            log.error("derivatives crawl failed (continuing): %s", e)

        # Wyckoff-Optimized: detect today's VNIndex regime + live VN100 scan
        try:
            run_live_wyckoff_opt(self.store)
        except Exception as e:
            log.error("wyckoff-opt live run failed (continuing): %s", e)

        elapsed = time.monotonic() - t0
        log.info("═══ daily crawl complete in %.1fs ═══", elapsed)


# ── Scheduler ─────────────────────────────────────────────────────────────────

def next_run_time(hour: int, minute: int) -> datetime:
    """Return the next UTC datetime at the given hour:minute."""
    now  = datetime.now(timezone.utc)
    next = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if next <= now:
        next += timedelta(days=1)
    return next


def previous_trading_day() -> date:
    """Return yesterday, skipping weekends (Sat/Sun → Friday)."""
    d = date.today() - timedelta(days=1)
    while d.weekday() >= 5:  # 5=Sat, 6=Sun
        d -= timedelta(days=1)
    return d


# ── Wyckoff-Optimized daily live run ──────────────────────────────────────────

def run_live_wyckoff_opt(store: Store) -> dict:
    """Daily job — detect today's VNIndex regime and scan VN100 with the
    optimized, regime-specific params.  Reads only from the DB (no API calls).

    Persists the regime to ``regime_history`` and returns a summary dict of the
    BUY candidates (also available live per-symbol via GET /api/wyckoff-opt/{sym}).
    See README_WYCKOFF_OPTIMIZED.md §14.
    """
    import regime as regime_mod
    import wyckoff_opt

    store.ensure_wyckoff_opt_tables()

    # 1. Detect today's regime from VNIndex.
    vnindex_bars = store.get_symbol_quotes("VNINDEX", days=400)
    if not vnindex_bars:
        log.warning("wyckoff-opt: no VNINDEX data — run crawl_market_index first")
        return {"regime": None, "buys": []}
    reg = regime_mod.detect_regime_today(vnindex_bars)
    today = str(reg.date or date.today())
    store.upsert_regime(today, {
        "regime": reg.regime, "vnindex": reg.vnindex_close,
        "ma20": reg.ma20, "ma50": reg.ma50, "ma200": reg.ma200,
        "macd_hist": reg.macd_hist, "drawdown": reg.drawdown_from_60d_high,
        "wyckoff_phase": reg.wyckoff_phase,
    })
    log.info("wyckoff-opt: regime=%s (confirmed=%s, drawdown=%.1f%%)",
             reg.regime, reg.confirmed, (reg.drawdown_from_60d_high or 0) * 100)

    # 2. Load optimized params for the current regime (DEFAULT if none yet).
    params = store.get_optimized_params(reg.regime)

    # 3. Scan VN100 for BUY signals.
    symbols = store.get_vn100_symbols()
    buys: list[dict] = []
    for sym in symbols:
        bars = store.get_symbol_quotes(sym, days=400)
        if not bars or len(bars) < 60:
            continue
        try:
            sig = wyckoff_opt.run_live_signal(sym, bars, vnindex_bars, params, reg.regime)
        except Exception as e:  # noqa: BLE001
            log.debug("wyckoff-opt %s: %s", sym, e)
            continue
        if sig.signal == "BUY":
            buys.append({"symbol": sym, "score": sig.score, "phase": sig.phase,
                         "sub_phase": sig.sub_phase, "entry": sig.entry_price,
                         "stop": sig.stop_loss, "rsi": sig.rsi})

    buys.sort(key=lambda b: b["score"], reverse=True)
    log.info("wyckoff-opt: %d BUY candidates in %s regime: %s",
             len(buys), reg.regime, ", ".join(b["symbol"] for b in buys[:10]))
    return {"regime": reg.regime, "buys": buys}


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    log.info("connecting to database…")
    store   = Store(DB_DSN)
    store.cleanup_stale_runs()      # mark any jobs left running by a prior crash
    client  = FireantClient()       # no token needed — uses vnstock public data
    crawler = Crawler(client, store)
    state   = CrawlState()

    start_server(crawler, store, state, port=API_PORT)

    if RUN_NOW:
        target = previous_trading_day()
        log.info("RUN_NOW=1 — running immediately for %s", target)
        crawler.run_daily(target)

    log.info("scheduler started — will crawl daily at %02d:%02d UTC", CRAWL_HOUR, CRAWL_MINUTE)
    while True:
        nxt = next_run_time(CRAWL_HOUR, CRAWL_MINUTE)
        sleep_secs = (nxt - datetime.now(timezone.utc)).total_seconds()
        log.info("next crawl at %s (%.0fs from now)", nxt.isoformat(), sleep_secs)
        time.sleep(sleep_secs)

        target = previous_trading_day()
        try:
            crawler.run_daily(target)
        except Exception as e:
            log.error("daily crawl failed: %s", e)


if __name__ == "__main__":
    main()
