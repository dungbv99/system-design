import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from 'react';
import { createChart, CrosshairMode, ColorType, LineStyle, } from 'lightweight-charts';
import { api } from '../api';
import { fmtPrice } from '../utils';
import { DEFAULT_INDICATORS } from '../indicators/defs';
import { InteractiveChart } from '../components/InteractiveChart';
// ── Regime styling ────────────────────────────────────────────────────────────
const REGIME_META = {
    PREMIUM: { label: 'PREMIUM', bg: 'bg-emerald-950', text: 'text-emerald-300', border: 'border-emerald-600', color: '#34d399' },
    DISCOUNT: { label: 'DISCOUNT', bg: 'bg-red-950', text: 'text-red-300', border: 'border-red-700', color: '#f87171' },
    NEUTRAL: { label: 'NEUTRAL', bg: 'bg-[#21262d]', text: 'text-[#8b949e]', border: 'border-[#30363d]', color: '#8b949e' },
};
function RegimeBadge({ regime }) {
    const m = REGIME_META[regime ?? 'NEUTRAL'] ?? REGIME_META.NEUTRAL;
    return (_jsx("span", { className: `inline-flex items-center px-2 py-0.5 rounded border text-xs font-bold ${m.bg} ${m.text} ${m.border}`, children: m.label }));
}
// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent }) {
    return (_jsxs("div", { className: "flex-1 min-w-[140px] rounded-xl p-3 border-2 bg-[#161b22] border-[#30363d]", children: [_jsx("div", { className: `text-lg font-bold tabular-nums ${accent ?? 'text-[#e6edf3]'}`, children: value }), _jsxs("div", { className: "text-xs mt-0.5 font-semibold text-[#8b949e] flex items-center gap-1.5", children: [label, sub] })] }));
}
// ── Basis trend chart (baseline at 0, green above / red below) ────────────────
function BasisChart({ rows }) {
    const ref = useRef(null);
    useEffect(() => {
        if (!ref.current || rows.length < 2)
            return;
        const chart = createChart(ref.current, {
            layout: { background: { type: ColorType.Solid, color: '#0d1117' }, textColor: '#8b949e' },
            grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
            rightPriceScale: { borderColor: '#30363d' },
            timeScale: { borderColor: '#30363d', timeVisible: false },
            crosshair: { mode: CrosshairMode.Normal },
            height: 260,
        });
        const series = chart.addBaselineSeries({
            baseValue: { type: 'price', price: 0 },
            topLineColor: '#34d399',
            topFillColor1: 'rgba(52,211,153,0.20)',
            topFillColor2: 'rgba(52,211,153,0.02)',
            bottomLineColor: '#f87171',
            bottomFillColor1: 'rgba(248,113,113,0.02)',
            bottomFillColor2: 'rgba(248,113,113,0.20)',
            lineWidth: 2,
            priceLineVisible: false,
        });
        series.setData(rows.flatMap(r => r.basis == null ? [] : [{ time: r.date, value: r.basis }]));
        series.createPriceLine({ price: 0, color: '#6e7681', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'fair' });
        chart.timeScale().fitContent();
        const ro = new ResizeObserver(() => {
            const w = ref.current?.clientWidth;
            if (w)
                chart.applyOptions({ width: w });
        });
        ro.observe(ref.current);
        return () => { ro.disconnect(); chart.remove(); };
    }, [rows]);
    if (rows.length < 2)
        return (_jsx("div", { className: "text-[#8b949e] text-xs py-8 text-center", children: "No basis data yet \u2014 run \"\u27F3 Recalculate\" to crawl VN30 derivatives." }));
    return _jsx("div", { ref: ref, className: "w-full" });
}
// ── Open Interest bar chart (only rendered when data exists) ──────────────────
function OiChart({ rows }) {
    const ref = useRef(null);
    useEffect(() => {
        if (!ref.current || rows.length < 2)
            return;
        const chart = createChart(ref.current, {
            layout: { background: { type: ColorType.Solid, color: '#0d1117' }, textColor: '#8b949e' },
            grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
            rightPriceScale: { borderColor: '#30363d' },
            timeScale: { borderColor: '#30363d' },
            height: 180,
        });
        const hist = chart.addHistogramSeries({ color: '#58a6ff', priceLineVisible: false });
        hist.setData(rows.flatMap(r => r.open_interest == null ? [] : [{
                time: r.date, value: r.open_interest,
                color: (r.oi_change ?? 0) >= 0 ? '#34d39980' : '#f8717180',
            }]));
        chart.timeScale().fitContent();
        const ro = new ResizeObserver(() => {
            const w = ref.current?.clientWidth;
            if (w)
                chart.applyOptions({ width: w });
        });
        ro.observe(ref.current);
        return () => { ro.disconnect(); chart.remove(); };
    }, [rows]);
    return _jsx("div", { ref: ref, className: "w-full" });
}
// ── Price timeframe selector + intraday chart ─────────────────────────────────
const TF_OPTS = [
    { id: '1', label: '1m', days: 10 }, // ~1+ week of sessions
    { id: '5', label: '5m', days: 45 }, // ~1.5 months
    { id: '15', label: '15m', days: 120 }, // ~4 months
    { id: '1H', label: '1h', days: 250 }, // ~1 year
    { id: '1D', label: '1D', days: 0 },
];
const POLL_MS = 15000; // refresh intraday ~every 15s during the session
/** Candlestick + volume + MA20 chart for live intraday bars (Entrade). */
function IntradayChart({ symbol, tf, days }) {
    const ref = useRef(null);
    const [bars, setBars] = useState([]);
    const [loading, setLoading] = useState(true);
    const load = useCallback(() => {
        api.derivativesIntraday(symbol, tf, days)
            .then(b => { setBars(b); setLoading(false); })
            .catch(() => setLoading(false));
    }, [symbol, tf, days]);
    useEffect(() => {
        setLoading(true);
        setBars([]);
        load();
        const id = setInterval(load, POLL_MS);
        return () => clearInterval(id);
    }, [load]);
    useEffect(() => {
        if (!ref.current || bars.length < 2)
            return;
        const chart = createChart(ref.current, {
            layout: { background: { type: ColorType.Solid, color: '#0d1117' }, textColor: '#8b949e' },
            grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
            rightPriceScale: { borderColor: '#30363d' },
            timeScale: { borderColor: '#30363d', timeVisible: true, secondsVisible: false },
            crosshair: { mode: CrosshairMode.Normal },
            height: 460,
        });
        const candle = chart.addCandlestickSeries({
            upColor: '#34d399', downColor: '#f87171',
            borderUpColor: '#34d399', borderDownColor: '#f87171',
            wickUpColor: '#34d399', wickDownColor: '#f87171',
        });
        candle.setData(bars.map(b => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })));
        const vol = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol', priceLineVisible: false, lastValueVisible: false });
        chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
        vol.setData(bars.map(b => ({ time: b.time, value: b.volume, color: b.close >= b.open ? '#15803d60' : '#b91c1c60' })));
        const closes = bars.map(b => b.close);
        const ma = closes.map((_, i) => i < 19 ? null : closes.slice(i - 19, i + 1).reduce((a, c) => a + c, 0) / 20);
        const maS = chart.addLineSeries({ color: '#facc15', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
        maS.setData(ma.flatMap((v, i) => v == null ? [] : [{ time: bars[i].time, value: v }]));
        chart.timeScale().fitContent();
        const ro = new ResizeObserver(() => { const w = ref.current?.clientWidth; if (w)
            chart.applyOptions({ width: w }); });
        ro.observe(ref.current);
        return () => { ro.disconnect(); chart.remove(); };
    }, [bars]);
    if (loading && bars.length === 0)
        return _jsxs("div", { className: "text-[#8b949e] text-xs py-12 text-center animate-pulse", children: ["Loading ", symbol, " intraday\u2026"] });
    if (bars.length < 2)
        return _jsx("div", { className: "text-[#8b949e] text-xs py-12 text-center", children: "No intraday bars (market may be closed)." });
    return (_jsxs(_Fragment, { children: [_jsx("div", { ref: ref, className: "w-full" }), _jsxs("div", { className: "text-[10px] text-[#8b949e]/50 text-right pt-1", children: [_jsx("span", { className: "text-emerald-400", children: "\u25CF" }), " live \u00B7 auto-refresh ", POLL_MS / 1000, "s \u00B7 MA20 \u2501 \u00B7 scroll to zoom"] })] }));
}
// ── Wyckoff signal card ───────────────────────────────────────────────────────
const WY_SIGNAL = {
    BUY: { bg: 'bg-emerald-950', text: 'text-emerald-300', border: 'border-emerald-600' },
    SHORT: { bg: 'bg-red-950', text: 'text-red-300', border: 'border-red-600' },
    HOLD: { bg: 'bg-blue-950', text: 'text-blue-300', border: 'border-blue-600' },
    WAIT: { bg: 'bg-[#21262d]', text: 'text-[#8b949e]', border: 'border-[#30363d]' },
};
const PHASE_COLOR = {
    Accumulation: '#22d3ee', Distribution: '#fb923c', Markup: '#34d399', Markdown: '#f87171',
};
function WyckoffCard({ w }) {
    if (!w)
        return _jsx(EmptyCard, { label: "Wyckoff" });
    const sig = WY_SIGNAL[w.signal] ?? WY_SIGNAL.WAIT;
    const pCol = PHASE_COLOR[w.phase] ?? '#8b949e';
    const cells = [
        { label: '▶ Best Buy', value: w.entry_price, color: 'text-emerald-300', bg: 'bg-emerald-950/40 border-emerald-800' },
        { label: '✕ Stop Loss', value: w.stop_loss, color: 'text-red-300', bg: 'bg-red-950/40 border-red-800' },
        { label: 'Support', value: w.support, color: 'text-emerald-400', bg: 'bg-[#0d1117] border-[#30363d]' },
        { label: 'Resistance', value: w.resistance, color: 'text-red-400', bg: 'bg-[#0d1117] border-[#30363d]' },
    ];
    return (_jsxs("div", { className: "bg-[#0d1117] border border-[#30363d] rounded-lg p-4 space-y-3", children: [_jsx("div", { className: "text-xs text-[#8b949e] font-semibold uppercase tracking-wider", children: "Wyckoff \u00B7 VN30F1M" }), _jsxs("div", { className: "flex items-center gap-3 flex-wrap", children: [_jsxs("span", { className: `inline-flex items-center px-3 py-1 rounded-lg border text-sm font-bold ${sig.bg} ${sig.text} ${sig.border}`, children: [w.signal, " \u00B7 ", w.signal_strength] }), _jsxs("span", { className: "text-sm font-semibold", style: { color: pCol }, children: [w.phase, w.sub_phase !== '-' && _jsxs("span", { className: "ml-1 font-bold", children: ["Phase ", w.sub_phase] })] }), w.last_event && (_jsx("span", { className: "text-xs px-2 py-0.5 rounded border border-[#30363d] bg-[#21262d] text-[#e6edf3]", children: w.last_event }))] }), _jsx("div", { className: "grid grid-cols-2 sm:grid-cols-4 gap-2", children: cells.map(c => (_jsxs("div", { className: `border rounded-lg p-2 text-center ${c.bg}`, children: [_jsx("div", { className: `text-sm font-bold tabular-nums ${c.color}`, children: c.value != null ? fmtPrice(c.value) : '—' }), _jsx("div", { className: "text-[11px] text-[#8b949e]", children: c.label })] }, c.label))) }), w.description && (_jsx("div", { className: "text-xs text-[#8b949e] bg-[#161b22] border border-[#30363d] rounded-lg p-3 leading-relaxed", children: w.description }))] }));
}
// ── Multi-factor score card ───────────────────────────────────────────────────
const MF_SIGNAL = {
    BUY: { bg: 'bg-emerald-950', text: 'text-emerald-300', border: 'border-emerald-600' },
    WATCH: { bg: 'bg-amber-950', text: 'text-amber-300', border: 'border-amber-600' },
    AVOID: { bg: 'bg-red-950', text: 'text-red-300', border: 'border-red-700' },
};
function FactorCell({ label, value, reason, color }) {
    const pct = Math.max(0, Math.min(100, (value / 25) * 100));
    return (_jsxs("div", { className: "bg-[#161b22] border border-[#30363d] rounded-lg p-2", title: reason, children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-[11px] font-semibold", style: { color }, children: label }), _jsxs("span", { className: "text-[11px] font-bold tabular-nums text-[#e6edf3]", children: [value, _jsx("span", { className: "text-[#8b949e]/50", children: "/25" })] })] }), _jsx("div", { className: "h-1.5 rounded-full bg-[#21262d] overflow-hidden mt-1", children: _jsx("div", { className: "h-full rounded-full", style: { width: `${pct}%`, background: color } }) })] }));
}
function MultifactorCard({ m }) {
    if (!m)
        return _jsx(EmptyCard, { label: "Multi-factor" });
    const sig = MF_SIGNAL[m.signal] ?? MF_SIGNAL.WATCH;
    const scoreColor = m.total_score >= 70 ? '#34d399' : m.total_score >= 55 ? '#a3e635' : m.total_score >= 40 ? '#f59e0b' : '#f87171';
    return (_jsxs("div", { className: "bg-[#0d1117] border border-[#30363d] rounded-lg p-4 space-y-3", children: [_jsx("div", { className: "text-xs text-[#8b949e] font-semibold uppercase tracking-wider", children: "Multi-factor \u00B7 VN30F1M" }), _jsxs("div", { className: "flex items-center gap-3 flex-wrap", children: [_jsxs("span", { className: `inline-flex items-center px-3 py-1 rounded-lg border text-sm font-bold ${sig.bg} ${sig.text} ${sig.border}`, children: [m.signal, " \u00B7 ", m.confidence] }), _jsxs("div", { className: "flex-1 min-w-[120px] flex items-center gap-2", children: [_jsx("div", { className: "flex-1 h-2 rounded-full bg-[#21262d] overflow-hidden", children: _jsx("div", { className: "h-full rounded-full", style: { width: `${Math.max(0, Math.min(100, m.total_score))}%`, background: scoreColor } }) }), _jsx("span", { className: "font-bold tabular-nums w-8 text-right", style: { color: scoreColor }, children: m.total_score })] }), _jsxs("span", { className: "text-xs text-[#8b949e]", children: [m.factors_agreed, "/4 agree"] })] }), _jsxs("div", { className: "grid grid-cols-2 sm:grid-cols-4 gap-2", children: [_jsx(FactorCell, { label: "Trend", value: m.trend_score, reason: m.trend_reason, color: "#22d3ee" }), _jsx(FactorCell, { label: "Momentum", value: m.momentum_score, reason: m.momentum_reason, color: "#a855f7" }), _jsx(FactorCell, { label: "Volume", value: m.volume_score, reason: m.volume_reason, color: "#60a5fa" }), _jsx(FactorCell, { label: "Position", value: m.position_score, reason: m.position_reason, color: "#fb923c" })] }), m.description && (_jsx("div", { className: "text-xs text-[#8b949e] bg-[#161b22] border border-[#30363d] rounded-lg p-3 leading-relaxed", children: m.description }))] }));
}
function EmptyCard({ label }) {
    return (_jsxs("div", { className: "bg-[#0d1117] border border-[#30363d] rounded-lg p-4", children: [_jsxs("div", { className: "text-xs text-[#8b949e] font-semibold uppercase tracking-wider mb-2", children: [label, " \u00B7 VN30F1M"] }), _jsxs("div", { className: "text-xs text-[#8b949e] py-6 text-center", children: ["No ", label, " analysis yet \u2014 run \"\u27F3 Recalculate\" to compute it."] })] }));
}
// ── Main tab ──────────────────────────────────────────────────────────────────
export function DerivativesTab() {
    const [summary, setSummary] = useState(null);
    const [quotes, setQuotes] = useState([]);
    const [basis, setBasis] = useState([]);
    const [oi, setOi] = useState([]);
    const [loading, setLoading] = useState(true);
    const [computing, setComputing] = useState(false);
    const [tf, setTf] = useState('1D');
    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [s, q, b, o] = await Promise.all([
                api.derivativesSummary(),
                api.derivativesQuotes('VN30F1M', 9999),
                api.basis(9999),
                api.derivativesOi('VN30F1M', 120).catch(() => []),
            ]);
            setSummary(s);
            setQuotes(q);
            setBasis(b);
            setOi(o);
        }
        finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { load(); }, [load]);
    const handleCompute = async () => {
        setComputing(true);
        try {
            await api.computeDerivatives();
            setTimeout(() => { load(); setComputing(false); }, 12000);
        }
        catch {
            setComputing(false);
        }
    };
    const b = summary?.basis;
    const latest = summary?.quote;
    return (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex gap-3 flex-wrap items-stretch", children: [_jsx(StatCard, { label: "VN30F1M Close", value: latest ? fmtPrice(latest.close) : '—', accent: "text-[#58a6ff]" }), _jsx(StatCard, { label: "Basis (F1M \u2212 VN30)", value: b?.basis != null ? `${b.basis > 0 ? '+' : ''}${fmtPrice(b.basis)}` : '—', accent: b && b.basis != null ? (b.basis >= 0 ? 'text-emerald-400' : 'text-red-400') : undefined, sub: b ? _jsx(RegimeBadge, { regime: b.regime }) : undefined }), _jsx(StatCard, { label: "Basis %", value: b?.basis_pct != null ? `${b.basis_pct > 0 ? '+' : ''}${b.basis_pct.toFixed(2)}%` : '—', accent: b && b.basis_pct != null ? (b.basis_pct >= 0 ? 'text-emerald-400' : 'text-red-400') : undefined }), _jsx(StatCard, { label: "Spread (F1M \u2212 F2M)", value: b?.spread_f1m_f2m != null ? `${b.spread_f1m_f2m > 0 ? '+' : ''}${fmtPrice(b.spread_f1m_f2m)}` : '—' }), _jsx(StatCard, { label: "VN30 Index", value: b?.vn30_close != null ? fmtPrice(b.vn30_close) : '—', accent: "text-purple-400" }), _jsx("button", { onClick: handleCompute, disabled: computing, className: `self-center px-4 py-2 rounded-lg text-xs font-bold border transition-all
            ${computing
                            ? 'bg-cyan-950 border-cyan-700 text-cyan-300 animate-pulse cursor-not-allowed'
                            : 'bg-[#21262d] border-[#30363d] text-[#8b949e] hover:border-[#58a6ff]/50 hover:text-[#e6edf3]'}`, children: computing ? '⏳ Crawling derivatives…' : '⟳ Recalculate' })] }), loading && (_jsx("div", { className: "text-center py-12 text-[#8b949e] text-sm animate-pulse", children: "Loading derivatives\u2026" })), !loading && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "bg-[#0d1117] border border-[#30363d] rounded-lg p-2", children: [_jsxs("div", { className: "flex items-center justify-between px-1 pt-1 pb-2 flex-wrap gap-2", children: [_jsxs("div", { className: "text-xs text-[#8b949e] font-semibold uppercase tracking-wider", children: ["VN30F1M \u2014 ", tf === '1D' ? `daily · ${quotes.length} sessions` : 'intraday (live)'] }), _jsx("div", { className: "flex gap-1", children: TF_OPTS.map(opt => (_jsx("button", { onClick: () => setTf(opt.id), className: `px-2.5 py-1 rounded text-[11px] font-bold border transition-all
                      ${tf === opt.id
                                                ? 'bg-[#58a6ff] text-[#0d1117] border-[#58a6ff]'
                                                : 'bg-[#21262d] text-[#8b949e] border-[#30363d] hover:text-[#e6edf3] hover:border-[#8b949e]/50'}`, children: opt.label }, opt.id))) })] }), tf === '1D'
                                ? (quotes.length >= 5
                                    ? _jsx(InteractiveChart, { quotes: quotes, indicators: DEFAULT_INDICATORS })
                                    : _jsx("div", { className: "text-[#8b949e] text-xs py-8 text-center", children: "No futures price history yet \u2014 run \"\u27F3 Recalculate\"." }))
                                : _jsx(IntradayChart, { symbol: "VN30F1M", tf: tf, days: TF_OPTS.find(o => o.id === tf).days })] }), _jsxs("div", { className: "bg-[#0d1117] border border-[#30363d] rounded-lg p-3", children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsxs("div", { className: "text-xs text-[#8b949e] font-semibold uppercase tracking-wider", children: ["Basis trend (F1M \u2212 VN30) \u00B7 last ", basis.length, " sessions"] }), _jsxs("div", { className: "flex items-center gap-3 text-[11px] text-[#8b949e]", children: [_jsxs("span", { children: [_jsx("span", { className: "text-emerald-400", children: "\u2501" }), " premium"] }), _jsxs("span", { children: [_jsx("span", { className: "text-red-400", children: "\u2501" }), " discount"] })] })] }), _jsx(BasisChart, { rows: basis })] }), oi.length >= 2 && (_jsxs("div", { className: "bg-[#0d1117] border border-[#30363d] rounded-lg p-3", children: [_jsx("div", { className: "text-xs text-[#8b949e] font-semibold uppercase tracking-wider mb-2", children: "Open Interest \u00B7 VN30F1M" }), _jsx(OiChart, { rows: oi })] })), _jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-2 gap-4", children: [_jsx(WyckoffCard, { w: summary?.wyckoff ?? null }), _jsx(MultifactorCard, { m: summary?.multifactor ?? null })] })] })), _jsx("p", { className: "text-xs text-[#8b949e]/40 text-right", children: "VN30 derivatives \u00B7 basis = F1M \u2212 spot, spread = F1M \u2212 F2M \u00B7 contracts roll on the 3rd Thursday \u00B7 not financial advice" })] }));
}
