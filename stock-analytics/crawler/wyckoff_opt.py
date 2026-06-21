"""
Wyckoff Optimized — extended indicator engine.

Wraps the existing ``wyckoff.analyze()`` and layers a set of confirmation
indicators on top (RSI, MACD, ATR, Bollinger squeeze, Force Index, CMF, VROC,
Stochastic RSI, Relative Strength vs the index).  The optimized entry/exit rules
live here, not in ``wyckoff.py`` — the original Wyckoff dashboard keeps working
unchanged.

Pure Python stdlib + ``statistics`` only — no pandas / numpy — matching the
``wyckoff.py`` house style.  Low-level math helpers (``_rsi``, ``_ema``,
``_macd``, ``_sma``, ``_bollinger``, ``_mean``, ``_f``, ``_r``) are reused from
``wyckoff`` so there is exactly one implementation of each.

See README_WYCKOFF_OPTIMIZED.md §3.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from typing import Optional

import wyckoff as _wy
from wyckoff import _bollinger, _ema, _f, _macd, _mean, _r, _rsi, _sma


# ── Default parameter set ─────────────────────────────────────────────────────
# Initial, hand-picked values used everywhere before the optimizer has produced
# data-driven ones.  ``store.get_optimized_params(regime)`` overrides these at
# run time; ``optimizer.PARAM_GRID`` enumerates the search ranges.  Keep every
# key the rest of the pipeline reads defined here so a missing optimized-params
# row never KeyErrors.
DEFAULT_PARAMS: dict = {
    # Wyckoff core (passed through to wyckoff.analyze / _detect_range)
    "lookback":               260,
    "range_bars":             120,
    "pivot_bars":             3,
    "climax_vol_mult":        1.8,
    "hi_vol_mult":            1.4,
    "lo_vol_mult":            0.7,
    # RSI filters
    "rsi_entry_max":          55,
    "rsi_exit_min":           70,
    # ATR stop
    "atr_stop_mult":          2.0,
    "atr_trail_pct":          0.85,
    # Bollinger squeeze
    "bb_squeeze_thresh":      0.05,
    # Entry quality
    "min_signal_score":       4,
    # Sector filter
    "top_n_sectors":          3,
    # Regime detection
    "downtrend_drawdown_pct": 0.10,
    "regime_ma_fast":         50,
    "regime_ma_slow":         200,
    # Relative strength
    "rs_min_ratio":           1.0,
    "rs_exit_ratio":          0.85,
    # Portfolio
    "max_positions":          8,
    "max_hold_days":          260,
}


def merge_params(params: Optional[dict]) -> dict:
    """Return DEFAULT_PARAMS overlaid with any provided overrides."""
    merged = dict(DEFAULT_PARAMS)
    if params:
        merged.update({k: v for k, v in params.items() if v is not None})
    return merged


# ── Public type ───────────────────────────────────────────────────────────────

@dataclass
class OptSignal:
    symbol:       str
    signal:       str            # BUY | WAIT | HOLD | SHORT
    score:        int            # 0–8 confirmation score
    phase:        str
    sub_phase:    str
    current_price: Optional[float]
    entry_price:  Optional[float]
    stop_loss:    Optional[float]
    rsi:          Optional[float]
    macd_hist:    Optional[float]
    bb_width:     Optional[float]
    force_index:  Optional[float]
    cmf:          Optional[float]
    vroc:         Optional[float]
    stoch_rsi:    Optional[float]
    rs:           Optional[float]
    atr:          Optional[float]
    regime:       Optional[str]  = None
    indicators:   dict           = field(default_factory=dict)
    reasons:      list[str]      = field(default_factory=list)


# ── Indicator series ──────────────────────────────────────────────────────────

def compute_atr(highs: list[float], lows: list[float], closes: list[float],
                period: int = 14) -> list[float]:
    """ATR(period) using Wilder's RMA of True Range."""
    n = len(closes)
    tr = [0.0] * n
    for i in range(1, n):
        pc = closes[i - 1]
        tr[i] = max(highs[i] - lows[i], abs(highs[i] - pc), abs(lows[i] - pc))
    atr = [0.0] * n
    if n <= period:
        return atr
    seed = _mean(tr[1:period + 1])
    atr[period] = seed
    for i in range(period + 1, n):
        atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period
    return atr


def compute_force_index(closes: list[float], volumes: list[int],
                        period: int = 13) -> list[float]:
    """Force Index = EMA(period) of (close − prev_close) × volume."""
    n = len(closes)
    raw = [0.0] * n
    for i in range(1, n):
        raw[i] = (closes[i] - closes[i - 1]) * volumes[i]
    return _ema(raw, period)


def compute_cmf(highs: list[float], lows: list[float], closes: list[float],
                volumes: list[int], period: int = 20) -> list[float]:
    """Chaikin Money Flow(period)."""
    n = len(closes)
    mfv = [0.0] * n
    for i in range(n):
        hl = highs[i] - lows[i]
        if hl > 0:
            mult = ((closes[i] - lows[i]) - (highs[i] - closes[i])) / hl
            mfv[i] = mult * volumes[i]
    cmf = [0.0] * n
    for i in range(period - 1, n):
        vol_sum = sum(volumes[i - period + 1:i + 1])
        if vol_sum > 0:
            cmf[i] = sum(mfv[i - period + 1:i + 1]) / vol_sum
    return cmf


def compute_vroc(volumes: list[int], period: int = 5) -> list[float]:
    """Volume Rate of Change(period) in percent."""
    n = len(volumes)
    vroc = [0.0] * n
    for i in range(period, n):
        base = volumes[i - period]
        if base > 0:
            vroc[i] = (volumes[i] - base) / base * 100.0
    return vroc


def compute_stoch_rsi(closes: list[float], period: int = 14,
                      smooth_k: int = 3, smooth_d: int = 3,
                      ) -> tuple[list[float], list[float]]:
    """Stochastic RSI %K and %D (both in 0–1)."""
    rsi = _rsi(closes, period)
    n = len(rsi)
    stoch = [0.0] * n
    for i in range(period, n):
        window = rsi[max(0, i - period + 1):i + 1]
        lo, hi = min(window), max(window)
        stoch[i] = (rsi[i] - lo) / (hi - lo) if hi > lo else 0.0
    k = _sma(stoch, smooth_k)
    d = _sma(k, smooth_d)
    return k, d


def compute_rs(closes: list[float], index_closes: list[float] | None,
               lookback: int = 20) -> Optional[float]:
    """Relative Strength = stock_return / index_return over ``lookback`` bars.

    Returns ``None`` when the index series is unavailable or too short.
    """
    if not index_closes or len(closes) <= lookback or len(index_closes) <= lookback:
        return None
    s0, s1 = closes[-1 - lookback], closes[-1]
    i0, i1 = index_closes[-1 - lookback], index_closes[-1]
    if s0 <= 0 or i0 <= 0:
        return None
    stock_ret = s1 / s0 - 1.0
    index_ret = i1 / i0 - 1.0
    if abs(index_ret) < 1e-9:
        return 1.0 if stock_ret >= 0 else 0.0
    # Ratio of (1+return)s keeps the metric well-behaved for negative markets.
    return (1.0 + stock_ret) / (1.0 + index_ret)


def compute_indicators(bars: list[dict], index_bars: list[dict] | None = None,
                       params: Optional[dict] = None) -> dict:
    """Compute every indicator on ``bars`` and return latest values + series.

    ``bars`` / ``index_bars`` are oldest→newest OHLCV dicts (wyckoff format).
    """
    p = merge_params(params)
    closes  = [_f(b.get("close"))  for b in bars]
    highs   = [_f(b.get("high"))   for b in bars]
    lows    = [_f(b.get("low"))    for b in bars]
    volumes = [max(0, int(b.get("volume") or 0)) for b in bars]

    rsi              = _rsi(closes, 14)
    _, _, macd_hist  = _macd(closes)
    upper, mid, lower = _bollinger(closes, 20, 2.0)
    atr              = compute_atr(highs, lows, closes, 14)
    fi               = compute_force_index(closes, volumes, 13)
    cmf              = compute_cmf(highs, lows, closes, volumes, 20)
    vroc             = compute_vroc(volumes, 5)
    stoch_k, stoch_d = compute_stoch_rsi(closes, 14, 3, 3)

    bb_width = [
        (upper[i] - lower[i]) / mid[i] if mid[i] > 0 else 0.0
        for i in range(len(closes))
    ]

    index_closes = [_f(b.get("close")) for b in index_bars] if index_bars else None
    rs = compute_rs(closes, index_closes, 20)

    last = -1
    return {
        "closes": closes, "highs": highs, "lows": lows, "volumes": volumes,
        "rsi": rsi, "macd_hist": macd_hist,
        "bb_upper": upper, "bb_mid": mid, "bb_lower": lower, "bb_width": bb_width,
        "atr": atr, "force_index": fi, "cmf": cmf, "vroc": vroc,
        "stoch_k": stoch_k, "stoch_d": stoch_d, "rs": rs,
        # convenience scalars (latest bar)
        "rsi_last":         rsi[last]       if rsi else 50.0,
        "macd_hist_last":   macd_hist[last] if macd_hist else 0.0,
        "bb_width_last":    bb_width[last]  if bb_width else 0.0,
        "bb_lower_last":    lower[last]     if lower else 0.0,
        "atr_last":         atr[last]       if atr else 0.0,
        "force_index_last": fi[last]        if fi else 0.0,
        "cmf_last":         cmf[last]       if cmf else 0.0,
        "vroc_last":        vroc[last]      if vroc else 0.0,
        "stoch_k_last":     stoch_k[last]   if stoch_k else 0.0,
        "stoch_d_last":     stoch_d[last]   if stoch_d else 0.0,
        "rs_last":          rs,
        "close_last":       closes[last]    if closes else 0.0,
    }


# ── Signal scoring ────────────────────────────────────────────────────────────

def _rising(series: list[float], bars: int = 3) -> bool:
    if len(series) <= bars:
        return False
    return series[-1] > series[-1 - bars]


def compute_signal_score(wyckoff_result, ind: dict, params: Optional[dict] = None) -> int:
    """Score 0–8: each confirming indicator adds one point.

    A non-bullish Wyckoff base (no BUY / not Accumulation C+/D) scores 0 — the
    confirmation indicators only matter once the structure says "buy".
    See README §3 and §15.
    """
    p = merge_params(params)
    bullish_base = (
        getattr(wyckoff_result, "signal", "WAIT") == "BUY"
        or (getattr(wyckoff_result, "phase", "") == "Accumulation"
            and getattr(wyckoff_result, "sub_phase", "") in ("C", "D"))
    )
    if not bullish_base:
        return 0

    score = 0
    # 1. RSI in the entry band and rising
    if 30 <= ind["rsi_last"] <= p["rsi_entry_max"] and _rising(ind["rsi"], 3):
        score += 1
    # 2. MACD histogram positive (momentum turning up)
    if ind["macd_hist_last"] > 0:
        score += 1
    # 3. Bollinger squeeze (low volatility before breakout) or price at lower band
    if ind["bb_width_last"] and ind["bb_width_last"] < p["bb_squeeze_thresh"]:
        score += 1
    elif ind["bb_lower_last"] and ind["close_last"] <= ind["bb_lower_last"] * 1.02:
        score += 1
    # 4. Force Index positive (demand absorbing supply)
    if ind["force_index_last"] > 0:
        score += 1
    # 5. CMF positive (accumulation)
    if ind["cmf_last"] > 0.05:
        score += 1
    # 6. Volume expansion
    if ind["vroc_last"] > 80:
        score += 1
    # 7. Stochastic RSI oversold recovery (%K crossing %D while both low)
    if ind["stoch_k_last"] < 0.2 and ind["stoch_k_last"] >= ind["stoch_d_last"]:
        score += 1
    # 8. Relative strength leading the index (skip when index data missing)
    if ind["rs_last"] is not None and ind["rs_last"] > p["rs_min_ratio"]:
        score += 1
    return score


# ── Stop-loss ─────────────────────────────────────────────────────────────────

def compute_trailing_stop(entry_price: float, current_price: float,
                          atr_at_entry: float, running_max: float,
                          params: Optional[dict] = None) -> float:
    """ATR-based trailing stop that only ratchets up.

    trailing_stop = max(entry − atr_stop_mult·ATR_at_entry,
                        running_max · atr_trail_pct)
    """
    p = merge_params(params)
    atr_floor = entry_price - p["atr_stop_mult"] * atr_at_entry
    trail = max(running_max, current_price) * p["atr_trail_pct"]
    return max(atr_floor, trail)


# ── Live signal ───────────────────────────────────────────────────────────────

def run_live_signal(symbol: str, bars: list[dict], index_bars: list[dict] | None = None,
                    params: Optional[dict] = None, regime: str | None = None) -> OptSignal:
    """Optimized live signal for one symbol using ``params`` (regime-specific).

    Calls the base Wyckoff analysis, layers the confirmation indicators on top,
    and gates the BUY on the signal score and the current regime.
    """
    p = merge_params(params)
    base = _wy.analyze(symbol, bars, lookback=p["lookback"])
    ind  = compute_indicators(bars, index_bars, p)
    score = compute_signal_score(base, ind, p)

    signal = base.signal
    reasons: list[str] = []

    if regime == "DOWNTREND":
        signal = "WAIT"
        reasons.append("DOWNTREND regime — no entries")
    elif base.signal == "BUY":
        if score < p["min_signal_score"]:
            signal = "WAIT"
            reasons.append(f"score {score} < min {p['min_signal_score']}")
        elif ind["rsi_last"] > p["rsi_entry_max"] + 10:
            signal = "WAIT"
            reasons.append(f"RSI {ind['rsi_last']:.0f} overbought")
        else:
            reasons.append(f"BUY confirmed (score {score})")

    atr_last  = ind["atr_last"]
    entry     = base.current_price
    stop_loss = base.stop_loss
    if signal == "BUY" and entry and atr_last > 0:
        stop_loss = round(entry - p["atr_stop_mult"] * atr_last, 2)

    return OptSignal(
        symbol=symbol,
        signal=signal,
        score=score,
        phase=base.phase,
        sub_phase=base.sub_phase,
        current_price=base.current_price,
        entry_price=entry if signal == "BUY" else base.entry_price,
        stop_loss=stop_loss,
        rsi=_r(ind["rsi_last"]),
        macd_hist=_r(ind["macd_hist_last"]),
        bb_width=_r(ind["bb_width_last"]),
        force_index=_r(ind["force_index_last"]),
        cmf=_r(ind["cmf_last"]),
        vroc=_r(ind["vroc_last"]),
        stoch_rsi=_r(ind["stoch_k_last"]),
        rs=_r(ind["rs_last"]) if ind["rs_last"] is not None else None,
        atr=_r(atr_last),
        regime=regime,
        indicators={
            "rsi": _r(ind["rsi_last"]), "macd_hist": _r(ind["macd_hist_last"]),
            "bb_width": _r(ind["bb_width_last"]), "force_index": _r(ind["force_index_last"]),
            "cmf": _r(ind["cmf_last"]), "vroc": _r(ind["vroc_last"]),
            "stoch_rsi": _r(ind["stoch_k_last"]),
            "rs": _r(ind["rs_last"]) if ind["rs_last"] is not None else None,
            "atr": _r(atr_last),
        },
        reasons=reasons,
    )


# ── Indicator pruning (Information Coefficient) ───────────────────────────────

def compute_ic(indicator_series: list[float], forward_return_series: list[float]) -> float:
    """Pearson correlation between an indicator signal and forward returns.

    abs(IC) < 0.02 ⇒ the indicator carries no useful information (drop it).
    Returns 0.0 when the series are too short or have zero variance.
    """
    pairs = [
        (a, b) for a, b in zip(indicator_series, forward_return_series)
        if a is not None and b is not None
    ]
    if len(pairs) < 3:
        return 0.0
    xs = [a for a, _ in pairs]
    ys = [b for _, b in pairs]
    try:
        if statistics.pstdev(xs) == 0 or statistics.pstdev(ys) == 0:
            return 0.0
        return statistics.correlation(xs, ys)  # Python 3.10+
    except Exception:  # noqa: BLE001
        return 0.0
