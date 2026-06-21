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
// ── XGB prediction panel ──────────────────────────────────────────────────────
const TOP_FEATURES = [
    { name: '5-day return', weight: 0.157, desc: 'recent momentum' },
    { name: '1-day return', weight: 0.131, desc: 'latest session' },
    { name: 'vs MA-20', weight: 0.107, desc: 'proximity to trend mean' },
    { name: '60-day return', weight: 0.102, desc: 'medium-term trend' },
    { name: 'vs MA-60', weight: 0.099, desc: 'long-term alignment' },
];
function XGBPanel({ symbol }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState(false);
    const [computing, setComputing] = useState(false);
    const load = useCallback(() => {
        setLoading(true);
        setErr(false);
        api.prediction(symbol)
            .then(d => { setData(d); setLoading(false); })
            .catch(() => { setErr(true); setLoading(false); });
    }, [symbol]);
    useEffect(() => { load(); }, [load]);
    const handleCompute = async () => {
        setComputing(true);
        try {
            await api.computePredictions('HOSE,HNX');
            setTimeout(load, 15000);
        }
        catch {
            setErr(true);
        }
        finally {
            setComputing(false);
        }
    };
    if (loading)
        return (_jsx("div", { className: "animate-pulse text-xs text-[#8b949e] py-6 text-center", children: "Loading XGBoost prediction\u2026" }));
    if (err || !data)
        return (_jsxs("div", { className: "text-xs text-[#8b949e] py-6 text-center space-y-2", children: [_jsxs("div", { children: ["No prediction found for ", _jsx("span", { className: "text-[#e6edf3] font-semibold", children: symbol }), "."] }), _jsx("button", { onClick: handleCompute, disabled: computing, className: "text-[#58a6ff] hover:underline disabled:opacity-50", children: computing ? 'Computing (takes ~30s)…' : 'Compute predictions now' })] }));
    const isBuy = data.signal === 'BUY';
    const pct = Math.round(data.score * 100);
    return (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex items-center gap-4 flex-wrap", children: [_jsxs("span", { className: `inline-flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-bold
          ${isBuy
                            ? 'bg-emerald-950 text-emerald-300 border-emerald-600'
                            : 'bg-[#21262d] text-[#8b949e] border-[#30363d]'}`, children: [isBuy ? '▲' : '■', " ", data.signal] }), _jsxs("div", { children: [_jsxs("div", { className: `text-3xl font-bold tabular-nums leading-none ${isBuy ? 'text-emerald-300' : 'text-[#8b949e]'}`, children: [pct, "%"] }), _jsx("div", { className: "text-[10px] text-[#8b949e] mt-0.5", children: "BUY probability" })] }), _jsxs("div", { className: "ml-auto text-right text-[11px] text-[#8b949e] space-y-0.5", children: [_jsxs("div", { children: ["Horizon: ", _jsx("span", { className: "text-[#e6edf3]", children: "5 trading days" })] }), _jsxs("div", { children: ["Target: ", _jsx("span", { className: "text-[#e6edf3]", children: "+3% return" })] }), _jsxs("div", { className: "text-[10px] opacity-60", children: ["Model trained ", data.model_date] })] })] }), _jsxs("div", { children: [_jsxs("div", { className: "relative h-3 rounded-full bg-[#21262d] overflow-hidden", children: [_jsx("div", { className: `h-full rounded-full transition-all duration-500 ${isBuy ? 'bg-emerald-500' : 'bg-[#444]'}`, style: { width: `${pct}%` } }), _jsx("div", { className: "absolute top-0 bottom-0 w-0.5 bg-[#58a6ff]/70", style: { left: '55%' } })] }), _jsxs("div", { className: "flex justify-between text-[10px] mt-1 text-[#8b949e]", children: [_jsx("span", { children: "0%" }), _jsx("span", { className: "text-[#58a6ff]", children: "55% BUY threshold" }), _jsx("span", { children: "100%" })] })] }), _jsxs("div", { className: "bg-[#0d1117] border border-[#30363d] rounded-lg p-3 space-y-2", children: [_jsx("div", { className: "text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider mb-1", children: "Top model features" }), TOP_FEATURES.map(f => (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "text-[11px] text-[#e6edf3] w-28 shrink-0", children: f.name }), _jsx("div", { className: "flex-1 h-1.5 rounded-full bg-[#30363d] overflow-hidden", children: _jsx("div", { className: "h-full rounded-full bg-purple-500/70", style: { width: `${f.weight * 550}%` } }) }), _jsxs("span", { className: "text-[10px] text-[#8b949e] w-7 text-right", children: [Math.round(f.weight * 100), "%"] }), _jsx("span", { className: "text-[10px] text-[#8b949e]/50 hidden sm:block w-36", children: f.desc })] }, f.name))), _jsx("div", { className: "text-[10px] text-[#8b949e]/40 pt-1 border-t border-[#30363d]", children: "Also uses ceiling hits, foreign flow, RSI, MACD, Bollinger bands (VN-specific model)" })] }), _jsx("div", { className: `text-xs px-3 py-2.5 rounded-lg border leading-relaxed
        ${isBuy
                    ? 'bg-emerald-950/30 border-emerald-800 text-emerald-200'
                    : 'bg-[#0d1117] border-[#30363d] text-[#8b949e]'}`, children: isBuy
                    ? `Model gives ${pct}% probability that ${symbol} returns +3%+ within 5 days. ` +
                        `Verify with Wyckoff phase before entering — strong setups combine BUY signal + Accumulation phase C/D.`
                    : `Confidence below 55% threshold (${pct}%). ${symbol} does not show a sufficient momentum pattern. ` +
                        `Wait for a higher-probability setup or check Wyckoff for context.` }), _jsxs("div", { className: "text-[10px] text-[#8b949e]/40 text-right", children: ["Predicted ", data.predicted_at, " \u00B7 XGBoost classifier \u00B7 T+2.5 settlement \u00B7 not financial advice"] })] }));
}
// ── Quarterly report panel (Vietstock BCTC → Gemini) ─────────────────────────
/** Inline **bold** segments. */
function mdBold(text, keyBase) {
    return text.split(/\*\*(.+?)\*\*/g).map((part, i) => i % 2 === 1
        ? _jsx("strong", { className: "text-[#e6edf3] font-semibold", children: part }, `${keyBase}-${i}`)
        : part);
}
/** Tiny markdown renderer: ## headings, "- " bullets, **bold**, _italic line_, paragraphs. */
function MdLite({ text }) {
    const out = [];
    let bullets = [];
    let key = 0;
    const flushBullets = () => {
        if (!bullets.length)
            return;
        out.push(_jsx("ul", { className: "list-disc pl-5 space-y-1 mb-3", children: bullets.map((b, i) => _jsx("li", { className: "leading-relaxed", children: mdBold(b, `b${key}-${i}`) }, i)) }, `ul${key++}`));
        bullets = [];
    };
    for (const raw of text.split('\n')) {
        const line = raw.trimEnd();
        const t = line.trim();
        if (!t) {
            flushBullets();
            continue;
        }
        if (/^#{1,4}\s/.test(t)) {
            flushBullets();
            out.push(_jsx("div", { className: "text-[#58a6ff] font-bold text-sm mt-4 mb-2", children: mdBold(t.replace(/^#{1,4}\s*/, ''), `h${key}`) }, `h${key++}`));
        }
        else if (/^[-*]\s+/.test(t)) {
            bullets.push(t.replace(/^[-*]\s+/, ''));
        }
        else if (/^_.*_$/.test(t)) {
            flushBullets();
            out.push(_jsx("div", { className: "italic text-[#8b949e]/70 text-[11px] mt-3", children: t.replace(/^_|_$/g, '') }, `i${key++}`));
        }
        else {
            flushBullets();
            out.push(_jsx("p", { className: "mb-2 leading-relaxed", children: mdBold(t, `p${key}`) }, `p${key++}`));
        }
    }
    flushBullets();
    return _jsx("div", { className: "text-xs text-[#c9d1d9]", children: out });
}
const PROVIDERS = [
    { id: 'gemini', label: '✨ Gemini' },
    { id: 'claude', label: '🤖 Claude' },
];
function ReportPanel({ symbol }) {
    const [provider, setProvider] = useState('gemini');
    const [data, setData] = useState(null);
    const [starting, setStarting] = useState(false);
    const [errMsg, setErrMsg] = useState(null);
    const pollRef = useRef(null);
    const load = useCallback(() => {
        api.reportAnalysis(symbol, provider)
            .then(setData)
            .catch(() => setErrMsg('Không gọi được API — kiểm tra crawler logs.'));
    }, [symbol, provider]);
    useEffect(() => {
        setData(null);
        setErrMsg(null);
        load();
        return () => { if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        } };
    }, [load]);
    // Poll while the backend job runs (crawl + LLM ≈ 30–120s)
    useEffect(() => {
        if (data?.status === 'running' && !pollRef.current) {
            pollRef.current = setInterval(load, 5000);
        }
        if (data?.status !== 'running' && pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
    }, [data, load]);
    const start = async () => {
        setStarting(true);
        setErrMsg(null);
        try {
            await api.computeReportAnalysis(symbol, provider);
            setData({ status: 'running' });
        }
        catch (e) {
            setErrMsg(e instanceof Error ? e.message : 'Không khởi động được phân tích');
        }
        finally {
            setStarting(false);
        }
    };
    const providerLabel = provider === 'claude' ? 'Claude' : 'Gemini';
    const providerTabs = (_jsx("div", { className: "flex gap-1", children: PROVIDERS.map(p => (_jsx("button", { onClick: () => setProvider(p.id), className: `px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
            ${provider === p.id
                ? 'bg-[#21262d] border-[#58a6ff] text-[#58a6ff]'
                : 'border-[#30363d] text-[#8b949e] hover:border-[#58a6ff]/50 hover:text-[#e6edf3]'}`, children: p.label }, p.id))) }));
    const startButton = (label) => (_jsx("button", { onClick: start, disabled: starting || data?.status === 'running', className: "px-4 py-2 bg-[#58a6ff] hover:bg-[#79b8ff] disabled:opacity-50 disabled:cursor-not-allowed\n                 text-[#0d1117] text-xs rounded-lg font-bold transition-all hover:scale-105 active:scale-95", children: starting ? 'Đang khởi động…' : label }));
    const body = () => {
        if (!data && !errMsg)
            return (_jsx("div", { className: "animate-pulse text-xs text-[#8b949e] py-3 text-center", children: "\u0110ang ki\u1EC3m tra\u2026" }));
        if (data?.status === 'running')
            return (_jsxs("div", { className: "py-8 text-center space-y-2", children: [_jsxs("div", { className: "text-xs text-cyan-300 animate-pulse", children: ["\u23F3 \u0110ang t\u1EA3i BCTC t\u1EEB Vietstock v\u00E0 ph\u00E2n t\u00EDch b\u1EB1ng ", providerLabel, "\u2026 (~1\u20132 ph\u00FAt)"] }), _jsx("div", { className: "text-[10px] text-[#8b949e]/60", children: "Trang t\u1EF1 c\u1EADp nh\u1EADt khi xong \u2014 kh\u00F4ng c\u1EA7n t\u1EA3i l\u1EA1i." })] }));
        if (errMsg || data?.status === 'error')
            return (_jsxs("div", { className: "py-6 text-center space-y-3", children: [_jsxs("div", { className: "text-xs text-red-300 bg-red-950/40 border border-red-800 rounded-lg px-3 py-2 inline-block max-w-lg", children: ["\u2715 ", errMsg ?? data?.error ?? 'Lỗi không xác định'] }), _jsx("div", { children: startButton('↻ Thử lại') })] }));
        if (data?.status === 'ready')
            return (_jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "flex items-center justify-between gap-2 flex-wrap", children: [_jsxs("div", { className: "text-xs", children: [_jsx("span", { className: "font-bold text-[#e6edf3]", children: data.title }), data.pdf_url && (_jsx("a", { href: data.pdf_url, target: "_blank", rel: "noreferrer", className: "ml-2 text-[#58a6ff] hover:underline", children: "PDF g\u1ED1c \u2197" })), _jsxs("div", { className: "text-[10px] text-[#8b949e]/60 mt-0.5", children: [data.model, " \u00B7 ph\u00E2n t\u00EDch l\u00FAc ", data.created_at?.slice(0, 16).replace('T', ' ')] })] }), startButton('↻ Kiểm tra quý mới')] }), _jsx("div", { className: "bg-[#161b22] border border-[#30363d] rounded-lg p-4 max-h-[28rem] overflow-y-auto", children: _jsx(MdLite, { text: data.analysis ?? '' }) })] }));
        // status === 'none' — chưa có phân tích nào
        return (_jsxs("div", { className: "py-8 text-center space-y-3", children: [_jsxs("div", { className: "text-xs text-[#8b949e]", children: ["Ch\u01B0a c\u00F3 ph\u00E2n t\u00EDch BCTC b\u1EB1ng ", providerLabel, " cho ", _jsx("span", { className: "text-[#e6edf3] font-semibold", children: symbol }), "."] }), _jsxs("div", { className: "text-[10px] text-[#8b949e]/60 max-w-md mx-auto", children: ["H\u1EC7 th\u1ED1ng s\u1EBD crawl BCTC qu\u00FD g\u1EA7n nh\u1EA5t t\u1EEB Vietstock, g\u1EEDi cho ", providerLabel, " ph\u00E2n t\u00EDch (ch\u1EA5t l\u01B0\u1EE3ng l\u1EE3i nhu\u1EADn, d\u00F2ng ti\u1EC1n, \u0111\u1ECBnh gi\u00E1, k\u1EBFt h\u1EE3p Wyckoff) r\u1ED3i l\u01B0u l\u1EA1i \u2014 m\u1ED7i qu\u00FD ch\u1EC9 ph\u00E2n t\u00EDch m\u1ED9t l\u1EA7n cho m\u1ED7i AI."] }), startButton(`📑 Phân tích bằng ${providerLabel}`)] }));
    };
    return (_jsxs("div", { className: "space-y-3", children: [providerTabs, body()] }));
}
export function SymbolModal({ symbol, name, onClose }) {
    const [quotes, setQuotes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [indicators, setIndicators] = useState(DEFAULT_INDICATORS);
    const [showPicker, setShowPicker] = useState(false);
    const [fetchingHist, setFetchingHist] = useState(false);
    const [fetchMsg, setFetchMsg] = useState(null);
    const [activePanel, setActivePanel] = useState('chart');
    const [buying, setBuying] = useState(false);
    const [buyMsg, setBuyMsg] = useState(null);
    const pollRef = useRef(null);
    const pollCountRef = useRef(0);
    const handleAssumeBuy = async () => {
        setBuying(true);
        setBuyMsg(null);
        try {
            const r = await api.buyStock(symbol, 1000);
            setBuyMsg(`✓ Bought 1,000 ${symbol} @ ${fmtPrice(r.buy_price)} — see Portfolio tab.`);
            setTimeout(() => setBuyMsg(null), 5000);
        }
        catch (e) {
            setBuyMsg(e instanceof Error ? `✕ ${e.message}` : '✕ Buy failed');
        }
        finally {
            setBuying(false);
        }
    };
    const loadQuotes = useCallback(() => {
        setLoading(true);
        api.quotes(symbol, 9999).then(q => { setQuotes(q); setLoading(false); });
    }, [symbol]);
    useEffect(() => { loadQuotes(); }, [loadQuotes]);
    useEffect(() => () => { if (pollRef.current)
        clearInterval(pollRef.current); }, []);
    // Re-crawl the full (dividend-adjusted) history from the source, then reload
    // the chart. Used both to fill an empty chart and to re-sync prices after a
    // dividend/split has shifted the adjusted series.
    const handleFetchHistory = async () => {
        setFetchingHist(true);
        setFetchMsg('Re-fetching adjusted history… updating chart.');
        if (pollRef.current)
            clearInterval(pollRef.current);
        pollCountRef.current = 0;
        try {
            await api.fetchHistory(symbol);
            // The crawl runs in the background (~3-10s). Poll a handful of times so
            // we pick up the freshly-adjusted rows regardless of how many we already had.
            pollRef.current = setInterval(() => {
                pollCountRef.current += 1;
                loadQuotes();
                if (pollCountRef.current >= 4 && pollRef.current) {
                    clearInterval(pollRef.current);
                    pollRef.current = null;
                    setFetchMsg(null);
                }
            }, 3000);
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
        } }, children: _jsxs("div", { className: "bg-[#161b22] border border-[#30363d] rounded-xl p-4 w-full max-w-[92vw] max-h-[95vh] overflow-y-auto shadow-2xl", children: [_jsxs("div", { className: "flex items-start justify-between mb-4", children: [_jsxs("div", { children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "text-xl font-bold text-[#e6edf3] tracking-wide", children: symbol }), latest && _jsx(ChangePct, { v: chg })] }), _jsx("div", { className: "text-xs text-[#8b949e] mt-0.5 max-w-xs truncate", children: name })] }), _jsxs("div", { className: "flex items-center gap-2 ml-4", children: [_jsx("button", { onClick: handleAssumeBuy, disabled: buying, title: "Assume you buy 1,000 shares now at the latest close, then track it on the Portfolio tab", className: `px-3 py-1.5 rounded-lg text-xs font-bold border transition-all
                disabled:opacity-50 disabled:cursor-not-allowed
                ${buying
                                        ? 'bg-emerald-950 border-emerald-700 text-emerald-300 animate-pulse'
                                        : 'bg-emerald-700 border-emerald-600 text-white hover:bg-emerald-600 hover:scale-105 active:scale-95'}`, children: buying ? '…' : '▸ Assume Buy 1,000' }), [
                                    { id: 'chart', label: '📈 Chart' },
                                    { id: 'wyckoff', label: '〜 Wyckoff' },
                                    { id: 'xgb', label: '🤖 XGB Pred' },
                                    { id: 'report', label: '📑 BCTC' },
                                ].map(({ id, label }) => (_jsx("button", { onClick: () => setActivePanel(id), className: `px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                  ${activePanel === id
                                        ? 'bg-[#21262d] border-[#58a6ff] text-[#58a6ff]'
                                        : 'border-[#30363d] text-[#8b949e] hover:border-[#58a6ff]/50 hover:text-[#e6edf3]'}`, children: label }, id))), activePanel === 'chart' && (_jsxs(_Fragment, { children: [_jsxs("button", { onClick: handleFetchHistory, disabled: fetchingHist || pollRef.current !== null, title: "Re-fetch the full dividend-adjusted price history from source and refresh the chart", className: `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                    disabled:opacity-50 disabled:cursor-not-allowed
                    ${fetchingHist || pollRef.current
                                                ? 'bg-cyan-950 border-cyan-700 text-cyan-300 animate-pulse'
                                                : 'bg-[#21262d] border-[#30363d] text-[#8b949e] hover:border-[#58a6ff]/50 hover:text-[#e6edf3]'}`, children: [_jsx("span", { children: "\u21BB" }), " ", fetchingHist || pollRef.current ? 'Updating…' : 'Adjust prices'] }), _jsxs("button", { onClick: () => setShowPicker(p => !p), className: `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                    ${showPicker
                                                ? 'bg-blue-950 border-[#58a6ff] text-[#58a6ff]'
                                                : 'bg-[#21262d] border-[#30363d] text-[#8b949e] hover:border-[#58a6ff]/50 hover:text-[#e6edf3]'}`, children: [_jsx("span", { children: "\u2295" }), " Ch\u1EC9 b\u00E1o", _jsx("span", { className: "bg-[#30363d] text-[#e6edf3] rounded-full px-1.5 text-xs ml-0.5", children: indicators.size })] })] })), _jsx("button", { onClick: onClose, className: "text-[#8b949e] hover:text-[#e6edf3] transition-colors w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[#21262d]", children: "\u2715" })] })] }), buyMsg && (_jsx("div", { className: `mb-3 text-xs px-3 py-2 rounded-lg border ${buyMsg.startsWith('✓')
                        ? 'bg-emerald-950/50 border-emerald-700 text-emerald-300'
                        : 'bg-red-950/50 border-red-800 text-red-300'}`, children: buyMsg })), showPicker && (_jsx(IndicatorPanel, { active: indicators, onChange: s => setIndicators(new Set(s)), onClose: () => setShowPicker(false) })), latest && (_jsx("div", { className: "grid grid-cols-4 gap-2 mb-4", children: [
                        { label: 'Close', value: fmtPrice(latest.close) },
                        { label: 'Open', value: fmtPrice(latest.open) },
                        { label: 'High', value: fmtPrice(latest.high) },
                        { label: 'Low', value: fmtPrice(latest.low) },
                    ].map(({ label, value }) => (_jsxs("div", { className: "bg-[#0d1117] border border-[#30363d] rounded-lg p-2.5 text-center", children: [_jsx("div", { className: "text-sm font-bold text-[#e6edf3] tabular-nums", children: value }), _jsx("div", { className: "text-xs text-[#8b949e]", children: label })] }, label))) })), activePanel === 'chart' ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "text-xs text-[#8b949e] mb-1 flex items-center gap-2", children: [_jsxs("span", { children: [quotes.length, " trading days"] }), fetchMsg && _jsxs("span", { className: "text-cyan-300 animate-pulse", children: ["\u00B7 ", fetchMsg] })] }), loading ? (_jsx("div", { className: "h-48 flex items-center justify-center text-[#8b949e] text-xs animate-pulse", children: "Loading\u2026" })) : quotes.length < 5 ? (_jsxs("div", { className: "mb-4 bg-[#0d1117] border border-[#30363d] rounded-lg p-6 flex flex-col items-center gap-3 text-center", children: [_jsxs("div", { className: "text-[#8b949e] text-xs", children: ["No price history found for ", _jsx("span", { className: "text-[#e6edf3] font-semibold", children: symbol })] }), _jsx("div", { className: "text-[#8b949e]/60 text-xs", children: "Run \"Full History\" in the Crawl tab, or load just this symbol:" }), _jsx("button", { onClick: handleFetchHistory, disabled: fetchingHist || pollRef.current !== null, className: "px-4 py-2 bg-[#58a6ff] hover:bg-[#79b8ff] disabled:opacity-50 disabled:cursor-not-allowed\n                             text-[#0d1117] text-xs rounded-lg font-bold transition-all hover:scale-105 active:scale-95", children: fetchingHist ? 'Starting…' : pollRef.current ? 'Fetching…' : '↓ Load History for this symbol' }), fetchMsg && (_jsx("div", { className: "text-xs text-[#58a6ff] animate-pulse", children: fetchMsg }))] })) : (_jsx("div", { className: "mb-4 bg-[#0d1117] border border-[#30363d] rounded-lg p-2", onClick: () => setShowPicker(false), children: _jsx(InteractiveChart, { quotes: quotes, indicators: indicators }) }))] })) : activePanel === 'wyckoff' ? (_jsxs("div", { className: "mb-4 bg-[#0d1117] border border-[#30363d] rounded-lg p-4", children: [_jsx("div", { className: "text-xs text-[#8b949e] font-semibold uppercase tracking-wider mb-3", children: "Wyckoff Analysis" }), _jsx(WyckoffPanel, { symbol: symbol })] })) : activePanel === 'xgb' ? (_jsxs("div", { className: "mb-4 bg-[#0d1117] border border-[#30363d] rounded-lg p-4", children: [_jsx("div", { className: "text-xs text-[#8b949e] font-semibold uppercase tracking-wider mb-3", children: "XGBoost Prediction \u00B7 5-day horizon" }), _jsx(XGBPanel, { symbol: symbol })] })) : (_jsxs("div", { className: "mb-4 bg-[#0d1117] border border-[#30363d] rounded-lg p-4", children: [_jsx("div", { className: "text-xs text-[#8b949e] font-semibold uppercase tracking-wider mb-3", children: "Ph\u00E2n t\u00EDch BCTC qu\u00FD g\u1EA7n nh\u1EA5t \u00B7 Vietstock \u2192 Gemini" }), _jsx(ReportPanel, { symbol: symbol })] }))] }) }));
}
