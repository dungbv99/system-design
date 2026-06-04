"""PostgreSQL persistence layer — all upserts so re-runs are idempotent."""

import logging
from contextlib import contextmanager
from datetime import date, datetime
from typing import Optional

import psycopg2
import psycopg2.extras
import psycopg2.pool

from client import DailyQuote, Fundamental, NewsPost, Symbol

log = logging.getLogger(__name__)


class Store:
    def __init__(self, dsn: str):
        # Pool size = WORKERS (10) + a few for the API thread + headroom.
        # Connections are checked out for the duration of one operation then
        # immediately returned, so 30 is more than enough.
        self._pool = psycopg2.pool.ThreadedConnectionPool(2, 30, dsn)

    def close(self):
        self._pool.closeall()

    @contextmanager
    def _cursor(self):
        """Transactional write cursor. Commits on success, rolls back on error.
        The connection is returned to the pool after every call."""
        conn = self._pool.getconn()
        try:
            conn.autocommit = False
            with conn.cursor() as cur:
                try:
                    yield cur
                    conn.commit()
                except Exception:
                    conn.rollback()
                    raise
        finally:
            self._pool.putconn(conn)

    @contextmanager
    def _read(self, factory=None):
        """Read-only cursor. No commit; connection returned to pool immediately."""
        conn = self._pool.getconn()
        try:
            kw = {"cursor_factory": factory} if factory else {}
            with conn.cursor(**kw) as cur:
                yield cur
        finally:
            self._pool.putconn(conn)

    # ── Symbols ───────────────────────────────────────────────────────────────

    def upsert_symbols(self, symbols: list[Symbol]) -> int:
        sql = """
            INSERT INTO symbols (symbol, name, exchange, industry)
            VALUES %s
            ON CONFLICT (symbol) DO UPDATE SET
                name       = EXCLUDED.name,
                exchange   = EXCLUDED.exchange,
                industry   = EXCLUDED.industry,
                updated_at = NOW()
        """
        rows = [(s.symbol, s.name, s.exchange, s.industry) for s in symbols if s.symbol]
        with self._cursor() as cur:
            psycopg2.extras.execute_values(cur, sql, rows)
        return len(rows)

    def get_all_symbols(self, exchanges: list[str] | None = None) -> list[str]:
        with self._read() as cur:
            if exchanges:
                cur.execute(
                    "SELECT symbol FROM symbols WHERE exchange = ANY(%s) ORDER BY symbol",
                    (exchanges,),
                )
            else:
                cur.execute("SELECT symbol FROM symbols ORDER BY symbol")
            return [r[0] for r in cur.fetchall()]

    def get_symbols_without_quotes(self, exchanges: list[str] | None = None) -> list[str]:
        """Return symbols that have no rows in daily_quotes yet."""
        with self._read() as cur:
            if exchanges:
                cur.execute(
                    """SELECT s.symbol FROM symbols s
                       WHERE s.exchange = ANY(%s)
                         AND NOT EXISTS (
                             SELECT 1 FROM daily_quotes q WHERE q.symbol = s.symbol
                         )
                       ORDER BY s.symbol""",
                    (exchanges,),
                )
            else:
                cur.execute(
                    """SELECT s.symbol FROM symbols s
                       WHERE NOT EXISTS (
                           SELECT 1 FROM daily_quotes q WHERE q.symbol = s.symbol
                       )
                       ORDER BY s.symbol"""
                )
            return [r[0] for r in cur.fetchall()]

    # ── Daily quotes ──────────────────────────────────────────────────────────

    def upsert_quotes(self, symbol: str, quotes: list[DailyQuote]) -> int:
        sql = """
            INSERT INTO daily_quotes (symbol, date, open, high, low, close, volume, value)
            VALUES %s
            ON CONFLICT (symbol, date) DO UPDATE SET
                open   = EXCLUDED.open,
                high   = EXCLUDED.high,
                low    = EXCLUDED.low,
                close  = EXCLUDED.close,
                volume = EXCLUDED.volume,
                value  = EXCLUDED.value
        """
        rows = []
        for q in quotes:
            d = _parse_date(q.date)
            if d and (q.open or q.close):
                rows.append((symbol, d, q.open, q.high, q.low, q.close, q.volume, q.value))
        if not rows:
            return 0
        with self._cursor() as cur:
            psycopg2.extras.execute_values(cur, sql, rows)
        return len(rows)

    # ── Foreign trading ───────────────────────────────────────────────────────

    def upsert_foreign(self, symbol: str, quotes: list[DailyQuote]) -> int:
        sql = """
            INSERT INTO foreign_trading (symbol, date, buy_vol, sell_vol, buy_val, sell_val)
            VALUES %s
            ON CONFLICT (symbol, date) DO UPDATE SET
                buy_vol  = EXCLUDED.buy_vol,
                sell_vol = EXCLUDED.sell_vol,
                buy_val  = EXCLUDED.buy_val,
                sell_val = EXCLUDED.sell_val
        """
        rows = []
        for q in quotes:
            d = _parse_date(q.date)
            if d and (q.buy_foreign_vol or q.sell_foreign_vol):
                rows.append((symbol, d,
                              q.buy_foreign_vol, q.sell_foreign_vol,
                              q.buy_foreign_val, q.sell_foreign_val))
        if not rows:
            return 0
        with self._cursor() as cur:
            psycopg2.extras.execute_values(cur, sql, rows)
        return len(rows)

    # ── Fundamentals ──────────────────────────────────────────────────────────

    def upsert_fundamentals(self, symbol: str, items: list[Fundamental]) -> int:
        sql = """
            INSERT INTO fundamentals
                (symbol, year, quarter, revenue, net_profit, eps, pe, pb, roe, roa, fetched_at)
            VALUES %s
            ON CONFLICT (symbol, year, quarter) DO UPDATE SET
                revenue    = EXCLUDED.revenue,
                net_profit = EXCLUDED.net_profit,
                eps        = EXCLUDED.eps,
                pe         = EXCLUDED.pe,
                pb         = EXCLUDED.pb,
                roe        = EXCLUDED.roe,
                roa        = EXCLUDED.roa,
                fetched_at = NOW()
        """
        rows = [
            (symbol, f.year, f.quarter,
             f.revenue, f.net_profit, f.eps, f.pe, f.pb, f.roe, f.roa,
             datetime.utcnow())
            for f in items if f.year
        ]
        if not rows:
            return 0
        with self._cursor() as cur:
            psycopg2.extras.execute_values(cur, sql, rows)
        return len(rows)

    # ── News ──────────────────────────────────────────────────────────────────

    def upsert_news(self, posts: list[NewsPost]) -> int:
        sql = """
            INSERT INTO news (symbol, title, content, source, url, published_at)
            VALUES %s
            ON CONFLICT (symbol, title, published_at) DO NOTHING
        """
        rows = []
        for p in posts:
            if not p.title:
                continue
            pub = _parse_datetime(p.published_at)
            sym = p.symbol or None
            rows.append((sym, p.title, p.content, p.source, p.url, pub))
        if not rows:
            return 0
        with self._cursor() as cur:
            psycopg2.extras.execute_values(cur, sql, rows)
        return len(rows)

    # ── Crawl audit log ───────────────────────────────────────────────────────

    def start_run(self, job: str, run_date: date) -> int:
        with self._cursor() as cur:
            cur.execute(
                "INSERT INTO crawl_runs (job, run_date) VALUES (%s, %s) RETURNING id",
                (job, run_date),
            )
            return cur.fetchone()[0]

    def finish_run(self, run_id: int, records: int, error: Optional[str] = None):
        status = "error" if error else "done"
        with self._cursor() as cur:
            cur.execute(
                """UPDATE crawl_runs
                   SET finished_at = NOW(), status = %s, records = %s, error = %s
                   WHERE id = %s""",
                (status, records, error, run_id),
            )

    def get_symbols_with_prices(
        self,
        q: str = "",
        limit: int = 50,
        offset: int = 0,
        exchange: str = "",
        symbols: list[str] | None = None,
    ) -> dict:
        search = f"%{q}%" if q else "%"
        exc_filter = exchange.upper() if exchange else None

        conditions = ["(s.symbol ILIKE %s OR s.name ILIKE %s)"]
        params_where: list = [search, search]
        if exc_filter:
            conditions.append("s.exchange = %s")
            params_where.append(exc_filter)
        if symbols:
            conditions.append("s.symbol = ANY(%s)")
            params_where.append(symbols)

        base_where = " AND ".join(conditions)

        with self._read(factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(f"SELECT COUNT(*) FROM symbols s WHERE {base_where}", params_where)
            total = cur.fetchone()["count"]

            cur.execute(
                f"""
                SELECT
                    s.symbol, s.name, s.exchange,
                    q.date        AS latest_date,
                    q.close       AS close,
                    q.volume      AS volume,
                    prev.close    AS prev_close,
                    CASE WHEN prev.close > 0
                         THEN ROUND(((q.close - prev.close) / prev.close * 100)::numeric, 2)
                         ELSE NULL END AS change_pct
                FROM symbols s
                LEFT JOIN LATERAL (
                    SELECT date, close, volume
                    FROM daily_quotes
                    WHERE symbol = s.symbol
                    ORDER BY date DESC LIMIT 1
                ) q ON true
                LEFT JOIN LATERAL (
                    SELECT close
                    FROM daily_quotes
                    WHERE symbol = s.symbol
                    ORDER BY date DESC LIMIT 1 OFFSET 1
                ) prev ON true
                WHERE {base_where}
                ORDER BY q.volume DESC NULLS LAST, s.symbol
                LIMIT %s OFFSET %s
                """,
                [*params_where, limit, offset],
            )
            rows = cur.fetchall()

        return {"total": total, "items": [dict(r) for r in rows]}

    def get_symbol_quotes(self, symbol: str, days: int = 9999) -> list[dict]:
        with self._read(factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT date, open, high, low, close, volume
                FROM daily_quotes
                WHERE symbol = %s
                ORDER BY date DESC
                LIMIT %s
                """,
                (symbol.upper(), days),
            )
            rows = cur.fetchall()
        return [dict(r) for r in reversed(rows)]

    def get_latest_quote_date(self) -> Optional[date]:
        with self._read() as cur:
            cur.execute("SELECT MAX(date) FROM daily_quotes")
            row = cur.fetchone()
        return row[0] if row and row[0] else None

    def get_crawl_runs(self, limit: int = 30) -> list[dict]:
        with self._read(factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """SELECT id, job, run_date, started_at, finished_at, status, records, error
                   FROM crawl_runs
                   ORDER BY started_at DESC
                   LIMIT %s""",
                (limit,),
            )
            rows = cur.fetchall()
        return [dict(r) for r in rows]

    def get_stats(self) -> dict:
        with self._read() as cur:
            cur.execute("SELECT COUNT(*) FROM symbols")
            total_symbols = cur.fetchone()[0]

            cur.execute("SELECT COUNT(*) FROM daily_quotes")
            total_quotes = cur.fetchone()[0]

            cur.execute("SELECT MAX(date) FROM daily_quotes")
            latest_date = cur.fetchone()[0]

            cur.execute(
                """SELECT job, run_date, status, records, finished_at
                   FROM crawl_runs
                   ORDER BY started_at DESC LIMIT 1"""
            )
            row = cur.fetchone()
            last_run = None
            if row:
                last_run = {
                    "job": row[0],
                    "run_date": str(row[1]) if row[1] else None,
                    "status": row[2],
                    "records": row[3],
                    "finished_at": row[4].isoformat() if row[4] else None,
                }

        return {
            "total_symbols": total_symbols,
            "total_quotes":  total_quotes,
            "latest_date":   str(latest_date) if latest_date else None,
            "last_run":      last_run,
        }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _parse_date(s: str) -> Optional[date]:
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        log.debug("Cannot parse date: %r", s)
        return None


def _parse_datetime(s: str) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return _parse_date(s) and datetime.combine(_parse_date(s), datetime.min.time())
