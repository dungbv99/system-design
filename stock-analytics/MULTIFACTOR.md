# Multi-Factor Signal System — `crawler/multi_factor.py`

A scoring-based signal engine that combines four independent technical indicators into a single BUY / WAIT / AVOID signal. Designed as a sibling module to `crawler/wyckoff.py` — same data flow, same Store integration, same call pattern.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Project Integration](#2-project-integration)
3. [How It Works](#3-how-it-works)
4. [Data Flow](#4-data-flow)
5. [Core Types](#5-core-types)
6. [Scoring Logic](#6-scoring-logic)
7. [Signal Reference](#7-signal-reference)
8. [Database Schema](#8-database-schema)
9. [Running the Analysis](#9-running-the-analysis)
10. [Parameters Reference](#10-parameters-reference)
11. [Prompts for Claude](#11-prompts-for-claude)
12. [FAQ](#12-faq)

---

## 1. Overview

This module implements a **Multi-Factor Scoring System** that evaluates four independent technical factors on each ticker. Each factor contributes up to 25 points, giving a total score of 0–100. A signal is only generated when at least 3 of the 4 factors agree.

**Four factors:**

| Factor | Indicators used | Max score |
|---|---|---|
| Trend | MA20, MA50, MA200 — alignment + price position | 25 |
| Momentum | RSI(14) level + MACD cross direction | 25 |
| Volume | Volume / MA20 ratio + 5-bar volume trend | 25 |
| Price position | Distance from support/resistance + candle pattern | 25 |

**Output per ticker:**

- Total score: `0–100`
- Signal: `BUY | WATCH | AVOID`
- Confidence: `HIGH | MEDIUM | LOW`
- Per-factor scores and reasoning strings
- Entry price, stop loss, and factors agreed count

---

## 2. Project Integration

File lives at `crawler/multi_factor.py`. No new folders needed.

```
stock-analytics/
├── crawler/
│   ├── store.py           ← add upsert_multifactor_signal() and related read methods
│   ├── wyckoff.py         ← existing, unchanged
│   ├── multi_factor.py    ← new file (this module)
│   ├── api.py             ← add /multifactor routes
│   └── main.py            ← add run_multifactor_scan() call after wyckoff scan
├── db/
│   └── init.sql           ← add multifactor_signals table
```

Reuses from `store.py`:
- **`store.get_symbol_quotes(symbol, days)`** — same OHLCV source as wyckoff
- **`store.upsert_multifactor_signal(analysis)`** — new method to add
- **`store.get_multifactor_signal(symbol)`** — new method to add
- **`store.get_multifactor_signals(...)`** — new method to add
- **`store.get_symbols_with_quotes()`** — existing, reused for batch scan

---

## 3. How It Works

Single entry point: `analyze(symbol, bars, params)`.

```
bars (list of dicts)
        │
        ▼
1. _compute_indicators()    → ma20, ma50, ma200, rsi, macd, vol_ratio, support, resistance
        │
        ▼
2. _score_trend()           → score 0–25, reason string
3. _score_momentum()        → score 0–25, reason string
4. _score_volume()          → score 0–25, reason string
5. _score_price_position()  → score 0–25, reason string
        │
        ▼
6. _generate_signal()       → signal, confidence, description
7. _compute_entry_stop()    → entry_price, stop_loss
        │
        ▼
MultifactorAnalysis (dataclass)
```

No ML, no external dependencies beyond the Python standard library. Pure arithmetic on price/volume arrays.

---

## 4. Data Flow

```
PostgreSQL (daily_quotes)
        │
        │  store.get_symbol_quotes(symbol, days=300)
        ▼
list[dict]  {date, open, high, low, close, volume}
        │
        │  multi_factor.analyze(symbol, bars, params)
        ▼
MultifactorAnalysis (dataclass)
        │
        │  store.upsert_multifactor_signal(analysis)
        ▼
PostgreSQL (multifactor_signals)
        │
        │  store.get_multifactor_signal(symbol)
        │  store.get_multifactor_signals(signal, min_score, ...)
        ▼
FastAPI (api.py)  →  Frontend
```

---

## 5. Core Types

### `FactorResult`

Score and reasoning for a single factor.

```python
@dataclass
class FactorResult:
    name:   str    # 'trend' | 'momentum' | 'volume' | 'price_position'
    score:  int    # 0–25
    reason: str    # human-readable explanation of the score
```

### `MultifactorAnalysis`

Full result returned by `analyze()` and persisted to the database.

```python
@dataclass
class MultifactorAnalysis:
    symbol:          str
    analyzed_at:     str             # UTC ISO datetime
    total_score:     int             # 0–100
    signal:          str             # BUY | WATCH | AVOID
    confidence:      str             # HIGH | MEDIUM | LOW
    factors_agreed:  int             # how many factors scored >= 15 (0–4)
    trend_score:     int             # 0–25
    momentum_score:  int             # 0–25
    volume_score:    int             # 0–25
    position_score:  int             # 0–25
    trend_reason:    str
    momentum_reason: str
    volume_reason:   str
    position_reason: str
    current_price:   Optional[float]
    support:         Optional[float]
    resistance:      Optional[float]
    entry_price:     Optional[float]
    stop_loss:       Optional[float]
    description:     str             # overall summary
    bars_analyzed:   int
```

---

## 6. Scoring Logic

### Factor 1 — Trend (MA)

Uses MA20, MA50, MA200 computed from `close` prices.

| Condition | Points |
|---|---|
| MA20 > MA50 (short-term uptrend) | +12 |
| MA20 < MA50 (short-term downtrend) | +0 |
| MA20 ≈ MA50 (within 1%, crossing) | +6 |
| Price touches MA20 from above (pullback buy) | +10 |
| Price above MA20 | +8 |
| Price below MA20 | +0 |
| MA50 > MA200 (long-term uptrend) | +5 |
| MA50 < MA200 (long-term downtrend) | +0 |
| **Cap** | **25** |

> Pullback to MA20 scores higher than simply being above it, because buying at the pullback gives better risk/reward.

### Factor 2 — Momentum (RSI + MACD)

RSI(14) computed from close prices. MACD(12, 26, 9) computed from close prices.

| Condition | Points |
|---|---|
| RSI < 30 (oversold, mean reversion potential) | +15 |
| RSI 30–50 and rising | +20 |
| RSI 50–65 (healthy momentum) | +12 |
| RSI 65–70 | +5 |
| RSI > 70 (overbought) | +0 |
| MACD line crosses above signal line | +5 |
| MACD line above signal (no fresh cross) | +2 |
| MACD line below signal | +0 |
| **Cap** | **25** |

### Factor 3 — Volume

`vol_ratio = volume[-1] / mean(volume[-20:])`. Volume trend = slope of volume over last 5 bars.

| Condition | Points |
|---|---|
| vol_ratio >= 2.0 (strong surge) | +15 |
| vol_ratio 1.5–2.0 | +12 |
| vol_ratio 1.0–1.5 | +7 |
| vol_ratio 0.7–1.0 | +3 |
| vol_ratio < 0.7 | +0 |
| Volume trend positive (rising over 5 bars) | +5 |
| Volume trend negative (falling over 5 bars) | +0 |
| Price rising + volume falling (divergence penalty) | −5 |
| **Cap** | **25** |

### Factor 4 — Price Position (Support/Resistance + Candle)

Support and resistance detected using the same pivot method as `wyckoff.py` (`_detect_range`). Candle pattern detected on the latest bar.

| Condition | Points |
|---|---|
| Price within 2% above support | +15 |
| Price in lower half of S/R range | +8 |
| Price in upper half of S/R range | +5 |
| Price within 2% below resistance (breakout risk) | +3 |
| Bullish reversal candle (Hammer, Engulfing, Morning Star) | +10 |
| Neutral candle (Doji, small body) | +3 |
| Bearish candle at resistance | +0 |
| **Cap** | **25** |

---

## 7. Signal Reference

| Signal | Confidence | Condition | Action |
|---|---|---|---|
| `BUY` | `HIGH` | total_score >= 70 AND factors_agreed >= 3 | Full position, set SL immediately |
| `BUY` | `MEDIUM` | total_score >= 55 AND factors_agreed >= 2 | Half position, wait for 3rd factor confirmation |
| `WATCH` | `MEDIUM` | total_score 40–69 | No entry. Set alert. Monitor for improvement |
| `WATCH` | `LOW` | total_score 40–54, factors_agreed <= 1 | Conflicting signals, stay out |
| `AVOID` | `LOW` | total_score < 40 | Do not buy. Consider cutting losses if holding |

Entry and stop loss are only populated for `BUY` signals:
- `entry_price` = current close price
- `stop_loss` = support level × 0.97 (3% below support)

---

## 8. Database Schema

Add to `db/init.sql`:

```sql
CREATE TABLE IF NOT EXISTS multifactor_signals (
    symbol           VARCHAR(20)   PRIMARY KEY,
    analyzed_at      TIMESTAMPTZ   NOT NULL,
    total_score      INTEGER       NOT NULL,
    signal           VARCHAR(10)   NOT NULL,    -- BUY | WATCH | AVOID
    confidence       VARCHAR(10),               -- HIGH | MEDIUM | LOW
    factors_agreed   INTEGER,                   -- 0–4
    trend_score      INTEGER,
    momentum_score   INTEGER,
    volume_score     INTEGER,
    position_score   INTEGER,
    trend_reason     TEXT,
    momentum_reason  TEXT,
    volume_reason    TEXT,
    position_reason  TEXT,
    current_price    NUMERIC(12, 2),
    support          NUMERIC(12, 2),
    resistance       NUMERIC(12, 2),
    entry_price      NUMERIC(12, 2),
    stop_loss        NUMERIC(12, 2),
    description      TEXT,
    bars_analyzed    INTEGER,
    updated_at       TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mf_signal     ON multifactor_signals (signal);
CREATE INDEX IF NOT EXISTS idx_mf_score      ON multifactor_signals (total_score DESC);
CREATE INDEX IF NOT EXISTS idx_mf_updated    ON multifactor_signals (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_mf_confidence ON multifactor_signals (confidence);
```

---

## 9. Running the Analysis

### Single ticker (debug / interactive)

```python
# Inside crawler/
from store import Store
from multi_factor import analyze
import os

store = Store(os.environ["DATABASE_URL"])
bars   = store.get_symbol_quotes("STB", days=300)
result = analyze("STB", bars)

store.upsert_multifactor_signal(result)
print(result.signal, result.confidence, result.total_score)
print(f"  Trend:    {result.trend_score}/25  — {result.trend_reason}")
print(f"  Momentum: {result.momentum_score}/25  — {result.momentum_reason}")
print(f"  Volume:   {result.volume_score}/25  — {result.volume_reason}")
print(f"  Position: {result.position_score}/25  — {result.position_reason}")
```

### Batch scan — add to `main.py`

```python
from concurrent.futures import ThreadPoolExecutor, as_completed
import logging
from multi_factor import analyze

log = logging.getLogger(__name__)

def run_multifactor_scan(store: Store, workers: int = 8):
    symbols = store.get_symbols_with_quotes()
    log.info("Multi-factor scan: %d symbols", len(symbols))

    def process(symbol: str):
        bars   = store.get_symbol_quotes(symbol, days=300)
        result = analyze(symbol, bars)
        store.upsert_multifactor_signal(result)
        return symbol, result.signal, result.confidence, result.total_score

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(process, s): s for s in symbols}
        for fut in as_completed(futures):
            try:
                sym, sig, conf, score = fut.result()
                if sig == "BUY":
                    log.info("  %-10s  %s  %s  score=%d", sym, sig, conf, score)
            except Exception as exc:
                log.error("  %s failed: %s", futures[fut], exc)
```

Call after the Wyckoff scan in `main.py`:

```python
run_wyckoff_scan(store)
run_multifactor_scan(store)   # add this line
```

### Add to `store.py`

```python
# Add these three methods to the Store class, following the same pattern
# as get_wyckoff_signal / get_wyckoff_signals / upsert_wyckoff_signal

def upsert_multifactor_signal(self, analysis) -> None:
    # INSERT ... ON CONFLICT (symbol) DO UPDATE
    # Fields: all columns of multifactor_signals except updated_at

def get_multifactor_signal(self, symbol: str) -> Optional[dict]:
    # SELECT * FROM multifactor_signals WHERE symbol = %s

def get_multifactor_signals(
    self,
    signal: str = "",
    min_score: int = 0,
    confidence: str = "",
    limit: int = 50,
    offset: int = 0,
) -> dict:
    # SELECT with optional WHERE signal=, total_score>=, confidence=
    # JOIN symbols for name/exchange
    # ORDER BY total_score DESC
    # Return {"total": int, "items": list[dict]}
```

Ask Claude to implement these three methods:

```
In store.py, add three methods to the Store class following the exact same
pattern as upsert_wyckoff_signal, get_wyckoff_signal, and get_wyckoff_signals.

The new methods are for the multifactor_signals table with these columns:
symbol, analyzed_at, total_score, signal, confidence, factors_agreed,
trend_score, momentum_score, volume_score, position_score,
trend_reason, momentum_reason, volume_reason, position_reason,
current_price, support, resistance, entry_price, stop_loss,
description, bars_analyzed.

upsert_multifactor_signal(analysis): ON CONFLICT (symbol) DO UPDATE all fields.
get_multifactor_signal(symbol): return single row as dict or None.
get_multifactor_signals(signal, min_score, confidence, limit, offset):
  filter by signal if provided, total_score >= min_score,
  confidence if provided. JOIN symbols. ORDER BY total_score DESC.
  Return {"total": int, "items": list[dict]}.
```

### Expose via API — add to `api.py`

```python
@app.get("/multifactor/{symbol}")
def get_multifactor(symbol: str):
    return store.get_multifactor_signal(symbol.upper())

@app.get("/multifactor")
def list_multifactor(
    signal:     str = Query(""),
    min_score:  int = Query(0),
    confidence: str = Query(""),
    limit:      int = Query(50),
    offset:     int = Query(0),
):
    return store.get_multifactor_signals(signal, min_score, confidence, limit, offset)
```

---

## 10. Parameters Reference

All parameters can be passed as a `dict` to `analyze(symbol, bars, params)`. Defaults are applied if `params` is omitted.

```python
DEFAULT_PARAMS = {
    # MA thresholds
    "ma_cross_tolerance":   0.01,   # % tolerance to call MA20 ≈ MA50 (crossing zone)
    "pullback_tolerance":   0.02,   # % within which price counts as "touching MA20"

    # RSI thresholds
    "rsi_period":           14,
    "rsi_oversold":         30,     # below this = oversold score boost
    "rsi_buy_zone_low":     30,     # RSI 30–50 = best buy zone
    "rsi_buy_zone_high":    50,
    "rsi_neutral_high":     65,     # RSI 50–65 = healthy
    "rsi_overbought":       70,     # above this = overbought, score = 0

    # MACD
    "macd_fast":            12,
    "macd_slow":            26,
    "macd_signal":          9,

    # Volume thresholds
    "vol_window":           20,     # bars for rolling volume average
    "vol_surge":            2.0,    # multiplier for strong surge
    "vol_high":             1.5,    # multiplier for above-average
    "vol_normal":           1.0,    # multiplier for normal
    "vol_low":              0.7,    # below this = weak volume
    "vol_trend_bars":       5,      # bars to measure volume trend slope

    # Price position
    "support_tolerance":    0.02,   # % above support to count as "at support"
    "resistance_tolerance": 0.02,   # % below resistance to count as "near resistance"
    "range_bars":           120,    # bars used for S/R pivot detection
    "pivot_bars":           3,      # bars each side for swing pivot

    # Signal thresholds
    "buy_threshold":        70,     # min total_score for BUY signal
    "buy_medium_threshold": 55,     # min total_score for BUY MEDIUM
    "watch_threshold":      40,     # min total_score for WATCH
    "factors_agree_high":   3,      # min factors >= 15 for HIGH confidence
}
```

### Tuning tips

**Too many BUY signals (noise):** Raise `buy_threshold` to 75–80. Raise `factors_agree_high` to 4.

**Missing obvious setups:** Lower `buy_threshold` to 60. Lower `vol_high` to 1.3 for low-liquidity stocks.

**RSI always zero:** Check that your close prices are not normalized. RSI needs raw price values.

**S/R levels feel wrong:** Increase `range_bars` to 180 for longer-term levels. Increase `pivot_bars` to 5 for stricter pivots that filter out minor swings.

**Volume score always low on small-cap stocks:** Lower `vol_high` to 1.2 and `vol_surge` to 1.5.

---

## 11. Prompts for Claude

Use these in order. Paste the current `wyckoff.py` and `store.py` into context first so Claude can follow the existing patterns exactly.

### Step 1 — Create `multi_factor.py`

```
I want to create crawler/multi_factor.py as a sibling to crawler/wyckoff.py.
Here is wyckoff.py for reference on structure and style: [paste wyckoff.py]

Create multi_factor.py with:

1. Two dataclasses: FactorResult and MultifactorAnalysis (fields in README Section 5)

2. Main entry point:
   analyze(symbol: str, bars: list[dict], params: dict = None) -> MultifactorAnalysis
   - bars is list of {date, open, high, low, close, volume} oldest to newest
   - params overrides DEFAULT_PARAMS (defined at module top)
   - returns MultifactorAnalysis, or a WATCH/LOW result if < 30 bars

3. _compute_indicators(closes, volumes, params) returning a dict with:
   ma20, ma50, ma200 (simple moving averages)
   rsi (RSI-14 using Wilder smoothing)
   macd_line, macd_signal_line, macd_hist (MACD 12/26/9)
   vol_ratio = latest_volume / mean(volumes[-vol_window:])
   vol_trend_slope (linear regression slope over last vol_trend_bars volumes)
   support, resistance (reuse the same pivot logic from wyckoff._detect_range)

4. _score_trend(indicators, current_price, params) -> FactorResult
5. _score_momentum(indicators, params) -> FactorResult
6. _score_volume(indicators, current_price, prev_close, params) -> FactorResult
7. _score_price_position(indicators, current_price, params) -> FactorResult
   For candle pattern: detect Hammer, Bullish Engulfing on latest 2 bars.
   Hammer: lower_wick >= 2 * body AND close_pos > 0.5
   Engulfing: bar[-1] is bullish AND body[-1] > body[-2] AND close[-1] > open[-2]

8. _generate_signal(scores, params) -> (signal, confidence, description)
   Scoring rules from README Section 6 and 7.

9. _compute_entry_stop(current_price, support) -> (entry_price, stop_loss)
   entry = current_price, stop = support * 0.97

Use only Python standard library (statistics, math). No pandas, no numpy.
Follow the same code style as wyckoff.py: helper functions _f(), _r(), _mean(),
_sma(), _percentile() can be copied directly.
```

### Step 2 — Add methods to `store.py`

```
In store.py, add three methods to the Store class following the exact same
pattern as upsert_wyckoff_signal, get_wyckoff_signal, and get_wyckoff_signals.
Here is store.py for reference: [paste store.py]

New methods for multifactor_signals table:

upsert_multifactor_signal(self, analysis) -> None
  INSERT all fields ON CONFLICT (symbol) DO UPDATE SET all fields + updated_at = NOW()
  Fields: symbol, analyzed_at, total_score, signal, confidence, factors_agreed,
  trend_score, momentum_score, volume_score, position_score,
  trend_reason, momentum_reason, volume_reason, position_reason,
  current_price, support, resistance, entry_price, stop_loss,
  description, bars_analyzed

get_multifactor_signal(self, symbol: str) -> Optional[dict]
  SELECT * FROM multifactor_signals WHERE symbol = %s

get_multifactor_signals(self, signal="", min_score=0, confidence="", limit=50, offset=0) -> dict
  Build WHERE clause dynamically (same pattern as get_wyckoff_signals).
  Conditions: signal = %s if provided, total_score >= %s, confidence = %s if provided.
  JOIN symbols s ON s.symbol = w.symbol for name/exchange/industry.
  ORDER BY total_score DESC.
  Return {"total": int, "items": list[dict]}.
```

### Step 3 — Add to `db/init.sql`

```
Add the multifactor_signals table and indexes from README Section 8 to db/init.sql.
Use CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS so it is idempotent.
Place it after the wyckoff_signals table definition.
```

### Step 4 — Add to `main.py`

```
In crawler/main.py, add run_multifactor_scan(store, workers=8) from README Section 9.
Call it immediately after run_wyckoff_scan(store).
Import analyze from multi_factor at the top of the file.
Reuse the existing store instance — do not create a new one.
```

### Step 5 — Add to `api.py`

```
In crawler/api.py, add two FastAPI routes from README Section 9:
  GET /multifactor/{symbol}
  GET /multifactor
Follow the exact same pattern as the existing /wyckoff routes.
Reuse the existing store instance and router.
```

### Debug prompt

```
multi_factor.analyze("STB", bars) returns total_score=12 for a stock that
visually looks like a good setup. Here is the per-factor breakdown:
[paste result.trend_reason, momentum_reason, volume_reason, position_reason]

Here is bars[-5:]: [paste last 5 bars]
Here is DEFAULT_PARAMS: [paste params dict]

Diagnose which scoring function is underscoring and why. Suggest a fix.
```

### Add new factor (e.g. foreign trading)

```
In multi_factor.py, add a fifth factor: _score_foreign(foreign_bars, params) -> FactorResult
foreign_bars is a list of {date, buy_vol, sell_vol, net_vol} from store.get_symbol_foreign().
Scoring:
  net_vol (buy - sell) positive and > 10% of total vol: +15
  net_vol positive but small: +8
  net_vol negative but small: +3
  net_vol strongly negative: +0
  3-bar net_vol trend positive (rising): +5

Update MultifactorAnalysis to include foreign_score and foreign_reason.
Update the total to 0–125, or re-weight all factors to still sum to 100.
Update upsert_multifactor_signal and the DB schema accordingly.
```

---

## 12. FAQ

**Q: How is this different from Wyckoff?**
A: Wyckoff detects market *phases* and *events* (Spring, UTAD, accumulation stages) — it is a pattern-recognition engine. Multi-factor is a *scoring* engine — it grades the current snapshot of four independent indicators and adds them up. They are complementary: Wyckoff tells you *where in the cycle* the stock is; multi-factor tells you *how many indicators agree right now*. Running both gives a more complete picture.

**Q: Should I run both on every ticker?**
A: Yes. Both run from the same `get_symbol_quotes()` call and the batch scan is parallelized. Total runtime for 700 tickers is under 30 seconds on 8 workers.

**Q: What counts as factors_agreed?**
A: A factor is considered "agreed" if its individual score is >= 15 out of 25 (i.e. more than half of its max). `factors_agreed` counts how many of the 4 factors meet this threshold.

**Q: The volume score is always low for small-cap stocks.**
A: Small-cap stocks on HoSE/HNX often have erratic volume with no clear average. Lower `vol_high` to 1.2 and `vol_surge` to 1.5 in params. Alternatively, weight the volume factor less by reducing its max contribution in `_score_volume`.

**Q: Can I combine the Wyckoff and Multi-factor scores into one composite signal?**
A: Yes — ask Claude to write a `composite_signal(wyckoff_result, multifactor_result)` function. A simple approach: if Wyckoff says BUY STRONG and Multi-factor score >= 70, emit STRONG BUY. If they conflict, emit WATCH. This can be added as a view in PostgreSQL or as a helper function in `api.py`.

**Q: The `upsert_multifactor_signal` method expects an object — what fields must it have?**
A: All fields of `MultifactorAnalysis` as listed in Section 5. The method reads them as attributes (e.g. `analysis.total_score`), same pattern as `upsert_wyckoff_signal`.
