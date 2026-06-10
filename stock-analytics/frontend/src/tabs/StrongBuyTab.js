import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
const STRENGTH_RANK = { STRONG: 0, MODERATE: 1, WEAK: 2 };
function ScorePill({ score }) {
    const color = score >= 70 ? '#34d399' : score >= 55 ? '#a3e635' : '#f59e0b';
    return (_jsx("span", { className: "font-bold tabular-nums px-1.5 py-0.5 rounded text-xs", style: { color, background: `${color}22` }, children: score }));
}
function GapBadge({ gapPct }) {
    if (gapPct == null)
        return _jsx("span", { className: "text-[#8b949e]", children: "\u2014" });
    const below = gapPct <= 0;
    const sign = gapPct > 0 ? '+' : gapPct < 0 ? '−' : '';
    return (_jsxs("span", { className: `font-bold text-xs px-1.5 py-0.5 rounded tabular-nums ${below ? 'text-emerald-300 bg-emerald-950/60' : 'text-amber-300 bg-amber-950/60'}`, children: [sign, Math.abs(gapPct).toFixed(2), "%"] }));
}
// ── Main tab ──────────────────────────────────────────────────────────────────
const GAP_THRESHOLDS = [1, 2, 3, 5, 100];
export function StrongBuyTab() {
    const [wyckoff, setWyckoff] = useState(null);
    const [multi, setMulti] = useState(null);
    const [loading, setLoading] = useState(false);
    const [maxGap, setMaxGap] = useState(3);
    const [highOnly, setHighOnly] = useState(false);
    const [detail, setDetail] = useState(null);
    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [w, m] = await Promise.all([
                api.wyckoffSignals('BUY', '', 4000),
                api.multifactorSignals('BUY', 0, '', 4000),
            ]);
            setWyckoff(w.items);
            setMulti(m.items);
        }
        finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { load(); }, [load]);
    // Intersect by symbol → only stocks both engines call BUY.
    const rows = useMemo(() => {
        if (!wyckoff || !multi)
            return [];
        const mfBySymbol = new Map(multi.map(m => [m.symbol, m]));
        const out = [];
        for (const w of wyckoff) {
            const m = mfBySymbol.get(w.symbol);
            if (!m)
                continue;
            if (highOnly && m.confidence !== 'HIGH')
                continue;
            const entry = w.entry_price ?? m.entry_price;
            const gapPct = (entry != null && entry > 0 && w.current_price != null)
                ? ((w.current_price - entry) / entry) * 100
                : null;
            if (gapPct != null && Math.abs(gapPct) > maxGap)
                continue;
            const stop = w.stop_loss ?? m.stop_loss;
            const rr = (entry != null && stop != null && w.resistance != null && entry > stop)
                ? (w.resistance - entry) / (entry - stop)
                : null;
            out.push({
                symbol: w.symbol,
                name: w.name ?? w.symbol,
                exchange: w.exchange ?? null,
                current_price: w.current_price,
                phase: w.phase,
                sub_phase: w.sub_phase,
                strength: w.signal_strength,
                entry_price: entry,
                stop_loss: stop,
                resistance: w.resistance,
                score: m.total_score,
                confidence: m.confidence,
                factors_agreed: m.factors_agreed,
                gapPct,
                rr,
            });
        }
        // Highest multi-factor score first; STRONG Wyckoff breaks ties.
        out.sort((a, b) => {
            if (b.score !== a.score)
                return b.score - a.score;
            return (STRENGTH_RANK[a.strength] ?? 9) - (STRENGTH_RANK[b.strength] ?? 9);
        });
        return out;
    }, [wyckoff, multi, maxGap, highOnly]);
    const highCount = rows.filter(r => r.confidence === 'HIGH').length;
    return (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex items-start justify-between gap-3 flex-wrap", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-base font-bold text-emerald-400 flex items-center gap-2", children: "\uD83D\uDD25 Strong Buy" }), _jsxs("p", { className: "text-xs text-[#8b949e] mt-1 max-w-2xl", children: ["Consensus picks \u2014 symbols flagged ", _jsx("span", { className: "text-emerald-300 font-semibold", children: "BUY" }), " by", _jsx("span", { className: "text-cyan-300 font-semibold", children: " both" }), " the Wyckoff engine and the Multi-factor score, with price within ", _jsx("span", { className: "text-emerald-300 font-semibold", children: maxGap === 100 ? 'any' : `${maxGap}%` }), " of the best-buy entry. Two independent methods agreeing = higher conviction."] })] }), _jsx("button", { onClick: load, disabled: loading, className: `self-start px-4 py-2 rounded-lg text-xs font-bold border transition-all
            ${loading
                            ? 'bg-cyan-950 border-cyan-700 text-cyan-300 animate-pulse cursor-not-allowed'
                            : 'bg-[#21262d] border-[#30363d] text-[#8b949e] hover:border-[#58a6ff]/50 hover:text-[#e6edf3]'}`, children: loading ? '⏳ Loading…' : '⟳ Reload' })] }), _jsxs("div", { className: "flex items-center gap-3 flex-wrap", children: [_jsx("span", { className: "text-xs text-[#8b949e] font-semibold", children: "Max gap from best buy:" }), _jsx("div", { className: "flex gap-1", children: GAP_THRESHOLDS.map(t => (_jsx("button", { onClick: () => setMaxGap(t), className: `px-3 py-1.5 rounded-lg text-xs font-medium border transition-all tabular-nums
                ${maxGap === t
                                ? 'bg-[#21262d] border-[#58a6ff] text-[#58a6ff]'
                                : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] hover:border-[#8b949e]/50'}`, children: t === 100 ? 'Any' : `≤ ${t}%` }, t))) }), _jsx("div", { className: "h-4 w-px bg-[#30363d]" }), _jsxs("button", { onClick: () => setHighOnly(v => !v), className: `px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
            ${highOnly
                            ? 'bg-emerald-950 border-emerald-600 text-emerald-300'
                            : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] hover:border-[#8b949e]/50'}`, children: [highOnly ? '● ' : '○ ', "HIGH confidence only"] }), _jsxs("span", { className: "text-xs text-[#8b949e] ml-auto tabular-nums", children: [rows.length, " consensus", !highOnly && highCount > 0 && _jsxs("span", { className: "text-emerald-300", children: [" \u00B7 ", highCount, " high"] })] })] }), loading && (_jsx("div", { className: "text-center py-12 text-[#8b949e] text-sm animate-pulse", children: "Loading consensus signals\u2026" })), !loading && (_jsx("div", { className: "overflow-x-auto rounded-lg border border-[#30363d]", children: _jsxs("table", { className: "w-full text-xs", children: [_jsx("thead", { className: "text-[#8b949e] uppercase tracking-wider text-[11px]", children: _jsxs("tr", { children: [_jsx("th", { className: "px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Symbol" }), _jsx("th", { className: "px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Company" }), _jsx("th", { className: "px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Exch" }), _jsx("th", { className: "px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Wyckoff Phase" }), _jsx("th", { className: "px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22] text-purple-400", children: "MF Score" }), _jsx("th", { className: "px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Conf" }), _jsx("th", { className: "px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Agree" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Price (K\u20AB)" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22] text-emerald-400", children: "\u25B6 Best Buy" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22] text-amber-400", children: "Gap" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22] text-red-400", children: "\u2715 Stop" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Target" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22] text-amber-400", children: "R:R" })] }) }), _jsxs("tbody", { children: [rows.length === 0 && (_jsx("tr", { children: _jsxs("td", { colSpan: 13, className: "px-4 py-10 text-center text-[#8b949e]", children: ["No symbols are BUY in both engines within the chosen gap. Widen the gap, drop HIGH-only, or run ", _jsx("span", { className: "text-[#58a6ff]", children: "Recalculate All" }), " on the Wyckoff and Multi-Factor tabs."] }) })), rows.map((row, i) => (_jsxs("tr", { className: `border-t border-[#30363d]/50 cursor-pointer transition-all
                    hover:bg-[#21262d] hover:ring-1 hover:ring-inset hover:ring-[#58a6ff]/20
                    ${i % 2 === 0 ? '' : 'bg-[#161b22]/30'}`, style: { borderLeft: '4px solid #34d399' }, onClick: () => setDetail({ symbol: row.symbol, name: row.name }), children: [_jsx("td", { className: "px-3 py-2.5", children: _jsx("span", { className: "font-bold text-emerald-400 tracking-wide", children: row.symbol }) }), _jsx("td", { className: "px-3 py-2.5 max-w-[150px]", children: _jsx("span", { className: "text-[#e6edf3] truncate block", title: row.name, children: row.name }) }), _jsx("td", { className: "px-3 py-2.5 text-center", children: _jsx(ExchangeBadge, { exchange: row.exchange ?? '' }) }), _jsx("td", { className: "px-3 py-2.5", children: _jsxs("span", { className: `font-semibold ${PHASE_COLOR[row.phase] ?? 'text-[#8b949e]'}`, children: [row.phase, " ", row.sub_phase !== '-' && _jsxs("span", { className: "font-bold", children: ["\u00B7", row.sub_phase] })] }) }), _jsx("td", { className: "px-3 py-2.5 text-center", children: _jsx(ScorePill, { score: row.score }) }), _jsx("td", { className: "px-3 py-2.5 text-center", children: _jsx("span", { className: `text-xs font-bold ${row.confidence === 'HIGH' ? 'text-emerald-300' :
                                                    row.confidence === 'MEDIUM' ? 'text-amber-300' : 'text-[#8b949e]'}`, children: row.confidence }) }), _jsx("td", { className: "px-3 py-2.5 text-center", children: _jsxs("span", { className: `font-bold tabular-nums ${row.factors_agreed >= 3 ? 'text-emerald-300' :
                                                    row.factors_agreed === 2 ? 'text-amber-300' : 'text-[#8b949e]'}`, children: [row.factors_agreed, "/4"] }) }), _jsx("td", { className: "px-3 py-2.5 text-right font-medium text-[#e6edf3] tabular-nums", children: row.current_price != null ? fmtPrice(row.current_price) : '—' }), _jsx("td", { className: "px-3 py-2.5 text-right tabular-nums", children: row.entry_price != null ? (_jsx("span", { className: "font-bold text-emerald-300 bg-emerald-950/60 px-1.5 py-0.5 rounded", children: fmtPrice(row.entry_price) })) : _jsx("span", { className: "text-[#8b949e]", children: "\u2014" }) }), _jsx("td", { className: "px-3 py-2.5 text-right", children: _jsx(GapBadge, { gapPct: row.gapPct }) }), _jsx("td", { className: "px-3 py-2.5 text-right tabular-nums", children: row.stop_loss != null
                                                ? _jsx("span", { className: "font-medium text-red-300/90", children: fmtPrice(row.stop_loss) })
                                                : _jsx("span", { className: "text-[#8b949e]", children: "\u2014" }) }), _jsx("td", { className: "px-3 py-2.5 text-right text-red-400/80 tabular-nums", children: row.resistance != null ? fmtPrice(row.resistance) : '—' }), _jsx("td", { className: "px-3 py-2.5 text-right tabular-nums", children: row.rr != null ? (_jsxs("span", { className: `font-bold text-xs px-1.5 py-0.5 rounded ${row.rr >= 3 ? 'text-emerald-300 bg-emerald-950/60' :
                                                    row.rr >= 2 ? 'text-amber-300 bg-amber-950/60' : 'text-[#8b949e]'}`, children: ["1:", row.rr.toFixed(1)] })) : _jsx("span", { className: "text-[#8b949e]", children: "\u2014" }) })] }, row.symbol)))] })] }) })), _jsx("p", { className: "text-xs text-[#8b949e]/40 text-right", children: "Consensus = BUY in both Wyckoff and Multi-factor \u00B7 sorted by multi-factor score \u00B7 not financial advice" }), detail && (_jsx(SymbolModal, { symbol: detail.symbol, name: detail.name, onClose: () => setDetail(null) }))] }));
}
