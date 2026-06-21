"""Tests for derivatives.compute_basis."""

from derivatives import compute_basis


def _bar(date: str, close: float) -> dict:
    return {"date": date, "open": close, "high": close, "low": close,
            "close": close, "volume": 0}


def test_normal_case():
    f1m  = [_bar("2026-06-01", 1305), _bar("2026-06-02", 1290)]
    f2m  = [_bar("2026-06-01", 1310), _bar("2026-06-02", 1296)]
    vn30 = [_bar("2026-06-01", 1300), _bar("2026-06-02", 1295)]

    rows = compute_basis(f1m, f2m, vn30)
    assert len(rows) == 2

    r0 = rows[0]
    assert r0["date"] == "2026-06-01"
    assert r0["basis"] == 5.0                       # 1305 - 1300
    assert r0["spread_f1m_f2m"] == -5.0             # 1305 - 1310
    assert round(r0["basis_pct"], 4) == round(5 / 1300 * 100, 4)
    assert r0["regime"] == "PREMIUM"                # 0.385% > 0.3%

    # 2026-06-02: basis = -5 → -0.386% < -0.3% → DISCOUNT
    assert rows[1]["basis"] == -5.0
    assert rows[1]["regime"] == "DISCOUNT"


def test_missing_date_excluded():
    f1m  = [_bar("2026-06-01", 1305), _bar("2026-06-02", 1290)]
    f2m  = [_bar("2026-06-01", 1310)]               # 06-02 missing
    vn30 = [_bar("2026-06-01", 1300), _bar("2026-06-02", 1295)]

    rows = compute_basis(f1m, f2m, vn30)
    assert [r["date"] for r in rows] == ["2026-06-01"]


def test_threshold_boundary_is_neutral():
    # basis exactly at +0.3% → NOT strictly greater → NEUTRAL
    vn30_close = 1000.0
    f1m_close  = 1003.0                              # +0.3% exactly
    rows = compute_basis(
        [_bar("2026-06-01", f1m_close)],
        [_bar("2026-06-01", f1m_close)],
        [_bar("2026-06-01", vn30_close)],
    )
    assert rows[0]["basis_pct"] == 0.3
    assert rows[0]["regime"] == "NEUTRAL"


def test_sorted_oldest_to_newest():
    f1m  = [_bar("2026-06-03", 10), _bar("2026-06-01", 10), _bar("2026-06-02", 10)]
    f2m  = list(f1m)
    vn30 = list(f1m)
    rows = compute_basis(f1m, f2m, vn30)
    assert [r["date"] for r in rows] == ["2026-06-01", "2026-06-02", "2026-06-03"]
