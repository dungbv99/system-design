"""
Vietnamese stock data client — direct Vietcap API, no third-party wrapper.

Data sources
  Symbols   : Vietcap /price/symbols/getAll  (CafeF fallback)
  OHLCV     : Vietcap /chart/OHLCChart/gap-chart  (public, no login required)
  Fundamental: Vietcap IQ /statistics-financial
  News      : not implemented
"""

import json
import logging
import urllib.request
import urllib.error
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

log = logging.getLogger(__name__)

# ── API base URLs ─────────────────────────────────────────────────────────────

TRADING_BASE = "https://trading.vietcap.com.vn/api/"
IQ_BASE      = "https://iq.vietcap.com.vn/api/iq-insight-service"
CAFEF_URL    = "https://cafefnew.mediacdn.vn/Search/company.json"

CAFEF_CENTER = {1: "HOSE", 2: "HNX", 9: "UPCOM", 8: "OTC"}

# Browser-like headers — same origin as the trading dashboard
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept":          "application/json, text/plain, */*",
    "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    "Content-Type":    "application/json",
    "Origin":          "https://trading.vietcap.com.vn",
    "Referer":         "https://trading.vietcap.com.vn/priceboard",
}


# ── Low-level HTTP helpers ────────────────────────────────────────────────────

def _get(url: str, timeout: int = 15) -> object:
    req = urllib.request.Request(url, headers=_HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def _post(url: str, body: dict, timeout: int = 30) -> object:
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=_HEADERS, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


# ── Misc helpers ──────────────────────────────────────────────────────────────

def _to_unix(d: date) -> int:
    """End-of-day UTC unix timestamp for a date."""
    return int(datetime(d.year, d.month, d.day, 23, 59, 59, tzinfo=timezone.utc).timestamp())


def _bdays(start: date, end: date) -> int:
    """Business days between start and end (inclusive)."""
    n, cur = 0, start
    while cur <= end:
        if cur.weekday() < 5:
            n += 1
        cur += timedelta(days=1)
    return n


def _is_stock_symbol(sym: str) -> bool:
    """True for 3-char alphanumeric tickers that start with a letter."""
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
    date:   str       # "YYYY-MM-DD"
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
    quarter:    int   = 0   # 0 = annual
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
    """Direct Vietcap trading API — no vnstock wrapper, no rate-limit middleware."""

    # ── Symbols ───────────────────────────────────────────────────────────────

    def get_symbols(self) -> list[Symbol]:
        """Try Vietcap's own symbol list, fall back to CafeF."""
        try:
            resp = _get(f"{TRADING_BASE}price/symbols/getAll")
            items = resp if isinstance(resp, list) else resp.get("data", [])
            results = [
                Symbol(
                    symbol=sym,
                    name=item.get("organName") or item.get("name", ""),
                    exchange=item.get("exchange", ""),
                )
                for item in items
                if _is_stock_symbol(
                    sym := str(item.get("symbol", "")).strip().upper()
                )
            ]
            if results:
                log.info("got %d symbols from Vietcap", len(results))
                return results
        except Exception as e:
            log.warning("Vietcap getAll failed (%s) — falling back to CafeF", e)

        # CafeF fallback
        req = urllib.request.Request(
            CAFEF_URL,
            headers={"User-Agent": "stock-crawler/1.0", "Referer": "https://cafef.vn/"},
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
        results = []
        for item in data:
            sym = str(item.get("Symbol", "")).strip().upper()
            if not _is_stock_symbol(sym):
                continue
            results.append(Symbol(
                symbol=sym,
                name=item.get("Title", ""),
                exchange=CAFEF_CENTER.get(item.get("CenterId", 0), ""),
            ))
        log.info("got %d symbols from CafeF (fallback)", len(results))
        return results

    # ── Historical OHLCV ──────────────────────────────────────────────────────

    def get_historical_quotes(self, symbol: str, start: date, end: date) -> list[DailyQuote]:
        """Fetch daily OHLCV directly from Vietcap chart API.

        Uses countBack = business days in range + 20-day buffer so we always
        get the full requested window even when the market was closed.
        """
        count_back = _bdays(start, end) + 20

        payload = {
            "timeFrame": "ONE_DAY",
            "symbols":   [symbol.upper()],
            "to":        _to_unix(end),
            "countBack": count_back,
        }
        try:
            resp = _post(f"{TRADING_BASE}chart/OHLCChart/gap-chart", payload)
        except Exception as e:
            log.debug("quote %s %s→%s: %s", symbol, start, end, e)
            return []

        chart = _extract_chart(resp, symbol.upper())
        if not chart:
            return []

        t_arr = chart.get("t", [])
        o_arr = chart.get("o", [])
        h_arr = chart.get("h", [])
        l_arr = chart.get("l", [])
        c_arr = chart.get("c", [])
        v_arr = chart.get("v", [])

        quotes = []
        for i, ts in enumerate(t_arr):
            try:
                d = datetime.fromtimestamp(int(ts), tz=timezone.utc).date()
                if d < start or d > end:
                    continue
                quotes.append(DailyQuote(
                    date=d.isoformat(),
                    open=float(o_arr[i]  if i < len(o_arr) else 0) or 0,
                    high=float(h_arr[i]  if i < len(h_arr) else 0) or 0,
                    low=float(l_arr[i]   if i < len(l_arr) else 0) or 0,
                    close=float(c_arr[i] if i < len(c_arr) else 0) or 0,
                    volume=int(v_arr[i]  if i < len(v_arr) else 0) or 0,
                ))
            except Exception:
                pass
        return quotes

    # ── Fundamentals ──────────────────────────────────────────────────────────

    def get_fundamentals(self, symbol: str) -> list[Fundamental]:
        """Fetch financial ratios from Vietcap IQ API."""
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


# ── Response parsing helper ───────────────────────────────────────────────────

def _extract_chart(resp: object, symbol: str) -> dict:
    """Extract the {t,o,h,l,c,v} dict from the various response shapes the
    Vietcap API may return."""
    if isinstance(resp, list):
        return resp[0] if resp else {}
    if isinstance(resp, dict):
        # Shape 1: {"VCB": {"t": [...], ...}}
        if symbol in resp:
            return resp[symbol]
        # Shape 2: {"data": {"VCB": {...}}} or {"data": [{...}]}
        inner = resp.get("data")
        if isinstance(inner, dict):
            return inner.get(symbol, inner)
        if isinstance(inner, list):
            return inner[0] if inner else {}
        # Shape 3: the dict itself already has t/o/h/l/c/v
        if "t" in resp:
            return resp
    return {}


# ── Backward-compatible alias ─────────────────────────────────────────────────

FireantClient = VietcapClient
