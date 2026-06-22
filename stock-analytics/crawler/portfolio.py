"""
Portfolio manager — position sizing, trailing stops, hold limits.

Deliberately "dumb" primitives: this module owns position bookkeeping only.  It
has NO regime awareness — the decision to exit on a DOWNTREND regime lives in the
backtest loop / live run (see README §4.4 and §7).  ``exit_all_positions`` is a
pure primitive: it closes the explicit list of positions it is handed with the
reason string it is given, and does not know *why* it was called.

Works identically in backtest mode (historical bars indexed by date) and live
mode (latest available bars).  Pure Python stdlib.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from math import floor
from typing import Optional

from wyckoff import _f
from wyckoff_opt import compute_atr, compute_rs, compute_trailing_stop, merge_params


@dataclass
class Position:
    symbol:        str
    entry_date:    str
    entry_price:   float
    shares:        int
    stop_loss:     float
    trailing_stop: float
    atr_at_entry:  float = 0.0
    running_max:   float = 0.0       # highest price seen since entry
    regime_at_entry: str = ""
    wyckoff_phase: str = ""
    sector:        str = ""
    ecosystem:     Optional[str] = None
    rs_weak_streak: int = 0          # consecutive days RS below exit ratio
    max_hold_days: int = 260
    bars_held:     int = 0           # trading days held (incremented by the backtest loop)
    min_hold_days: int = 0           # T+ lock: no exit until held >= this many bars (0 = off)
    exit_date:     Optional[str]   = None
    exit_price:    Optional[float] = None
    exit_type:     Optional[str]   = None   # STOP_LOSS|WYCKOFF_EXIT|REGIME_EXIT|MAX_HOLD|RS_EXIT|MANUAL


@dataclass
class Portfolio:
    capital:          float
    cash:             float
    open_positions:   list[Position] = field(default_factory=list)
    closed_positions: list[Position] = field(default_factory=list)
    max_positions:    int = 8

    def allocation_per_slot(self) -> float:
        return self.capital / self.max_positions

    def can_open(self) -> bool:
        return len(self.open_positions) < self.max_positions

    def open_slots(self) -> int:
        return self.max_positions - len(self.open_positions)

    def open_symbols(self) -> list[str]:
        return [p.symbol for p in self.open_positions]

    def equity(self, marks: dict[str, float] | None = None) -> float:
        """Cash + open positions valued at ``marks`` (cost basis when missing)."""
        marks = marks or {}
        held = 0.0
        for p in self.open_positions:
            px = marks.get(p.symbol, p.entry_price)
            held += p.shares * px
        return self.cash + held


# ── Position lifecycle ────────────────────────────────────────────────────────

def open_position(portfolio: Portfolio, symbol: str, entry_date: str,
                  entry_price: float, atr: float, params: dict | None = None,
                  **meta) -> Optional[Position]:
    """Open an equal-weight position if a slot + cash allow. Returns it, or None."""
    p = merge_params(params)
    if not portfolio.can_open() or entry_price <= 0:
        return None
    allocation = min(portfolio.cash, portfolio.allocation_per_slot())
    shares = floor(allocation / entry_price)
    if shares <= 0:
        return None
    cost = shares * entry_price
    portfolio.cash -= cost
    stop = round(entry_price - p["atr_stop_mult"] * atr, 2) if atr > 0 else round(entry_price * 0.9, 2)
    pos = Position(
        symbol=symbol, entry_date=entry_date, entry_price=entry_price,
        shares=shares, stop_loss=stop, trailing_stop=stop,
        atr_at_entry=atr, running_max=entry_price,
        max_hold_days=p["max_hold_days"],
        min_hold_days=p.get("min_hold_days", 0),
        regime_at_entry=meta.get("regime", ""),
        wyckoff_phase=meta.get("wyckoff_phase", ""),
        sector=meta.get("sector", ""),
        ecosystem=meta.get("ecosystem"),
    )
    portfolio.open_positions.append(pos)
    return pos


def close_position(portfolio: Portfolio, position: Position, exit_date: str,
                   exit_price: float, reason: str) -> None:
    """Dumb primitive — books the exit, returns proceeds to cash. No decisions."""
    if position not in portfolio.open_positions:
        return
    position.exit_date = exit_date
    position.exit_price = exit_price
    position.exit_type = reason
    portfolio.cash += position.shares * exit_price
    portfolio.open_positions.remove(position)
    portfolio.closed_positions.append(position)


def exit_all_positions(portfolio: Portfolio, prices: dict[str, float],
                       exit_date: str, reason: str) -> int:
    """Close every open position at ``prices[symbol]``.  Pure primitive.

    ``prices`` maps symbol → exit price (e.g. next day's open). Positions with no
    price fall back to their entry price (flat). Returns the count closed.
    """
    n = 0
    for pos in portfolio.open_positions[:]:
        px = prices.get(pos.symbol, pos.entry_price)
        close_position(portfolio, pos, exit_date, px, reason)
        n += 1
    return n


# ── Per-day maintenance helpers ───────────────────────────────────────────────

def update_trailing_stops(portfolio: Portfolio, prices: dict[str, float],
                          exit_date: str, params: dict | None = None) -> list[str]:
    """Ratchet trailing stops up; close any position whose price ≤ its stop.

    ``prices`` maps symbol → current bar's price (close). Returns exited symbols.
    """
    p = merge_params(params)
    exited: list[str] = []
    for pos in portfolio.open_positions[:]:
        px = prices.get(pos.symbol)
        if px is None or px <= 0:
            continue
        if pos.bars_held < pos.min_hold_days:   # T+ lock — ratchet stop but can't sell yet
            pos.running_max = max(pos.running_max, px)
            continue
        pos.running_max = max(pos.running_max, px)
        pos.trailing_stop = max(
            pos.trailing_stop,
            compute_trailing_stop(pos.entry_price, px, pos.atr_at_entry,
                                  pos.running_max, p),
        )
        if px <= pos.trailing_stop:
            close_position(portfolio, pos, exit_date, px, "STOP_LOSS")
            exited.append(pos.symbol)
    return exited


def _days_between(d0: str, d1: str) -> int:
    from datetime import date
    try:
        return (date.fromisoformat(d1[:10]) - date.fromisoformat(d0[:10])).days
    except Exception:  # noqa: BLE001
        return 0


def check_max_hold_exits(portfolio: Portfolio, prices: dict[str, float],
                         exit_date: str) -> list[str]:
    """Force-sell positions held ≥ max_hold_days (≈1 year). Returns exited symbols.

    Uses calendar days × (260/365) ≈ trading-day equivalence; max_hold_days is
    expressed in trading days, so compare against ``max_hold_days * 365/260``.
    """
    exited: list[str] = []
    for pos in portfolio.open_positions[:]:
        cal_limit = int(pos.max_hold_days * 365 / 260)
        if _days_between(pos.entry_date, exit_date) >= cal_limit:
            px = prices.get(pos.symbol, pos.entry_price)
            close_position(portfolio, pos, exit_date, px, "MAX_HOLD")
            exited.append(pos.symbol)
    return exited


def check_rs_exits(portfolio: Portfolio, all_bars: dict[str, list[dict]],
                   index_bars: list[dict], exit_date: str,
                   prices: dict[str, float], params: dict | None = None) -> list[str]:
    """Exit positions whose RS vs index stays below rs_exit_ratio for 5 days.

    ``all_bars`` are pre-sliced to the current date (last bar = today).
    """
    p = merge_params(params)
    index_closes = [_f(b.get("close")) for b in index_bars] if index_bars else None
    exited: list[str] = []
    for pos in portfolio.open_positions[:]:
        bars = all_bars.get(pos.symbol)
        if not bars:
            continue
        closes = [_f(b.get("close")) for b in bars]
        rs = compute_rs(closes, index_closes, 20)
        if rs is not None and rs < p["rs_exit_ratio"]:
            pos.rs_weak_streak += 1
        else:
            pos.rs_weak_streak = 0
        if pos.rs_weak_streak >= 5:
            px = prices.get(pos.symbol, pos.entry_price)
            close_position(portfolio, pos, exit_date, px, "RS_EXIT")
            exited.append(pos.symbol)
    return exited


# ── Serialisation ─────────────────────────────────────────────────────────────

def position_to_trade(pos: Position) -> dict:
    """Flatten a closed Position into a backtest_trades row dict."""
    entry_val = pos.shares * pos.entry_price
    exit_val  = pos.shares * (pos.exit_price or pos.entry_price)
    pnl = exit_val - entry_val
    pnl_pct = (pnl / entry_val * 100) if entry_val else 0.0
    return {
        "symbol":          pos.symbol,
        "entry_date":      pos.entry_date,
        "entry_price":     round(pos.entry_price, 2),
        "exit_date":       pos.exit_date,
        "exit_price":      round(pos.exit_price, 2) if pos.exit_price else None,
        "shares":          pos.shares,
        "pnl":             round(pnl, 2),
        "pnl_pct":         round(pnl_pct, 4),
        "hold_days":       _days_between(pos.entry_date, pos.exit_date) if pos.exit_date else None,
        "exit_type":       pos.exit_type,
        "regime_at_entry": pos.regime_at_entry,
        "wyckoff_phase":   pos.wyckoff_phase,
        "sector":          pos.sector,
        "ecosystem":       pos.ecosystem,
    }
