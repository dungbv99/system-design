#!/usr/bin/env python3
"""Trace WHERE the time goes — profiles BOTH phases of a backtest run:

  1. build_context  (the precompute — the ~1.5h part of a full run)
  2. run_backtest   (one Optuna trial)

separately, so we can see the hotspot of each. Uses a short window by default
so the whole trace finishes in a couple of minutes.

Run inside the crawler container (scripts/ is mounted — no rebuild needed):
    docker exec stock-analytics-crawler-1 python3 /app/scripts/profile_backtest.py
    docker exec stock-analytics-crawler-1 python3 /app/scripts/profile_backtest.py 2014-01-01 2014-06-30
"""
import sys
import os
import time
import cProfile
import pstats

sys.path.insert(0, "/app")           # engine modules live in /app

from store import Store               # noqa: E402
import opt_backtest as obt            # noqa: E402
from wyckoff_opt import DEFAULT_PARAMS  # noqa: E402

START = sys.argv[1] if len(sys.argv) > 1 else "2014-01-01"
END = sys.argv[2] if len(sys.argv) > 2 else "2014-03-31"


def show(pr, label, n=15):
    print("\n" + "=" * 64)
    print(f"=== {label}: top {n} by tottime (self time) ===")
    print("=" * 64, flush=True)
    pstats.Stats(pr).sort_stats("tottime").print_stats(n)


st = Store(os.environ["DB_DSN"])
syms = st.get_vn100_symbols()
print(f"[1/3] loading {len(syms)} symbols + VNINDEX from DB...", flush=True)
data = {s: st.get_symbol_quotes(s, days=9999) for s in syms + ["VNINDEX"]}
data = {k: v for k, v in data.items() if v}
sectors = st.get_all_symbols_with_sectors()

# ── Phase 1: PRECOMPUTE (build_context) ─────────────────────────────────────
print(f"[2/3] PROFILING build_context for {START}..{END} ...", flush=True)
t0 = time.time()
pr1 = cProfile.Profile()
pr1.enable()
ctx = obt.build_context(data, sectors, 260, 5, START, END, progress=False)
pr1.disable()
build_secs = time.time() - t0

# ── Phase 2: ONE BACKTEST (run_backtest) ────────────────────────────────────
print(f"[3/3] PROFILING one run_backtest for {START}..{END} ...", flush=True)
t1 = time.time()
pr2 = cProfile.Profile()
pr2.enable()
obt.run_backtest({}, dict(DEFAULT_PARAMS), 1e9, START, END, ctx=ctx)
pr2.disable()
bt_secs = time.time() - t1

print("\n" + "#" * 64)
print(f">>> build_context (precompute) : {build_secs:7.1f} sec")
print(f">>> one run_backtest (trial)   : {bt_secs:7.1f} sec")
print("#" * 64, flush=True)

show(pr1, "PRECOMPUTE  (build_context)")
show(pr2, "BACKTEST    (run_backtest)")
