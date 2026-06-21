# Derivatives Module (VN30F1M) — `crawler/derivatives.py`

A new module that crawls Vietnamese derivatives market data (VN30F1M, VN30F2M, VN30 Index), computes Basis/Spread, reuses the existing `wyckoff.py` and `multi_factor.py` engines on VN30F1M, and exposes everything through a new "Phái sinh" (Derivatives) tab on the frontend.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Project Integration](#2-project-integration)
3. [Data Sources for Crawling](#3-data-sources-for-crawling)
4. [Database Schema](#4-database-schema)
5. [Crawler — `client.py` additions](#5-crawler--clientpy-additions)
6. [Store — `store.py` additions](#6-store--storepy-additions)
7. [Basis & Spread Module — `derivatives.py`](#7-basis--spread-module--derivativespy)
8. [Reusing Wyckoff + Multi-factor on VN30F1M](#8-reusing-wyckoff--multi-factor-on-vn30f1m)
9. [Batch Scan — `main.py`](#9-batch-scan--mainpy)
10. [API Routes — `api.py`](#10-api-routes--apipy)
11. [Frontend — New "Phái sinh" Tab](#11-frontend--new-phái-sinh-tab)
12. [Running the Pipeline](#12-running-the-pipeline)
13. [Parameters Reference](#13-parameters-reference)
14. [Prompts for Claude](#14-prompts-for-claude)
15. [FAQ](#15-faq)

---

## 1. Overview

This module adds three things to `stock-analytics`:

1. **A crawler** for VN30F1M, VN30F2M (futures contracts) and VN30 Index (spot) — since this data doesn't exist in your DB yet. **Reuses your existing KBS provider** (`kbbuddywts.kbsec.com.vn`) — no new data source needed.
2. **A basis/spread calculator** — `Basis = F1M − VN30 Index`, `Spread = F1M − F2M`, stored daily.
3. **Reuse of `wyckoff.py` and `multi_factor.py`** directly on VN30F1M — no new analysis code needed, since VN30F1M has the same `{date, open, high, low, close, volume}` shape as stock quotes.
4. **A new frontend tab** — "Phái sinh" — showing VN30F1M price, Basis trend, OI, and the Wyckoff/Multi-factor signals for VN30F1M.

---

## 2. Project Integration

```
stock-analytics/
├── crawler/
│   ├── store.py           ← add derivatives upsert/get methods
│   ├── client.py          ← add fetch functions for F1M/F2M/VN30 Index + OI
│   ├── wyckoff.py          (unchanged — reused directly)
│   ├── multi_factor.py     (unchanged — reused directly)
│   ├── derivatives.py      ← new file: basis/spread calculation
│   ├── api.py              ← add /derivatives routes
│   └── main.py             ← add run_derivatives_scan()
├── db/
│   └── init.sql            ← add derivatives_quotes, derivatives_oi, derivatives_basis tables
└── frontend/
    └── src/
        ├── pages/Derivatives.tsx   ← new page/tab (follow existing page pattern)
        └── App.tsx / nav config    ← add "Phái sinh" tab entry
```

---

## 3. Data Sources for Crawling

You're already crawling from **KB Securities (KBS)** at `kbbuddywts.kbsec.com.vn` — good news: the same API base covers VN30 Index and derivative contracts using the **same endpoint pattern** you already use for stocks. No new provider needed for OHLCV.

### 3.1 KBS endpoints (existing provider — reuse)

Base URL: `https://kbbuddywts.kbsec.com.vn/iis-server/investment`

| Data | Endpoint | Notes |
|---|---|---|
| **VN30 Index OHLCV** | `GET /index/VN30/data_day?sdate=DD-MM-YYYY&edate=DD-MM-YYYY` | Same response shape as stocks: `{"data_day": [{"t","o","h","l","c","v"}]}`. Prices are ×1000 — divide by 1000 like your existing stock parser does. |
| **List of live derivative contracts** | `GET /index/DER/stocks` | Returns an array of current derivative symbols, e.g. `["VN30F2606", "VN30F2607", ...]`. Use this to discover the actual contract codes — see 3.2 below. |
| **Derivative contract OHLCV** | `GET /stocks/{symbol}/data_day?sdate=...&edate=...` | KBS auto-detects asset type by symbol — the same `/stocks/{symbol}/data_{interval}` endpoint your stock crawler already calls works for derivative symbols like `VN30F2606` too. Same `{"data_day": [...]}` shape, same ×1000 price scaling. |

> Since this is the **same provider and endpoint shape** your existing `client.py` already handles for stocks, `fetch_derivatives_quotes()` (Section 5) can likely reuse most of the existing HTTP/parsing logic — just point it at `/index/VN30/data_day` for the index and `/stocks/{contract_code}/data_day` for futures.

### 3.2 Resolving "F1M" / "F2M" to real contract codes

VN30F1M and VN30F2M are not literal KBS symbols — KBS uses dated contract codes like `VN30F2606` (June 2026), `VN30F2607` (July 2026). "F1M" = the contract with the **nearest expiry that hasn't passed yet**; "F2M" = the next one after that.

```python
# Sketch — actual implementation in Prompt 1
def resolve_front_months(today: date) -> tuple[str, str]:
    """
    Call GET /index/DER/stocks to get live contract codes (e.g. VN30F2606, VN30F2607).
    Parse the YYMM from each code, filter to contracts expiring >= today
    (VN30F expires the 3rd Thursday of its month), sort ascending.
    Return (f1m_code, f2m_code) = the two nearest.
    """
```

Run this resolution **once per crawl** (contracts roll monthly) — store the resolved codes alongside the date so `derivatives_quotes` rows for `'VN30F1M'`/`'VN30F2M'` always map to whichever real contract was front-month *on that date*. This naturally builds a continuous series without extra roll-adjustment logic.

### 3.3 Open Interest (OI)

KBS's documented endpoints **do not include Open Interest** — it isn't part of the `/index/{symbol}/data_{interval}` or price-board responses. If you want OI, you'd need a separate source:

| Source | Type | Notes |
|---|---|---|
| **HNX** — `hnx.vn` derivatives market statistics | HTML table / file | HNX is the official exchange for VN30F — OI is part of their daily derivatives statistics, but the exact URL needs verification (HNX restructures its site periodically). |

> **Treat OI as optional** for this integration. Basis, Spread, and Wyckoff/Multi-factor on VN30F1M all work fine without it — `fetch_derivatives_oi()` can simply return `[]` for now (Section 5), and the frontend OI chart (Section 11) is designed to not render when empty. Revisit HNX sourcing later if you want it.

---

## 4. Database Schema

Add to `db/init.sql`:

```sql
-- OHLCV for futures contracts and VN30 index, keyed by symbol
CREATE TABLE IF NOT EXISTS derivatives_quotes (
    symbol      VARCHAR(20)   NOT NULL,   -- 'VN30F1M' | 'VN30F2M' | 'VN30'
    date        DATE          NOT NULL,
    open        NUMERIC(12,2),
    high        NUMERIC(12,2),
    low         NUMERIC(12,2),
    close       NUMERIC(12,2),
    volume      BIGINT,
    PRIMARY KEY (symbol, date)
);

CREATE INDEX IF NOT EXISTS idx_deriv_quotes_date ON derivatives_quotes (date DESC);

-- Open Interest per contract (optional — see Section 3.3)
CREATE TABLE IF NOT EXISTS derivatives_oi (
    symbol          VARCHAR(20)  NOT NULL,
    date            DATE         NOT NULL,
    open_interest   BIGINT,
    oi_change       BIGINT,
    PRIMARY KEY (symbol, date)
);

-- Daily basis & spread, computed from derivatives_quotes
CREATE TABLE IF NOT EXISTS derivatives_basis (
    date            DATE          PRIMARY KEY,
    f1m_close       NUMERIC(12,2),
    f2m_close       NUMERIC(12,2),
    vn30_close      NUMERIC(12,2),
    basis           NUMERIC(12,2),   -- f1m_close - vn30_close
    basis_pct       NUMERIC(8,4),    -- basis / vn30_close * 100
    spread_f1m_f2m  NUMERIC(12,2),   -- f1m_close - f2m_close
    regime          VARCHAR(10),     -- 'PREMIUM' | 'DISCOUNT' | 'NEUTRAL'
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deriv_basis_date ON derivatives_basis (date DESC);
```

### Integration note — `symbols` table

`store.get_wyckoff_signals()` and `get_multifactor_signals()` `JOIN symbols s ON s.symbol = w.symbol`. To reuse those read paths for VN30F1M without modification, insert a synthetic row into `symbols`:

```sql
INSERT INTO symbols (symbol, name, exchange, industry)
VALUES ('VN30F1M', 'VN30 Index Futures (front month)', 'DERIVATIVES', 'Derivatives')
ON CONFLICT (symbol) DO NOTHING;
```

Do this once in `init.sql` or in a setup script — it's what lets `wyckoff_signals` and `multifactor_signals` rows for `VN30F1M` show up correctly in existing list endpoints.

---

## 5. Crawler — `client.py` additions

Two new fetch functions, following the same dataclass-returning pattern as your existing `client.py` (which already returns `DailyQuote`, `Fundamental`, etc. for `store.py` to consume).

```python
# Add to client.py

def fetch_derivatives_quotes(symbol: str, start_date: str, end_date: str) -> list[DailyQuote]:
    """
    Fetch OHLCV history for a derivatives symbol: 'VN30F1M', 'VN30F2M', or 'VN30'.
    Returns the same DailyQuote dataclass used for stock quotes — so
    store.upsert_quotes()-style logic can be reused with minimal changes.
    """
    # Implementation uses the existing KBS provider (kbbuddywts.kbsec.com.vn) — see Section 3.

def fetch_derivatives_oi(symbol: str, start_date: str, end_date: str) -> list[dict]:
    """
    Fetch daily Open Interest for a derivatives symbol.
    Returns list of {date, open_interest, oi_change}.
    Optional — return [] if OI source is unavailable; downstream code must handle empty OI gracefully.
    """
```

> The exact HTTP calls / parsing inside these two functions are implemented in **Prompt 1** (Section 14) — Claude will inspect the live data source and write the parser against real responses.

---

## 6. Store — `store.py` additions

Three new methods, following the exact pattern of `upsert_quotes` / `get_symbol_quotes` / `upsert_wyckoff_signal`.

```python
# ── Derivatives ──────────────────────────────────────────────────────────

def upsert_derivatives_quotes(self, symbol: str, quotes: list[DailyQuote]) -> int:
    """Same pattern as upsert_quotes(), but writes to derivatives_quotes
    keyed by (symbol, date) — symbol is 'VN30F1M' | 'VN30F2M' | 'VN30'."""

def get_derivatives_quotes(self, symbol: str, days: int = 300) -> list[dict]:
    """Same pattern as get_symbol_quotes() — returns oldest→newest list of
    {date, open, high, low, close, volume} for the given derivatives symbol."""

def upsert_derivatives_oi(self, symbol: str, oi_rows: list[dict]) -> int:
    """Upsert into derivatives_oi, ON CONFLICT (symbol, date) DO UPDATE."""

def get_derivatives_oi(self, symbol: str, days: int = 300) -> list[dict]:
    """Returns oldest→newest list of {date, open_interest, oi_change}."""

# ── Basis ────────────────────────────────────────────────────────────────

def upsert_basis(self, rows: list[dict]) -> int:
    """Upsert into derivatives_basis, ON CONFLICT (date) DO UPDATE.
    Each row: {date, f1m_close, f2m_close, vn30_close, basis, basis_pct,
               spread_f1m_f2m, regime}."""

def get_basis(self, days: int = 90) -> list[dict]:
    """Returns oldest→newest list of basis rows for charting."""
```

---

## 7. Basis & Spread Module — `derivatives.py`

New file, `crawler/derivatives.py`. Pure computation — no I/O, takes lists of dicts in, returns lists of dicts out (same style as `wyckoff.py`).

```python
"""
Derivatives analytics: Basis and Calendar Spread for VN30F1M.

Basis  = F1M close - VN30 Index close
Spread = F1M close - F2M close
"""

from __future__ import annotations


def compute_basis(
    f1m: list[dict],
    f2m: list[dict],
    vn30: list[dict],
    premium_threshold_pct: float = 0.3,
    discount_threshold_pct: float = -0.3,
) -> list[dict]:
    """
    Align f1m, f2m, vn30 by date (inner join — only dates present in all three)
    and compute basis/spread for each date.

    Returns list of dicts:
      {date, f1m_close, f2m_close, vn30_close, basis, basis_pct,
       spread_f1m_f2m, regime}

    regime classification (based on basis_pct):
      basis_pct >  premium_threshold_pct   -> 'PREMIUM'
      basis_pct <  discount_threshold_pct  -> 'DISCOUNT'
      otherwise                            -> 'NEUTRAL'
    """
    # 1. Index f1m, f2m, vn30 by date
    # 2. For each date present in all three:
    #      basis = f1m.close - vn30.close
    #      basis_pct = basis / vn30.close * 100
    #      spread = f1m.close - f2m.close
    #      regime = classify per thresholds above
    # 3. Return sorted oldest -> newest
    ...
```

### Tunable thresholds

| Parameter | Default | Meaning |
|---|---|---|
| `premium_threshold_pct` | `0.3` | Basis > +0.3% of VN30 → `PREMIUM` regime |
| `discount_threshold_pct` | `-0.3` | Basis < -0.3% of VN30 → `DISCOUNT` regime |

Tune these after looking at a few months of real basis data — VN30F1M's typical basis range depends on prevailing interest rates and market sentiment, and may need recalibration.

---

## 8. Reusing Wyckoff + Multi-factor on VN30F1M

This is the key integration point — **no changes needed to `wyckoff.py` or `multi_factor.py`**. Both already operate on `list[dict]` with `{date, open, high, low, close, volume}`, which is exactly what `get_derivatives_quotes('VN30F1M')` returns.

```python
from wyckoff import analyze as wyckoff_analyze
from multi_factor import analyze as mf_analyze

bars = store.get_derivatives_quotes('VN30F1M', days=300)

wyckoff_result = wyckoff_analyze('VN30F1M', bars, lookback=260)
store.upsert_wyckoff_signal(wyckoff_result)

mf_result = mf_analyze('VN30F1M', bars)
store.upsert_multifactor_signal(mf_result)
```

Because of the synthetic `symbols` row added in Section 4, `store.get_wyckoff_signal('VN30F1M')` and `store.get_multifactor_signal('VN30F1M')` work immediately — and `get_wyckoff_signals()` / `get_multifactor_signals()` (the list endpoints) will include VN30F1M alongside stocks unless you filter it out.

> **Optional refinement** (see Prompts, "Add new factor" style extension): once `derivatives_basis` has data, you could add a 5th scoring factor to `multi_factor.py` — e.g. "Basis confirms direction" — but this is a later enhancement, not required for the initial integration.

---

## 9. Batch Scan — `main.py`

```python
from derivatives import compute_basis
from wyckoff import analyze as wyckoff_analyze
from multi_factor import analyze as mf_analyze

def run_derivatives_scan(store: Store):
    # 1. Crawl latest quotes for F1M, F2M, VN30 index
    for symbol in ('VN30F1M', 'VN30F2M', 'VN30'):
        quotes = fetch_derivatives_quotes(symbol, start_date=..., end_date=...)
        store.upsert_derivatives_quotes(symbol, quotes)

    # 2. Crawl OI (optional — skip gracefully if source unavailable)
    for symbol in ('VN30F1M', 'VN30F2M'):
        oi_rows = fetch_derivatives_oi(symbol, start_date=..., end_date=...)
        if oi_rows:
            store.upsert_derivatives_oi(symbol, oi_rows)

    # 3. Compute and store basis/spread
    f1m  = store.get_derivatives_quotes('VN30F1M', days=120)
    f2m  = store.get_derivatives_quotes('VN30F2M', days=120)
    vn30 = store.get_derivatives_quotes('VN30', days=120)
    basis_rows = compute_basis(f1m, f2m, vn30)
    store.upsert_basis(basis_rows)

    # 4. Run Wyckoff + Multi-factor on VN30F1M
    bars = store.get_derivatives_quotes('VN30F1M', days=300)
    store.upsert_wyckoff_signal(wyckoff_analyze('VN30F1M', bars, lookback=260))
    store.upsert_multifactor_signal(mf_analyze('VN30F1M', bars))
```

Call after the existing scans in `main.py`:

```python
run_wyckoff_scan(store)
run_multifactor_scan(store)
run_derivatives_scan(store)   # add this line
```

---

## 10. API Routes — `api.py`

```python
@app.get("/derivatives/quotes/{symbol}")
def get_derivatives_quotes(symbol: str, days: int = Query(120)):
    return store.get_derivatives_quotes(symbol.upper(), days)

@app.get("/derivatives/basis")
def get_basis(days: int = Query(90)):
    return store.get_basis(days)

@app.get("/derivatives/oi/{symbol}")
def get_oi(symbol: str, days: int = Query(90)):
    return store.get_derivatives_oi(symbol.upper(), days)

@app.get("/derivatives/summary")
def derivatives_summary():
    """One-call endpoint for the frontend tab: latest quote, latest basis,
    Wyckoff signal, and Multi-factor signal for VN30F1M."""
    return {
        "quote":      store.get_derivatives_quotes('VN30F1M', days=1),
        "basis":      store.get_basis(days=1),
        "wyckoff":    store.get_wyckoff_signal('VN30F1M'),
        "multifactor": store.get_multifactor_signal('VN30F1M'),
    }
```

The `/derivatives/summary` endpoint is the main one the frontend tab will call on load — it bundles everything into one response so the new tab doesn't need 4 separate fetches.

---

## 11. Frontend — New "Phái sinh" Tab

Since I don't have your `frontend/src` structure in context, the implementation prompt (Section 14, Prompt 6) asks Claude to **first inspect an existing tab/page** (e.g. however the Wyckoff signals list is currently displayed) and follow that exact pattern — same component structure, same data-fetching approach (React Query / fetch / axios — whatever you already use), same styling conventions (Tailwind classes already in use).

### What the new tab should show

| Section | Data source | Suggested visual |
|---|---|---|
| VN30F1M price chart | `GET /derivatives/quotes/VN30F1M` | Candlestick or line chart, last 60-120 days |
| Basis trend | `GET /derivatives/basis` | Line chart with a zero-line; color by `regime` (PREMIUM/DISCOUNT/NEUTRAL) |
| Open Interest | `GET /derivatives/oi/VN30F1M` | Bar chart, only render if data is non-empty (OI is optional per Section 3.3) |
| Wyckoff signal card | `GET /derivatives/summary` → `.wyckoff` | Same signal card component used for stocks — phase, signal, entry/stop |
| Multi-factor score card | `GET /derivatives/summary` → `.multifactor` | Same score breakdown component used for stocks |

### Navigation

Add a "Phái sinh" entry to the existing tab/nav configuration (wherever the current tabs — e.g. "Tổng quan", "Wyckoff", "Multi-factor" — are defined), pointing to the new page/route.

---

## 12. Running the Pipeline

### One-time setup

```bash
# 1. Add derivatives_quotes, derivatives_oi, derivatives_basis tables + synthetic
#    VN30F1M symbol row (Section 4) to your database
psql $DATABASE_URL -f db/init.sql

# 2. No new dependencies needed — reuses your existing KBS HTTP client (Section 3.1)
pip install -r crawler/requirements.txt
```

### Daily run

```python
from store import Store
from main import run_derivatives_scan
import os

store = Store(os.environ["DATABASE_URL"])
run_derivatives_scan(store)
```

Add this call to your existing daily cron/scheduler alongside `run_wyckoff_scan` and `run_multifactor_scan`.

---

## 13. Parameters Reference

| Parameter | Location | Default | Notes |
|---|---|---|---|
| `premium_threshold_pct` | `derivatives.compute_basis()` | `0.3` | % above which basis is classified PREMIUM |
| `discount_threshold_pct` | `derivatives.compute_basis()` | `-0.3` | % below which basis is classified DISCOUNT |
| `lookback` (Wyckoff on F1M) | `wyckoff_analyze('VN30F1M', bars, lookback=...)` | `260` | Same default as stocks — may need a shorter lookback since F1M is a rolled/continuous series with monthly contract switches; revisit after seeing real data |
| `days` (quote history fetched) | `get_derivatives_quotes(..., days=...)` | `120-300` | Larger for Wyckoff (needs lookback+buffer), smaller for basis (only needs overlap window) |

### Tuning tips

**Basis regime always NEUTRAL:** VN30F1M basis in VN typically ranges narrower than ±0.3% in calm periods. Lower both thresholds to ±0.15% and observe distribution over a few weeks before settling on final values.

**Wyckoff on VN30F1M gives different phases than on the underlying VN30 stocks:** this is expected — futures often lead spot. Treat divergence between VN30F1M's Wyckoff phase and the broader market's phase as a signal worth investigating, not a bug.

**OI table stays empty:** if `fetch_derivatives_oi()` returns `[]` consistently, the OI source needs re-investigation (Section 3.3). The frontend OI chart should simply not render in this case — don't block the rest of the pipeline on OI.

---

## 14. Prompts for Claude

Use these **in order**. Each assumes Claude has the relevant existing file (`client.py`, `store.py`, `wyckoff.py`, `multi_factor.py`, frontend tab component) pasted into context.

### Prompt 1 — Crawler functions in `client.py`

```
I need to add derivatives data fetching to crawler/client.py. Here is the
current client.py, including however it currently fetches stock OHLCV from
kbbuddywts.kbsec.com.vn: [paste client.py]

Add three functions, reusing the existing KBS HTTP/parsing helper if there
is one (same base URL, same response shape, same ×1000 price scaling):

1. fetch_derivative_symbols() -> list[str]
   GET https://kbbuddywts.kbsec.com.vn/iis-server/investment/index/DER/stocks
   Returns the raw list of live derivative contract codes (e.g. ['VN30F2606', 'VN30F2607', ...]).

2. resolve_front_months(symbols: list[str], today: date | None = None) -> tuple[str, str]
   Parse the YYMM from each VN30F contract code, filter to contracts whose
   expiry (3rd Thursday of that month) is >= today, sort ascending by expiry,
   and return (f1m_code, f2m_code) — the two nearest contracts.
   Default today = date.today().

3. fetch_derivatives_quotes(symbol: str, start_date: str, end_date: str) -> list[DailyQuote]
   symbol is one of 'VN30F1M', 'VN30F2M', or 'VN30'.
   - If symbol == 'VN30': call
     GET https://kbbuddywts.kbsec.com.vn/iis-server/investment/index/VN30/data_day
     with sdate/edate in DD-MM-YYYY format.
   - If symbol == 'VN30F1M' or 'VN30F2M': call fetch_derivative_symbols() +
     resolve_front_months() to get the real contract code, then call
     GET https://kbbuddywts.kbsec.com.vn/iis-server/investment/stocks/{contract_code}/data_day
     with the same sdate/edate params.
   Both return {"data_day": [{"t","o","h","l","c","v"}, ...]} — map to
   DailyQuote the same way the existing stock fetcher does (o/h/l/c ÷ 1000).

Also add a stub:

4. fetch_derivatives_oi(symbol: str, start_date: str, end_date: str) -> list[dict]
   KBS does not provide Open Interest. Return [] and log.warning once that
   OI is unavailable from this provider — don't raise.

Show me all four functions plus a short test script that calls
fetch_derivative_symbols(), prints the resolved F1M/F2M codes, then calls
fetch_derivatives_quotes() for 'VN30', 'VN30F1M', 'VN30F2M' and prints the
first and last 3 rows of each — so I can verify against real data before
wiring into store.py.
```

### Prompt 2 — `store.py` methods

```
Add the derivatives persistence methods to store.py, following the exact
same patterns as upsert_quotes/get_symbol_quotes and upsert_wyckoff_signal.
Here is store.py: [paste store.py]

Add:
- upsert_derivatives_quotes(symbol, quotes) -> int
- get_derivatives_quotes(symbol, days=300) -> list[dict]
- upsert_derivatives_oi(symbol, oi_rows) -> int
- get_derivatives_oi(symbol, days=300) -> list[dict]
- upsert_basis(rows) -> int
- get_basis(days=90) -> list[dict]

Tables: derivatives_quotes (symbol, date, open, high, low, close, volume),
derivatives_oi (symbol, date, open_interest, oi_change),
derivatives_basis (date, f1m_close, f2m_close, vn30_close, basis, basis_pct,
spread_f1m_f2m, regime).

derivatives_quotes and derivatives_oi use ON CONFLICT (symbol, date) DO UPDATE.
derivatives_basis uses ON CONFLICT (date) DO UPDATE.
```

### Prompt 3 — `db/init.sql` additions

```
Add the derivatives_quotes, derivatives_oi, derivatives_basis tables (with
indexes) from README_DERIVATIVES.md Section 4 to db/init.sql. Use
CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS. Also add the
INSERT for the synthetic VN30F1M row into the symbols table
(ON CONFLICT (symbol) DO NOTHING), placed after the symbols table definition.
```

### Prompt 4 — `derivatives.py` (basis/spread module)

```
Create crawler/derivatives.py implementing compute_basis(f1m, f2m, vn30,
premium_threshold_pct=0.3, discount_threshold_pct=-0.3) -> list[dict] as
specified in README_DERIVATIVES.md Section 7.

f1m, f2m, vn30 are each list[dict] of {date, open, high, low, close, volume}
oldest-to-newest (same shape as wyckoff.py's bars input).

Inner-join by date (only dates present in all three series). For each date
compute basis, basis_pct, spread_f1m_f2m, and classify regime as
PREMIUM/DISCOUNT/NEUTRAL per the thresholds. Use only the Python standard
library, following the code style of wyckoff.py (helper functions, type
hints, docstrings). Return sorted oldest -> newest.

Also write 3-4 small pytest tests with synthetic data covering: normal case,
a date missing from f2m (should be excluded), and basis exactly at the
threshold boundary.
```

### Prompt 5 — `main.py` and `api.py` wiring

```
1. In crawler/main.py, add run_derivatives_scan(store) from
   README_DERIVATIVES.md Section 9. Import fetch_derivatives_quotes,
   fetch_derivatives_oi from client.py, compute_basis from derivatives.py,
   analyze from wyckoff.py and multi_factor.py. Call it after
   run_multifactor_scan(store) in the existing scan sequence.
   Here is main.py: [paste main.py]

2. In crawler/api.py, add the four routes from Section 10:
   GET /derivatives/quotes/{symbol}
   GET /derivatives/basis
   GET /derivatives/oi/{symbol}
   GET /derivatives/summary
   Follow the existing router/style pattern. Here is api.py: [paste api.py]
```

### Prompt 6 — Frontend "Phái sinh" tab

```
I want to add a new "Phái sinh" (Derivatives) tab to the frontend. Here is
how an existing tab/page is built — please follow this exact pattern for
component structure, data fetching, and styling:
[paste an existing tab/page component, e.g. the Wyckoff signals page]

And here is the nav/tab configuration file: [paste nav config]

Create a new page that:
1. Calls GET /derivatives/summary on load for the Wyckoff signal,
   Multi-factor score, latest VN30F1M quote, and latest basis value
2. Shows a price chart for VN30F1M (GET /derivatives/quotes/VN30F1M, last 90 days)
3. Shows a basis trend line chart (GET /derivatives/basis, last 90 days),
   with a horizontal zero-line and color-coding by regime
   (PREMIUM/DISCOUNT/NEUTRAL)
4. Shows an Open Interest bar chart (GET /derivatives/oi/VN30F1M) —
   only render this section if the response array is non-empty
5. Reuses the existing Wyckoff signal card and Multi-factor score card
   components (don't rebuild them)

Add a "Phái sinh" entry to the tab navigation pointing to this new page.
```

### Debug prompt

```
run_derivatives_scan(store) is failing / returning unexpected data.
Here is the error / output: [paste error or unexpected result]
Here is what fetch_derivatives_quotes('VN30F1M', ...) returned: [paste sample]
Here is what compute_basis(...) returned: [paste sample]
Diagnose and suggest a fix.
```

---

## 15. FAQ

**Q: Do I need Open Interest data for this to be useful?**
A: No. Basis, Spread, and Wyckoff/Multi-factor on VN30F1M all work without OI. Treat OI as a "nice to have" — implement Prompt 1's OI fetcher, and if it consistently returns `[]`, move on. You can revisit OI sourcing later without touching anything else.

**Q: Why does VN30F1M need a row in the `symbols` table?**
A: `get_wyckoff_signals()` and `get_multifactor_signals()` `JOIN symbols`. Without a `symbols` row for `VN30F1M`, those joins would silently exclude it from list views. The synthetic row (Section 4) fixes this with zero changes to existing query logic.

**Q: The roll-over (contract month switching) seems complicated — do I need to handle it myself?**
A: `resolve_front_months()` (Prompt 1) handles this — it reads the live contract list from `/index/DER/stocks` and picks the two nearest-expiry codes every time the crawler runs. Since the crawl runs daily, the F1M/F2M mapping naturally updates itself across the monthly roll without any manual mapping table.

**Q: Can I run Wyckoff/Multi-factor on VN30F2M too, not just F1M?**
A: Yes — same code, just call `wyckoff_analyze('VN30F2M', bars)` with `bars = store.get_derivatives_quotes('VN30F2M', days=300)`, and add a second synthetic `symbols` row for `VN30F2M`. F2M has lower liquidity though, so signals may be noisier.

**Q: How often should `run_derivatives_scan` run?**
A: Once per day after market close, same cadence as `run_wyckoff_scan` and `run_multifactor_scan` — VN30F1M is a daily-bar analysis in this setup, not intraday.

**Q: The basis regime classification feels arbitrary — how do I know if ±0.3% is right?**
A: It's a starting point, not a calibrated value. After a few weeks of real `derivatives_basis` data, query the distribution of `basis_pct` and pick thresholds around the 25th/75th percentile so PREMIUM/DISCOUNT represent genuinely unusual readings rather than the everyday baseline.
