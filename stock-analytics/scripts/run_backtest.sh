#!/bin/bash
# Run the Wyckoff-Optimized walk-forward backtest inside the crawler container.
# Usage: run_backtest.sh [CAPITAL] [N_SAMPLES]
# Results: logs to output/backtest_<ts>.log; DB rows via store; summary via
#          after_backtest.sh.
set -euo pipefail

CAPITAL="${1:-1000000000}"
N_SAMPLES="${2:-1000}"
CONTAINER="${CRAWLER_CONTAINER:-stock-analytics-crawler-1}"

# Resolve paths relative to this script so it works from any CWD.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$SCRIPT_DIR/../output"
mkdir -p "$OUT_DIR"
LOGFILE="$OUT_DIR/backtest_$(date +%Y%m%d_%H%M%S).log"

{
    echo "Backtest started: $(date)"
    echo "Capital: $CAPITAL | Samples: $N_SAMPLES | Container: $CONTAINER"
    echo "---"
} | tee "$LOGFILE"

# Drive the backtest via a Python heredoc piped into the container.
cat << 'PYEOF' | docker exec -i "$CONTAINER" python3 - "$CAPITAL" "$N_SAMPLES" 2>&1 | tee -a "$LOGFILE"
import sys, os, time, logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
from store import Store
from opt_backtest import run_full_backtest

capital   = int(sys.argv[1])
n_samples = int(sys.argv[2])
store     = Store(os.environ["DB_DSN"])
t0        = time.time()

print(f"Loading VN100 data and running walk-forward ({n_samples} samples)...")
run_full_backtest(
    store=store, capital=capital,
    train_start="2014-01-01", train_end="2025-12-31",
    n_random_samples=n_samples,
)
e = time.time() - t0
print(f"Finished in {int(e//3600)}h {int((e%3600)//60)}m")
PYEOF

{
    echo "---"
    echo "Backtest finished: $(date)"
} | tee -a "$LOGFILE"
