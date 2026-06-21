"""
Parameter optimizer — random search + local grid refinement.

Samples the parameter space (PARAM_GRID), scores each combination with a
multi-objective function that rewards Sharpe and raw return while heavily
penalising drawdown > 25% and win-rate < 55%, and selects the best params —
separately per market regime.

Random search first (cheap, broad), then an optional local grid search around the
best seed.  All evaluations reuse a shared, pre-computed BacktestContext so a
sweep over hundreds of samples stays tractable in pure Python.

See README_WYCKOFF_OPTIMIZED.md §9.
"""

from __future__ import annotations

import logging
import random

import opt_backtest as obt
from wyckoff_opt import DEFAULT_PARAMS

log = logging.getLogger(__name__)

PARAM_GRID: dict[str, list] = {
    # Wyckoff core
    "lookback":               [120, 180, 260],
    "range_bars":             [80, 120, 160],
    "pivot_bars":             [3, 5],
    "climax_vol_mult":        [1.6, 1.8, 2.0, 2.2],
    "hi_vol_mult":            [1.2, 1.4, 1.6],
    "lo_vol_mult":            [0.5, 0.7, 0.8],
    # RSI filters
    "rsi_entry_max":          [45, 50, 55, 60],
    "rsi_exit_min":           [65, 70, 75],
    # ATR stop
    "atr_stop_mult":          [1.5, 2.0, 2.5, 3.0],
    "atr_trail_pct":          [0.80, 0.85, 0.90],
    # Bollinger squeeze
    "bb_squeeze_thresh":      [0.03, 0.05, 0.07],
    # Entry quality
    "min_signal_score":       [3, 4, 5],
    # Sector filter
    "top_n_sectors":          [2, 3, 4],
    # Regime detection
    "downtrend_drawdown_pct": [0.08, 0.10, 0.12],
    "regime_ma_fast":         [20, 50],
    "regime_ma_slow":         [100, 200],
    # RS filter
    "rs_min_ratio":           [0.9, 1.0, 1.1],
    "rs_exit_ratio":          [0.80, 0.85, 0.90],
}

# Representative calendar years per regime (README §9.3).
REGIME_YEARS = {
    "UPTREND":   ["2017", "2019", "2020", "2021", "2024", "2025"],
    "SIDEWAYS":  ["2016", "2018", "2023"],
    "DOWNTREND": ["2022"],
}


# ── Objective ─────────────────────────────────────────────────────────────────

def objective(result: obt.BacktestResult) -> float:
    """Multi-objective score (higher is better).  README §9.2.

    Works on fractions: annual_return / max_drawdown / win_rate are normalised so
    no single term dominates regardless of magnitude.
    """
    annual = result.annual_return / 100.0
    score = (
        result.sharpe_ratio * 2.0
        - max(0.0, result.max_drawdown - 0.25) * 5.0
        - max(0.0, 0.55 - result.win_rate) * 3.0
        + annual * 0.5
    )
    # Discourage degenerate "no-trade" param sets in non-downtrend windows.
    if result.total_trades == 0:
        score -= 1.0
    return score


# ── Sampling ──────────────────────────────────────────────────────────────────

def _sample_params(rng: random.Random) -> dict:
    p = dict(DEFAULT_PARAMS)
    for key, choices in PARAM_GRID.items():
        p[key] = rng.choice(choices)
    return p


def random_search(data: dict, capital: float, train_split: tuple,
                  n_samples: int, ctx: obt.BacktestContext | None = None,
                  seed: int = 42, tick=None) -> list[tuple[dict, float]]:
    """Sample ``n_samples`` param combos, backtest each on ``train_split``.

    ``tick`` — optional no-arg callable invoked once per sample for progress.
    Returns ``[(params, score), …]`` sorted by score descending.
    """
    rng = random.Random(seed)
    start, end = train_split
    results: list[tuple[dict, float]] = []
    for i in range(n_samples):
        params = _sample_params(rng)
        res = obt.run_backtest(data, params, capital, start, end, ctx=ctx)
        score = objective(res)
        results.append((params, score))
        if tick:
            tick()
        if (i + 1) % 50 == 0:
            best = max(results, key=lambda r: r[1])
            br = obt.run_backtest(data, best[0], capital, start, end, ctx=ctx)
            log.info("Optimizer [%d/%d] best_score=%.2f annual=%.1f%% sharpe=%.2f drawdown=%.0f%%",
                     i + 1, n_samples, best[1], br.annual_return, br.sharpe_ratio,
                     br.max_drawdown * 100)
    results.sort(key=lambda r: r[1], reverse=True)
    return results


def local_grid_search(data: dict, capital: float, train_split: tuple,
                      seed_params: dict, ctx: obt.BacktestContext | None = None,
                      radius: int = 1) -> tuple[dict, float]:
    """Vary each param ±``radius`` steps around ``seed_params``; return the best.

    Coordinate descent: optimise one parameter at a time, keeping the rest fixed
    at the running best — far cheaper than the full cartesian neighbourhood.
    """
    start, end = train_split
    best = dict(seed_params)
    best_score = objective(obt.run_backtest(data, best, capital, start, end, ctx=ctx))
    for key, choices in PARAM_GRID.items():
        if key not in best or best[key] not in choices:
            continue
        ci = choices.index(best[key])
        for off in range(-radius, radius + 1):
            ni = ci + off
            if off == 0 or not (0 <= ni < len(choices)):
                continue
            trial = dict(best)
            trial[key] = choices[ni]
            score = objective(obt.run_backtest(data, trial, capital, start, end, ctx=ctx))
            if score > best_score:
                best, best_score = trial, score
    return best, best_score


# ── Per-regime optimisation ───────────────────────────────────────────────────

def _score_on_years(data: dict, capital: float, params: dict, years: list[str],
                    ctx: obt.BacktestContext | None) -> tuple[float, float]:
    """Average objective + Sharpe of ``params`` across the regime's years."""
    scores, sharpes = [], []
    for y in years:
        res = obt.run_backtest(data, params, capital, f"{y}-01-01", f"{y}-12-31", ctx=ctx)
        scores.append(objective(res))
        sharpes.append(res.sharpe_ratio)
    if not scores:
        return -999.0, 0.0
    return sum(scores) / len(scores), sum(sharpes) / len(sharpes)


def optimize_per_regime(data: dict, capital: float,
                        ctx: obt.BacktestContext | None = None,
                        n_samples: int = 500) -> dict[str, dict]:
    """Optimise separately for UPTREND / SIDEWAYS / DOWNTREND.

    Strategy: one broad random search over the full range to get strong
    candidates, then re-rank the top candidates on each regime's own years.
    Returns ``{regime: {'params':…, 'sharpe':…, 'run_id': None}}``.
    """
    import progress as _pr
    _pr.get().set_phase("optimize", max(1, n_samples), "per-regime parameter search")
    ranked = random_search(data, capital, ("2014-01-01", "2025-12-31"),
                           n_samples, ctx=ctx, tick=_pr.get().tick)
    if not ranked:
        return {r: {"params": dict(DEFAULT_PARAMS), "sharpe": 0.0, "run_id": None}
                for r in REGIME_YEARS}

    top = [p for p, _ in ranked[:max(5, len(ranked) // 10)]]
    out: dict[str, dict] = {}
    for reg, years in REGIME_YEARS.items():
        best_params, best_score, best_sharpe = top[0], -1e9, 0.0
        for params in top:
            score, sharpe = _score_on_years(data, capital, params, years, ctx)
            if score > best_score:
                best_params, best_score, best_sharpe = params, score, sharpe
        out[reg] = {"params": best_params, "sharpe": round(best_sharpe, 3), "run_id": None}
        log.info("optimize_per_regime %s: best_score=%.2f sharpe=%.2f", reg, best_score, best_sharpe)
    return out
