#!/usr/bin/env python3
"""Profile ONE Wyckoff backtest to find the per-trial bottleneck.

Why: in the optimizer each Optuna trial = one full backtest, and we observed
~20 min/trial. This times a SINGLE backtest in a SINGLE process (no fork) and
prints a cProfile breakdown, so we can tell whether the cost is the backtest
itself (algorithmic) or the multi-process fork overhead.

Run inside the crawler container (no rebuild needed — scripts/ is mounted):

    docker exec stock-analytics-crawler-1 python3 /app/scripts/profile_backtest.py

Optional: pass a window, e.g. a shorter one to set up faster:
    docker exec stock-analytics-crawler-1 python3 /app/scripts/profile_backtest.py 2014-01-01 2014-06-30
"""
import sys
import os
import time
import cProfile
import pstats

# scripts/ is mounted at /app/scripts, but the engine modules live in /app —
# make sure they import.
sys.path.insert(0, "/app")

from store import Store               # noqa: E402
import opt_backtest as obt            # noqa: E402
from wyckoff_opt import DEFAULT_PARAMS  # noqa: E402

START = sys.argv[1] if len(sys.argv) > 1 else "2014-01-01"
END = sys.argv[2] if len(sys.argv) > 2 else "2014-12-31"

st = Store(os.environ["DB_DSN"])
syms = st.get_vn100_symbols()
print(f"[1/3] loading {len(syms)} symbols + VNINDEX from DB...", flush=True)
data = {s: st.get_symbol_quotes(s, days=9999) for s in syms + ["VNINDEX"]}
data = {k: v for k, v in data.items() if v}

print(f"[2/3] building context for {START}..{END} (precompute — may take a few min)...", flush=True)
t0 = time.time()
ctx = obt.build_context(data, st.get_all_symbols_with_sectors(), 260, 5,
                        START, END, progress=False)
print(f"      build_context took {time.time() - t0:.1f} sec", flush=True)

print(f"[3/3] timing ONE backtest ({START}..{END}, single process, no fork)...", flush=True)
t1 = time.time()
pr = cProfile.Profile()
pr.enable()
obt.run_backtest({}, dict(DEFAULT_PARAMS), 1e9, START, END, ctx=ctx)
pr.disable()
elapsed = time.time() - t1

print("\n" + "=" * 60, flush=True)
print(f">>> ONE backtest took {elapsed:.1f} sec", flush=True)
print("=" * 60, flush=True)
print("\n=== top 15 functions by tottime (self time) ===", flush=True)
pstats.Stats(pr).sort_stats("tottime").print_stats(15)
print("\n=== top 15 functions by cumulative time ===", flush=True)
pstats.Stats(pr).sort_stats("cumulative").print_stats(15)
