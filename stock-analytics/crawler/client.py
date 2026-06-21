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
from datetime import date, datetime, timezone

from curl_cffi import requests as cffi_requests  # Chrome TLS fingerprint

log = logging.getLogger(__name__)

# ── API base URLs ─────────────────────────────────────────────────────────────

KBS_BASE     = "https://kbbuddywts.kbsec.com.vn/iis-server/investment/stocks"
KBS_MKT_BASE = "https://kbbuddywts.kbsec.com.vn/iis-server/investment"
IQ_BASE      = "https://iq.vietcap.com.vn/api/iq-insight-service"
FMARKET_BASE = "https://api.fmarket.vn/res"   # mutual-fund marketplace (public API)

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


# ── fmarket.vn helpers (mutual-fund marketplace) ──────────────────────────────

_FMARKET_HEADERS = {
    **_HEADERS,
    "Content-Type": "application/json",
    "Origin":       "https://fmarket.vn",
    "Referer":      "https://fmarket.vn/",
}


def _fmarket_get(url: str, timeout: int = 15) -> object:
    r = _session.get(url, headers=_FMARKET_HEADERS, timeout=timeout)
    r.raise_for_status()
    return r.json()


def _fmarket_post(url: str, body: dict, timeout: int = 20) -> object:
    r = _session.post(url, json=body, headers=_FMARKET_HEADERS, timeout=timeout)
    r.raise_for_status()
    return r.json()


def _ms_to_iso(ms) -> str | None:
    """fmarket timestamps are epoch milliseconds → ISO date string."""
    try:
        return datetime.fromtimestamp(int(ms) / 1000).date().isoformat()
    except (TypeError, ValueError):
        return None


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


@dataclass
class FundInfo:
    fund_id:          int
    short_name:       str
    name:             str
    owner_name:       str   = ""
    fund_type:        str   = ""     # e.g. "Quỹ cổ phiếu"
    nav:              float = 0.0     # NAV per unit (VND)
    nav_update_at:    str | None = None
    return_1m:        float | None = None
    return_3m:        float | None = None
    return_6m:        float | None = None
    return_12m:       float | None = None
    return_36m:       float | None = None
    return_inception: float | None = None


@dataclass
class FundHolding:
    stock_code:        str
    industry:          str   = ""
    net_asset_percent: float = 0.0    # % of fund NAV held in this stock
    price:             float = 0.0    # last price reported by fmarket (K₫)
    update_at:         str | None = None


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

    # ── Mutual funds (equity funds) — fmarket.vn ─────────────────────────────

    def get_stock_funds(self) -> list[FundInfo]:
        """List all open-ended equity funds (Quỹ cổ phiếu) on fmarket.vn.

        Holdings are NOT included here — fetch them per fund via
        get_fund_holdings(fund_id).
        """
        body = {
            "types":          ["NEW_FUND", "TRADING_FUND"],
            "issuerIds":      [],
            "sortOrder":      "DESC",
            "sortField":      "navTo6Months",
            "page":           1,
            "pageSize":       100,
            "isIpo":          False,
            "fundAssetTypes": ["STOCK"],      # equity funds only
            "bondRemainPeriods": [],
            "searchField":    "",
            "isBuyByReward":  False,
            "thirdAppIds":    [],
        }
        resp = _fmarket_post(f"{FMARKET_BASE}/products/filter", body)
        rows = (resp.get("data") or {}).get("rows", []) if isinstance(resp, dict) else []

        funds: list[FundInfo] = []
        for r in rows:
            try:
                nc    = r.get("productNavChange") or {}
                owner = r.get("owner") or {}
                asset = r.get("dataFundAssetType") or {}
                funds.append(FundInfo(
                    fund_id=int(r["id"]),
                    short_name=(r.get("shortName") or "").strip(),
                    name=(r.get("name") or "").strip(),
                    owner_name=(owner.get("shortName") or owner.get("name") or "").strip(),
                    fund_type=(asset.get("name") or "").strip(),
                    nav=float(r.get("nav") or 0),
                    nav_update_at=_ms_to_iso(nc.get("updateAt")),
                    return_1m=nc.get("navTo1Months"),
                    return_3m=nc.get("navTo3Months"),
                    return_6m=nc.get("navTo6Months"),
                    return_12m=nc.get("navTo12Months"),
                    return_36m=nc.get("navTo36Months"),
                    return_inception=nc.get("navToEstablish"),
                ))
            except (KeyError, TypeError, ValueError):
                continue

        log.info("got %d equity funds from fmarket", len(funds))
        return funds

    def get_fund_holdings(self, fund_id: int) -> list[FundHolding]:
        """Top stock holdings for one fund (productTopHoldingList)."""
        resp = _fmarket_get(f"{FMARKET_BASE}/products/{fund_id}")
        data = (resp.get("data") or {}) if isinstance(resp, dict) else {}

        out: list[FundHolding] = []
        for h in (data.get("productTopHoldingList") or []):
            code = str(h.get("stockCode") or "").strip().upper()
            if not code or h.get("type") not in (None, "STOCK"):
                continue
            out.append(FundHolding(
                stock_code=code,
                industry=(h.get("industry") or "").strip(),
                net_asset_percent=float(h.get("netAssetPercent") or 0),
                price=float(h.get("price") or 0),
                update_at=_ms_to_iso(h.get("updateAt")),
            ))
        return out


# ── Derivatives (VN30F1M / VN30F2M / VN30 index) — KB Securities ───────────────
#
# Same provider and response shape as stocks. "F1M"/"F2M" are not literal KBS
# symbols — KBS uses dated contract codes (e.g. VN30F2606 = June 2026). We resolve
# the two nearest-expiry contracts from the live DER list on every call, so the
# F1M/F2M → real-contract mapping rolls forward automatically each month.

# KBS doesn't use the public 'VN30F2606' codes — GET /index/DER/stocks returns
# its own internal codes, e.g. '41I1G6000' (VN30 futures) and '41I2…/41B5…/41BA…'
# (other index / bond futures). For the '41I1' VN30 series the code encodes the
# contract month: code[4] = year letter (A=2020 … G=2026), code[5] = month in
# hex (6=Jun, 7=Jul, 9=Sep, C=Dec). The data_day rows also carry open interest
# in the 'oi' field, so OI works from the same endpoint.

VN30F_PREFIX = "41I1"          # KBS internal series code for VN30 index futures
_YEAR_BASE   = 2020            # year letter 'A' == 2020


def _fmt_kbs_date(d) -> str:
    """KBS expects DD-MM-YYYY. Accept a date or an ISO 'YYYY-MM-DD' string."""
    if isinstance(d, date):
        return d.strftime("%d-%m-%Y")
    return datetime.strptime(str(d)[:10], "%Y-%m-%d").strftime("%d-%m-%Y")


def _third_thursday(year: int, month: int) -> date:
    """VN30 futures expire on the 3rd Thursday of the contract month."""
    first = date(year, month, 1)
    offset = (3 - first.weekday()) % 7      # Monday=0 … Thursday=3
    return date(year, month, 1 + offset + 14)


def _decode_contract(code: str) -> tuple[int, int] | None:
    """Decode a KBS VN30-futures code (e.g. '41I1G6000') → (year, month).

    Returns None for non-VN30-future codes (bond futures, other indices, …).
    """
    code = code.strip().upper()
    if len(code) < 6 or not code.startswith(VN30F_PREFIX):
        return None
    year_ch, month_ch = code[4], code[5]
    if not ("A" <= year_ch <= "Z"):
        return None
    try:
        month = int(month_ch, 16)
    except ValueError:
        return None
    if not 1 <= month <= 12:
        return None
    return _YEAR_BASE + (ord(year_ch) - ord("A")), month


def _parse_kbs_quotes(rows: list, start: date, end: date) -> list[DailyQuote]:
    """Map KBS data_day rows ({t,o,h,l,c,v}) to DailyQuote, same scaling as stocks."""
    quotes: list[DailyQuote] = []
    for row in rows or []:
        try:
            d = datetime.strptime(row["t"][:10], "%Y-%m-%d").date()
            if d < start or d > end:
                continue
            quotes.append(DailyQuote(
                date=d.isoformat(),
                open=float(row.get("o", 0)),
                high=float(row.get("h", 0)),
                low=float(row.get("l", 0)),
                close=float(row.get("c", 0)),
                volume=int(row.get("v", 0)),
                value=float(row.get("tv", 0)),
            ))
        except Exception:
            pass
    return quotes


def fetch_derivative_symbols() -> list[str]:
    """Live derivative contract codes from KBS, e.g. ['41I1G6000', '41I1G7000', …]."""
    resp = _get(f"{KBS_MKT_BASE}/index/DER/stocks")
    items = resp.get("data", []) if isinstance(resp, dict) else (resp if isinstance(resp, list) else [])
    return [str(s).strip().upper() for s in items if str(s).strip()]


def resolve_front_months(symbols: list[str], today: date | None = None) -> tuple[str, str]:
    """Return (f1m_code, f2m_code): the two nearest VN30-futures contracts not yet expired.

    Decodes the contract month from each '41I1' code, keeps contracts whose
    3rd-Thursday expiry is >= today, and sorts ascending by expiry — so the
    F1M/F2M mapping rolls forward automatically across the monthly expiry.
    """
    today = today or date.today()
    dated: list[tuple[date, str]] = []
    for code in symbols:
        ym = _decode_contract(code)
        if not ym:
            continue
        expiry = _third_thursday(*ym)
        if expiry >= today:
            dated.append((expiry, code))
    dated.sort()
    if len(dated) < 2:
        raise RuntimeError(f"need >= 2 live VN30 futures, got {[c for _, c in dated]}")
    return dated[0][1], dated[1][1]


def _resolve_kbs_contract(symbol: str) -> str:
    """Map logical 'VN30F1M'/'VN30F2M' to the live KBS internal contract code."""
    f1m, f2m = resolve_front_months(fetch_derivative_symbols())
    return f1m if symbol.upper() == "VN30F1M" else f2m


# ── Entrade / DNSE — continuous VN30 series (multi-year daily + intraday) ──────
#
# Unlike KBS (live contracts only, ~8 months), Entrade exposes *continuous*
# symbols ('VN30F1M', 'VN30F2M' as derivatives; 'VN30' as an index) with ~6 years
# of daily history AND intraday bars (1/5/15/30 min, 1H). One response shape:
#   {"t":[unix…], "o":[…], "h":[…], "l":[…], "c":[…], "v":[…], "nextTime":…}
# Prices are already in index points (no scaling). OI is not provided here — we
# keep that from KBS (fetch_derivatives_oi) for the live front-month contract.

ENTRADE_OHLC = "https://services.entrade.com.vn/chart-api/v2/ohlcs"
_ENTRADE_HEADERS = {
    **_HEADERS,
    "Origin":  "https://banggia.dnse.com.vn",
    "Referer": "https://banggia.dnse.com.vn/",
}
_ENTRADE_PATH = {"VN30F1M": "derivative", "VN30F2M": "derivative",
                 "VN30": "index", "VNINDEX": "index"}
# Logical timeframe → Entrade resolution token.
ENTRADE_RESOLUTIONS = {"1": "1", "5": "5", "15": "15", "30": "30", "1H": "1H", "1D": "1D"}


def _entrade_bars(symbol: str, resolution: str, frm: int, to: int) -> list[dict]:
    """Fetch raw {t,o,h,l,c,v} bars from Entrade; returns oldest→newest dicts."""
    sym = symbol.strip().upper()
    path = _ENTRADE_PATH.get(sym)
    if not path:
        raise ValueError(f"unknown derivatives symbol: {symbol!r}")
    res = ENTRADE_RESOLUTIONS.get(resolution, resolution)
    url = f"{ENTRADE_OHLC}/{path}?from={frm}&to={to}&symbol={sym}&resolution={res}"
    r = _session.get(url, headers=_ENTRADE_HEADERS, timeout=25)
    r.raise_for_status()
    j = r.json()
    t = j.get("t") or []
    o, h, l, c, v = j.get("o", []), j.get("h", []), j.get("l", []), j.get("c", []), j.get("v", [])
    out: list[dict] = []
    for i in range(len(t)):
        out.append({
            "t": int(t[i]),
            "o": float(o[i]), "h": float(h[i]), "l": float(l[i]), "c": float(c[i]),
            "v": int(v[i]) if i < len(v) and v[i] is not None else 0,
        })
    return out


def fetch_derivatives_quotes(symbol: str, start_date, end_date) -> list[DailyQuote]:
    """Daily OHLCV history for 'VN30F1M', 'VN30F2M' or 'VN30' from Entrade/DNSE.

    Returns the same DailyQuote dataclass used for stocks (continuous series, so
    no contract roll handling needed). start_date/end_date may be `date` objects
    or ISO 'YYYY-MM-DD' strings.
    """
    start = start_date if isinstance(start_date, date) else date.fromisoformat(str(start_date)[:10])
    end   = end_date   if isinstance(end_date,   date) else date.fromisoformat(str(end_date)[:10])
    frm = int(datetime(start.year, start.month, start.day, tzinfo=timezone.utc).timestamp())
    to  = int(datetime(end.year, end.month, end.day, tzinfo=timezone.utc).timestamp()) + 86400

    quotes: list[DailyQuote] = []
    for bar in _entrade_bars(symbol, "1D", frm, to):
        d = datetime.fromtimestamp(bar["t"], tz=timezone.utc).date()
        if d < start or d > end:
            continue
        quotes.append(DailyQuote(
            date=d.isoformat(),
            open=bar["o"], high=bar["h"], low=bar["l"], close=bar["c"],
            volume=bar["v"],
        ))
    return quotes


# ── Market / sector index OHLCV — SSI iboard charts ───────────────────────────
# Full daily history from index inception (VNINDEX from 2000-07-28, base 100),
# unlike Entrade which only serves ~2020+. TradingView-UDF style payload.
_SSI_CHART = "https://iboard-api.ssi.com.vn/statistics/charts/history"


def fetch_index_history(symbol: str, start_date, end_date) -> list[DailyQuote]:
    """Daily OHLCV for a market/sector index (e.g. 'VNINDEX') from SSI iboard.

    Returns the same DailyQuote dataclass used for stocks. start_date/end_date
    may be `date` objects or ISO 'YYYY-MM-DD' strings. Prices are index points
    (no scaling). Volume is matched volume; value is left 0.
    """
    start = start_date if isinstance(start_date, date) else date.fromisoformat(str(start_date)[:10])
    end   = end_date   if isinstance(end_date,   date) else date.fromisoformat(str(end_date)[:10])
    frm = int(datetime(start.year, start.month, start.day, tzinfo=timezone.utc).timestamp())
    to  = int(datetime(end.year, end.month, end.day, tzinfo=timezone.utc).timestamp()) + 86400

    url = f"{_SSI_CHART}?resolution=1D&symbol={symbol.upper()}&from={frm}&to={to}"
    r = _session.get(url, headers=_HEADERS, timeout=30)
    r.raise_for_status()
    d = (r.json() or {}).get("data") or {}
    t = d.get("t") or []
    o, h, l, c, v = d.get("o", []), d.get("h", []), d.get("l", []), d.get("c", []), d.get("v", [])

    quotes: list[DailyQuote] = []
    for i in range(len(t)):
        dt_ = datetime.fromtimestamp(int(t[i]), tz=timezone.utc).date()
        if dt_ < start or dt_ > end:
            continue
        quotes.append(DailyQuote(
            date=dt_.isoformat(),
            open=float(o[i]), high=float(h[i]), low=float(l[i]), close=float(c[i]),
            volume=int(v[i]) if i < len(v) and v[i] is not None else 0,
        ))
    return quotes


def fetch_derivatives_intraday(symbol: str, resolution: str = "5", days: int = 10) -> list[dict]:
    """Live intraday candles for the Derivatives chart (not stored — a rolling
    window served on demand).

    resolution ∈ {'1','5','15','30','1H'} (1/5/15/30-min, 1-hour).
    Returns oldest→newest [{time, open, high, low, close, volume}] where `time`
    is a unix second shifted to ICT (UTC+7) so charts render Vietnam clock times.
    """
    import time as _time
    now = int(_time.time())
    frm = now - max(1, days) * 86400
    bars = _entrade_bars(symbol, resolution, frm, now + 86400)
    return [{
        "time":   b["t"] + 7 * 3600,        # ICT so lightweight-charts shows VN time
        "open":   b["o"], "high": b["h"], "low": b["l"], "close": b["c"],
        "volume": b["v"],
    } for b in bars]


def fetch_derivatives_oi(symbol: str, start_date, end_date) -> list[dict]:
    """Daily Open Interest for 'VN30F1M' / 'VN30F2M' (returns [] for the index).

    KBS embeds OI in the same data_day response (the 'oi' field), so this reuses
    the resolved front-month contract. oi_change is the day-over-day delta.
    """
    sym = symbol.strip().upper()
    if sym not in ("VN30F1M", "VN30F2M"):
        return []
    start = start_date if isinstance(start_date, date) else date.fromisoformat(str(start_date)[:10])
    end   = end_date   if isinstance(end_date,   date) else date.fromisoformat(str(end_date)[:10])
    contract = _resolve_kbs_contract(sym)
    resp = _get(f"{KBS_BASE}/{contract}/data_day"
                f"?sdate={_fmt_kbs_date(start)}&edate={_fmt_kbs_date(end)}")

    # Collect (date, oi) then sort oldest→newest so oi_change is the forward delta.
    pairs: list[tuple[date, int]] = []
    for row in resp.get("data_day", []):
        try:
            d = datetime.strptime(row["t"][:10], "%Y-%m-%d").date()
            if d < start or d > end or row.get("oi") in (None, ""):
                continue
            pairs.append((d, int(float(row["oi"]))))
        except Exception:
            pass
    pairs.sort()

    out: list[dict] = []
    prev: int | None = None
    for d, oi in pairs:
        out.append({"date": d.isoformat(), "open_interest": oi,
                    "oi_change": (oi - prev) if prev is not None else None})
        prev = oi
    return out


# ── Backward-compatible alias ─────────────────────────────────────────────────

FireantClient = VietcapClient
