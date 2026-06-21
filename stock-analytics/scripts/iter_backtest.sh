#!/bin/bash
# One-shot driver for the iterative optimizer loop:
#   1. run the quick walk-forward backtest (100 samples) inside the crawler container
#   2. pull the latest result from the DB into output/backtest_result.json
# Usage: iter_backtest.sh [CAPITAL]
set -euo pipefail

CAPITAL="${1:-1000000000}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== iter_backtest: backtest-quick (capital=$CAPITAL) ==="
bash "$SCRIPT_DIR/run_backtest.sh" "$CAPITAL" 100

echo "=== iter_backtest: pulling result JSON ==="
bash "$SCRIPT_DIR/after_backtest.sh"

echo "=== iter_backtest: done ==="
