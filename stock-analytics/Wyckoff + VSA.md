# Wyckoff + Volume Spread Analysis (VSA) — `crawler/wyckoff.py`

A production-ready Wyckoff analysis engine integrated into the `stock-analytics` project as a module inside `crawler/`. Data is read from and written to PostgreSQL via the existing `Store` class in `store.py`.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Project Integration](#2-project-integration)
3. [How It Works](#3-how-it-works)
4. [Data Flow](#4-data-flow)
5. [Core Types](#5-core-types)
6. [Key Functions](#6-key-functions)
7. [Wyckoff Phases & Events](#7-wyckoff-phases--events)
8. [Signal Reference](#8-signal-reference)
9. [Database Schema](#9-database-schema)
10. [Running the Analysis](#10-running-the-analysis)
11. [Parameters Reference](#11-parameters-reference)
12. [Prompts for Claude](#12-prompts-for-claude)
13. [FAQ](#13-faq)

---

## 1. Overview

This module implements the **Wyckoff Method** to automatically detect market phases and generate trading signals from OHLCV price data. It is designed as a self-contained module — no CSV files, no separate DB connection — it plugs directly into the existing `Store` and runs inside the `crawler` service.

**What it produces per ticker:**

- Current Wyckoff phase: `Accumulation | Distribution | Markup | Markdown | Unknown`
- Sub-phase: `A | B | C | D | E`
- Signal: `BUY | SHORT | HOLD | WAIT`
- Signal strength: `STRONG | MODERATE | WEAK`
- Key price levels: `support`, `resistance`, `entry_price`, `stop_loss`
- Detected events: `SC, AR, ST, Spring, Test, SOS, LPS, BC, UT, UTAD, LPSY`
- Human-readable description of the current setup

---

## 2. Project Integration

The module lives at `crawler/wyckoff.py` — no new files or folders needed.

```
stock-analytics/
├── crawler/
│   ├── store.py       ← already has get_symbol_quotes() and upsert_wyckoff_signal()
│   ├── wyckoff.py     ← this module (replace with new version)
│   ├── predict.py     ← existing ML predictions (separate, no changes needed)
│   ├── api.py         ← expose wyckoff results via existing FastAPI routes
│   └── main.py        ← schedule wyckoff runs alongside existing crawl jobs
├── db/
│   └── init.sql       ← add wyckoff_signals table here
└── docker-compose.yml
```

The module reuses:
- **`store.get_symbol_quotes(symbol, days)`** — fetches OHLCV rows from `daily_quotes`
- **`store.upsert_wyckoff_signal(analysis)`** — persists results to `wyckoff_signals`
- **`store.get_symbol_symbols()`** — fetches ticker list for batch scanning
- **`store.get_wyckoff_signal(symbol)`** — retrieves stored result for API responses
- **`store.get_wyckoff_signals(...)`** — retrieves filtered list for the signals dashboard

---

## 3. How It Works

The engine runs in a single function call: `analyze(symbol, bars)`.

Internally it runs five sequential steps:

```
bars (list of dicts)
        │
        ▼
1. _detect_range()       → support, resistance   (swing pivot detection)
        │
        ▼
2. _detect_events()      → list[WyckoffEvent]    (single-pass, one event per bar)
        │
        ▼
3. _classify_phase()     → phase, sub_phase      (based on event sequence)
        │
        ▼
4. _generate_signal()    → signal, strength, description
        │
        ▼
5. _compute_entry_stop() → entry_price, stop_loss
        │
        ▼
WyckoffAnalysis (dataclass)
```

No ML, no external dependencies beyond the Python standard library. Pure price/volume logic.

---

## 4. Data Flow

```
PostgreSQL (daily_quotes)
        │
        │  store.get_symbol_quotes(symbol, days=300)
        ▼
list[dict]  {date, open, high, low, close, volume}
        │
        │  wyckoff.analyze(symbol, bars)
        ▼
WyckoffAnalysis (dataclass)
        │
        │  store.upsert_wyckoff_signal(analysis)
        ▼
PostgreSQL (wyckoff_signals)
        │
        │  store.get_wyckoff_signal(symbol)
        │  store.get_wyckoff_signals(signal, phase, ...)
        ▼
FastAPI (api.py)  →  Frontend
```

---

## 5. Core Types

### `WyckoffEvent`

A single detected market event on a specific bar.

```python
@dataclass
class WyckoffEvent:
    event_type:  str    # SC | AR | ST | Spring | Test | SOS | LPS |
                        # BC | UT | UTAD | LPSY
    date:        str    # ISO date string
    price:       float  # close price at the event bar
    volume:      int    # volume at the event bar
    description: str    # human-readable explanation
```

### `WyckoffAnalysis`

The full result returned by `analyze()` and persisted to the database.

```python
@dataclass
class WyckoffAnalysis:
    symbol:          str
    analyzed_at:     str            # UTC ISO datetime
    phase:           str            # Accumulation | Distribution | Markup | Markdown | Unknown
    sub_phase:       str            # A | B | C | D | E | -
    signal:          str            # BUY | SHORT | HOLD | WAIT
    signal_strength: str            # STRONG | MODERATE | WEAK
    support:         Optional[float]
    resistance:      Optional[float]
    current_price:   Optional[float]
    last_event:      Optional[str]  # most recent event_type
    entry_price:     Optional[float]
    stop_loss:       Optional[float]
    events:          list[WyckoffEvent]
    description:     str
    bars_analyzed:   int
```

---

## 6. Key Functions

### `analyze(symbol, bars, lookback=260)` — main entry point

```python
from wyckoff import analyze

bars = store.get_symbol_quotes("STB", days=300)
result = analyze("STB", bars, lookback=260)

print(result.phase)          # "Accumulation"
print(result.sub_phase)      # "C"
print(result.signal)         # "BUY"
print(result.signal_strength)# "STRONG"
print(result.entry_price)    # 28.5
print(result.stop_loss)      # 27.2
print(result.description)    # "Phase C — Spring + Test confirmed. High-probability entry..."
```

| Parameter | Default | Notes |
|---|---|---|
| `symbol` | required | Ticker string e.g. `"STB"` |
| `bars` | required | List of OHLCV dicts, oldest → newest |
| `lookback` | `260` | How many recent bars to analyze (≈ 1 year daily) |

Returns `WyckoffAnalysis`. If fewer than 30 bars are available, returns an `Unknown` phase with `WAIT` signal.

---

### `_detect_range(highs, lows, n, range_bars=80, pivot=3)`

Finds horizontal support and resistance using swing pivot detection over the last `range_bars` bars. Falls back to 10th/90th percentile when fewer than 2 pivots are found.

| Parameter | Default | Tune when... |
|---|---|---|
| `range_bars` | `120` | Increase for longer-term S/R on weekly data |
| `pivot` | `3` | Increase to `5` for stricter pivot confirmation |

---

### `_detect_events(...)`

Single-pass event detector. Processes bars in chronological order, assigns at most **one event per bar** using an `elif` chain that mirrors the Wyckoff phase sequence. Key thresholds:

| Threshold | Value | Meaning |
|---|---|---|
| `climax_vol` | `avg_vol × 2.0` | Volume needed for SC or BC |
| `hi_vol` | `avg_vol × 1.4` | Volume needed for SOS |
| `lo_vol` | `avg_vol × 0.7` | Max volume for LPS / LPSY / Test |

---

### `_classify_phase(events, closes, support, resistance, current_price, overall_uptrend)`

Determines phase and sub-phase purely from the set of detected event types. Priority order:

1. Price clearly above resistance + uptrend → `Markup E`
2. Price clearly below support + downtrend → `Markdown`
3. SC detected → `Accumulation A/B/C/D`
4. BC detected → `Distribution A/B/C/D`
5. Fallback based on MA50 vs MA200 trend

---

### `_generate_signal(phase, sub_phase, events, current_price, support, resistance, ma20)`

Maps phase + sub-phase + events to a `(signal, strength, description)` tuple. Returns `WAIT/WEAK` for all phases where no actionable setup exists yet.

---

### `_compute_entry_stop(phase, sub_phase, events, support, resistance)`

Returns `(entry_price, stop_loss)` only for high-confidence setups:

| Setup | Entry | Stop Loss |
|---|---|---|
| Accumulation C — Test | Test event close | Spring low × 0.97 |
| Accumulation C — Spring only | Spring event close | Spring price × 0.97 |
| Accumulation D — LPS | LPS event close | Spring low × 0.97 |
| Accumulation D — SOS | Midpoint of range | Support × 0.97 |
| Distribution C — UTAD / UT | Event close | Resistance × 1.02 |
| Distribution D — LPSY | LPSY event close | Resistance × 1.02 |

Returns `(None, None)` for `WAIT` and `HOLD` signals.

---

## 7. Wyckoff Phases & Events

### Accumulation phases

```
Phase A — SC → AR                 : panic selling stops, range defined
Phase B — ST                      : secondary tests, range validated
Phase C — Spring → Test           : shakeout below support, last bear trap → best buy entry
Phase D — SOS → LPS               : strength confirmed, ideal entry on LPS pullback
Phase E — Markup                  : price breaks above resistance, uptrend begins
```

### Distribution phases

```
Phase A — BC → AR                 : euphoric buying stops, range defined
Phase B — ST                      : secondary tests of supply
Phase C — UT → UTAD               : bull trap above resistance → best short entry
Phase D — LPSY                    : weak rallies fail, markdown imminent
Markdown                          : price breaks below support, downtrend begins
```

### Event glossary

| Event | Full Name | Wyckoff Significance |
|---|---|---|
| `SC` | Selling Climax | Panic selling exhaustion — bottom of accumulation range |
| `AR` | Automatic Rally | Bounce after SC — defines top of accumulation range |
| `ST` | Secondary Test | Re-test of SC area on lower volume — confirms support |
| `Spring` | Spring | False break below support — shakeout of weak hands |
| `Test` | Test of Spring | Re-test of Spring on low volume — confirms buyers in control |
| `SOS` | Sign of Strength | Strong rally through midpoint — markup beginning |
| `LPS` | Last Point of Support | Low-volume pullback after SOS — optimal buy entry |
| `BC` | Buying Climax | Euphoric buying exhaustion — top of distribution range |
| `UT` | Upthrust | False break above resistance — first bull trap |
| `UTAD` | Up-Thrust After Distribution | Second bull trap — confirms distribution complete |
| `LPSY` | Last Point of Supply | Weak rally before markdown — optimal short entry |

---

## 8. Signal Reference

| Signal | Strength | Trigger | Action |
|---|---|---|---|
| `BUY` | `STRONG` | Phase C Test confirmed, or Phase D LPS | Buy at entry_price, stop at stop_loss |
| `BUY` | `MODERATE` | Phase C Spring only, or Phase D SOS | Buy with reduced size, await confirmation |
| `SHORT` | `STRONG` | Phase C UTAD confirmed, or Phase D LPSY | Short at entry_price, stop at stop_loss |
| `SHORT` | `MODERATE` | Phase C UT only | Short with reduced size |
| `HOLD` | `MODERATE` | Markup, price above MA20 | Hold longs, buy dips to MA20 |
| `WAIT` | `WEAK` | Any phase without actionable setup | Do not enter, monitor for next event |

---

## 9. Database Schema

Add this table to `db/init.sql`:

```sql
CREATE TABLE IF NOT EXISTS wyckoff_signals (
    symbol          VARCHAR(20)  PRIMARY KEY,
    analyzed_at     TIMESTAMPTZ  NOT NULL,
    phase           VARCHAR(30)  NOT NULL,
    sub_phase       VARCHAR(5),
    signal          VARCHAR(10)  NOT NULL,   -- BUY | SHORT | HOLD | WAIT
    signal_strength VARCHAR(10),             -- STRONG | MODERATE | WEAK
    support         NUMERIC(12, 2),
    resistance      NUMERIC(12, 2),
    current_price   NUMERIC(12, 2),
    last_event      VARCHAR(20),
    entry_price     NUMERIC(12, 2),
    stop_loss       NUMERIC(12, 2),
    description     TEXT,
    bars_analyzed   INTEGER,
    updated_at      TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wyckoff_signal  ON wyckoff_signals (signal);
CREATE INDEX IF NOT EXISTS idx_wyckoff_phase   ON wyckoff_signals (phase);
CREATE INDEX IF NOT EXISTS idx_wyckoff_updated ON wyckoff_signals (updated_at DESC);
```

---

## 10. Running the Analysis

### Single ticker (interactive / debug)

```python
# Inside crawler/
from store import Store
from wyckoff import analyze
import os

store = Store(os.environ["DATABASE_URL"])
bars  = store.get_symbol_quotes("STB", days=300)
result = analyze("STB", bars, lookback=260)

store.upsert_wyckoff_signal(result)
print(result.signal, result.signal_strength, result.description)
```

### Batch scan — all tickers (add to `main.py`)

```python
from concurrent.futures import ThreadPoolExecutor, as_completed
import logging
from wyckoff import analyze

log = logging.getLogger(__name__)

def run_wyckoff_scan(store: Store, lookback: int = 260, workers: int = 8):
    symbols = store.get_symbols_with_quotes()
    log.info("Wyckoff scan: %d symbols", len(symbols))

    def process(symbol: str):
        bars   = store.get_symbol_quotes(symbol, days=300)
        result = analyze(symbol, bars, lookback=lookback)  # default lookback=260
        store.upsert_wyckoff_signal(result)
        return symbol, result.signal, result.signal_strength

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(process, s): s for s in symbols}
        for fut in as_completed(futures):
            try:
                sym, sig, strength = fut.result()
                if sig in ("BUY", "SHORT"):
                    log.info("  %-10s  %s  %s", sym, sig, strength)
            except Exception as exc:
                log.error("  %s failed: %s", futures[fut], exc)
```

### Expose via API (add to `api.py`)

```python
from fastapi import Query
from store import store  # your existing Store instance

@app.get("/wyckoff/{symbol}")
def get_wyckoff(symbol: str):
    return store.get_wyckoff_signal(symbol.upper())

@app.get("/wyckoff")
def list_wyckoff(
    signal: str = Query(""),
    phase:  str = Query(""),
    limit:  int = Query(50),
    offset: int = Query(0),
):
    return store.get_wyckoff_signals(signal, phase, limit, offset)
```

---

## 11. Parameters Reference

All thresholds are computed dynamically from the data — there are no hardcoded price values. The parameters below are the multipliers applied to rolling averages.

| Parameter | Location | Default | Effect |
|---|---|---|---|
| `lookback` | `analyze()` arg | `260` | Bars used for analysis (~1 year of daily data). Increase to `520` for 2-year context |
| `range_bars` | `_detect_range()` | `120` | Bars used for S/R detection. Higher = longer-term levels |
| `pivot` | `_detect_range()` | `3` | Bars each side for swing pivot. Higher = fewer, stronger pivots |
| `climax_vol` | `_detect_events()` | `avg_vol × 2.0` | Threshold for SC / BC. Raise to `2.5` for noisy markets |
| `hi_vol` | `_detect_events()` | `avg_vol × 1.4` | Threshold for SOS confirmation |
| `lo_vol` | `_detect_events()` | `avg_vol × 0.7` | Max vol for LPS / Test / LPSY |
| Spring stop | `_compute_entry_stop()` | `spring_price × 0.97` | Stop cushion below Spring. Tighten to `0.98` for liquid stocks |
| Resistance stop | `_compute_entry_stop()` | `resistance × 1.02` | Stop cushion above resistance for shorts |

### Tuning tips

**Too few SC/BC events detected:** Lower `climax_vol` from `2.0` to `1.6`.

**Too many false Springs:** Tighten the Spring condition — require `c >= support * 1.00` instead of `0.98`.

**Phase always shows Markup/Markdown:** The MA50 vs MA200 fallback is triggering. Reduce `lookback` so more bars fall inside the accumulation/distribution range.

**LPS / LPSY never fires:** Lower `lo_vol` from `0.7` to `0.8` — Vietnamese stocks sometimes show moderate volume at these points.

---

## 12. Prompts for Claude

Use these when you want to extend or modify `wyckoff.py`. Each prompt assumes Claude has the current file in context.

### Modify event detection thresholds
```
In wyckoff.py _detect_events(), the climax_vol threshold is avg_vol * 2.0.
On Vietnamese stocks this is too strict — many real Selling Climaxes are
missed. Change climax_vol to avg_vol * 1.6 and hi_vol to avg_vol * 1.2.
Keep all other logic identical.
```

### Add VSA bar classification
```
In wyckoff.py, after _detect_range() runs, add a function classify_vsa_bars(bars, avg_vol, avg_spread)
that labels each bar as: 'demand' | 'supply' | 'absorption' | 'no_supply' | 'no_demand' | 'normal'.
Rules:
- demand:      rel_volume > 1.8 AND rel_spread > 1.5 AND close_pos > 0.6
- supply:      rel_volume > 1.8 AND rel_spread > 1.5 AND close_pos < 0.4
- absorption:  rel_volume > 2.0 AND rel_spread < 0.7
- no_supply:   rel_volume < 0.5 AND rel_spread < 0.7 AND close_pos > 0.5
- no_demand:   rel_volume < 0.5 AND rel_spread < 0.7 AND close_pos < 0.5
Return a list of label strings, one per bar. Add vsa_labels to WyckoffAnalysis dataclass.
```

### Add RSI filter to signal generation
```
In wyckoff.py _generate_signal(), add an RSI(14) filter:
- For BUY signals: only upgrade to STRONG if RSI < 50 and RSI is rising
- For SHORT signals: only upgrade to STRONG if RSI > 50 and RSI is falling
Compute RSI from the closes list already available in scope.
Do not change the function signature or return type.
```

### Add the analysis to the existing predict.py batch run
```
In crawler/predict.py, after the ML predictions are saved, add a call to
run_wyckoff_scan(store) so Wyckoff analysis runs in the same batch job.
Import analyze from wyckoff and reuse the existing store instance.
Use ThreadPoolExecutor with max_workers=8.
```

### Write unit tests
```
Write pytest tests for wyckoff.py covering:
1. analyze() returns Unknown/WAIT when bars < 30
2. A synthetic accumulation sequence (SC → AR → ST → Spring → Test → SOS → LPS)
   produces phase=Accumulation, sub_phase=D, signal=BUY
3. A synthetic distribution sequence (BC → UT → UTAD → LPSY)
   produces phase=Distribution, sub_phase=D, signal=SHORT
4. _detect_range() returns support < resistance for all inputs
Build synthetic bar lists using simple Python dicts, no external data needed.
```

### Debug prompt
```
wyckoff.analyze("STB", bars) is returning phase="Markup" for a stock
that is clearly in accumulation. Here is bars[-10:]: [paste last 10 bars].
Here is the events list: [paste result.events].
Here is result.description: [paste].
Diagnose why _classify_phase() is returning Markup and suggest a fix.
```

---

## 13. FAQ

**Q: The module returns `Unknown` phase for most tickers.**
A: The ticker likely has fewer than 30 bars in `daily_quotes`. Run the crawler to fetch more history before running Wyckoff analysis. Recommended minimum: 260 bars (1 year of daily data).

**Q: `Spring` is detected but `signal` is still `WAIT`.**
A: A Spring alone (sub-phase C, no Test) returns `BUY/MODERATE`. The `STRONG` signal requires a Test confirmation. This is intentional — wait for the Test bar before entering with full size.

**Q: How often should I run the batch scan?**
A: Once per day after market close, after the daily quotes crawl completes. Add `run_wyckoff_scan(store)` at the end of your existing daily crawl job in `main.py`.

**Q: `upsert_wyckoff_signal` expects an object — what fields must it have?**
A: The `Store.upsert_wyckoff_signal()` method reads these attributes from the passed object: `symbol, analyzed_at, phase, sub_phase, signal, signal_strength, support, resistance, current_price, last_event, entry_price, stop_loss, description, bars_analyzed`. The `WyckoffAnalysis` dataclass covers all of them.

**Q: Can I run this on intraday data?**
A: Yes. Pass 5-minute or 15-minute bars. Set `lookback=500` and increase `pivot` to `5` in `_detect_range()` to avoid noisy S/R levels. Results are noisier on intraday — add the RSI filter (see Prompts section) to reduce false signals.

**Q: The `events` list in `WyckoffAnalysis` is not saved to the database.**
A: Correct — `upsert_wyckoff_signal` only saves the summary fields. The `events` list is available in-memory from `analyze()` for real-time API responses or logging, but is not persisted. If you need event history, ask Claude to add an `wyckoff_events` table and an `upsert_wyckoff_events()` method to `store.py`.
