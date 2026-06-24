#!/bin/bash
# Run the Wyckoff robust pipeline (method 8→4→7) inside the crawler container.
# Usage: run_robust_pipeline.sh [CAPITAL] [N_SAMPLES] [MC_RUNS] [START_DATE]
# Results: output/robust_pipeline_<ts>.json, output/robust_pipeline_<ts>_params.sql
#          and a backtest_<ts>.log; stage-2 also stored to portfolio_backtests.
set -euo pipefail

CAPITAL="${1:-1000000000}"
N_SAMPLES="${2:-200}"
MC_RUNS="${3:-2000}"
START_DATE="${4:-2014-01-01}"
CONTAINER="${CRAWLER_CONTAINER:-stock-analytics-crawler-1}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$SCRIPT_DIR/../output"
mkdir -p "$OUT_DIR"
LOGFILE="$OUT_DIR/robust_pipeline_$(date +%Y%m%d_%H%M%S).log"

{
    echo "Robust pipeline (8→4→7) started: $(date)"
    echo "Capital: $CAPITAL | Samples: $N_SAMPLES | MC runs: $MC_RUNS | From: $START_DATE"
    echo "---"
} | tee "$LOGFILE"

cat << 'PYEOF' | docker exec -i "$CONTAINER" python3 - "$CAPITAL" "$N_SAMPLES" "$MC_RUNS" "$START_DATE" 2>&1 | tee -a "$LOGFILE"
import sys, os, time, logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
from store import Store
from methods.wyckoff_robust_pipeline import run

capital   = float(sys.argv[1])
n_samples = int(sys.argv[2])
mc_runs   = int(sys.argv[3])
start     = sys.argv[4]
store     = Store(os.environ["DB_DSN"])
t0        = time.time()

run(store, capital=capital, n_samples=n_samples, mc_runs=mc_runs, start_date=start)
e = time.time() - t0
print(f"Finished in {int(e//60)}m {int(e%60)}s")
PYEOF

{ echo "---"; echo "Robust pipeline finished: $(date)"; } | tee -a "$LOGFILE"
