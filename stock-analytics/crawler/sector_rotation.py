"""
Sector rotation + ecosystem grouping.

Two related ideas:
  • Sector rotation — only trade stocks in the sectors with the strongest 20-day
    relative strength vs the index (lead the market, don't lag it).
  • Ecosystem groups — stocks under one controlling shareholder (Vingroup,
    Gelex …) move together; treat them as a single high-conviction "meta-stock"
    but cap concentration so one group can't fill the whole book.

Sector comes from ``symbols.industry`` (already crawled) — no new schema.
Pure Python stdlib.  See README_WYCKOFF_OPTIMIZED.md §5 and §6.
"""

from __future__ import annotations

import statistics

from wyckoff import _f

# Canonical VN100 basket (VN30 + VN Midcap) — the trading universe.  Mirrors the
# list in main.py; kept here so the optimized pipeline has one importable source
# and store.get_vn100_symbols() can fall back to it before the DB is marked.
VN100 = [
    "ACB", "BID", "BSR", "CTG", "FPT", "GAS", "GVR", "HDB", "HPG", "LPB",
    "MBB", "MSN", "MWG", "PLX", "SAB", "SHB", "SSB", "SSI", "STB", "TCB",
    "TPB", "VCB", "VHM", "VIB", "VIC", "VJC", "VNM", "VPB", "VPL", "VRE",
    "ANV", "BAF", "BCM", "BMP", "BSI", "BVH", "BWE", "CII", "CMG", "CTD",
    "CTR", "CTS", "DBC", "DCM", "DGW", "DIG", "DPM", "DSE", "DXG", "DXS",
    "EIB", "EVF", "FRT", "FTS", "GEE", "GEX", "GMD", "HAG", "HCM", "HDC",
    "HDG", "HHV", "HSG", "HT1", "IMP", "KBC", "KDC", "KDH", "KOS", "MSB",
    "NAB", "NKG", "NLG", "NT2", "NVL", "OCB", "PAN", "PC1", "PDR", "PHR",
    "PNJ", "POW", "PVD", "PVT", "REE", "SBT", "SCS", "SIP", "SJS", "SZC",
    "TCH", "VCG", "VCI", "VGC", "VHC", "VIX", "VND", "VPI", "VSC", "VTP",
]

# Stocks under a shared controlling shareholder — correlated signals.
ECOSYSTEM_GROUPS: dict[str, list[str]] = {
    "VINGROUP": ["VIC", "VHM", "VRE", "VPL"],
    "GELEX":    ["VIX", "VGC", "GEX", "GEE", "EIB"],
}


def get_ecosystem(symbol: str) -> str | None:
    """Return the ecosystem name a symbol belongs to, else None."""
    for name, members in ECOSYSTEM_GROUPS.items():
        if symbol in members:
            return name
    return None


# ── Relative-strength sector ranking ──────────────────────────────────────────

def _return_20d(bars: list[dict], date_idx: int, lookback: int = 20) -> float | None:
    """20-day return of one symbol ending at ``date_idx`` (inclusive)."""
    if date_idx < lookback or date_idx >= len(bars):
        return None
    c0 = _f(bars[date_idx - lookback].get("close"))
    c1 = _f(bars[date_idx].get("close"))
    if c0 <= 0:
        return None
    return c1 / c0 - 1.0


def rank_sectors(all_bars: dict[str, list[dict]], date_idx: int,
                 symbol_sectors: dict[str, str], params: dict | None = None,
                 index_bars: list[dict] | None = None,
                 lookback: int = 20) -> list[dict]:
    """Rank sectors by average 20-day relative strength vs the index.

    ``all_bars``        — {symbol: bars} aligned so index ``date_idx`` is valid.
    ``symbol_sectors``  — {symbol: industry}.
    Returns ``[{sector, rs_score, symbols, avg_return_20d}, …]`` sorted by
    ``rs_score`` descending.
    """
    index_ret = _return_20d(index_bars, len(index_bars) - 1, lookback) if index_bars else None

    by_sector: dict[str, list[float]] = {}
    members: dict[str, list[str]] = {}
    for sym, bars in all_bars.items():
        sector = symbol_sectors.get(sym) or "Unknown"
        # align the symbol's own last index ≤ date_idx by date isn't tracked here;
        # all_bars are passed pre-sliced to the date, so use the final bar.
        r = _return_20d(bars, len(bars) - 1, lookback)
        if r is None:
            continue
        by_sector.setdefault(sector, []).append(r)
        members.setdefault(sector, []).append(sym)

    out: list[dict] = []
    for sector, rets in by_sector.items():
        avg = statistics.mean(rets)
        if index_ret is not None and abs(1.0 + index_ret) > 1e-9:
            rs = (1.0 + avg) / (1.0 + index_ret)
        else:
            rs = 1.0 + avg
        out.append({
            "sector": sector,
            "rs_score": round(rs, 4),
            "avg_return_20d": round(avg * 100, 2),
            "symbols": members[sector],
        })
    out.sort(key=lambda s: s["rs_score"], reverse=True)
    return out


def is_sector_leading(symbol: str, sector_ranking: list[dict],
                      symbol_sectors: dict[str, str], top_n: int = 3) -> bool:
    """True if the symbol's sector is in the top-N by relative strength."""
    sector = symbol_sectors.get(symbol)
    if not sector:
        return False
    top = {s["sector"] for s in sector_ranking[:top_n]}
    return sector in top


# ── Ecosystem signal aggregation ──────────────────────────────────────────────

def get_ecosystem_signal(ecosystem_name: str, all_bars: dict[str, list[dict]],
                         date_idx: int, params: dict | None = None) -> str | None:
    """Return 'BUY_ECOSYSTEM' when ≥2 members show a Wyckoff BUY / Accum C+.

    Lazy-imports wyckoff_opt to avoid a heavy import when ecosystems are unused
    (set ECOSYSTEM_GROUPS = {} to disable entirely — §17).
    """
    members = ECOSYSTEM_GROUPS.get(ecosystem_name, [])
    if len(members) < 2:
        return None
    from wyckoff_opt import run_live_signal

    hits = 0
    for sym in members:
        bars = all_bars.get(sym)
        if not bars:
            continue
        try:
            sig = run_live_signal(sym, bars, params=params)
        except Exception:  # noqa: BLE001
            continue
        if sig.signal == "BUY" or (sig.phase == "Accumulation" and sig.sub_phase in ("C", "D")):
            hits += 1
    return "BUY_ECOSYSTEM" if hits >= 2 else None


def is_ecosystem_concentrated(open_symbols: list[str], ecosystem_name: str,
                              max_slots: int = 2) -> bool:
    """True if the open book already holds ≥ max_slots of this ecosystem."""
    held = sum(1 for s in open_symbols if get_ecosystem(s) == ecosystem_name)
    return held >= max_slots
