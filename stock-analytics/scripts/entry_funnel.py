#!/usr/bin/env python3
"""Entry-funnel diagnostic: WHY does the strategy barely trade?

Replays the entry filters over the precomputed snapshots (portfolio state
ignored — counts the *supply* of candidates) and reports how many symbol-days
survive each stage:

    all snapshots
      → on a tradeable day (regime != DOWNTREND)
        → base signal == BUY
          → score >= min_signal_score
            → sector is in the leading set

Plus a score histogram and a min_signal_score sensitivity table, so we can see
exactly which filter collapses the funnel.

Run inside the crawler container (scripts/ is mounted — no rebuild needed):
    docker exec stock-analytics-crawler-1 python3 /app/scripts/entry_funnel.py
    docker exec stock-analytics-crawler-1 python3 /app/scripts/entry_funnel.py 2023-01-01 2024-12-31
"""
import sys
import os
from collections import Counter

sys.path.insert(0, "/app")

from store import Store                                   # noqa: E402
import opt_backtest as obt                                # noqa: E402
import regime as regime_mod                               # noqa: E402
from wyckoff_opt import compute_signal_score, merge_params  # noqa: E402

START = sys.argv[1] if len(sys.argv) > 1 else "2023-01-01"
END = sys.argv[2] if len(sys.argv) > 2 else "2024-12-31"

st = Store(os.environ["DB_DSN"])
syms = st.get_vn100_symbols()
print(f"loading {len(syms)} symbols + VNINDEX ...", flush=True)
data = {s: st.get_symbol_quotes(s, days=9999) for s in syms + ["VNINDEX"]}
data = {k: v for k, v in data.items() if v}
sectors = st.get_all_symbols_with_sectors()

print(f"building context {START}..{END} (may take a few min) ...", flush=True)
ctx = obt.build_context(data, sectors, 260, 5, START, END, progress=False)

p = merge_params(None)                       # DEFAULT_PARAMS overlaid with FIXED_PARAMS
MIN = p["min_signal_score"]

regime_series = regime_mod.get_regime_series(ctx.vnindex_bars, p)
regime_map = {r["date"]: r["regime"] for r in regime_series}

scan_days = [d for d in ctx.calendar[::ctx.step] if START <= d <= END and d in ctx.snapshots]

reg_days = Counter()
tradeable_days = 0
tot_snaps = 0          # symbol-snapshots on tradeable days
n_buy = 0              # base signal == BUY
score_hist = Counter()
pass_score = 0         # BUY and score >= MIN
pass_sector = 0        # ...and sector in leading set
thr = {2: 0, 3: 0, 4: 0, 5: 0}

for day in scan_days:
    regime = regime_map.get(day, regime_mod.SIDEWAYS)
    reg_days[regime] += 1
    if regime == regime_mod.DOWNTREND:
        continue                              # backtest blocks ALL entries here
    tradeable_days += 1
    snaps = ctx.snapshots[day]
    top_n = p["top_n_sectors"] if regime != regime_mod.SIDEWAYS else max(1, p["top_n_sectors"] - 1)
    ranking = obt._rank_sectors_from_snaps(ctx, day)
    leading = {r["sector"] for r in ranking[:top_n]} if ranking else None
    for snap in snaps:
        tot_snaps += 1
        base = snap["base"]
        if base.signal != "BUY":
            continue
        n_buy += 1
        try:
            score = compute_signal_score(base, snap["ind"], p)
        except Exception:
            continue
        score_hist[score] += 1
        for t in thr:
            if score >= t:
                thr[t] += 1
        if score >= MIN:
            pass_score += 1
            sector = ctx.symbol_sectors.get(snap["symbol"], "")
            if leading is None or sector in leading:
                pass_sector += 1


def pct(a, b):
    return f"{100*a/b:.1f}%" if b else "n/a"


print("\n" + "=" * 64)
print(f"ENTRY FUNNEL  {START}..{END}   (min_signal_score = {MIN})")
print("=" * 64)
print(f"scan days (every {ctx.step} bars): {len(scan_days)}")
print(f"  regime breakdown: " + "  ".join(f"{r}={n}" for r, n in reg_days.items()))
print(f"  tradeable days (non-DOWNTREND): {tradeable_days}"
      f"   [DOWNTREND blocks {reg_days.get(regime_mod.DOWNTREND, 0)} days entirely]")
print("-" * 64)
print(f"symbol-snapshots on tradeable days : {tot_snaps}")
print(f"  → base signal == BUY             : {n_buy:>8}  ({pct(n_buy, tot_snaps)} of snaps)")
print(f"    → score >= {MIN} (min_signal)      : {pass_score:>8}  ({pct(pass_score, n_buy)} of BUYs)")
print(f"      → sector in leading set      : {pass_sector:>8}  ({pct(pass_sector, pass_score)} of those)")
print("-" * 64)
print("score histogram of BUY signals (0..8):")
for s in range(0, 9):
    bar = "#" * min(60, score_hist.get(s, 0) // max(1, n_buy // 60 or 1))
    print(f"  score {s}: {score_hist.get(s, 0):>7}  {bar}")
print("-" * 64)
print("min_signal_score sensitivity (BUY signals passing each threshold):")
for t in sorted(thr):
    print(f"  score >= {t}: {thr[t]:>8}  ({pct(thr[t], n_buy)} of BUYs)")
print("=" * 64)
print(f"FINAL entry supply (BUY & score>={MIN} & sector-leading): {pass_sector}"
      f"  over {tradeable_days} tradeable days  =  {pass_sector / tradeable_days:.2f}/day"
      if tradeable_days else "no tradeable days")
print("(portfolio slot cap + ecosystem cap + already-held further reduce actual entries)")
