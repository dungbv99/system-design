import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { DEFAULT_INDICATORS } from '../indicators/defs';
import { fmtPrice } from '../utils';
import { ChangePct } from './ui';
import { IndicatorPanel } from './IndicatorPanel';
import { InteractiveChart } from './InteractiveChart';
// ── Wyckoff panel ─────────────────────────────────────────────────────────────
const SIGNAL_STYLE = {
    BUY: { bg: 'bg-emerald-950', text: 'text-emerald-300', border: 'border-emerald-600' },
    SHORT: { bg: 'bg-red-950', text: 'text-red-300', border: 'border-red-600' },
    HOLD: { bg: 'bg-blue-950', text: 'text-blue-300', border: 'border-blue-600' },
    WAIT: { bg: 'bg-[#21262d]', text: 'text-[#8b949e]', border: 'border-[#30363d]' },
};
const STRENGTH_DOT = {
    STRONG: 'bg-emerald-400', MODERATE: 'bg-amber-400', WEAK: 'bg-[#8b949e]',
};
const PHASE_COLOR = {
    Accumulation: '#22d3ee', Distribution: '#fb923c', Markup: '#34d399', Markdown: '#f87171',
};
const EVENT_COLOR = {
    SC: '#f87171', Spring: '#fbbf24', Test: '#fde68a', SOS: '#34d399', LPS: '#6ee7b7',
    BC: '#fb923c', UT: '#fdba74', UTAD: '#fca5a5', LPSY: '#f87171',
    AR: '#60a5fa', ST: '#93c5fd',
};
const PHASE_STEPS_ACCUM = [
    { sub: 'A', hint: 'SC · AR', tip: 'Selling Climax & first bounce' },
    { sub: 'B', hint: 'ST · Range', tip: 'Building the cause' },
    { sub: 'C', hint: 'Spring', tip: 'Last shake-out below support' },
    { sub: 'D', hint: 'SOS · LPS', tip: 'Sign of Strength + best buy entry' },
    { sub: 'E', hint: 'Markup ↑', tip: 'Full uptrend begins' },
];
const PHASE_STEPS_DISTR = [
    { sub: 'A', hint: 'BC · AR', tip: 'Buying Climax & first drop' },
    { sub: 'B', hint: 'ST · Range', tip: 'Distributing shares' },
    { sub: 'C', hint: 'UT / UTAD', tip: 'Bull trap above resistance' },
    { sub: 'D', hint: 'LPSY', tip: 'Last weak rally before decline' },
];
function WyckoffPanel({ symbol }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState(false);
    useEffect(() => {
        setLoading(true);
        setErr(false);
        api.wyckoffSignal(symbol)
            .then(d => { setData(d); setLoading(false); })
            .catch(() => { setErr(true); setLoading(false); });
    }, [symbol]);
    if (loading)
        return (_jsx("div", { className: "animate-pulse text-xs text-[#8b949e] py-3 text-center", children: "Loading Wyckoff analysis\u2026" }));
    if (err || !data)
        return (_jsxs("div", { className: "text-xs text-[#8b949e] py-3 text-center", children: ["No Wyckoff analysis yet.", ' ', _jsx("button", { className: "text-[#58a6ff] hover:underline", onClick: () => {
                        api.computeWyckoff('HOSE,HNX').then(() => setTimeout(() => api.wyckoffSignal(symbol).then(setData).catch(() => setErr(true)), 6000));
                    }, children: "Compute now" })] }));
    const sig = SIGNAL_STYLE[data.signal] ?? SIGNAL_STYLE.WAIT;
    const dot = STRENGTH_DOT[data.signal_strength] ?? STRENGTH_DOT.WEAK;
    const pCol = PHASE_COLOR[data.phase] ?? '#8b949e';
    const isAccum = data.phase === 'Accumulation';
    const isDistr = data.phase === 'Distribution';
    const steps = isAccum ? PHASE_STEPS_ACCUM : isDistr ? PHASE_STEPS_DISTR : [];
    return (_jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "flex items-center gap-3 flex-wrap", children: [_jsxs("span", { className: `inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border text-sm font-bold
                          ${sig.bg} ${sig.text} ${sig.border}`, children: [_jsx("span", { className: `w-2 h-2 rounded-full ${dot}` }), data.signal, " \u00B7 ", data.signal_strength] }), _jsxs("span", { className: "text-sm font-semibold", style: { color: pCol }, children: [data.phase, data.sub_phase !== '-' && (_jsxs("span", { className: "ml-1 font-bold", children: ["Phase ", data.sub_phase] }))] }), data.last_event && (_jsx("span", { className: "text-xs px-2 py-0.5 rounded border border-[#30363d] bg-[#21262d]", style: { color: EVENT_COLOR[data.last_event] ?? '#8b949e' }, children: data.last_event })), _jsxs("span", { className: "text-xs text-[#8b949e] ml-auto", children: [data.bars_analyzed, " bars"] })] }), steps.length > 0 && (_jsxs("div", { className: "flex items-start gap-1 flex-wrap", children: [steps.map((step, i) => {
                        const active = step.sub === data.sub_phase;
                        return (_jsxs("div", { className: "flex items-center gap-1", children: [_jsxs("div", { title: step.tip, className: `flex flex-col items-center px-2 py-1 rounded text-[10px] border cursor-default transition-all
                               ${active ? 'font-bold' : 'text-[#8b949e] border-[#30363d]'}`, style: active
                                        ? { borderColor: pCol, color: pCol, background: `${pCol}18` }
                                        : {}, children: [_jsxs("span", { children: ["Phase ", step.sub] }), _jsx("span", { className: "opacity-70", children: step.hint })] }), i < steps.length - 1 && _jsx("span", { className: "text-[#30363d] text-xs", children: "\u2192" })] }, step.sub));
                    }), _jsx("span", { className: "text-[#30363d] text-xs", children: "\u2192" }), isAccum && _jsx("span", { className: "text-emerald-400 text-[10px] font-bold px-2 py-1 border border-emerald-800 rounded bg-emerald-950", children: "Markup \u2191" }), isDistr && _jsx("span", { className: "text-red-400 text-[10px] font-bold px-2 py-1 border border-red-800 rounded bg-red-950", children: "Markdown \u2193" })] })), _jsx("div", { className: "grid grid-cols-2 sm:grid-cols-4 gap-2", children: [
                    { label: '▶ Best Buy', value: data.entry_price != null ? fmtPrice(data.entry_price) : '—', color: 'text-emerald-300', bg: 'bg-emerald-950/40 border-emerald-800' },
                    { label: '✕ Stop Loss', value: data.stop_loss != null ? fmtPrice(data.stop_loss) : '—', color: 'text-red-300', bg: 'bg-red-950/40 border-red-800' },
                    { label: 'Support', value: data.support != null ? fmtPrice(data.support) : '—', color: 'text-emerald-400', bg: 'bg-[#0d1117] border-[#30363d]' },
                    { label: 'Resistance', value: data.resistance != null ? fmtPrice(data.resistance) : '—', color: 'text-red-400', bg: 'bg-[#0d1117] border-[#30363d]' },
                ].map(({ label, value, color, bg }) => (_jsxs("div", { className: `border rounded-lg p-2 text-center ${bg}`, children: [_jsx("div", { className: `text-sm font-bold tabular-nums ${color}`, children: value }), _jsx("div", { className: "text-[11px] text-[#8b949e]", children: label })] }, label))) }), data.entry_price && data.stop_loss && data.resistance && data.entry_price > data.stop_loss && ((() => {
                const risk = data.entry_price - data.stop_loss;
                const reward = data.resistance - data.entry_price;
                const rr = reward / risk;
                return (_jsxs("div", { className: `flex items-center gap-2 text-xs px-3 py-2 rounded-lg border
              ${rr >= 3 ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
                        : rr >= 2 ? 'bg-amber-950/40 border-amber-800 text-amber-300'
                            : 'bg-[#0d1117] border-[#30363d] text-[#8b949e]'}`, children: [_jsxs("span", { className: "font-bold", children: ["R:R = 1:", rr.toFixed(1)] }), _jsx("span", { className: "text-[#8b949e]", children: "\u00B7" }), _jsxs("span", { children: ["Risk ", ((risk / data.entry_price) * 100).toFixed(1), "%"] }), _jsx("span", { className: "text-[#8b949e]", children: "\u00B7" }), _jsxs("span", { children: ["Target +", ((reward / data.entry_price) * 100).toFixed(1), "%"] })] }));
            })()), _jsx("div", { className: "text-xs text-[#8b949e] bg-[#0d1117] border border-[#30363d] rounded-lg p-3 leading-relaxed", children: data.description })] }));
}
export function SymbolModal({ symbol, name, onClose }) {
    const [quotes, setQuotes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [indicators, setIndicators] = useState(DEFAULT_INDICATORS);
    const [showPicker, setShowPicker] = useState(false);
    const [fetchingHist, setFetchingHist] = useState(false);
    const [fetchMsg, setFetchMsg] = useState(null);
    const [activePanel, setActivePanel] = useState('chart');
    const pollRef = useRef(null);
    const loadQuotes = useCallback(() => {
        setLoading(true);
        api.quotes(symbol, 9999).then(q => { setQuotes(q); setLoading(false); });
    }, [symbol]);
    useEffect(() => { loadQuotes(); }, [loadQuotes]);
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
    return (_jsx("div", { className: "fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4", onClick: e => { if (e.target === e.currentTarget) {
            setShowPicker(false);
            onClose();
        } }, children: _jsxs("div", { className: "bg-[#161b22] border border-[#30363d] rounded-xl p-5 w-full max-w-5xl max-h-[95vh] overflow-y-auto shadow-2xl", children: [_jsxs("div", { className: "flex items-start justify-between mb-4", children: [_jsxs("div", { children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "text-xl font-bold text-[#e6edf3] tracking-wide", children: symbol }), latest && _jsx(ChangePct, { v: chg })] }), _jsx("div", { className: "text-xs text-[#8b949e] mt-0.5 max-w-xs truncate", children: name })] }), _jsxs("div", { className: "flex items-center gap-2 ml-4", children: [['chart', 'wyckoff'].map(p => (_jsx("button", { onClick: () => setActivePanel(p), className: `px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                  ${activePanel === p
                                        ? 'bg-[#21262d] border-[#58a6ff] text-[#58a6ff]'
                                        : 'border-[#30363d] text-[#8b949e] hover:border-[#58a6ff]/50 hover:text-[#e6edf3]'}`, children: p === 'chart' ? '📈 Chart' : '〜 Wyckoff' }, p))), activePanel === 'chart' && (_jsxs("button", { onClick: () => setShowPicker(p => !p), className: `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                  ${showPicker
                                        ? 'bg-blue-950 border-[#58a6ff] text-[#58a6ff]'
                                        : 'bg-[#21262d] border-[#30363d] text-[#8b949e] hover:border-[#58a6ff]/50 hover:text-[#e6edf3]'}`, children: [_jsx("span", { children: "\u2295" }), " Ch\u1EC9 b\u00E1o", _jsx("span", { className: "bg-[#30363d] text-[#e6edf3] rounded-full px-1.5 text-xs ml-0.5", children: indicators.size })] })), _jsx("button", { onClick: onClose, className: "text-[#8b949e] hover:text-[#e6edf3] transition-colors w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[#21262d]", children: "\u2715" })] })] }), showPicker && (_jsx(IndicatorPanel, { active: indicators, onChange: s => setIndicators(new Set(s)), onClose: () => setShowPicker(false) })), latest && (_jsx("div", { className: "grid grid-cols-4 gap-2 mb-4", children: [
                        { label: 'Close', value: fmtPrice(latest.close) },
                        { label: 'Open', value: fmtPrice(latest.open) },
                        { label: 'High', value: fmtPrice(latest.high) },
                        { label: 'Low', value: fmtPrice(latest.low) },
                    ].map(({ label, value }) => (_jsxs("div", { className: "bg-[#0d1117] border border-[#30363d] rounded-lg p-2.5 text-center", children: [_jsx("div", { className: "text-sm font-bold text-[#e6edf3] tabular-nums", children: value }), _jsx("div", { className: "text-xs text-[#8b949e]", children: label })] }, label))) })), activePanel === 'chart' ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "text-xs text-[#8b949e] mb-1", children: [quotes.length, " trading days"] }), loading ? (_jsx("div", { className: "h-48 flex items-center justify-center text-[#8b949e] text-xs animate-pulse", children: "Loading\u2026" })) : quotes.length < 5 ? (_jsxs("div", { className: "mb-4 bg-[#0d1117] border border-[#30363d] rounded-lg p-6 flex flex-col items-center gap-3 text-center", children: [_jsxs("div", { className: "text-[#8b949e] text-xs", children: ["No price history found for ", _jsx("span", { className: "text-[#e6edf3] font-semibold", children: symbol })] }), _jsx("div", { className: "text-[#8b949e]/60 text-xs", children: "Run \"Full History\" in the Crawl tab, or load just this symbol:" }), _jsx("button", { onClick: handleFetchHistory, disabled: fetchingHist || pollRef.current !== null, className: "px-4 py-2 bg-[#58a6ff] hover:bg-[#79b8ff] disabled:opacity-50 disabled:cursor-not-allowed\n                             text-[#0d1117] text-xs rounded-lg font-bold transition-all hover:scale-105 active:scale-95", children: fetchingHist ? 'Starting…' : pollRef.current ? 'Fetching…' : '↓ Load History for this symbol' }), fetchMsg && (_jsx("div", { className: "text-xs text-[#58a6ff] animate-pulse", children: fetchMsg }))] })) : (_jsx("div", { className: "mb-4 bg-[#0d1117] border border-[#30363d] rounded-lg p-3", onClick: () => setShowPicker(false), children: _jsx(InteractiveChart, { quotes: quotes, indicators: indicators }) }))] })) : (_jsxs("div", { className: "mb-4 bg-[#0d1117] border border-[#30363d] rounded-lg p-4", children: [_jsx("div", { className: "text-xs text-[#8b949e] font-semibold uppercase tracking-wider mb-3", children: "Wyckoff Analysis" }), _jsx(WyckoffPanel, { symbol: symbol })] }))] }) }));
}
