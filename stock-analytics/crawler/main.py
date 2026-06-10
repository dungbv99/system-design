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

import wyckoff as wyckoff_engine

from api import CrawlState, start_server
from client import FireantClient
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

        log.info("wyckoff: analysing %d symbols", len(symbols))
        done = errors = 0

        def analyse_one(sym: str) -> tuple[str, str | None]:
            try:
                bars = self.store.get_symbol_quotes(sym, days=300)
                if not bars:
                    return sym, "no data"
                analysis = wyckoff_engine.analyze(sym, bars, lookback=260)
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

        # XGBoost predictions — train on history, score today's snapshot
        self.compute_predictions()

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
