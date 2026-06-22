#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Iterative Wyckoff optimization loop — bash-orchestrated, token-cheap.
#
# Division of labour:
#   • Optuna (make backtest-quick)  → numeric search inside ranges. 0 tokens.
#   • bash + python                 → pull result, check stop conditions, track
#                                      best-so-far. 0 tokens.
#   • claude -p (one short call/iter)→ strategic decision only: freeze params,
#                                      narrow ranges, edit the 2 param files.
#                                      Stateless — exits each iteration so context
#                                      never accumulates and the README is never
#                                      re-read.
#
# Usage:
#   bash stock-analytics/scripts/optimize_loop.sh
#   MAX_ITER=6 CLAUDE_MODEL=sonnet bash stock-analytics/scripts/optimize_loop.sh
#
# Run `make run-stock` first (crawler container must be up with data loaded).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"          # repo root
OUT_DIR="$SCRIPT_DIR/../output"
mkdir -p "$OUT_DIR"

RESULT="$OUT_DIR/backtest_result.json"
BEST="$OUT_DIR/best_params.json"
LOG="$OUT_DIR/optimization_log.md"

WYCKOFF="stock-analytics/crawler/wyckoff_opt.py"     # DEFAULT_PARAMS, FIXED_PARAMS
OPTIMIZER="stock-analytics/crawler/optimizer.py"     # TUNE_PARAMS

MAX_ITER="${MAX_ITER:-10}"
MODEL="${CLAUDE_MODEL:-sonnet}"                       # cheaper model for bounded analysis
CONTAINER="${CRAWLER_CONTAINER:-stock-analytics-crawler-1}"

# Targets (fractions, except RET2022 which is a percent figure from by_year).
T_RETURN=0.20
T_DD=0.25
T_WIN=0.55
T_SHARPE=1.0
T_2022=-5

log()  { echo "[$(date '+%H:%M:%S')] $*"; }
hr()   { printf '%.0s─' {1..70}; echo; }

# ── Pull latest backtest result from DB → JSON (same query after_backtest.sh
#    uses, minus the extra Claude API analysis call). ──────────────────────────
pull_result() {
    docker exec -i "$CONTAINER" python3 - > "$RESULT" << 'PYEOF'
import os, json
from store import Store
store = Store(os.environ["DB_DSN"])
runs  = store.get_backtest_runs(limit=1)
if not runs:
    print(json.dumps({"error": "No backtest results in DB."})); raise SystemExit(0)
r      = runs[0]
trades = store.get_backtest_trades(r["id"])
st     = sorted(trades, key=lambda t: t.get("pnl_pct") or 0)
fnum   = lambda v: float(v) if v is not None else None
print(json.dumps({
    "run_at":        str(r["run_at"]),
    "annual_return": fnum(r["annual_return"]),
    "sharpe_ratio":  fnum(r["sharpe_ratio"]),
    "max_drawdown":  fnum(r["max_drawdown"]),
    "win_rate":      fnum(r["win_rate"]),
    "total_trades":  r["total_trades"],
    "avg_hold_days": fnum(r["avg_hold_days"]),
    "by_year":       r.get("by_year", {}),
    "indicator_ic":  r.get("indicator_ic", {}),
    "best_trades":   st[-3:],
    "worst_trades":  st[:3],
    "params":        r.get("params", {}),
}, indent=2, default=str, ensure_ascii=False))
PYEOF
}

# ── Evaluate result: emit shell-evalable metrics, check targets, track best. ──
#    Prints KEY=VALUE lines (consumed via `eval`); BASELINE=1 when return>=20%
#    and drawdown<=cap. Best run = highest annual_return among DD-safe runs.
eval_result() {
    python3 - "$RESULT" "$BEST" "$T_RETURN" "$T_DD" "$T_WIN" "$T_SHARPE" "$T_2022" << 'PYEOF'
import json, sys, os
res_path, best_path, tR, tDD, tWin, tSh, t2022 = sys.argv[1], sys.argv[2], *map(float, sys.argv[3:8])
d = json.load(open(res_path))
if "error" in d or d.get("annual_return") is None:
    print("VALID=0"); raise SystemExit(0)

ann  = float(d["annual_return"]); sh = float(d.get("sharpe_ratio") or 0)
dd   = abs(float(d["max_drawdown"])); win = float(d.get("win_rate") or 0)
by   = {str(k): float(v) for k, v in (d.get("by_year") or {}).items()}
r22  = by.get("2022", 0.0)

# Baseline = minimum acceptable: >=20% annual return kept under the DD cap.
# We do NOT stop when it's met — higher return is always better, so we keep
# iterating and just remember the best run found.
baseline = (ann >= tR) and (dd <= tDD)

# Best-so-far: among DD-safe runs (drawdown <= cap) pick the HIGHEST annual
# return. A DD-safe run always beats an unsafe one regardless of return.
score = (1 if dd <= tDD else 0, round(ann, 4))
is_best = True
if os.path.exists(best_path):
    try:
        prev      = json.load(open(best_path))
        prev_dd   = abs(float(prev.get("max_drawdown") or 1.0))
        prev_ann  = float(prev.get("annual_return") or -1.0)
        prev_score = (1 if prev_dd <= tDD else 0, round(prev_ann, 4))
        is_best   = score > prev_score
    except Exception:
        is_best = True
if is_best:
    json.dump({**d, "baseline_met": baseline}, open(best_path, "w"), indent=2, default=str, ensure_ascii=False)

print(f"VALID=1")
print(f"BASELINE={1 if baseline else 0}")
print(f"IS_BEST={1 if is_best else 0}")
print(f"ANNUAL={ann}")
print(f"SHARPE={sh}")
print(f"MAXDD={dd}")
print(f"WINRATE={win}")
print(f"RET2022={r22}")
PYEOF
}

# ── One short, stateless Claude call: adjust the search space, then exit. ─────
claude_adjust() {
    local i="$1"
    local prompt
    prompt=$(cat << EOF
You are tuning a Wyckoff trading strategy. This is ONE single-shot task: edit the
two param files, then exit. Do NOT run any backtest. Do NOT read the README.

Latest backtest (full detail in $RESULT — a small file, read it for by_year,
indicator_ic and the Optuna-best "params" to narrow around):
  annual_return=$ANNUAL  sharpe=$SHARPE  max_drawdown=$MAXDD  win_rate=$WINRATE  by_year[2022]=$RET2022

Goal: FIRST reach annual_return >= $T_RETURN while keeping max_drawdown <= $T_DD.
Once that baseline holds, keep pushing annual_return HIGHER — higher return is
always better — without letting max_drawdown exceed $T_DD. Treat win_rate>=$T_WIN
and sharpe>=$T_SHARPE as quality guides, not hard stops.

Read ONLY these two files and edit them:
  - $WYCKOFF   (DEFAULT_PARAMS, FIXED_PARAMS)
  - $OPTIMIZER (TUNE_PARAMS)

Decision rules:
  - annual_return < $T_RETURN -> loosen entry: lower rsi_entry_max, lower min_signal_score
  - max_drawdown  > $T_DD  -> tighten stops: raise atr_stop_mult, lower atr_trail_pct
  - win_rate      < $T_WIN -> tighten entry: raise min_signal_score, lower rsi_entry_max
  - by_year[2022] < $T_2022   -> lower downtrend_drawdown_pct (detect downtrend earlier)
  - indicator IC  < 0.02   -> note the weak indicator in the log (do NOT remove it yet)

Then:
  1. FREEZE any TUNE_PARAMS that has converged: remove it from TUNE_PARAMS in
     $OPTIMIZER and add it to FIXED_PARAMS in $WYCKOFF at its current best value.
  2. NARROW the range of the remaining TUNE_PARAMS around the current best.
  3. You MUST change the search space (freeze >=1 param OR narrow >=1 range),
     otherwise the next backtest is byte-identical (Optuna seed is fixed at 42).
  4. Append to $LOG a section titled "## Iteration $i — changes": a bullet list
     of (param: old -> new) plus a one-line reason each. Under 15 lines. Do NOT
     paste the metrics (the loop already logged them).

Do not read or modify any other file. Finish and exit.
EOF
)
    claude -p --permission-mode acceptEdits --model "$MODEL" "$prompt"
}

# ── Main loop ────────────────────────────────────────────────────────────────
{
hr; log "Iterative optimization started — max $MAX_ITER iterations, model=$MODEL"; hr

for ((i=1; i<=MAX_ITER; i++)); do
    hr; log "ITERATION $i / $MAX_ITER"

    log "→ make backtest-quick (Optuna, no tokens)…"
    ( cd "$ROOT_DIR" && make backtest-quick )

    log "→ pulling result from DB…"
    pull_result

    metrics="$(eval_result)"
    eval "$metrics"

    if [[ "${VALID:-0}" != "1" ]]; then
        log "!! Backtest produced no valid metrics — stopping. See $RESULT"
        break
    fi

    printf -v summary "annual=%.1f%%  sharpe=%.2f  maxDD=%.1f%%  win=%.1f%%  2022=%.1f%%" \
        "$(echo "$ANNUAL*100" | bc -l)" "$SHARPE" "$(echo "$MAXDD*100" | bc -l)" \
        "$(echo "$WINRATE*100" | bc -l)" "$RET2022"
    log "   $summary  (best_so_far=${IS_BEST})"

    # Deterministic results block in the human log.
    {
        echo
        echo "## Iteration $i — results ($(date '+%Y-%m-%d %H:%M'))"
        echo "- $summary"
        echo "- baseline_met=${BASELINE}  is_best=${IS_BEST}"
    } >> "$LOG"

    # Baseline (>=20% return under the DD cap) does NOT stop the loop — we keep
    # going to push return higher. It's only a milestone marker.
    if [[ "$BASELINE" == "1" ]]; then
        log "✓ Baseline reached (return ≥ ${T_RETURN}, DD ≤ ${T_DD}) — continuing to push higher."
    fi

    # On the final iteration there's no further backtest to consume new params, so
    # we normally skip the Claude call. QUICK_TEST=1 forces it so a 1-iteration run
    # still exercises the full backtest → claude → edit pipeline.
    if (( i < MAX_ITER )) || [[ "${QUICK_TEST:-0}" == "1" ]]; then
        log "→ claude adjusting search space (1 short call)…"
        if ! claude_adjust "$i"; then
            log "!! Claude call failed (token/usage limit?). Stopping cleanly."
            log "   Progress is saved (param files + best_params.json). Re-run"
            log "   'make claude-optimize' later to continue from here."
            break
        fi
    else
        log "Reached MAX_ITER ($MAX_ITER iterations) — keeping the best run found."
    fi
done

# ── Final summary (deterministic, no tokens). ────────────────────────────────
hr; log "Writing final summary…"
python3 - "$BEST" "$LOG" << 'PYEOF'
import json, sys, os
best_path, log_path = sys.argv[1], sys.argv[2]
with open(log_path, "a") as f:
    f.write("\n## FINAL SUMMARY\n")
    if not os.path.exists(best_path):
        f.write("- No valid result captured.\n"); raise SystemExit(0)
    b = json.load(open(best_path))
    pct = lambda x: f"{float(x)*100:.1f}%" if x is not None else "n/a"
    f.write(f"- run_at: {b.get('run_at')}\n")
    f.write(f"- baseline met (return>=20% & DD<=25%): {b.get('baseline_met')}\n")
    f.write(f"- annual_return: {pct(b.get('annual_return'))}  "
            f"sharpe: {b.get('sharpe_ratio')}  "
            f"max_drawdown: {pct(b.get('max_drawdown'))}  "
            f"win_rate: {pct(b.get('win_rate'))}\n")
    f.write(f"- best params:\n```json\n{json.dumps(b.get('params', {}), indent=2, ensure_ascii=False)}\n```\n")
print("Final summary written.")
PYEOF

hr; log "Done. Log: $LOG  |  Best params: $BEST"; hr
} 2>&1 | tee -a "$OUT_DIR/optimize_loop.log"
