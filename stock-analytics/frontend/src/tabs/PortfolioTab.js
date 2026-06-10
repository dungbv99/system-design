import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { fmtPrice } from '../utils';
import { ExchangeBadge } from '../components/ui';
import { SymbolModal } from '../components/SymbolModal';
// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtVnd = (v) => v.toLocaleString('vi-VN', { maximumFractionDigits: 0 });
function PL({ value, pct }) {
    const up = value >= 0;
    return (_jsxs("span", { className: `font-bold tabular-nums ${up ? 'text-emerald-300' : 'text-red-300'}`, children: [up ? '+' : '−', fmtVnd(Math.abs(value)), "\u20AB", _jsxs("span", { className: "ml-1 text-[11px] opacity-80", children: ["(", up ? '+' : '', pct.toFixed(2), "%)"] })] }));
}
const FILTERS = ['ALL', 'OPEN', 'CLOSED'];
// ── Main tab ──────────────────────────────────────────────────────────────────
export function PortfolioTab() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState('ALL');
    const [busy, setBusy] = useState(null);
    const [detail, setDetail] = useState(null);
    const load = useCallback(async (f) => {
        setLoading(true);
        try {
            setData(await api.portfolio(f === 'ALL' ? '' : f));
        }
        finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { load(filter); }, [load, filter]);
    const handleClose = async (id) => {
        setBusy(id);
        try {
            await api.closeTrade(id);
            await load(filter);
        }
        finally {
            setBusy(null);
        }
    };
    const handleDelete = async (id) => {
        if (!confirm('Remove this paper trade?'))
            return;
        setBusy(id);
        try {
            await api.deleteTrade(id);
            await load(filter);
        }
        finally {
            setBusy(null);
        }
    };
    const s = data?.summary;
    return (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex gap-3 flex-wrap", children: [_jsxs("div", { className: "flex-1 min-w-[140px] rounded-xl p-3 border-2 bg-[#161b22] border-[#30363d]", children: [_jsxs("div", { className: "text-lg font-bold tabular-nums text-[#e6edf3]", children: [s ? fmtVnd(s.cost) : '—', "\u20AB"] }), _jsx("div", { className: "text-xs mt-0.5 text-[#8b949e]", children: "Invested (open)" })] }), _jsxs("div", { className: "flex-1 min-w-[140px] rounded-xl p-3 border-2 bg-[#161b22] border-[#30363d]", children: [_jsxs("div", { className: "text-lg font-bold tabular-nums text-[#e6edf3]", children: [s ? fmtVnd(s.market_value) : '—', "\u20AB"] }), _jsx("div", { className: "text-xs mt-0.5 text-[#8b949e]", children: "Market value (open)" })] }), _jsxs("div", { className: `flex-1 min-w-[140px] rounded-xl p-3 border-2 bg-[#161b22] ${s && s.pl >= 0 ? 'border-emerald-700' : s ? 'border-red-700' : 'border-[#30363d]'}`, children: [_jsx("div", { className: "text-lg", children: s ? _jsx(PL, { value: s.pl, pct: s.pl_pct }) : _jsx("span", { className: "text-[#8b949e]", children: "\u2014" }) }), _jsx("div", { className: "text-xs mt-0.5 text-[#8b949e]", children: "Unrealised P/L (open)" })] }), _jsxs("div", { className: "flex-1 min-w-[120px] rounded-xl p-3 border-2 bg-[#161b22] border-[#30363d]", children: [_jsxs("div", { className: "text-lg font-bold tabular-nums text-[#e6edf3]", children: [s ? s.open_count : '—', _jsx("span", { className: "text-[#8b949e] text-sm", children: " open" }), _jsxs("span", { className: "text-[#8b949e] text-sm", children: [" \u00B7 ", s ? s.closed_count : '—', " closed"] })] }), _jsx("div", { className: "text-xs mt-0.5 text-[#8b949e]", children: "Positions" })] })] }), _jsxs("div", { className: "flex items-center gap-3 flex-wrap", children: [_jsx("div", { className: "flex gap-1", children: FILTERS.map(f => (_jsx("button", { onClick: () => setFilter(f), className: `px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                ${filter === f
                                ? 'bg-[#21262d] border-[#58a6ff] text-[#58a6ff]'
                                : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] hover:border-[#8b949e]/50'}`, children: f }, f))) }), _jsx("button", { onClick: () => load(filter), className: "px-3 py-1.5 rounded-lg text-xs font-medium border border-[#30363d] text-[#8b949e]\n                     hover:text-[#e6edf3] hover:border-[#58a6ff]/50 transition-all", children: "\u27F3 Refresh" }), data && _jsxs("span", { className: "text-xs text-[#8b949e] ml-auto", children: [data.items.length, " trades"] })] }), loading && (_jsx("div", { className: "text-center py-12 text-[#8b949e] text-sm animate-pulse", children: "Loading portfolio\u2026" })), !loading && data && (_jsx("div", { className: "overflow-x-auto rounded-lg border border-[#30363d]", children: _jsxs("table", { className: "w-full text-xs", children: [_jsx("thead", { className: "text-[#8b949e] uppercase tracking-wider text-[11px]", children: _jsxs("tr", { children: [_jsx("th", { className: "px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Symbol" }), _jsx("th", { className: "px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Exch" }), _jsx("th", { className: "px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Status" }), _jsx("th", { className: "px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Buy Date" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Buy (K\u20AB)" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Qty" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Now / Close" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]", children: "P/L" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22] text-red-400", children: "Stop" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Target" }), _jsx("th", { className: "px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Actions" })] }) }), _jsxs("tbody", { children: [data.items.length === 0 && (_jsx("tr", { children: _jsxs("td", { colSpan: 11, className: "px-4 py-10 text-center text-[#8b949e]", children: ["No paper trades yet. Open a symbol and click ", _jsx("span", { className: "text-emerald-300", children: "\u25B8 Assume Buy" }), ", or use the Buy button on the Buy Now tab."] }) })), data.items.map((t, i) => {
                                    const closed = t.status === 'CLOSED';
                                    return (_jsxs("tr", { className: `border-t border-[#30363d]/50 cursor-pointer transition-all
                      hover:bg-[#21262d] hover:ring-1 hover:ring-inset hover:ring-[#58a6ff]/20
                      ${i % 2 === 0 ? '' : 'bg-[#161b22]/30'}`, style: { borderLeft: `4px solid ${t.pl >= 0 ? '#34d399' : '#f87171'}` }, onClick: () => setDetail({ symbol: t.symbol, name: t.name ?? t.symbol }), children: [_jsxs("td", { className: "px-3 py-2.5", children: [_jsx("span", { className: "font-bold text-emerald-400 tracking-wide", children: t.symbol }), _jsx("div", { className: "text-[#8b949e] truncate max-w-[130px] text-[11px]", title: t.name, children: t.name ?? '' })] }), _jsx("td", { className: "px-3 py-2.5 text-center", children: _jsx(ExchangeBadge, { exchange: t.exchange ?? '' }) }), _jsx("td", { className: "px-3 py-2.5 text-center", children: _jsx("span", { className: `px-2 py-0.5 rounded text-[11px] font-bold border ${closed ? 'bg-[#21262d] text-[#8b949e] border-[#30363d]'
                                                        : 'bg-emerald-950 text-emerald-300 border-emerald-700'}`, children: t.status }) }), _jsx("td", { className: "px-3 py-2.5 text-[#8b949e] tabular-nums", children: t.buy_date }), _jsx("td", { className: "px-3 py-2.5 text-right font-medium text-[#e6edf3] tabular-nums", children: fmtPrice(t.buy_price) }), _jsx("td", { className: "px-3 py-2.5 text-right text-[#8b949e] tabular-nums", children: t.quantity.toLocaleString() }), _jsxs("td", { className: "px-3 py-2.5 text-right tabular-nums text-[#e6edf3]", children: [t.current_price != null ? fmtPrice(t.current_price) : '—', closed && _jsx("span", { className: "text-[#8b949e] text-[10px] block", children: "@ close" })] }), _jsx("td", { className: "px-3 py-2.5 text-right", children: _jsx(PL, { value: t.pl, pct: t.pl_pct }) }), _jsx("td", { className: "px-3 py-2.5 text-right text-red-400/80 tabular-nums", children: t.stop_loss != null ? fmtPrice(t.stop_loss) : '—' }), _jsx("td", { className: "px-3 py-2.5 text-right text-[#8b949e] tabular-nums", children: t.target != null ? fmtPrice(t.target) : '—' }), _jsxs("td", { className: "px-3 py-2.5 text-center whitespace-nowrap", onClick: e => e.stopPropagation(), children: [!closed && (_jsx("button", { onClick: () => handleClose(t.id), disabled: busy === t.id, className: "px-2 py-1 rounded border border-[#30363d] text-[#8b949e] text-[11px]\n                                     hover:border-amber-600 hover:text-amber-300 transition-all disabled:opacity-40 mr-1", children: busy === t.id ? '…' : 'Close' })), _jsx("button", { onClick: () => handleDelete(t.id), disabled: busy === t.id, className: "px-2 py-1 rounded border border-[#30363d] text-[#8b949e] text-[11px]\n                                   hover:border-red-600 hover:text-red-300 transition-all disabled:opacity-40", children: "\u2715" })] })] }, t.id));
                                })] })] }) })), _jsx("p", { className: "text-xs text-[#8b949e]/40 text-right", children: "Paper trades \u2014 assumed buys at market close \u00B7 prices update with the daily crawl \u00B7 not financial advice" }), detail && (_jsx(SymbolModal, { symbol: detail.symbol, name: detail.name, onClose: () => setDetail(null) }))] }));
}
