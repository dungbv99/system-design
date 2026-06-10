import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { fmtPrice } from '../utils';
import { ExchangeBadge } from '../components/ui';
import { SymbolModal } from '../components/SymbolModal';
// ── Helpers ───────────────────────────────────────────────────────────────────
const SIGNAL_META = {
    BUY: { label: 'BUY', bg: 'bg-emerald-950', text: 'text-emerald-300', border: 'border-emerald-600' },
    SHORT: { label: 'SHORT', bg: 'bg-red-950', text: 'text-red-300', border: 'border-red-600' },
    HOLD: { label: 'HOLD', bg: 'bg-blue-950', text: 'text-blue-300', border: 'border-blue-600' },
    WAIT: { label: 'WAIT', bg: 'bg-[#21262d]', text: 'text-[#8b949e]', border: 'border-[#30363d]' },
};
const STRENGTH_META = {
    STRONG: { dot: 'bg-emerald-400', label: 'Strong' },
    MODERATE: { dot: 'bg-amber-400', label: 'Moderate' },
    WEAK: { dot: 'bg-[#8b949e]', label: 'Weak' },
};
const PHASE_COLOR = {
    Accumulation: 'text-cyan-400',
    Distribution: 'text-orange-400',
    Markup: 'text-emerald-400',
    Markdown: 'text-red-400',
    Unknown: 'text-[#8b949e]',
};
const EVENT_COLOR = {
    SC: 'text-red-400',
    Spring: 'text-yellow-400',
    Test: 'text-yellow-300',
    SOS: 'text-emerald-400',
    LPS: 'text-emerald-300',
    BC: 'text-orange-400',
    UT: 'text-orange-300',
    UTAD: 'text-red-300',
    LPSY: 'text-red-400',
    AR: 'text-blue-400',
    ST: 'text-blue-300',
};
function SignalBadge({ signal, strength }) {
    const m = SIGNAL_META[signal] ?? SIGNAL_META.WAIT;
    const s = STRENGTH_META[strength] ?? STRENGTH_META.WEAK;
    return (_jsxs("span", { className: `inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-xs font-bold
                      ${m.bg} ${m.text} ${m.border}`, children: [_jsx("span", { className: `w-1.5 h-1.5 rounded-full ${s.dot}` }), m.label] }));
}
function PhaseLabel({ phase, sub }) {
    const color = PHASE_COLOR[phase] ?? 'text-[#8b949e]';
    return (_jsxs("span", { className: `font-semibold ${color}`, children: [phase, " ", sub !== '-' && _jsxs("span", { className: "font-bold", children: ["\u00B7", sub] })] }));
}
function EventBadge({ event }) {
    const color = EVENT_COLOR[event] ?? 'text-[#8b949e]';
    return _jsx("span", { className: `font-bold text-xs ${color}`, children: event });
}
// ── Summary cards ─────────────────────────────────────────────────────────────
function SummaryCard({ signal, count, strength, active, onClick, }) {
    const m = SIGNAL_META[signal] ?? SIGNAL_META.WAIT;
    return (_jsxs("button", { onClick: onClick, className: `flex-1 min-w-[90px] rounded-xl p-3 border-2 text-left transition-all hover:scale-[1.02]
        ${active ? `${m.bg} ${m.border}` : 'bg-[#161b22] border-[#30363d]'}`, children: [_jsx("div", { className: `text-lg font-bold tabular-nums ${active ? m.text : 'text-[#e6edf3]'}`, children: count }), _jsxs("div", { className: `text-xs mt-0.5 font-semibold ${active ? m.text : 'text-[#8b949e]'}`, children: [signal, strength ? ` ${strength}` : ''] })] }));
}
// ── Phase diagram ─────────────────────────────────────────────────────────────
const ACCUM_PHASES = ['A', 'B', 'C', 'D', 'E'];
const DISTR_PHASES = ['A', 'B', 'C', 'D'];
const PHASE_EVENT_HINT = {
    A: 'SC·AR', B: 'ST·Range', C: 'Spring', D: 'SOS·LPS', E: 'Markup',
};
const DISTR_EVENT_HINT = {
    A: 'BC·AR', B: 'ST·Range', C: 'UT·UTAD', D: 'LPSY',
};
function PhaseDiagram({ phase, sub }) {
    if (phase !== 'Accumulation' && phase !== 'Distribution')
        return null;
    const phases = phase === 'Accumulation' ? ACCUM_PHASES : DISTR_PHASES;
    const hints = phase === 'Accumulation' ? PHASE_EVENT_HINT : DISTR_EVENT_HINT;
    const acColor = phase === 'Accumulation' ? '#22d3ee' : '#fb923c';
    return (_jsxs("div", { className: "flex items-center gap-1 flex-wrap", children: [phases.map((p, i) => {
                const active = p === sub;
                return (_jsxs("div", { className: "flex items-center gap-1", children: [_jsxs("div", { className: `flex flex-col items-center gap-0.5 px-2 py-1 rounded text-[10px]
                             border transition-all ${active
                                ? 'border-current font-bold'
                                : 'border-[#30363d] text-[#8b949e]'}`, style: active ? { borderColor: acColor, color: acColor, background: `${acColor}18` } : {}, children: [_jsxs("span", { children: ["Phase ", p] }), _jsx("span", { className: "text-[9px] opacity-70", children: hints[p] })] }), i < phases.length - 1 && _jsx("span", { className: "text-[#30363d] text-xs", children: "\u2192" })] }, p));
            }), phase === 'Accumulation' && (_jsxs(_Fragment, { children: [_jsx("span", { className: "text-[#30363d] text-xs", children: "\u2192" }), _jsx("span", { className: "text-emerald-400 text-[10px] font-bold px-2 py-1 border border-emerald-800 rounded bg-emerald-950", children: "Markup \u2191" })] })), phase === 'Distribution' && (_jsxs(_Fragment, { children: [_jsx("span", { className: "text-[#30363d] text-xs", children: "\u2192" }), _jsx("span", { className: "text-red-400 text-[10px] font-bold px-2 py-1 border border-red-800 rounded bg-red-950", children: "Markdown \u2193" })] }))] }));
}
// ── Main tab ──────────────────────────────────────────────────────────────────
const SIGNAL_FILTERS = ['ALL', 'BUY', 'SHORT', 'HOLD', 'WAIT'];
export function WyckoffTab() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [computing, setComputing] = useState(false);
    const [sigFilter, setSigFilter] = useState('BUY');
    const [phaseFilter, setPhaseFilter] = useState('');
    const [detail, setDetail] = useState(null);
    const load = useCallback(async (sig, phase) => {
        setLoading(true);
        try {
            const d = await api.wyckoffSignals(sig === 'ALL' ? '' : sig, phase, 200);
            setData(d);
        }
        finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { load(sigFilter, phaseFilter); }, [load, sigFilter, phaseFilter]);
    const handleCompute = async () => {
        setComputing(true);
        try {
            await api.computeWyckoff('all'); // every symbol that has quote data
            setTimeout(() => {
                load(sigFilter, phaseFilter);
                setComputing(false);
            }, 12000);
        }
        catch {
            setComputing(false);
        }
    };
    // Count by signal type across all items regardless of active filter
    const [allData, setAllData] = useState(null);
    useEffect(() => {
        api.wyckoffSignals('', '', 2000).then(setAllData);
    }, [computing]);
    const allCounts = allData?.items.reduce((acc, r) => {
        const key = r.signal;
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
    }, {}) ?? {};
    return (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex gap-3 flex-wrap", children: [['BUY', 'SHORT', 'HOLD', 'WAIT'].map(sig => (_jsx(SummaryCard, { signal: sig, count: allCounts[sig] ?? 0, active: sigFilter === sig, onClick: () => { setSigFilter(sig); setPhaseFilter(''); } }, sig))), _jsx("div", { className: "flex-1 min-w-[90px]" }), _jsx("button", { onClick: handleCompute, disabled: computing, className: `self-center px-4 py-2 rounded-lg text-xs font-bold border transition-all
            ${computing
                            ? 'bg-cyan-950 border-cyan-700 text-cyan-300 animate-pulse cursor-not-allowed'
                            : 'bg-[#21262d] border-[#30363d] text-[#8b949e] hover:border-[#58a6ff]/50 hover:text-[#e6edf3]'}`, children: computing ? '⏳ Analysing all symbols…' : '⟳ Recalculate All' })] }), _jsxs("div", { className: "flex items-center gap-3 flex-wrap", children: [_jsx("div", { className: "flex gap-1", children: SIGNAL_FILTERS.map(f => (_jsx("button", { onClick: () => { setSigFilter(f); setPhaseFilter(''); }, className: `px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                ${sigFilter === f && phaseFilter === ''
                                ? 'bg-[#21262d] border-[#58a6ff] text-[#58a6ff]'
                                : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] hover:border-[#8b949e]/50'}`, children: f }, f))) }), _jsx("div", { className: "h-4 w-px bg-[#30363d]" }), ['Accumulation', 'Distribution', 'Markup', 'Markdown'].map(p => (_jsx("button", { onClick: () => { setPhaseFilter(phaseFilter === p ? '' : p); setSigFilter('ALL'); }, className: `px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
              ${phaseFilter === p
                            ? `${PHASE_COLOR[p].replace('text-', 'text-')} border-current bg-[#21262d]`
                            : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] hover:border-[#8b949e]/50'}`, style: phaseFilter === p ? { borderColor: 'currentColor' } : {}, children: p }, p))), data && (_jsxs("span", { className: "text-xs text-[#8b949e] ml-auto", children: [data.total, " signals"] }))] }), phaseFilter && (phaseFilter === 'Accumulation' || phaseFilter === 'Distribution') && (_jsxs("div", { className: "bg-[#161b22] border border-[#30363d] rounded-lg p-3", children: [_jsxs("div", { className: "text-xs text-[#8b949e] mb-2 font-semibold", children: [phaseFilter, " Cycle"] }), _jsx(PhaseDiagram, { phase: phaseFilter, sub: "" })] })), loading && (_jsx("div", { className: "text-center py-12 text-[#8b949e] text-sm animate-pulse", children: "Loading Wyckoff signals\u2026" })), !loading && data && (_jsx("div", { className: "overflow-x-auto rounded-lg border border-[#30363d]", children: _jsxs("table", { className: "w-full text-xs", children: [_jsx("thead", { className: "text-[#8b949e] uppercase tracking-wider text-[11px]", children: _jsxs("tr", { children: [_jsx("th", { className: "px-3 py-3 text-left font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Symbol" }), _jsx("th", { className: "px-3 py-3 text-left font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Company" }), _jsx("th", { className: "px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Exch" }), _jsx("th", { className: "px-3 py-3 text-left font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Phase" }), _jsx("th", { className: "px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Signal" }), _jsx("th", { className: "px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Last Event" }), _jsx("th", { className: "px-3 py-3 text-right font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Price (K\u20AB)" }), _jsx("th", { className: "px-3 py-3 text-right font-semibold sticky top-0 z-10 bg-[#161b22] text-emerald-400", children: "\u25B6 Best Buy" }), _jsx("th", { className: "px-3 py-3 text-right font-semibold sticky top-0 z-10 bg-[#161b22] text-red-400", children: "\u2715 Stop Loss" }), _jsx("th", { className: "px-3 py-3 text-right font-semibold sticky top-0 z-10 bg-[#161b22] text-amber-400", children: "R:R" }), _jsx("th", { className: "px-3 py-3 text-right font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Resistance" }), _jsx("th", { className: "px-3 py-3 text-left font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Description" })] }) }), _jsxs("tbody", { children: [data.items.length === 0 && (_jsx("tr", { children: _jsx("td", { colSpan: 12, className: "px-4 py-10 text-center text-[#8b949e]", children: "No signals match the selected filter" }) })), data.items.map((row, i) => {
                                    // Risk:Reward ratio
                                    const rr = (row.entry_price && row.stop_loss && row.resistance &&
                                        row.entry_price > row.stop_loss)
                                        ? ((row.resistance - row.entry_price) / (row.entry_price - row.stop_loss))
                                        : null;
                                    return (_jsxs("tr", { className: `border-t border-[#30363d]/50 cursor-pointer transition-all
                      hover:bg-[#21262d] hover:ring-1 hover:ring-inset hover:ring-[#58a6ff]/20
                      ${i % 2 === 0 ? '' : 'bg-[#161b22]/30'}`, style: { borderLeft: `4px solid ${row.signal === 'BUY' ? '#34d399' :
                                                row.signal === 'SHORT' ? '#f87171' :
                                                    row.signal === 'HOLD' ? '#60a5fa' : '#30363d'}` }, onClick: () => setDetail({ symbol: row.symbol, name: row.name ?? row.symbol }), children: [_jsx("td", { className: "px-3 py-2.5", children: _jsx("span", { className: "font-bold text-emerald-400 tracking-wide", children: row.symbol }) }), _jsx("td", { className: "px-3 py-2.5 max-w-[150px]", children: _jsx("span", { className: "text-[#e6edf3] truncate block", title: row.name, children: row.name ?? '—' }) }), _jsx("td", { className: "px-3 py-2.5 text-center", children: _jsx(ExchangeBadge, { exchange: row.exchange ?? '' }) }), _jsx("td", { className: "px-3 py-2.5", children: _jsx(PhaseLabel, { phase: row.phase, sub: row.sub_phase }) }), _jsx("td", { className: "px-3 py-2.5 text-center", children: _jsx(SignalBadge, { signal: row.signal, strength: row.signal_strength }) }), _jsx("td", { className: "px-3 py-2.5 text-center", children: row.last_event
                                                    ? _jsx(EventBadge, { event: row.last_event })
                                                    : _jsx("span", { className: "text-[#8b949e]", children: "\u2014" }) }), _jsx("td", { className: "px-3 py-2.5 text-right font-medium text-[#e6edf3] tabular-nums", children: row.current_price != null ? fmtPrice(row.current_price) : '—' }), _jsx("td", { className: "px-3 py-2.5 text-right tabular-nums", children: row.entry_price != null ? (_jsx("span", { className: "font-bold text-emerald-300 bg-emerald-950/60 px-1.5 py-0.5 rounded", children: fmtPrice(row.entry_price) })) : _jsx("span", { className: "text-[#8b949e]", children: "\u2014" }) }), _jsx("td", { className: "px-3 py-2.5 text-right tabular-nums", children: row.stop_loss != null ? (_jsx("span", { className: "font-bold text-red-300 bg-red-950/60 px-1.5 py-0.5 rounded", children: fmtPrice(row.stop_loss) })) : _jsx("span", { className: "text-[#8b949e]", children: "\u2014" }) }), _jsx("td", { className: "px-3 py-2.5 text-right tabular-nums", children: rr != null ? (_jsxs("span", { className: `font-bold text-xs px-1.5 py-0.5 rounded ${rr >= 3 ? 'text-emerald-300 bg-emerald-950/60' :
                                                        rr >= 2 ? 'text-amber-300 bg-amber-950/60' :
                                                            'text-[#8b949e]'}`, children: ["1:", rr.toFixed(1)] })) : _jsx("span", { className: "text-[#8b949e]", children: "\u2014" }) }), _jsx("td", { className: "px-3 py-2.5 text-right text-red-400/80 tabular-nums", children: row.resistance != null ? fmtPrice(row.resistance) : '—' }), _jsx("td", { className: "px-3 py-2.5 max-w-[260px]", children: _jsx("span", { className: "text-[#8b949e] truncate block text-[11px]", title: row.description, children: row.description }) })] }, row.symbol));
                                })] })] }) })), _jsx("p", { className: "text-xs text-[#8b949e]/40 text-right", children: "Wyckoff signals \u2014 all symbols with quote data \u00B7 updated daily after market close \u00B7 not financial advice" }), detail && (_jsx(SymbolModal, { symbol: detail.symbol, name: detail.name, onClose: () => setDetail(null) }))] }));
}
