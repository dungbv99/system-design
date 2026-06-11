"""PostgreSQL persistence layer — all upserts so re-runs are idempotent."""

import logging
from contextlib import contextmanager
from datetime import date, datetime
from typing import Optional

import psycopg2
import psycopg2.extras
import psycopg2.pool
from psycopg2.extras import Json

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

    def upsert_wyckoff_signal(self, analysis) -> None:
        sql = """
            INSERT INTO wyckoff_signals
                (symbol, analyzed_at, phase, sub_phase, signal, signal_strength,
                 support, resistance, current_price, last_event,
                 entry_price, stop_loss, target, rr_ratio, description, bars_analyzed)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
