# Wyckoff Optimized — `crawler/wyckoff_opt.py` + `crawler/backtest.py`

A full pipeline that backtests and optimizes the Wyckoff model on VN100 stocks using VNIndex data from 2014–2025. Targets 20–30% annual return with a capital of X (100M–2B VND), portfolio of max 8 simultaneous positions, and automatic market regime detection (UPTREND / DOWNTREND / SIDEWAYS) to exit all positions during downtrend.

---

## Table of Contents

1. [Overview & Architecture](#1-overview--architecture)
2. [Project Integration](#2-project-integration)
3. [Indicators — Full Set](#3-indicators--full-set)
4. [VNIndex Regime Detection](#4-vnindex-regime-detection)
5. [Ecosystem Groups (Vingroup / Gelex)](#5-ecosystem-groups-vingroup--gelex)
6. [Sector Rotation Module](#6-sector-rotation-module)
7. [Portfolio Manager](#7-portfolio-manager)
8. [Backtest Engine](#8-backtest-engine)
9. [Optimizer (Grid Search)](#9-optimizer-grid-search)
10. [Database Schema](#10-database-schema)
11. [Store — `store.py` additions](#11-store--storepy-additions)
12. [API Routes — `api.py`](#12-api-routes--apipy)
13. [Frontend — Chart with Indicators](#13-frontend--chart-with-indicators)
14. [Running the Pipeline](#14-running-the-pipeline)
15. [Parameters Reference](#15-parameters-reference)
16. [Prompts for Claude](#16-prompts-for-claude)
17. [FAQ](#17-faq)

---

## 1. Overview & Architecture

### What this module adds

| Component | File | Purpose |
|---|---|---|
| Indicator engine | `wyckoff_opt.py` | 11 indicators computed on top of OHLCV — feeds Wyckoff events + filters |
| Regime detector | `regime.py` | Classifies VNIndex as UPTREND / DOWNTREND / SIDEWAYS each day |
| Sector rotator | `sector_rotation.py` | Ranks sectors by relative strength — only trade leading sectors |
| Portfolio manager | `portfolio.py` | Allocates capital across max 8 positions, enforces hold limit (1 year) |
| Backtest engine | `backtest.py` | Simulates 2014–2025 using walk-forward splits, records all trades |
| Optimizer | `optimizer.py` | Grid-searches parameter space, selects best params per regime |

### Success criteria

| Metric | Target |
|---|---|
| Annual return (UPTREND years: 2017, 2021, 2025) | ≥ 40% |
| Annual return (SIDEWAYS years: 2018, 2019, 2023) | ≥ 20% |
| Annual return (DOWNTREND years: 2022) | ≥ 0% (market avoidance = success) |
| Max drawdown | ≤ 25% |
| Win rate | ≥ 55% |
| Avg holding period | 20–180 trading days |

### Key design decisions

- **Capital X is a runtime parameter** (not hardcoded) — the backtest runs the same logic regardless of X; position sizing scales proportionally.
- **Max 8 simultaneous positions** — equal-weight by default (X/8 per slot), with optional overweight for high-conviction signals.
- **Downtrend exit** — when VNIndex regime switches to DOWNTREND, all positions are flagged for exit at next open, not sold at close of detection day (avoids look-ahead bias).
- **Max hold 1 year (260 trading days)** — any position still open after 260 days is force-sold at market open on day 261.
- **Walk-forward optimization** — never optimize on the same data used for evaluation; 3-year rolling train window, 1-year test window.
- **Indicator pruning** — after initial backtest, features with information coefficient (IC) < 0.02 are flagged for removal; final indicator set is determined by data, not by assumption.

---

## 2. Project Integration

```
stock-analytics/
├── crawler/
│   ├── store.py              ← add backtest result persistence
│   ├── wyckoff.py             (existing — enhanced by wyckoff_opt.py)
│   ├── wyckoff_opt.py         ← new: extended indicator engine
│   ├── regime.py              ← new: VNIndex regime detector
│   ├── sector_rotation.py     ← new: sector / ecosystem ranking
│   ├── portfolio.py           ← new: position sizing & hold-limit logic
│   ├── backtest.py            ← new: simulation engine (2014–2025)
│   ├── optimizer.py           ← new: grid search over parameter space
│   ├── api.py                 ← add /backtest and /regime routes
│   └── main.py                ← add daily run_live_wyckoff_opt()
├── db/
│   └── init.sql               ← add backtest_runs, backtest_trades, regime_history tables
└── frontend/
    └── src/
        └── pages/WyckoffOpt.tsx  ← new chart page with 4 panes + backtest results tab
```

### Relationship to existing `wyckoff.py`

`wyckoff_opt.py` does **not replace** `wyckoff.py`. It wraps it:
- Calls the existing `analyze()` to get phase/signal/events
- Then adds the new indicators on top as additional filters
- The optimized entry/exit rules live in `wyckoff_opt.py`, not in the original file

This means the existing Wyckoff dashboard keeps working unchanged.

---

## 3. Indicators — Full Set

### 3.1 Existing indicators (from `wyckoff.py`) — kept as-is

| Indicator | Computation | Role in model |
|---|---|---|
| Volume MA(20) | `mean(volume[-20:])` | Baseline for SC/BC/SOS/Spring detection |
| Spread | `high - low` | Climax bar identification |
| Close Position | `(close-low)/(high-low)` | Bar sentiment (demand vs supply) |
| MA20 / MA50 / MA200 | Simple moving averages | Trend direction for `_classify_phase()` |
| Swing Pivot S/R | Pivot-point detection over `range_bars` | Support / Resistance levels |

### 3.2 New indicators added in `wyckoff_opt.py`

All computed from `{date, open, high, low, close, volume}` using only Python stdlib + `statistics` — no external dependencies, same style as `wyckoff.py`.

#### RSI (14) — Wilder smoothing

```
Purpose : Filter BUY signals — only buy when RSI < 50 (not overbought yet).
          Flag SELL when RSI > 70 on a position already held.
Formula : Standard Wilder RSI(14). Rising = momentum improving.
Buy filter: RSI between 30–50 AND rising over last 3 bars = pass.
            RSI > 65 at entry = skip this signal.
```

#### MACD (12, 26, 9)

```
Purpose : Confirm momentum shift at SOS and LPS events.
Formula : MACD_line = EMA12 - EMA26. Signal = EMA9(MACD_line). Hist = MACD - Signal.
Buy filter: MACD hist turning positive (cross above zero) within last 5 bars = +1 confirmation.
Chart   : Plot as histogram on pane 3 with RSI.
```

#### ATR (14)

```
Purpose : Dynamic stop-loss calculation — replaces fixed % stop.
Formula : TR = max(high-low, |high-prev_close|, |low-prev_close|). ATR = RMA(TR,14).
Stop-loss: entry_price - 2.0 × ATR(14) at time of entry.
           Updated daily — if price moves up, trail stop up; never move stop down.
Chart   : Not plotted directly. ATR-based stop line plotted on pane 1 candles.
```

#### Bollinger Bands (20, 2σ)

```
Purpose : BB squeeze before Spring = high-conviction accumulation signal.
          Lower band acts as dynamic support reinforcing Wyckoff support level.
Formula : Mid = MA20. Upper = Mid + 2×stdev(close,20). Lower = Mid - 2×stdev(close,20).
          BB Width = (Upper - Lower) / Mid.
Squeeze : BB Width < 0.05 (low volatility) → imminent breakout signal.
Spring filter: Spring bar touching or crossing Lower Band = Spring quality upgrade.
Chart   : Upper/Lower/Mid bands overlaid on pane 1 candlestick.
```

#### Volume Rate of Change (VROC, 5)

```
Purpose : Early detection of volume expansion before price moves.
Formula : VROC = (volume[-1] - volume[-6]) / volume[-6] × 100
Signal  : VROC > 80% (volume nearly doubled vs 5 days ago) = strong interest.
          Used alongside climax_vol to filter noisy volume spikes.
```

#### Force Index (13)

```
Purpose : Pure Wyckoff-lineage indicator — measures actual buying/selling force.
Formula : FI_raw = (close - prev_close) × volume. FI = EMA(FI_raw, 13).
Signal  : FI turning positive during accumulation = demand absorbing supply.
          FI large negative spike = Selling Climax confirmation (SC signal upgrade).
Chart   : Plotted as line on pane 2 alongside volume bars.
```

#### Chaikin Money Flow (CMF, 20)

```
Purpose : Confirms accumulation/distribution via money flow.
Formula : MFV = ((close-low)-(high-close))/(high-low) × volume (per bar).
          CMF = sum(MFV, 20) / sum(volume, 20).
Signal  : CMF > 0.05 during Phase C/D = smart money buying. CMF < -0.05 = distribution.
Chart   : Plotted as histogram on pane 2, color-coded green/red.
```

#### Stochastic RSI (14, 3, 3) — optional, drop if IC < 0.02

```
Purpose : More sensitive overbought/oversold than RSI alone.
Formula : StochRSI = (RSI - min(RSI,14)) / (max(RSI,14) - min(RSI,14))
          %K = SMA(StochRSI, 3). %D = SMA(%K, 3).
Signal  : %K crossing %D while both < 0.2 = oversold recovery — Spring quality upgrade.
Drop condition: If IC(StochRSI signal, 10d return) < 0.02 after backtest → remove.
```

#### Relative Strength vs VN100 (20-day)

```
Purpose : Buy the stocks leading the index, not the laggards.
Formula : RS = (stock_return_20d / vn100_return_20d)
Signal  : RS > 1.1 = stock outperforming, valid for entry.
          RS < 0.9 = stock underperforming index — skip even if Wyckoff says BUY.
```

### 3.3 Indicator pruning after backtest

After running the full 2014–2025 backtest, compute **Information Coefficient (IC)** for each indicator signal vs 20-day forward return:

```python
# For each indicator feature:
IC = pearsonr(indicator_signal_series, forward_return_20d)[0]
# Drop indicator from model if abs(IC) < 0.02
```

Expected outcome based on similar markets: RSI, ATR, Force Index, BB Squeeze tend to survive. StochRSI and VROC may be redundant and get dropped.

---

## 4. VNIndex Regime Detection

File: `crawler/regime.py`

This is the most critical module for capital preservation — getting out during 2022-style downtrends is what makes the 0% floor possible.

### 4.1 Regime classification logic

Three-layer confirmation required — all three must agree before switching regime:

```
Layer 1 — Trend (MA):
  MA50 > MA200 AND MA20 > MA50         → UPTREND signal
  MA50 < MA200 AND MA20 < MA50         → DOWNTREND signal
  Otherwise                            → SIDEWAYS signal

Layer 2 — Momentum (MACD on VNIndex):
  MACD hist > 0 and rising             → positive
  MACD hist < 0 and falling            → negative
  Otherwise                            → neutral

Layer 3 — Breadth (A/D if available, else VNIndex vs MA):
  VNIndex close > MA20 > MA50          → strong
  VNIndex close < MA20 < MA50          → weak
  Otherwise                            → neutral

Final regime:
  All 3 layers positive  → UPTREND   (green background on chart)
  All 3 layers negative  → DOWNTREND (red background on chart)
  Mixed signals          → SIDEWAYS  (yellow background on chart)
```

### 4.2 Regime confirmation with Wyckoff on VNIndex itself

Before switching to DOWNTREND, require at least one of:
- VNIndex in Wyckoff `Distribution` phase (BC detected, sub-phase C or D)
- VNIndex closes below MA200 for 3 consecutive days
- VNIndex drawdown from recent 60-day high > 10%

Before switching back to UPTREND from DOWNTREND, require:
- VNIndex in Wyckoff `Accumulation` phase (SC detected, LPS or SOS confirmed)
- VNIndex closes above MA50 for 5 consecutive days
- VNIndex has recovered ≥ 8% from the DOWNTREND low

### 4.3 Regime-specific parameter sets

The optimizer runs separately for each regime. This produces three parameter sets:

| Parameter | UPTREND | SIDEWAYS | DOWNTREND |
|---|---|---|---|
| `climax_vol` multiplier | 1.8× | 2.0× | — (no entry) |
| RSI entry ceiling | 55 | 45 | — |
| BB squeeze threshold | 0.06 | 0.04 | — |
| Stop-loss ATR multiplier | 2.5× | 1.8× | 1.5× (exit existing) |
| Max positions | 8 | 5 | 0 (exit all) |
| Min Wyckoff phase | Accumulation B+ | Accumulation C+ | — |

> These are **initial values** — the optimizer will replace them with data-driven values after the backtest.

### 4.4 Downtrend exit — computed inside the backtest loop, not in portfolio.py

Regime detection and the resulting exit decision happen **inside `backtest.py`'s main simulation loop**, on every iteration. `portfolio.py` only provides the `close_position()` primitive — it has no regime awareness of its own.

```python
# Inside backtest.py simulation loop — NOT in portfolio.py
for date in all_dates:
    # Regime is computed fresh from historical VNIndex bars up to (not including) this date
    regime = detect_regime_on_date(vnindex_bars, date_idx=i, params=params)

    if regime == 'DOWNTREND':
        # Exit all open positions at next day's open — decided here in the backtest loop
        for pos in portfolio.open_positions[:]:
            next_open = get_open_price(all_bars[pos.symbol], i + 1)
            close_position(portfolio, pos,
                           exit_date=all_dates[i + 1],
                           exit_price=next_open,
                           reason='REGIME_EXIT')
        # Skip scanning for new entries on DOWNTREND days
        continue

    # ... rest of the loop: stop updates, Wyckoff exits, new entries
```

This means:
- `regime.py` provides `detect_regime_on_date(vnindex_bars, date_idx, params)` — pure computation, no portfolio state
- `portfolio.py` provides `close_position()` — pure position bookkeeping, no regime logic
- `backtest.py` is the only place that connects regime → exit decision
- The same pattern applies to the **live daily run**: `main.py` calls `detect_regime_today()` then decides what to do — `portfolio.py` never needs to know about regimes

---

## 5. Ecosystem Groups (Vingroup / Gelex)

File: `crawler/sector_rotation.py` — `ECOSYSTEM_GROUPS` dict

Stocks in the same ecosystem move together because of shared controlling shareholder — treat them as a single "meta-stock" with correlated signals.

```python
ECOSYSTEM_GROUPS = {
    'VINGROUP': ['VIC', 'VHM', 'VRE', 'VPL'],
    'GELEX':    ['VIX', 'VGC', 'GEX', 'GEE', 'EIB'],
}

def get_ecosystem(symbol: str) -> str | None:
    """Return the ecosystem name if symbol belongs to one, else None."""
    for name, members in ECOSYSTEM_GROUPS.items():
        if symbol in members:
            return name
    return None
```

### Ecosystem signal aggregation rules

1. **Ecosystem BUY:** If ≥ 2 members of the same group show Wyckoff `Accumulation C+` or `BUY` signal simultaneously → treat as a high-conviction ecosystem-level BUY. Can allocate up to 2 position slots to the ecosystem (2 strongest members).

2. **Ecosystem EXIT:** If ≥ 2 members show `Distribution C+` or regime turns DOWNTREND → exit all ecosystem positions, not just the signaling member.

3. **Portfolio limit:** Even in a strong ecosystem signal, max 2 out of 8 slots can be occupied by the same ecosystem (prevents over-concentration).

---

## 6. Sector Rotation Module

File: `crawler/sector_rotation.py`

Uses the existing industry groupings already in your `frontend/src` Industry tab — no new DB schema needed, sector is already in `symbols.industry`.

### 6.1 Relative Strength ranking

```python
def rank_sectors(store: Store, lookback: int = 20) -> list[dict]:
    """
    For each sector in symbols.industry:
      1. Get all VN100 symbols in that sector
      2. Compute average 20-day return of the sector
      3. Compare to VNIndex 20-day return
      4. RS_sector = sector_avg_return / vnindex_return
    Return sectors sorted by RS descending.
    """
```

### 6.2 Sector filter for entry

```python
# In wyckoff_opt.py signal generation
TOP_N_SECTORS = 3  # only trade stocks in the top 3 sectors by relative strength

def is_sector_leading(symbol: str, sector_ranking: list) -> bool:
    symbol_sector = get_symbol_sector(symbol)
    top_sectors = [s['sector'] for s in sector_ranking[:TOP_N_SECTORS]]
    return symbol_sector in top_sectors
```

During UPTREND: trade top 3 sectors.
During SIDEWAYS: only top 1–2 sectors.
During DOWNTREND: no sector entry (regime exit overrides everything).

---

## 7. Portfolio Manager

File: `crawler/portfolio.py`

```python
@dataclass
class Position:
    symbol:        str
    entry_date:    str
    entry_price:   float
    shares:        int           # floor(allocation / entry_price)
    stop_loss:     float         # entry_price - 2.0 × ATR at entry
    trailing_stop: float         # updated daily, never moves down
    max_hold_days: int = 260     # 1 year = 260 trading days
    exit_date:     str | None = None
    exit_price:    float | None = None
    exit_type:     str | None = None  # 'STOP_LOSS' | 'WYCKOFF_EXIT' | 'REGIME_EXIT' | 'MAX_HOLD' | 'MANUAL'

@dataclass
class Portfolio:
    capital:          float         # X — total capital
    cash:             float         # available cash
    open_positions:   list[Position]
    closed_positions: list[Position]
    max_positions:    int = 8

    def allocation_per_slot(self) -> float:
        """Equal weight: capital / max_positions per slot."""
        return self.capital / self.max_positions

    def can_open(self) -> bool:
        return len(self.open_positions) < self.max_positions

    def open_slots(self) -> int:
        return self.max_positions - len(self.open_positions)
```

### Position sizing

```
allocation = portfolio.capital / max_positions   # equal weight
shares = floor(allocation / entry_price)
actual_cost = shares × entry_price
# remaining cash stays idle (no leverage)
```

### Exit conditions (priority order)

1. **REGIME_EXIT** — VNIndex turns DOWNTREND → exit next open, highest priority
2. **STOP_LOSS** — price touches trailing ATR stop → exit same bar
3. **WYCKOFF_EXIT** — Wyckoff phase turns Distribution or signal turns SHORT → exit next open
4. **MAX_HOLD** — position age reaches 260 trading days → exit next open
5. **RS_EXIT** — stock Relative Strength vs VN100 drops below 0.85 for 5 consecutive days → exit

---

## 8. Backtest Engine

File: `crawler/backtest.py`

### 8.1 Data preparation

```python
UNIVERSE = 'VN100'        # from symbols table where exchange in ('HOSE','HNX')
                           # and symbol in current VN100 constituents
TRAIN_START = '2014-01-01'
TRAIN_END   = '2025-12-31'
VNINDEX_SYM = 'VNINDEX'   # assumed to be in daily_quotes or a separate index table

def load_all_data(store: Store) -> dict[str, list[dict]]:
    """Load OHLCV for all VN100 symbols + VNIndex, oldest→newest."""
    symbols = store.get_vn100_symbols()  # SELECT symbol FROM symbols WHERE is_vn100=true
    data = {}
    for sym in symbols + [VNINDEX_SYM]:
        data[sym] = store.get_symbol_quotes(sym, days=9999)
    return data
```

### 8.2 Walk-forward split

```
Total period: 2014–2025 (12 years)

Split 1: Train 2014–2016, Test 2017
Split 2: Train 2015–2017, Test 2018
Split 3: Train 2016–2018, Test 2019
Split 4: Train 2017–2019, Test 2020
Split 5: Train 2018–2020, Test 2021
Split 6: Train 2019–2021, Test 2022
Split 7: Train 2020–2022, Test 2023
Split 8: Train 2021–2023, Test 2024
Split 9: Train 2022–2024, Test 2025

Each split: optimize params on train years → evaluate on test year → record metrics.
Final params: weighted average of params from splits where Sharpe > 1.0.
```

### 8.3 Simulation loop

```python
def run_backtest(
    data: dict[str, list[dict]],
    params: dict,
    capital: float,
    start_date: str,
    end_date: str,
) -> BacktestResult:

    portfolio = Portfolio(capital=capital, cash=capital, max_positions=8)
    all_dates = sorted_trading_days(start_date, end_date)

    for date in all_dates:
        # 1. Compute regime from VNIndex bars up to today (no look-ahead)
        regime = detect_regime_on_date(vnindex_bars=data['VNINDEX'],
                                       date_idx=i,
                                       params=params)

        # 2. If DOWNTREND — exit all open positions at next open, then skip to next day
        if regime == 'DOWNTREND':
            for pos in portfolio.open_positions[:]:
                next_open = get_open_price(data[pos.symbol], i + 1)
                close_position(portfolio, pos,
                               exit_date=all_dates[i + 1],
                               exit_price=next_open,
                               reason='REGIME_EXIT')
            continue  # no new entries on DOWNTREND days

        # 3. Update trailing stops — exit if stop hit
        for pos in portfolio.open_positions[:]:
            atr = compute_atr(data[pos.symbol], date, period=14)
            new_stop = pos.entry_price + (current_price - pos.entry_price) * 0.85
            # trail stop: only move up, never down
            pos.trailing_stop = max(pos.trailing_stop, new_stop)
            if current_price(data[pos.symbol], date) <= pos.trailing_stop:
                close_position(portfolio, pos, date, reason='STOP_LOSS')

        # 4. Check max-hold expiry
        for pos in portfolio.open_positions[:]:
            if days_held(pos, date) >= 260:
                close_position(portfolio, pos, date, reason='MAX_HOLD')

        # 5. Check Wyckoff exit signals on held positions
        for pos in portfolio.open_positions[:]:
            result = wyckoff_analyze(pos.symbol, data[pos.symbol][:date_idx], params['lookback'])
            if result.signal in ('SHORT',) or result.phase == 'Distribution' and result.sub_phase >= 'C':
                close_position(portfolio, pos, date + 1, reason='WYCKOFF_EXIT')

        # 6. Scan for new entries if slots available
        if portfolio.can_open():
            sector_rank = rank_sectors(data, date, params)
            candidates = scan_candidates(data, date, sector_rank, params, regime)
            for candidate in candidates[:portfolio.open_slots()]:
                open_position(portfolio, candidate, date + 1, data, params)

    return summarize(portfolio, all_dates)
```

### 8.4 Performance metrics computed

```python
@dataclass
class BacktestResult:
    total_return:        float   # % from start to end
    annual_return:       float   # CAGR
    sharpe_ratio:        float   # (mean_return - 0.06) / std_return, annual
    max_drawdown:        float   # peak-to-trough %
    win_rate:            float   # % of closed trades profitable
    avg_hold_days:       float   # average holding period
    total_trades:        int
    regime_exit_trades:  int     # how many positions closed due to DOWNTREND
    by_year:             dict    # annual return per calendar year
    by_regime:           dict    # avg return per regime (UPTREND/SIDEWAYS/DOWNTREND)
    best_trade:          dict    # symbol, return %, hold days
    worst_trade:         dict
    indicator_ic:        dict    # IC of each indicator signal vs forward return
    params_used:         dict    # the param set that generated this result
```

---

## 9. Optimizer (Grid Search)

File: `crawler/optimizer.py`

### 9.1 Parameter search space

```python
PARAM_GRID = {
    # Wyckoff core
    'lookback':               [120, 180, 260],
    'range_bars':             [80, 120, 160],
    'pivot_bars':             [3, 5],
    'climax_vol_mult':        [1.6, 1.8, 2.0, 2.2],
    'hi_vol_mult':            [1.2, 1.4, 1.6],
    'lo_vol_mult':            [0.5, 0.7, 0.8],

    # RSI filters
    'rsi_entry_max':          [45, 50, 55, 60],
    'rsi_exit_min':           [65, 70, 75],

    # ATR stop
    'atr_stop_mult':          [1.5, 2.0, 2.5, 3.0],
    'atr_trail_pct':          [0.80, 0.85, 0.90],

    # Bollinger squeeze
    'bb_squeeze_thresh':      [0.03, 0.05, 0.07],

    # Entry quality score threshold
    'min_signal_score':       [3, 4, 5],   # min number of indicators confirming

    # Sector filter
    'top_n_sectors':          [2, 3, 4],

    # Regime detection
    'downtrend_drawdown_pct': [0.08, 0.10, 0.12],
    'regime_ma_fast':         [20, 50],
    'regime_ma_slow':         [100, 200],

    # RS filter
    'rs_min_ratio':           [0.9, 1.0, 1.1],
    'rs_exit_ratio':          [0.80, 0.85, 0.90],
}
```

Total combinations: ~3 million. Use **random search** (500–1000 samples) first to find promising regions, then grid search locally around the best clusters.

### 9.2 Optimization objective

```python
def objective(params: dict, data: dict, capital: float, train_split: tuple) -> float:
    result = run_backtest(data, params, capital, *train_split)

    # Multi-objective: maximize Sharpe, penalize drawdown, penalize too few trades
    score = (
        result.sharpe_ratio * 2.0
        - max(0, result.max_drawdown - 0.25) * 5.0   # heavy penalty if DD > 25%
        - max(0, 0.55 - result.win_rate) * 3.0        # penalty if win rate < 55%
        + result.annual_return * 0.5                   # reward raw return
    )
    return score
```

### 9.3 Per-regime optimization

Run optimizer separately for:
1. UPTREND years (2017, 2019, 2020, 2021, 2024, 2025)
2. SIDEWAYS years (2015, 2016, 2018, 2019, 2023)
3. DOWNTREND years (2022) — optimize exit-only logic (when to re-enter after crash)

### 9.4 Output — saved to DB and JSON

```python
# Saved to backtest_params table
OPTIMIZED_PARAMS = {
    'UPTREND':   { ... best params for uptrend ... },
    'SIDEWAYS':  { ... best params for sideways ... },
    'DOWNTREND': { ... defensive exit params ... },
}
# Also saved to crawler/optimized_params.json for quick loading without DB query
```

---

## 10. Database Schema

Add to `db/init.sql`:

```sql
-- Track VN100 membership over time
ALTER TABLE symbols ADD COLUMN IF NOT EXISTS is_vn100 BOOLEAN DEFAULT FALSE;
-- Run: UPDATE symbols SET is_vn100 = true WHERE symbol IN ('ACB','BID','BVH',...)
-- Full VN100 list: GET https://kbbuddywts.kbsec.com.vn/iis-server/investment/index/100/stocks

-- Daily regime classification
CREATE TABLE IF NOT EXISTS regime_history (
    date       DATE         PRIMARY KEY,
    regime     VARCHAR(12)  NOT NULL,   -- UPTREND | DOWNTREND | SIDEWAYS
    vnindex    NUMERIC(8,2),
    ma20       NUMERIC(8,2),
    ma50       NUMERIC(8,2),
    ma200      NUMERIC(8,2),
    macd_hist  NUMERIC(10,4),
    drawdown   NUMERIC(6,4),            -- from 60-day high
    wyckoff_phase VARCHAR(20),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Backtest run metadata
CREATE TABLE IF NOT EXISTS backtest_runs (
    id              SERIAL PRIMARY KEY,
    run_at          TIMESTAMPTZ DEFAULT NOW(),
    capital         NUMERIC(15,2),
    train_start     DATE,
    train_end       DATE,
    test_start      DATE,
    test_end        DATE,
    params          JSONB,
    regime_scope    VARCHAR(12),        -- UPTREND | SIDEWAYS | DOWNTREND | ALL
    annual_return   NUMERIC(8,4),
    total_return    NUMERIC(8,4),
    sharpe_ratio    NUMERIC(6,3),
    max_drawdown    NUMERIC(6,4),
    win_rate        NUMERIC(6,4),
    total_trades    INTEGER,
    avg_hold_days   NUMERIC(6,1),
    by_year         JSONB,
    indicator_ic    JSONB,
    notes           TEXT
);

-- Individual trade log
CREATE TABLE IF NOT EXISTS backtest_trades (
    id              SERIAL PRIMARY KEY,
    run_id          INTEGER REFERENCES backtest_runs(id),
    symbol          VARCHAR(20),
    entry_date      DATE,
    entry_price     NUMERIC(12,2),
    exit_date       DATE,
    exit_price      NUMERIC(12,2),
    shares          INTEGER,
    pnl             NUMERIC(12,2),
    pnl_pct         NUMERIC(8,4),
    hold_days       INTEGER,
    exit_type       VARCHAR(20),        -- STOP_LOSS | WYCKOFF_EXIT | REGIME_EXIT | MAX_HOLD | RS_EXIT
    regime_at_entry VARCHAR(12),
    wyckoff_phase   VARCHAR(30),
    sector          VARCHAR(50),
    ecosystem       VARCHAR(30)         -- VINGROUP | GELEX | NULL
);

-- Optimized params (latest winning set per regime)
CREATE TABLE IF NOT EXISTS optimized_params (
    regime      VARCHAR(12) PRIMARY KEY,
    params      JSONB       NOT NULL,
    run_id      INTEGER REFERENCES backtest_runs(id),
    sharpe      NUMERIC(6,3),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bt_trades_run    ON backtest_trades (run_id);
CREATE INDEX IF NOT EXISTS idx_bt_trades_symbol ON backtest_trades (symbol);
CREATE INDEX IF NOT EXISTS idx_bt_trades_exit   ON backtest_trades (exit_type);
CREATE INDEX IF NOT EXISTS idx_regime_date      ON regime_history (date DESC);
```

---

## 11. Store — `store.py` additions

```python
# Add to Store class

def upsert_regime(self, date: str, regime_row: dict) -> None:
    """Upsert into regime_history — called daily after market close."""

def get_regime(self, date: str | None = None) -> dict | None:
    """Get latest regime (or for specific date). Returns {date, regime, ...} or None."""

def get_regime_history(self, days: int = 365) -> list[dict]:
    """Get regime history for charting."""

def get_vn100_symbols(self) -> list[str]:
    """SELECT symbol FROM symbols WHERE is_vn100 = true ORDER BY symbol"""

def save_backtest_run(self, result: BacktestResult) -> int:
    """INSERT into backtest_runs, return run_id."""

def save_backtest_trades(self, run_id: int, trades: list[dict]) -> int:
    """Bulk INSERT into backtest_trades."""

def get_backtest_runs(self, limit: int = 20) -> list[dict]:
    """Latest backtest runs for UI display."""

def get_backtest_trades(self, run_id: int) -> list[dict]:
    """All trades for a specific run."""

def save_optimized_params(self, regime: str, params: dict, run_id: int, sharpe: float) -> None:
    """Upsert into optimized_params."""

def get_optimized_params(self, regime: str | None = None) -> dict:
    """Get all optimized params, or for a specific regime."""
```

---

## 12. API Routes — `api.py`

```python
@app.get("/regime/latest")
def get_latest_regime():
    return store.get_regime()

@app.get("/regime/history")
def get_regime_history(days: int = Query(365)):
    return store.get_regime_history(days)

@app.get("/backtest/runs")
def list_backtest_runs(limit: int = Query(20)):
    return store.get_backtest_runs(limit)

@app.get("/backtest/trades/{run_id}")
def get_trades(run_id: int):
    return store.get_backtest_trades(run_id)

@app.post("/backtest/run")
def trigger_backtest(capital: float = Query(1_000_000_000), regime: str = Query("ALL")):
    """Trigger a full backtest run async — returns run_id immediately,
    backtest runs in background thread. Poll /backtest/runs for completion."""
    import threading
    run = threading.Thread(target=run_full_backtest, args=(store, capital, regime))
    run.start()
    return {"status": "started", "message": "Backtest running in background"}

@app.get("/backtest/params")
def get_optimized_params():
    return store.get_optimized_params()

@app.get("/wyckoff-opt/{symbol}")
def get_wyckoff_opt(symbol: str):
    """Live signal using optimized params for current regime."""
    regime = store.get_regime()['regime']
    params = store.get_optimized_params(regime)
    bars = store.get_symbol_quotes(symbol, days=300)
    return run_live_signal(symbol, bars, params)
```

---

## 13. Frontend — Chart with Indicators

New page: `frontend/src/pages/WyckoffOpt.tsx`

### Chart layout — 4 panes

```
┌─────────────────────────────────────────────────────┐
│ PANE 1 (60% height) — Price                         │
│  Candlestick chart                                   │
│  Overlay: MA20 (blue), MA50 (orange), MA200 (red)   │
│  Overlay: Bollinger Bands (grey, dashed)             │
│  Overlay: Support / Resistance horizontal lines      │
│  Overlay: ATR trailing stop line (purple, dotted)    │
│  Markers: Wyckoff events (SC/AR/Spring/SOS/LPS...)  │
│  Background color: Regime (green/red/yellow tint)   │
├─────────────────────────────────────────────────────┤
│ PANE 2 (20% height) — Volume + Force Index          │
│  Volume bars (green=up, red=down)                    │
│  Volume MA20 (orange line)                           │
│  Force Index line (grey, secondary axis)             │
│  CMF histogram (green/red bars)                      │
├─────────────────────────────────────────────────────┤
│ PANE 3 (10% height) — RSI + MACD                    │
│  RSI(14) line, 30/50/70 reference lines              │
│  MACD histogram (green/red bars)                     │
│  MACD signal line overlay                            │
├─────────────────────────────────────────────────────┤
│ PANE 4 (10% height) — ATR + Regime                  │
│  ATR(14) line                                        │
│  Regime label (UPTREND/SIDEWAYS/DOWNTREND)           │
│  VNIndex vs MA50 line for regime context             │
└─────────────────────────────────────────────────────┘
```

### Backtest results tab (within the same page)

A second tab on the WyckoffOpt page showing:
- Summary table: annual return by year (2014–2025), color-coded (>30% green, >15% yellow, <0% red)
- Equity curve chart: portfolio value over time vs VNIndex
- Trade list: sortable table (symbol, entry/exit, return %, hold days, exit type)
- Indicator IC table: which indicators survived the pruning

---

## 14. Running the Pipeline

### One-time setup

```bash
# 1. Mark VN100 symbols in DB
psql $DATABASE_URL -c "
UPDATE symbols SET is_vn100 = true
WHERE symbol IN (
  -- paste current VN100 constituent list
  -- or fetch from: GET /index/100/stocks on KBS
);"

# 2. Apply DB schema
psql $DATABASE_URL -f db/init.sql

# 3. Ensure VNIndex OHLCV is in daily_quotes back to 2014
#    (crawl with existing client.py using /index/VNINDEX/data_day on KBS)
```

### Run backtest (may take 30–120 minutes for full 2014–2025 walk-forward)

```python
from store import Store
from backtest import run_full_backtest
import os

store = Store(os.environ["DATABASE_URL"])

# Initial run — all regimes, 1B VND capital reference
run_full_backtest(
    store=store,
    capital=1_000_000_000,
    train_start='2014-01-01',
    train_end='2025-12-31',
    n_random_samples=1000,   # random search samples
)
# Results saved to backtest_runs + backtest_trades tables
# Optimized params saved to optimized_params table + optimized_params.json
```

### Daily live run (add to `main.py`)

```python
def run_live_wyckoff_opt(store: Store):
    """Daily job — runs after market close, after existing crawl jobs."""
    from regime import detect_regime_today
    from wyckoff_opt import run_live_scan

    # 1. Detect today's VNIndex regime
    vnindex_bars = store.get_symbol_quotes('VNINDEX', days=300)
    regime = detect_regime_today(vnindex_bars)
    store.upsert_regime(today, regime)

    # 2. Load optimized params for current regime
    params = store.get_optimized_params(regime['regime'])
    if not params:
        log.warning("No optimized params found — run backtest first")
        return

    # 3. Scan VN100 for signals using optimized params
    symbols = store.get_vn100_symbols()
    for symbol in symbols:
        bars = store.get_symbol_quotes(symbol, days=300)
        signal = run_live_signal(symbol, bars, params, regime)
        store.upsert_wyckoff_signal(signal)  # reuse existing upsert

# Add after existing scan jobs:
run_wyckoff_scan(store)
run_multifactor_scan(store)
run_live_wyckoff_opt(store)   # ← add this
```

---

## 15. Parameters Reference

### Fixed parameters (not optimized)

| Parameter | Value | Reason |
|---|---|---|
| Universe | VN100 | Sufficient liquidity for positions up to 2B VND |
| Max positions | 8 | Diversification vs concentration trade-off |
| Max hold days | 260 | 1 trading year — prevents zombie positions |
| Capital range | 100M–2B VND | X passed at runtime, position sizing scales linearly |
| Backtest start | 2014-01-01 | First complete year with liquid VN100 data |
| Walk-forward train window | 3 years | Enough data to learn patterns, recent enough to be relevant |
| Walk-forward test window | 1 year | Annual evaluation matches target metric (annual return) |

### Optimizable parameters (see Section 9.1 for ranges)

Lookback, range_bars, pivot_bars, climax_vol, hi_vol, lo_vol, RSI filters, ATR stop multiplier, BB squeeze threshold, signal score threshold, sector top-N, regime MA periods, RS ratio thresholds.

---

## 16. Prompts for Claude

Use these **in order**. Each prompt assumes Claude has the relevant existing files in context.

### Prompt 1 — `wyckoff_opt.py` (indicator engine)

```
Create crawler/wyckoff_opt.py that extends the existing wyckoff.py.
Here is wyckoff.py: [paste wyckoff.py]

The file should:
1. Import and call wyckoff.analyze(symbol, bars, lookback) to get the base result
2. Compute 6 new indicators on top using only Python stdlib + statistics:
   - RSI(14) using Wilder smoothing
   - MACD(12,26,9) — EMA-based
   - ATR(14) — True Range with RMA smoothing
   - Bollinger Bands(20,2) — mid/upper/lower + BB Width
   - Force Index(13) — (close-prev_close)*volume, EMA(13)
   - CMF(20) — Chaikin Money Flow
   - RS vs index — (stock_return_20d / index_return_20d), index_bars passed as argument
3. Define compute_signal_score(wyckoff_result, indicators, params) -> int
   Score 0–8: each indicator that confirms the wyckoff signal adds 1 point.
   Return the total score — entry only if score >= params['min_signal_score'].
4. Define compute_trailing_stop(entry_price, current_price, atr, params) -> float
   trailing_stop = max(entry_price - params['atr_stop_mult'] * atr_at_entry,
                       running_max * params['atr_trail_pct'])
5. Define run_live_signal(symbol, bars, index_bars, params) -> dict
   Returns {symbol, signal, score, phase, sub_phase, entry_price, stop_loss,
            rsi, macd_hist, bb_width, force_index, cmf, rs, indicators_dict}
6. Add a PRUNING helper: compute_ic(indicator_series, forward_return_series) -> float
   Uses Pearson correlation. IC < 0.02 = indicator not useful.

Follow wyckoff.py code style exactly (dataclasses, _helper functions, _mean, _sma, etc.).
Pure Python stdlib only — no pandas, no numpy.
```

### Prompt 2 — `regime.py`

```
Create crawler/regime.py implementing VNIndex regime detection as described in
README_WYCKOFF_OPTIMIZED.md Section 4.

Inputs: vnindex_bars: list[dict] (same format as wyckoff.py bars input).
Outputs: RegimeResult dataclass with fields:
  date, regime (UPTREND/DOWNTREND/SIDEWAYS),
  vnindex_close, ma20, ma50, ma200, macd_hist,
  drawdown_from_60d_high, wyckoff_phase, confirmed (bool).

Implement:
1. detect_regime_today(vnindex_bars, params) -> RegimeResult
   Three-layer check: MA alignment + MACD + VNIndex vs MAs (Section 4.1).
   Require Wyckoff confirmation for DOWNTREND switch (Section 4.2).
2. detect_regime_on_date(vnindex_bars, date_idx, params) -> str
   For use in backtest — returns 'UPTREND'|'DOWNTREND'|'SIDEWAYS' at a historical date.
3. get_regime_series(vnindex_bars, params) -> list[dict]
   Compute regime for every date in vnindex_bars. Used in backtest setup.

Here is wyckoff.py for reference on bar format and helper functions: [paste wyckoff.py]
Use the same code style. Reuse _sma, _mean, _ema (add _ema if not present) from wyckoff.py.
```

### Prompt 3 — `sector_rotation.py`

```
Create crawler/sector_rotation.py with:
1. ECOSYSTEM_GROUPS dict as defined in Section 5.
2. get_ecosystem(symbol) -> str | None
3. rank_sectors(all_bars: dict[str, list[dict]], date_idx: int,
                symbol_sectors: dict[str, str], params: dict) -> list[dict]
   Returns [{sector, rs_score, symbols, avg_return_20d}, ...] sorted by rs_score DESC.
4. is_sector_leading(symbol, sector_ranking, top_n) -> bool
5. get_ecosystem_signal(ecosystem_name, all_bars, date_idx, params) -> str | None
   Returns 'BUY_ECOSYSTEM' if >= 2 members show Wyckoff BUY, else None.
6. is_ecosystem_concentrated(portfolio, ecosystem_name, max_slots=2) -> bool
   Returns True if portfolio already has >= max_slots positions in this ecosystem.

symbol_sectors comes from store.get_all_symbols_with_sectors()
(SELECT symbol, industry FROM symbols WHERE is_vn100 = true)
```

### Prompt 4 — `portfolio.py`

```
Create crawler/portfolio.py implementing the Position and Portfolio dataclasses
and all position management functions from README_WYCKOFF_OPTIMIZED.md Section 7.

Key functions:
- open_position(portfolio, symbol, entry_date, entry_price, atr, params) -> Position
- close_position(portfolio, position, exit_date, exit_price, reason) -> None
- exit_all_positions(portfolio, all_bars, date, reason) -> int
  NOTE: this function is a dumb primitive — it receives an explicit list of
  positions to close and a reason string. It has no knowledge of why it is
  being called. The decision to call it (and when) always comes from backtest.py.
- update_trailing_stops(portfolio, all_bars, date, params) -> list[str] (exited symbols)
- check_max_hold_exits(portfolio, date) -> list[str]
- check_rs_exits(portfolio, all_bars, index_bars, date, params) -> list[str]

All functions must work in backtest mode (historical data indexed by date)
AND live mode (real-time, latest available bars).
Use only Python stdlib. No external dependencies.
```

### Prompt 5 — `backtest.py`

```
Create crawler/backtest.py implementing the walk-forward backtest engine from
README_WYCKOFF_OPTIMIZED.md Section 8.

Here are the modules it depends on (already created):
wyckoff_opt.py, regime.py, sector_rotation.py, portfolio.py
Here is wyckoff.py: [paste]
Here is store.py for reference on data shapes: [paste]

Implement:
1. run_backtest(data, params, capital, start_date, end_date) -> BacktestResult
   Full simulation loop as described in Section 8.3.
   IMPORTANT: regime detection and the exit-on-DOWNTREND decision must happen
   inside the main for-loop on every date iteration — not via any callback or
   event handler in portfolio.py. See Section 4.4 for the exact pattern.
   portfolio.py only provides close_position() as a dumb primitive.
2. run_walk_forward(data, capital, param_grid, n_samples=1000) -> list[BacktestResult]
   9 walk-forward splits (Section 8.2), random search on train, evaluate on test.
3. run_full_backtest(store, capital, train_start, train_end) -> None
   Loads all data from store, runs walk-forward, saves results to DB via store methods.
   Logs progress every 10% of iterations so the user can monitor long runs.
4. BacktestResult dataclass (Section 8.4).

Performance: the inner simulation loop must handle ~2500 trading days × ~100 symbols
efficiently using pure Python. Pre-index all bars by date before the main loop.
Avoid re-computing indicators per symbol per date if possible — batch compute upfront.
```

### Prompt 6 — `optimizer.py`

```
Create crawler/optimizer.py implementing random search + local grid search
from README_WYCKOFF_OPTIMIZED.md Section 9.

1. PARAM_GRID dict from Section 9.1
2. random_search(data, capital, train_split, n_samples) -> list[(params, score)]
   Randomly sample n_samples param combos from PARAM_GRID, run backtest on each,
   return sorted by objective score DESC.
3. local_grid_search(data, capital, train_split, seed_params, radius=1) -> (params, score)
   Vary each param ±1 step around seed_params. Return best combo.
4. objective(params, result) -> float (Section 9.2)
5. optimize_per_regime(data, capital, regime_splits) -> dict[str, dict]
   Run optimization separately for UPTREND/SIDEWAYS/DOWNTREND splits.
   Returns {'UPTREND': best_params, 'SIDEWAYS': best_params, 'DOWNTREND': best_params}
6. Log progress to stdout every 50 iterations — format:
   "Optimizer [150/1000] best_score=2.34 annual=27.3% sharpe=1.45 drawdown=18%"
```

### Prompt 7 — `store.py` additions

```
Add the backtest persistence methods to store.py from Section 11.
Here is store.py: [paste store.py]
Follow the exact same patterns as existing methods.
The backtest_runs and backtest_trades tables use integer primary keys (SERIAL),
not symbol-keyed like wyckoff_signals — handle accordingly.
```

### Prompt 8 — `api.py` additions

```
Add the backtest and regime API routes from Section 12 to api.py.
Here is api.py: [paste api.py]
The POST /backtest/run endpoint must be non-blocking — start a background thread
and return immediately with {"status": "started"}.
```

### Prompt 9 — Frontend chart page

```
Create frontend/src/pages/WyckoffOpt.tsx following the existing page pattern.
Here is an existing page for reference: [paste e.g. Wyckoff.tsx]

The page has two tabs:
Tab 1 "Chart" — show a symbol selector + 4-pane chart for a single symbol:
  Pane 1 (60%): Candlestick + MA20/50/200 + Bollinger Bands + S/R lines + ATR stop + Wyckoff event markers + regime background color
  Pane 2 (20%): Volume bars + Volume MA + Force Index + CMF histogram
  Pane 3 (10%): RSI line with 30/50/70 bands + MACD histogram
  Pane 4 (10%): ATR line + Regime label badge
  Data: GET /derivatives/quotes/{symbol} (reuse) or GET /wyckoff-opt/{symbol}

Tab 2 "Backtest" — show:
  Annual return table: year vs return % (color-coded)
  Equity curve vs VNIndex
  Trade list table (symbol, entry, exit, return %, hold days, exit type)
  Indicator IC table
  "Run Backtest" button that calls POST /backtest/run with capital input

Use recharts (already available) for all charts.
```

---

## 17. FAQ

**Q: How long does a full backtest take?**
A: Rough estimate on a modern machine with pure Python: 2–6 hours for 1000 random search samples × 9 walk-forward splits. You can reduce n_samples to 200 for a quick first run (30–60 min), then refine with more samples after. The optimizer logs progress every 50 iterations so you can monitor.

**Q: What if VNIndex data before 2018 is missing from my DB?**
A: Crawl it from KBS using `/index/VNINDEX/data_day` going back to 2014-01-01. This is a one-time historical fill — the same endpoint and parser as your stock crawler.

**Q: What if a VN100 stock has no data for some years (newly listed)?**
A: Skip that symbol for backtest splits where it has less than `lookback` bars of history. The backtest engine should check `if len(bars_before_date) < params['lookback']: skip`. Don't backfill or interpolate missing data.

**Q: Can I run the backtest without the ecosystem group logic first?**
A: Yes — set `ECOSYSTEM_GROUPS = {}` in sector_rotation.py and ecosystem logic becomes a no-op. Add it in a second pass after the basic model is working.

**Q: How do I know which params the live daily scan uses?**
A: `GET /backtest/params` returns the current optimized params per regime. `GET /regime/latest` shows today's regime. Together you can see which param set is active today.

**Q: The optimizer keeps converging on DOWNTREND exit as the most important param — is that expected?**
A: Yes. In backtests on VN market, regime exits during 2022 have an outsized positive impact on annual Sharpe — correctly staying out of the market during a -35% drawdown year is worth more than any entry signal improvement. This is by design.

**Q: What happens to capital during a DOWNTREND regime?**
A: All positions are exited, cash sits idle. No reinvestment, no short positions (VN market makes shorting difficult for retail). In the backtest this is modeled as cash earning 0% (conservative — actual idle cash would earn ~4-5% in a savings account).

**Q: Can I add more ecosystem groups later?**
A: Yes — just add entries to `ECOSYSTEM_GROUPS` in `sector_rotation.py`. No DB changes needed; the group name is stored in `backtest_trades.ecosystem` as a text field.

---

## 18. Makefile & Shell Scripts (Docker)

Chạy xong thì kết quả ghi ra file trong `output/` — bạn check lúc nào cũng được.

### 18.1 Files kết quả

```
output/
├── backtest_20260101_020000.log    <- log chi tiet qua trinh chay
├── backtest_result.json            <- ket qua so lieu tu DB
└── backtest_analysis.md            <- phan tich Claude (neu co API key)
```

### 18.2 Makefile

```makefile
CRAWLER_CONTAINER := stock-analytics-crawler-1
CAPITAL           ?= 1000000000

.PHONY: help backtest backtest-quick optimize live-scan full-pipeline clean-backtest

help:
	@echo "make backtest          - backtest 2014-2025 (2-6 gio)"
	@echo "make backtest-quick    - backtest 100 samples (30-60 phut)"
	@echo "make optimize          - chay optimizer"
	@echo "make live-scan         - live signal scan hom nay"
	@echo "make full-pipeline     - backtest + optimize + ghi ket qua ra output/"
	@echo "CAPITAL=500000000 make backtest"

backtest:
	@bash scripts/run_backtest.sh $(CAPITAL) 1000

backtest-quick:
	@bash scripts/run_backtest.sh $(CAPITAL) 100

optimize:
	@docker exec $(CRAWLER_CONTAINER) python3 -c "\
from store import Store; from optimizer import optimize_per_regime; import os; \
store = Store(os.environ['DATABASE_URL']); \
store.save_optimized_params_all(optimize_per_regime(store)); \
print('Done.')"

live-scan:
	@docker exec $(CRAWLER_CONTAINER) python3 -c "\
from store import Store; from main import run_live_wyckoff_opt; import os; \
run_live_wyckoff_opt(Store(os.environ['DATABASE_URL']))"

full-pipeline:
	@$(MAKE) backtest CAPITAL=$(CAPITAL)
	@$(MAKE) optimize
	@bash scripts/after_backtest.sh
	@echo ""
	@echo "XONG. Ket qua o output/"
	@ls -lh output/

clean-backtest:
	@docker exec $(CRAWLER_CONTAINER) python3 -c "\
from store import Store; import os; \
Store(os.environ['DATABASE_URL']).clean_backtest_runs(); print('Cleaned.')"
```

### 18.3 `scripts/run_backtest.sh`

```bash
#!/bin/bash
set -e

CAPITAL="${1:-1000000000}"
N_SAMPLES="${2:-1000}"
LOGFILE="output/backtest_$(date +%Y%m%d_%H%M%S).log"

mkdir -p output

echo "Backtest bat dau: $(date)" | tee "$LOGFILE"
echo "Capital: $CAPITAL | Samples: $N_SAMPLES" | tee -a "$LOGFILE"
echo "---" | tee -a "$LOGFILE"

docker exec stock-analytics-crawler-1 python3 - "$CAPITAL" "$N_SAMPLES" 2>&1 \
    | tee -a "$LOGFILE" \
    || (echo "BACKTEST THAT BAI - xem $LOGFILE" | tee -a "$LOGFILE"; exit 1)

echo "---" | tee -a "$LOGFILE"
echo "Backtest xong: $(date)" | tee -a "$LOGFILE"

# Python script duoc truyen vao qua stdin
cat << 'PYEOF' | docker exec -i stock-analytics-crawler-1 python3 - "$CAPITAL" "$N_SAMPLES" >> "$LOGFILE" 2>&1 || true
import sys, os, time
from store import Store
from backtest import run_full_backtest

capital   = int(sys.argv[1])
n_samples = int(sys.argv[2])
store     = Store(os.environ["DATABASE_URL"])
t0        = time.time()

print(f"Loading VN100 data...")

run_full_backtest(
    store=store,
    capital=capital,
    train_start="2014-01-01",
    train_end="2025-12-31",
    n_random_samples=n_samples,
)

e = time.time() - t0
print(f"Hoan thanh trong {int(e//3600)}h {int((e%3600)//60)}m")
PYEOF
```

### 18.4 `scripts/after_backtest.sh`

Lấy kết quả từ DB, ghi ra `output/backtest_result.json`. Nếu có `ANTHROPIC_API_KEY` thì ghi thêm `output/backtest_analysis.md`.

```bash
#!/bin/bash
set -e
[ -f .env ] && export $(grep -v '^#' .env | xargs 2>/dev/null)

CONTAINER="${CRAWLER_CONTAINER:-stock-analytics-crawler-1}"
mkdir -p output

echo "Lay ket qua tu DB..."

docker exec "$CONTAINER" python3 - > output/backtest_result.json << 'PYEOF'
import os, json
from store import Store

store = Store(os.environ["DATABASE_URL"])
runs  = store.get_backtest_runs(limit=1)

if not runs:
    print(json.dumps({"error": "Chua co ket qua. Chay make backtest truoc."}, ensure_ascii=False))
    exit(0)

r      = runs[0]
trades = store.get_backtest_trades(r["id"])
st     = sorted(trades, key=lambda t: t.get("pnl_pct", 0))

print(json.dumps({
    "run_at":        str(r["run_at"]),
    "capital":       r["capital"],
    "annual_return": r["annual_return"],
    "sharpe_ratio":  r["sharpe_ratio"],
    "max_drawdown":  r["max_drawdown"],
    "win_rate":      r["win_rate"],
    "total_trades":  r["total_trades"],
    "avg_hold_days": r["avg_hold_days"],
    "by_year":       r.get("by_year", {}),
    "indicator_ic":  r.get("indicator_ic", {}),
    "best_trades":   st[-3:],
    "worst_trades":  st[:3],
    "params":        r.get("params", {}),
}, indent=2, default=str, ensure_ascii=False))
PYEOF

echo "Da ghi: output/backtest_result.json"

# In summary nhanh
python3 - << 'PYEOF'
import json
d = json.load(open("output/backtest_result.json"))
if "error" in d:
    print("LOI:", d["error"])
    exit(0)
print(f"Annual return : {d['annual_return']:.1%}")
print(f"Sharpe ratio  : {d['sharpe_ratio']:.2f}")
print(f"Max drawdown  : {d['max_drawdown']:.1%}")
print(f"Win rate      : {d['win_rate']:.1%}")
print(f"Total trades  : {d['total_trades']}")
for y, v in sorted(d.get("by_year", {}).items()):
    bar = "#" * int(float(v) * 100 / 5)
    print(f"  {y}: {float(v):+.1%} {bar}")
PYEOF

# Goi Claude neu co API key
if [ -n "$ANTHROPIC_API_KEY" ]; then
    echo "Goi Claude API..."
    python3 - << 'PYEOF' > output/backtest_analysis.md
import os, json, urllib.request

data = json.load(open("output/backtest_result.json"))
if "error" in data:
    print("# Loi\n" + data["error"])
    exit(0)

prompt = (
    "Backtest Wyckoff VN100 2014-2025.\n\n"
    f"Annual: {data['annual_return']:.1%} | Sharpe: {data['sharpe_ratio']:.2f}"
    f" | MaxDD: {data['max_drawdown']:.1%} | WinRate: {data['win_rate']:.1%}"
    f" | Trades: {data['total_trades']} | AvgHold: {data['avg_hold_days']:.0f}d\n\n"
    f"By year:\n{json.dumps(data.get('by_year',{}), indent=2, ensure_ascii=False)}\n\n"
    f"Indicator IC:\n{json.dumps(data.get('indicator_ic',{}), indent=2, ensure_ascii=False)}\n\n"
    f"Best trades: {json.dumps(data.get('best_trades',[]), ensure_ascii=False)}\n"
    f"Worst trades: {json.dumps(data.get('worst_trades',[]), ensure_ascii=False)}\n\n"
    "Phan tich: dat muc tieu 20-30%/nam? Chi bao nao nen bo (IC<0.02)? "
    "2022 downtrend co tranh lo? De xuat cai tien params cu the. "
    "Tra loi tieng Viet, Markdown."
)

req = urllib.request.Request(
    "https://api.anthropic.com/v1/messages",
    data=json.dumps({
        "model": "claude-sonnet-4-6",
        "max_tokens": 2000,
        "messages": [{"role": "user", "content": prompt}]
    }).encode(),
    headers={
        "x-api-key": os.environ["ANTHROPIC_API_KEY"],
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
)
with urllib.request.urlopen(req, timeout=120) as resp:
    r = json.loads(resp.read())
    print(f"# Backtest Analysis - {data['run_at']}\n")
    print(r["content"][0]["text"])
PYEOF
    echo "Da ghi: output/backtest_analysis.md"
else
    echo "(Khong co ANTHROPIC_API_KEY - bo qua phan tich Claude)"
fi
```

### 18.5 `docker-compose.yml` — thêm volumes

```yaml
services:
  crawler:
    volumes:
      - ./scripts:/scripts:ro
      - ./output:/output
```

### 18.6 Setup và chạy

```bash
# Setup lan dau
mkdir -p scripts output
chmod +x scripts/run_backtest.sh scripts/after_backtest.sh

# Tuy chon: them API key neu muon Claude phan tich
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env

docker-compose down && docker-compose up -d

# Chay
CAPITAL=1000000000 make full-pipeline
# De may chay, lam viec khac

# Check bat cu luc nao
ls -lh output/                         # xem file nao da co
cat output/backtest_result.json        # so lieu
cat output/backtest_analysis.md        # phan tich Claude
tail -20 output/backtest_*.log         # xem tien trinh / loi
```

### 18.7 Biết khi nào xong

```bash
# Cach 1: check file co ton tai chua (don gian nhat)
ls output/backtest_result.json 2>/dev/null && echo "DA XONG" || echo "CHUA XONG"

# Cach 2: xem dong cuoi log
tail -3 output/backtest_*.log

# Cach 3: chay trong terminal rieng de thay live
docker logs -f stock-analytics-crawler-1
```
