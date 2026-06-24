"""
Wyckoff robust pipeline — method 8 → 4 → 7.

A single, durable global parameter set for the VN100 Wyckoff strategy, built the
way a real discretionary-systematic trader would:

  Stage 1 (method 8 — plateau search):
      Search the TUNE_PARAMS space scoring each candidate by a CONTINUOUS
      2014→now backtest. Among the top candidates, pick the one sitting on a
      PLATEAU — i.e. whose one-step neighbours on every axis are also good
      (maximin / worst-neighbour score). A lone spike that only works at one
      exact value is rejected as overfit. Also emits 1-D sensitivity curves.

  Stage 2 (method 4 — continuous):
      Run the chosen params straight through 2014→now on the whole VN100, one
      shared compounding account, no per-year re-tuning, positions carried
      across years. This is the honest "deploy this set" performance.

  Stage 3 (method 7 — Monte Carlo):
      Bootstrap-resample the realised trades 1000s of times to get the
      DISTRIBUTION of CAGR / max-drawdown and the probability of a deep
      drawdown — the psychological stress test ("what if the bad luck comes
      first").

Why one GLOBAL set (not per-regime)? The whole point is robustness + a rule set
durable enough to run 6-12 months before re-tuning. Regime is still respected
via the engine's downtrend gate (no buying in downtrends).

This module only COMPUTES + writes result files; it does not deploy. Deploy by
loading the emitted ``*_params.sql`` into ``optimized_params``.
"""
from __future__ import annotations

import logging
import random
from datetime import datetime

import opt_backtest as obt
import wyckoff_opt as wo

log = logging.getLogger(__name__)

# Defaults — overridable by the runner.
DEFAULTS = {
    "start_date":  "2014-01-01",
    "capital":     1_000_000_000.0,
    "n_samples":   200,    # stage-1 random candidates
    "top_k":       4,      # candidates that get the neighbourhood robustness check
    "mc_runs":     2000,   # stage-3 Monte Carlo paths
    "slots":       8,      # concurrent positions (sizing for MC = 1/slots)
    "seed":        42,
}


# ── Scoring / metrics ─────────────────────────────────────────────────────────

def _score(res: "obt.BacktestResult") -> float:
    """Robust objective on a continuous run (higher better). Sharpe-led, heavy
    drawdown penalty, light return bonus — mirrors optimizer._score."""
    if not res.trades:
        return -9.99
    sharpe = res.sharpe_ratio or 0.0
    dd     = res.max_drawdown or 1.0
    ann    = (res.annual_return or 0.0) / 100.0
    wr     = res.win_rate or 0.0
    return sharpe * 2.0 - max(0.0, dd - 0.25) * 5.0 - max(0.0, 0.55 - wr) * 3.0 + ann * 0.5


def _metrics(res: "obt.BacktestResult") -> dict:
    return {
        "total_return_pct": res.total_return,
        "cagr_pct":         res.annual_return,
        "sharpe":           res.sharpe_ratio,
        "max_drawdown_pct": round((res.max_drawdown or 0.0) * 100, 2),
        "win_rate_pct":     round((res.win_rate or 0.0) * 100, 1),
        "trades":           res.total_trades,
    }


def _run(data, ctx, capital, start, end, params) -> "obt.BacktestResult":
    return obt.run_backtest(data, params, capital, start, end, ctx=ctx)


# ── Stage 1 — plateau search (method 8) ───────────────────────────────────────

def _neighbours(params: dict) -> list[tuple[str, dict]]:
    """One-step grid neighbours of ``params`` on every tuned axis."""
    out: list[tuple[str, dict]] = []
    for key, choices in wo.TUNE_PARAMS.items():
        if key not in params or params[key] not in choices:
            continue
        i = choices.index(params[key])
        for j in (i - 1, i + 1):
            if 0 <= j < len(choices):
                variant = dict(params)
                variant[key] = choices[j]
                out.append((f"{key}={choices[j]}", variant))
    return out


def _sensitivity(data, ctx, capital, start, end, params: dict, pr=None) -> dict:
    """1-D sweep of every tuned param across its whole grid (others fixed at the
    chosen value). Gives the curves + a plateau flag for the frontend later."""
    curves: dict = {}
    for key, choices in wo.TUNE_PARAMS.items():
        pts = []
        for v in choices:
            p = dict(params); p[key] = v
            m = _metrics(_run(data, ctx, capital, start, end, p))
            if pr:
                pr.tick()
            pts.append({"value": v, "cagr_pct": m["cagr_pct"], "sharpe": m["sharpe"],
                        "max_drawdown_pct": m["max_drawdown_pct"]})
        chosen = params.get(key)
        sharpes = [pt["sharpe"] or 0 for pt in pts]
        spread = (max(sharpes) - min(sharpes)) if sharpes else 0.0
        # plateau = chosen isn't a lone spike: neighbours within 25% of best sharpe
        best = max(sharpes) if sharpes else 0.0
        near = [pt for pt in pts if (pt["sharpe"] or 0) >= best * 0.75]
        curves[key] = {"chosen": chosen, "points": pts,
                       "sharpe_spread": round(spread, 3),
                       "plateau": len(near) >= 2}
    return curves


def stage1_plateau(data, ctx, capital, start, end, n_samples, top_k, rng, pr=None) -> dict:
    keys = list(wo.TUNE_PARAMS.keys())
    log.info("stage1: random search %d candidates", n_samples)
    if pr:
        pr.set_phase("stage1_search", n_samples, "Stage 1: plateau search")
    log_every = max(1, n_samples // 20)
    scored: list[tuple[float, dict, dict]] = []
    seen: set = set()
    for i in range(n_samples):
        if pr:
            pr.tick()
        p = {k: rng.choice(wo.TUNE_PARAMS[k]) for k in keys}
        sig = tuple(sorted(p.items()))
        if sig not in seen:
            seen.add(sig)
            res = _run(data, ctx, capital, start, end, p)
            scored.append((_score(res), p, _metrics(res)))
        if (i + 1) % log_every == 0 or i + 1 == n_samples:
            best_so_far = max((s for s, _, _ in scored), default=float("nan"))
            log.info("stage1: %d/%d scored (best score %.2f)", i + 1, n_samples, best_so_far)
    scored.sort(key=lambda x: x[0], reverse=True)
    top = scored[:top_k]

    # Robustness phase: every top candidate's neighbours + the 1-D sensitivity sweep.
    n_robust = sum(len(_neighbours(p)) for _, p, _ in top) \
        + sum(len(v) for v in wo.TUNE_PARAMS.values())
    log.info("stage1: robustness (worst-neighbour) on top %d (%d runs)", len(top), n_robust)
    if pr:
        pr.set_phase("stage1_robust", n_robust, "Stage 1: neighbours + sensitivity")
    best = None
    for sc, p, m in top:
        worst = sc
        for _, variant in _neighbours(p):
            worst = min(worst, _score(_run(data, ctx, capital, start, end, variant)))
            if pr:
                pr.tick()
        cand = {"params": p, "score": round(sc, 3), "worst_neighbour_score": round(worst, 3),
                "metrics": m}
        if best is None or cand["worst_neighbour_score"] > best["worst_neighbour_score"]:
            best = cand

    log.info("stage1: chosen worst-neighbour score=%.3f", best["worst_neighbour_score"])
    sens = _sensitivity(data, ctx, capital, start, end, best["params"], pr=pr)
    fragile = [k for k, c in sens.items() if not c["plateau"]]
    return {
        "chosen_params": best["params"],
        "chosen_score": best["score"],
        "worst_neighbour_score": best["worst_neighbour_score"],
        "chosen_metrics": best["metrics"],
        "top_candidates": [{"score": round(s, 3), "params": p, "metrics": m} for s, p, m in top],
        "sensitivity": sens,
        "fragile_params": fragile,
    }


# ── Stage 3 — Monte Carlo (method 7) ──────────────────────────────────────────

def stage3_montecarlo(trades: list[dict], slots: int, n_runs: int, rng) -> dict:
    """Bootstrap-resample the realised trades (with replacement, random order)
    to get the distribution of total return + max drawdown. Position sizing is
    approximated as 1/slots of equity per trade (the engine's equal-weight)."""
    rets = [(t.get("pnl_pct") or 0.0) / 100.0 for t in trades]
    n = len(rets)
    if n == 0:
        return {"n_runs": 0, "note": "no trades"}
    weight = 1.0 / max(1, slots)
    finals, dds = [], []
    for _ in range(n_runs):
        eq = peak = 1.0
        mdd = 0.0
        for _ in range(n):
            r = rets[rng.randrange(n)]            # sample with replacement
            eq *= (1.0 + r * weight)
            peak = max(peak, eq)
            mdd = max(mdd, (peak - eq) / peak if peak > 0 else 0.0)
        finals.append((eq - 1.0) * 100.0)
        dds.append(mdd * 100.0)
    finals.sort(); dds.sort()

    def pct(a, q):
        return round(a[min(len(a) - 1, int(q * len(a)))], 2)

    return {
        "n_runs": n_runs, "trades": n, "sizing": f"1/{slots} equity per trade",
        "total_return_pct": {"p5": pct(finals, .05), "p50": pct(finals, .50),
                             "p95": pct(finals, .95), "worst": round(min(finals), 2)},
        "max_drawdown_pct": {"p50": pct(dds, .50), "p95": pct(dds, .95),
                             "worst": round(max(dds), 2)},
        "prob_drawdown_gt_20pct": round(sum(d > 20 for d in dds) / n_runs, 3),
        "prob_drawdown_gt_25pct": round(sum(d > 25 for d in dds) / n_runs, 3),
        "prob_drawdown_gt_30pct": round(sum(d > 30 for d in dds) / n_runs, 3),
        "prob_total_loss": round(sum(f < 0 for f in finals) / n_runs, 3),
    }


# ── Deploy SQL (same global params for all three regimes) ─────────────────────

def _deploy_sql(params: dict, score: float) -> str:
    rows = ",\n".join(
        f"  ({obt._sqlv(reg)}, {obt._sqlj(params)}, NULL, {obt._sqlv(round(score, 3))})"
        for reg in ("UPTREND", "SIDEWAYS", "DOWNTREND")
    )
    return (
        "-- Wyckoff robust pipeline (8→4→7) — global params for ALL regimes\n"
        "-- Load on the target DB:  psql \"$DB_DSN\" -f <this file>\n"
        "BEGIN;\nINSERT INTO optimized_params (regime, params, run_id, sharpe) VALUES\n"
        + rows +
        "\nON CONFLICT (regime) DO UPDATE SET params=EXCLUDED.params, "
        "run_id=EXCLUDED.run_id, sharpe=EXCLUDED.sharpe, updated_at=NOW();\nCOMMIT;\n"
    )


# ── Orchestration ─────────────────────────────────────────────────────────────

def run(store, **kw) -> dict:
    """Run the full 8→4→7 pipeline and write result files to output/.

    Reads VN100 + VNINDEX from ``store``; builds the snapshot context once
    (cached on disk). Returns the assembled result dict.
    """
    cfg = {**DEFAULTS, **{k: v for k, v in kw.items() if v is not None}}
    rng = random.Random(cfg["seed"])
    store.ensure_wyckoff_opt_tables()

    # Progress reporting (pollable via GET /api/backtest/progress + make
    # backtest-progress) — same reporter the 3a walk-forward uses, with this
    # pipeline's own phase plan so overall % is meaningful.
    import progress as _pr
    pr = _pr.get()
    pr.start("robust pipeline 8+4+7")
    pr.set_plan([
        ("precompute",    "Pre-computing signal snapshots",     30.0),
        ("stage1_search", "Stage 1: plateau search",            35.0),
        ("stage1_robust", "Stage 1: neighbours + sensitivity",  25.0),
        ("stage2",        "Stage 2: continuous run",             7.0),
        ("stage3",        "Stage 3: Monte Carlo",                3.0),
    ])

    # Load data.
    import sector_rotation as sr
    syms = store.get_vn100_symbols() or list(sr.VN100)
    data: dict[str, list[dict]] = {}
    for sym in syms + [obt.VNINDEX_SYM]:
        bars = store.get_symbol_quotes(sym, days=9999)
        if bars:
            data[sym] = bars
    if obt.VNINDEX_SYM not in data:
        raise RuntimeError("VNINDEX data missing — regime detection needs it")
    start = cfg["start_date"]
    end = max(str(b[-1]["date"]) for b in data.values())
    symbol_sectors = store.get_all_symbols_with_sectors()

    log.info("robust pipeline: %d symbols %s→%s | samples=%d top_k=%d mc=%d",
             len(data) - 1, start, end, cfg["n_samples"], cfg["top_k"], cfg["mc_runs"])
    ctx = obt.build_context(data, symbol_sectors, lookback=260, step=5,
                            start_date=start, end_date=end)

    # Stage 1 — plateau search.
    s1 = stage1_plateau(data, ctx, cfg["capital"], start, end,
                        cfg["n_samples"], cfg["top_k"], rng, pr=pr)
    params = s1["chosen_params"]

    # Stage 2 — continuous run with the chosen params.
    pr.set_phase("stage2", 1, "Stage 2: continuous run")
    log.info("stage2: continuous run 2014→now with chosen params")
    res = _run(data, ctx, cfg["capital"], start, end, params)
    s2 = obt.build_model_backtest_payload(
        res, cfg["capital"], start, end,
        {"UPTREND": params, "SIDEWAYS": params, "DOWNTREND": params}, len(data) - 1)
    pr.tick()

    # Stage 3 — Monte Carlo on the realised trades.
    pr.set_phase("stage3", 1, "Stage 3: Monte Carlo")
    log.info("stage3: Monte Carlo %d paths on %d trades", cfg["mc_runs"], len(s2["trades"]))
    s3 = stage3_montecarlo(s2["trades"], cfg["slots"], cfg["mc_runs"], rng)
    pr.tick()

    result = {
        "meta": {
            "method": "8+4+7 (plateau → continuous → monte-carlo)",
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "start_date": start, "end_date": end, "capital": cfg["capital"],
            "config": {k: cfg[k] for k in ("n_samples", "top_k", "mc_runs", "slots", "seed")},
        },
        "stage1_plateau": s1,
        "stage2_continuous": {"summary": s2["summary"], "yearly": s2["yearly"],
                              "equity_curve": s2["equity_curve"], "trades": s2["trades"]},
        "stage3_montecarlo": s3,
    }

    # Persist: full JSON, deploy SQL, and the continuous result into the
    # portfolio_backtests table so the VN100-BT tab can show it.
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    import json
    obt._write_output(f"robust_pipeline_{ts}.json",
                      lambda fh: json.dump(result, fh, ensure_ascii=False, indent=2, default=str))
    obt._write_output(f"robust_pipeline_{ts}_params.sql",
                      lambda fh: fh.write(_deploy_sql(params, s1["chosen_score"])))

    # Compact, portable params doc — THE one file to ship back from the server.
    # Import into any DB with:  make import-params FILE=output/<this file>
    sm = s2["summary"]
    method_metrics = {
        "cagr_pct": sm["cagr_pct"], "sharpe": sm["sharpe"],
        "max_drawdown_pct": sm["max_drawdown_pct"], "win_rate_pct": sm["win_rate"],
        "trades": sm["executed_trades"], "score": s1["chosen_score"],
        "mc_p95_drawdown_pct": s3.get("max_drawdown_pct", {}).get("p95"),
        "mc_prob_dd_gt_25pct": s3.get("prob_drawdown_gt_25pct"),
        "fragile_params": s1["fragile_params"],
    }
    params_doc = {
        "method": "8+4+7", "generated_at": result["meta"]["generated_at"],
        "start_date": start, "end_date": end,
        "params": params, "metrics": method_metrics,
    }
    params_json = f"robust_pipeline_{ts}_params.json"
    obt._write_output(params_json,
                      lambda fh: json.dump(params_doc, fh, ensure_ascii=False, indent=2, default=str))

    try:
        store.save_portfolio_backtest("Robust pipeline 8+4+7", s2)
    except Exception as e:  # noqa: BLE001
        log.warning("could not store stage-2 result: %s", e)

    # Register this method's best param set (registry only — does NOT touch the
    # live optimized_params; deploy explicitly via store.deploy_method_params or
    # the emitted *_params.sql).
    try:
        store.save_method_params("8+4+7", params, method_metrics)
    except Exception as e:  # noqa: BLE001
        log.warning("could not register method params: %s", e)

    m = s2["summary"]
    log.info("robust pipeline done: CAGR %.1f%% MaxDD %.1f%% Sharpe %s | "
             "MC p95 DD %.1f%% P(DD>25%%)=%.1f%% | fragile=%s",
             m["cagr_pct"], m["max_drawdown_pct"], m["sharpe"],
             s3.get("max_drawdown_pct", {}).get("p95"),
             s3.get("prob_drawdown_gt_25pct", 0) * 100, s1["fragile_params"])
    pr.finish("robust pipeline done")
    return result
