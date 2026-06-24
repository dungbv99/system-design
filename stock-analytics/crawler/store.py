"""PostgreSQL persistence layer — all upserts so re-runs are idempotent."""

import logging
from contextlib import contextmanager
from datetime import date, datetime
from typing import Optional

import psycopg2
import psycopg2.extras
import psycopg2.pool
from psycopg2.extras import Json

from client import DailyQuote, FundHolding, FundInfo, Fundamental, NewsPost, Symbol

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

    def get_symbols_with_quotes(self) -> list[str]:
        """Return all symbols that have at least one row in daily_quotes."""
        with self._read() as cur:
            cur.execute("SELECT DISTINCT symbol FROM daily_quotes ORDER BY symbol")
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
        by_date: dict = {}
        for q in quotes:
            d = _parse_date(q.date)
            if d and (q.open or q.close):
                by_date[d] = (symbol, d, q.open, q.high, q.low, q.close, q.volume, q.value)
        rows = list(by_date.values())
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

    def cleanup_stale_runs(self) -> int:
        """Mark any runs still in 'running' state as error (interrupted by restart)."""
        with self._cursor() as cur:
            cur.execute(
                """UPDATE crawl_runs
                   SET status = 'error', finished_at = NOW(),
                       error = 'interrupted: process restarted'
                   WHERE status = 'running'
                   RETURNING id"""
            )
            rows = cur.fetchall()
        count = len(rows)
        if count:
            log.info("startup: cleaned %d stale running jobs", count)
        return count

    def get_symbols_with_prices(
        self,
        q: str = "",
        limit: int = 50,
        offset: int = 0,
        exchange: str = "",
        symbols: list[str] | None = None,
    ) -> dict:
        search = f"%{q}%" if q else "%"
        exc_list = [e.strip().upper() for e in exchange.split(",") if e.strip()] if exchange else []

        conditions = ["(s.symbol ILIKE %s OR s.name ILIKE %s)"]
        params_where: list = [search, search]
        if len(exc_list) == 1:
            conditions.append("s.exchange = %s")
            params_where.append(exc_list[0])
        elif exc_list:
            conditions.append("s.exchange = ANY(%s)")
            params_where.append(exc_list)
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
                SELECT date, open, high, low, close, volume, value
                FROM daily_quotes
                WHERE symbol = %s
                ORDER BY date DESC
                LIMIT %s
                """,
                (symbol.upper(), days),
            )
            rows = cur.fetchall()
        return [dict(r) for r in reversed(rows)]

    def get_symbol_foreign(self, symbol: str, days: int = 9999) -> list[dict]:
        with self._read(factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT date, buy_vol, sell_vol, net_vol
                FROM foreign_trading
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

    # ── Predictions ──────────────────────────────────────────────────────────

    def upsert_predictions(self, predictions: list) -> int:
        sql = """
            INSERT INTO predictions (symbol, predicted_at, horizon_days, score, signal, model_date)
            VALUES %s
            ON CONFLICT (symbol, predicted_at, horizon_days) DO UPDATE SET
                score      = EXCLUDED.score,
                signal     = EXCLUDED.signal,
                model_date = EXCLUDED.model_date
        """
        rows = [
            (p.symbol, p.predicted_at, p.horizon_days, p.score, p.signal, p.model_date)
            for p in predictions
        ]
        if not rows:
            return 0
        with self._cursor() as cur:
            psycopg2.extras.execute_values(cur, sql, rows)
        return len(rows)

    def get_symbol_prediction(self, symbol: str, horizon: int = 5) -> Optional[dict]:
        with self._read(factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """SELECT * FROM predictions
                   WHERE symbol = %s AND horizon_days = %s
                   ORDER BY predicted_at DESC LIMIT 1""",
                (symbol.upper(), horizon),
            )
            row = cur.fetchone()
        return dict(row) if row else None

    def get_predictions(
        self,
        signal: str = "",
        horizon: int = 5,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        sig_cond  = "AND signal = %s" if signal else ""
        sig_param: list = [signal.upper()] if signal else []

        with self._read(factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                f"""
                SELECT COUNT(*) FROM (
                    SELECT DISTINCT ON (symbol) symbol
                    FROM predictions
                    WHERE horizon_days = %s {sig_cond}
                    ORDER BY symbol, predicted_at DESC
                ) t
                """,
                [horizon, *sig_param],
            )
            total = cur.fetchone()["count"]

            cur.execute(
                f"""
                SELECT l.*, s.name, s.exchange, s.industry,
                       q.close AS current_price
                FROM (
                    SELECT DISTINCT ON (symbol) *
                    FROM predictions
                    WHERE horizon_days = %s {sig_cond}
                    ORDER BY symbol, predicted_at DESC
                ) l
                JOIN symbols s ON s.symbol = l.symbol
                LEFT JOIN LATERAL (
                    SELECT close FROM daily_quotes
                    WHERE symbol = l.symbol ORDER BY date DESC LIMIT 1
                ) q ON true
                ORDER BY l.score DESC
                LIMIT %s OFFSET %s
                """,
                [horizon, *sig_param, limit, offset],
            )
            rows = cur.fetchall()
        return {"total": total, "items": [dict(r) for r in rows]}

    # ── Wyckoff signals ───────────────────────────────────────────────────────

    def ensure_wyckoff_signal_columns(self) -> None:
        """Idempotent — add columns introduced after the initial schema."""
        with self._cursor() as cur:
            cur.execute("ALTER TABLE wyckoff_signals ADD COLUMN IF NOT EXISTS score INT")

    def upsert_wyckoff_signal(self, analysis) -> None:
        sql = """
            INSERT INTO wyckoff_signals
                (symbol, analyzed_at, phase, sub_phase, signal, signal_strength,
                 support, resistance, current_price, last_event,
                 entry_price, stop_loss, target, rr_ratio, description, bars_analyzed, score)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (symbol) DO UPDATE SET
                analyzed_at     = EXCLUDED.analyzed_at,
                phase           = EXCLUDED.phase,
                sub_phase       = EXCLUDED.sub_phase,
                signal          = EXCLUDED.signal,
                signal_strength = EXCLUDED.signal_strength,
                support         = EXCLUDED.support,
                resistance      = EXCLUDED.resistance,
                current_price   = EXCLUDED.current_price,
                last_event      = EXCLUDED.last_event,
                entry_price     = EXCLUDED.entry_price,
                stop_loss       = EXCLUDED.stop_loss,
                target          = EXCLUDED.target,
                rr_ratio        = EXCLUDED.rr_ratio,
                description     = EXCLUDED.description,
                bars_analyzed   = EXCLUDED.bars_analyzed,
                score           = EXCLUDED.score,
                updated_at      = NOW()
        """
        with self._cursor() as cur:
            cur.execute(sql, (
                analysis.symbol, analysis.analyzed_at,
                analysis.phase, analysis.sub_phase,
                analysis.signal, analysis.signal_strength,
                analysis.support, analysis.resistance,
                analysis.current_price, analysis.last_event,
                analysis.entry_price, analysis.stop_loss,
                analysis.target, analysis.rr_ratio,
                analysis.description, analysis.bars_analyzed,
                getattr(analysis, "score", None),
            ))

    def get_wyckoff_signal(self, symbol: str) -> Optional[dict]:
        with self._read(factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM wyckoff_signals WHERE symbol = %s",
                (symbol.upper(),),
            )
            row = cur.fetchone()
        return dict(row) if row else None

    def get_wyckoff_signals(
        self,
        signal: str = "",
        phase: str = "",
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        conditions: list[str] = []
        params: list = []
        if signal:
            conditions.append("w.signal = %s")
            params.append(signal.upper())
        if phase:
            conditions.append("w.phase ILIKE %s")
            params.append(f"%{phase}%")
        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

        with self._read(factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(f"SELECT COUNT(*) FROM wyckoff_signals w {where}", params)
            total = cur.fetchone()["count"]
            cur.execute(
                f"""
                SELECT w.*, s.name, s.exchange, s.industry
                FROM wyckoff_signals w
                JOIN symbols s ON s.symbol = w.symbol
                {where}
                ORDER BY
                    CASE w.signal
                        WHEN 'BUY'   THEN 1
                        WHEN 'SHORT' THEN 2
                        WHEN 'HOLD'  THEN 3
                        ELSE 4
                    END,
                    CASE w.signal_strength
                        WHEN 'STRONG'   THEN 1
                        WHEN 'MODERATE' THEN 2
                        ELSE 3
                    END,
                    w.updated_at DESC
                LIMIT %s OFFSET %s
                """,
                [*params, limit, offset],
            )
            rows = cur.fetchall()
        return {"total": total, "items": [dict(r) for r in rows]}

    # ── Multi-factor signals ──────────────────────────────────────────────────

    def upsert_multifactor_signal(self, analysis) -> None:
        sql = """
            INSERT INTO multifactor_signals
                (symbol, analyzed_at, total_score, signal, confidence, factors_agreed,
                 trend_score, momentum_score, volume_score, position_score,
                 trend_reason, momentum_reason, volume_reason, position_reason,
                 current_price, support, resistance, entry_price, stop_loss,
                 description, bars_analyzed)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (symbol) DO UPDATE SET
                analyzed_at     = EXCLUDED.analyzed_at,
                total_score     = EXCLUDED.total_score,
                signal          = EXCLUDED.signal,
                confidence      = EXCLUDED.confidence,
                factors_agreed  = EXCLUDED.factors_agreed,
                trend_score     = EXCLUDED.trend_score,
                momentum_score  = EXCLUDED.momentum_score,
                volume_score    = EXCLUDED.volume_score,
                position_score  = EXCLUDED.position_score,
                trend_reason    = EXCLUDED.trend_reason,
                momentum_reason = EXCLUDED.momentum_reason,
                volume_reason   = EXCLUDED.volume_reason,
                position_reason = EXCLUDED.position_reason,
                current_price   = EXCLUDED.current_price,
                support         = EXCLUDED.support,
                resistance      = EXCLUDED.resistance,
                entry_price     = EXCLUDED.entry_price,
                stop_loss       = EXCLUDED.stop_loss,
                description     = EXCLUDED.description,
                bars_analyzed   = EXCLUDED.bars_analyzed,
                updated_at      = NOW()
        """
        with self._cursor() as cur:
            cur.execute(sql, (
                analysis.symbol, analysis.analyzed_at,
                analysis.total_score, analysis.signal,
                analysis.confidence, analysis.factors_agreed,
                analysis.trend_score, analysis.momentum_score,
                analysis.volume_score, analysis.position_score,
                analysis.trend_reason, analysis.momentum_reason,
                analysis.volume_reason, analysis.position_reason,
                analysis.current_price, analysis.support, analysis.resistance,
                analysis.entry_price, analysis.stop_loss,
                analysis.description, analysis.bars_analyzed,
            ))

    def get_multifactor_signal(self, symbol: str) -> Optional[dict]:
        with self._read(factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM multifactor_signals WHERE symbol = %s",
                (symbol.upper(),),
            )
            row = cur.fetchone()
        return dict(row) if row else None

    def get_multifactor_signals(
        self,
        signal: str = "",
        min_score: int = 0,
        confidence: str = "",
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        conditions: list[str] = []
        params: list = []
        if signal:
            conditions.append("m.signal = %s")
            params.append(signal.upper())
        if min_score:
            conditions.append("m.total_score >= %s")
            params.append(min_score)
        if confidence:
            conditions.append("m.confidence = %s")
            params.append(confidence.upper())
        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

        with self._read(factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(f"SELECT COUNT(*) FROM multifactor_signals m {where}", params)
            total = cur.fetchone()["count"]
            cur.execute(
                f"""
                SELECT m.*, s.name, s.exchange, s.industry
                FROM multifactor_signals m
                JOIN symbols s ON s.symbol = m.symbol
                {where}
                ORDER BY m.total_score DESC, m.updated_at DESC
                LIMIT %s OFFSET %s
                """,
                [*params, limit, offset],
            )
            rows = cur.fetchall()
        return {"total": total, "items": [dict(r) for r in rows]}

    # ── Derivatives (VN30F1M / VN30F2M / VN30 index) ──────────────────────────

    def ensure_derivatives_tables(self):
        """Idempotent — lets existing deployments pick up the tables (and the
        synthetic VN30F1M symbol row) without re-running init.sql."""
        sql = """
            CREATE TABLE IF NOT EXISTS derivatives_quotes (
                symbol   VARCHAR(20)  NOT NULL,
                date     DATE         NOT NULL,
                open     NUMERIC(12,2),
                high     NUMERIC(12,2),
                low      NUMERIC(12,2),
                close    NUMERIC(12,2),
                volume   BIGINT,
                PRIMARY KEY (symbol, date)
            );
            CREATE INDEX IF NOT EXISTS idx_deriv_quotes_date ON derivatives_quotes (date DESC);
            CREATE TABLE IF NOT EXISTS derivatives_oi (
                symbol        VARCHAR(20) NOT NULL,
                date          DATE        NOT NULL,
                open_interest BIGINT,
                oi_change     BIGINT,
                PRIMARY KEY (symbol, date)
            );
            CREATE TABLE IF NOT EXISTS derivatives_basis (
                date           DATE          PRIMARY KEY,
                f1m_close      NUMERIC(12,2),
                f2m_close      NUMERIC(12,2),
                vn30_close     NUMERIC(12,2),
                basis          NUMERIC(12,2),
                basis_pct      NUMERIC(8,4),
                spread_f1m_f2m NUMERIC(12,2),
                regime         VARCHAR(10),
                updated_at     TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_deriv_basis_date ON derivatives_basis (date DESC);
            INSERT INTO symbols (symbol, name, exchange, industry)
            VALUES ('VN30F1M', 'VN30 Index Futures (front month)', 'DERIV', 'Derivatives')
            ON CONFLICT (symbol) DO NOTHING;
        """
        with self._cursor() as cur:
            cur.execute(sql)

    def upsert_derivatives_quotes(self, symbol: str, quotes: list[DailyQuote]) -> int:
        sql = """
            INSERT INTO derivatives_quotes (symbol, date, open, high, low, close, volume)
            VALUES %s
            ON CONFLICT (symbol, date) DO UPDATE SET
                open   = EXCLUDED.open,
                high   = EXCLUDED.high,
                low    = EXCLUDED.low,
                close  = EXCLUDED.close,
                volume = EXCLUDED.volume
        """
        by_date: dict = {}
        for q in quotes:
            d = _parse_date(q.date)
            if d and (q.open or q.close):
                by_date[d] = (symbol, d, q.open, q.high, q.low, q.close, q.volume)
        rows = list(by_date.values())
        if not rows:
            return 0
        with self._cursor() as cur:
            psycopg2.extras.execute_values(cur, sql, rows)
        return len(rows)

    def get_derivatives_quotes(self, symbol: str, days: int = 300) -> list[dict]:
        with self._read(factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT date, open, high, low, close, volume
                FROM derivatives_quotes
                WHERE symbol = %s
                ORDER BY date DESC
                LIMIT %s
                """,
                (symbol.upper(), days),
            )
            rows = cur.fetchall()
        return [dict(r) for r in reversed(rows)]

    def upsert_derivatives_oi(self, symbol: str, oi_rows: list[dict]) -> int:
        sql = """
            INSERT INTO derivatives_oi (symbol, date, open_interest, oi_change)
            VALUES %s
            ON CONFLICT (symbol, date) DO UPDATE SET
                open_interest = EXCLUDED.open_interest,
                oi_change     = EXCLUDED.oi_change
        """
        rows = []
        for r in oi_rows:
            d = _parse_date(str(r.get("date", "")))
            if d:
                rows.append((symbol, d, r.get("open_interest"), r.get("oi_change")))
        if not rows:
            return 0
        with self._cursor() as cur:
            psycopg2.extras.execute_values(cur, sql, rows)
        return len(rows)

    def get_derivatives_oi(self, symbol: str, days: int = 300) -> list[dict]:
        with self._read(factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT date, open_interest, oi_change
                FROM derivatives_oi
                WHERE symbol = %s
                ORDER BY date DESC
                LIMIT %s
                """,
                (symbol.upper(), days),
            )
            rows = cur.fetchall()
        return [dict(r) for r in reversed(rows)]

    def upsert_basis(self, rows: list[dict]) -> int:
        sql = """
            INSERT INTO derivatives_basis
                (date, f1m_close, f2m_close, vn30_close, basis, basis_pct,
                 spread_f1m_f2m, regime)
            VALUES %s
            ON CONFLICT (date) DO UPDATE SET
                f1m_close      = EXCLUDED.f1m_close,
                f2m_close      = EXCLUDED.f2m_close,
                vn30_close     = EXCLUDED.vn30_close,
                basis          = EXCLUDED.basis,
                basis_pct      = EXCLUDED.basis_pct,
                spread_f1m_f2m = EXCLUDED.spread_f1m_f2m,
                regime         = EXCLUDED.regime,
                updated_at     = NOW()
        """
        out = []
        for r in rows:
            d = _parse_date(str(r.get("date", "")))
            if d:
                out.append((d, r.get("f1m_close"), r.get("f2m_close"), r.get("vn30_close"),
                            r.get("basis"), r.get("basis_pct"),
                            r.get("spread_f1m_f2m"), r.get("regime")))
        if not out:
            return 0
        with self._cursor() as cur:
            psycopg2.extras.execute_values(cur, sql, out)
        return len(out)

    def get_basis(self, days: int = 90) -> list[dict]:
        with self._read(factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT date, f1m_close, f2m_close, vn30_close, basis, basis_pct,
                       spread_f1m_f2m, regime
                FROM derivatives_basis
                ORDER BY date DESC
                LIMIT %s
                """,
                (days,),
            )
            rows = cur.fetchall()
        return [dict(r) for r in reversed(rows)]

    # ── Portfolio backtests ───────────────────────────────────────────────────

    def save_portfolio_backtest(self, label: str, result: dict) -> int:
        sql = """
            INSERT INTO portfolio_backtests (label, params, summary, equity_curve, yearly, trades)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id
        """
        with self._cursor() as cur:
            cur.execute(sql, (
                label,
                Json(result.get("params", {})),
                Json(result.get("summary", {})),
                Json(result.get("equity_curve", [])),
                Json(result.get("yearly", [])),
                Json(result.get("trades", [])),
            ))
            return cur.fetchone()[0]

    def get_latest_portfolio_backtest(self) -> Optional[dict]:
        with self._read(factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM portfolio_backtests ORDER BY created_at DESC LIMIT 1"
            )
            row = cur.fetchone()
        if not row:
            return None
        d = dict(row)
        d["created_at"] = d["created_at"].isoformat() if d["created_at"] else None
        return d

    # ── Wyckoff-Optimized: regime, backtests, optimized params ────────────────

    def ensure_wyckoff_opt_tables(self):
        """Idempotent — create regime/backtest/optimized-params tables and the
        symbols.is_vn100 flag so existing deployments pick them up without a
        fresh init.sql. Mirrors db/init.sql."""
        sql = """
            ALTER TABLE symbols ADD COLUMN IF NOT EXISTS is_vn100 BOOLEAN DEFAULT FALSE;

            CREATE TABLE IF NOT EXISTS regime_history (
                date          DATE         PRIMARY KEY,
                regime        VARCHAR(12)  NOT NULL,
                vnindex       NUMERIC(12,2),
                ma20          NUMERIC(12,2),
                ma50          NUMERIC(12,2),
                ma200         NUMERIC(12,2),
                macd_hist     NUMERIC(12,4),
                drawdown      NUMERIC(6,4),
                wyckoff_phase VARCHAR(20),
                updated_at    TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_regime_date ON regime_history (date DESC);

            CREATE TABLE IF NOT EXISTS backtest_runs (
                id            SERIAL PRIMARY KEY,
                run_at        TIMESTAMPTZ DEFAULT NOW(),
                capital       NUMERIC(18,2),
                train_start   DATE,
                train_end     DATE,
                test_start    DATE,
                test_end      DATE,
                params        JSONB,
                regime_scope  VARCHAR(12),
                annual_return NUMERIC(10,4),
                total_return  NUMERIC(10,4),
                sharpe_ratio  NUMERIC(8,3),
                max_drawdown  NUMERIC(6,4),
                win_rate      NUMERIC(6,4),
                total_trades  INTEGER,
                avg_hold_days NUMERIC(8,1),
                by_year       JSONB,
                indicator_ic  JSONB,
                notes         TEXT
            );

            CREATE TABLE IF NOT EXISTS backtest_trades (
                id              SERIAL PRIMARY KEY,
                run_id          INTEGER REFERENCES backtest_runs(id) ON DELETE CASCADE,
                symbol          VARCHAR(20),
                entry_date      DATE,
                entry_price     NUMERIC(14,2),
                exit_date       DATE,
                exit_price      NUMERIC(14,2),
                shares          INTEGER,
                pnl             NUMERIC(16,2),
                pnl_pct         NUMERIC(10,4),
                hold_days       INTEGER,
                exit_type       VARCHAR(20),
                regime_at_entry VARCHAR(12),
                wyckoff_phase   VARCHAR(30),
                sector          VARCHAR(80),
                ecosystem       VARCHAR(30)
            );
            CREATE INDEX IF NOT EXISTS idx_bt_trades_run    ON backtest_trades (run_id);
            CREATE INDEX IF NOT EXISTS idx_bt_trades_symbol ON backtest_trades (symbol);
            CREATE INDEX IF NOT EXISTS idx_bt_trades_exit   ON backtest_trades (exit_type);

            CREATE TABLE IF NOT EXISTS optimized_params (
                regime     VARCHAR(12) PRIMARY KEY,
                params     JSONB       NOT NULL,
                run_id     INTEGER REFERENCES backtest_runs(id),
                sharpe     NUMERIC(8,3),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );

            -- Best param set per optimization/backtest method ('8+4+7', '3a', …).
            -- Registry only: deploying a method copies its params into
            -- optimized_params (the single live/active set Buy Now + VN100 BT use).
            CREATE TABLE IF NOT EXISTS method_params (
                method     TEXT        PRIMARY KEY,
                params     JSONB       NOT NULL,
                metrics    JSONB,
                chosen_at  TIMESTAMPTZ DEFAULT NOW()
            );
        """
        with self._cursor() as cur:
            cur.execute(sql)

    def upsert_regime(self, day, regime_row: dict) -> None:
        sql = """
            INSERT INTO regime_history
                (date, regime, vnindex, ma20, ma50, ma200, macd_hist, drawdown, wyckoff_phase)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (date) DO UPDATE SET
                regime=EXCLUDED.regime, vnindex=EXCLUDED.vnindex,
                ma20=EXCLUDED.ma20, ma50=EXCLUDED.ma50, ma200=EXCLUDED.ma200,
                macd_hist=EXCLUDED.macd_hist, drawdown=EXCLUDED.drawdown,
                wyckoff_phase=EXCLUDED.wyckoff_phase, updated_at=NOW()
        """
        with self._cursor() as cur:
            cur.execute(sql, (
                day, regime_row.get("regime"), regime_row.get("vnindex"),
                regime_row.get("ma20"), regime_row.get("ma50"), regime_row.get("ma200"),
                regime_row.get("macd_hist"), regime_row.get("drawdown"),
                regime_row.get("wyckoff_phase"),
            ))

    def get_regime(self, day=None) -> Optional[dict]:
        with self._read(factory=psycopg2.extras.RealDictCursor) as cur:
            if day:
                cur.execute("SELECT * FROM regime_history WHERE date = %s", (day,))
            else:
                cur.execute("SELECT * FROM regime_history ORDER BY date DESC LIMIT 1")
            row = cur.fetchone()
        return dict(row) if row else None

    def get_regime_history(self, days: int = 365) -> list[dict]:
        with self._read(factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM regime_history ORDER BY date DESC LIMIT %s", (days,))
            rows = cur.fetchall()
        return [dict(r) for r in reversed(rows)]

    def get_vn100_symbols(self) -> list[str]:
        """Marked VN100 symbols; falls back to the static list (sector_rotation)
        when none are flagged yet, so the backtest runs out of the box."""
        with self._read() as cur:
            try:
                cur.execute("SELECT symbol FROM symbols WHERE is_vn100 = true ORDER BY symbol")
                rows = [r[0] for r in cur.fetchall()]
            except psycopg2.Error:
                rows = []
        if rows:
            return rows
        import sector_rotation
        return list(sector_rotation.VN100)

    def get_symbols_meta(self, symbols: list[str]) -> dict:
        """Map symbol → {name, exchange} for the given symbols (for UI rows)."""
        if not symbols:
            return {}
        with self._read() as cur:
            cur.execute(
                "SELECT symbol, name, exchange FROM symbols WHERE symbol = ANY(%s)",
                (list(symbols),),
            )
            return {r[0]: {"name": r[1], "exchange": r[2]} for r in cur.fetchall()}

    def mark_vn100(self, symbols: list[str]) -> int:
        with self._cursor() as cur:
            cur.execute("ALTER TABLE symbols ADD COLUMN IF NOT EXISTS is_vn100 BOOLEAN DEFAULT FALSE")
            cur.execute("UPDATE symbols SET is_vn100 = false")
            cur.execute("UPDATE symbols SET is_vn100 = true WHERE symbol = ANY(%s)", (symbols,))
            return cur.rowcount

    def get_all_symbols_with_sectors(self) -> dict:
        """{symbol: industry} for VN100 symbols (or all when none marked)."""
        with self._read() as cur:
            cur.execute(
                """SELECT symbol, COALESCE(industry, '') FROM symbols
                   WHERE is_vn100 = true OR is_vn100 IS NULL"""
            )
            rows = cur.fetchall()
        out = {r[0]: r[1] for r in rows if r[1]}
        if out:
            return out
        with self._read() as cur:
            cur.execute("SELECT symbol, COALESCE(industry, '') FROM symbols")
            return {r[0]: r[1] for r in cur.fetchall() if r[1]}

    def save_backtest_run(self, result: dict) -> int:
        sql = """
            INSERT INTO backtest_runs
                (capital, train_start, train_end, test_start, test_end, params,
                 regime_scope, annual_return, total_return, sharpe_ratio,
                 max_drawdown, win_rate, total_trades, avg_hold_days,
                 by_year, indicator_ic, notes)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING id
        """
        with self._cursor() as cur:
            cur.execute(sql, (
                result.get("capital"), result.get("train_start"), result.get("train_end"),
                result.get("test_start"), result.get("test_end"),
                Json(result.get("params", {})), result.get("regime_scope", "ALL"),
                result.get("annual_return"), result.get("total_return"),
                result.get("sharpe_ratio"), result.get("max_drawdown"),
                result.get("win_rate"), result.get("total_trades"),
                result.get("avg_hold_days"), Json(result.get("by_year", {})),
                Json(result.get("indicator_ic", {})), result.get("notes"),
            ))
            return cur.fetchone()[0]

    def save_backtest_trades(self, run_id: int, trades: list[dict]) -> int:
        sql = """
            INSERT INTO backtest_trades
                (run_id, symbol, entry_date, entry_price, exit_date, exit_price,
                 shares, pnl, pnl_pct, hold_days, exit_type, regime_at_entry,
                 wyckoff_phase, sector, ecosystem)
            VALUES %s
        """
        rows = [(
            run_id, t.get("symbol"), t.get("entry_date"), t.get("entry_price"),
            t.get("exit_date"), t.get("exit_price"), t.get("shares"), t.get("pnl"),
            t.get("pnl_pct"), t.get("hold_days"), t.get("exit_type"),
            t.get("regime_at_entry"), t.get("wyckoff_phase"), t.get("sector"),
            t.get("ecosystem"),
        ) for t in trades]
        if not rows:
            return 0
        with self._cursor() as cur:
            psycopg2.extras.execute_values(cur, sql, rows)
        return len(rows)

    def get_backtest_runs(self, limit: int = 20) -> list[dict]:
        with self._read(factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM backtest_runs ORDER BY run_at DESC LIMIT %s", (limit,))
            rows = cur.fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["run_at"] = d["run_at"].isoformat() if d.get("run_at") else None
            for k in ("train_start", "train_end", "test_start", "test_end"):
                if d.get(k):
                    d[k] = str(d[k])
            out.append(d)
        return out

    def get_backtest_trades(self, run_id: int) -> list[dict]:
        with self._read(factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM backtest_trades WHERE run_id = %s ORDER BY entry_date", (run_id,))
            rows = cur.fetchall()
        out = []
        for r in rows:
            d = dict(r)
            for k in ("entry_date", "exit_date"):
                if d.get(k):
                    d[k] = str(d[k])
            out.append(d)
        return out

    def save_optimized_params(self, regime: str, params: dict,
                              run_id: Optional[int] = None, sharpe: float = 0.0) -> None:
        sql = """
            INSERT INTO optimized_params (regime, params, run_id, sharpe)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (regime) DO UPDATE SET
                params=EXCLUDED.params, run_id=EXCLUDED.run_id,
                sharpe=EXCLUDED.sharpe, updated_at=NOW()
        """
        with self._cursor() as cur:
            cur.execute(sql, (regime, Json(params), run_id, sharpe))

    def save_optimized_params_all(self, per_regime: dict) -> None:
        """Bulk-save the per-regime optimizer output {regime: {params, sharpe, run_id}}."""
        for regime, info in per_regime.items():
            if isinstance(info, dict) and "params" in info:
                self.save_optimized_params(regime, info["params"],
                                           info.get("run_id"), info.get("sharpe", 0.0))
            else:  # info is a bare params dict
                self.save_optimized_params(regime, info)

    def get_optimized_params(self, regime: Optional[str] = None):
        """For a regime → its params dict (DEFAULT_PARAMS when unset).
        Without a regime → {regime: params} for every stored regime."""
        with self._read(factory=psycopg2.extras.RealDictCursor) as cur:
            if regime:
                cur.execute("SELECT params FROM optimized_params WHERE regime = %s", (regime,))
                row = cur.fetchone()
                if row:
                    return row["params"]
                # No DB row (e.g. fresh local deploy) → fall back to the committed
                # optimized params for this regime, overlaid on DEFAULT_PARAMS.
                import wyckoff_opt
                params = dict(wyckoff_opt.DEFAULT_PARAMS)
                params.update(wyckoff_opt.OPTIMIZED_PARAMS.get(regime, {}))
                return params
            cur.execute("SELECT regime, params, sharpe, updated_at FROM optimized_params")
            rows = cur.fetchall()
        out = {}
        for r in rows:
            out[r["regime"]] = {
                "params": r["params"], "sharpe": float(r["sharpe"]) if r["sharpe"] is not None else None,
                "updated_at": r["updated_at"].isoformat() if r.get("updated_at") else None,
            }
        if not out:   # DB empty → seed from the committed optimized params
            import wyckoff_opt
            base = dict(wyckoff_opt.DEFAULT_PARAMS)
            out = {reg: {"params": {**base, **tuned}, "sharpe": None, "updated_at": None}
                   for reg, tuned in wyckoff_opt.OPTIMIZED_PARAMS.items()}
        return out

    # ── Per-method best params (registry) ─────────────────────────────────────

    def save_method_params(self, method: str, params: dict,
                           metrics: Optional[dict] = None) -> None:
        """Upsert the best param set a method produced. One row per method."""
        sql = """
            INSERT INTO method_params (method, params, metrics, chosen_at)
            VALUES (%s, %s, %s, NOW())
            ON CONFLICT (method) DO UPDATE SET
                params=EXCLUDED.params, metrics=EXCLUDED.metrics, chosen_at=NOW()
        """
        with self._cursor() as cur:
            cur.execute(sql, (method, Json(params), Json(metrics or {})))

    def get_method_params(self, method: Optional[str] = None):
        """One method → its stored row (or None); no method → list of all rows
        (most recently chosen first)."""
        with self._read(factory=psycopg2.extras.RealDictCursor) as cur:
            if method:
                cur.execute("SELECT method, params, metrics, chosen_at "
                            "FROM method_params WHERE method = %s", (method,))
                row = cur.fetchone()
                if not row:
                    return None
                d = dict(row)
                d["chosen_at"] = d["chosen_at"].isoformat() if d["chosen_at"] else None
                return d
            cur.execute("SELECT method, params, metrics, chosen_at "
                        "FROM method_params ORDER BY chosen_at DESC")
            out = []
            for r in cur.fetchall():
                d = dict(r)
                d["chosen_at"] = d["chosen_at"].isoformat() if d["chosen_at"] else None
                out.append(d)
            return out

    def deploy_method_params(self, method: str) -> dict:
        """Make a stored method's params the live/active set: copy them into
        optimized_params (Buy Now + VN100 BT read those).

        Two shapes are supported:
          - global (one flat params dict)        → applied to all three regimes;
          - per-regime ({UPTREND:…, SIDEWAYS:…}) → each regime gets its own set.
        """
        mp = self.get_method_params(method)
        if not mp:
            raise ValueError(f"no stored params for method {method!r}")
        params = mp["params"]
        sharpe = (mp.get("metrics") or {}).get("sharpe") or 0.0
        regimes = ("UPTREND", "SIDEWAYS", "DOWNTREND")
        per_regime = isinstance(params, dict) and all(r in params for r in regimes)
        for regime in regimes:
            self.save_optimized_params(regime, params[regime] if per_regime else params,
                                       None, sharpe)
        return params

    def clean_backtest_runs(self) -> int:
        with self._cursor() as cur:
            cur.execute("DELETE FROM backtest_trades")
            cur.execute("DELETE FROM backtest_runs")
            return cur.rowcount

    # ── Mutual funds & holdings (fmarket) ─────────────────────────────────────

    def ensure_funds_tables(self):
        """Idempotent — lets existing deployments pick up the tables without a migration."""
        sql = """
            CREATE TABLE IF NOT EXISTS funds (
                fund_id          INTEGER      PRIMARY KEY,
                short_name       VARCHAR(40)  NOT NULL,
                name             TEXT         NOT NULL,
                owner_name       TEXT,
                fund_type        VARCHAR(60),
                nav              NUMERIC(16,2),
                nav_update_at    DATE,
                return_1m        NUMERIC(8,2),
                return_3m        NUMERIC(8,2),
                return_6m        NUMERIC(8,2),
                return_12m       NUMERIC(8,2),
                return_36m       NUMERIC(8,2),
                return_inception NUMERIC(8,2),
                updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS fund_holdings (
                id                BIGSERIAL    PRIMARY KEY,
                fund_id           INTEGER      NOT NULL REFERENCES funds(fund_id) ON DELETE CASCADE,
                stock_code        VARCHAR(20)  NOT NULL,
                industry          VARCHAR(120),
                net_asset_percent NUMERIC(8,2) NOT NULL DEFAULT 0,
                price             NUMERIC(16,2),
                update_at         DATE
            );
            CREATE INDEX IF NOT EXISTS idx_fund_holdings_fund  ON fund_holdings (fund_id);
            CREATE INDEX IF NOT EXISTS idx_fund_holdings_stock ON fund_holdings (stock_code);
        """
        with self._cursor() as cur:
            cur.execute(sql)

    def replace_funds(
        self,
        funds:            list[FundInfo],
        holdings_by_fund: dict[int, list[FundHolding]],
    ) -> tuple[int, int]:
        """Wholesale-replace funds + holdings in one transaction.

        Both tables are emptied then re-inserted, so any fund that left the
        equity-fund list — or any stock a fund no longer holds — disappears.
        Returns (fund_count, holding_count).
        """
        frows = [(
            f.fund_id, f.short_name, f.name, f.owner_name, f.fund_type, f.nav,
            f.nav_update_at, f.return_1m, f.return_3m, f.return_6m,
            f.return_12m, f.return_36m, f.return_inception,
        ) for f in funds]

        hrows = [
            (fid, h.stock_code, h.industry, h.net_asset_percent, h.price, h.update_at)
            for fid, hs in holdings_by_fund.items() for h in hs
        ]

        with self._cursor() as cur:
            # TRUNCATE both together so the FK ordering doesn't matter.
            cur.execute("TRUNCATE fund_holdings, funds RESTART IDENTITY CASCADE")
            if frows:
                psycopg2.extras.execute_values(cur, """
                    INSERT INTO funds (
                        fund_id, short_name, name, owner_name, fund_type, nav,
                        nav_update_at, return_1m, return_3m, return_6m,
                        return_12m, return_36m, return_inception)
                    VALUES %s
                """, frows)
            if hrows:
                psycopg2.extras.execute_values(cur, """
                    INSERT INTO fund_holdings (
                        fund_id, stock_code, industry, net_asset_percent, price, update_at)
                    VALUES %s
                """, hrows)
        return len(frows), len(hrows)

    def get_funds_with_holdings(self) -> dict:
        """All funds, each with its holdings array (joined to symbol names)."""
        with self._read(factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT *, EXTRACT(EPOCH FROM updated_at) AS updated_epoch
                FROM funds
                ORDER BY return_12m DESC NULLS LAST, short_name
            """)
            funds = [dict(r) for r in cur.fetchall()]

            cur.execute("""
                SELECT fh.fund_id, fh.stock_code, fh.industry,
                       fh.net_asset_percent, fh.price, fh.update_at,
                       s.name AS company_name, s.exchange
                FROM fund_holdings fh
                LEFT JOIN symbols s ON s.symbol = fh.stock_code
                ORDER BY fh.net_asset_percent DESC
            """)
            holdings = [dict(r) for r in cur.fetchall()]

        by_fund: dict[int, list[dict]] = {}
        for h in holdings:
            fid = h.pop("fund_id")
            h["update_at"] = h["update_at"].isoformat() if h.get("update_at") else None
            by_fund.setdefault(fid, []).append(h)

        updated_at = None
        for f in funds:
            f["holdings"]   = by_fund.get(f["fund_id"], [])
            f["nav_update_at"] = f["nav_update_at"].isoformat() if f.get("nav_update_at") else None
            ts = f.pop("updated_at", None)
            f.pop("updated_epoch", None)
            if ts and (updated_at is None or ts > updated_at):
                updated_at = ts

        return {
            "funds":      funds,
            "count":      len(funds),
            "updated_at": updated_at.isoformat() if updated_at else None,
        }

    # ── Quarterly report analyses ─────────────────────────────────────────────

    def ensure_report_analyses_table(self):
        """Idempotent — lets existing deployments pick up the table without a migration."""
        sql = """
            CREATE TABLE IF NOT EXISTS report_analyses (
                symbol     VARCHAR(50) NOT NULL,
                year       SMALLINT    NOT NULL,
                quarter    SMALLINT    NOT NULL,
                provider   VARCHAR(20) NOT NULL DEFAULT 'gemini',
                title      TEXT,
                pdf_url    TEXT,
                model      VARCHAR(80),
                analysis   TEXT,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                PRIMARY KEY (symbol, year, quarter, provider)
            )
        """
        migrate = """
            ALTER TABLE report_analyses
                ADD COLUMN IF NOT EXISTS provider VARCHAR(20) NOT NULL DEFAULT 'gemini';
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.key_column_usage
                    WHERE table_name = 'report_analyses'
                      AND constraint_name = 'report_analyses_pkey'
                      AND column_name = 'provider'
                ) THEN
                    ALTER TABLE report_analyses DROP CONSTRAINT report_analyses_pkey;
                    ALTER TABLE report_analyses
                        ADD PRIMARY KEY (symbol, year, quarter, provider);
                END IF;
            END $$;
        """
        with self._cursor() as cur:
            cur.execute(sql)
            cur.execute(migrate)

    def upsert_report_analysis(self, symbol: str, year: int, quarter: int,
                               title: str, pdf_url: str, model: str, analysis: str,
                               provider: str = "gemini"):
        sql = """
            INSERT INTO report_analyses (symbol, year, quarter, provider, title, pdf_url, model, analysis)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (symbol, year, quarter, provider) DO UPDATE SET
                title      = EXCLUDED.title,
                pdf_url    = EXCLUDED.pdf_url,
                model      = EXCLUDED.model,
                analysis   = EXCLUDED.analysis,
                created_at = NOW()
        """
        with self._cursor() as cur:
            cur.execute(sql, (symbol.upper(), year, quarter, provider,
                              title, pdf_url, model, analysis))

    def get_report_analysis(self, symbol: str, year: int, quarter: int,
                            provider: str = "gemini") -> Optional[dict]:
        with self._read(factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """SELECT * FROM report_analyses
                   WHERE symbol = %s AND year = %s AND quarter = %s AND provider = %s""",
                (symbol.upper(), year, quarter, provider),
            )
            row = cur.fetchone()
        return dict(row) if row else None

    def get_latest_report_analysis(self, symbol: str,
                                   provider: str = "gemini") -> Optional[dict]:
        with self._read(factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """SELECT * FROM report_analyses WHERE symbol = %s AND provider = %s
                   ORDER BY year DESC, quarter DESC LIMIT 1""",
                (symbol.upper(), provider),
            )
            row = cur.fetchone()
        return dict(row) if row else None

    # ── Paper trades (assumed buys) ───────────────────────────────────────────

    def get_latest_close(self, symbol: str) -> Optional[float]:
        """Most recent close price for a symbol, or None if no quotes."""
        with self._read() as cur:
            cur.execute(
                "SELECT close FROM daily_quotes WHERE symbol = %s ORDER BY date DESC LIMIT 1",
                (symbol,),
            )
            row = cur.fetchone()
        return float(row[0]) if row and row[0] is not None else None

    def add_paper_trade(
        self,
        symbol: str,
        buy_price: float,
        quantity: int = 1000,
        buy_date: Optional[date] = None,
        entry_price: Optional[float] = None,
        stop_loss: Optional[float] = None,
        target: Optional[float] = None,
        phase: Optional[str] = None,
        signal: Optional[str] = None,
        note: Optional[str] = None,
    ) -> int:
        with self._cursor() as cur:
            cur.execute(
                """
                INSERT INTO paper_trades
                    (symbol, buy_date, buy_price, quantity,
                     entry_price, stop_loss, target, phase, signal, note)
                VALUES (%s, COALESCE(%s, CURRENT_DATE), %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (symbol, buy_date, buy_price, quantity,
                 entry_price, stop_loss, target, phase, signal, note),
            )
            return cur.fetchone()[0]

    def list_paper_trades(self, status: str = "") -> dict:
        """List paper trades joined with the latest close + computed performance."""
        where = ""
        params: list = []
        if status:
            where = "WHERE p.status = %s"
            params.append(status.upper())

        with self._read(factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                f"""
                SELECT p.*, s.name, s.exchange,
                       lq.close AS current_price, lq.date AS price_date
                FROM paper_trades p
                JOIN symbols s ON s.symbol = p.symbol
                LEFT JOIN LATERAL (
                    SELECT close, date FROM daily_quotes q
                    WHERE q.symbol = p.symbol ORDER BY date DESC LIMIT 1
                ) lq ON TRUE
                {where}
                ORDER BY p.status, p.created_at DESC
                """,
                params,
            )
            rows = [dict(r) for r in cur.fetchall()]

        items = []
        agg = {"cost": 0.0, "market_value": 0.0, "open_count": 0, "closed_count": 0}
        for r in rows:
            buy = float(r["buy_price"])
            qty = int(r["quantity"])
            closed = r["status"] == "CLOSED"
            # Mark price: realised close for CLOSED, latest market close for OPEN.
            mark = float(r["close_price"]) if closed and r["close_price"] is not None else (
                float(r["current_price"]) if r["current_price"] is not None else None)
            cost = buy * qty
            mv   = (mark * qty) if mark is not None else cost
            pl   = mv - cost
            pl_pct = (pl / cost * 100) if cost else 0.0
            items.append({
                **r,
                "buy_price":     buy,
                "quantity":      qty,
                "current_price": mark,
                "cost":          round(cost, 2),
                "market_value":  round(mv, 2),
                "pl":            round(pl, 2),
                "pl_pct":        round(pl_pct, 2),
                "buy_date":      str(r["buy_date"]) if r["buy_date"] else None,
                "close_date":    str(r["close_date"]) if r["close_date"] else None,
                "price_date":    str(r["price_date"]) if r["price_date"] else None,
                "created_at":    r["created_at"].isoformat() if r["created_at"] else None,
            })
            if closed:
                agg["closed_count"] += 1
            else:
                agg["open_count"] += 1
                agg["cost"] += cost
                agg["market_value"] += mv

        agg["pl"]     = round(agg["market_value"] - agg["cost"], 2)
        agg["pl_pct"] = round((agg["pl"] / agg["cost"] * 100) if agg["cost"] else 0.0, 2)
        agg["cost"]   = round(agg["cost"], 2)
        agg["market_value"] = round(agg["market_value"], 2)
        return {"items": items, "summary": agg}

    def close_paper_trade(self, trade_id: int) -> Optional[float]:
        """Close an OPEN trade at the symbol's latest close. Returns the mark
        price, or None if the trade is missing/already closed/has no price."""
        with self._cursor() as cur:
            cur.execute(
                "SELECT symbol FROM paper_trades WHERE id = %s AND status = 'OPEN'",
                (trade_id,),
            )
            row = cur.fetchone()
            if not row:
                return None
            cur.execute(
                "SELECT close FROM daily_quotes WHERE symbol = %s ORDER BY date DESC LIMIT 1",
                (row[0],),
            )
            cr = cur.fetchone()
            if not cr or cr[0] is None:
                return None
            mark = float(cr[0])
            cur.execute(
                """
                UPDATE paper_trades
                SET status = 'CLOSED', close_price = %s, close_date = CURRENT_DATE
                WHERE id = %s
                """,
                (mark, trade_id),
            )
            return mark

    def delete_paper_trade(self, trade_id: int) -> bool:
        with self._cursor() as cur:
            cur.execute("DELETE FROM paper_trades WHERE id = %s", (trade_id,))
            return cur.rowcount > 0

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
