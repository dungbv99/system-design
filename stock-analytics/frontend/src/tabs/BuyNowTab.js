import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { fmtPrice } from '../utils';
import { ExchangeBadge } from '../components/ui';
import { SymbolModal } from '../components/SymbolModal';
// ── Helpers ───────────────────────────────────────────────────────────────────
const PHASE_COLOR = {
    Accumulation: 'text-cyan-400',
    Distribution: 'text-orange-400',
    Markup: 'text-emerald-400',
    Markdown: 'text-red-400',
    Unknown: 'text-[#8b949e]',
};
const STRENGTH_META = {
    STRONG: { dot: 'bg-emerald-400', label: 'Strong', text: 'text-emerald-300' },
    MODERATE: { dot: 'bg-amber-400', label: 'Moderate', text: 'text-amber-300' },
    WEAK: { dot: 'bg-[#8b949e]', label: 'Weak', text: 'text-[#8b949e]' },
};
const STRENGTH_RANK = { STRONG: 0, MODERATE: 1, WEAK: 2 };
// Threshold presets — "how close to the best-buy price is close enough"
const THRESHOLDS = [0.5, 1, 2, 3];
function PhaseLabel({ phase, sub }) {
    const color = PHASE_COLOR[phase] ?? 'text-[#8b949e]';
    return (_jsxs("span", { className: `font-semibold ${color}`, children: [phase, " ", sub !== '-' && _jsxs("span", { className: "font-bold", children: ["\u00B7", sub] })] }));
}
function StrengthBadge({ strength }) {
    const s = STRENGTH_META[strength] ?? STRENGTH_META.WEAK;
    return (_jsxs("span", { className: `inline-flex items-center gap-1.5 text-xs font-bold ${s.text}`, children: [_jsx("span", { className: `w-1.5 h-1.5 rounded-full ${s.dot}` }), s.label] }));
}
/** Signed gap badge. Below best-buy (cheaper) = green; at/above = amber. */
function GapBadge({ gapPct }) {
    const below = gapPct <= 0;
    const sign = gapPct > 0 ? '+' : gapPct < 0 ? '−' : '';
    const abs = Math.abs(gapPct);
    return (_jsxs("span", { className: `font-bold text-xs px-1.5 py-0.5 rounded tabular-nums ${below ? 'text-emerald-300 bg-emerald-950/60' : 'text-amber-300 bg-amber-950/60'}`, children: [sign, abs.toFixed(2), "%"] }));
}
// ── Main tab ──────────────────────────────────────────────────────────────────
export function BuyNowTab() {
    const [signals, setSignals] = useState(null);
    const [loading, setLoading] = useState(false);
    const [maxGap, setMaxGap] = useState(1); // percent
    const [strongOnly, setStrongOnly] = useState(false);
    const [detail, setDetail] = useState(null);
    const load = useCallback(async () => {
        setLoading(true);
        try {
            const page = await api.wyckoffSignals('BUY', '', 2000);
            setSignals(page.items);
        }
        finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { load(); }, [load]);
    // Build, filter (current price within maxGap% of best-buy entry), and sort.
    const rows = useMemo(() => {
        if (!signals)
            return [];
        const out = [];
        for (const s of signals) {
            if (s.entry_price == null || s.current_price == null || s.entry_price <= 0)
                continue;
            if (strongOnly && s.signal_strength !== 'STRONG')
                continue;
            const gapPct = ((s.current_price - s.entry_price) / s.entry_price) * 100;
            if (Math.abs(gapPct) > maxGap)
                continue;
            const rr = (s.stop_loss != null && s.resistance != null && s.entry_price > s.stop_loss)
                ? (s.resistance - s.entry_price) / (s.entry_price - s.stop_loss)
                : null;
            out.push({ ...s, gapPct, rr });
        }
        // Closest to entry first; STRONG before MODERATE on ties.
        out.sort((a, b) => {
            const r = (STRENGTH_RANK[a.signal_strength] ?? 9) - (STRENGTH_RANK[b.signal_strength] ?? 9);
            if (r !== 0)
                return r;
            return Math.abs(a.gapPct) - Math.abs(b.gapPct);
        });
        return out;
    }, [signals, maxGap, strongOnly]);
    const strongCount = rows.filter(r => r.signal_strength === 'STRONG').length;
    return (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex items-start justify-between gap-3 flex-wrap", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-base font-bold text-emerald-400 flex items-center gap-2", children: "\uD83C\uDFAF Buy Now" }), _jsxs("p", { className: "text-xs text-[#8b949e] mt-1 max-w-xl", children: ["Wyckoff ", _jsx("span", { className: "text-emerald-300 font-semibold", children: "BUY" }), " setups where the current price is within ", _jsxs("span", { className: "text-emerald-300 font-semibold", children: [maxGap, "%"] }), " of the best-buy entry \u2014 i.e. you can act at (or near) the ideal price right now."] })] }), _jsx("button", { onClick: load, disabled: loading, className: `self-start px-4 py-2 rounded-lg text-xs font-bold border transition-all
            ${loading
                            ? 'bg-cyan-950 border-cyan-700 text-cyan-300 animate-pulse cursor-not-allowed'
                            : 'bg-[#21262d] border-[#30363d] text-[#8b949e] hover:border-[#58a6ff]/50 hover:text-[#e6edf3]'}`, children: loading ? '⏳ Loading…' : '⟳ Reload' })] }), _jsxs("div", { className: "flex items-center gap-3 flex-wrap", children: [_jsx("span", { className: "text-xs text-[#8b949e] font-semibold", children: "Max gap from best buy:" }), _jsx("div", { className: "flex gap-1", children: THRESHOLDS.map(t => (_jsxs("button", { onClick: () => setMaxGap(t), className: `px-3 py-1.5 rounded-lg text-xs font-medium border transition-all tabular-nums
                ${maxGap === t
                                ? 'bg-[#21262d] border-[#58a6ff] text-[#58a6ff]'
                                : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] hover:border-[#8b949e]/50'}`, children: ["\u2264 ", t, "%"] }, t))) }), _jsx("div", { className: "h-4 w-px bg-[#30363d]" }), _jsxs("button", { onClick: () => setStrongOnly(v => !v), className: `px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
            ${strongOnly
                            ? 'bg-emerald-950 border-emerald-600 text-emerald-300'
                            : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] hover:border-[#8b949e]/50'}`, children: [strongOnly ? '● ' : '○ ', "Strong only"] }), _jsxs("span", { className: "text-xs text-[#8b949e] ml-auto tabular-nums", children: [rows.length, " buyable", !strongOnly && strongCount > 0 && (_jsxs("span", { className: "text-emerald-300", children: [" \u00B7 ", strongCount, " strong"] }))] })] }), loading && (_jsx("div", { className: "text-center py-12 text-[#8b949e] text-sm animate-pulse", children: "Loading buy signals\u2026" })), !loading && (_jsx("div", { className: "overflow-x-auto rounded-lg border border-[#30363d]", children: _jsxs("table", { className: "w-full text-xs", children: [_jsx("thead", { className: "text-[#8b949e] uppercase tracking-wider text-[11px]", children: _jsxs("tr", { children: [_jsx("th", { className: "px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Symbol" }), _jsx("th", { className: "px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Company" }), _jsx("th", { className: "px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Exch" }), _jsx("th", { className: "px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Phase" }), _jsx("th", { className: "px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Strength" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Price (K\u20AB)" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22] text-emerald-400", children: "\u25B6 Best Buy" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22] text-amber-400", children: "Gap" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22] text-red-400", children: "\u2715 Stop" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Target" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22] text-amber-400", children: "R:R" }), _jsx("th", { className: "px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Setup" })] }) }), _jsxs("tbody", { children: [rows.length === 0 && (_jsx("tr", { children: _jsxs("td", { colSpan: 12, className: "px-4 py-10 text-center text-[#8b949e]", children: ["No BUY setups within ", maxGap, "% of their best-buy price right now. Try a wider gap or run ", _jsx("span", { className: "text-[#58a6ff]", children: "Refresh Analysis" }), " on the Wyckoff tab."] }) })), rows.map((row, i) => (_jsxs("tr", { className: `border-t border-[#30363d]/50 cursor-pointer transition-all
                    hover:bg-[#21262d] hover:ring-1 hover:ring-inset hover:ring-[#58a6ff]/20
                    ${i % 2 === 0 ? '' : 'bg-[#161b22]/30'}`, style: { borderLeft: '4px solid #34d399' }, onClick: () => setDetail({ symbol: row.symbol, name: row.name ?? row.symbol }), children: [_jsx("td", { className: "px-3 py-2.5", children: _jsx("span", { className: "font-bold text-emerald-400 tracking-wide", children: row.symbol }) }), _jsx("td", { className: "px-3 py-2.5 max-w-[150px]", children: _jsx("span", { className: "text-[#e6edf3] truncate block", title: row.name, children: row.name ?? '—' }) }), _jsx("td", { className: "px-3 py-2.5 text-center", children: _jsx(ExchangeBadge, { exchange: row.exchange ?? '' }) }), _jsx("td", { className: "px-3 py-2.5", children: _jsx(PhaseLabel, { phase: row.phase, sub: row.sub_phase }) }), _jsx("td", { className: "px-3 py-2.5 text-center", children: _jsx(StrengthBadge, { strength: row.signal_strength }) }), _jsx("td", { className: "px-3 py-2.5 text-right font-medium text-[#e6edf3] tabular-nums", children: fmtPrice(row.current_price) }), _jsx("td", { className: "px-3 py-2.5 text-right tabular-nums", children: _jsx("span", { className: "font-bold text-emerald-300 bg-emerald-950/60 px-1.5 py-0.5 rounded", children: fmtPrice(row.entry_price) }) }), _jsx("td", { className: "px-3 py-2.5 text-right", children: _jsx(GapBadge, { gapPct: row.gapPct }) }), _jsx("td", { className: "px-3 py-2.5 text-right tabular-nums", children: row.stop_loss != null
                                                ? _jsx("span", { className: "font-medium text-red-300/90", children: fmtPrice(row.stop_loss) })
                                                : _jsx("span", { className: "text-[#8b949e]", children: "\u2014" }) }), _jsx("td", { className: "px-3 py-2.5 text-right text-red-400/80 tabular-nums", children: row.resistance != null ? fmtPrice(row.resistance) : '—' }), _jsx("td", { className: "px-3 py-2.5 text-right tabular-nums", children: row.rr != null ? (_jsxs("span", { className: `font-bold text-xs px-1.5 py-0.5 rounded ${row.rr >= 3 ? 'text-emerald-300 bg-emerald-950/60' :
                                                    row.rr >= 2 ? 'text-amber-300 bg-amber-950/60' :
                                                        'text-[#8b949e]'}`, children: ["1:", row.rr.toFixed(1)] })) : _jsx("span", { className: "text-[#8b949e]", children: "\u2014" }) }), _jsx("td", { className: "px-3 py-2.5 max-w-[260px]", children: _jsx("span", { className: "text-[#8b949e] truncate block text-[11px]", title: row.description, children: row.description }) })] }, row.symbol)))] })] }) })), _jsx("p", { className: "text-xs text-[#8b949e]/40 text-right", children: "Buyable = Wyckoff BUY with current price within the chosen gap of best-buy entry \u00B7 not financial advice" }), detail && (_jsx(SymbolModal, { symbol: detail.symbol, name: detail.name, onClose: () => setDetail(null) }))] }));
}
