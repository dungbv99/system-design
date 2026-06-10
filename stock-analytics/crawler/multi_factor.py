"""
Multi-Factor Signal System.

Scoring engine that grades four independent technical factors on each ticker,
each worth up to 25 points (total 0–100), and emits a BUY | WATCH | AVOID signal.
A factor "agrees" when it scores >= 15/25; a signal needs >= 3 agreeing factors
for HIGH confidence.

  Trend          — MA20/MA50/MA200 alignment + price position
  Momentum       — RSI(14) level + MACD(12/26/9) cross direction
  Volume         — volume / MA20 ratio + 5-bar volume trend
  Price position — distance from support/resistance + candle pattern

Sibling module to wyckoff.py — same data flow, same Store integration, same
call pattern. Pure standard library (statistics, math). No pandas, no numpy.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional
import statistics

from wyckoff import _detect_range, _f, _r, _mean, _sma, _rsi  # reuse shared helpers


# ── Parameters ────────────────────────────────────────────────────────────────

DEFAULT_PARAMS = {
    # MA thresholds
    "ma_cross_tolerance":   0.01,   # % tolerance to call MA20 ≈ MA50 (crossing zone)
    "pullback_tolerance":   0.02,   # % within which price counts as "touching MA20"

    # RSI thresholds
    "rsi_period":           14,
    "rsi_oversold":         30,
    "rsi_buy_zone_low":     30,
    "rsi_buy_zone_high":    50,
    "rsi_neutral_high":     65,
    "rsi_overbought":       70,

    # MACD
    "macd_fast":            12,
    "macd_slow":            26,
    "macd_signal":          9,

    # Volume thresholds
    "vol_window":           20,
    "vol_surge":            2.0,
    "vol_high":             1.5,
    "vol_normal":           1.0,
    "vol_low":              0.7,
    "vol_trend_bars":       5,

    # Price position
    "support_tolerance":    0.02,
    "resistance_tolerance": 0.02,
    "range_bars":           120,
    "pivot_bars":           3,

    # Signal thresholds
    "buy_threshold":        70,
    "buy_medium_threshold": 55,
    "watch_threshold":      40,
    "factors_agree_high":   3,
}


# ── Public types ──────────────────────────────────────────────────────────────

@dataclass
class FactorResult:
    name:   str    # 'trend' | 'momentum' | 'volume' | 'price_position'
    score:  int    # 0–25
    reason: str    # human-readable explanation of the score


@dataclass
class MultifactorAnalysis:
    symbol:          str
    analyzed_at:     str             # UTC ISO datetime
    total_score:     int             # 0–100
    signal:          str             # BUY | WATCH | AVOID
    confidence:      str             # HIGH | MEDIUM | LOW
    factors_agreed:  int             # how many factors scored >= 15 (0–4)
    trend_score:     int
    momentum_score:  int
    volume_score:    int
    position_score:  int
    trend_reason:    str
    momentum_reason: str
    volume_reason:   str
    position_reason: str
    current_price:   Optional[float]
    support:         Optional[float]
    resistance:      Optional[float]
    entry_price:     Optional[float]
    stop_loss:       Optional[float]
    description:     str
    bars_analyzed:   int


# ── Main entry point ──────────────────────────────────────────────────────────

def analyze(symbol: str, bars: list[dict], params: Optional[dict] = None) -> MultifactorAnalysis:
    """
    Score the four factors on OHLCV bars and return a BUY/WATCH/AVOID signal.

    bars   — list of {date, open, high, low, close, volume} ordered oldest→newest.
    params — overrides DEFAULT_PARAMS; omit to use defaults.
    """
    p = {**DEFAULT_PARAMS, **(params or {})}

    if not bars or len(bars) < 30:
        return _low_result(symbol, len(bars) if bars else 0,
                           "Insufficient data (need ≥ 30 bars)")

    opens_  = [_f(b.get("open"))                  for b in bars]
    highs   = [_f(b.get("high"))                  for b in bars]
    lows    = [_f(b.get("low"))                   for b in bars]
    closes  = [_f(b.get("close"))                 for b in bars]
    volumes = [max(0, int(b.get("volume") or 0))  for b in bars]
    n = len(bars)

    if not any(c > 0 for c in closes):
        return _low_result(symbol, n, "No valid price data")

    ind = _compute_indicators(highs, lows, closes, volumes, p)

    current_price = closes[-1]
    prev_close    = closes[-2] if n > 1 else current_price

    trend    = _score_trend(ind, current_price, p)
    momentum = _score_momentum(ind, p)
    volume   = _score_volume(ind, current_price, prev_close, p)
    position = _score_price_position(ind, current_price, opens_, highs, lows, closes, p)

    factors = [trend, momentum, volume, position]
    total_score    = sum(f.score for f in factors)
    factors_agreed = sum(1 for f in factors if f.score >= 15)

    signal, confidence, description = _generate_signal(total_score, factors_agreed, p)

    entry_price, stop_loss = (
        _compute_entry_stop(current_price, ind["support"])
        if signal == "BUY" else (None, None)
    )

    return MultifactorAnalysis(
        symbol=symbol,
        analyzed_at=datetime.utcnow().isoformat(),
        total_score=total_score,
        signal=signal,
        confidence=confidence,
        factors_agreed=factors_agreed,
        trend_score=trend.score,
        momentum_score=momentum.score,
        volume_score=volume.score,
        position_score=position.score,
        trend_reason=trend.reason,
        momentum_reason=momentum.reason,
        volume_reason=volume.reason,
        position_reason=position.reason,
        current_price=_r(current_price),
        support=_r(ind["support"]),
        resistance=_r(ind["resistance"]),
        entry_price=_r(entry_price),
        stop_loss=_r(stop_loss),
        description=description,
        bars_analyzed=n,
    )


# ── Indicators ────────────────────────────────────────────────────────────────

def _compute_indicators(
    highs: list[float],
    lows: list[float],
    closes: list[float],
    volumes: list[int],
    p: dict,
) -> dict:
    """Compute all latest-bar indicator values used by the scoring functions."""
    n = len(closes)

    ma20  = _sma(closes, 20)[-1]
    ma50  = _sma(closes, 50)[-1]
    ma200 = _sma(closes, min(200, n))[-1]

    rsi_series = _rsi(closes, p["rsi_period"])
    rsi      = rsi_series[-1]
    rsi_prev = rsi_series[-2] if n > 1 else rsi

    macd_line, macd_signal_line, macd_hist = _macd(
        closes, p["macd_fast"], p["macd_slow"], p["macd_signal"]
    )

    vw = p["vol_window"]
    recent_vol = volumes[-vw:] if len(volumes) >= vw else volumes
    avg_vol = _mean(v for v in recent_vol if v > 0) or 1
    vol_ratio = volumes[-1] / avg_vol if avg_vol > 0 else 0.0

    vol_trend_slope = _slope(volumes[-p["vol_trend_bars"]:])

    support, resistance = _detect_range(
        highs, lows, n,
        range_bars=p["range_bars"], pivot=p["pivot_bars"],
    )

    return {
        "ma20": ma20, "ma50": ma50, "ma200": ma200,
        "rsi": rsi, "rsi_prev": rsi_prev,
        "macd_line": macd_line[-1],
        "macd_signal_line": macd_signal_line[-1],
        "macd_hist": macd_hist[-1],
        "macd_line_prev": macd_line[-2] if len(macd_line) > 1 else macd_line[-1],
        "macd_signal_prev": macd_signal_line[-2] if len(macd_signal_line) > 1 else macd_signal_line[-1],
        "vol_ratio": vol_ratio,
        "vol_trend_slope": vol_trend_slope,
        "support": support, "resistance": resistance,
    }


# ── Factor 1 — Trend (MA) ─────────────────────────────────────────────────────

def _score_trend(ind: dict, price: float, p: dict) -> FactorResult:
    ma20, ma50, ma200 = ind["ma20"], ind["ma50"], ind["ma200"]
    score = 0
    bits: list[str] = []

    # Short-term: MA20 vs MA50
    if ma50 > 0 and abs(ma20 - ma50) / ma50 <= p["ma_cross_tolerance"]:
        score += 6
        bits.append("MA20≈MA50 crossing")
    elif ma20 > ma50:
        score += 12
        bits.append("MA20>MA50 uptrend")
    else:
        bits.append("MA20<MA50 downtrend")

    # Price vs MA20 — pullback to MA20 scores best
    if ma20 > 0 and price >= ma20 and price <= ma20 * (1 + p["pullback_tolerance"]):
        score += 10
        bits.append(f"pullback to MA20 ({ma20:.2f})")
    elif price > ma20:
        score += 8
        bits.append("price above MA20")
    else:
        bits.append("price below MA20")

    # Long-term: MA50 vs MA200
    if ma200 > 0 and ma50 > ma200:
        score += 5
        bits.append("MA50>MA200 long-term up")

    score = min(score, 25)
    return FactorResult("trend", score, "; ".join(bits))


# ── Factor 2 — Momentum (RSI + MACD) ──────────────────────────────────────────

def _score_momentum(ind: dict, p: dict) -> FactorResult:
    rsi, rsi_prev = ind["rsi"], ind["rsi_prev"]
    score = 0
    bits: list[str] = []

    if rsi < p["rsi_oversold"]:
        score += 15
        bits.append(f"RSI {rsi:.0f} oversold")
    elif p["rsi_buy_zone_low"] <= rsi < p["rsi_buy_zone_high"]:
        if rsi > rsi_prev:
            score += 20
            bits.append(f"RSI {rsi:.0f} rising in buy zone")
        else:
            score += 12
            bits.append(f"RSI {rsi:.0f} in buy zone")
    elif p["rsi_buy_zone_high"] <= rsi < p["rsi_neutral_high"]:
        score += 12
        bits.append(f"RSI {rsi:.0f} healthy")
    elif p["rsi_neutral_high"] <= rsi < p["rsi_overbought"]:
        score += 5
        bits.append(f"RSI {rsi:.0f} elevated")
    else:
        bits.append(f"RSI {rsi:.0f} overbought")

    line, sig = ind["macd_line"], ind["macd_signal_line"]
    line_prev, sig_prev = ind["macd_line_prev"], ind["macd_signal_prev"]
    if line > sig and line_prev <= sig_prev:
        score += 5
        bits.append("MACD bullish cross")
    elif line > sig:
        score += 2
        bits.append("MACD above signal")
    else:
        bits.append("MACD below signal")

    score = min(score, 25)
    return FactorResult("momentum", score, "; ".join(bits))


# ── Factor 3 — Volume ─────────────────────────────────────────────────────────

def _score_volume(ind: dict, price: float, prev_close: float, p: dict) -> FactorResult:
    vr    = ind["vol_ratio"]
    slope = ind["vol_trend_slope"]
    score = 0
    bits: list[str] = []

    if vr >= p["vol_surge"]:
        score += 15
        bits.append(f"vol surge {vr:.1f}×")
    elif vr >= p["vol_high"]:
        score += 12
        bits.append(f"vol high {vr:.1f}×")
    elif vr >= p["vol_normal"]:
        score += 7
        bits.append(f"vol normal {vr:.1f}×")
    elif vr >= p["vol_low"]:
        score += 3
        bits.append(f"vol soft {vr:.1f}×")
    else:
        bits.append(f"vol weak {vr:.1f}×")

    if slope > 0:
        score += 5
        bits.append("volume rising")
    else:
        bits.append("volume falling")

    # Divergence penalty: price up while volume fades.
    if price > prev_close and slope < 0:
        score -= 5
        bits.append("price-up/vol-down divergence")

    score = max(0, min(score, 25))
    return FactorResult("volume", score, "; ".join(bits))


# ── Factor 4 — Price Position (S/R + Candle) ──────────────────────────────────

def _score_price_position(
    ind: dict,
    price: float,
    opens_: list[float],
    highs: list[float],
    lows: list[float],
    closes: list[float],
    p: dict,
) -> FactorResult:
    support, resistance = ind["support"], ind["resistance"]
    midpoint = (support + resistance) / 2
    score = 0
    bits: list[str] = []

    if support > 0 and support <= price <= support * (1 + p["support_tolerance"]):
        score += 15
        bits.append(f"at support {support:.2f}")
    elif resistance > 0 and resistance * (1 - p["resistance_tolerance"]) <= price <= resistance:
        score += 3
        bits.append(f"near resistance {resistance:.2f}")
    elif price <= midpoint:
        score += 8
        bits.append("lower half of range")
    else:
        score += 5
        bits.append("upper half of range")

    candle, bullish = _candle_pattern(opens_, highs, lows, closes)
    if bullish:
        score += 10
        bits.append(f"bullish {candle}")
    elif candle in ("Doji", "SmallBody"):
        score += 3
        bits.append("neutral candle")
    else:
        bits.append("no bullish candle")

    score = min(score, 25)
    return FactorResult("price_position", score, "; ".join(bits))


def _candle_pattern(
    opens_: list[float],
    highs: list[float],
    lows: list[float],
    closes: list[float],
) -> tuple[str, bool]:
    """Detect a bullish reversal candle on the latest bar. Returns (name, is_bullish)."""
    o, h, l, c = opens_[-1], highs[-1], lows[-1], closes[-1]
    body = abs(c - o)
    rng  = h - l if h > l else 0.001
    lower_wick = min(o, c) - l
    close_pos  = (c - l) / rng

    # Hammer: long lower wick, small body near the top of the range.
    if lower_wick >= 2 * body and close_pos > 0.5 and body > 0:
        return "Hammer", True

    # Bullish Engulfing: today bullish and engulfs the prior body.
    if len(closes) >= 2:
        po, pc = opens_[-2], closes[-2]
        prev_body = abs(pc - po)
        if c > o and body > prev_body and c > po:
            return "Engulfing", True

    if body <= rng * 0.1:
        return "Doji", False
    if body <= rng * 0.3:
        return "SmallBody", False
    return "None", False


# ── Signal generation ─────────────────────────────────────────────────────────

def _generate_signal(total: int, agreed: int, p: dict) -> tuple[str, str, str]:
    """Map total score + agreeing-factor count to (signal, confidence, description)."""
    if total >= p["buy_threshold"] and agreed >= p["factors_agree_high"]:
        return ("BUY", "HIGH",
                f"BUY (HIGH) — score {total}/100, {agreed}/4 factors agree. "
                f"Full position, set stop loss immediately.")

    if total >= p["buy_medium_threshold"] and agreed >= 2:
        return ("BUY", "MEDIUM",
                f"BUY (MEDIUM) — score {total}/100, {agreed}/4 factors agree. "
                f"Half position, wait for a 3rd factor to confirm.")

    if total >= p["watch_threshold"]:
        if total <= 54 and agreed <= 1:
            return ("WATCH", "LOW",
                    f"WATCH (LOW) — score {total}/100, only {agreed}/4 factors agree. "
                    f"Conflicting signals, stay out.")
        return ("WATCH", "MEDIUM",
                f"WATCH (MEDIUM) — score {total}/100, {agreed}/4 factors agree. "
                f"No entry yet; set an alert and monitor for improvement.")

    return ("AVOID", "LOW",
            f"AVOID — score {total}/100, {agreed}/4 factors agree. "
            f"Do not buy; consider cutting losses if holding.")


# ── Entry / stop-loss computation ────────────────────────────────────────────

def _compute_entry_stop(price: float, support: float) -> tuple[float, float]:
    """entry = current close, stop = 3% below support."""
    return price, support * 0.97


# ── Helpers ───────────────────────────────────────────────────────────────────

def _ema(values: list[float], period: int) -> list[float]:
    """Exponential moving average. Seeds with the first value."""
    if not values:
        return []
    k = 2.0 / (period + 1)
    out = [values[0]]
    for v in values[1:]:
        out.append(v * k + out[-1] * (1 - k))
    return out


def _macd(
    closes: list[float], fast: int, slow: int, signal: int,
) -> tuple[list[float], list[float], list[float]]:
    """MACD line, signal line, histogram — all full-length series."""
    ema_fast = _ema(closes, fast)
    ema_slow = _ema(closes, slow)
    macd_line = [f - s for f, s in zip(ema_fast, ema_slow)]
    signal_line = _ema(macd_line, signal)
    hist = [m - s for m, s in zip(macd_line, signal_line)]
    return macd_line, signal_line, hist


def _slope(values: list[float]) -> float:
    """Least-squares slope of values against their index. 0 if fewer than 2 points."""
    n = len(values)
    if n < 2:
        return 0.0
    xs = list(range(n))
    mx = _mean(xs)
    my = _mean(values)
    denom = sum((x - mx) ** 2 for x in xs)
    if denom == 0:
        return 0.0
    return sum((xs[i] - mx) * (values[i] - my) for i in range(n)) / denom


def _low_result(symbol: str, bars: int, reason: str) -> MultifactorAnalysis:
    return MultifactorAnalysis(
        symbol=symbol,
        analyzed_at=datetime.utcnow().isoformat(),
        total_score=0,
        signal="WATCH",
        confidence="LOW",
        factors_agreed=0,
        trend_score=0, momentum_score=0, volume_score=0, position_score=0,
        trend_reason=reason, momentum_reason=reason,
        volume_reason=reason, position_reason=reason,
        current_price=None, support=None, resistance=None,
        entry_price=None, stop_loss=None,
        description=reason, bars_analyzed=bars,
    )
