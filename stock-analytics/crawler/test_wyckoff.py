"""
Unit tests for crawler/wyckoff.py.

Covers:
  1. analyze() returns Unknown/WAIT when bars < 30
  2. A synthetic accumulation sequence (SC → AR → ST → Spring → Test → SOS → LPS)
     produces phase=Accumulation, sub_phase=D, signal=BUY
  3. A synthetic distribution sequence (BC → UT → UTAD → LPSY)
     produces phase=Distribution, sub_phase=D, signal=SHORT
  4. _detect_range() returns support < resistance for a variety of inputs
  5. VSA bar classification and the ST de-duplication guard

Synthetic bars are plain Python dicts — no database or network needed.

Run with:  pytest crawler/test_wyckoff.py
       or:  python crawler/test_wyckoff.py   (built-in fallback runner)
"""

from __future__ import annotations

import datetime

import wyckoff
from wyckoff import analyze, classify_vsa_bars, _detect_range

# Neutral baseline volume. Large enough that close (~100) × volume clears the
# 5B-VND liquidity gate — event detection itself only uses volume relative to
# the average, so the absolute scale is free to pick.
NV = 100_000_000


# ── Synthetic data builders ───────────────────────────────────────────────────

def _bar(d, o, h, l, c, v):
    return {"date": str(d), "open": o, "high": h, "low": l, "close": c, "volume": int(v)}


def build_accumulation() -> list[dict]:
    """SC → AR → ST → Spring → Test → SOS → LPS  in a 99–105 range."""
    bars: list[dict] = []
    d = datetime.date(2024, 1, 1)

    def push(o, h, l, c, v):
        nonlocal d
        bars.append(_bar(d, o, h, l, c, v))
        d += datetime.timedelta(days=1)

    p = 105.0
    for _ in range(12):                              # gentle downtrend with pivots
        o = p; p -= 0.4; push(o, o + 0.6, p - 0.3, p, NV)
        o = p; p += 0.2; push(o, o + 0.5, o - 0.5, p, NV)
    push(p, p + 0.2, 99.0, 99.5, NV * 5)             # SC — climax volume, near support
    p = 99.5
    for _ in range(5):                               # AR — automatic rally
        o = p; p += 1.0; push(o, p + 0.5, o - 0.3, p, NV * 1.5)
    for _ in range(3):                               # range, support touches ~99.7
        o = p; push(o, o + 0.6, 99.7, 100.0, NV * 0.7); p = 100.0
        o = p; p += 1.5; push(o, p + 0.4, o - 0.3, p, NV * 0.8)
    push(p, p + 0.2, 99.8, 100.2, NV * 0.5)          # ST — low-vol secondary test
    p = 100.2
    for _ in range(4):
        o = p; p += 0.4; push(o, o + 0.5, o - 0.4, p, NV * 0.7)
    push(98.0, 100.6, 95.0, 100.3, NV * 1.2)         # Spring — pierce 95, recover
    p = 100.3
    for _ in range(3):                               # Test — holds above spring low
        o = p; c = p - 0.1; push(o, o + 0.2, o - 0.5, c, NV * 0.5); p = c
    for _ in range(3):                               # SOS — strong rally on volume
        o = p; p += 1.0; push(o, p + 0.5, o - 0.2, p, NV * 2)
    for _ in range(2):                               # reaction toward support, normal vol
        o = p; p -= 1.35; push(o, o + 0.3, p - 0.3, p, NV * 1.1)
    push(p, p + 0.2, p - 0.6, p - 0.4, NV * 0.45)    # LPS — low-vol pullback near support
    return bars


def build_distribution() -> list[dict]:
    """BC → UT → UTAD → LPSY  in a 105–110 range."""
    bars: list[dict] = []
    d = datetime.date(2024, 1, 1)

    def push(o, h, l, c, v):
        nonlocal d
        bars.append(_bar(d, o, h, l, c, v))
        d += datetime.timedelta(days=1)

    p = 100.0
    for _ in range(10):                              # uptrend with pivots
        o = p; p += 0.5; push(o, p + 0.3, o - 0.6, p, NV)
        o = p; p -= 0.25; push(o, o + 0.5, o - 0.5, p, NV)
    push(106.0, 110.2, 105.8, 109.5, NV * 5)         # BC — wide climax up-bar
    p = 109.5
    for _ in range(4):                               # reaction down
        o = p; p -= 0.8; push(o, o + 0.3, p - 0.4, p, NV * 1.5)
    for _ in range(6):                               # range, swing highs ~108.2
        o = p; p += 2.0; push(o, 108.2, o - 0.3, 108.0, NV * 0.8); p = 108.0
        o = p; p -= 2.0; push(o, o + 0.4, p - 0.3, p, NV * 0.7)
    push(108.0, 113.0, 107.8, 108.3, NV * 1.3)       # UT — first upthrust
    p = 108.3
    for _ in range(4):
        o = p; p -= 0.3; push(o, o + 0.4, p - 0.3, p, NV * 0.7)
    push(p, 113.2, p - 0.3, 108.2, NV * 1.2)         # UTAD — second upthrust
    push(107.9, 108.3, 107.7, 108.1, NV * 0.4)       # LPSY — weak low-vol rally
    return bars


# ── 1. Insufficient data ──────────────────────────────────────────────────────

def test_insufficient_data_returns_unknown_wait():
    bars = [_bar(datetime.date(2024, 1, 1) + datetime.timedelta(days=i),
                 100, 101, 99, 100, NV) for i in range(10)]
    r = analyze("TINY", bars)
    assert r.phase == "Unknown"
    assert r.signal == "WAIT"
    assert r.signal_strength == "WEAK"
    assert r.bars_analyzed == 0


def test_empty_bars_returns_unknown():
    r = analyze("EMPTY", [])
    assert r.phase == "Unknown"
    assert r.signal == "WAIT"


# ── 2. Accumulation chain ─────────────────────────────────────────────────────

def test_accumulation_sequence_produces_buy():
    r = analyze("ACC", build_accumulation())
    etypes = [e.event_type for e in r.events]

    # full Wyckoff accumulation chain detected
    for expected in ("SC", "AR", "ST", "Spring", "Test", "SOS", "LPS"):
        assert expected in etypes, f"missing {expected} in {etypes}"

    assert r.phase == "Accumulation"
    assert r.sub_phase == "D"
    assert r.signal == "BUY"
    assert r.support is not None and r.resistance is not None
    assert r.support < r.resistance
    # an actionable BUY must carry an entry and a protective stop below it
    assert r.entry_price is not None and r.stop_loss is not None
    assert r.stop_loss < r.entry_price
    # the BUY survived the R:R gate, so the stored ratio must clear the minimum
    assert r.rr_ratio is not None and r.rr_ratio >= wyckoff.MIN_RR_RATIO


# ── 3. Distribution chain ─────────────────────────────────────────────────────

def test_distribution_sequence_produces_short():
    r = analyze("DIS", build_distribution())
    etypes = [e.event_type for e in r.events]

    for expected in ("BC", "UT", "UTAD", "LPSY"):
        assert expected in etypes, f"missing {expected} in {etypes}"

    assert r.phase == "Distribution"
    assert r.sub_phase == "D"
    assert r.signal == "SHORT"
    assert r.entry_price is not None and r.stop_loss is not None
    # short stop sits above entry
    assert r.stop_loss > r.entry_price


# ── 4. Range detection invariant ──────────────────────────────────────────────

def test_detect_range_support_below_resistance():
    cases = [
        ([100 + (i % 7) for i in range(150)], [90 + (i % 5) for i in range(150)]),
        ([50.0] * 150, [40.0] * 150),                       # flat
        ([float(i) for i in range(150)], [float(i) - 5 for i in range(150)]),  # trend
        ([100, 0, 100, 0] * 40, [50, 0, 50, 0] * 40),       # zeros mixed in
    ]
    for highs, lows in cases:
        support, resistance = _detect_range(highs, lows, len(highs))
        assert support < resistance, f"support {support} !< resistance {resistance}"


# ── 5. VSA classification + ST de-dup guard ───────────────────────────────────

def test_vsa_labels_use_known_vocabulary():
    r = analyze("ACC", build_accumulation())
    vocab = {"demand", "supply", "absorption", "no_supply", "no_demand", "normal"}
    assert len(r.vsa_labels) == r.bars_analyzed
    assert set(r.vsa_labels) <= vocab


def test_vsa_demand_and_supply_extremes():
    # one explicit wide-spread, high-volume up bar → demand; down bar → supply
    highs   = [110.0, 110.0]
    lows    = [100.0, 100.0]
    closes  = [109.0, 101.0]        # close_pos 0.9 (demand) / 0.1 (supply)
    volumes = [5_000_000, 5_000_000]
    labels = classify_vsa_bars(highs, lows, closes, volumes,
                               avg_vol=1_000_000, avg_hl_spread=2.0)
    assert labels[0] == "demand"
    assert labels[1] == "supply"


def test_secondary_test_not_duplicated_every_bar():
    # regression: ST must not re-fire on consecutive bars (spacing guard)
    r = analyze("ACC", build_accumulation())
    st_indices = [i for i, e in enumerate(r.events) if e.event_type == "ST"]
    # consecutive ST events in the list must be at least one other event apart is
    # not guaranteed, but there should be no run of >3 identical STs back-to-back
    longest = run = 1
    prev = None
    for e in r.events:
        if e.event_type == prev == "ST":
            run += 1
            longest = max(longest, run)
        else:
            run = 1
        prev = e.event_type
    assert longest <= 2, f"ST fired {longest} times back-to-back"


# ── Fallback runner (no pytest required) ──────────────────────────────────────

if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items())
             if k.startswith("test_") and callable(v)]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS  {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL  {t.__name__}: {e}")
        except Exception as e:  # pragma: no cover
            failed += 1
            print(f"ERROR {t.__name__}: {type(e).__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    raise SystemExit(1 if failed else 0)
