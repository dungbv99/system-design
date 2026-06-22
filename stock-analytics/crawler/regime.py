"""
VNIndex regime detection — UPTREND / DOWNTREND / SIDEWAYS.

The single most important module for capital preservation: getting out during a
2022-style downtrend is what makes the 0% annual-return floor possible.

A regime switch requires three layers to agree (trend / momentum / breadth), and
a switch *into* DOWNTREND or *back into* UPTREND additionally needs Wyckoff /
drawdown confirmation so the model doesn't whipsaw on noise.

Pure Python stdlib — reuses the math helpers from ``wyckoff`` (one
implementation of each).  See README_WYCKOFF_OPTIMIZED.md §4.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import wyckoff as _wy
from wyckoff import _f, _macd, _r, _sma
from wyckoff_opt import merge_params

UPTREND   = "UPTREND"
DOWNTREND = "DOWNTREND"
SIDEWAYS  = "SIDEWAYS"


@dataclass
class RegimeResult:
    date:                  str
    regime:                str
    vnindex_close:         Optional[float]
    ma20:                  Optional[float]
    ma50:                  Optional[float]
    ma200:                 Optional[float]
    macd_hist:             Optional[float]
    drawdown_from_60d_high: Optional[float]
    wyckoff_phase:         Optional[str]
    confirmed:             bool


# ── Core classification on a slice of bars ────────────────────────────────────

def _classify(bars: list[dict], params: dict, with_wyckoff: bool = True) -> RegimeResult:
    """Classify the regime as of the LAST bar in ``bars`` (no look-ahead).

    ``bars`` must be oldest→newest and end on the date being classified.
    """
    closes = [_f(b.get("close")) for b in bars]
    n = len(closes)
    date_str = str(bars[-1].get("date", "")) if bars else ""

    if n < 60:
        return RegimeResult(date_str, SIDEWAYS, closes[-1] if closes else None,
                            None, None, None, None, None, None, False)

    fast = params["regime_ma_fast"]   # nominal 50
    slow = params["regime_ma_slow"]   # nominal 200
    ma20  = _sma(closes, 20)[-1]
    ma_f  = _sma(closes, min(fast, n))[-1]
    ma_s  = _sma(closes, min(slow, n))[-1]
    close = closes[-1]
    _, _, hist = _macd(closes)
    macd_hist = hist[-1] if hist else 0.0
    macd_prev = hist[-2] if len(hist) > 1 else macd_hist

    # 60-day drawdown from the rolling high
    high60 = max(closes[-60:])
    drawdown = (high60 - close) / high60 if high60 > 0 else 0.0

    # Layer 1 — trend (MA alignment)
    if ma_f > ma_s and ma20 > ma_f:
        trend = 1
    elif ma_f < ma_s and ma20 < ma_f:
        trend = -1
    else:
        trend = 0

    # Layer 2 — momentum (MACD histogram + slope)
    if macd_hist > 0 and macd_hist >= macd_prev:
        mom = 1
    elif macd_hist < 0 and macd_hist <= macd_prev:
        mom = -1
    else:
        mom = 0

    # Layer 3 — breadth proxy (close vs MAs)
    if close > ma20 > ma_f:
        breadth = 1
    elif close < ma20 < ma_f:
        breadth = -1
    else:
        breadth = 0

    layers = trend + mom + breadth
    if trend == 1 and mom == 1 and breadth == 1:
        regime = UPTREND
    elif layers <= -2:          # 2 of 3 layers bearish — catch downtrends EARLIER
        regime = DOWNTREND      # (2022 only triggered on all-3, i.e. far too late)
    else:
        regime = SIDEWAYS

    # Wyckoff phase on VNIndex itself (used for confirmation)
    phase = None
    if with_wyckoff:
        try:
            phase = _wy.analyze("VNINDEX", bars, lookback=params["lookback"]).phase
        except Exception:  # noqa: BLE001
            phase = None

    # ── Confirmation gates (§4.2) ─────────────────────────────────────────────
    confirmed = True
    if regime == DOWNTREND:
        below_ma200_3d = (n >= 3 and ma_s > 0
                          and all(closes[-k] < _sma(closes[:n - k + 1], min(slow, n - k + 1))[-1]
                                  for k in range(1, 4)))
        confirmed = (
            (phase == "Distribution")
            or drawdown > params["downtrend_drawdown_pct"]
            or below_ma200_3d
        )
        if not confirmed:
            regime = SIDEWAYS
    elif regime == UPTREND:
        above_ma50_5d = all(closes[-k] > _sma(closes[:n - k + 1], min(fast, n - k + 1))[-1]
                            for k in range(1, 6)) if n >= 5 else False
        confirmed = (phase == "Accumulation") or above_ma50_5d
        if not confirmed:
            regime = SIDEWAYS

    return RegimeResult(
        date=date_str, regime=regime,
        vnindex_close=_r(close), ma20=_r(ma20), ma50=_r(ma_f), ma200=_r(ma_s),
        macd_hist=_r(macd_hist), drawdown_from_60d_high=round(drawdown, 4),
        wyckoff_phase=phase, confirmed=confirmed,
    )


# ── Public API ────────────────────────────────────────────────────────────────

def detect_regime_today(vnindex_bars: list[dict], params: Optional[dict] = None) -> RegimeResult:
    """Classify today's regime from the full VNIndex history."""
    return _classify(vnindex_bars, merge_params(params), with_wyckoff=True)


def detect_regime_on_date(vnindex_bars: list[dict], date_idx: int,
                          params: Optional[dict] = None) -> str:
    """Regime label at a historical bar index (for the backtest loop).

    Uses bars up to AND INCLUDING ``date_idx`` only — no look-ahead.  Wyckoff
    confirmation is skipped here for speed (the backtest calls this on every
    date × symbol); the MA/MACD/drawdown gates still apply.
    """
    if date_idx < 0:
        return SIDEWAYS
    window = vnindex_bars[:date_idx + 1]
    return _classify(window, merge_params(params), with_wyckoff=False).regime


def get_regime_series(vnindex_bars: list[dict], params: Optional[dict] = None) -> list[dict]:
    """Regime for every date in ``vnindex_bars`` (used in backtest setup).

    Computed incrementally; cheap MA/MACD-only classification (no per-date
    Wyckoff) so it stays fast over ~2500 bars.
    """
    p = merge_params(params)
    out: list[dict] = []
    for i in range(len(vnindex_bars)):
        r = _classify(vnindex_bars[:i + 1], p, with_wyckoff=False)
        out.append({"date": r.date, "regime": r.regime,
                    "vnindex": r.vnindex_close, "drawdown": r.drawdown_from_60d_high})
    return out
