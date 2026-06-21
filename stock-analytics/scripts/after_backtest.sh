#!/bin/bash
# Pull the latest backtest result from the DB into output/backtest_result.json,
# print a quick summary, and (if ANTHROPIC_API_KEY is set) write a Claude
# analysis to output/backtest_analysis.md.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR/.."
OUT_DIR="$ROOT_DIR/output"
CONTAINER="${CRAWLER_CONTAINER:-stock-analytics-crawler-1}"
mkdir -p "$OUT_DIR"

# Load .env (for ANTHROPIC_API_KEY) if present.
[ -f "$ROOT_DIR/.env" ] && set -a && . "$ROOT_DIR/.env" && set +a || true

echo "Fetching result from DB..."
docker exec "$CONTAINER" python3 - > "$OUT_DIR/backtest_result.json" << 'PYEOF'
import os, json
from store import Store

store = Store(os.environ["DB_DSN"])
runs  = store.get_backtest_runs(limit=1)
if not runs:
    print(json.dumps({"error": "No results. Run `make backtest` first."}, ensure_ascii=False))
    raise SystemExit(0)

r      = runs[0]
trades = store.get_backtest_trades(r["id"])
st     = sorted(trades, key=lambda t: t.get("pnl_pct") or 0)
print(json.dumps({
    "run_at":        str(r["run_at"]),
    "capital":       float(r["capital"]) if r["capital"] is not None else None,
    "annual_return": float(r["annual_return"]) if r["annual_return"] is not None else None,
    "sharpe_ratio":  float(r["sharpe_ratio"]) if r["sharpe_ratio"] is not None else None,
    "max_drawdown":  float(r["max_drawdown"]) if r["max_drawdown"] is not None else None,
    "win_rate":      float(r["win_rate"]) if r["win_rate"] is not None else None,
    "total_trades":  r["total_trades"],
    "avg_hold_days": float(r["avg_hold_days"]) if r["avg_hold_days"] is not None else None,
    "by_year":       r.get("by_year", {}),
    "indicator_ic":  r.get("indicator_ic", {}),
    "best_trades":   st[-3:],
    "worst_trades":  st[:3],
    "params":        r.get("params", {}),
}, indent=2, default=str, ensure_ascii=False))
PYEOF
echo "Wrote: $OUT_DIR/backtest_result.json"

# Quick console summary.
python3 - "$OUT_DIR/backtest_result.json" << 'PYEOF'
import json, sys
d = json.load(open(sys.argv[1]))
if "error" in d:
    print("ERROR:", d["error"]); raise SystemExit(0)
def pct(x): return f"{x:.1%}" if isinstance(x, (int, float)) else "n/a"
print(f"Annual return : {pct(d.get('annual_return'))}")
print(f"Sharpe ratio  : {d.get('sharpe_ratio')}")
print(f"Max drawdown  : {pct(d.get('max_drawdown'))}")
print(f"Win rate      : {pct(d.get('win_rate'))}")
print(f"Total trades  : {d.get('total_trades')}")
for y, v in sorted((d.get("by_year") or {}).items()):
    v = float(v)
    print(f"  {y}: {v:+.1f}% " + "#" * max(0, int(v / 5)))
PYEOF

# Optional Claude analysis.
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    echo "Calling Claude API for analysis..."
    python3 - "$OUT_DIR/backtest_result.json" > "$OUT_DIR/backtest_analysis.md" << 'PYEOF'
import os, json, sys, urllib.request
data = json.load(open(sys.argv[1]))
if "error" in data:
    print("# Error\n" + data["error"]); raise SystemExit(0)
prompt = (
    "Backtest Wyckoff VN100 2014-2025.\n\n"
    f"Annual: {data.get('annual_return')} | Sharpe: {data.get('sharpe_ratio')} "
    f"| MaxDD: {data.get('max_drawdown')} | WinRate: {data.get('win_rate')} "
    f"| Trades: {data.get('total_trades')} | AvgHold: {data.get('avg_hold_days')}d\n\n"
    f"By year:\n{json.dumps(data.get('by_year',{}), indent=2, ensure_ascii=False)}\n\n"
    f"Indicator IC:\n{json.dumps(data.get('indicator_ic',{}), indent=2, ensure_ascii=False)}\n\n"
    f"Best: {json.dumps(data.get('best_trades',[]), ensure_ascii=False, default=str)}\n"
    f"Worst: {json.dumps(data.get('worst_trades',[]), ensure_ascii=False, default=str)}\n\n"
    "Phan tich: dat muc tieu 20-30%/nam khong? Chi bao nao nen bo (IC<0.02)? "
    "2022 downtrend co tranh lo khong? De xuat cai tien params. Tra loi tieng Viet, Markdown."
)
req = urllib.request.Request(
    "https://api.anthropic.com/v1/messages",
    data=json.dumps({"model": os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-6"),
                     "max_tokens": 2000,
                     "messages": [{"role": "user", "content": prompt}]}).encode(),
    headers={"x-api-key": os.environ["ANTHROPIC_API_KEY"],
             "anthropic-version": "2023-06-01", "content-type": "application/json"},
)
with urllib.request.urlopen(req, timeout=120) as resp:
    r = json.loads(resp.read())
    print(f"# Backtest Analysis — {data['run_at']}\n")
    print(r["content"][0]["text"])
PYEOF
    echo "Wrote: $OUT_DIR/backtest_analysis.md"
else
    echo "(No ANTHROPIC_API_KEY — skipping Claude analysis)"
fi
