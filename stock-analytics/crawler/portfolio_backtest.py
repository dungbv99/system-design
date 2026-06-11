"""
Portfolio-level Wyckoff backtest.

Runs the single-symbol Wyckoff walk-forward (signal_replay) across a basket of
symbols (e.g. VN100) from a start date, keeps the BUY (long) trades only — the
Vietnamese market is effectively long-only — and simulates one shared cash
account with a fixed number of concurrent position slots.

Money model (event-driven, no daily mark-to-market):
  • Start with `capital`, allow up to `slots` concurrent positions.
  • A BUY signal opens a position only if a slot is free and cash remains.
    Allocation = cash / (free slots)  → roughly equal-weight, never overdraws.
  • On exit the allocation returns to cash compounded by the trade return.
  • Equity at any event = cash + open allocations at cost basis.

Output: summary stats, an equity curve (one point per trade event), per-year
returns, and the list of executed trades — all JSON-serialisable.
"""

from __future__ import annotations

import heapq
import itertools
import logging
import math
import statistics
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date as date_cls

import backtest as bt

log = logging.getLogger(__name__)


# ── Main entry point ──────────────────────────────────────────────────────────

def run_portfolio_backtest(
    symbol_bars: dict[str, list[dict]],
    start_date:  str   = "2018-01-01",
    capital:     float = 1_000_000_000.0,   # 1bn VND
    slots:       int   = 8,
    cost_pct:    float = 0.3,                # round-trip fee+tax (≈ VN reality)
    min_hold:    int   = 3,                  # T+ rule: hold ≥ 3 sessions before selling
    lot_size:    int   = 100,                # HOSE round-lot size (shares)
    lookback:    int   = 260,
    horizon:     int   = 20,
    step:        int   = 5,
    workers:     int   = 6,
) -> dict:
    """
    symbol_bars — {symbol: bars} where bars is oldest→newest OHLCV dicts.
                  Bars are filtered to date >= start_date here.
    Returns a dict: {params, summary, equity_curve, yearly, trades}.
    """
    # ── 1. Per-symbol walk-forward (parallel) → collect BUY trades ─────────────
    all_trades: list[dict] = []
    symbols = sorted(symbol_bars.keys())

    def one(symbol: str) -> list[dict]:
        bars = [b for b in symbol_bars[symbol] if str(b.get("date", "")) >= start_date]
        if len(bars) < lookback + 10:
            return []
        res = bt.run_backtest(
            symbol, bars, strategy="signal_replay",
            lookback=lookback, horizon=horizon, step=step, min_hold=min_hold,
        )
        # long-only: keep BUY trades, drop SHORT
        return [t for t in res["signal_replay"]["trades"] if t["signal"] == "BUY"]

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(one, s): s for s in symbols}
        for fut in as_completed(futures):
            try:
                all_trades.extend(fut.result())
            except Exception as e:  # noqa: BLE001
                log.warning("portfolio backtest %s failed: %s", futures[fut], e)

    # ── 2. Event-driven portfolio simulation (slot/cash allocation) ───────────
    sim = _simulate(all_trades, capital=capital, slots=slots,
                    cost_pct=cost_pct, lot_size=lot_size)
    executed = sim["executed"]

    # ── 3. Daily mark-to-market equity curve (realistic drawdown) ─────────────
    equity_curve, max_dd = _daily_equity_curve(executed, symbol_bars, capital, start_date)

    # ── 4. Benchmark: median per-stock buy & hold over the same window ────────
    benchmark_pct = _benchmark_buy_hold(symbol_bars, start_date)

    end_date = equity_curve[-1]["date"] if equity_curve else \
        max((t["exit_date"] for t in executed), default=start_date)
    years = max(_year_frac(start_date, end_date), 0.01)

    final_equity = sim["final_equity"]
    total_return = (final_equity / capital - 1.0) * 100.0
    cagr = ((final_equity / capital) ** (1.0 / years) - 1.0) * 100.0 if final_equity > 0 else -100.0

    pls   = [t["pl"] for t in executed]
    wins  = [p for p in pls if p > 0]
    losses = [p for p in pls if p < 0]
    gross_profit = sum(wins)
    gross_loss   = abs(sum(losses))

    summary = {
        "symbols":          len(symbols),
        "start_date":       start_date,
        "end_date":         end_date,
        "years":            round(years, 2),
        "initial_capital":  round(capital, 2),
        "final_equity":     round(final_equity, 2),
        "total_return_pct": round(total_return, 2),
        "cagr_pct":         round(cagr, 2),
        "benchmark_pct":    round(benchmark_pct, 2),
        "total_signals":    len(all_trades),
        "executed_trades":  len(executed),
        "skipped_signals":  sim["skipped"],
        "winning_trades":   len(wins),
        "losing_trades":    len(losses),
        "win_rate":         round(len(wins) / len(executed) * 100, 1) if executed else 0.0,
        "avg_return_pct":   round(statistics.mean(t["net_return_pct"] for t in executed), 2) if executed else 0.0,
        "avg_win_pct":      round(statistics.mean(t["net_return_pct"] for t in executed if t["net_return_pct"] > 0), 2) if wins else 0.0,
        "avg_loss_pct":     round(statistics.mean(t["net_return_pct"] for t in executed if t["net_return_pct"] < 0), 2) if losses else 0.0,
        "best_trade_pct":   round(max((t["net_return_pct"] for t in executed), default=0.0), 2),
        "worst_trade_pct":  round(min((t["net_return_pct"] for t in executed), default=0.0), 2),
        "profit_factor":    round(gross_profit / gross_loss, 2) if gross_loss > 0 else None,
        "max_drawdown_pct": round(max_dd, 2),
        "avg_holding_days": round(statistics.mean(t["holding_days"] for t in executed), 1) if executed else 0.0,
        "slots":            slots,
        "cost_pct":         cost_pct,
        "min_hold":         min_hold,
        "lot_size":         lot_size,
    }

    return {
        "params": {
            "start_date": start_date, "capital": capital, "slots": slots,
            "cost_pct": cost_pct, "min_hold": min_hold, "lot_size": lot_size,
            "lookback": lookback, "horizon": horizon, "step": step,
        },
        "summary":      summary,
        "equity_curve": equity_curve,
        "yearly":       _yearly_returns(equity_curve, capital),
        "trades":       executed,
    }


# ── Simulation ────────────────────────────────────────────────────────────────

def _simulate(trades: list[dict], capital: float, slots: int,
              cost_pct: float, lot_size: int = 100) -> dict:
    """Event-driven long-only allocation with `slots` concurrent positions.

    Each new position targets ~1/slots of total equity (cost basis), capped by
    available cash — proper equal-weight, so no single trade can scoop up all
    the cash when the book is nearly full. The share count is rounded DOWN to a
    whole `lot_size` (HOSE trades in 100-share lots); the round-lot remainder
    stays in cash. `cost_pct` is the round-trip fee+tax deducted from every
    trade's return. A signal is skipped when all slots are full, there is no
    cash, or the budget can't afford even one lot. The realistic daily equity
    path is computed separately in _daily_equity_curve.
    """
    # Fully-specified sort key → deterministic execution order regardless of the
    # order per-symbol results arrived from the thread pool. Without the symbol /
    # exit_date tie-breakers, same-day signals competing for the last free slot
    # would resolve by thread-completion timing, making runs non-reproducible.
    trades_sorted = sorted(trades, key=lambda t: (t["entry_date"], t["symbol"], t["exit_date"]))

    cash      = capital
    open_cost = 0.0               # sum of cost-basis allocations still open
    open_heap: list = []          # (exit_date, seq, position)
    seq       = itertools.count()
    executed: list[dict] = []
    skipped   = 0

    def close_due(until: str):
        nonlocal cash, open_cost
        while open_heap and open_heap[0][0] <= until:
            _, _, pos = heapq.heappop(open_heap)
            cash += pos["alloc"] * (1.0 + pos["net"] / 100.0)
            open_cost -= pos["alloc"]

    for t in trades_sorted:
        close_due(t["entry_date"])

        ep = t["entry_price"] or 0.0
        if len(open_heap) < slots and cash > 1e-6 and ep > 0:
            target = (cash + open_cost) / slots       # equal-weight target size
            budget = min(cash, target)
            shares = math.floor(budget / ep / lot_size) * lot_size
            if shares <= 0:                            # can't afford one round lot
                skipped += 1
                continue
            cost = shares * ep
            cash      -= cost
            open_cost += cost
            gross = t["return_pct"]
            net   = gross - cost_pct
            heapq.heappush(open_heap, (t["exit_date"], next(seq), {"alloc": cost, "net": net}))
            executed.append({
                **t,
                "shares":         int(shares),
                "alloc":          round(cost, 2),
                "net_return_pct": round(net, 2),
                "pl":             round(cost * net / 100.0, 2),
                "exit_value":     round(cost * (1.0 + net / 100.0), 2),
            })
        else:
            skipped += 1

    # realise anything still open at end of data
    while open_heap:
        _, _, pos = heapq.heappop(open_heap)
        cash += pos["alloc"] * (1.0 + pos["net"] / 100.0)

    return {"final_equity": cash, "executed": executed, "skipped": skipped}


def _daily_equity_curve(
    executed: list[dict], symbol_bars: dict[str, list[dict]],
    capital: float, start_date: str,
) -> tuple[list[dict], float]:
    """Mark the portfolio to market every trading day → honest equity & drawdown.

    Each executed trade buys shares = alloc / entry_price at entry_date and is
    held (valued at the symbol's daily close) until exit_date, when it converts
    back to cash at the realised return.
    """
    traded = {t["symbol"] for t in executed}
    if not traded:
        return [], 0.0

    closes: dict[str, dict[str, float]] = {}
    date_set: set[str] = set()
    for sym in traded:
        d: dict[str, float] = {}
        for b in symbol_bars.get(sym, []):
            ds = str(b.get("date", ""))
            c  = _f(b.get("close"))
            if ds >= start_date and c > 0:
                d[ds] = c
                date_set.add(ds)
        closes[sym] = d

    calendar = sorted(date_set)
    if not calendar:
        return [], 0.0

    entries: dict[str, list[dict]] = defaultdict(list)
    exits:   dict[str, list[dict]] = defaultdict(list)
    for t in executed:
        ep = t["entry_price"] or 0.0
        pos = {
            "sym":   t["symbol"],
            "shares": t.get("shares", (t["alloc"] / ep) if ep > 0 else 0.0),
            "alloc": t["alloc"],
            # realise at the net (after-cost) return so final equity matches _simulate
            "ret":   t.get("net_return_pct", t["return_pct"]),
        }
        entries[t["entry_date"]].append(pos)
        exits[t["exit_date"]].append(pos)

    cash       = capital
    active:    list[dict] = []
    last_close: dict[str, float] = {}
    curve: list[dict] = []
    peak   = capital
    max_dd = 0.0

    for day in calendar:
        for sym in traded:
            c = closes[sym].get(day)
            if c is not None:
                last_close[sym] = c

        for pos in entries.get(day, []):
            cash -= pos["alloc"]
            active.append(pos)
        for pos in exits.get(day, []):
            cash += pos["alloc"] * (1.0 + pos["ret"] / 100.0)
            if pos in active:
                active.remove(pos)

        holdings = 0.0
        for pos in active:
            lc = last_close.get(pos["sym"])
            holdings += pos["shares"] * lc if lc else pos["alloc"]

        eq = cash + holdings
        if eq > peak:
            peak = eq
        dd = (peak - eq) / peak * 100.0 if peak > 0 else 0.0
        if dd > max_dd:
            max_dd = dd
        curve.append({"date": day, "equity": round(eq, 2), "drawdown_pct": round(dd, 2)})

    return curve, max_dd


# ── Benchmark & yearly ────────────────────────────────────────────────────────

def _benchmark_buy_hold(symbol_bars: dict[str, list[dict]], start_date: str) -> float:
    """Median per-stock buy & hold over the window.

    Median (not mean) so a single corrupt early price — e.g. VCB's 23.24 on
    2018-01-02 — can't blow up the benchmark. A 1000 VND floor on the first
    close drops obvious data artefacts entirely.
    """
    rets: list[float] = []
    for bars in symbol_bars.values():
        closes = [_f(b.get("close")) for b in bars
                  if str(b.get("date", "")) >= start_date and _f(b.get("close")) > 0]
        if len(closes) >= 2 and closes[0] >= 1000.0:
            rets.append((closes[-1] / closes[0] - 1.0) * 100.0)
    return statistics.median(rets) if rets else 0.0


def _yearly_returns(curve: list[dict], capital: float) -> list[dict]:
    """Portfolio return per calendar year, derived from the equity curve."""
    if not curve:
        return []
    # equity at the last point of each year
    year_end: dict[int, float] = {}
    for pt in curve:
        y = int(pt["date"][:4])
        year_end[y] = pt["equity"]

    out: list[dict] = []
    prev = capital
    for y in sorted(year_end):
        end = year_end[y]
        out.append({
            "year":       y,
            "return_pct": round((end / prev - 1.0) * 100.0, 2) if prev > 0 else 0.0,
            "equity":     round(end, 2),
        })
        prev = end
    return out


# ── Utility ───────────────────────────────────────────────────────────────────

def _year_frac(start: str, end: str) -> float:
    try:
        d0 = date_cls.fromisoformat(start[:10])
        d1 = date_cls.fromisoformat(end[:10])
        return max((d1 - d0).days, 1) / 365.25
    except Exception:  # noqa: BLE001
        return 1.0


def _f(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0
