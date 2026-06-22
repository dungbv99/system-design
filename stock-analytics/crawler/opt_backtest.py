"""
Wyckoff-Optimized walk-forward backtest engine (2014–2025).

NOTE ON THE FILENAME: README §2 calls this ``backtest.py``, but a different
``backtest.py`` already exists in this package (the single-symbol Wyckoff
walk-forward imported by ``portfolio_backtest.py``).  To avoid clobbering it this
engine lives in ``opt_backtest.py``; the public function names match the README
(``run_backtest`` / ``run_walk_forward`` / ``run_full_backtest``).

Design — why it terminates:
  Running ``wyckoff.analyze()`` per symbol per date inside a 1000-sample
  optimizer is computationally hopeless in pure Python.  So the expensive base
  Wyckoff analysis + indicators are PRE-COMPUTED ONCE into "signal snapshots"
  (one per symbol per scan date).  ``run_backtest`` then only re-applies the
  cheap, param-dependent scoring / sizing / regime logic, so the optimizer can
  sweep parameters quickly over the same snapshots.

See README_WYCKOFF_OPTIMIZED.md §8.
"""

from __future__ import annotations

import bisect
import hashlib
import logging
import os
import pickle
import statistics
from dataclasses import dataclass, field
from datetime import date as date_cls

import regime as regime_mod
import sector_rotation as sr
import wyckoff as _wy
from portfolio import (
    Portfolio, check_max_hold_exits, check_rs_exits, close_position,
    exit_all_positions, open_position, position_to_trade, update_trailing_stops,
)
from wyckoff import _f
from wyckoff_opt import compute_indicators, compute_signal_score, merge_params

log = logging.getLogger(__name__)

VNINDEX_SYM = "VNINDEX"
RISK_FREE   = 0.06   # annual, for the Sharpe numerator

# Max daily bars handed to analyze()/compute_indicators per scan: enough for
# lookback (≤260) and the weekly/monthly resample (≥26 months ≈ 550 bars), while
# bounding per-call cost + temp allocation as full history grows past 3000 bars.
_ANALYZE_WINDOW = 800


# ── Result type (README §8.4) ─────────────────────────────────────────────────

@dataclass
class BacktestResult:
    total_return:       float = 0.0
    annual_return:      float = 0.0
    sharpe_ratio:       float = 0.0
    max_drawdown:       float = 0.0
    win_rate:           float = 0.0
    avg_hold_days:      float = 0.0
    total_trades:       int   = 0
    regime_exit_trades: int   = 0
    by_year:            dict  = field(default_factory=dict)
    by_regime:          dict  = field(default_factory=dict)
    best_trade:         dict  = field(default_factory=dict)
    worst_trade:        dict  = field(default_factory=dict)
    indicator_ic:       dict  = field(default_factory=dict)
    params_used:        dict  = field(default_factory=dict)
    equity_curve:       list  = field(default_factory=list)
    trades:             list  = field(default_factory=list)


# ── Pre-indexed market context (built once, reused across param sweeps) ────────

@dataclass
class _SymSeries:
    dates:   list[str]
    opens:   list[float]
    highs:   list[float]
    lows:    list[float]
    closes:  list[float]
    volumes: list[int]


@dataclass
class _BaseLite:
    """The only Wyckoff fields the simulation reads — keeps snapshots tiny.

    Storing the full WyckoffAnalysis (events + ~260 per-bar VSA labels + long
    description strings) for every symbol × scan-date blew memory to ~30 GB and
    OOM-killed the run.  We keep just signal/phase/sub_phase."""
    signal:    str
    phase:     str
    sub_phase: str


# Scalar indicator keys the scoring/sizing layer needs (no full series).
_IND_SCALARS = (
    "rsi_last", "macd_hist_last", "bb_width_last", "bb_lower_last", "close_last",
    "force_index_last", "cmf_last", "vroc_last", "stoch_k_last", "stoch_d_last",
    "rs_last", "atr_last",
)


def _compact_ind(ind: dict) -> dict:
    """Keep only the scalars + a short RSI tail (for the `_rising` check) so a
    snapshot is ~200 bytes instead of hundreds of KB of indicator series."""
    out = {k: ind.get(k) for k in _IND_SCALARS}
    out["rsi"] = list(ind.get("rsi", [])[-4:])   # _rising(series, 3) needs 4 vals
    return out


@dataclass
class BacktestContext:
    calendar:       list[str]                 # global trading days (from VNINDEX)
    series:         dict[str, _SymSeries]
    vnindex_bars:   list[dict]
    symbol_sectors: dict[str, str]
    # snapshots[date] -> list of per-symbol signal snapshots scanned that day
    snapshots:      dict[str, list[dict]]
    lookback:       int
    step:           int
    regime_cache:   dict = field(default_factory=dict)   # (ma_fast,ma_slow,dd,lookback) -> regime_map
    cache_path:     str | None = None                    # disk cache this ctx came from / was saved to


def _to_series(bars: list[dict]) -> _SymSeries:
    return _SymSeries(
        dates=[str(b.get("date", "")) for b in bars],
        opens=[_f(b.get("open")) for b in bars],
        highs=[_f(b.get("high")) for b in bars],
        lows=[_f(b.get("low")) for b in bars],
        closes=[_f(b.get("close")) for b in bars],
        volumes=[max(0, int(b.get("volume") or 0)) for b in bars],
    )


def _idx_on_or_before(s: _SymSeries, day: str) -> int:
    """Largest index whose date ≤ day, or -1."""
    i = bisect.bisect_right(s.dates, day) - 1
    return i


def _next_trading(s: _SymSeries, day: str) -> tuple[str, float] | None:
    """First (date, open) strictly after ``day`` for this symbol."""
    i = bisect.bisect_right(s.dates, day)
    if i >= len(s.dates):
        return None
    return s.dates[i], s.opens[i]


# Bump when the snapshot-building logic changes, so old caches are invalidated
# (the data fingerprint alone can't detect a code change).
_CTX_CACHE_VERSION = 1


def _ctx_cache_path(data: dict, lookback: int, step: int,
                    start_date: str, end_date: str) -> str:
    """Cache file keyed by a data fingerprint + build args. The fingerprint
    (per-symbol bar count + last date) changes whenever new quotes are crawled,
    so a stale cache is never reused; identical inputs across optimizer
    iterations hit the cache and skip the ~1.5h precompute."""
    fp = hashlib.md5()
    for sym in sorted(data):
        bars = data[sym]
        fp.update(sym.encode())
        fp.update(str(len(bars)).encode())
        if bars:
            fp.update(str(bars[-1].get("date", "")).encode())
    fp.update(f"v{_CTX_CACHE_VERSION}|{lookback}|{step}|{start_date}|{end_date}".encode())
    cdir = "output" if os.path.isdir("output") else "."
    return os.path.join(cdir, f"ctx_cache_{fp.hexdigest()[:16]}.pkl")


def build_context(data: dict[str, list[dict]], symbol_sectors: dict[str, str] | None = None,
                  lookback: int = 260, step: int = 5,
                  start_date: str = "2014-01-01", end_date: str = "2025-12-31",
                  progress: bool = True) -> BacktestContext:
    """Pre-index all bars and pre-compute signal snapshots (the slow part).

    Snapshots are computed at a FIXED ``lookback`` — the optimizer's lookback
    range is therefore approximated by this value (documented limitation).

    The result is cached to disk (only for full builds, ``progress=True``) so
    repeated optimizer runs reuse the snapshots instead of recomputing them.
    """
    cache_path = _ctx_cache_path(data, lookback, step, start_date, end_date)
    if progress and os.path.exists(cache_path):
        try:
            with open(cache_path, "rb") as fh:
                ctx = pickle.load(fh)
            log.info("build_context: loaded cached snapshots from %s", cache_path)
            return ctx
        except Exception as e:  # noqa: BLE001
            log.warning("build_context: cache load failed (%s) — rebuilding", e)

    symbol_sectors = symbol_sectors or {}
    vnindex_bars = [b for b in data.get(VNINDEX_SYM, []) if start_date <= str(b.get("date", "")) <= end_date]
    if not vnindex_bars:
        # fall back to the union of all symbol dates as the calendar
        all_days = sorted({str(b.get("date", "")) for bars in data.values() for b in bars
                           if start_date <= str(b.get("date", "")) <= end_date})
        calendar = all_days
    else:
        calendar = [str(b.get("date", "")) for b in vnindex_bars]

    series: dict[str, _SymSeries] = {}
    for sym, bars in data.items():
        if sym == VNINDEX_SYM:
            continue
        bb = [b for b in bars if str(b.get("date", "")) <= end_date]
        if bb:
            series[sym] = _to_series(bb)

    index_series = _to_series(vnindex_bars) if vnindex_bars else None

    # Scan dates: every ``step`` global days
    scan_days = calendar[::step]
    snapshots: dict[str, list[dict]] = {}
    symbols = sorted(series.keys())
    total = len(scan_days)
    if progress:
        import progress as _pr
        _pr.get().set_phase("precompute", total,
                            f"scanning {len(symbols)} symbols × {total} dates")
    for n, day in enumerate(scan_days):
        if progress:
            import progress as _pr
            _pr.get().tick()
        day_snaps: list[dict] = []
        index_slice = None
        if index_series is not None:
            ii = _idx_on_or_before(index_series, day)
            if ii >= 0:
                index_slice = _slice_bars(index_series, ii, max_bars=_ANALYZE_WINDOW)
        for sym in symbols:
            s = series[sym]
            i = _idx_on_or_before(s, day)
            if i < lookback:        # need at least `lookback` bars of history (§17)
                continue
            # Cap the window: analyze() only looks back `lookback` bars and its
            # weekly/monthly resample needs ~38 months — 800 daily bars suffice,
            # and bound the per-call allocation (full history grew O(n) per call).
            slice_bars = _slice_bars(s, i, max_bars=_ANALYZE_WINDOW)
            try:
                base = _wy.analyze(sym, slice_bars, lookback=lookback)
                ind = compute_indicators(slice_bars, index_slice)
            except Exception:  # noqa: BLE001
                continue
            # Store ONLY the few fields the simulation reads (memory-bounded).
            day_snaps.append({
                "date": day, "symbol": sym,
                "base": _BaseLite(base.signal, base.phase, base.sub_phase),
                "ind": _compact_ind(ind),
                "sector": symbol_sectors.get(sym, ""),
            })
        if day_snaps:
            snapshots[day] = day_snaps
        if progress and total and (n % max(1, total // 10) == 0):
            log.info("precompute snapshots [%d/%d] (%s) — %d symbols scanned",
                     n, total, day, len(day_snaps))

    ctx = BacktestContext(
        calendar=calendar, series=series, vnindex_bars=vnindex_bars,
        symbol_sectors=symbol_sectors, snapshots=snapshots,
        lookback=lookback, step=step, cache_path=cache_path,
    )
    if progress:
        try:
            with open(cache_path, "wb") as fh:
                pickle.dump(ctx, fh, protocol=pickle.HIGHEST_PROTOCOL)
            log.info("build_context: cached snapshots to %s", cache_path)
        except Exception as e:  # noqa: BLE001
            log.warning("build_context: cache save failed: %s", e)
    return ctx


def _slice_bars(s: _SymSeries, i: int, max_bars: int | None = None) -> list[dict]:
    """Reconstruct an oldest→newest bar-dict list ending at index i (inclusive).

    ``max_bars`` caps how far back the window reaches (keeps the most recent
    ``max_bars`` bars) to bound per-call cost and allocation.
    """
    start = 0 if max_bars is None else max(0, i + 1 - max_bars)
    return [
        {"date": s.dates[j], "open": s.opens[j], "high": s.highs[j],
         "low": s.lows[j], "close": s.closes[j], "volume": s.volumes[j]}
        for j in range(start, i + 1)
    ]


# ── Core simulation ───────────────────────────────────────────────────────────

def run_backtest(data: dict[str, list[dict]], params: dict, capital: float,
                 start_date: str, end_date: str,
                 ctx: BacktestContext | None = None) -> BacktestResult:
    """Simulate the strategy over [start_date, end_date].

    Builds a BacktestContext when one isn't supplied (slow path).  Pass a shared
    ``ctx`` from ``build_context`` when sweeping params so snapshots are computed
    once.  Regime detection + the DOWNTREND exit decision happen INSIDE this loop
    on every date — never via portfolio.py (README §4.4).
    """
    p = merge_params(params)
    if ctx is None:
        ctx = build_context(data, lookback=p["lookback"], step=5,
                            start_date=start_date, end_date=end_date, progress=False)

    # Regime per date. Only 4 params affect it, so memoize on the ctx — the
    # optimizer sweeps hundreds of samples that share the same regime config,
    # turning ~N full VNINDEX passes into ~a dozen.
    rkey = (p["regime_ma_fast"], p["regime_ma_slow"], p["downtrend_drawdown_pct"], p["lookback"])
    regime_map = ctx.regime_cache.get(rkey)
    if regime_map is None:
        regime_series = regime_mod.get_regime_series(ctx.vnindex_bars, p)
        regime_map = {r["date"]: r["regime"] for r in regime_series}
        ctx.regime_cache[rkey] = regime_map

    calendar = [d for d in ctx.calendar if start_date <= d <= end_date]
    scan_set = set(ctx.calendar[::ctx.step])

    pf = Portfolio(capital=capital, cash=capital, max_positions=p["max_positions"])
    daily_equity: list[dict] = []
    regime_exit_count = 0

    index_series = _to_series(ctx.vnindex_bars) if ctx.vnindex_bars else None

    for di, day in enumerate(calendar):
        regime = regime_map.get(day, regime_mod.SIDEWAYS)
        close_prices = _close_prices(ctx, day)

        # 1. DOWNTREND → exit everything at next open, no new entries (§4.4)
        if regime == regime_mod.DOWNTREND:
            if pf.open_positions:
                nxt, next_opens = _next_open_prices(ctx, day)
                regime_exit_count += exit_all_positions(
                    pf, next_opens, nxt or day, "REGIME_EXIT")
            daily_equity.append({"date": day, "equity": round(pf.equity(close_prices), 2)})
            continue

        # 2. Trailing-stop exits (same-bar)
        update_trailing_stops(pf, close_prices, day, p)
        # 3. Max-hold exits
        check_max_hold_exits(pf, close_prices, day)
        # 4. RS exits (cheap — close-window only)
        if index_series is not None:
            _rs_exits(pf, ctx, index_series, day, close_prices, p)
        # 5. Wyckoff-exit on held positions (use today's snapshot if scanned)
        if day in ctx.snapshots:
            _wyckoff_exits(pf, ctx.snapshots[day], day, close_prices)

        # 6. New entries on scan days when slots free
        if day in scan_set and pf.can_open() and day in ctx.snapshots:
            _scan_entries(pf, ctx, day, regime, p)

        daily_equity.append({"date": day, "equity": round(pf.equity(close_prices), 2)})

    # Close anything still open at the final close.
    if pf.open_positions and calendar:
        last_prices = _close_prices(ctx, calendar[-1])
        for pos in pf.open_positions[:]:
            close_position(pf, pos, calendar[-1],
                           last_prices.get(pos.symbol, pos.entry_price), "END_OF_DATA")

    return _summarize(pf, daily_equity, capital, start_date, end_date,
                      regime_map, regime_exit_count, p)


def _close_prices(ctx: BacktestContext, day: str) -> dict[str, float]:
    out: dict[str, float] = {}
    for sym, s in ctx.series.items():
        i = _idx_on_or_before(s, day)
        if i >= 0 and s.closes[i] > 0:
            out[sym] = s.closes[i]
    return out


def _next_open_prices(ctx: BacktestContext, day: str) -> tuple[str | None, dict[str, float]]:
    out: dict[str, float] = {}
    next_day: str | None = None
    for sym, s in ctx.series.items():
        nxt = _next_trading(s, day)
        if nxt:
            d, o = nxt
            out[sym] = o if o > 0 else s.closes[_idx_on_or_before(s, day)]
            if next_day is None or d < next_day:
                next_day = d
    return next_day, out


def _rs_exits(pf: Portfolio, ctx: BacktestContext, index_series: _SymSeries,
              day: str, close_prices: dict[str, float], p: dict) -> None:
    from wyckoff_opt import compute_rs
    ii = _idx_on_or_before(index_series, day)
    idx_closes = index_series.closes[:ii + 1] if ii >= 0 else None
    for pos in pf.open_positions[:]:
        s = ctx.series.get(pos.symbol)
        if not s:
            continue
        i = _idx_on_or_before(s, day)
        rs = compute_rs(s.closes[:i + 1], idx_closes, 20) if i >= 0 else None
        if rs is not None and rs < p["rs_exit_ratio"]:
            pos.rs_weak_streak += 1
        else:
            pos.rs_weak_streak = 0
        if pos.rs_weak_streak >= 5:
            close_position(pf, pos, day, close_prices.get(pos.symbol, pos.entry_price), "RS_EXIT")


def _wyckoff_exits(pf: Portfolio, day_snaps: list[dict], day: str,
                   close_prices: dict[str, float]) -> None:
    snap_by_sym = {s["symbol"]: s for s in day_snaps}
    for pos in pf.open_positions[:]:
        snap = snap_by_sym.get(pos.symbol)
        if not snap:
            continue
        base = snap["base"]
        if base.signal == "SHORT" or (base.phase == "Distribution" and base.sub_phase in ("C", "D")):
            close_position(pf, pos, day, close_prices.get(pos.symbol, pos.entry_price), "WYCKOFF_EXIT")


def _scan_entries(pf: Portfolio, ctx: BacktestContext, day: str,
                  regime: str, p: dict) -> None:
    day_snaps = ctx.snapshots[day]

    # Sector ranking (relative strength) — only when we actually have sectors.
    leading: set[str] | None = None
    if any(ctx.symbol_sectors.get(s["symbol"]) for s in day_snaps):
        top_n = p["top_n_sectors"] if regime != regime_mod.SIDEWAYS else max(1, p["top_n_sectors"] - 1)
        ranking = _rank_sectors_from_snaps(ctx, day)
        leading = {r["sector"] for r in ranking[:top_n]}

    candidates: list[tuple[int, dict]] = []
    held = set(pf.open_symbols())
    for snap in day_snaps:
        sym = snap["symbol"]
        if sym in held:
            continue
        sector = ctx.symbol_sectors.get(sym, "")
        if leading is not None and sector not in leading:
            continue
        # ecosystem concentration cap (max 2 of 8 slots, §5)
        eco = sr.get_ecosystem(sym)
        if eco and sr.is_ecosystem_concentrated(pf.open_symbols(), eco, 2):
            continue
        base = snap["base"]
        score = compute_signal_score(base, snap["ind"], p)
        if base.signal == "BUY" and score >= p["min_signal_score"]:
            candidates.append((score, snap))

    candidates.sort(key=lambda c: c[0], reverse=True)
    for score, snap in candidates[:pf.open_slots()]:
        sym = snap["symbol"]
        s = ctx.series[sym]
        nxt = _next_trading(s, day)
        if not nxt:
            continue
        entry_date, entry_open = nxt
        if entry_open <= 0:
            continue
        atr = snap["ind"]["atr_last"]
        open_position(pf, sym, entry_date, entry_open, atr, p,
                      regime=regime, wyckoff_phase=f"{snap['base'].phase} {snap['base'].sub_phase}",
                      sector=ctx.symbol_sectors.get(sym, ""), ecosystem=sr.get_ecosystem(sym))
        if not pf.can_open():
            break


def _rank_sectors_from_snaps(ctx: BacktestContext, day: str) -> list[dict]:
    """20-day relative-strength sector ranking from close arrays (cheap)."""
    index_series = _to_series(ctx.vnindex_bars) if ctx.vnindex_bars else None
    index_ret = None
    if index_series is not None:
        ii = _idx_on_or_before(index_series, day)
        if ii >= 20:
            c0, c1 = index_series.closes[ii - 20], index_series.closes[ii]
            index_ret = (c1 / c0 - 1.0) if c0 > 0 else None

    by_sector: dict[str, list[float]] = {}
    for sym, s in ctx.series.items():
        sector = ctx.symbol_sectors.get(sym)
        if not sector:
            continue
        i = _idx_on_or_before(s, day)
        if i < 20:
            continue
        c0, c1 = s.closes[i - 20], s.closes[i]
        if c0 <= 0:
            continue
        by_sector.setdefault(sector, []).append(c1 / c0 - 1.0)

    out = []
    for sector, rets in by_sector.items():
        avg = statistics.mean(rets)
        rs = (1.0 + avg) / (1.0 + index_ret) if index_ret not in (None, -1.0) else 1.0 + avg
        out.append({"sector": sector, "rs_score": rs})
    out.sort(key=lambda r: r["rs_score"], reverse=True)
    return out


# ── Metrics ───────────────────────────────────────────────────────────────────

def _summarize(pf: Portfolio, daily_equity: list[dict], capital: float,
               start_date: str, end_date: str, regime_map: dict,
               regime_exit_count: int, params: dict) -> BacktestResult:
    trades = [position_to_trade(p) for p in pf.closed_positions]
    res = BacktestResult(params_used=params, trades=trades,
                         equity_curve=daily_equity, total_trades=len(trades),
                         regime_exit_trades=regime_exit_count)
    if not daily_equity:
        return res

    final_equity = daily_equity[-1]["equity"]
    res.total_return = round((final_equity / capital - 1.0) * 100, 2)
    years = max(_year_frac(start_date, end_date), 0.01)
    res.annual_return = round(((final_equity / capital) ** (1.0 / years) - 1.0) * 100, 2) \
        if final_equity > 0 else -100.0

    # daily returns → Sharpe + max drawdown
    eq = [d["equity"] for d in daily_equity]
    rets = [(eq[i] / eq[i - 1] - 1.0) for i in range(1, len(eq)) if eq[i - 1] > 0]
    if len(rets) > 2 and statistics.pstdev(rets) > 0:
        ann_ret = statistics.mean(rets) * 252
        ann_vol = statistics.pstdev(rets) * (252 ** 0.5)
        res.sharpe_ratio = round((ann_ret - RISK_FREE) / ann_vol, 3) if ann_vol > 0 else 0.0
    peak = capital
    max_dd = 0.0
    for v in eq:
        peak = max(peak, v)
        if peak > 0:
            max_dd = max(max_dd, (peak - v) / peak)
    res.max_drawdown = round(max_dd, 4)

    if trades:
        wins = [t for t in trades if t["pnl"] > 0]
        res.win_rate = round(len(wins) / len(trades), 4)
        holds = [t["hold_days"] for t in trades if t["hold_days"] is not None]
        res.avg_hold_days = round(statistics.mean(holds), 1) if holds else 0.0
        best = max(trades, key=lambda t: t["pnl_pct"])
        worst = min(trades, key=lambda t: t["pnl_pct"])
        res.best_trade = {"symbol": best["symbol"], "pnl_pct": best["pnl_pct"], "hold_days": best["hold_days"]}
        res.worst_trade = {"symbol": worst["symbol"], "pnl_pct": worst["pnl_pct"], "hold_days": worst["hold_days"]}

        # per-year return from equity curve
        year_end: dict[int, float] = {}
        for d in daily_equity:
            year_end[int(d["date"][:4])] = d["equity"]
        prev = capital
        for y in sorted(year_end):
            res.by_year[str(y)] = round((year_end[y] / prev - 1.0) * 100, 2) if prev > 0 else 0.0
            prev = year_end[y]

        # per-regime avg trade return
        reg_groups: dict[str, list[float]] = {}
        for t in trades:
            reg_groups.setdefault(t["regime_at_entry"] or "?", []).append(t["pnl_pct"])
        res.by_regime = {k: round(statistics.mean(v), 2) for k, v in reg_groups.items()}

        res.indicator_ic = _indicator_ic(pf.closed_positions, trades)
    return res


def _indicator_ic(positions, trades) -> dict:
    """Approximate IC: correlate each entry-indicator value with trade pnl_pct."""
    from wyckoff_opt import compute_ic
    # We didn't store per-entry indicator values on Position; approximate using
    # the trade outcome distribution only when unavailable → return empty.
    # (Full IC is computed in the dedicated pruning pass; kept light here.)
    return {}


def _year_frac(start: str, end: str) -> float:
    try:
        d0 = date_cls.fromisoformat(start[:10])
        d1 = date_cls.fromisoformat(end[:10])
        return max((d1 - d0).days, 1) / 365.25
    except Exception:  # noqa: BLE001
        return 1.0


# ── Walk-forward + full pipeline ──────────────────────────────────────────────

# 9 rolling splits: 3-year train, 1-year test (README §8.2)
WALK_FORWARD_SPLITS = [
    (("2014-01-01", "2016-12-31"), ("2017-01-01", "2017-12-31")),
    (("2015-01-01", "2017-12-31"), ("2018-01-01", "2018-12-31")),
    (("2016-01-01", "2018-12-31"), ("2019-01-01", "2019-12-31")),
    (("2017-01-01", "2019-12-31"), ("2020-01-01", "2020-12-31")),
    (("2018-01-01", "2020-12-31"), ("2021-01-01", "2021-12-31")),
    (("2019-01-01", "2021-12-31"), ("2022-01-01", "2022-12-31")),
    (("2020-01-01", "2022-12-31"), ("2023-01-01", "2023-12-31")),
    (("2021-01-01", "2023-12-31"), ("2024-01-01", "2024-12-31")),
    (("2022-01-01", "2024-12-31"), ("2025-01-01", "2025-12-31")),
]


def run_walk_forward(data: dict[str, list[dict]], capital: float,
                     symbol_sectors: dict[str, str] | None = None,
                     n_samples: int = 1000, lookback: int = 260,
                     step: int = 5, ctx: BacktestContext | None = None) -> list[dict]:
    """Run all 9 walk-forward splits: optimise on train, evaluate on test.

    Returns a list of dicts: {split, train, test, params, train_result, test_result}.
    Snapshots are built ONCE over the full range and shared across every sample
    (pass a pre-built ``ctx`` to avoid re-computing them).
    """
    import optimizer
    import progress as _pr

    if ctx is None:
        ctx = build_context(data, symbol_sectors, lookback=lookback, step=step,
                            start_date="2014-01-01", end_date="2025-12-31")

    _pr.get().set_phase("walk_forward", len(WALK_FORWARD_SPLITS) * max(1, n_samples),
                        f"{len(WALK_FORWARD_SPLITS)} splits × {n_samples} samples")
    out: list[dict] = []
    for n, (train, test) in enumerate(WALK_FORWARD_SPLITS, 1):
        log.info("walk-forward split %d/%d: train %s test %s", n, len(WALK_FORWARD_SPLITS), train, test)
        ranked = optimizer.random_search(data, capital, train, n_samples, ctx=ctx,
                                         tick=_pr.get().tick)
        if not ranked:
            continue
        best_params, _ = ranked[0]
        train_res = run_backtest(data, best_params, capital, *train, ctx=ctx)
        test_res = run_backtest(data, best_params, capital, *test, ctx=ctx)
        out.append({
            "split": n, "train": train, "test": test, "params": best_params,
            "train_sharpe": train_res.sharpe_ratio,
            "test_result": test_res,
        })
        log.info("split %d: test annual=%.1f%% sharpe=%.2f maxDD=%.1f%% winrate=%.0f%%",
                 n, test_res.annual_return, test_res.sharpe_ratio,
                 test_res.max_drawdown * 100, test_res.win_rate * 100)
    return out


def run_full_backtest(store, capital: float = 1_000_000_000,
                      train_start: str = "2014-01-01", train_end: str = "2025-12-31",
                      n_random_samples: int = 1000) -> None:
    """Load data from the store, run walk-forward, persist results.

    Saves one ``backtest_runs`` row per split (with its trades) and the winning
    per-regime params to ``optimized_params`` + ``optimized_params.json``.
    """
    import progress as _pr

    _pr.get().start("loading VN100 data")
    try:
        store.ensure_wyckoff_opt_tables()
        symbols = store.get_vn100_symbols()
        log.info("run_full_backtest: loading %d VN100 symbols + VNINDEX", len(symbols))

        data: dict[str, list[dict]] = {}
        for sym in symbols + [VNINDEX_SYM]:
            bars = store.get_symbol_quotes(sym, days=9999)
            if bars:
                data[sym] = bars
        if VNINDEX_SYM not in data:
            log.warning("VNINDEX missing from daily_quotes — regime detection will fall back to SIDEWAYS")

        symbol_sectors = store.get_all_symbols_with_sectors()

        # Build snapshots ONCE; reused by both walk-forward and per-regime optimize.
        ctx = build_context(data, symbol_sectors, lookback=260, step=5,
                            start_date=train_start, end_date=train_end)

        splits = run_walk_forward(data, capital, symbol_sectors,
                                  n_samples=n_random_samples, ctx=ctx)
        _run_full_persist(store, data, symbol_sectors, capital, splits,
                          n_random_samples, ctx)
        _pr.get().finish(f"{len(splits)} splits persisted")
    except Exception as e:  # noqa: BLE001
        _pr.get().fail(str(e))
        raise


def _run_full_persist(store, data, symbol_sectors, capital, splits,
                      n_random_samples, ctx) -> None:
    import json
    import optimizer
    import progress as _pr

    # Persist each split's test result.
    for sp in splits:
        res: BacktestResult = sp["test_result"]
        run_id = store.save_backtest_run({
            "capital": capital,
            "train_start": sp["train"][0], "train_end": sp["train"][1],
            "test_start": sp["test"][0], "test_end": sp["test"][1],
            "params": sp["params"], "regime_scope": "ALL",
            "annual_return": res.annual_return / 100, "total_return": res.total_return / 100,
            "sharpe_ratio": res.sharpe_ratio, "max_drawdown": res.max_drawdown,
            "win_rate": res.win_rate, "total_trades": res.total_trades,
            "avg_hold_days": res.avg_hold_days, "by_year": res.by_year,
            "indicator_ic": res.indicator_ic,
            "notes": f"walk-forward split {sp['split']}",
        })
        if res.trades:
            store.save_backtest_trades(run_id, res.trades)

    # Per-regime optimisation → optimized_params (reuses the same snapshots).
    per_regime = optimizer.optimize_per_regime(data, capital, ctx=ctx,
                                               n_samples=max(100, n_random_samples // 2))
    for reg, info in per_regime.items():
        store.save_optimized_params(reg, info["params"], info.get("run_id"), info.get("sharpe", 0.0))

    import os
    out_path = "output/optimized_params.json" if os.path.isdir("output") else "optimized_params.json"
    try:
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump({r: v["params"] for r, v in per_regime.items()}, fh, indent=2)
        log.info("wrote %s", out_path)
    except OSError as e:
        log.warning("could not write optimized_params.json: %s", e)

    log.info("run_full_backtest complete: %d splits persisted, params for %s",
             len(splits), list(per_regime.keys()))


def optimize_and_save(store, capital: float = 1_000_000_000,
                      n_samples: int = 300) -> dict:
    """Standalone per-regime optimisation over the full range → optimized_params.

    Lighter than ``run_full_backtest`` (no walk-forward split persistence) — used
    by ``make optimize``.  Returns the per-regime params dict.
    """
    import optimizer

    store.ensure_wyckoff_opt_tables()
    symbols = store.get_vn100_symbols()
    data: dict[str, list[dict]] = {}
    for sym in symbols + [VNINDEX_SYM]:
        bars = store.get_symbol_quotes(sym, days=9999)
        if bars:
            data[sym] = bars
    symbol_sectors = store.get_all_symbols_with_sectors()
    ctx = build_context(data, symbol_sectors)
    per_regime = optimizer.optimize_per_regime(data, capital, ctx=ctx, n_samples=n_samples)
    store.save_optimized_params_all(per_regime)
    log.info("optimize_and_save: saved params for %s", list(per_regime.keys()))
    return per_regime
