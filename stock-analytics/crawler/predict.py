"""
XGBoost prediction engine — calibrated for the Vietnamese stock market.

VN-specific adaptations vs a generic model:
  • Ceiling / floor hit features  — HOSE ±7%, HNX ±10% price limits are
    strong momentum / exhaustion signals unique to VN boards.
  • Foreign investor flow  — foreigners drive large moves; the existing
    `foreign_trading` table (buy_vol, sell_vol, net_vol) is merged as
    two features: same-day net ratio and 5-day rolling net ratio.
  • VND trading value  — VN traders monitor value (VND turnover) as much
    as share volume; `value_ratio` captures liquidity more accurately than
    `vol_ratio` alone for low-price / high-par-value stocks.
  • Return target 3 %  — VN friction (0.25 % brokerage each way + spread)
    is ~1 %; 3 % over 5 days gives a comfortable alpha buffer and accounts
    for the higher daily volatility of emerging-market stocks.
  • T+2.5 settlement  — you cannot sell on the day you buy, so a 5-day
    forward horizon naturally clears the settlement window.

Pipeline:
  1. Pull OHLCV + foreign flow per symbol from PostgreSQL
  2. Compute 18 features (no lookahead)
  3. Train XGBClassifier: target = 5-day forward return > 3 %
  4. Score each symbol on its latest data row
  5. Persist results to `predictions` table
"""

import logging
from dataclasses import dataclass
from datetime import date

import numpy as np
import pandas as pd
import xgboost as xgb

log = logging.getLogger(__name__)

HORIZON        = 5     # trading days forward (clears T+2.5 settlement)
RETURN_TARGET  = 0.03  # 3 % over HORIZON days — calibrated for VN friction
MIN_BARS       = 120   # minimum bars needed per symbol to generate a prediction
MIN_TRAIN_ROWS = 500   # abort training if fewer labeled rows across all symbols
BUY_THRESHOLD  = 0.55  # probability above which we emit BUY

# ── 18 features — generic + 5 VN-specific ────────────────────────────────────
FEATURE_COLS = [
    # Price returns
    "ret_1d", "ret_5d", "ret_20d", "ret_60d",
    # Momentum indicators
    "rsi_14",
    "macd", "macd_hist",
    "bb_pos",
    # Liquidity
    "vol_ratio",
    "value_ratio",      # VN: VND turnover / 20d avg — more reliable than share vol
    # Price structure
    "hl_range",
    "price_vs_ma20",
    "price_vs_ma60",
    # VN-specific: price-limit circuit breaker signals
    "ceiling_hit",      # price moved ≥ 6.8 % above prev close (HOSE ±7 % limit)
    "floor_hit",        # price moved ≤ −6.8 % below prev close
    "ceiling_streak",   # ceiling hits in last 3 days (strong momentum signal)
    # VN-specific: foreign investor flow
    "foreign_net_ratio",  # net foreign vol / total vol (positive = net buyer)
    "foreign_net_5d",     # 5-day rolling mean of foreign_net_ratio
]


@dataclass
class Prediction:
    symbol:       str
    predicted_at: date
    horizon_days: int
    score:        float
    signal:       str
    model_date:   date


# ── Feature engineering ───────────────────────────────────────────────────────

def _compute_features(df: pd.DataFrame) -> pd.DataFrame:
    """Add technical + VN-specific feature columns to an OHLCV DataFrame.

    `df` must be sorted ascending by date and already have numeric dtypes.
    All computations are purely backward-looking — no lookahead bias.
    """
    df = df.copy()
    c = df["close"]
    v = df["volume"]

    # ── Price returns ─────────────────────────────────────────────────────────
    df["ret_1d"]  = c.pct_change(1)
    df["ret_5d"]  = c.pct_change(5)
    df["ret_20d"] = c.pct_change(20)
    df["ret_60d"] = c.pct_change(60)

    # ── RSI-14 ────────────────────────────────────────────────────────────────
    delta = c.diff()
    gain  = delta.clip(lower=0).rolling(14).mean()
    loss  = (-delta.clip(upper=0)).rolling(14).mean()
    df["rsi_14"] = 100 - 100 / (1 + gain / loss.replace(0, np.nan))

    # ── MACD (12, 26, 9) ──────────────────────────────────────────────────────
    ema12 = c.ewm(span=12, adjust=False).mean()
    ema26 = c.ewm(span=26, adjust=False).mean()
    macd  = ema12 - ema26
    df["macd"]      = macd
    df["macd_hist"] = macd - macd.ewm(span=9, adjust=False).mean()

    # ── Bollinger Band position (0 = lower band, 1 = upper band) ─────────────
    mid = c.rolling(20).mean()
    std = c.rolling(20).std()
    df["bb_pos"] = (c - (mid - 2 * std)) / (4 * std).replace(0, np.nan)

    # ── Liquidity ─────────────────────────────────────────────────────────────
    df["vol_ratio"]     = v / v.rolling(20).mean().replace(0, np.nan)
    # VN: use VND value (turnover) when available — better proxy for big-money flow.
    # Falls back to vol_ratio when value is all-zero (not yet populated by crawler).
    val_ratio = np.nan
    if "value" in df.columns:
        val = pd.to_numeric(df["value"], errors="coerce").fillna(0)
        avg_val = val.rolling(20).mean()
        if avg_val.sum() > 0:
            val_ratio = val / avg_val.replace(0, np.nan)
    df["value_ratio"] = val_ratio if not isinstance(val_ratio, float) else df["vol_ratio"]

    # ── Price structure ───────────────────────────────────────────────────────
    df["hl_range"]      = (df["high"] - df["low"]) / c
    df["price_vs_ma20"] = c / mid - 1
    df["price_vs_ma60"] = c / c.rolling(60).mean() - 1

    # ── VN-specific: daily price-limit signals ────────────────────────────────
    # HOSE daily limit = ±7 %; HNX = ±10 %.  Use 6.8 % as conservative floor
    # so both exchanges are captured while filtering out ordinary large moves.
    chg = c / c.shift(1) - 1
    df["ceiling_hit"]    = (chg >=  0.068).astype(float)
    df["floor_hit"]      = (chg <= -0.068).astype(float)
    # Consecutive ceiling days signal strong near-term momentum (T+2.5 squeeze)
    df["ceiling_streak"] = df["ceiling_hit"].rolling(3).sum()

    # ── VN-specific: foreign investor net flow ────────────────────────────────
    # net_vol / total_volume → fraction of traded shares net-bought by foreigners
    if "net_vol" in df.columns:
        net = df["net_vol"].fillna(0)
        df["foreign_net_ratio"] = net / v.replace(0, np.nan)
        df["foreign_net_5d"]    = df["foreign_net_ratio"].rolling(5).mean()
    else:
        df["foreign_net_ratio"] = np.nan
        df["foreign_net_5d"]    = np.nan

    return df


# ── Predictor ─────────────────────────────────────────────────────────────────

class Predictor:
    def __init__(self, store):
        self.store  = store
        self._model: xgb.XGBClassifier | None = None
        self._model_date: date | None = None

    def _load(self, symbol: str, days: int) -> pd.DataFrame | None:
        """Load OHLCV + foreign flow, merge into one DataFrame."""
        bars = self.store.get_symbol_quotes(symbol, days=days)
        if len(bars) < MIN_BARS:
            return None

        df = pd.DataFrame(bars)
        df["date"] = pd.to_datetime(df["date"])
        for col in ("open", "high", "low", "close", "volume", "value"):
            df[col] = pd.to_numeric(df.get(col, np.nan), errors="coerce")
        df = df.sort_values("date").reset_index(drop=True)

        # Merge foreign trading — left join so missing days become NaN
        foreign = self.store.get_symbol_foreign(symbol, days=days)
        if foreign:
            fdf = pd.DataFrame(foreign)
            fdf["date"] = pd.to_datetime(fdf["date"])
            for col in ("buy_vol", "sell_vol", "net_vol"):
                fdf[col] = pd.to_numeric(fdf[col], errors="coerce")
            df = df.merge(fdf[["date", "net_vol"]], on="date", how="left")

        return df

    def train(self, symbols: list[str]) -> bool:
        """Train XGBoost on all available history across every symbol."""
        Xs, ys = [], []

        for sym in symbols:
            df = self._load(sym, days=3000)
            if df is None:
                continue
            df = _compute_features(df)
            # Target: 5-day forward return exceeds RETURN_TARGET (3 % for VN)
            df["target"] = (
                (df["close"].shift(-HORIZON) / df["close"] - 1) > RETURN_TARGET
            ).astype(float)
            # Allow NaN for optional features (foreign flow, value_ratio when
            # the crawler hasn't populated those columns yet)
            optional = {"foreign_net_ratio", "foreign_net_5d", "value_ratio"}
            clean = df[FEATURE_COLS + ["target"]].dropna(subset=["target"] + [
                c for c in FEATURE_COLS if c not in optional
            ])
            if len(clean) < 80:
                continue
            Xs.append(clean[FEATURE_COLS])
            ys.append(clean["target"])

        if not Xs:
            log.warning("predict: no training data collected")
            return False

        X = pd.concat(Xs, ignore_index=True)
        y = pd.concat(ys, ignore_index=True)

        if len(X) < MIN_TRAIN_ROWS:
            log.warning("predict: only %d training rows — need %d, skipping",
                        len(X), MIN_TRAIN_ROWS)
            return False

        # Sanitise: replace ±inf (from rare 0-denominator divisions) with NaN.
        # XGBoost handles NaN natively; inf causes a hard crash.
        X = X.replace([np.inf, -np.inf], np.nan)

        pos_rate = float(y.mean())
        spw = (1 - pos_rate) / max(pos_rate, 1e-6)
        log.info("predict: %d training rows, %.1f%% positive, spw=%.2f",
                 len(X), pos_rate * 100, spw)

        self._model = xgb.XGBClassifier(
            n_estimators=300,
            max_depth=4,
            learning_rate=0.05,
            subsample=0.8,
            colsample_bytree=0.8,
            min_child_weight=20,
            scale_pos_weight=spw,
            eval_metric="auc",
            random_state=42,
            n_jobs=-1,
            verbosity=0,
        )
        self._model.fit(X, y)
        self._model_date = date.today()

        fi   = dict(zip(FEATURE_COLS, self._model.feature_importances_))
        top5 = sorted(fi.items(), key=lambda x: x[1], reverse=True)[:5]
        log.info("predict: top features — %s",
                 ", ".join(f"{k}={v:.3f}" for k, v in top5))
        return True

    def predict(self, symbols: list[str]) -> list[Prediction]:
        """Score each symbol using its most recent data row."""
        if self._model is None:
            log.warning("predict: no model — call train() first")
            return []

        today   = date.today()
        results = []

        for sym in symbols:
            df = self._load(sym, days=MIN_BARS + 10)
            if df is None:
                continue
            df  = _compute_features(df)
            optional  = {"foreign_net_ratio", "foreign_net_5d", "value_ratio"}
            mandatory = [c for c in FEATURE_COLS if c not in optional]
            row = df.dropna(subset=mandatory)
            if row.empty:
                continue
            feat  = row[FEATURE_COLS].iloc[[-1]].replace([np.inf, -np.inf], np.nan)
            score = float(self._model.predict_proba(feat)[0][1])
            results.append(Prediction(
                symbol=sym,
                predicted_at=today,
                horizon_days=HORIZON,
                score=round(score, 4),
                signal="BUY" if score >= BUY_THRESHOLD else "HOLD",
                model_date=self._model_date,
            ))

        buy_count = sum(1 for p in results if p.signal == "BUY")
        log.info("predict: %d predictions (%d BUY, %d HOLD)",
                 len(results), buy_count, len(results) - buy_count)
        return results

    def run(self, symbols: list[str]) -> int:
        """Full pipeline: train → predict → persist. Returns rows stored."""
        if not self.train(symbols):
            return 0
        predictions = self.predict(symbols)
        if not predictions:
            return 0
        return self.store.upsert_predictions(predictions)
