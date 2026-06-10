"""
Vietnamese stock data client.

Data sources
  Symbols     : KB Securities /iis-server/investment/stock/search/data
  OHLCV       : KB Securities /iis-server/investment/stocks/{sym}/data_day
  Fundamentals: Vietcap IQ /statistics-financial
  News        : not implemented

All market data (symbols + OHLCV) comes from the KB Securities Vietnam
public API (kbbuddywts.kbsec.com.vn) which covers all VN boards:
HOSE, HNX, UPCOM.  Vietcap IQ is used only for quarterly fundamentals.
"""

import logging
from dataclasses import dataclass
from datetime import date, datetime

from curl_cffi import requests as cffi_requests  # Chrome TLS fingerprint

log = logging.getLogger(__name__)

# ── API base URLs ─────────────────────────────────────────────────────────────

KBS_BASE     = "https://kbbuddywts.kbsec.com.vn/iis-server/investment/stocks"
KBS_MKT_BASE = "https://kbbuddywts.kbsec.com.vn/iis-server/investment"
IQ_BASE      = "https://iq.vietcap.com.vn/api/iq-insight-service"

_HEADERS = {
    "Accept":          "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9,vi-VN;q=0.8,vi;q=0.7",
    "Cache-Control":   "no-cache",
}

_session = cffi_requests.Session(impersonate="chrome136")


# ── Low-level HTTP helpers ────────────────────────────────────────────────────

def _get(url: str, timeout: int = 15) -> object:
    r = _session.get(url, headers=_HEADERS, timeout=timeout)
    r.raise_for_status()
    return r.json()


def _post(url: str, body: dict, timeout: int = 30) -> object:
    r = _session.post(url, json=body, headers={
        **_HEADERS,

        "Origin":  "https://trading.vietcap.com.vn/",
        "Referer": "https://trading.vietcap.com.vn/",
    }, timeout=timeout)
    r.raise_for_status()
    return r.json()


# ── Misc helpers ──────────────────────────────────────────────────────────────

def _is_stock_symbol(sym: str) -> bool:
    return len(sym) == 3 and sym.isalnum() and sym[0].isalpha()


# ── Response dataclasses ──────────────────────────────────────────────────────

@dataclass
class Symbol:
    symbol:   str
    name:     str
    exchange: str = ""
    industry: str = ""


@dataclass
class DailyQuote:
    date:   str
    open:   float = 0.0
    high:   float = 0.0
    low:    float = 0.0
    close:  float = 0.0
    volume: int   = 0
    value:  float = 0.0
    buy_foreign_vol:  int   = 0
    sell_foreign_vol: int   = 0
    buy_foreign_val:  float = 0.0
    sell_foreign_val: float = 0.0


@dataclass
class Fundamental:
    year:       int   = 0
    quarter:    int   = 0
    revenue:    float = 0.0
    net_profit: float = 0.0
    eps:        float = 0.0
    pe:         float = 0.0
    pb:         float = 0.0
    roe:        float = 0.0
    roa:        float = 0.0


@dataclass
class NewsPost:
    post_id:      int   = 0
    symbol:       str   = ""
    title:        str   = ""
    content:      str   = ""
    source:       str   = ""
    url:          str   = ""
    published_at: str   = ""


# ── Client ────────────────────────────────────────────────────────────────────

class VietcapClient:

    # ── Symbols ───────────────────────────────────────────────────────────────

    VN_EXCHANGES = {"HOSE", "HNX", "UPCOM"}

    def get_symbols(self) -> list[Symbol]:
        """Fetch all stock symbols from the KB Securities market data API.

        Covers all VN boards: HOSE (includes VN30/VN100/VNMid/VNSml),
        HNX, and UPCOM.  Only instruments with type='stock' are returned —
        covered warrants, bonds, and futures are excluded.
        """
        resp = _get(f"{KBS_MKT_BASE}/stock/search/data")
        items = resp if isinstance(resp, list) else resp.get("data", [])
        results = []
        for item in items:
            sym = str(item.get("symbol", "")).strip().upper()
            if not _is_stock_symbol(sym):
                continue
            if item.get("type") != "stock":
                continue
            exch = item.get("exchange", "")
            if exch not in self.VN_EXCHANGES:
                continue
            results.append(Symbol(
                symbol=sym,
                name=item.get("name") or item.get("nameEn", ""),
                exchange=exch,
            ))
        log.info("got %d symbols from KBS (%s)", len(results),
                 ", ".join(f"{e}:{sum(1 for r in results if r.exchange==e)}"
                           for e in sorted(self.VN_EXCHANGES)))
        return results

    # ── Index / sector compositions — SSI iboard ─────────────────────────────

    _VN_BOARD_GROUPS = {
        "vn30", "vn100", "vnmid", "vnsml", "vnsi", "vnx50",
        "vndiamond", "vnfinlead", "vnfinselect",
    }
    _SECTOR_GROUPS = {
        "vncond", "vncons", "vnene", "vnfin", "vnheal",
        "vnind", "vnit", "vnmat", "vnreal", "vnuti",
    }

    def get_index_compositions(self) -> dict[str, list[str]]:
        """Fetch live index/sector compositions from SSI iboard indexGroups."""
        resp  = _get("https://iboard-query.ssi.com.vn/stock?group=VN30&type=group")
        items = resp.get("data", []) if isinstance(resp, dict) else resp

        all_groups = self._VN_BOARD_GROUPS | self._SECTOR_GROUPS
        buckets: dict[str, set] = {g: set() for g in all_groups}

        for item in items:
            if not isinstance(item, dict):
                continue
            sym   = item.get("stockSymbol", "")
            exch  = item.get("exchange", "")
            stype = item.get("stockType", "")
            if not sym or exch not in ("hose", "hnx", "upcom") or stype != "s":
                continue
            sym = sym.upper()
            for g in item.get("indexGroups", []):
                key = g.lower()
                if key in buckets:
                    buckets[key].add(sym)

        log.info(
            "index compositions fetched: %s",
            ", ".join(f"{k}={len(v)}" for k, v in buckets.items() if v),
        )
        return {k: sorted(v) for k, v in buckets.items()}

    # ── Historical OHLCV — KB Securities ─────────────────────────────────────

    def get_historical_quotes(self, symbol: str, start: date, end: date) -> list[DailyQuote]:
        """Fetch daily OHLCV from KB Securities public API."""
        url = (
            f"{KBS_BASE}/{symbol.upper()}/data_day"
            f"?sdate={start.strftime('%d-%m-%Y')}"
            f"&edate={end.strftime('%d-%m-%Y')}"
        )
        resp = _get(url)
        rows = resp.get("data_day", [])
        quotes = []
        for row in rows:
            try:
                d = datetime.strptime(row["t"][:10], "%Y-%m-%d").date()
                if d < start or d > end:
                    continue
                quotes.append(DailyQuote(
                    date=d.isoformat(),
                    open=float(row.get("o", 0)),
                    high=float(row.get("h", 0)),
                    low=float(row.get("l",  0)),
                    close=float(row.get("c", 0)),
                    volume=int(row.get("v", 0)),
                    value=float(row.get("va", 0)),
                ))
            except Exception:
                pass
        return quotes

    # ── Fundamentals ──────────────────────────────────────────────────────────

    def get_fundamentals(self, symbol: str) -> list[Fundamental]:
        try:
            resp = _get(f"{IQ_BASE}/v1/company/{symbol.upper()}/statistics-financial")
            items = resp if isinstance(resp, list) else resp.get("data", [])
            if not items:
                return []
            results = []
            for item in items:
                year = item.get("year") or item.get("reportYear")
                if not year:
                    continue
                try:
                    year = int(year)
                except (TypeError, ValueError):
                    continue
                results.append(Fundamental(
                    year=year,
                    quarter=int(item.get("quarter", 0) or 0),
                    revenue=float(item.get("revenue")    or item.get("netRevenue", 0) or 0),
                    net_profit=float(item.get("netProfit") or item.get("profit", 0)    or 0),
                    eps=float(item.get("eps",  0) or 0),
                    pe=float(item.get("pe",   0) or 0),
                    pb=float(item.get("pb",   0) or 0),
                    roe=float(item.get("roe", 0) or 0),
                    roa=float(item.get("roa", 0) or 0),
                ))
            return results
        except Exception as e:
            log.debug("fundamentals %s: %s", symbol, e)
            return []

    # ── News ─────────────────────────────────────────────────────────────────

    def get_news(self, symbol: str = "", limit: int = 20) -> list[NewsPost]:
        return []


# ── Backward-compatible alias ─────────────────────────────────────────────────

FireantClient = VietcapClient
