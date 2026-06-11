"""
Wyckoff Method analysis engine.

Detects Wyckoff phases and key events from OHLCV data:
  Accumulation A→E : SC → AR/ST → Spring/Test → SOS → LPS → Markup
  Distribution A→E : BC → AR/ST → UT/UTAD → LPSY → Markdown

Signal output: BUY | SHORT | WAIT | HOLD  ×  STRONG | MODERATE | WEAK

VSA labels (in-memory, not persisted):
  demand | supply | absorption | no_supply | no_demand | normal
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
import statistics


# ── Risk management ───────────────────────────────────────────────────────────

# Minimum reward/risk ratio required to take a BUY.
#   reward = target − entry,  risk = entry − stop
#   e.g. entry 10, target 13, stop 8 → (13−10)/(10−8) = 1.5  (accepted)
# A BUY whose setup falls below this is downgraded to WAIT.
MIN_RR_RATIO = 1.5


# ── Public types ──────────────────────────────────────────────────────────────

@dataclass
class WyckoffEvent:
    event_type: str   # SC|AR|ST|Spring|Test|SOS|LPS|BC|UT|UTAD|LPSY
    date: str
    price: float
    volume: int
    description: str


@dataclass
class WyckoffAnalysis:
    symbol: str
    analyzed_at: str
    phase: str            # Accumulation|Distribution|Markup|Markdown|Unknown
    sub_phase: str        # A|B|C|D|E|-
    signal: str           # BUY|SHORT|WAIT|HOLD
    signal_strength: str  # STRONG|MODERATE|WEAK
    support: Optional[float]
    resistance: Optional[float]
    current_price: Optional[float]
    last_event: Optional[str]
    entry_price: Optional[float]
    stop_loss: Optional[float]
    target: Optional[float]          # take-profit level used for the R:R gate
    rr_ratio: Optional[float]        # reward/risk = (target−entry)/(entry−stop)
    events: list[WyckoffEvent] = field(default_factory=list)
    description: str = ""
    bars_analyzed: int = 0
    vsa_labels: list[str] = field(default_factory=list)  # one label per bar, in-memory only


# ── Main entry point ──────────────────────────────────────────────────────────

def analyze(symbol: str, bars: list[dict], lookback: int = 260) -> WyckoffAnalysis:
    """
    Analyze OHLCV bars and return Wyckoff phase + signal.

    bars    — list of {date, open, high, low, close, volume} ordered oldest→newest.
    lookback — number of recent bars to use (default ≈ 1 year of daily data).
    """
    if not bars or len(bars) < 30:
        return _empty(symbol, "Insufficient data (need ≥ 30 bars)")

    window = bars[-lookback:]
    n = len(window)

    dates   = [str(b.get("date", ""))              for b in window]
    opens_  = [_f(b.get("open"))                   for b in window]
    highs   = [_f(b.get("high"))                   for b in window]
    lows    = [_f(b.get("low"))                    for b in window]
    closes  = [_f(b.get("close"))                  for b in window]
    volumes = [max(0, int(b.get("volume") or 0))   for b in window]

    if not any(c > 0 for c in closes):
        return _empty(symbol, "No valid price data")

    avg_vol    = _mean(v for v in volumes if v > 0) or 1
    avg_spread = _mean(
        abs(closes[i] - opens_[i])
        for i in range(n) if closes[i] > 0 and opens_[i] > 0
    ) or 0.001
    avg_hl_spread = _mean(
        highs[i] - lows[i]
        for i in range(n) if highs[i] > lows[i]
    ) or 0.001

    ma20  = _sma(closes, 20)
    ma50  = _sma(closes, 50)
    ma200 = _sma(closes, min(200, n))
    rsi   = _rsi(closes, 14)

    current_price   = closes[-1]
    overall_uptrend = (ma50[-1] > ma200[-1]) if (ma50 and ma200) else True

    rsi_cur  = rsi[-1]  if rsi  else 50.0
    rsi_prev = rsi[-2]  if len(rsi) > 1 else rsi_cur

    support, resistance = _detect_range(highs, lows, n)
    events = _detect_events(
        dates, opens_, highs, lows, closes, volumes,
        support, resistance, avg_vol, avg_spread, n,
    )
    phase, sub_phase = _classify_phase(
        events, closes, support, resistance,
        current_price, overall_uptrend,
    )
    ma20_cur = ma20[-1] if ma20 else current_price
    signal, strength, description = _generate_signal(
        phase, sub_phase, events,
        current_price, support, resistance, ma20_cur,
        rsi_cur, rsi_prev,
    )
    entry_price, stop_loss = _compute_entry_stop(
        phase, sub_phase, events, support, resistance,
    )

    # ── Reward/risk gate ──────────────────────────────────────────────────────
    # For a BUY the take-profit is the range top (resistance). Only keep the BUY
    # if (target−entry)/(entry−stop) ≥ MIN_RR_RATIO; otherwise downgrade to WAIT.
    target   = resistance if signal == "BUY" else None
    rr_ratio = _reward_risk(entry_price, stop_loss, target)
    if signal == "BUY" and (rr_ratio is None or rr_ratio < MIN_RR_RATIO):
        rr_txt = f"{rr_ratio:.2f}" if rr_ratio is not None else "n/a"
        description = (
            f"BUY skipped — reward/risk {rr_txt} < {MIN_RR_RATIO:.1f} "
            f"(entry {_r(entry_price)}, stop {_r(stop_loss)}, target {_r(target)}). "
            + description
        )
        signal, strength = "WAIT", "WEAK"

    vsa_labels = classify_vsa_bars(highs, lows, closes, volumes, avg_vol, avg_hl_spread)

    return WyckoffAnalysis(
        symbol=symbol,
        analyzed_at=datetime.utcnow().isoformat(),
        phase=phase,
        sub_phase=sub_phase,
        signal=signal,
        signal_strength=strength,
        support=_r(support),
        resistance=_r(resistance),
        current_price=_r(current_price),
        last_event=events[-1].event_type if events else None,
        entry_price=_r(entry_price),
        stop_loss=_r(stop_loss),
        target=_r(target),
        rr_ratio=round(rr_ratio, 2) if rr_ratio is not None else None,
        events=events,
        description=description,
        bars_analyzed=n,
        vsa_labels=vsa_labels,
    )


# ── VSA bar classification ────────────────────────────────────────────────────

def classify_vsa_bars(
    highs: list[float],
    lows: list[float],
    closes: list[float],
    volumes: list[int],
    avg_vol: float,
    avg_hl_spread: float,
) -> list[str]:
    """
    Label each bar with a VSA bar type:
      demand     — high vol, wide spread, close in upper 60%  → buyers in control
      supply     — high vol, wide spread, close in lower 40%  → sellers in control
      absorption — very high vol, narrow spread               → supply being absorbed
      no_supply  — low vol, narrow spread, close in upper 50% → no selling pressure
      no_demand  — low vol, narrow spread, close in lower 50% → no buying interest
      normal     — anything else
    """
    labels: list[str] = []
    for i in range(len(closes)):
        h, l, c, v = highs[i], lows[i], closes[i], volumes[i]
        hl = h - l if h > l else 0.001
        rel_vol    = v / avg_vol        if avg_vol > 0        else 0.0
        rel_spread = hl / avg_hl_spread if avg_hl_spread > 0  else 0.0
        close_pos  = (c - l) / hl      if hl > 0             else 0.5

        if rel_vol > 2.0 and rel_spread < 0.7:
            labels.append("absorption")
        elif rel_vol > 1.8 and rel_spread > 1.5 and close_pos > 0.6:
            labels.append("demand")
        elif rel_vol > 1.8 and rel_spread > 1.5 and close_pos < 0.4:
            labels.append("supply")
        elif rel_vol < 0.5 and rel_spread < 0.7 and close_pos > 0.5:
            labels.append("no_supply")
        elif rel_vol < 0.5 and rel_spread < 0.7 and close_pos < 0.5:
            labels.append("no_demand")
        else:
            labels.append("normal")
    return labels


# ── Range detection ───────────────────────────────────────────────────────────

def _detect_range(
    highs: list[float], lows: list[float], n: int,
    range_bars: int = 120, pivot: int = 3,
) -> tuple[float, float]:
    """
    Find horizontal support/resistance using swing pivots.
    Falls back to percentile levels when pivots are scarce.
    """
    start = max(0, n - range_bars)
    h = highs[start:]
    l = lows[start:]
    m = len(h)

    sh: list[float] = []
    sl: list[float] = []
    for i in range(pivot, m - pivot):
        if h[i] > 0 and h[i] >= max(h[i - pivot : i + pivot + 1]):
            sh.append(h[i])
        if l[i] > 0 and l[i] <= min(l[i - pivot : i + pivot + 1]):
            sl.append(l[i])

    if len(sl) >= 2:
        sl_sorted = sorted(sl)
        support = statistics.median(sl_sorted[: max(1, len(sl_sorted) // 2)])
    else:
        valid_l = [x for x in l if x > 0]
        support = _percentile(valid_l, 10) if valid_l else min(x for x in lows if x > 0)

    if len(sh) >= 2:
        sh_sorted = sorted(sh, reverse=True)
        resistance = statistics.median(sh_sorted[: max(1, len(sh_sorted) // 2)])
    else:
        valid_h = [x for x in h if x > 0]
        resistance = _percentile(valid_h, 90) if valid_h else max(highs)

    if support >= resistance:
        support = resistance * 0.95

    return support, resistance


# ── Event detection ───────────────────────────────────────────────────────────

def _detect_events(
    dates: list[str],
    opens_: list[float],
    highs: list[float],
    lows: list[float],
    closes: list[float],
    volumes: list[int],
    support: float,
    resistance: float,
    avg_vol: float,
    avg_spread: float,
    n: int,
) -> list[WyckoffEvent]:
    """
    Single-pass event detector.  Uses an elif chain so at most one event is
    assigned per bar (matching Wyckoff's principle of one dominant signal per
    session).  The order of checks mirrors the Wyckoff phase sequence.
    """
    events: list[WyckoffEvent] = []

    climax_vol = avg_vol * 2.0
    hi_vol     = avg_vol * 1.4
    lo_vol     = avg_vol * 0.7
    midpoint   = (support + resistance) / 2

    # Track bar-index of most recent occurrence per event type (-1 = unseen).
    idx: dict[str, int] = {t: -1 for t in
        ["SC", "AR", "ST", "Spring", "Test", "SOS", "LPS",
         "BC", "UT", "UTAD", "LPSY"]}

    def seen(t: str) -> bool:
        return idx[t] >= 0

    def bars_since(t: str, i: int) -> int:
        return i - idx[t] if idx[t] >= 0 else 9999

    def accum() -> bool:
        return seen("SC") and not seen("BC")

    def distr() -> bool:
        return seen("BC") and not seen("SC")

    def add(etype: str, i: int, desc: str) -> None:
        idx[etype] = i
        price = closes[i] if closes[i] > 0 else lows[i]
        events.append(WyckoffEvent(etype, dates[i], _r(price), volumes[i], desc))

    for i in range(5, n):
        c   = closes[i]
        h   = highs[i]
        l   = lows[i]
        o   = opens_[i]
        vol = volumes[i]
        sp  = abs(c - o)

        if c <= 0:
            continue

        down  = c < o
        up    = c > o
        prev5 = _mean(closes[max(0, i - 5) : i]) or c

        # ── Selling Climax ────────────────────────────────────────────────────
        if (not seen("SC") and not seen("BC")
                and down
                and vol >= climax_vol
                and sp >= avg_spread * 1.5
                and l <= support * 1.05
                and c < prev5):
            add("SC", i,
                f"Selling Climax — panic vol {vol:,}, "
                f"near support {support:.2f}")

        # ── Buying Climax ─────────────────────────────────────────────────────
        elif (not seen("BC") and not seen("SC")
                and up
                and vol >= climax_vol
                and sp >= avg_spread * 1.5
                and h >= resistance * 0.95
                and c > prev5):
            add("BC", i,
                f"Buying Climax — euphoric vol {vol:,}, "
                f"near resistance {resistance:.2f}")

        # ── Automatic Rally (after SC) ────────────────────────────────────────
        elif (accum()
                and not seen("AR")
                and 1 <= bars_since("SC", i) <= 15
                and up
                and c > closes[idx["SC"]] * 1.01):
            add("AR", i,
                f"Automatic Rally — bounce after SC, "
                f"defines range top ~{h:.2f}")

        # ── Secondary Test ────────────────────────────────────────────────────
        elif (accum()
                and seen("AR") and not seen("Spring")
                and down
                and l <= support * 1.07
                and vol < volumes[idx["SC"]] * 0.85
                and bars_since("AR", i) >= 3
                and bars_since("ST", i) >= 5):
            add("ST", i,
                f"Secondary Test — re-tests SC area on lower vol {vol:,}")

        # ── Spring ────────────────────────────────────────────────────────────
        elif (accum()
                and not seen("Spring")
                and bars_since("SC", i) >= 5
                and l < support               # dips below support
                and c >= support * 0.98       # recovers near/above support
                and vol < climax_vol):
            add("Spring", i,
                f"Spring — low {l:.2f} breaks support {support:.2f}, "
                f"closes back at {c:.2f}")

        # ── Test of Spring ────────────────────────────────────────────────────
        elif (accum()
                and seen("Spring") and not seen("SOS")
                and 1 <= bars_since("Spring", i) <= 10
                and down
                and l >= closes[idx["Spring"]] * 0.98
                and vol < volumes[idx["Spring"]]):
            add("Test", i,
                f"Test of Spring — holds above spring low on low vol {vol:,}")

        # ── Sign of Strength ──────────────────────────────────────────────────
        elif (accum()
                and seen("Spring") and not seen("SOS")
                and up
                and c >= midpoint
                and vol >= hi_vol
                and sp >= avg_spread * 0.8):
            add("SOS", i,
                f"Sign of Strength — rally through midpoint {midpoint:.2f} "
                f"on vol {vol:,}")

        # ── Last Point of Support ─────────────────────────────────────────────
        elif (accum()
                and seen("SOS") and not seen("LPS")
                and bars_since("SOS", i) <= 20
                and down
                and vol <= lo_vol
                and c > support
                and sp < avg_spread * 1.3):
            add("LPS", i,
                f"Last Point of Support — low-vol pullback {vol:,} "
                f"after SOS, ideal buy entry")

        # ── Upthrust ─────────────────────────────────────────────────────────
        elif (distr()
                and not seen("UT")
                and h > resistance * 1.01
                and c < resistance
                and vol < climax_vol):
            add("UT", i,
                f"Upthrust — breaks {resistance:.2f} but reverses to {c:.2f}, "
                f"bull trap")

        # ── Upthrust After Distribution ───────────────────────────────────────
        elif (distr()
                and seen("UT") and not seen("UTAD")
                and h > resistance * 1.01
                and c < resistance):
            add("UTAD", i,
                f"UTAD — second upthrust above {resistance:.2f}, "
                f"confirms distribution")

        # ── Last Point of Supply ──────────────────────────────────────────────
        elif (distr()
                and (seen("UT") or seen("UTAD"))
                and not seen("LPSY")
                and up
                and vol <= lo_vol
                and sp < avg_spread
                and c < resistance):
            add("LPSY", i,
                f"Last Point of Supply — weak vol {vol:,}, "
                f"markdown imminent")

    return events


# ── Phase classification ──────────────────────────────────────────────────────

def _classify_phase(
    events: list[WyckoffEvent],
    closes: list[float],
    support: float,
    resistance: float,
    current_price: float,
    overall_uptrend: bool,
) -> tuple[str, str]:
    etypes = {e.event_type for e in events}
    has = lambda t: t in etypes

    rng = resistance - support if resistance > support else 0
    above = current_price > resistance + rng * 0.08
    below = current_price < support  - rng * 0.08

    if above and overall_uptrend:
        return "Markup", "E"
    if below and not overall_uptrend:
        return "Markdown", "-"

    if has("SC"):
        if has("LPS") or has("SOS"):
            return "Accumulation", "D"
        if has("Spring") or has("Test"):
            return "Accumulation", "C"
        if has("AR") and has("ST"):
            return "Accumulation", "B"
        return "Accumulation", "A"

    if has("BC"):
        if has("LPSY"):
            return "Distribution", "D"
        if has("UT") or has("UTAD"):
            return "Distribution", "C"
        if has("ST"):
            return "Distribution", "B"
        return "Distribution", "A"

    return ("Markup", "-") if overall_uptrend else ("Markdown", "-")


# ── Signal generation ─────────────────────────────────────────────────────────

def _generate_signal(
    phase: str,
    sub_phase: str,
    events: list[WyckoffEvent],
    current_price: float,
    support: float,
    resistance: float,
    ma20: float,
    rsi_cur: float = 50.0,
    rsi_prev: float = 50.0,
) -> tuple[str, str, str]:
    """
    Map phase + sub-phase + events to (signal, strength, description).

    RSI(14) filter applied to STRONG signals:
      BUY  STRONG : requires RSI < 50 and rising  (rsi_cur > rsi_prev)
      SHORT STRONG: requires RSI > 50 and falling (rsi_cur < rsi_prev)
    If the RSI condition is not met the signal strength is downgraded to MODERATE.
    """
    etypes = {e.event_type for e in events}
    has = lambda t: t in etypes

    rsi_buy_ok   = rsi_cur < 50 and rsi_cur > rsi_prev
    rsi_short_ok = rsi_cur > 50 and rsi_cur < rsi_prev

    if phase == "Accumulation":
        if sub_phase == "D":
            if has("LPS"):
                desc = (
                    f"Phase D — LPS confirmed after SOS. Ideal buy entry here. "
                    f"Stop loss below LPS low (~{support:.2f}). "
                    f"Target breakout above resistance {resistance:.2f}."
                )
                strength = "STRONG" if rsi_buy_ok else "MODERATE"
                return ("BUY", strength, desc)
            desc = (
                f"Phase D — SOS confirmed, markup likely. "
                f"Buy on pullbacks that hold above {support:.2f}. "
                f"Target {resistance:.2f}+."
            )
            return ("BUY", "MODERATE", desc)

        if sub_phase == "C":
            if has("Test"):
                desc = (
                    f"Phase C — Spring + Test confirmed. High-probability entry. "
                    f"Buy near {support:.2f}, stop just below Spring low. "
                    f"Wait for SOS to confirm full markup."
                )
                strength = "STRONG" if rsi_buy_ok else "MODERATE"
                return ("BUY", strength, desc)
            if has("Spring"):
                return ("BUY", "MODERATE",
                    f"Phase C — Spring detected. Entry possible, "
                    f"stop just below {support:.2f}. "
                    f"Confirm with high-volume SOS before adding size.")

        return ("WAIT", "WEAK",
            f"Accumulation Phase {sub_phase} — range building. "
            f"Monitor support {support:.2f}. "
            f"Wait for Spring (Phase C) for best risk/reward entry.")

    if phase == "Distribution":
        if sub_phase == "D" and has("LPSY"):
            desc = (
                f"Phase D — LPSY confirmed, markdown imminent. "
                f"Short here, stop above {resistance:.2f}. "
                f"Target {support:.2f}."
            )
            strength = "STRONG" if rsi_short_ok else "MODERATE"
            return ("SHORT", strength, desc)
        if sub_phase == "C":
            if has("UTAD"):
                desc = (
                    f"Phase C — UTAD confirmed (second upthrust). "
                    f"Strong short signal. Stop above {resistance:.2f}."
                )
                strength = "STRONG" if rsi_short_ok else "MODERATE"
                return ("SHORT", strength, desc)
            if has("UT"):
                return ("SHORT", "MODERATE",
                    f"Phase C — Upthrust detected. "
                    f"Short near current price, stop above {resistance:.2f}. "
                    f"Target {support:.2f}.")

        return ("WAIT", "WEAK",
            f"Distribution Phase {sub_phase} — watch for Upthrust (Phase C) "
            f"for optimal short/exit entry. Avoid new longs near {resistance:.2f}.")

    if phase == "Markup":
        if current_price >= ma20:
            return ("HOLD", "MODERATE",
                f"Markup — uptrend intact, price above MA20 ({ma20:.2f}). "
                f"Hold longs, buy dips to MA20. "
                f"Watch for distribution near {resistance:.2f}.")
        return ("WAIT", "WEAK",
            f"Markup but price below MA20 ({ma20:.2f}). "
            f"Possible distribution forming. Observe before adding.")

    if phase == "Markdown":
        return ("WAIT", "WEAK",
            f"Markdown — avoid longs. "
            f"Watch for Selling Climax near {support:.2f} to signal exhaustion.")

    return ("WAIT", "WEAK",
        f"No clear Wyckoff phase. Price {current_price:.2f} in range "
        f"{support:.2f}–{resistance:.2f}. Need more price/volume evidence.")


# ── Entry / stop-loss computation ────────────────────────────────────────────

def _compute_entry_stop(
    phase: str,
    sub_phase: str,
    events: list[WyckoffEvent],
    support: float,
    resistance: float,
) -> tuple[Optional[float], Optional[float]]:
    """
    Return (entry_price, stop_loss) for actionable signals.

    Accumulation BUY:
      Phase C — Test : entry = Test close  | stop = Spring low × 0.97
      Phase C — Spring only : entry = Spring close | stop = Spring low × 0.97
      Phase D — LPS  : entry = LPS close   | stop = Spring low × 0.97
      Phase D — SOS  : entry = midpoint    | stop = support × 0.97

    Distribution SHORT:
      Phase C — UTAD : entry = UTAD close  | stop = resistance × 1.02
      Phase C — UT   : entry = UT close    | stop = resistance × 1.02
      Phase D — LPSY : entry = LPSY close  | stop = resistance × 1.02
    """
    def last(etype: str) -> Optional[WyckoffEvent]:
        for e in reversed(events):
            if e.event_type == etype:
                return e
        return None

    midpoint = (support + resistance) / 2

    spring = last("Spring")
    test   = last("Test")
    lps    = last("LPS")
    sos    = last("SOS")
    ut     = last("UTAD") or last("UT")
    lpsy   = last("LPSY")

    spring_stop = spring.price * 0.97 if spring else support * 0.97

    if phase == "Accumulation":
        if sub_phase == "D":
            if lps:
                return lps.price, spring_stop
            if sos:
                return round(midpoint, 2), round(support * 0.97, 2)
        if sub_phase == "C":
            if test:
                return test.price, spring_stop
            if spring:
                return spring.price, round(spring.price * 0.97, 2)

    if phase == "Distribution":
        stop = round(resistance * 1.02, 2)
        if lpsy:
            return lpsy.price, stop
        if ut:
            return ut.price, stop

    return None, None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _reward_risk(
    entry: Optional[float],
    stop:  Optional[float],
    target: Optional[float],
) -> Optional[float]:
    """Long reward/risk ratio = (target − entry) / (entry − stop).

    Returns None when any level is missing or the geometry is invalid
    (stop ≥ entry, or target ≤ entry → no measurable upside).
    """
    if not entry or not stop or not target:
        return None
    risk   = entry - stop
    reward = target - entry
    if risk <= 0 or reward <= 0:
        return None
    return reward / risk


def _f(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _r(v: Optional[float]) -> Optional[float]:
    return round(v, 2) if v is not None else None


def _mean(iterable) -> float:
    items = list(iterable)
    return statistics.mean(items) if items else 0.0


def _sma(values: list[float], period: int) -> list[float]:
    result = []
    for i in range(len(values)):
        if i < period - 1:
            result.append(0.0)
        else:
            result.append(_mean(values[i - period + 1 : i + 1]))
    return result


def _rsi(closes: list[float], period: int = 14) -> list[float]:
    """Wilder-smoothed RSI. Returns 50.0 for bars before the warm-up period."""
    n = len(closes)
    result = [50.0] * n
    if n < period + 1:
        return result

    gains  = [0.0] * n
    losses = [0.0] * n
    for i in range(1, n):
        diff = closes[i] - closes[i - 1]
        if diff > 0:
            gains[i] = diff
        else:
            losses[i] = -diff

    ag = sum(gains[1 : period + 1])  / period
    al = sum(losses[1 : period + 1]) / period

    for i in range(period, n):
        if i > period:
            ag = (ag * (period - 1) + gains[i])  / period
            al = (al * (period - 1) + losses[i]) / period
        result[i] = 100.0 - (100.0 / (1.0 + ag / al)) if al > 0 else 100.0

    return result


def _percentile(values: list[float], pct: int) -> float:
    if not values:
        return 0.0
    sorted_v = sorted(values)
    k = (len(sorted_v) - 1) * pct / 100
    lo, hi = int(k), min(int(k) + 1, len(sorted_v) - 1)
    return sorted_v[lo] + (sorted_v[hi] - sorted_v[lo]) * (k - lo)


def _empty(symbol: str, reason: str) -> WyckoffAnalysis:
    return WyckoffAnalysis(
        symbol=symbol,
        analyzed_at=datetime.utcnow().isoformat(),
        phase="Unknown",
        sub_phase="-",
        signal="WAIT",
        signal_strength="WEAK",
        support=None,
        resistance=None,
        current_price=None,
        last_event=None,
        entry_price=None,
        stop_loss=None,
        target=None,
        rr_ratio=None,
        events=[],
        description=reason,
        bars_analyzed=0,
        vsa_labels=[],
    )
