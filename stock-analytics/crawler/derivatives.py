"""
Derivatives analytics: Basis and Calendar Spread for VN30 futures.

  Basis  = F1M close - VN30 Index close      (premium/discount of the future)
  Spread = F1M close - F2M close             (front vs next-month calendar)

Pure computation — no I/O. Takes lists of OHLCV dicts (oldest→newest, the same
shape as wyckoff.py's `bars`) and returns a list of basis dicts oldest→newest.
"""

from __future__ import annotations


def _index_by_date(bars: list[dict]) -> dict[str, float]:
    """Map ISO date string → close, tolerant of date objects in the `date` field."""
    out: dict[str, float] = {}
    for b in bars or []:
        d = b.get("date")
        c = b.get("close")
        if d is None or c is None:
            continue
        out[str(d)[:10]] = float(c)
    return out


def _classify(basis_pct: float,
              premium_threshold_pct: float,
              discount_threshold_pct: float) -> str:
    if basis_pct > premium_threshold_pct:
        return "PREMIUM"
    if basis_pct < discount_threshold_pct:
        return "DISCOUNT"
    return "NEUTRAL"


def compute_basis(
    f1m: list[dict],
    f2m: list[dict],
    vn30: list[dict],
    premium_threshold_pct: float = 0.3,
    discount_threshold_pct: float = -0.3,
) -> list[dict]:
    """Align f1m, f2m and vn30 by date (inner join) and compute basis/spread.

    Returns list of dicts oldest→newest:
      {date, f1m_close, f2m_close, vn30_close, basis, basis_pct,
       spread_f1m_f2m, regime}

    regime (from basis_pct):
      > premium_threshold_pct   → 'PREMIUM'
      < discount_threshold_pct  → 'DISCOUNT'
      otherwise                 → 'NEUTRAL'
    """
    f1m_by = _index_by_date(f1m)
    f2m_by = _index_by_date(f2m)
    vn30_by = _index_by_date(vn30)

    # Only dates present in all three series.
    common = sorted(set(f1m_by) & set(f2m_by) & set(vn30_by))

    rows: list[dict] = []
    for d in common:
        f1m_c = f1m_by[d]
        f2m_c = f2m_by[d]
        vn30_c = vn30_by[d]
        if vn30_c == 0:
            continue
        basis = f1m_c - vn30_c
        basis_pct = basis / vn30_c * 100
        rows.append({
            "date":           d,
            "f1m_close":      round(f1m_c, 2),
            "f2m_close":      round(f2m_c, 2),
            "vn30_close":     round(vn30_c, 2),
            "basis":          round(basis, 2),
            "basis_pct":      round(basis_pct, 4),
            "spread_f1m_f2m": round(f1m_c - f2m_c, 2),
            "regime":         _classify(basis_pct, premium_threshold_pct,
                                        discount_threshold_pct),
        })
    return rows
