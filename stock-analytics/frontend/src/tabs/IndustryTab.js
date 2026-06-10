import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, VN_SECTORS } from '../api';
import { fmtPrice, fmtVol } from '../utils';
import { ExchangeBadge, Sparkline, ChangePct } from '../components/ui';
import { SymbolModal } from '../components/SymbolModal';
const SIG_STYLE = {
    BUY: { bg: 'bg-emerald-950', text: 'text-emerald-300', border: 'border-emerald-700' },
    SHORT: { bg: 'bg-red-950', text: 'text-red-300', border: 'border-red-700' },
    HOLD: { bg: 'bg-blue-950', text: 'text-blue-300', border: 'border-blue-700' },
    WAIT: { bg: 'bg-[#21262d]', text: 'text-[#8b949e]', border: 'border-[#30363d]' },
};
const STRENGTH_DOT = {
    STRONG: 'bg-emerald-400', MODERATE: 'bg-amber-400', WEAK: 'bg-[#555]',
};
const PHASE_SHORT = {
    Accumulation: 'Acc', Distribution: 'Dist', Markup: 'Up', Markdown: 'Down',
};
function PredictionCell({ p }) {
    if (!p)
        return _jsx("span", { className: "text-[#8b949e]/50 text-[10px]", children: "\u2014" });
    const isBuy = p.signal === 'BUY';
    const pct = Math.round(p.score * 100);
    return (_jsxs("div", { className: "flex flex-col items-center gap-0.5", children: [_jsx("span", { className: `inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-bold ${isBuy
                    ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                    : 'bg-[#21262d] text-[#8b949e] border-[#30363d]'}`, children: p.signal }), _jsxs("div", { className: "flex items-center gap-1", children: [_jsx("div", { className: "w-10 h-1 rounded-full bg-[#30363d] overflow-hidden", children: _jsx("div", { className: `h-full rounded-full ${isBuy ? 'bg-emerald-500' : 'bg-[#555]'}`, style: { width: `${pct}%` } }) }), _jsxs("span", { className: `text-[9px] tabular-nums ${isBuy ? 'text-emerald-400' : 'text-[#8b949e]'}`, children: [pct, "%"] })] })] }));
}
function WyckoffCell({ w }) {
    if (!w || w.signal === 'WAIT') {
        return _jsx("span", { className: "text-[#8b949e]/50 text-[10px]", children: "\u2014" });
    }
    const s = SIG_STYLE[w.signal] ?? SIG_STYLE.WAIT;
    const d = STRENGTH_DOT[w.signal_strength] ?? STRENGTH_DOT.WEAK;
    const phase = PHASE_SHORT[w.phase] ?? w.phase;
    const sub = w.sub_phase !== '-' ? `·${w.sub_phase}` : '';
    return (_jsxs("div", { className: "flex flex-col items-center gap-0.5", children: [_jsxs("span", { className: `inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-bold
                        ${s.bg} ${s.text} ${s.border}`, children: [_jsx("span", { className: `w-1.5 h-1.5 rounded-full shrink-0 ${d}` }), w.signal] }), _jsxs("span", { className: "text-[9px] text-[#8b949e]", children: [phase, sub] })] }));
}
export function IndustryTab() {
    const [activeSector, setActiveSector] = useState('vnfin');
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [detail, setDetail] = useState(null);
    const [sortKey, setSortKey] = useState('change_pct');
    const [sortAsc, setSortAsc] = useState(false);
    const [wyckoffMap, setWyckoffMap] = useState(new Map());
    const [predMap, setPredMap] = useState(new Map());
    const [liveSymbols, setLiveSymbols] = useState({});
    const [refreshing, setRefreshing] = useState(false);
    useEffect(() => {
        api.wyckoffSignals('', '', 2000).then(d => {
            setWyckoffMap(new Map(d.items.map(w => [w.symbol, w])));
        }).catch(() => { });
        api.predictions('', 5, 2000).then(d => {
            setPredMap(new Map(d.items.map(p => [p.symbol, p])));
        }).catch(() => { });
    }, []);
    const sec = VN_SECTORS[activeSector];
    const refreshCompositions = useCallback(() => {
        setRefreshing(true);
        api.compositions()
            .then(c => { setLiveSymbols(c); setData(null); })
            .catch(() => { })
            .finally(() => setRefreshing(false));
    }, []);
    const load = useCallback((key) => {
        const s = VN_SECTORS[key];
        const syms = liveSymbols[key] ?? s.symbols;
        setLoading(true);
        api.symbols('', syms.length, 0, '', syms.join(','))
            .then(d => { setData(d); setLoading(false); });
    }, [liveSymbols]);
    useEffect(() => { load(activeSector); }, [load, activeSector]);
    const handleSector = (key) => { setActiveSector(key); setData(null); };
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
            let av, bv;
            if (sortKey === 'xgb_score') {
                av = predMap.get(a.symbol)?.score ?? (sortAsc ? Infinity : -Infinity);
                bv = predMap.get(b.symbol)?.score ?? (sortAsc ? Infinity : -Infinity);
            }
            else {
                av = a[sortKey] ?? (sortAsc ? Infinity : -Infinity);
                bv = b[sortKey] ?? (sortAsc ? Infinity : -Infinity);
            }
            if (typeof av === 'string' && typeof bv === 'string')
                return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
            return sortAsc ? av - bv : bv - av;
        });
    }, [data, sortKey, sortAsc, predMap]);
    const advances = sorted.filter(r => (r.change_pct ?? 0) > 0).length;
    const declines = sorted.filter(r => (r.change_pct ?? 0) < 0).length;
    const unchanged = sorted.filter(r => r.change_pct != null && r.change_pct === 0).length;
    const noData = sorted.filter(r => r.change_pct == null).length;
    const SortTh = ({ col, label, right }) => (_jsxs("th", { className: `px-3 py-3 font-semibold cursor-pointer select-none whitespace-nowrap
                  hover:text-[#e6edf3] transition-colors sticky top-0 z-10 bg-[#161b22]
                  ${right ? 'text-right' : 'text-left'}`, onClick: () => handleSort(col), children: [label, sortKey === col && _jsx("span", { className: "ml-1 text-[#58a6ff]", children: sortAsc ? '↑' : '↓' })] }));
    return (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex items-center justify-between gap-2 mb-1", children: [_jsx("span", { className: "text-xs text-[#8b949e]", children: "Select a sector to view its stocks" }), _jsxs("button", { onClick: refreshCompositions, disabled: refreshing, title: "Fetch latest sector compositions from SSI", className: `flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all
            ${refreshing
                            ? 'border-[#30363d] text-[#8b949e] cursor-not-allowed'
                            : 'border-[#58a6ff]/40 text-[#58a6ff] hover:bg-[#58a6ff]/10 hover:border-[#58a6ff]'}`, children: [_jsx("span", { children: "\u21BA" }), refreshing ? 'Fetching…' : 'Refresh Symbols'] })] }), _jsx("div", { className: "grid grid-cols-2 sm:grid-cols-5 gap-3", children: Object.keys(VN_SECTORS).map(key => {
                    const s = VN_SECTORS[key];
                    const active = key === activeSector;
                    const live = liveSymbols[key];
                    const count = live ? live.length : s.symbols.length;
                    return (_jsxs("button", { onClick: () => handleSector(key), className: `rounded-xl p-4 text-left border-2 transition-all hover:scale-[1.01] ${active
                            ? 'shadow-lg scale-[1.02] border-current'
                            : 'border-[#30363d] hover:border-[#8b949e]/50 bg-[#161b22]/50'}`, style: active ? { borderColor: s.color, background: `${s.color}14` } : {}, children: [_jsx("div", { className: "font-bold text-sm", style: active ? { color: s.color } : { color: '#8b949e' }, children: s.label }), _jsx("div", { className: "text-xs mt-0.5", style: { color: active ? `${s.color}99` : '#6e7681' }, children: s.labelVi }), _jsxs("div", { className: "text-xs text-[#8b949e] mt-0.5", children: [count, " stocks", live ? ' ✓' : ''] }), active && data && (_jsxs("div", { className: "flex gap-2 mt-1.5 text-xs", children: [_jsxs("span", { className: "text-emerald-400", children: ["\u25B2 ", advances] }), _jsxs("span", { className: "text-red-400", children: ["\u25BC ", declines] })] }))] }, key));
                }) }), data && !loading && (_jsxs("div", { className: "bg-[#161b22] border border-[#30363d] rounded-lg px-4 py-3 flex items-center gap-6 flex-wrap", children: [_jsx("span", { className: "text-xs font-bold text-[#e6edf3]", children: sec.label }), _jsx("span", { className: "text-xs text-[#8b949e]", children: sec.labelVi }), _jsxs("div", { className: "flex items-center gap-1.5", children: [_jsx("div", { className: "h-2 rounded-full bg-emerald-500", style: { width: `${Math.max(advances * 4, 4)}px` } }), _jsxs("span", { className: "text-xs text-emerald-400 font-semibold", children: ["\u25B2 ", advances] })] }), _jsxs("div", { className: "flex items-center gap-1.5", children: [_jsx("div", { className: "h-2 rounded-full bg-red-500", style: { width: `${Math.max(declines * 4, 4)}px` } }), _jsxs("span", { className: "text-xs text-red-400 font-semibold", children: ["\u25BC ", declines] })] }), unchanged > 0 && _jsxs("span", { className: "text-xs text-[#8b949e]", children: ["= ", unchanged] }), noData > 0 && _jsxs("span", { className: "text-xs text-[#8b949e]/60", children: ["no data: ", noData] }), _jsx("span", { className: "text-xs text-[#8b949e]/60 ml-auto", children: "click column header to sort" })] })), loading && (_jsxs("div", { className: "text-center py-12 text-[#8b949e] text-sm animate-pulse", children: ["Loading ", sec.label, "\u2026"] })), !loading && data && (_jsx("div", { className: "overflow-x-auto rounded-lg border border-[#30363d]", children: _jsxs("table", { className: "w-full text-xs", children: [_jsx("thead", { className: "text-[#8b949e] uppercase tracking-wider text-[11px]", children: _jsxs("tr", { children: [_jsx(SortTh, { col: "symbol", label: "Symbol" }), _jsx("th", { className: "px-3 py-3 text-left font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Company" }), _jsx("th", { className: "px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Exch" }), _jsx(SortTh, { col: "close", label: "Close (K\u20AB)", right: true }), _jsx(SortTh, { col: "change_pct", label: "Change", right: true }), _jsx("th", { className: "px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Wyckoff" }), _jsxs("th", { className: "px-3 py-3 text-center font-semibold cursor-pointer select-none whitespace-nowrap\n                             hover:text-[#e6edf3] transition-colors sticky top-0 z-10 bg-[#161b22] text-purple-400", onClick: () => {
                                            if (sortKey === 'xgb_score')
                                                setSortAsc(a => !a);
                                            else {
                                                setSortKey('xgb_score');
                                                setSortAsc(false);
                                            }
                                        }, children: ["XGB 5d", sortKey === 'xgb_score' && _jsx("span", { className: "ml-1 text-[#58a6ff]", children: sortAsc ? '↑' : '↓' })] }), _jsx("th", { className: "px-3 py-3 text-right font-semibold sticky top-0 z-10 bg-[#161b22] text-emerald-400", children: "\u25B6 Entry" }), _jsx(SortTh, { col: "volume", label: "Volume", right: true }), _jsx("th", { className: "px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Trend" }), _jsx("th", { className: "px-3 py-3 text-left font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Date" })] }) }), _jsxs("tbody", { children: [sorted.length === 0 && (_jsx("tr", { children: _jsx("td", { colSpan: 11, className: "px-4 py-10 text-center text-[#8b949e]", children: "No data \u2014 run a crawl first to populate prices" }) })), sorted.map((row, i) => {
                                    const chgPct = row.change_pct ?? 0;
                                    const hasPct = row.change_pct != null;
                                    const borderColor = !hasPct ? '#30363d'
                                        : chgPct > 0 ? '#34d399'
                                            : chgPct < 0 ? '#f87171'
                                                : '#8b949e';
                                    return (_jsxs("tr", { className: `border-t border-[#30363d]/50 cursor-pointer transition-all
                      hover:bg-[#21262d] hover:ring-1 hover:ring-inset hover:ring-[#58a6ff]/20
                      ${i % 2 === 0 ? '' : 'bg-[#161b22]/30'}`, style: { borderLeft: `4px solid ${borderColor}` }, onClick: () => setDetail(row), children: [_jsx("td", { className: "px-3 py-2.5", children: _jsx("span", { className: "font-bold text-emerald-400 tracking-wide", children: row.symbol }) }), _jsx("td", { className: "px-3 py-2.5 max-w-[180px]", children: _jsx("span", { className: "text-[#e6edf3] truncate block", title: row.name, children: row.name }) }), _jsx("td", { className: "px-3 py-2.5 text-center", children: _jsx(ExchangeBadge, { exchange: row.exchange }) }), _jsx("td", { className: "px-3 py-2.5 text-right font-medium text-[#e6edf3] tabular-nums", children: fmtPrice(row.close) }), _jsx("td", { className: "px-3 py-2.5 text-right", children: _jsx(ChangePct, { v: row.change_pct }) }), _jsx("td", { className: "px-3 py-2.5 text-center", children: _jsx(WyckoffCell, { w: wyckoffMap.get(row.symbol) }) }), _jsx("td", { className: "px-3 py-2.5 text-center", children: _jsx(PredictionCell, { p: predMap.get(row.symbol) }) }), _jsx("td", { className: "px-3 py-2.5 text-right tabular-nums", children: (() => {
                                                    const w = wyckoffMap.get(row.symbol);
                                                    if (!w?.entry_price)
                                                        return _jsx("span", { className: "text-[#8b949e]/50", children: "\u2014" });
                                                    return (_jsx("span", { className: `font-bold px-1.5 py-0.5 rounded text-[11px]
                            ${w.signal === 'BUY' ? 'text-emerald-300 bg-emerald-950/60' :
                                                            w.signal === 'SHORT' ? 'text-red-300 bg-red-950/60' :
                                                                'text-[#e6edf3]'}`, children: fmtPrice(w.entry_price) }));
                                                })() }), _jsx("td", { className: "px-3 py-2.5 text-right text-[#8b949e] tabular-nums", children: fmtVol(row.volume) }), _jsx("td", { className: "px-3 py-2.5 text-center", children: row.close != null
                                                    ? _jsx(Sparkline, { prices: [row.prev_close ?? row.close, row.close] })
                                                    : _jsx("span", { className: "text-[#8b949e]", children: "\u2014" }) }), _jsx("td", { className: "px-3 py-2.5 text-[#8b949e] whitespace-nowrap", children: row.latest_date ?? '—' })] }, row.symbol));
                                })] })] }) })), _jsx("p", { className: "text-xs text-[#8b949e]/40 text-right", children: "HOSE GICS sectors \u00B7 sourced from SSI iboard indexGroups" }), detail && (_jsx(SymbolModal, { symbol: detail.symbol, name: detail.name, onClose: () => setDetail(null) }))] }));
}
