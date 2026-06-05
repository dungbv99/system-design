import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useRef, useState, useEffect } from 'react';
import { api, PAGE_SIZE } from '../api';
import { fmtPrice, fmtVol } from '../utils';
import { ChangePct, ExchangeBadge, Sparkline, EXCHANGES } from '../components/ui';
import { SymbolModal } from '../components/SymbolModal';
export function MarketTab() {
    const [data, setData] = useState(null);
    const [query, setQuery] = useState('');
    const [exchange, setExchange] = useState('');
    const [offset, setOffset] = useState(0);
    const [detail, setDetail] = useState(null);
    const [loading, setLoading] = useState(false);
    const [sortKey, setSortKey] = useState('change_pct');
    const [sortAsc, setSortAsc] = useState(false);
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
    const handleSort = (key) => {
        if (sortKey === key)
            setSortAsc(a => !a);
        else {
            setSortKey(key);
            setSortAsc(key === 'symbol');
        }
    };
    const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
    const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
    const SortTh = ({ col, label, right }) => (_jsxs("th", { className: `px-4 py-3 font-semibold cursor-pointer select-none whitespace-nowrap
                  hover:text-[#e6edf3] transition-colors sticky top-0 z-10 bg-[#161b22]
                  ${right ? 'text-right' : 'text-left'}`, onClick: () => handleSort(col), children: [label, sortKey === col && _jsx("span", { className: "ml-1 text-[#58a6ff]", children: sortAsc ? '↑' : '↓' })] }));
    // Client-side sort of current page data
    const sorted = data ? [...data.items].sort((a, b) => {
        const av = a[sortKey] ?? (sortAsc ? Infinity : -Infinity);
        const bv = b[sortKey] ?? (sortAsc ? Infinity : -Infinity);
        if (typeof av === 'string' && typeof bv === 'string')
            return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
        return sortAsc ? av - bv : bv - av;
    }) : [];
    return (_jsxs("div", { children: [_jsxs("div", { className: "flex items-center gap-3 mb-4 flex-wrap", children: [_jsx("input", { type: "text", placeholder: "Search symbol or company name\u2026", value: query, onChange: e => handleSearch(e.target.value), className: "bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-[#e6edf3]\n                     w-72 focus:outline-none focus:border-[#58a6ff]/60 placeholder-[#8b949e] transition-colors" }), _jsx("div", { className: "flex gap-1.5", children: EXCHANGES.map(exc => (_jsx("button", { onClick: () => handleExchange(exc.value), className: `px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${exchange === exc.value
                                ? `${exc.color} border-current`
                                : 'bg-transparent border-[#30363d] text-[#8b949e] hover:border-[#58a6ff]/40 hover:text-[#e6edf3]'}`, children: exc.label }, exc.value))) }), data && _jsxs("span", { className: "text-xs text-[#8b949e]", children: [data.total.toLocaleString(), " symbols"] }), loading && _jsx("span", { className: "text-xs text-[#8b949e] animate-pulse", children: "Loading\u2026" })] }), _jsx("div", { className: "overflow-x-auto rounded-lg border border-[#30363d]", children: _jsxs("table", { className: "w-full text-xs", children: [_jsx("thead", { className: "text-[#8b949e] uppercase tracking-wider text-[11px]", children: _jsxs("tr", { children: [_jsx(SortTh, { col: "symbol", label: "Symbol" }), _jsx("th", { className: "px-4 py-3 text-left font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Company" }), _jsx(SortTh, { col: "close", label: "Close (K\u20AB)", right: true }), _jsx(SortTh, { col: "change_pct", label: "Change", right: true }), _jsx(SortTh, { col: "volume", label: "Volume", right: true }), _jsx("th", { className: "px-4 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Trend" }), _jsx("th", { className: "px-4 py-3 text-left font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Date" })] }) }), _jsxs("tbody", { children: [sorted.length === 0 && !loading && (_jsx("tr", { children: _jsx("td", { colSpan: 7, className: "px-4 py-10 text-center text-[#8b949e]", children: "No symbols found" }) })), sorted.map((row, idx) => (_jsxs("tr", { className: `border-t border-[#30363d]/50 cursor-pointer transition-all
                    hover:bg-[#21262d] hover:ring-1 hover:ring-inset hover:ring-[#58a6ff]/20
                    ${idx % 2 === 0 ? '' : 'bg-[#161b22]/30'}`, onClick: () => setDetail(row), children: [_jsx("td", { className: "px-4 py-2.5", children: _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "font-bold text-emerald-400 tracking-wide", children: row.symbol }), _jsx(ExchangeBadge, { exchange: row.exchange })] }) }), _jsx("td", { className: "px-4 py-2.5 max-w-[220px]", children: _jsx("span", { className: "text-[#e6edf3] truncate block", title: row.name, children: row.name }) }), _jsx("td", { className: "px-4 py-2.5 text-right font-medium text-[#e6edf3] tabular-nums", children: fmtPrice(row.close) }), _jsx("td", { className: "px-4 py-2.5 text-right", children: _jsx(ChangePct, { v: row.change_pct }) }), _jsx("td", { className: "px-4 py-2.5 text-right text-[#8b949e] tabular-nums", children: fmtVol(row.volume) }), _jsx("td", { className: "px-4 py-2.5 text-center", children: row.close != null
                                                ? _jsx(Sparkline, { prices: [row.prev_close ?? row.close, row.close] })
                                                : _jsx("span", { className: "text-[#8b949e]", children: "\u2014" }) }), _jsx("td", { className: "px-4 py-2.5 text-[#8b949e] whitespace-nowrap", children: row.latest_date ?? '—' })] }, row.symbol)))] })] }) }), totalPages > 1 && (_jsxs("div", { className: "flex items-center justify-between mt-3 text-xs text-[#8b949e]", children: [_jsxs("span", { children: ["Page ", currentPage, " of ", totalPages] }), _jsxs("div", { className: "flex gap-1.5", children: [_jsx("button", { disabled: offset === 0, onClick: () => { const o = Math.max(0, offset - PAGE_SIZE); setOffset(o); load(query, o, exchange); }, className: "px-3 py-1.5 rounded-lg bg-[#21262d] border border-[#30363d] hover:border-[#58a6ff]/40\n                         hover:text-[#e6edf3] disabled:opacity-40 disabled:cursor-not-allowed transition-all", children: "\u2190 Prev" }), _jsx("button", { disabled: offset + PAGE_SIZE >= (data?.total ?? 0), onClick: () => { const o = offset + PAGE_SIZE; setOffset(o); load(query, o, exchange); }, className: "px-3 py-1.5 rounded-lg bg-[#21262d] border border-[#30363d] hover:border-[#58a6ff]/40\n                         hover:text-[#e6edf3] disabled:opacity-40 disabled:cursor-not-allowed transition-all", children: "Next \u2192" })] })] })), detail && (_jsx(SymbolModal, { symbol: detail.symbol, name: detail.name, onClose: () => setDetail(null) }))] }));
}
