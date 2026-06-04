import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createChart, CrosshairMode, ColorType, LineStyle, } from 'lightweight-charts';
// ── VN Index constituents (HOSE, approximate – rebalanced quarterly) ──────────
const VN_INDICES = {
    vn30: {
        label: 'VN30',
        color: '#3b82f6',
        symbols: [
            'ACB', 'BCM', 'BID', 'BVH', 'CTG', 'FPT', 'GAS', 'GVR', 'HDB', 'HPG',
            'MBB', 'MSN', 'MWG', 'PLX', 'POW', 'SAB', 'SHB', 'SSB', 'SSI', 'STB',
            'TCB', 'TPB', 'VCB', 'VHM', 'VIB', 'VIC', 'VJC', 'VNM', 'VPB', 'VRE',
        ],
    },
    vnmidcap: {
        label: 'VN MidCap',
        color: '#8b5cf6',
        symbols: [
            'APH', 'ASM', 'BCG', 'BSR', 'BTP', 'CAV', 'CMG', 'CNG', 'CRE', 'CTD',
            'DBC', 'DCM', 'DGW', 'DHC', 'DIG', 'DPM', 'EIB', 'EVF', 'GEE', 'GEX',
            'GMD', 'HAH', 'HAR', 'HCM', 'HHS', 'HSG', 'HTN', 'IDC', 'IMP', 'KBC',
            'KDH', 'KHG', 'LDG', 'LHG', 'MSB', 'NLG', 'NTC', 'NVL', 'PDR', 'PHR',
            'PNJ', 'PPC', 'PTB', 'QNS', 'REE', 'SBT', 'SBV', 'SJS', 'SZC', 'TBC',
            'TLG', 'TNG', 'VCI', 'VGC', 'VIX', 'VMC', 'VND', 'VPH', 'VRC', 'VTP',
            'AGG', 'ALT', 'CII', 'DRC', 'HAG', 'HVN', 'KDC', 'LCG', 'PVD', 'VHC',
        ],
    },
    vnsmallcap: {
        label: 'VN SmallCap',
        color: '#f59e0b',
        symbols: [
            'AGR', 'ACC', 'BFC', 'BRC', 'BSI', 'BVS', 'BWE', 'CCL', 'CEO', 'CSV',
            'CTB', 'CTI', 'DVP', 'FTS', 'GMC', 'HAX', 'HBC', 'HDG', 'HUT', 'IJC',
            'ITA', 'KSB', 'LCS', 'LIX', 'MCG', 'MCP', 'NBB', 'NHH', 'NTL', 'NTP',
            'ORS', 'PC1', 'PGC', 'PGD', 'POT', 'PVP', 'PVT', 'QCG', 'RAL', 'SCR',
            'SFC', 'SFG', 'SHI', 'SIP', 'SMC', 'SRC', 'SVC', 'TDG', 'TDH', 'TDP',
            'TDW', 'TGG', 'THG', 'TIP', 'TIX', 'TPC', 'TRA', 'TRC', 'TSC', 'TTF',
            'TVB', 'TVS', 'UDC', 'VBH', 'VCG', 'VGI', 'VHD', 'VIS', 'VNL', 'VOS',
            'VSC', 'VSH', 'VST', 'VTO', 'WHS', 'BIC', 'CLC', 'CMC', 'CMP', 'CNT',
        ],
    },
    vndiamond: {
        label: 'VN Diamond',
        color: '#06b6d4',
        symbols: [
            'ACB', 'BMP', 'CMG', 'CTD', 'FPT', 'GMD', 'HCM', 'MWG', 'PAN',
            'PHR', 'PNJ', 'REE', 'SBT', 'STB', 'TCB', 'VNM', 'VPB',
        ],
    },
};
// ── API client ────────────────────────────────────────────────────────────────
const api = {
    stats: () => fetch('/api/stats').then(r => r.json()),
    status: () => fetch('/api/crawl/status').then(r => r.json()),
    runs: (limit = 40) => fetch(`/api/crawl/runs?limit=${limit}`).then(r => r.json()),
    symbols: (q = '', limit = 50, offset = 0, exchange = '', symbolsList = '') => fetch(`/api/symbols/list?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}&exchange=${exchange}&symbols=${encodeURIComponent(symbolsList)}`).then(r => r.json()),
    quotes: (symbol, days = 60) => fetch(`/api/symbols/${symbol}/quotes?days=${days}`).then(r => r.json()),
    fetchHistory: (symbol) => fetch(`/api/symbols/${encodeURIComponent(symbol)}/history`, { method: 'POST' }).then(r => r.json()),
    updateInfo: () => fetch('/api/crawl/update-info').then(r => r.json()),
    triggerUpdate: () => fetch('/api/crawl/update', { method: 'POST' }).then(async (r) => {
        if (!r.ok) {
            const b = await r.json().catch(() => ({}));
            throw new Error(b.detail ?? r.statusText);
        }
        return r.json();
    }),
    crawlSymbol: (symbol) => fetch(`/api/symbols/${encodeURIComponent(symbol)}/crawl`, { method: 'POST' }).then(async (r) => {
        if (!r.ok) {
            const b = await r.json().catch(() => ({}));
            throw new Error(b.detail ?? r.statusText);
        }
        return r.json();
    }),
    crawl: (date, jobs) => fetch('/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, jobs }),
    }).then(async (r) => {
        if (!r.ok) {
            const b = await r.json().catch(() => ({}));
            throw new Error(b.detail ?? r.statusText);
        }
        return r.json();
    }),
};
// ── Constants ─────────────────────────────────────────────────────────────────
const ALL_JOBS = ['symbols', 'quotes', 'history', 'foreign', 'news', 'fundamentals'];
const JOB_LABELS = {
    symbols: 'Symbols',
    quotes: 'Today OHLCV',
    history: 'Full History (all time)',
    foreign: 'Foreign flow',
    news: 'News',
    fundamentals: 'Fundamentals',
};
const PAGE_SIZE = 50;
// ── Helpers ───────────────────────────────────────────────────────────────────
function yesterday() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    if (d.getDay() === 0)
        d.setDate(d.getDate() - 2);
    if (d.getDay() === 6)
        d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
}
function fmtPrice(v) {
    if (v == null)
        return '—';
    return v.toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
function fmtVol(v) {
    if (v == null)
        return '—';
    if (v >= 1000000)
        return `${(v / 1000000).toFixed(1)}M`;
    if (v >= 1000)
        return `${(v / 1000).toFixed(0)}K`;
    return v.toString();
}
function fmtDate(iso) {
    if (!iso)
        return '—';
    return new Date(iso).toLocaleString();
}
function duration(start, end) {
    if (!end)
        return '…';
    const s = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000);
    if (s < 60)
        return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
}
// ── Sub-components ────────────────────────────────────────────────────────────
function StatCard({ label, value, accent }) {
    return (_jsxs("div", { className: "bg-gray-800 rounded-lg p-4", children: [_jsx("div", { className: `text-2xl font-bold tabular-nums ${accent ?? 'text-white'}`, children: value }), _jsx("div", { className: "text-xs text-gray-400 mt-0.5", children: label })] }));
}
function StatusBadge({ status }) {
    const cls = status === 'done' ? 'bg-green-900 text-green-300'
        : status === 'error' ? 'bg-red-900 text-red-300'
            : status === 'running' ? 'bg-cyan-900 text-cyan-300'
                : 'bg-gray-700 text-gray-400';
    return _jsx("span", { className: `px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`, children: status });
}
function ChangePct({ v }) {
    if (v == null)
        return _jsx("span", { className: "text-gray-500", children: "\u2014" });
    const up = v >= 0;
    return (_jsxs("span", { className: `font-semibold tabular-nums ${up ? 'text-green-400' : 'text-red-400'}`, children: [up ? '+' : '', v.toFixed(2), "%"] }));
}
function Sparkline({ prices }) {
    if (prices.length < 2)
        return _jsx("span", { className: "text-gray-600 text-xs", children: "no data" });
    const W = 80, H = 28;
    const min = Math.min(...prices), max = Math.max(...prices);
    const range = max - min || 1;
    const pts = prices.map((p, i) => {
        const x = (i / (prices.length - 1)) * W;
        const y = H - ((p - min) / range) * (H - 4) - 2;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const up = prices[prices.length - 1] >= prices[0];
    return (_jsx("svg", { width: W, height: H, className: "overflow-visible", children: _jsx("polyline", { points: pts, fill: "none", stroke: up ? '#4ade80' : '#f87171', strokeWidth: "1.5", strokeLinejoin: "round" }) }));
}
const INDICATOR_DEFS = [
    // Overlay
    { id: 'ma20', label: 'MA 20', desc: 'Simple Moving Average (20)', category: 'Overlay', color: '#facc15' },
    { id: 'ma50', label: 'MA 50', desc: 'Simple Moving Average (50)', category: 'Overlay', color: '#60a5fa' },
    { id: 'ma200', label: 'MA 200', desc: 'Simple Moving Average (200)', category: 'Overlay', color: '#f472b6' },
    { id: 'ema20', label: 'EMA 20', desc: 'Exponential Moving Avg (20)', category: 'Overlay', color: '#fb923c' },
    { id: 'ema50', label: 'EMA 50', desc: 'Exponential Moving Avg (50)', category: 'Overlay', color: '#34d399' },
    { id: 'ema200', label: 'EMA 200', desc: 'Exponential Moving Avg (200)', category: 'Overlay', color: '#c084fc' },
    { id: 'bb', label: 'Bollinger Bands', desc: 'BB (20, ±2 std)', category: 'Overlay', color: '#8b5cf6' },
    { id: 'vwap', label: 'VWAP', desc: 'Volume Weighted Avg Price (20d)', category: 'Overlay', color: '#f97316' },
    { id: 'supertrend', label: 'SuperTrend', desc: 'ATR-based trend (10, 3)', category: 'Overlay', color: '#10b981' },
    { id: '52whl', label: '52W High/Low', desc: 'Rolling 52-week high and low', category: 'Overlay', color: '#06b6d4' },
    { id: 'volume', label: 'Volume', desc: 'Trading volume bars', category: 'Overlay', color: '#6b7280' },
    // Oscillator
    { id: 'rsi', label: 'RSI (14)', desc: 'Relative Strength Index', category: 'Oscillator', color: '#a78bfa' },
    { id: 'macd', label: 'MACD (12,26,9)', desc: 'Moving Avg Convergence Div.', category: 'Oscillator', color: '#22d3ee' },
    { id: 'stoch', label: 'Stochastic (14,3)', desc: 'Stochastic Oscillator', category: 'Oscillator', color: '#f59e0b' },
    { id: 'aroon', label: 'Aroon (14)', desc: 'Aroon Up/Down oscillator', category: 'Oscillator', color: '#4ade80' },
    { id: 'adx', label: 'ADX (14)', desc: 'Avg Directional Index + DI', category: 'Oscillator', color: '#f43f5e' },
    { id: 'cci', label: 'CCI (20)', desc: 'Commodity Channel Index', category: 'Oscillator', color: '#eab308' },
    { id: 'atr', label: 'ATR (14)', desc: 'Average True Range', category: 'Oscillator', color: '#94a3b8' },
    { id: 'williamsr', label: 'Williams %R (14)', desc: 'Williams Percent Range', category: 'Oscillator', color: '#06b6d4' },
    { id: 'obv', label: 'OBV', desc: 'On Balance Volume', category: 'Oscillator', color: '#a3e635' },
    { id: 'bbw', label: 'BB Width', desc: 'Bollinger Bands Width %', category: 'Oscillator', color: '#e879f9' },
    // ── New overlays ──────────────────────────────────────────────────────────────
    { id: 'ichimoku', label: 'Ichimoku Cloud', desc: 'Trend + S/R + momentum (9,26,52)', category: 'Overlay', color: '#26a69a' },
    { id: 'psar', label: 'Parabolic SAR', desc: 'Trend-reversal dots (step 0.02, max 0.2)', category: 'Overlay', color: '#ff9800' },
    { id: 'donchian', label: 'Donchian (20)', desc: 'Highest high / lowest low channel', category: 'Overlay', color: '#00bcd4' },
    { id: 'pivot', label: 'Pivot Points', desc: 'Daily PP · R1/R2 · S1/S2 levels', category: 'Overlay', color: '#90a4ae' },
    { id: 'fib', label: 'Fibonacci', desc: 'Auto retracement from full-history H/L', category: 'Overlay', color: '#ff5722' },
    { id: 'wyckoff', label: 'Wyckoff Climax', desc: 'SC/BC volume-climax markers (×2.5 avg vol)', category: 'Overlay', color: '#ce93d8' },
    // ── New oscillators ───────────────────────────────────────────────────────────
    { id: 'mfi', label: 'MFI (14)', desc: 'Money Flow Index — volume-weighted RSI', category: 'Oscillator', color: '#26c6da' },
    { id: 'roc', label: 'ROC (14)', desc: 'Rate of Change — price momentum %', category: 'Oscillator', color: '#ffca28' },
    { id: 'cmf', label: 'CMF (20)', desc: 'Chaikin Money Flow — buy/sell pressure', category: 'Oscillator', color: '#66bb6a' },
];
const DEFAULT_INDICATORS = new Set(['ma20', 'ma50', 'ma200', 'volume', 'rsi']);
// ── Indicator math ────────────────────────────────────────────────────────────
function calcMA(closes, n) {
    return closes.map((_, i) => i < n - 1 ? null : closes.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n);
}
function calcEMA(closes, n) {
    const k = 2 / (n + 1);
    const out = new Array(closes.length).fill(null);
    if (closes.length < n)
        return out;
    out[n - 1] = closes.slice(0, n).reduce((a, b) => a + b, 0) / n;
    for (let i = n; i < closes.length; i++)
        out[i] = closes[i] * k + out[i - 1] * (1 - k);
    return out;
}
function calcBB(closes, n = 20, mult = 2) {
    return closes.map((_, i) => {
        if (i < n - 1)
            return null;
        const sl = closes.slice(i - n + 1, i + 1);
        const mean = sl.reduce((a, b) => a + b, 0) / n;
        const std = Math.sqrt(sl.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
        return { upper: mean + mult * std, mid: mean, lower: mean - mult * std };
    });
}
function calcRSI(closes, period = 14) {
    const out = new Array(closes.length).fill(null);
    if (closes.length <= period)
        return out;
    let avgG = 0, avgL = 0;
    for (let i = 1; i <= period; i++) {
        const d = closes[i] - closes[i - 1];
        if (d > 0)
            avgG += d;
        else
            avgL -= d;
    }
    avgG /= period;
    avgL /= period;
    for (let i = period; i < closes.length; i++) {
        if (i > period) {
            const d = closes[i] - closes[i - 1];
            avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
            avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
        }
        out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
    }
    return out;
}
function calcMACD(closes, fast = 12, slow = 26, sig = 9) {
    const ef = calcEMA(closes, fast);
    const es = calcEMA(closes, slow);
    const macdLine = closes.map((_, i) => ef[i] == null || es[i] == null ? null : ef[i] - es[i]);
    const validMacd = macdLine.flatMap(v => v == null ? [] : [v]);
    const sigEMA = calcEMA(validMacd, sig);
    let vi = 0;
    return macdLine.map(m => {
        if (m == null)
            return { macd: null, signal: null, hist: null };
        const s = sigEMA[vi++];
        return { macd: m, signal: s, hist: s == null ? null : m - s };
    });
}
function calcStoch(quotes, k = 14, d = 3) {
    const kLine = quotes.map((_, i) => {
        if (i < k - 1)
            return null;
        const sl = quotes.slice(i - k + 1, i + 1);
        const hi = Math.max(...sl.map(q => q.high));
        const lo = Math.min(...sl.map(q => q.low));
        return hi === lo ? 50 : (quotes[i].close - lo) / (hi - lo) * 100;
    });
    const dLine = kLine.map((_, i) => {
        const vals = kLine.slice(Math.max(0, i - d + 1), i + 1).filter(v => v != null);
        return vals.length < d ? null : vals.reduce((a, b) => a + b, 0) / vals.length;
    });
    return kLine.map((kv, i) => ({ k: kv, d: dLine[i] }));
}
function calcVWAP(quotes, period = 20) {
    return quotes.map((_, i) => {
        if (i < period - 1)
            return null;
        const sl = quotes.slice(i - period + 1, i + 1);
        const tpv = sl.reduce((s, q) => s + (q.high + q.low + q.close) / 3 * q.volume, 0);
        const vol = sl.reduce((s, q) => s + q.volume, 0);
        return vol === 0 ? null : tpv / vol;
    });
}
function calcSuperTrend(quotes, period = 10, mult = 3) {
    const n = quotes.length;
    const out = quotes.map(() => ({ value: null, bullish: true }));
    if (n < period + 1)
        return out;
    const tr = quotes.map((q, i) => i === 0 ? q.high - q.low
        : Math.max(q.high - q.low, Math.abs(q.high - quotes[i - 1].close), Math.abs(q.low - quotes[i - 1].close)));
    const atr = new Array(n).fill(0);
    atr[period] = tr.slice(1, period + 1).reduce((a, b) => a + b) / period;
    for (let i = period + 1; i < n; i++)
        atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
    let upper = 0, lower = 0, dir = 1;
    for (let i = period; i < n; i++) {
        const hl2 = (quotes[i].high + quotes[i].low) / 2;
        const bu = hl2 + mult * atr[i];
        const bl = hl2 - mult * atr[i];
        upper = (i === period || bu < upper || quotes[i - 1].close > upper) ? bu : upper;
        lower = (i === period || bl > lower || quotes[i - 1].close < lower) ? bl : lower;
        if (i === period) {
            dir = quotes[i].close <= upper ? 1 : -1;
        }
        else {
            if (dir === 1 && quotes[i].close > upper)
                dir = -1;
            else if (dir === -1 && quotes[i].close < lower)
                dir = 1;
        }
        out[i] = { value: dir === 1 ? upper : lower, bullish: dir === -1 };
    }
    return out;
}
function calc52WHL(quotes, period = 252) {
    return quotes.map((_, i) => {
        const sl = quotes.slice(Math.max(0, i - period + 1), i + 1);
        return { high: Math.max(...sl.map(q => q.high)), low: Math.min(...sl.map(q => q.low)) };
    });
}
function calcAroon(quotes, period = 14) {
    return quotes.map((_, i) => {
        if (i < period)
            return { up: null, down: null };
        const sl = quotes.slice(i - period, i + 1);
        const hiIdx = sl.reduce((mi, q, j) => q.high > sl[mi].high ? j : mi, 0);
        const loIdx = sl.reduce((mi, q, j) => q.low < sl[mi].low ? j : mi, 0);
        return { up: (hiIdx / period) * 100, down: (loIdx / period) * 100 };
    });
}
function calcADX(quotes, period = 14) {
    const n = quotes.length;
    const out = quotes.map(() => ({ adx: null, pdi: null, ndi: null }));
    if (n < period * 2 + 1)
        return out;
    const tr = new Array(n).fill(0), pDM = new Array(n).fill(0), nDM = new Array(n).fill(0);
    for (let i = 1; i < n; i++) {
        const q = quotes[i], p = quotes[i - 1];
        tr[i] = Math.max(q.high - q.low, Math.abs(q.high - p.close), Math.abs(q.low - p.close));
        const up = q.high - p.high, dn = p.low - q.low;
        pDM[i] = up > dn && up > 0 ? up : 0;
        nDM[i] = dn > up && dn > 0 ? dn : 0;
    }
    let smTR = tr.slice(1, period + 1).reduce((a, b) => a + b);
    let smP = pDM.slice(1, period + 1).reduce((a, b) => a + b);
    let smN = nDM.slice(1, period + 1).reduce((a, b) => a + b);
    const pdi = [], ndi = [], dx = [];
    const push = (sTR, sP, sN) => {
        const p = sTR === 0 ? 0 : sP / sTR * 100, nn = sTR === 0 ? 0 : sN / sTR * 100;
        pdi.push(p);
        ndi.push(nn);
        dx.push(p + nn === 0 ? 0 : Math.abs(p - nn) / (p + nn) * 100);
    };
    push(smTR, smP, smN);
    for (let i = period + 1; i < n; i++) {
        smTR = smTR - smTR / period + tr[i];
        smP = smP - smP / period + pDM[i];
        smN = smN - smN / period + nDM[i];
        push(smTR, smP, smN);
    }
    let adx = dx.slice(0, period).reduce((a, b) => a + b) / period;
    const adxArr = [adx];
    for (let i = period; i < dx.length; i++) {
        adx = (adx * (period - 1) + dx[i]) / period;
        adxArr.push(adx);
    }
    const adxStart = period * 2, diStart = period;
    for (let i = 0; i < n; i++) {
        out[i] = {
            adx: i - adxStart >= 0 && i - adxStart < adxArr.length ? +adxArr[i - adxStart].toFixed(2) : null,
            pdi: i - diStart >= 0 && i - diStart < pdi.length ? +pdi[i - diStart].toFixed(2) : null,
            ndi: i - diStart >= 0 && i - diStart < ndi.length ? +ndi[i - diStart].toFixed(2) : null,
        };
    }
    return out;
}
function calcCCI(quotes, period = 20) {
    return quotes.map((_, i) => {
        if (i < period - 1)
            return null;
        const sl = quotes.slice(i - period + 1, i + 1);
        const tp = sl.map(q => (q.high + q.low + q.close) / 3);
        const mean = tp.reduce((a, b) => a + b) / period;
        const mad = tp.reduce((s, v) => s + Math.abs(v - mean), 0) / period;
        return mad === 0 ? 0 : (tp[period - 1] - mean) / (0.015 * mad);
    });
}
function calcATR(quotes, period = 14) {
    const out = new Array(quotes.length).fill(null);
    if (quotes.length < period + 1)
        return out;
    const tr = quotes.map((q, i) => i === 0 ? q.high - q.low
        : Math.max(q.high - q.low, Math.abs(q.high - quotes[i - 1].close), Math.abs(q.low - quotes[i - 1].close)));
    let atr = tr.slice(1, period + 1).reduce((a, b) => a + b) / period;
    out[period] = +atr.toFixed(4);
    for (let i = period + 1; i < quotes.length; i++) {
        atr = (atr * (period - 1) + tr[i]) / period;
        out[i] = +atr.toFixed(4);
    }
    return out;
}
function calcWilliamsR(quotes, period = 14) {
    return quotes.map((_, i) => {
        if (i < period - 1)
            return null;
        const sl = quotes.slice(i - period + 1, i + 1);
        const hi = Math.max(...sl.map(q => q.high));
        const lo = Math.min(...sl.map(q => q.low));
        return hi === lo ? -50 : (hi - quotes[i].close) / (hi - lo) * -100;
    });
}
function calcOBV(quotes) {
    return quotes.reduce((acc, q, i) => {
        if (i === 0)
            return [0];
        const prev = acc[i - 1];
        if (q.close > quotes[i - 1].close)
            acc.push(prev + q.volume);
        else if (q.close < quotes[i - 1].close)
            acc.push(prev - q.volume);
        else
            acc.push(prev);
        return acc;
    }, []);
}
function calcBBW(closes, n = 20, mult = 2) {
    return calcBB(closes, n, mult).map(v => v == null ? null : (v.upper - v.lower) / v.mid * 100);
}
// ── New indicator math ────────────────────────────────────────────────────────
function calcIchimoku(quotes) {
    const hi = (p, i) => { let m = -Infinity; for (let j = Math.max(0, i - p + 1); j <= i; j++)
        m = Math.max(m, quotes[j].high); return m; };
    const lo = (p, i) => { let m = Infinity; for (let j = Math.max(0, i - p + 1); j <= i; j++)
        m = Math.min(m, quotes[j].low); return m; };
    return quotes.map((_, i) => ({
        tenkan: i >= 8 ? (hi(9, i) + lo(9, i)) / 2 : null,
        kijun: i >= 25 ? (hi(26, i) + lo(26, i)) / 2 : null,
        spanA: i >= 25 ? ((hi(9, i) + lo(9, i)) / 2 + (hi(26, i) + lo(26, i)) / 2) / 2 : null,
        spanB: i >= 51 ? (hi(52, i) + lo(52, i)) / 2 : null,
    }));
}
function calcParabolicSAR(quotes, afStep = 0.02, afMax = 0.2) {
    const out = quotes.map(() => ({ sar: null, bull: true }));
    if (quotes.length < 2)
        return out;
    let bull = true, af = afStep, ep = quotes[0].high, sar = quotes[0].low;
    for (let i = 1; i < quotes.length; i++) {
        const { high, low } = quotes[i];
        let ns = sar + af * (ep - sar);
        if (bull) {
            ns = Math.min(ns, quotes[i - 1].low, i >= 2 ? quotes[i - 2].low : quotes[i - 1].low);
            if (low < ns) {
                bull = false;
                ns = ep;
                ep = low;
                af = afStep;
            }
            else if (high > ep) {
                ep = high;
                af = Math.min(af + afStep, afMax);
            }
        }
        else {
            ns = Math.max(ns, quotes[i - 1].high, i >= 2 ? quotes[i - 2].high : quotes[i - 1].high);
            if (high > ns) {
                bull = true;
                ns = ep;
                ep = high;
                af = afStep;
            }
            else if (low < ep) {
                ep = low;
                af = Math.min(af + afStep, afMax);
            }
        }
        sar = ns;
        out[i] = { sar, bull };
    }
    return out;
}
function calcDonchian(quotes, period = 20) {
    return quotes.map((_, i) => {
        if (i < period - 1)
            return { upper: null, mid: null, lower: null };
        const sl = quotes.slice(i - period + 1, i + 1);
        const upper = Math.max(...sl.map(q => q.high));
        const lower = Math.min(...sl.map(q => q.low));
        return { upper, mid: (upper + lower) / 2, lower };
    });
}
function calcPivotPoints(quotes) {
    return quotes.map((_, i) => {
        if (i === 0)
            return { pp: null, r1: null, r2: null, s1: null, s2: null };
        const { high: h, low: l, close: c } = quotes[i - 1];
        const pp = (h + l + c) / 3;
        return { pp, r1: 2 * pp - l, r2: pp + (h - l), s1: 2 * pp - h, s2: pp - (h - l) };
    });
}
function calcFibLevels(quotes) {
    const high = Math.max(...quotes.map(q => q.high));
    const low = Math.min(...quotes.map(q => q.low));
    const diff = high - low;
    return [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].map(r => ({ ratio: r, value: high - r * diff }));
}
function calcMFI(quotes, period = 14) {
    const tp = quotes.map(q => (q.high + q.low + q.close) / 3);
    const rmf = quotes.map((q, i) => tp[i] * q.volume);
    return quotes.map((_, i) => {
        if (i < period)
            return null;
        let pos = 0, neg = 0;
        for (let j = i - period + 1; j <= i; j++) {
            if (j > 0) {
                if (tp[j] > tp[j - 1])
                    pos += rmf[j];
                else
                    neg += rmf[j];
            }
        }
        return neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
    });
}
function calcROC(closes, period = 14) {
    return closes.map((c, i) => i < period ? null : ((c - closes[i - period]) / closes[i - period]) * 100);
}
function calcCMF(quotes, period = 20) {
    return quotes.map((_, i) => {
        if (i < period - 1)
            return null;
        let mfv = 0, vol = 0;
        for (let j = i - period + 1; j <= i; j++) {
            const { high: h, low: l, close: c, volume: v } = quotes[j];
            const hl = h - l;
            if (hl > 0) {
                mfv += ((c - l) - (h - c)) / hl * v;
                vol += v;
            }
        }
        return vol === 0 ? 0 : mfv / vol;
    });
}
function calcWyckoffClimax(quotes, period = 20, mult = 2.5) {
    return quotes.map((q, i) => {
        if (i < period)
            return null;
        const avg = quotes.slice(i - period, i).reduce((s, x) => s + x.volume, 0) / period;
        if (q.volume < avg * mult)
            return null;
        return q.close < q.open ? 'SC' : 'BC';
    });
}
// ── Indicator picker panel ────────────────────────────────────────────────────
function IndicatorPanel({ active, onChange, onClose, }) {
    const [search, setSearch] = useState('');
    const filtered = INDICATOR_DEFS.filter(d => d.label.toLowerCase().includes(search.toLowerCase()) ||
        d.desc.toLowerCase().includes(search.toLowerCase()));
    const categories = ['Overlay', 'Oscillator'];
    const toggle = (id) => {
        const next = new Set(active);
        next.has(id) ? next.delete(id) : next.add(id);
        onChange(next);
    };
    return (_jsxs(_Fragment, { children: [_jsx("div", { className: "fixed inset-0 z-[60]", onClick: onClose }), _jsxs("div", { className: "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[70]\n                      w-80 max-h-[80vh] flex flex-col\n                      bg-[#1a1d27] border border-gray-600/70 rounded-xl shadow-2xl overflow-hidden", children: [_jsxs("div", { className: "flex items-center justify-between px-4 py-3 border-b border-gray-700/60 shrink-0", children: [_jsx("span", { className: "text-sm font-bold text-gray-100 tracking-wide", children: "Ch\u1EC9 b\u00E1o k\u1EF9 thu\u1EADt" }), _jsx("button", { onClick: onClose, className: "text-gray-500 hover:text-gray-200 transition-colors text-base leading-none", children: "\u2715" })] }), _jsx("div", { className: "px-3 py-2.5 border-b border-gray-700/40 shrink-0", children: _jsxs("div", { className: "relative", children: [_jsx("span", { className: "absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-xs", children: "\uD83D\uDD0D" }), _jsx("input", { type: "text", placeholder: "T\u00ECm ki\u1EBFm\u2026", value: search, onChange: e => setSearch(e.target.value), autoFocus: true, className: "w-full bg-gray-800 border border-gray-600/60 rounded-lg pl-7 pr-3 py-1.5\n                         text-xs text-gray-100 placeholder-gray-500\n                         focus:outline-none focus:border-blue-500/70 transition-colors" })] }) }), active.size > 0 && !search && (_jsx("div", { className: "px-3 py-2 border-b border-gray-700/40 shrink-0 flex flex-wrap gap-1.5", children: INDICATOR_DEFS.filter(d => active.has(d.id)).map(d => (_jsxs("button", { onClick: () => toggle(d.id), className: "flex items-center gap-1 px-2 py-0.5 rounded-full text-xs\n                           bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors", children: [_jsx("span", { className: "w-1.5 h-1.5 rounded-full shrink-0", style: { background: d.color } }), d.label, _jsx("span", { className: "text-gray-400 hover:text-red-400 ml-0.5", children: "\u2715" })] }, d.id))) })), _jsxs("div", { className: "overflow-y-auto flex-1 py-1", children: [categories.map(cat => {
                                const items = filtered.filter(d => d.category === cat);
                                if (!items.length)
                                    return null;
                                return (_jsxs("div", { children: [_jsx("div", { className: "px-4 py-1.5 text-[10px] font-bold text-gray-500 uppercase tracking-widest\n                                bg-gray-900/40 sticky top-0", children: cat === 'Overlay' ? 'Overlay — vẽ trên nến' : 'Oscillator — bảng riêng' }), items.map(ind => {
                                            const on = active.has(ind.id);
                                            return (_jsxs("button", { onClick: () => toggle(ind.id), className: `w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors
                        ${on ? 'bg-blue-950/50 hover:bg-blue-950/70' : 'hover:bg-gray-800/70'}`, children: [_jsx("span", { className: "w-3 h-3 rounded-full shrink-0 border-2 transition-all", style: {
                                                            background: on ? ind.color : 'transparent',
                                                            borderColor: ind.color,
                                                            boxShadow: on ? `0 0 6px ${ind.color}60` : 'none',
                                                        } }), _jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("div", { className: `text-xs font-semibold ${on ? 'text-gray-100' : 'text-gray-400'}`, children: ind.label }), _jsx("div", { className: "text-[10px] text-gray-600 truncate mt-0.5", children: ind.desc })] }), on && (_jsx("span", { className: "text-blue-400 text-xs shrink-0", children: "\u2713" }))] }, ind.id));
                                        })] }, cat));
                            }), filtered.length === 0 && (_jsx("div", { className: "px-4 py-8 text-center text-gray-600 text-xs", children: "Kh\u00F4ng t\u00ECm th\u1EA5y ch\u1EC9 b\u00E1o" }))] }), _jsxs("div", { className: "px-4 py-2 border-t border-gray-700/40 shrink-0 flex items-center justify-between", children: [_jsxs("span", { className: "text-[10px] text-gray-600", children: [active.size, " \u0111ang hi\u1EC3n th\u1ECB"] }), active.size > 0 && (_jsx("button", { onClick: () => onChange(new Set()), className: "text-[10px] text-gray-500 hover:text-red-400 transition-colors", children: "X\u00F3a t\u1EA5t c\u1EA3" }))] })] })] }));
}
// ── Interactive chart with dynamic indicator panes ────────────────────────────
function InteractiveChart({ quotes, indicators }) {
    const priceRef = useRef(null);
    const rsiRef = useRef(null);
    const macdRef = useRef(null);
    const stochRef = useRef(null);
    const aroonRef = useRef(null);
    const adxRef = useRef(null);
    const cciRef = useRef(null);
    const atrRef = useRef(null);
    const williamsrRef = useRef(null);
    const obvRef = useRef(null);
    const bbwRef = useRef(null);
    const mfiRef = useRef(null);
    const rocRef = useRef(null);
    const cmfRef = useRef(null);
    const chartsRef = useRef([]);
    useEffect(() => {
        chartsRef.current = [];
        if (!priceRef.current || quotes.length < 5)
            return;
        const THEME = {
            layout: { background: { type: ColorType.Solid, color: '#111827' }, textColor: '#9ca3af' },
            grid: { vertLines: { color: '#1f2937' }, horzLines: { color: '#1f2937' } },
            rightPriceScale: { borderColor: '#374151' },
            timeScale: { borderColor: '#374151', timeVisible: true },
        };
        const t = (q) => q.date;
        const closes = quotes.map(q => q.close);
        // ── Price pane ────────────────────────────────────────────────────────────
        const priceChart = createChart(priceRef.current, {
            ...THEME, crosshair: { mode: CrosshairMode.Normal }, height: 360,
        });
        const candleSeries = priceChart.addCandlestickSeries({
            upColor: '#4ade80', downColor: '#f87171',
            borderUpColor: '#4ade80', borderDownColor: '#f87171',
            wickUpColor: '#4ade80', wickDownColor: '#f87171',
        });
        candleSeries.setData(quotes.map(q => ({ time: t(q), open: q.open, high: q.high, low: q.low, close: q.close })));
        const addLine = (vals, color, w = 1) => {
            const s = priceChart.addLineSeries({ color, lineWidth: w, priceLineVisible: false, lastValueVisible: false });
            s.setData(vals.flatMap((v, i) => v == null ? [] : [{ time: t(quotes[i]), value: v }]));
        };
        // Volume
        if (indicators.has('volume')) {
            const volS = priceChart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol' });
            priceChart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
            volS.setData(quotes.map(q => ({
                time: t(q), value: q.volume,
                color: q.close >= q.open ? '#15803d60' : '#b91c1c60',
            })));
        }
        // Moving averages
        if (indicators.has('ma20'))
            addLine(calcMA(closes, 20), '#facc15');
        if (indicators.has('ma50'))
            addLine(calcMA(closes, 50), '#60a5fa');
        if (indicators.has('ma200'))
            addLine(calcMA(closes, 200), '#f472b6');
        if (indicators.has('ema20'))
            addLine(calcEMA(closes, 20), '#fb923c');
        if (indicators.has('ema50'))
            addLine(calcEMA(closes, 50), '#34d399');
        if (indicators.has('ema200'))
            addLine(calcEMA(closes, 200), '#c084fc');
        // Bollinger Bands
        if (indicators.has('bb')) {
            const bb = calcBB(closes);
            const addBBLine = (key, color) => addLine(bb.map(v => v == null ? null : v[key]), color);
            addBBLine('upper', '#8b5cf6');
            addBBLine('mid', '#8b5cf660');
            addBBLine('lower', '#8b5cf6');
        }
        // VWAP
        if (indicators.has('vwap'))
            addLine(calcVWAP(quotes), '#f97316', 2);
        // SuperTrend — split into bullish / bearish segments
        if (indicators.has('supertrend')) {
            const st = calcSuperTrend(quotes);
            const sBull = priceChart.addLineSeries({ color: '#10b981', lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
            const sBear = priceChart.addLineSeries({ color: '#f43f5e', lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
            sBull.setData(st.flatMap((v, i) => v.value == null || !v.bullish ? [] : [{ time: t(quotes[i]), value: v.value }]));
            sBear.setData(st.flatMap((v, i) => v.value == null || v.bullish ? [] : [{ time: t(quotes[i]), value: v.value }]));
        }
        // 52-Week High/Low
        if (indicators.has('52whl')) {
            const whl = calc52WHL(quotes);
            addLine(whl.map(v => v.high), '#06b6d4');
            addLine(whl.map(v => v.low), '#f59e0b');
        }
        // Donchian Channels (20)
        if (indicators.has('donchian')) {
            const dc = calcDonchian(quotes);
            addLine(dc.map(v => v.upper), '#00bcd4');
            addLine(dc.map(v => v.lower), '#00bcd4');
            addLine(dc.map(v => v.mid), '#00bcd4');
        }
        // Ichimoku Cloud
        if (indicators.has('ichimoku')) {
            const ic = calcIchimoku(quotes);
            // Collect forward-shifted (26 bars) cloud data points
            const cloudPts = [];
            ic.forEach((v, i) => {
                const fwd = i + 26;
                if (v.spanA != null && v.spanB != null && fwd < quotes.length)
                    cloudPts.push({ time: t(quotes[fwd]), spanA: v.spanA, spanB: v.spanB });
            });
            // Helper: fill-area series (lineVisible:false so only the fill is drawn)
            const mkArea = (data, color) => {
                const s = priceChart.addAreaSeries({
                    lineVisible: false, crosshairMarkerVisible: false,
                    topColor: color, bottomColor: color,
                    priceLineVisible: false, lastValueVisible: false,
                });
                s.setData(data);
            };
            // Cloud fill: colored area from top-span down, then background mask from
            // bottom-span down — the mask hides everything below the lower span so
            // only the band between A and B is visually filled.
            const CHART_BG = '#111827';
            const bullish = cloudPts.filter(d => d.spanA >= d.spanB);
            const bearish = cloudPts.filter(d => d.spanB > d.spanA);
            if (bullish.length) {
                mkArea(bullish.map(d => ({ time: d.time, value: d.spanA })), 'rgba(38,166,154,0.25)');
                mkArea(bullish.map(d => ({ time: d.time, value: d.spanB })), CHART_BG);
            }
            if (bearish.length) {
                mkArea(bearish.map(d => ({ time: d.time, value: d.spanB })), 'rgba(239,83,80,0.25)');
                mkArea(bearish.map(d => ({ time: d.time, value: d.spanA })), CHART_BG);
            }
            // Lines drawn on top of the cloud fill
            // Tenkan-sen (conversion line, red) · Kijun-sen (base line, blue)
            addLine(ic.map(v => v.tenkan), '#e05c5c');
            addLine(ic.map(v => v.kijun), '#2196f3', 2);
            // Senkou Span A (green) & B (red) shifted 26 bars forward
            const mkFwd = (vals, color) => {
                const s = priceChart.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
                s.setData(vals.flatMap((v, i) => {
                    const fwd = i + 26;
                    return v == null || fwd >= quotes.length ? [] : [{ time: t(quotes[fwd]), value: v }];
                }));
            };
            mkFwd(ic.map(v => v.spanA), '#26a69a');
            mkFwd(ic.map(v => v.spanB), '#ef5350');
            // Chikou Span (purple dashed): current close plotted 26 bars back
            const chikouS = priceChart.addLineSeries({ color: '#ab47bc', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: LineStyle.Dashed });
            chikouS.setData(quotes.flatMap((q, i) => i < 26 ? [] : [{ time: t(quotes[i - 26]), value: q.close }]));
        }
        // Accumulate candle markers (PSAR + Wyckoff combined, must be sorted by time)
        const allMarkers = [];
        if (indicators.has('psar')) {
            calcParabolicSAR(quotes).forEach((v, i) => {
                if (v.sar == null)
                    return;
                allMarkers.push({ time: t(quotes[i]), position: v.bull ? 'belowBar' : 'aboveBar', color: v.bull ? '#26a69a' : '#ef5350', shape: 'circle', size: 0.3 });
            });
        }
        if (indicators.has('wyckoff')) {
            calcWyckoffClimax(quotes).forEach((type, i) => {
                if (!type)
                    return;
                allMarkers.push({ time: t(quotes[i]), position: type === 'SC' ? 'belowBar' : 'aboveBar', color: type === 'SC' ? '#ef5350' : '#26a69a', shape: type === 'SC' ? 'arrowUp' : 'arrowDown', text: type, size: 1 });
            });
        }
        if (allMarkers.length > 0) {
            allMarkers.sort((a, b) => a.time < b.time ? -1 : 1);
            candleSeries.setMarkers(allMarkers);
        }
        // Fibonacci Retracement (auto from full-history H/L)
        if (indicators.has('fib')) {
            const fibColors = ['#f44336', '#ff9800', '#ffeb3b', '#66bb6a', '#2196f3', '#9c27b0', '#f44336'];
            calcFibLevels(quotes).forEach(({ ratio, value }, i) => candleSeries.createPriceLine({ price: value, color: fibColors[i], lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `Fib ${(ratio * 100).toFixed(1)}%` }));
        }
        // Pivot Points (yesterday → today)
        if (indicators.has('pivot')) {
            const last = calcPivotPoints(quotes)[quotes.length - 1];
            if (last.pp != null) {
                ;
                ([
                    { p: last.r2, c: '#ef5350', l: 'R2' },
                    { p: last.r1, c: '#ff7043', l: 'R1' },
                    { p: last.pp, c: '#90a4ae', l: 'PP' },
                    { p: last.s1, c: '#66bb6a', l: 'S1' },
                    { p: last.s2, c: '#26a69a', l: 'S2' },
                ]).forEach(({ p, c, l }) => candleSeries.createPriceLine({ price: p, color: c, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: l }));
            }
        }
        priceChart.timeScale().fitContent();
        const allCharts = [priceChart];
        const makePane = (ref, h) => {
            if (!ref)
                return null;
            const c = createChart(ref, { ...THEME, crosshair: { mode: CrosshairMode.Normal }, height: h });
            allCharts.push(c);
            return c;
        };
        // ── Oscillator panes ──────────────────────────────────────────────────────
        if (indicators.has('rsi') && rsiRef.current) {
            const c = makePane(rsiRef.current, 110);
            const s = c.addLineSeries({ color: '#a78bfa', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
            s.setData(calcRSI(closes).flatMap((v, i) => v == null ? [] : [{ time: t(quotes[i]), value: +v.toFixed(2) }]));
            s.createPriceLine({ price: 70, color: '#ef4444', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '70' });
            s.createPriceLine({ price: 30, color: '#22c55e', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '30' });
            s.createPriceLine({ price: 50, color: '#374151', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });
            c.timeScale().fitContent();
        }
        if (indicators.has('macd') && macdRef.current) {
            const c = makePane(macdRef.current, 110);
            const macdData = calcMACD(closes);
            const addMacdLine = (key, color) => {
                const s = c.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
                s.setData(macdData.flatMap((v, i) => v[key] == null ? [] : [{ time: t(quotes[i]), value: +v[key].toFixed(4) }]));
            };
            addMacdLine('macd', '#22d3ee');
            addMacdLine('signal', '#f87171');
            const hist = c.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
            hist.setData(macdData.flatMap((v, i) => v.hist == null ? [] : [{
                    time: t(quotes[i]), value: v.hist,
                    color: v.hist >= 0 ? '#15803d80' : '#b91c1c80',
                }]));
            c.timeScale().fitContent();
        }
        if (indicators.has('stoch') && stochRef.current) {
            const c = makePane(stochRef.current, 110);
            const stData = calcStoch(quotes);
            const addStLine = (key, color) => {
                const s = c.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
                s.setData(stData.flatMap((v, i) => v[key] == null ? [] : [{ time: t(quotes[i]), value: +v[key].toFixed(2) }]));
                return s;
            };
            const kS = addStLine('k', '#f59e0b');
            addStLine('d', '#60a5fa');
            kS.createPriceLine({ price: 80, color: '#ef4444', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '80' });
            kS.createPriceLine({ price: 20, color: '#22c55e', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '20' });
            c.timeScale().fitContent();
        }
        if (indicators.has('aroon') && aroonRef.current) {
            const c = makePane(aroonRef.current, 100);
            const arData = calcAroon(quotes);
            const mkLine = (key, color) => {
                const s = c.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
                s.setData(arData.flatMap((v, i) => v[key] == null ? [] : [{ time: t(quotes[i]), value: +v[key].toFixed(2) }]));
                return s;
            };
            const upS = mkLine('up', '#4ade80');
            mkLine('down', '#f87171');
            upS.createPriceLine({ price: 70, color: '#374151', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });
            c.timeScale().fitContent();
        }
        if (indicators.has('adx') && adxRef.current) {
            const c = makePane(adxRef.current, 110);
            const adxData = calcADX(quotes);
            const mkLine = (key, color) => {
                const s = c.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
                s.setData(adxData.flatMap((v, i) => v[key] == null ? [] : [{ time: t(quotes[i]), value: v[key] }]));
                return s;
            };
            mkLine('adx', '#f43f5e');
            mkLine('pdi', '#4ade80');
            mkLine('ndi', '#f87171');
            c.timeScale().fitContent();
        }
        if (indicators.has('cci') && cciRef.current) {
            const c = makePane(cciRef.current, 100);
            const s = c.addLineSeries({ color: '#eab308', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
            s.setData(calcCCI(quotes).flatMap((v, i) => v == null ? [] : [{ time: t(quotes[i]), value: +v.toFixed(2) }]));
            s.createPriceLine({ price: 100, color: '#ef4444', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '100' });
            s.createPriceLine({ price: -100, color: '#22c55e', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '-100' });
            s.createPriceLine({ price: 0, color: '#374151', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });
            c.timeScale().fitContent();
        }
        if (indicators.has('atr') && atrRef.current) {
            const c = makePane(atrRef.current, 90);
            const s = c.addLineSeries({ color: '#94a3b8', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
            s.setData(calcATR(quotes).flatMap((v, i) => v == null ? [] : [{ time: t(quotes[i]), value: v }]));
            c.timeScale().fitContent();
        }
        if (indicators.has('williamsr') && williamsrRef.current) {
            const c = makePane(williamsrRef.current, 100);
            const s = c.addLineSeries({ color: '#06b6d4', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
            s.setData(calcWilliamsR(quotes).flatMap((v, i) => v == null ? [] : [{ time: t(quotes[i]), value: +v.toFixed(2) }]));
            s.createPriceLine({ price: -20, color: '#ef4444', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '-20' });
            s.createPriceLine({ price: -80, color: '#22c55e', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '-80' });
            c.timeScale().fitContent();
        }
        if (indicators.has('obv') && obvRef.current) {
            const c = makePane(obvRef.current, 90);
            const obv = calcOBV(quotes);
            const s = c.addLineSeries({ color: '#a3e635', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
            s.setData(obv.map((v, i) => ({ time: t(quotes[i]), value: v })));
            c.timeScale().fitContent();
        }
        if (indicators.has('bbw') && bbwRef.current) {
            const c = makePane(bbwRef.current, 90);
            const s = c.addLineSeries({ color: '#e879f9', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
            s.setData(calcBBW(closes).flatMap((v, i) => v == null ? [] : [{ time: t(quotes[i]), value: +v.toFixed(4) }]));
            c.timeScale().fitContent();
        }
        if (indicators.has('mfi') && mfiRef.current) {
            const c = makePane(mfiRef.current, 110);
            const s = c.addLineSeries({ color: '#26c6da', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
            s.setData(calcMFI(quotes).flatMap((v, i) => v == null ? [] : [{ time: t(quotes[i]), value: +v.toFixed(2) }]));
            s.createPriceLine({ price: 80, color: '#ef4444', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '80' });
            s.createPriceLine({ price: 20, color: '#22c55e', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '20' });
            s.createPriceLine({ price: 50, color: '#374151', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });
            c.timeScale().fitContent();
        }
        if (indicators.has('roc') && rocRef.current) {
            const c = makePane(rocRef.current, 90);
            const s = c.addLineSeries({ color: '#ffca28', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
            s.setData(calcROC(closes).flatMap((v, i) => v == null ? [] : [{ time: t(quotes[i]), value: +v.toFixed(2) }]));
            s.createPriceLine({ price: 0, color: '#4b5563', lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: false, title: '' });
            c.timeScale().fitContent();
        }
        if (indicators.has('cmf') && cmfRef.current) {
            const c = makePane(cmfRef.current, 90);
            const hist = c.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
            hist.setData(calcCMF(quotes).flatMap((v, i) => v == null ? [] : [{
                    time: t(quotes[i]), value: +v.toFixed(4),
                    color: v >= 0 ? '#26a69a80' : '#ef535080',
                }]));
            hist.createPriceLine({ price: 0, color: '#4b5563', lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: false, title: '' });
            c.timeScale().fitContent();
        }
        // ── Sync all panes ────────────────────────────────────────────────────────
        allCharts.forEach((chart, idx) => {
            chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
                if (!range)
                    return;
                allCharts.forEach((c, j) => { if (j !== idx)
                    c.timeScale().setVisibleLogicalRange(range); });
            });
        });
        const observer = new ResizeObserver(() => {
            const w = priceRef.current?.clientWidth;
            if (w)
                allCharts.forEach(c => c.applyOptions({ width: w }));
        });
        observer.observe(priceRef.current);
        chartsRef.current = allCharts;
        return () => { observer.disconnect(); allCharts.forEach(c => { try {
            c.remove();
        }
        catch { } }); };
    }, [quotes, indicators]);
    if (quotes.length < 5)
        return (_jsx("div", { className: "text-gray-500 text-xs py-8 text-center", children: "No history yet \u2014 go to the Crawl tab and run \"Full History (all time)\"" }));
    const activeLegend = INDICATOR_DEFS.filter(d => d.category === 'Overlay' && d.id !== 'volume' && indicators.has(d.id));
    const paneLabel = (id, label, ref) => indicators.has(id) && (_jsxs(_Fragment, { children: [_jsx("div", { className: "text-xs text-gray-600 px-1 pt-1", children: label }), _jsx("div", { ref: ref, className: "w-full" })] }));
    return (_jsxs("div", { className: "space-y-0", children: [activeLegend.length > 0 && (_jsx("div", { className: "flex flex-wrap gap-3 text-xs mb-1.5 text-gray-400", children: activeLegend.map(d => (_jsxs("span", { children: [_jsx("span", { style: { color: d.color }, children: "\u2501" }), " ", d.label] }, d.id))) })), _jsx("div", { ref: priceRef, className: "w-full" }), paneLabel('rsi', 'RSI (14)', rsiRef), paneLabel('macd', 'MACD (12,26,9)', macdRef), paneLabel('stoch', 'Stochastic (14,3)', stochRef), paneLabel('aroon', 'Aroon (14)', aroonRef), paneLabel('adx', 'ADX / DI (14)', adxRef), paneLabel('cci', 'CCI (20)', cciRef), paneLabel('atr', 'ATR (14)', atrRef), paneLabel('williamsr', 'Williams %R (14)', williamsrRef), paneLabel('obv', 'OBV', obvRef), paneLabel('bbw', 'BB Width', bbwRef), paneLabel('mfi', 'MFI (14)', mfiRef), paneLabel('roc', 'ROC (14)', rocRef), paneLabel('cmf', 'CMF (20)', cmfRef), _jsx("div", { className: "text-xs text-gray-700 text-right pt-0.5", children: "scroll to zoom \u00B7 drag to pan" })] }));
}
// ── Symbol Detail Modal ────────────────────────────────────────────────────────
function SymbolModal({ symbol, name, onClose }) {
    const [quotes, setQuotes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [indicators, setIndicators] = useState(DEFAULT_INDICATORS);
    const [showPicker, setShowPicker] = useState(false);
    const [fetchingHist, setFetchingHist] = useState(false);
    const [fetchMsg, setFetchMsg] = useState(null);
    const pollRef = useRef(null);
    const loadQuotes = useCallback(() => {
        setLoading(true);
        api.quotes(symbol, 9999).then(q => { setQuotes(q); setLoading(false); });
    }, [symbol]);
    useEffect(() => { loadQuotes(); }, [loadQuotes]);
    // Stop polling once data arrives
    useEffect(() => {
        if (quotes.length > 0 && pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setFetchMsg(null);
        }
    }, [quotes.length]);
    useEffect(() => () => { if (pollRef.current)
        clearInterval(pollRef.current); }, []);
    const handleFetchHistory = async () => {
        setFetchingHist(true);
        setFetchMsg(null);
        try {
            await api.fetchHistory(symbol);
            setFetchMsg('Fetching history… this may take a few seconds.');
            // poll every 3 s until data appears
            pollRef.current = setInterval(loadQuotes, 3000);
        }
        catch {
            setFetchMsg('Request failed — check crawler logs.');
        }
        finally {
            setFetchingHist(false);
        }
    };
    const latest = quotes[quotes.length - 1];
    const prev = quotes[quotes.length - 2];
    const chg = latest && prev ? ((latest.close - prev.close) / prev.close * 100) : null;
    return (_jsx("div", { className: "fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4", onClick: e => { if (e.target === e.currentTarget) {
            setShowPicker(false);
            onClose();
        } }, children: _jsxs("div", { className: "bg-gray-800 rounded-xl p-5 w-full max-w-5xl max-h-[95vh] overflow-y-auto shadow-2xl", children: [_jsxs("div", { className: "flex items-start justify-between mb-4", children: [_jsxs("div", { children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "text-lg font-bold text-white", children: symbol }), latest && _jsx(ChangePct, { v: chg })] }), _jsx("div", { className: "text-xs text-gray-400 mt-0.5 max-w-xs truncate", children: name })] }), _jsxs("div", { className: "flex items-center gap-2 ml-4", children: [_jsxs("button", { onClick: () => setShowPicker(p => !p), className: `flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border transition-colors
                ${showPicker
                                        ? 'bg-blue-900 border-blue-600 text-blue-300'
                                        : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-400'}`, children: [_jsx("span", { children: "\u2295" }), " Ch\u1EC9 b\u00E1o", _jsx("span", { className: "bg-gray-600 text-gray-300 rounded-full px-1.5 text-xs ml-0.5", children: indicators.size })] }), _jsx("button", { onClick: onClose, className: "text-gray-400 hover:text-white", children: "\u2715" })] })] }), showPicker && (_jsx(IndicatorPanel, { active: indicators, onChange: s => setIndicators(new Set(s)), onClose: () => setShowPicker(false) })), latest && (_jsx("div", { className: "grid grid-cols-4 gap-2 mb-4", children: [
                        { label: 'Close', value: fmtPrice(latest.close) },
                        { label: 'Open', value: fmtPrice(latest.open) },
                        { label: 'High', value: fmtPrice(latest.high) },
                        { label: 'Low', value: fmtPrice(latest.low) },
                    ].map(({ label, value }) => (_jsxs("div", { className: "bg-gray-900 rounded p-2.5 text-center", children: [_jsx("div", { className: "text-sm font-bold text-gray-100", children: value }), _jsx("div", { className: "text-xs text-gray-500", children: label })] }, label))) })), _jsxs("div", { className: "text-xs text-gray-500 mb-1", children: [quotes.length, " trading days"] }), loading ? (_jsx("div", { className: "h-48 flex items-center justify-center text-gray-500 text-xs animate-pulse", children: "Loading\u2026" })) : quotes.length < 5 ? (_jsxs("div", { className: "mb-4 bg-gray-900 rounded-lg p-6 flex flex-col items-center gap-3 text-center", children: [_jsxs("div", { className: "text-gray-500 text-xs", children: ["No price history found for ", _jsx("span", { className: "text-gray-300 font-semibold", children: symbol })] }), _jsx("div", { className: "text-gray-600 text-xs", children: "Run \"Full History\" in the Crawl tab, or load just this symbol:" }), _jsx("button", { onClick: handleFetchHistory, disabled: fetchingHist || pollRef.current !== null, className: "px-4 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed\n                         text-white text-xs rounded-lg font-medium transition-colors", children: fetchingHist ? 'Starting…' : pollRef.current ? 'Fetching…' : '↓ Load History for this symbol' }), fetchMsg && (_jsx("div", { className: "text-xs text-blue-400 animate-pulse", children: fetchMsg }))] })) : (_jsx("div", { className: "mb-4 bg-gray-900 rounded-lg p-3", onClick: () => setShowPicker(false), children: _jsx(InteractiveChart, { quotes: quotes, indicators: indicators }) }))] }) }));
}
// ── Tab: Market ───────────────────────────────────────────────────────────────
const EXCHANGES = [
    { value: '', label: 'All', color: 'bg-gray-700 text-gray-200' },
    { value: 'HOSE', label: 'HOSE', color: 'bg-blue-900 text-blue-300' },
    { value: 'HNX', label: 'HNX', color: 'bg-purple-900 text-purple-300' },
    { value: 'UPCOM', label: 'UPCOM', color: 'bg-yellow-900 text-yellow-300' },
];
function ExchangeBadge({ exchange }) {
    const meta = EXCHANGES.find(e => e.value === exchange);
    if (!meta || !exchange)
        return _jsx("span", { className: "text-gray-600 text-xs", children: "\u2014" });
    return _jsx("span", { className: `px-1.5 py-0.5 rounded text-xs font-semibold ${meta.color}`, children: exchange });
}
function MarketTab() {
    const [data, setData] = useState(null);
    const [query, setQuery] = useState('');
    const [exchange, setExchange] = useState('');
    const [offset, setOffset] = useState(0);
    const [detail, setDetail] = useState(null);
    const [loading, setLoading] = useState(false);
    const debounceRef = useRef(null);
    const load = useCallback((q, off, exc) => {
        setLoading(true);
        api.symbols(q, PAGE_SIZE, off, exc, '').then(d => { setData(d); setLoading(false); });
    }, []);
    useEffect(() => { load('', 0, ''); }, [load]);
    const handleSearch = (val) => {
        setQuery(val);
        setOffset(0);
        if (debounceRef.current)
            clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => load(val, 0, exchange), 300);
    };
    const handleExchange = (exc) => {
        setExchange(exc);
        setOffset(0);
        load(query, 0, exc);
    };
    const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
    const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
    return (_jsxs("div", { children: [_jsxs("div", { className: "flex items-center gap-3 mb-4 flex-wrap", children: [_jsx("input", { type: "text", placeholder: "Search symbol or company name\u2026", value: query, onChange: e => handleSearch(e.target.value), className: "bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-gray-100\n                     w-72 focus:outline-none focus:border-green-500 placeholder-gray-500" }), _jsx("div", { className: "flex gap-1.5", children: EXCHANGES.map(exc => (_jsx("button", { onClick: () => handleExchange(exc.value), className: `px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${exchange === exc.value
                                ? `${exc.color} border-current`
                                : 'bg-transparent border-gray-600 text-gray-400 hover:border-gray-400'}`, children: exc.label }, exc.value))) }), data && _jsxs("span", { className: "text-xs text-gray-400", children: [data.total.toLocaleString(), " symbols"] }), loading && _jsx("span", { className: "text-xs text-gray-500 animate-pulse", children: "Loading\u2026" })] }), _jsx("div", { className: "overflow-x-auto rounded-lg border border-gray-700", children: _jsxs("table", { className: "w-full text-xs", children: [_jsx("thead", { className: "bg-gray-800 text-gray-400 uppercase tracking-wider", children: _jsxs("tr", { children: [_jsx("th", { className: "px-4 py-2.5 text-left font-semibold", children: "Symbol" }), _jsx("th", { className: "px-4 py-2.5 text-left font-semibold", children: "Company" }), _jsx("th", { className: "px-4 py-2.5 text-right font-semibold", children: "Close (K\u20AB)" }), _jsx("th", { className: "px-4 py-2.5 text-right font-semibold", children: "Change" }), _jsx("th", { className: "px-4 py-2.5 text-right font-semibold", children: "Volume" }), _jsx("th", { className: "px-4 py-2.5 text-center font-semibold", children: "Trend" }), _jsx("th", { className: "px-4 py-2.5 text-left font-semibold", children: "Date" })] }) }), _jsxs("tbody", { children: [data?.items.length === 0 && (_jsx("tr", { children: _jsx("td", { colSpan: 7, className: "px-4 py-10 text-center text-gray-500", children: "No symbols found" }) })), data?.items.map(row => (_jsxs("tr", { className: "border-t border-gray-700/50 hover:bg-gray-800/60 cursor-pointer transition-colors", onClick: () => setDetail(row), children: [_jsx("td", { className: "px-4 py-2.5", children: _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "font-bold text-green-400", children: row.symbol }), _jsx(ExchangeBadge, { exchange: row.exchange })] }) }), _jsx("td", { className: "px-4 py-2.5 max-w-[220px]", children: _jsx("span", { className: "text-gray-200 truncate block", title: row.name, children: row.name }) }), _jsx("td", { className: "px-4 py-2.5 text-right font-medium text-gray-100 tabular-nums", children: fmtPrice(row.close) }), _jsx("td", { className: "px-4 py-2.5 text-right", children: _jsx(ChangePct, { v: row.change_pct }) }), _jsx("td", { className: "px-4 py-2.5 text-right text-gray-400 tabular-nums", children: fmtVol(row.volume) }), _jsx("td", { className: "px-4 py-2.5 text-center", children: row.close != null
                                                ? _jsx(Sparkline, { prices: [row.prev_close ?? row.close, row.close] })
                                                : _jsx("span", { className: "text-gray-600", children: "\u2014" }) }), _jsx("td", { className: "px-4 py-2.5 text-gray-500 whitespace-nowrap", children: row.latest_date ?? '—' })] }, row.symbol)))] })] }) }), totalPages > 1 && (_jsxs("div", { className: "flex items-center justify-between mt-3 text-xs text-gray-400", children: [_jsxs("span", { children: ["Page ", currentPage, " of ", totalPages] }), _jsxs("div", { className: "flex gap-1.5", children: [_jsx("button", { disabled: offset === 0, onClick: () => { const o = Math.max(0, offset - PAGE_SIZE); setOffset(o); load(query, o, exchange); }, className: "px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed", children: "\u2190 Prev" }), _jsx("button", { disabled: offset + PAGE_SIZE >= (data?.total ?? 0), onClick: () => { const o = offset + PAGE_SIZE; setOffset(o); load(query, o, exchange); }, className: "px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed", children: "Next \u2192" })] })] })), detail && (_jsx(SymbolModal, { symbol: detail.symbol, name: detail.name, onClose: () => setDetail(null) }))] }));
}
// ── Tab: Crawl ────────────────────────────────────────────────────────────────
function CrawlTab({ crawlStatus, isRunning, onRefresh }) {
    const [selectedDate, setSelectedDate] = useState(yesterday);
    const [selectedJobs, setSelectedJobs] = useState(['symbols', 'quotes', 'foreign', 'news']);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [toast, setToast] = useState(null);
    // Incremental update
    const [updateInfo, setUpdateInfo] = useState(null);
    const [updateLoading, setUpdateLoading] = useState(false);
    const [updateError, setUpdateError] = useState(null);
    const [updateToast, setUpdateToast] = useState(null);
    // Symbol-specific crawl
    const [symbolInput, setSymbolInput] = useState('');
    const [symSubmitting, setSymSubmitting] = useState(false);
    const [symError, setSymError] = useState(null);
    const [symToast, setSymToast] = useState(null);
    const toggleJob = (job) => setSelectedJobs(prev => prev.includes(job) ? prev.filter(j => j !== job) : [...prev, job]);
    const loadUpdateInfo = useCallback(async () => {
        try {
            setUpdateInfo(await api.updateInfo());
        }
        catch { /* ignore */ }
    }, []);
    useEffect(() => { loadUpdateInfo(); }, [loadUpdateInfo]);
    const handleUpdate = async () => {
        setUpdateLoading(true);
        setUpdateError(null);
        try {
            await api.triggerUpdate();
            setUpdateToast('Update started — fetching new trading days…');
            setTimeout(() => setUpdateToast(null), 5000);
            onRefresh();
        }
        catch (e) {
            setUpdateError(e instanceof Error ? e.message : 'Request failed');
        }
        finally {
            setUpdateLoading(false);
        }
    };
    const handleSymbolCrawl = async () => {
        const sym = symbolInput.trim().toUpperCase();
        if (!sym)
            return;
        setSymSubmitting(true);
        setSymError(null);
        setSymToast(null);
        try {
            await api.crawlSymbol(sym);
            setSymToast(`Crawl started for ${sym} — history + fundamentals`);
            setTimeout(() => setSymToast(null), 5000);
            onRefresh();
        }
        catch (e) {
            setSymError(e instanceof Error ? e.message : 'Request failed');
        }
        finally {
            setSymSubmitting(false);
        }
    };
    const handleCrawl = async () => {
        if (!selectedDate || selectedJobs.length === 0)
            return;
        setSubmitting(true);
        setError(null);
        try {
            await api.crawl(selectedDate, selectedJobs);
            setToast(`Crawl started for ${selectedDate}`);
            setTimeout(() => setToast(null), 3000);
            onRefresh();
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Request failed');
        }
        finally {
            setSubmitting(false);
        }
    };
    return (_jsxs("div", { className: "space-y-5", children: [_jsxs("div", { className: "bg-gray-800 rounded-lg p-5 border border-gray-700", children: [_jsxs("div", { className: "flex items-center justify-between flex-wrap gap-3", children: [_jsxs("div", { children: [_jsx("h2", { className: "font-bold text-gray-200", children: "Sync to Today" }), updateInfo && !updateInfo.up_to_date && (_jsxs("p", { className: "text-xs text-gray-400 mt-0.5", children: ["Will fetch\u00A0", _jsx("span", { className: "text-green-400 font-semibold", children: updateInfo.from_date }), "\u00A0\u2192\u00A0", _jsx("span", { className: "text-green-400 font-semibold", children: updateInfo.to_date }), "\u00A0for all HOSE / HNX / UPCOM symbols"] })), updateInfo?.up_to_date && (_jsxs("p", { className: "text-xs text-green-500 mt-0.5", children: ["\u2713 Already up to date (latest: ", updateInfo.latest_date, ")"] })), !updateInfo && (_jsx("p", { className: "text-xs text-gray-600 mt-0.5", children: "Checking latest date\u2026" }))] }), _jsx("button", { onClick: handleUpdate, disabled: isRunning || updateLoading || updateInfo?.up_to_date === true, className: "px-5 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold\n                       text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap", children: updateLoading ? 'Starting…' : isRunning ? 'Crawl Running…' : '↑ Update Now' })] }), updateError && (_jsx("div", { className: "mt-3 bg-red-950 border border-red-800 rounded px-3 py-2 text-red-400 text-xs", children: updateError }))] }), updateToast && (_jsxs("div", { className: "fixed bottom-6 right-6 bg-blue-800 text-blue-100 px-4 py-2.5 rounded-lg shadow-xl text-sm font-medium z-50", children: ["\u2191 ", updateToast] })), isRunning && crawlStatus && (_jsxs("div", { className: "bg-cyan-950 border border-cyan-700 rounded-lg px-5 py-4", children: [_jsxs("div", { className: "flex items-center gap-2 mb-2", children: [_jsx("div", { className: "w-2 h-2 rounded-full bg-cyan-400 animate-pulse" }), _jsx("span", { className: "font-semibold text-cyan-300", children: "Crawl in progress" })] }), _jsxs("div", { className: "text-xs text-gray-300 space-y-1", children: [_jsxs("div", { children: [_jsx("span", { className: "text-gray-500", children: "Date: " }), crawlStatus.date] }), _jsxs("div", { children: [_jsx("span", { className: "text-gray-500", children: "Jobs: " }), crawlStatus.jobs.join(', ')] }), _jsxs("div", { children: [_jsx("span", { className: "text-gray-500", children: "Started: " }), fmtDate(crawlStatus.started_at)] })] }), _jsx("div", { className: "mt-3 h-1 bg-gray-700 rounded-full overflow-hidden", children: _jsx("div", { className: "h-1 bg-cyan-500 rounded-full w-2/5", style: { animation: 'pulse 1.5s ease-in-out infinite' } }) })] })), _jsxs("div", { className: "bg-gray-800 rounded-lg p-5 border border-gray-700 space-y-4", children: [_jsx("h2", { className: "font-bold text-gray-200", children: "Trigger Crawl" }), _jsxs("div", { children: [_jsx("label", { className: "block text-xs text-gray-400 mb-1", children: "Target Date" }), _jsx("input", { type: "date", value: selectedDate, max: new Date().toISOString().slice(0, 10), onChange: e => setSelectedDate(e.target.value), className: "bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-gray-100\n                       focus:outline-none focus:border-green-500 w-48" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-xs text-gray-400 mb-2", children: "Data to Fetch" }), _jsx("div", { className: "flex flex-wrap gap-2", children: ALL_JOBS.map(job => {
                                    const on = selectedJobs.includes(job);
                                    return (_jsxs("button", { type: "button", onClick: () => toggleJob(job), className: `px-3 py-1.5 rounded-full text-xs font-medium border transition-colors
                    ${on ? 'bg-green-900 border-green-600 text-green-300'
                                            : 'bg-gray-700 border-gray-600 text-gray-400 hover:border-gray-500'}`, children: [on ? '✓ ' : '', JOB_LABELS[job]] }, job));
                                }) }), _jsx("p", { className: "text-xs text-gray-600 mt-1.5", children: "Fundamentals makes ~1100 API calls and takes several minutes." })] }), error && _jsx("div", { className: "bg-red-950 border border-red-800 rounded px-3 py-2 text-red-400 text-xs", children: error }), _jsx("button", { onClick: handleCrawl, disabled: isRunning || submitting || selectedJobs.length === 0 || !selectedDate, className: "px-5 py-2 rounded bg-green-600 hover:bg-green-500 text-white font-semibold\n                     text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed", children: submitting ? 'Starting…' : isRunning ? 'Crawl Running…' : '▶ Start Crawl' })] }), toast && (_jsxs("div", { className: "fixed bottom-6 right-6 bg-green-800 text-green-100 px-4 py-2.5 rounded-lg shadow-xl text-sm font-medium z-50", children: ["\u2713 ", toast] })), _jsxs("div", { className: "bg-gray-800 rounded-lg p-5 border border-gray-700 space-y-4", children: [_jsxs("div", { children: [_jsx("h2", { className: "font-bold text-gray-200", children: "Crawl Single Symbol" }), _jsx("p", { className: "text-xs text-gray-500 mt-0.5", children: "Fetch full price history + fundamentals for one ticker." })] }), _jsxs("div", { className: "flex gap-2 items-start", children: [_jsx("div", { className: "flex-1", children: _jsx("input", { type: "text", placeholder: "e.g. VCB", value: symbolInput, maxLength: 10, onChange: e => { setSymbolInput(e.target.value.toUpperCase()); setSymError(null); }, onKeyDown: e => e.key === 'Enter' && handleSymbolCrawl(), className: "w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm\n                         font-bold text-green-400 tracking-widest uppercase\n                         focus:outline-none focus:border-green-500 placeholder-gray-600" }) }), _jsx("button", { onClick: handleSymbolCrawl, disabled: symSubmitting || !symbolInput.trim(), className: "px-5 py-2 rounded bg-green-600 hover:bg-green-500 text-white font-semibold\n                       text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap", children: symSubmitting ? 'Starting…' : '▶ Crawl Symbol' })] }), _jsx("div", { className: "flex flex-wrap gap-2 text-xs text-gray-500", children: ['Price History (all time)', 'Fundamentals'].map(tag => (_jsx("span", { className: "px-2 py-0.5 bg-gray-700 rounded-full", children: tag }, tag))) }), symError && (_jsx("div", { className: "bg-red-950 border border-red-800 rounded px-3 py-2 text-red-400 text-xs", children: symError }))] }), symToast && (_jsxs("div", { className: "fixed bottom-6 right-6 bg-blue-800 text-blue-100 px-4 py-2.5 rounded-lg shadow-xl text-sm font-medium z-50", children: ["\u2713 ", symToast] }))] }));
}
// ── Tab: History ──────────────────────────────────────────────────────────────
function HistoryTab({ runs }) {
    return (_jsx("div", { className: "overflow-x-auto rounded-lg border border-gray-700", children: runs.length === 0
            ? _jsx("div", { className: "px-5 py-10 text-center text-gray-500", children: "No crawl runs yet" })
            : (_jsxs("table", { className: "w-full text-xs", children: [_jsx("thead", { className: "bg-gray-900 text-gray-400 uppercase tracking-wider", children: _jsx("tr", { children: ['Job', 'Date', 'Status', 'Records', 'Started', 'Duration', 'Error'].map(h => (_jsx("th", { className: "px-4 py-2.5 text-left font-semibold whitespace-nowrap", children: h }, h))) }) }), _jsx("tbody", { children: runs.map(run => (_jsxs("tr", { className: "border-t border-gray-700/50 hover:bg-gray-700/30", children: [_jsx("td", { className: "px-4 py-2.5 font-medium text-gray-200 whitespace-nowrap", children: run.job }), _jsx("td", { className: "px-4 py-2.5 text-gray-300 whitespace-nowrap", children: run.run_date }), _jsx("td", { className: "px-4 py-2.5", children: _jsx(StatusBadge, { status: run.status }) }), _jsx("td", { className: "px-4 py-2.5 text-gray-300 tabular-nums", children: run.records.toLocaleString() }), _jsx("td", { className: "px-4 py-2.5 text-gray-500 whitespace-nowrap", children: fmtDate(run.started_at) }), _jsx("td", { className: "px-4 py-2.5 text-gray-400 tabular-nums whitespace-nowrap", children: duration(run.started_at, run.finished_at) }), _jsx("td", { className: "px-4 py-2.5 text-red-400 max-w-xs truncate", title: run.error ?? '', children: run.error ?? '' })] }, run.id))) })] })) }));
}
function VnBoardTab() {
    const [activeIndex, setActiveIndex] = useState('vn30');
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [detail, setDetail] = useState(null);
    const [sortKey, setSortKey] = useState('change_pct');
    const [sortAsc, setSortAsc] = useState(false);
    const idx = VN_INDICES[activeIndex];
    const load = useCallback((key) => {
        const ix = VN_INDICES[key];
        setLoading(true);
        api.symbols('', ix.symbols.length, 0, '', ix.symbols.join(',')).then(d => {
            setData(d);
            setLoading(false);
        });
    }, []);
    useEffect(() => { load(activeIndex); }, [load, activeIndex]);
    const handleIndex = (key) => {
        setActiveIndex(key);
        setData(null);
    };
    const handleSort = (key) => {
        if (sortKey === key)
            setSortAsc(a => !a);
        else {
            setSortKey(key);
            setSortAsc(key === 'symbol');
        }
    };
    const sorted = useMemo(() => {
        if (!data)
            return [];
        return [...data.items].sort((a, b) => {
            const av = a[sortKey] ?? (sortAsc ? Infinity : -Infinity);
            const bv = b[sortKey] ?? (sortAsc ? Infinity : -Infinity);
            if (typeof av === 'string' && typeof bv === 'string')
                return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
            return sortAsc ? av - bv : bv - av;
        });
    }, [data, sortKey, sortAsc]);
    // Market breadth
    const advances = sorted.filter(r => (r.change_pct ?? 0) > 0).length;
    const declines = sorted.filter(r => (r.change_pct ?? 0) < 0).length;
    const unchanged = sorted.filter(r => r.change_pct != null && r.change_pct === 0).length;
    const noData = sorted.filter(r => r.change_pct == null).length;
    const SortTh = ({ col, label, right }) => (_jsxs("th", { className: `px-3 py-2.5 font-semibold cursor-pointer select-none whitespace-nowrap hover:text-gray-200 transition-colors ${right ? 'text-right' : 'text-left'}`, onClick: () => handleSort(col), children: [label, sortKey === col && _jsx("span", { className: "ml-1 text-blue-400", children: sortAsc ? '↑' : '↓' })] }));
    return (_jsxs("div", { className: "space-y-4", children: [_jsx("div", { className: "grid grid-cols-2 sm:grid-cols-4 gap-3", children: Object.keys(VN_INDICES).map(key => {
                    const ix = VN_INDICES[key];
                    const active = key === activeIndex;
                    return (_jsxs("button", { onClick: () => handleIndex(key), className: `rounded-xl p-4 text-left border-2 transition-all ${active
                            ? 'border-current shadow-lg scale-[1.02]'
                            : 'border-gray-700 hover:border-gray-500 bg-gray-800/50'}`, style: active ? { borderColor: ix.color, background: `${ix.color}18` } : {}, children: [_jsx("div", { className: "font-bold text-sm", style: active ? { color: ix.color } : { color: '#9ca3af' }, children: ix.label }), _jsxs("div", { className: "text-xs text-gray-500 mt-0.5", children: [ix.symbols.length, " stocks"] })] }, key));
                }) }), data && !loading && (_jsxs("div", { className: "bg-gray-800 rounded-lg px-4 py-3 flex items-center gap-6 flex-wrap", children: [_jsxs("span", { className: "text-xs font-bold text-gray-300", children: [idx.label, " \u2014 market breadth"] }), _jsxs("div", { className: "flex items-center gap-1.5", children: [_jsx("div", { className: "h-2 rounded-full", style: { width: `${Math.max(advances * 3, 4)}px`, background: '#4ade80' } }), _jsxs("span", { className: "text-xs text-green-400 font-semibold", children: ["\u25B2 ", advances] })] }), _jsxs("div", { className: "flex items-center gap-1.5", children: [_jsx("div", { className: "h-2 rounded-full", style: { width: `${Math.max(declines * 3, 4)}px`, background: '#f87171' } }), _jsxs("span", { className: "text-xs text-red-400 font-semibold", children: ["\u25BC ", declines] })] }), unchanged > 0 && _jsxs("span", { className: "text-xs text-gray-400", children: ["= ", unchanged] }), noData > 0 && _jsxs("span", { className: "text-xs text-gray-600", children: ["no data: ", noData] }), _jsx("span", { className: "text-xs text-gray-600 ml-auto", children: "click column header to sort" })] })), loading && (_jsxs("div", { className: "text-center py-12 text-gray-500 text-sm animate-pulse", children: ["Loading ", idx.label, "\u2026"] })), !loading && data && (_jsx("div", { className: "overflow-x-auto rounded-lg border border-gray-700", children: _jsxs("table", { className: "w-full text-xs", children: [_jsx("thead", { className: "bg-gray-800 text-gray-400 uppercase tracking-wider", children: _jsxs("tr", { children: [_jsx(SortTh, { col: "symbol", label: "Symbol" }), _jsx("th", { className: "px-3 py-2.5 text-left font-semibold", children: "Company" }), _jsx("th", { className: "px-3 py-2.5 text-center font-semibold", children: "Exch" }), _jsx(SortTh, { col: "close", label: "Close (K\u20AB)", right: true }), _jsx(SortTh, { col: "change_pct", label: "Change", right: true }), _jsx(SortTh, { col: "volume", label: "Volume", right: true }), _jsx("th", { className: "px-3 py-2.5 text-center font-semibold", children: "Trend" }), _jsx("th", { className: "px-3 py-2.5 text-left font-semibold", children: "Date" })] }) }), _jsxs("tbody", { children: [sorted.length === 0 && (_jsx("tr", { children: _jsx("td", { colSpan: 8, className: "px-4 py-10 text-center text-gray-500", children: "No data \u2014 run a crawl first to populate prices" }) })), sorted.map(row => {
                                    const chgPct = row.change_pct ?? 0;
                                    const hasPct = row.change_pct != null;
                                    const rowBg = !hasPct ? '' : chgPct > 2 ? 'bg-green-950/30' : chgPct > 0 ? 'bg-green-950/15' : chgPct < -2 ? 'bg-red-950/30' : chgPct < 0 ? 'bg-red-950/15' : '';
                                    return (_jsxs("tr", { className: `border-t border-gray-700/50 hover:bg-gray-700/40 cursor-pointer transition-colors ${rowBg}`, onClick: () => setDetail(row), children: [_jsx("td", { className: "px-3 py-2.5", children: _jsx("span", { className: "font-bold text-green-400 tracking-wide", children: row.symbol }) }), _jsx("td", { className: "px-3 py-2.5 max-w-[180px]", children: _jsx("span", { className: "text-gray-300 truncate block", title: row.name, children: row.name }) }), _jsx("td", { className: "px-3 py-2.5 text-center", children: _jsx(ExchangeBadge, { exchange: row.exchange }) }), _jsx("td", { className: "px-3 py-2.5 text-right font-medium text-gray-100 tabular-nums", children: fmtPrice(row.close) }), _jsx("td", { className: "px-3 py-2.5 text-right", children: hasPct ? (_jsxs("span", { className: `font-bold tabular-nums px-2 py-0.5 rounded text-xs ${chgPct > 0 ? 'bg-green-900/60 text-green-300'
                                                        : chgPct < 0 ? 'bg-red-900/60 text-red-300'
                                                            : 'bg-gray-700 text-gray-400'}`, children: [chgPct > 0 ? '+' : '', chgPct.toFixed(2), "%"] })) : _jsx("span", { className: "text-gray-600", children: "\u2014" }) }), _jsx("td", { className: "px-3 py-2.5 text-right text-gray-400 tabular-nums", children: fmtVol(row.volume) }), _jsx("td", { className: "px-3 py-2.5 text-center", children: row.close != null
                                                    ? _jsx(Sparkline, { prices: [row.prev_close ?? row.close, row.close] })
                                                    : _jsx("span", { className: "text-gray-600", children: "\u2014" }) }), _jsx("td", { className: "px-3 py-2.5 text-gray-500 whitespace-nowrap", children: row.latest_date ?? '—' })] }, row.symbol));
                                })] })] }) })), _jsx("p", { className: "text-xs text-gray-700 text-right", children: "Index constituents are approximate \u2014 HOSE rebalances quarterly." }), detail && (_jsx(SymbolModal, { symbol: detail.symbol, name: detail.name, onClose: () => setDetail(null) }))] }));
}
// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
    const [stats, setStats] = useState(null);
    const [crawlStatus, setCrawlStatus] = useState(null);
    const [runs, setRuns] = useState([]);
    const [activeTab, setActiveTab] = useState('market');
    const intervalRef = useRef(null);
    const refresh = useCallback(async () => {
        try {
            const [s, cs, r] = await Promise.all([api.stats(), api.status(), api.runs()]);
            setStats(s);
            setCrawlStatus(cs);
            setRuns(r);
        }
        catch { /* backend starting */ }
    }, []);
    useEffect(() => {
        refresh();
        const running = crawlStatus?.running ?? false;
        if (intervalRef.current)
            clearInterval(intervalRef.current);
        intervalRef.current = setInterval(refresh, running ? 2000 : 8000);
        return () => { if (intervalRef.current)
            clearInterval(intervalRef.current); };
    }, [refresh, crawlStatus?.running]);
    const isRunning = crawlStatus?.running ?? false;
    const TABS = [
        { id: 'market', label: '📈 Market' },
        { id: 'board', label: '📊 VN Board' },
        { id: 'crawl', label: isRunning ? '⏳ Crawl' : '▶ Crawl' },
        { id: 'history', label: '📋 History' },
    ];
    return (_jsxs("div", { className: "min-h-screen bg-gray-900 text-gray-100 text-sm", style: { fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace" }, children: [_jsxs("header", { className: "bg-gray-800 border-b border-gray-700 px-6 py-3 flex items-center justify-between sticky top-0 z-20", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "text-green-400 font-bold text-base", children: "\uD83D\uDCC8 Stock Analytics" }), _jsx("span", { className: `px-2 py-0.5 rounded-full text-xs font-semibold ${isRunning ? 'bg-cyan-900 text-cyan-300 animate-pulse' : 'bg-gray-700 text-gray-400'}`, children: isRunning ? 'crawling…' : 'idle' })] }), _jsx("span", { className: "text-xs text-gray-500", children: "Vietnam Stock Market \u00B7 vnstock" })] }), _jsxs("div", { className: "px-6 py-3 flex gap-3 flex-wrap border-b border-gray-700", children: [_jsx(StatCard, { label: "Listed Symbols", value: stats?.total_symbols.toLocaleString() ?? '—', accent: "text-blue-400" }), _jsx(StatCard, { label: "Price Records", value: stats?.total_quotes.toLocaleString() ?? '—', accent: "text-purple-400" }), _jsx(StatCard, { label: "Latest Date", value: stats?.latest_date ?? '—', accent: "text-green-400" }), _jsx(StatCard, { label: "Last Crawl", value: stats?.last_run?.status ?? '—', accent: stats?.last_run?.status === 'done' ? 'text-green-400' : 'text-yellow-400' })] }), _jsx("div", { className: "px-6 flex border-b border-gray-700 bg-gray-900 sticky top-14 z-10", children: TABS.map(tab => (_jsx("button", { onClick: () => setActiveTab(tab.id), className: `px-5 py-3 text-sm font-medium border-b-2 transition-colors cursor-pointer ${activeTab === tab.id
                        ? 'border-green-500 text-green-400'
                        : 'border-transparent text-gray-400 hover:text-gray-200'}`, children: tab.label }, tab.id))) }), _jsxs("main", { className: "px-6 py-5 max-w-screen-xl mx-auto", children: [activeTab === 'market' && _jsx(MarketTab, {}), activeTab === 'board' && _jsx(VnBoardTab, {}), activeTab === 'crawl' && _jsx(CrawlTab, { crawlStatus: crawlStatus, isRunning: isRunning, onRefresh: refresh }), activeTab === 'history' && _jsx(HistoryTab, { runs: runs })] })] }));
}
