"""
Parameter optimizer — Optuna Bayesian (TPE) search + local grid refinement.

Searches the TUNE_PARAMS space with Optuna's Tree-structured Parzen Estimator —
it learns from earlier trials instead of sampling blindly, so ~100-200 Bayesian
trials typically beat 1000 random ones.  Each trial is scored by a multi-objective
function that rewards Sharpe and raw return while heavily penalising drawdown >
25% and win-rate < 55%, and the best params are selected separately per market
regime.

Every trial starts from DEFAULT_PARAMS, overlays the economically-fixed
FIXED_PARAMS, then lets Optuna suggest one categorical value per TUNE_PARAMS key
(see wyckoff_opt.py §9.2).  All evaluations reuse a shared, pre-computed
BacktestContext so a sweep over hundreds of trials stays tractable.

See README_WYCKOFF_OPTIMIZED.md §9.
"""

from __future__ import annotations

import concurrent.futures as _cf
import logging
import multiprocessing as _mp
import os
import random

import optuna
from optuna.distributions import CategoricalDistribution

import opt_backtest as obt
from wyckoff_opt import DEFAULT_PARAMS, FIXED_PARAMS, TUNE_PARAMS

log = logging.getLogger(__name__)

# Optuna is chatty per-trial; keep our own progress logging instead.
optuna.logging.set_verbosity(optuna.logging.WARNING)

# Legacy grid retained for local_grid_search refinement around an Optuna seed.
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
    # Extension cap above MA20 for HOLD/Markup entries (999 = no cap)
    "max_entry_gap_pct":      [5, 8, 12, 999],
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


# ── Objective / score ─────────────────────────────────────────────────────────

def _score(result: obt.BacktestResult) -> float:
    """Multi-objective score (higher is better).  README §9.2/§9.4.

    Works on fractions: annual_return / max_drawdown / win_rate are normalised so
    no single term dominates regardless of magnitude.
    """
    annual = result.annual_return / 100.0
    score = (
        result.sharpe_ratio * 2.0                      # Sharpe (most important)
        - max(0.0, result.max_drawdown - 0.25) * 5.0   # heavy penalty if DD > 25%
        - max(0.0, 0.55 - result.win_rate) * 3.0       # penalty if win rate < 55%
        + annual * 0.5                                 # reward raw return
    )
    # Discourage degenerate "no-trade" param sets in non-downtrend windows.
    if result.total_trades == 0:
        score -= 1.0
    return score


# Backwards-compatible alias (local_grid_search and older callers use objective()).
objective = _score


def _base_params() -> dict:
    """Full param set seed: DEFAULT overlaid with the economically-fixed values."""
    p = dict(DEFAULT_PARAMS)
    p.update(FIXED_PARAMS)
    return p


# ── Optuna Bayesian search ────────────────────────────────────────────────────

def make_objective(data: dict, capital: float, train_split: tuple,
                   regime_years: list[str] | None = None,
                   ctx: obt.BacktestContext | None = None):
    """Build the Optuna objective closure for one search (README §9.3).

    Each trial starts from the full base param set, then Optuna suggests one value
    per TUNE_PARAMS key.  If ``regime_years`` is given the trial is scored as the
    mean over those calendar years; otherwise over the ``train_split`` window.
    """
    start, end = train_split

    def objective(trial: optuna.Trial) -> float:
        params = _base_params()
        for key, choices in TUNE_PARAMS.items():
            params[key] = trial.suggest_categorical(key, choices)

        if regime_years:
            scores = []
            for year in regime_years:
                res = obt.run_backtest(data, params, capital,
                                       f"{year}-01-01", f"{year}-12-31", ctx=ctx)
                scores.append(_score(res))
            return sum(scores) / len(scores)

        res = obt.run_backtest(data, params, capital, start, end, ctx=ctx)
        return _score(res)

    return objective


# ── Multi-process worker (real cores; sidesteps the GIL) ──────────────────────
# Optuna's n_jobs uses threads, so a pure-Python objective stays GIL-bound to one
# core. To actually use N cores we evaluate trials in separate PROCESSES via
# ask/tell. On Linux the pool is forked AFTER these module globals are set, so
# each worker inherits the (read-only) BacktestContext copy-on-write — no pickling
# of the large snapshots through the pool, no re-build per worker.
_W_CTX = None
_W_CAPITAL: float = 0.0
_W_SPLIT: tuple = ("", "")
_W_REGIME_YEARS = None


def _eval_tune(tune_params: dict) -> float:
    """Score one TUNE_PARAMS combination in a worker process (uses fork globals)."""
    params = _base_params()
    params.update(tune_params)
    if _W_REGIME_YEARS:
        scores = [
            _score(obt.run_backtest({}, params, _W_CAPITAL,
                                    f"{y}-01-01", f"{y}-12-31", ctx=_W_CTX))
            for y in _W_REGIME_YEARS
        ]
        return sum(scores) / len(scores)
    start, end = _W_SPLIT
    return _score(obt.run_backtest({}, params, _W_CAPITAL, start, end, ctx=_W_CTX))


def run_optuna(data: dict, capital: float, train_split: tuple, n_trials: int = 100,
               regime_years: list[str] | None = None, n_jobs: int = 7,
               study_name: str = "wyckoff",
               ctx: obt.BacktestContext | None = None, tick=None) -> optuna.Study:
    """Run Optuna Bayesian (TPE) optimization.

    Single-process by default. Set ``OPTUNA_PROCS`` > 1 to evaluate trials across
    that many worker PROCESSES (real multi-core; needs a shared ``ctx``).
    ``tick`` — optional no-arg callable fired once per finished trial (progress).
    """
    study = optuna.create_study(
        direction="maximize",
        study_name=study_name,
        sampler=optuna.samplers.TPESampler(seed=42),  # Bayesian TPE
    )

    n_procs = int(os.environ.get("OPTUNA_PROCS", "1"))

    # ── Multi-process path (ask/tell + forked ProcessPool) ──────────────────
    if n_procs > 1 and ctx is not None:
        global _W_CTX, _W_CAPITAL, _W_SPLIT, _W_REGIME_YEARS
        _W_CTX, _W_CAPITAL, _W_SPLIT, _W_REGIME_YEARS = ctx, capital, train_split, regime_years
        dists = {k: CategoricalDistribution(v) for k, v in TUNE_PARAMS.items()}
        mpctx = _mp.get_context("fork")
        done = 0
        log.info("  [%s] multi-process: %d workers × %d trials", study_name, n_procs, n_trials)
        with _cf.ProcessPoolExecutor(max_workers=n_procs, mp_context=mpctx) as pool:
            while done < n_trials:
                batch = min(n_procs, n_trials - done)
                trials = [study.ask(dists) for _ in range(batch)]
                futs = [pool.submit(_eval_tune, t.params) for t in trials]
                for t, f in zip(trials, futs):
                    try:
                        val = f.result()
                    except Exception as e:  # noqa: BLE001
                        log.warning("  [%s] trial failed: %s", study_name, e)
                        study.tell(t, state=optuna.trial.TrialState.FAIL)
                    else:
                        study.tell(t, val)
                    done += 1
                    if tick is not None:
                        tick()
        try:
            best = study.best_value
        except ValueError:           # all trials failed — no completed trial
            best = float("nan")
        log.info("  [%s] %d trials done, best=%.3f", study_name, done, best)
        return study

    # ── Single-process path (default) ───────────────────────────────────────
    callbacks = [lambda study, trial: tick()] if tick is not None else None
    study.optimize(
        make_objective(data, capital, train_split, regime_years, ctx=ctx),
        n_trials=n_trials,
        n_jobs=n_jobs,                 # threads only — GIL-bound for pure Python
        show_progress_bar=False,
        callbacks=callbacks,
    )
    try:
        best = study.best_value
    except ValueError:               # no completed trial
        best = float("nan")
    log.info("  [%s] %d trials done, best=%.3f", study_name, len(study.trials), best)
    return study


# ── Compatibility wrapper — ranked (params, score) list ───────────────────────

def random_search(data: dict, capital: float, train_split: tuple,
                  n_samples: int, ctx: obt.BacktestContext | None = None,
                  seed: int = 42, tick=None, n_jobs: int = 7) -> list[tuple[dict, float]]:
    """Optuna Bayesian search over ``n_samples`` trials on ``train_split``.

    Replaces the old random sampler (README §9.3) but keeps the same return shape
    callers expect: ``[(params, score), …]`` sorted by score descending, so the
    walk-forward driver in opt_backtest.py works unchanged.
    """
    start, end = train_split
    study = run_optuna(data, capital, train_split, n_trials=n_samples,
                       regime_years=None, n_jobs=n_jobs,
                       study_name=f"wf_{start}_{end}", ctx=ctx, tick=tick)

    results: list[tuple[dict, float]] = []
    for t in study.trials:
        if t.value is None:
            continue
        params = _base_params()
        params.update(t.params)
        results.append((params, t.value))
    results.sort(key=lambda r: r[1], reverse=True)

    if results:
        log.info("Optuna search [%d trials] best_score=%.2f", len(results), results[0][1])
    return results


def local_grid_search(data: dict, capital: float, train_split: tuple,
                      seed_params: dict, ctx: obt.BacktestContext | None = None,
                      radius: int = 1) -> tuple[dict, float]:
    """Vary each param ±``radius`` steps around ``seed_params``; return the best.

    Coordinate descent: optimise one parameter at a time, keeping the rest fixed
    at the running best — far cheaper than the full cartesian neighbourhood.
    Useful for sharpening an Optuna winner on the coarse PARAM_GRID lattice.
    """
    start, end = train_split
    best = dict(seed_params)
    best_score = _score(obt.run_backtest(data, best, capital, start, end, ctx=ctx))
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
            score = _score(obt.run_backtest(data, trial, capital, start, end, ctx=ctx))
            if score > best_score:
                best, best_score = trial, score
    return best, best_score


# ── Per-regime optimisation ───────────────────────────────────────────────────

def optimize_per_regime(data: dict, capital: float,
                        ctx: obt.BacktestContext | None = None,
                        n_trials: int = 100,
                        n_samples: int | None = None) -> dict[str, dict]:
    """Run Optuna separately for UPTREND / SIDEWAYS / DOWNTREND (README §9.3).

    ``n_samples`` is accepted as an alias for ``n_trials`` (opt_backtest passes it).
    Returns ``{regime: {'params': …, 'sharpe': best_value, 'run_id': None}}`` where
    ``params`` is a full param set ready to persist.
    """
    if n_samples is not None:
        n_trials = n_samples

    out: dict[str, dict] = {}
    for regime, years in REGIME_YEARS.items():
        print(f"\nOptimizing {regime} ({years})...")
        try:
            import progress as _pr
            _pr.get().set_phase(f"optimize_{regime.lower()}", max(1, n_trials),
                                f"Optuna {regime}")
            tick = _pr.get().tick
        except Exception:  # noqa: BLE001 — progress is best-effort
            tick = None

        study = run_optuna(
            data, capital,
            train_split=("2014-01-01", "2025-12-31"),
            n_trials=n_trials,
            regime_years=years,
            study_name=f"wyckoff_{regime.lower()}",
            ctx=ctx,
            tick=tick,
        )

        best = _base_params()
        best.update(study.best_params)  # merge Optuna winners over the base set
        out[regime] = {
            "params": best,
            "sharpe": round(float(study.best_value), 3),
            "run_id": None,
        }
        print(f"  Best score: {study.best_value:.3f}")
        print(f"  Best params: {study.best_params}")
        log.info("optimize_per_regime %s: best_score=%.3f", regime, study.best_value)
    return out
