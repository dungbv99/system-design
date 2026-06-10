import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { fmtPrice } from '../utils';
import { ExchangeBadge } from '../components/ui';
import { SymbolModal } from '../components/SymbolModal';
// ── Helpers ───────────────────────────────────────────────────────────────────
const SIGNAL_META = {
    BUY: { label: 'BUY', bg: 'bg-emerald-950', text: 'text-emerald-300', border: 'border-emerald-600', bar: '#34d399' },
    WATCH: { label: 'WATCH', bg: 'bg-amber-950', text: 'text-amber-300', border: 'border-amber-600', bar: '#f59e0b' },
    AVOID: { label: 'AVOID', bg: 'bg-red-950', text: 'text-red-300', border: 'border-red-700', bar: '#f87171' },
};
const CONF_DOT = {
    HIGH: 'bg-emerald-400',
    MEDIUM: 'bg-amber-400',
    LOW: 'bg-[#8b949e]',
};
function SignalBadge({ signal, confidence }) {
    const m = SIGNAL_META[signal] ?? SIGNAL_META.WATCH;
    return (_jsxs("span", { className: `inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-xs font-bold
                      ${m.bg} ${m.text} ${m.border}`, children: [_jsx("span", { className: `w-1.5 h-1.5 rounded-full ${CONF_DOT[confidence] ?? CONF_DOT.LOW}` }), m.label] }));
}
/** Total-score gauge (0–100) with a colour ramp. */
function ScoreBar({ score }) {
    const color = score >= 70 ? '#34d399' : score >= 55 ? '#a3e635' : score >= 40 ? '#f59e0b' : '#f87171';
    return (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("div", { className: "flex-1 h-2 rounded-full bg-[#21262d] overflow-hidden min-w-[60px]", children: _jsx("div", { className: "h-full rounded-full transition-all", style: { width: `${Math.max(0, Math.min(100, score))}%`, background: color } }) }), _jsx("span", { className: "font-bold tabular-nums w-7 text-right", style: { color }, children: score })] }));
}
/** Per-factor mini cell: 0–25 value over a tinted bar. */
function FactorCell({ value, reason }) {
    const pct = Math.max(0, Math.min(100, (value / 25) * 100));
    const agreed = value >= 15;
    const color = agreed ? '#34d399' : value >= 8 ? '#f59e0b' : '#6e7681';
    return (_jsxs("div", { className: "flex flex-col gap-1 min-w-[52px]", title: reason, children: [_jsxs("span", { className: `text-[11px] font-bold tabular-nums ${agreed ? 'text-emerald-300' : 'text-[#8b949e]'}`, children: [value, _jsx("span", { className: "text-[#8b949e]/50", children: "/25" })] }), _jsx("div", { className: "h-1.5 rounded-full bg-[#21262d] overflow-hidden", children: _jsx("div", { className: "h-full rounded-full", style: { width: `${pct}%`, background: color } }) })] }));
}
function SummaryCard({ signal, count, active, onClick, }) {
    const m = SIGNAL_META[signal] ?? SIGNAL_META.WATCH;
    return (_jsxs("button", { onClick: onClick, className: `flex-1 min-w-[90px] rounded-xl p-3 border-2 text-left transition-all hover:scale-[1.02]
        ${active ? `${m.bg} ${m.border}` : 'bg-[#161b22] border-[#30363d]'}`, children: [_jsx("div", { className: `text-lg font-bold tabular-nums ${active ? m.text : 'text-[#e6edf3]'}`, children: count }), _jsx("div", { className: `text-xs mt-0.5 font-semibold ${active ? m.text : 'text-[#8b949e]'}`, children: signal })] }));
}
// ── Main tab ──────────────────────────────────────────────────────────────────
const SIGNAL_FILTERS = ['ALL', 'BUY', 'WATCH', 'AVOID'];
const CONF_FILTERS = ['HIGH', 'MEDIUM', 'LOW'];
export function MultiFactorTab() {
    const [data, setData] = useState(null);
    const [allData, setAllData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [computing, setComputing] = useState(false);
    const [sigFilter, setSigFilter] = useState('BUY');
    const [confFilter, setConfFilter] = useState('');
    const [minScore, setMinScore] = useState(0);
    const [detail, setDetail] = useState(null);
    const load = useCallback(async (sig, conf, min) => {
        setLoading(true);
        try {
            const d = await api.multifactorSignals(sig === 'ALL' ? '' : sig, min, conf, 500);
            setData(d);
        }
        finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { load(sigFilter, confFilter, minScore); }, [load, sigFilter, confFilter, minScore]);
    useEffect(() => { api.multifactorSignals('', 0, '', 4000).then(setAllData); }, [computing]);
    const handleCompute = async () => {
        setComputing(true);
        try {
            await api.computeMultifactor('all');
            setTimeout(() => { load(sigFilter, confFilter, minScore); setComputing(false); }, 12000);
        }
        catch {
            setComputing(false);
        }
    };
    const counts = allData?.items.reduce((acc, r) => {
        acc[r.signal] = (acc[r.signal] ?? 0) + 1;
        return acc;
    }, {}) ?? {};
    return (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex gap-3 flex-wrap", children: [['BUY', 'WATCH', 'AVOID'].map(sig => (_jsx(SummaryCard, { signal: sig, count: counts[sig] ?? 0, active: sigFilter === sig, onClick: () => setSigFilter(sig) }, sig))), _jsx("div", { className: "flex-1 min-w-[90px]" }), _jsx("button", { onClick: handleCompute, disabled: computing, className: `self-center px-4 py-2 rounded-lg text-xs font-bold border transition-all
            ${computing
                            ? 'bg-cyan-950 border-cyan-700 text-cyan-300 animate-pulse cursor-not-allowed'
                            : 'bg-[#21262d] border-[#30363d] text-[#8b949e] hover:border-[#58a6ff]/50 hover:text-[#e6edf3]'}`, children: computing ? '⏳ Scoring all symbols…' : '⟳ Recalculate All' })] }), _jsxs("div", { className: "flex items-center gap-3 flex-wrap", children: [_jsx("div", { className: "flex gap-1", children: SIGNAL_FILTERS.map(f => (_jsx("button", { onClick: () => setSigFilter(f), className: `px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                ${sigFilter === f
                                ? 'bg-[#21262d] border-[#58a6ff] text-[#58a6ff]'
                                : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] hover:border-[#8b949e]/50'}`, children: f }, f))) }), _jsx("div", { className: "h-4 w-px bg-[#30363d]" }), _jsx("span", { className: "text-xs text-[#8b949e] font-semibold", children: "Confidence:" }), _jsx("div", { className: "flex gap-1", children: CONF_FILTERS.map(c => (_jsx("button", { onClick: () => setConfFilter(confFilter === c ? '' : c), className: `px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                ${confFilter === c
                                ? 'bg-[#21262d] border-[#58a6ff] text-[#58a6ff]'
                                : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] hover:border-[#8b949e]/50'}`, children: c }, c))) }), _jsx("div", { className: "h-4 w-px bg-[#30363d]" }), _jsx("span", { className: "text-xs text-[#8b949e] font-semibold", children: "Min score:" }), _jsx("div", { className: "flex gap-1", children: [0, 40, 55, 70].map(m => (_jsxs("button", { onClick: () => setMinScore(m), className: `px-3 py-1.5 rounded-lg text-xs font-medium border transition-all tabular-nums
                ${minScore === m
                                ? 'bg-[#21262d] border-[#58a6ff] text-[#58a6ff]'
                                : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] hover:border-[#8b949e]/50'}`, children: ["\u2265 ", m] }, m))) }), data && _jsxs("span", { className: "text-xs text-[#8b949e] ml-auto", children: [data.total, " signals"] })] }), loading && (_jsx("div", { className: "text-center py-12 text-[#8b949e] text-sm animate-pulse", children: "Loading multi-factor signals\u2026" })), !loading && data && (_jsx("div", { className: "overflow-x-auto rounded-lg border border-[#30363d]", children: _jsxs("table", { className: "w-full text-xs", children: [_jsx("thead", { className: "text-[#8b949e] uppercase tracking-wider text-[11px]", children: _jsxs("tr", { children: [_jsx("th", { className: "px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Symbol" }), _jsx("th", { className: "px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Company" }), _jsx("th", { className: "px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Exch" }), _jsx("th", { className: "px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Signal" }), _jsx("th", { className: "px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22] min-w-[120px]", children: "Score" }), _jsx("th", { className: "px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Agree" }), _jsx("th", { className: "px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22] text-cyan-400", children: "Trend" }), _jsx("th", { className: "px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22] text-purple-400", children: "Mom" }), _jsx("th", { className: "px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22] text-blue-400", children: "Vol" }), _jsx("th", { className: "px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22] text-orange-400", children: "Pos" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Price (K\u20AB)" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22] text-emerald-400", children: "\u25B6 Entry" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22] text-red-400", children: "\u2715 Stop" }), _jsx("th", { className: "px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Description" })] }) }), _jsxs("tbody", { children: [data.items.length === 0 && (_jsx("tr", { children: _jsxs("td", { colSpan: 14, className: "px-4 py-10 text-center text-[#8b949e]", children: ["No signals match the selected filter. Try", ' ', _jsx("span", { className: "text-[#58a6ff]", children: "Recalculate All" }), " if none have been computed yet."] }) })), data.items.map((row, i) => (_jsxs("tr", { className: `border-t border-[#30363d]/50 cursor-pointer transition-all
                    hover:bg-[#21262d] hover:ring-1 hover:ring-inset hover:ring-[#58a6ff]/20
                    ${i % 2 === 0 ? '' : 'bg-[#161b22]/30'}`, style: { borderLeft: `4px solid ${(SIGNAL_META[row.signal] ?? SIGNAL_META.WATCH).bar}` }, onClick: () => setDetail({ symbol: row.symbol, name: row.name ?? row.symbol }), children: [_jsx("td", { className: "px-3 py-2.5", children: _jsx("span", { className: "font-bold text-emerald-400 tracking-wide", children: row.symbol }) }), _jsx("td", { className: "px-3 py-2.5 max-w-[140px]", children: _jsx("span", { className: "text-[#e6edf3] truncate block", title: row.name, children: row.name ?? '—' }) }), _jsx("td", { className: "px-3 py-2.5 text-center", children: _jsx(ExchangeBadge, { exchange: row.exchange ?? '' }) }), _jsx("td", { className: "px-3 py-2.5 text-center", children: _jsx(SignalBadge, { signal: row.signal, confidence: row.confidence }) }), _jsx("td", { className: "px-3 py-2.5", children: _jsx(ScoreBar, { score: row.total_score }) }), _jsx("td", { className: "px-3 py-2.5 text-center", children: _jsxs("span", { className: `font-bold tabular-nums ${row.factors_agreed >= 3 ? 'text-emerald-300' :
                                                    row.factors_agreed === 2 ? 'text-amber-300' : 'text-[#8b949e]'}`, children: [row.factors_agreed, "/4"] }) }), _jsx("td", { className: "px-3 py-2.5", children: _jsx(FactorCell, { value: row.trend_score, reason: row.trend_reason }) }), _jsx("td", { className: "px-3 py-2.5", children: _jsx(FactorCell, { value: row.momentum_score, reason: row.momentum_reason }) }), _jsx("td", { className: "px-3 py-2.5", children: _jsx(FactorCell, { value: row.volume_score, reason: row.volume_reason }) }), _jsx("td", { className: "px-3 py-2.5", children: _jsx(FactorCell, { value: row.position_score, reason: row.position_reason }) }), _jsx("td", { className: "px-3 py-2.5 text-right font-medium text-[#e6edf3] tabular-nums", children: row.current_price != null ? fmtPrice(row.current_price) : '—' }), _jsx("td", { className: "px-3 py-2.5 text-right tabular-nums", children: row.entry_price != null ? (_jsx("span", { className: "font-bold text-emerald-300 bg-emerald-950/60 px-1.5 py-0.5 rounded", children: fmtPrice(row.entry_price) })) : _jsx("span", { className: "text-[#8b949e]", children: "\u2014" }) }), _jsx("td", { className: "px-3 py-2.5 text-right tabular-nums", children: row.stop_loss != null ? (_jsx("span", { className: "font-bold text-red-300 bg-red-950/60 px-1.5 py-0.5 rounded", children: fmtPrice(row.stop_loss) })) : _jsx("span", { className: "text-[#8b949e]", children: "\u2014" }) }), _jsx("td", { className: "px-3 py-2.5 max-w-[240px]", children: _jsx("span", { className: "text-[#8b949e] truncate block text-[11px]", title: row.description, children: row.description }) })] }, row.symbol)))] })] }) })), _jsx("p", { className: "text-xs text-[#8b949e]/40 text-right", children: "Multi-factor score = Trend + Momentum + Volume + Position (each 0\u201325) \u00B7 agree = factor \u2265 15/25 \u00B7 not financial advice" }), detail && (_jsx(SymbolModal, { symbol: detail.symbol, name: detail.name, onClose: () => setDetail(null) }))] }));
}
