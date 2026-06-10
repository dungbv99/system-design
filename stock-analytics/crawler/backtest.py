"""
Wyckoff walk-forward backtest engine.

Two strategies:
  signal_replay — walk forward every `step` bars, run analyze(), open a trade
                  on each BUY/SHORT signal transition, exit on stop/target/timeout.
  event_trades  — same walk-forward, but enter a trade whenever a NEW
                  Spring/Test/LPS/UT/UTAD/LPSY event is first detected.

Both strategies share one analyze() call per step to avoid duplicate work.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from datetime import date as date_cls
from typing import Optional

from wyckoff import analyze

# ── Constants ─────────────────────────────────────────────────────────────────

BUY_TRIGGER_EVENTS   = {"Spring", "Test", "LPS"}
SHORT_TRIGGER_EVENTS = {"UT", "UTAD", "LPSY"}
ALL_TRIGGER_EVENTS   = BUY_TRIGGER_EVENTS | SHORT_TRIGGER_EVENTS


# ── Public types ──────────────────────────────────────────────────────────────

@dataclass
class BacktestTrade:
    symbol:       str
    strategy:     str           # signal_replay | event_trade
    signal:       str           # BUY | SHORT
    event:        Optional[str] # triggering event (event_trade only)
    phase:        str
    sub_phase:    str
    entry_date:   str
    entry_price:  float
    stop_loss:    float
    target:       float
    exit_date:    str
    exit_price:   float
    exit_reason:  str           # stop | target | timeout | end_of_data
    return_pct:   float
    holding_days: int


@dataclass
class BacktestResult:
    symbol:            str
    strategy:          str
    bars_analyzed:     int
    total_trades:      int
    buy_trades:        int
    short_trades:      int
    winning_trades:    int
    win_rate:          float    # %
    avg_return_pct:    float
    median_return_pct: float
    best_trade_pct:    float
    worst_trade_pct:   float
    total_return_pct:  float    # sum of individual returns
    max_drawdown_pct:  float    # max peak-to-trough on equity curve
    avg_holding_days:  float
    equity_curve:      list[float]   # cumulative return after each trade
    trades:            list[BacktestTrade]


# ── Main entry point ──────────────────────────────────────────────────────────

def run_backtest(
    symbol:   str,
    bars:     list[dict],
    strategy: str = "both",   # signal_replay | event_trades | both
    lookback: int = 260,
    horizon:  int = 20,       # max holding bars for signal_replay
    max_hold: int = 60,       # max holding bars for event_trades
    step:     int = 5,        # walk-forward step (bars between analyze calls)
) -> dict:
    """
    Run Wyckoff walk-forward backtest.

    Returns dict with keys 'signal_replay' and/or 'event_trades',
    each value being a BacktestResult (converted to dict for JSON).
    """
    n = len(bars)
    if n < lookback + 10:
        empty = _empty_result(symbol, "both", n)
        out = {}
        if strategy in ("signal_replay", "both"):
            out["signal_replay"] = _to_dict(dataclasses_replace(empty, strategy="signal_replay"))
        if strategy in ("event_trades", "both"):
            out["event_trades"] = _to_dict(dataclasses_replace(empty, strategy="event_trades"))
        return out

    sr_trades, et_trades = _walk_forward(
        symbol, bars, lookback=lookback,
        horizon=horizon, max_hold=max_hold, step=step,
    )

    out = {}
    if strategy in ("signal_replay", "both"):
        out["signal_replay"] = _to_dict(
            _compute_stats(symbol, "signal_replay", n, sr_trades)
        )
    if strategy in ("event_trades", "both"):
        out["event_trades"] = _to_dict(
            _compute_stats(symbol, "event_trades", n, et_trades)
        )
    return out


# ── Walk-forward engine ───────────────────────────────────────────────────────

def _walk_forward(
    symbol:   str,
    bars:     list[dict],
    lookback: int,
    horizon:  int,
    max_hold: int,
    step:     int,
) -> tuple[list[BacktestTrade], list[BacktestTrade]]:
    """
    Single walk-forward loop that drives both strategies, sharing
    one analyze() call per step.
    """
    n = len(bars)
    start = lookback + 5

    # ── Signal-replay state ───────────────────────────────────────────────────
    sr_trades:    list[BacktestTrade] = []
    sr_in_pos:    bool                = False
    sr_pos:       dict                = {}
    sr_prev_sig:  str                 = "WAIT"

    # ── Event-trades state ────────────────────────────────────────────────────
    et_trades:      list[BacktestTrade] = []
    et_open:        list[dict]          = []    # open event-trade positions
    et_seen_events: set[str]            = set() # "type:date" deduplication

    # last bar index that was checked for stop/target (shared by both)
    last_check = start

    for step_i in range(start, n, step):
        # ─── 1. Check stops daily (between previous step and now) ─────────────
        check_end = min(step_i, n)

        # Signal-replay stop check
        if sr_in_pos:
            for j in range(last_check, check_end):
                c   = _f(bars[j].get("close"))
                hld = j - sr_pos["ei"]
                done = _check_exit(sr_pos, c, hld, horizon, bars[j], sr_trades)
                if done:
                    sr_in_pos = False
                    break

        # Event-trades stop check (iterate copy; remove closed)
        for j in range(last_check, check_end):
            c     = _f(bars[j].get("close"))
            alive = []
            for pos in et_open:
                hld  = j - pos["ei"]
                done = _check_exit(pos, c, hld, max_hold, bars[j], et_trades)
                if not done:
                    alive.append(pos)
            et_open = alive

        last_check = step_i

        # ─── 2. Analyze on bars[:step_i] ─────────────────────────────────────
        a   = analyze(symbol, bars[:step_i], lookback=lookback)
        sig = a.signal
        bar_now = bars[step_i - 1]  # most recent bar in the analysis window

        # ─── 3. Signal-replay: open trade on signal transition ────────────────
        if (not sr_in_pos
                and sig in ("BUY", "SHORT")
                and sig != sr_prev_sig
                and a.entry_price):

            ep = a.entry_price
            if sig == "BUY":
                sl = a.stop_loss    or ep * 0.95
                tp = a.resistance   or ep * 1.15
            else:
                sl = a.stop_loss    or ep * 1.05
                tp = a.support      or ep * 0.85

            if _valid_trade(sig, ep, sl, tp):
                sr_pos = _open_pos(
                    symbol, "signal_replay", sig,
                    a.last_event, a.phase, a.sub_phase,
                    bar_now, ep, sl, tp, step_i - 1,
                )
                sr_in_pos = True

        sr_prev_sig = sig

        # ─── 4. Event-trades: open trade on newly detected events ─────────────
        for ev in a.events:
            ek = f"{ev.event_type}:{ev.date}"
            if ek in et_seen_events:
                continue
            if ev.event_type not in ALL_TRIGGER_EVENTS:
                continue
            et_seen_events.add(ek)

            ev_sig = "BUY" if ev.event_type in BUY_TRIGGER_EVENTS else "SHORT"
            ep     = ev.price or _f(bar_now.get("close"))
            if ep <= 0:
                continue

            if ev_sig == "BUY":
                sl = ep * 0.97
                tp = a.resistance or ep * 1.15
            else:
                sl = ep * 1.03
                tp = a.support    or ep * 0.85

            if not _valid_trade(ev_sig, ep, sl, tp):
                continue

            et_open.append(_open_pos(
                symbol, "event_trade", ev_sig,
                ev.event_type, a.phase, a.sub_phase,
                bar_now, ep, sl, tp, step_i - 1,
            ))

    # ─── 5. Close anything still open at end of data ─────────────────────────
    last_bar = bars[-1]
    if sr_in_pos and sr_pos:
        sr_trades.append(_close_trade(sr_pos, last_bar, "end_of_data"))
    for pos in et_open:
        et_trades.append(_close_trade(pos, last_bar, "end_of_data"))

    return sr_trades, et_trades


# ── Trade helpers ─────────────────────────────────────────────────────────────

def _check_exit(
    pos:    dict,
    close:  float,
    holding: int,
    max_hld: int,
    bar:    dict,
    sink:   list,
) -> bool:
    """Return True if the position was closed (trade appended to sink)."""
    if close <= 0:
        return False
    sig = pos["sig"]
    if sig == "BUY":
        if   close <= pos["sl"]:      reason = "stop"
        elif close >= pos["tp"]:      reason = "target"
        elif holding >= max_hld:      reason = "timeout"
        else:                         return False
    else:
        if   close >= pos["sl"]:      reason = "stop"
        elif close <= pos["tp"]:      reason = "target"
        elif holding >= max_hld:      reason = "timeout"
        else:                         return False

    sink.append(_close_trade(pos, bar, reason))
    return True


def _open_pos(
    symbol: str, strategy: str, sig: str,
    event: Optional[str], phase: str, sub_phase: str,
    bar: dict, ep: float, sl: float, tp: float, ei: int,
) -> dict:
    return dict(
        symbol=symbol, strategy=strategy, sig=sig,
        event=event, phase=phase, sp=sub_phase,
        ed=str(bar.get("date", "")),
        ep=ep, sl=sl, tp=tp, ei=ei,
    )


def _close_trade(pos: dict, bar: dict, reason: str) -> BacktestTrade:
    exit_price  = _f(bar.get("close"))
    entry_price = pos["ep"]
    sig         = pos["sig"]

    ret = ((exit_price - entry_price) / entry_price * 100) if sig == "BUY" \
     else ((entry_price - exit_price) / entry_price * 100)

    # calendar holding days
    try:
        ed = date_cls.fromisoformat(pos["ed"][:10])
        xd = date_cls.fromisoformat(str(bar.get("date", ""))[:10])
        hd = (xd - ed).days
    except Exception:
        hd = 0

    return BacktestTrade(
        symbol      = pos["symbol"],
        strategy    = pos["strategy"],
        signal      = sig,
        event       = pos.get("event"),
        phase       = pos.get("phase", ""),
        sub_phase   = pos.get("sp", ""),
        entry_date  = pos["ed"],
        entry_price = round(entry_price, 2),
        stop_loss   = round(pos["sl"], 2),
        target      = round(pos["tp"], 2),
        exit_date   = str(bar.get("date", "")),
        exit_price  = round(exit_price, 2),
        exit_reason = reason,
        return_pct  = round(ret, 2),
        holding_days= max(hd, 0),
    )


def _valid_trade(sig: str, ep: float, sl: float, tp: float) -> bool:
    if ep <= 0:
        return False
    if sig == "BUY":
        return tp > ep > sl
    return sl > ep > tp


# ── Statistics ────────────────────────────────────────────────────────────────

def _compute_stats(
    symbol:   str,
    strategy: str,
    n:        int,
    trades:   list[BacktestTrade],
) -> BacktestResult:
    if not trades:
        return _empty_result(symbol, strategy, n)

    returns  = [t.return_pct for t in trades]
    winners  = [t for t in trades if t.return_pct > 0]

    # Equity curve: cumulative return sum after each trade
    equity: list[float] = []
    cum = 0.0
    peak, max_dd = 0.0, 0.0
    for r in returns:
        cum += r
        equity.append(round(cum, 2))
        if cum > peak:
            peak = cum
        dd = peak - cum
        if dd > max_dd:
            max_dd = dd

    return BacktestResult(
        symbol            = symbol,
        strategy          = strategy,
        bars_analyzed     = n,
        total_trades      = len(trades),
        buy_trades        = sum(1 for t in trades if t.signal == "BUY"),
        short_trades      = sum(1 for t in trades if t.signal == "SHORT"),
        winning_trades    = len(winners),
        win_rate          = round(len(winners) / len(trades) * 100, 1),
        avg_return_pct    = round(statistics.mean(returns), 2),
        median_return_pct = round(statistics.median(returns), 2),
        best_trade_pct    = round(max(returns), 2),
        worst_trade_pct   = round(min(returns), 2),
        total_return_pct  = round(sum(returns), 2),
        max_drawdown_pct  = round(max_dd, 2),
        avg_holding_days  = round(
            statistics.mean(t.holding_days for t in trades), 1
        ),
        equity_curve      = equity,
        trades            = trades,
    )


def _empty_result(symbol: str, strategy: str, n: int) -> BacktestResult:
    return BacktestResult(
        symbol=symbol, strategy=strategy, bars_analyzed=n,
        total_trades=0, buy_trades=0, short_trades=0, winning_trades=0,
        win_rate=0.0, avg_return_pct=0.0, median_return_pct=0.0,
        best_trade_pct=0.0, worst_trade_pct=0.0, total_return_pct=0.0,
        max_drawdown_pct=0.0, avg_holding_days=0.0,
        equity_curve=[], trades=[],
    )


# ── Serialisation ─────────────────────────────────────────────────────────────

def _to_dict(result: BacktestResult) -> dict:
    d = result.__dict__.copy()
    d["trades"] = [t.__dict__ for t in result.trades]
    return d


def dataclasses_replace(obj: BacktestResult, **kwargs) -> BacktestResult:
    d = obj.__dict__.copy()
    d.update(kwargs)
    return BacktestResult(**d)


# ── Utility ───────────────────────────────────────────────────────────────────

def _f(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0
