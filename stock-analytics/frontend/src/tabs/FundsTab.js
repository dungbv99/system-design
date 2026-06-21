import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { fmtDate } from '../utils';
import { ExchangeBadge } from '../components/ui';
import { SymbolModal } from '../components/SymbolModal';
// ── Formatting ────────────────────────────────────────────────────────────────
const fmtPct = (v) => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
const pctColor = (v) => v == null ? 'text-[#8b949e]' : v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-[#8b949e]';
// Stable color per industry for the holding chips
const INDUSTRY_COLORS = [
    '#58a6ff', '#a855f7', '#34d399', '#f59e0b', '#f87171',
    '#22d3ee', '#fb923c', '#c084fc', '#4ade80', '#ec4899',
];
const industryColor = (s) => {
    if (!s)
        return '#8b949e';
    let h = 0;
    for (let i = 0; i < s.length; i++)
        h = (h * 31 + s.charCodeAt(i)) | 0;
    return INDUSTRY_COLORS[Math.abs(h) % INDUSTRY_COLORS.length];
};
// ── Return badges ─────────────────────────────────────────────────────────────
function ReturnRow({ fund }) {
    const items = [
        ['1M', fund.return_1m], ['3M', fund.return_3m],
        ['6M', fund.return_6m], ['12M', fund.return_12m],
    ];
    return (_jsx("div", { className: "flex gap-3 flex-wrap", children: items.map(([k, v]) => (_jsxs("div", { className: "text-center", children: [_jsx("div", { className: `text-xs font-bold tabular-nums ${pctColor(v)}`, children: fmtPct(v) }), _jsx("div", { className: "text-[9px] text-[#8b949e] uppercase", children: k })] }, k))) }));
}
// ── Holding bar ───────────────────────────────────────────────────────────────
function HoldingBar({ h, onClick }) {
    const pct = h.net_asset_percent;
    return (_jsxs("button", { onClick: onClick, title: `${h.stock_code}${h.company_name ? ' · ' + h.company_name : ''}${h.industry ? ' · ' + h.industry : ''}\n${pct.toFixed(2)}% of NAV — click for chart`, className: "group w-full flex items-center gap-2 py-1 px-1.5 rounded hover:bg-[#21262d] transition-colors text-left", children: [_jsx("span", { className: "font-bold text-emerald-400 tracking-wide w-12 shrink-0 group-hover:text-emerald-300", children: h.stock_code }), _jsx("div", { className: "flex-1 h-2 rounded-full bg-[#21262d] overflow-hidden min-w-[40px]", children: _jsx("div", { className: "h-full rounded-full", style: { width: `${Math.min(pct * 6, 100)}%`, background: industryColor(h.industry) } }) }), _jsxs("span", { className: "text-xs text-[#e6edf3] tabular-nums w-12 text-right shrink-0", children: [pct.toFixed(1), "%"] })] }));
}
// ── Fund card ─────────────────────────────────────────────────────────────────
function FundCard({ fund, onPick }) {
    return (_jsxs("div", { className: "bg-[#161b22] border border-[#30363d] rounded-xl p-4 flex flex-col gap-3", children: [_jsxs("div", { className: "flex items-start justify-between gap-2", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("div", { className: "text-base font-bold text-[#58a6ff] tracking-tight", children: fund.short_name }), _jsx("div", { className: "text-[11px] text-[#8b949e] leading-snug line-clamp-2", title: fund.name, children: fund.name }), fund.owner_name && (_jsx("div", { className: "text-[10px] text-[#8b949e]/60 mt-0.5 truncate", title: fund.owner_name, children: fund.owner_name }))] }), _jsx(ReturnRow, { fund: fund })] }), _jsxs("div", { className: "border-t border-[#30363d] pt-2", children: [_jsxs("div", { className: "flex items-center justify-between mb-1", children: [_jsxs("span", { className: "text-[10px] text-[#8b949e] uppercase tracking-wider", children: ["Top holdings (", fund.holdings.length, ")"] }), fund.nav != null && fund.nav > 0 && (_jsxs("span", { className: "text-[10px] text-[#8b949e]", children: ["NAV ", fund.nav.toLocaleString('vi-VN'), " \u20AB"] }))] }), fund.holdings.length === 0 ? (_jsx("div", { className: "text-xs text-[#8b949e]/60 py-2 text-center", children: "No holdings reported" })) : (_jsx("div", { className: "space-y-0.5", children: fund.holdings.map(h => (_jsx(HoldingBar, { h: h, onClick: () => onPick(h.stock_code, h.company_name ?? h.stock_code) }, h.stock_code))) }))] })] }));
}
function buildStockIndex(funds) {
    const map = new Map();
    for (const f of funds) {
        for (const h of f.holdings) {
            let agg = map.get(h.stock_code);
            if (!agg) {
                agg = { stock_code: h.stock_code, company_name: h.company_name, exchange: h.exchange, industry: h.industry, funds: [], avg_pct: 0 };
                map.set(h.stock_code, agg);
            }
            agg.funds.push({ short_name: f.short_name, pct: h.net_asset_percent });
        }
    }
    const out = [...map.values()];
    for (const a of out) {
        a.funds.sort((x, y) => y.pct - x.pct);
        a.avg_pct = a.funds.reduce((s, x) => s + x.pct, 0) / a.funds.length;
    }
    // Most widely-held first, then by average weight
    out.sort((a, b) => b.funds.length - a.funds.length || b.avg_pct - a.avg_pct);
    return out;
}
function StockRow({ s, onPick }) {
    return (_jsxs("div", { className: "bg-[#161b22] border border-[#30363d] rounded-lg p-3 flex flex-col gap-2", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("button", { onClick: () => onPick(s.stock_code, s.company_name ?? s.stock_code), className: "font-bold text-emerald-400 hover:text-emerald-300 tracking-wide", children: s.stock_code }), _jsx(ExchangeBadge, { exchange: s.exchange }), s.company_name && _jsx("span", { className: "text-xs text-[#8b949e] truncate", children: s.company_name }), _jsxs("span", { className: "ml-auto text-xs font-bold text-[#58a6ff] tabular-nums", children: [s.funds.length, " ", s.funds.length === 1 ? 'fund' : 'funds'] })] }), _jsx("div", { className: "flex flex-wrap gap-1.5", children: s.funds.map(f => (_jsxs("span", { className: "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border border-[#30363d] bg-[#0d1117] text-[#8b949e]", children: [_jsx("span", { className: "font-semibold text-[#e6edf3]", children: f.short_name }), _jsxs("span", { className: "tabular-nums text-[#58a6ff]", children: [f.pct.toFixed(1), "%"] })] }, f.short_name))) })] }));
}
// ── Tab ───────────────────────────────────────────────────────────────────────
export function FundsTab() {
    const [funds, setFunds] = useState([]);
    const [updatedAt, setUpdatedAt] = useState(null);
    const [loading, setLoading] = useState(true);
    const [view, setView] = useState('fund');
    const [query, setQuery] = useState('');
    const [refreshing, setRefreshing] = useState(false);
    const [msg, setMsg] = useState(null);
    const [detail, setDetail] = useState(null);
    const pollRef = useRef(null);
    const pollCountRef = useRef(0);
    const load = useCallback(async () => {
        try {
            const page = await api.funds();
            setFunds(page.funds ?? []);
            setUpdatedAt(page.updated_at);
        }
        catch { /* backend starting */ }
        finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { load(); }, [load]);
    useEffect(() => () => { if (pollRef.current)
        clearInterval(pollRef.current); }, []);
    const handleRefresh = async () => {
        setRefreshing(true);
        setMsg('Đang lấy dữ liệu quỹ mới nhất từ fmarket…');
        if (pollRef.current)
            clearInterval(pollRef.current);
        pollCountRef.current = 0;
        try {
            await api.refreshFunds();
            // Background job (~10–30s for ~30 funds). Poll until counts settle.
            pollRef.current = setInterval(async () => {
                pollCountRef.current += 1;
                await load();
                if (pollCountRef.current >= 8 && pollRef.current) {
                    clearInterval(pollRef.current);
                    pollRef.current = null;
                    setRefreshing(false);
                    setMsg(null);
                }
            }, 3000);
        }
        catch (e) {
            setMsg(e instanceof Error ? `✕ ${e.message}` : '✕ Update failed');
            setRefreshing(false);
        }
    };
    const q = query.trim().toUpperCase();
    const shownFunds = useMemo(() => {
        if (!q)
            return funds;
        return funds
            .map(f => {
            const fundMatch = f.short_name.toUpperCase().includes(q) || f.name.toUpperCase().includes(q);
            if (fundMatch)
                return f;
            const hits = f.holdings.filter(h => h.stock_code.includes(q));
            return hits.length ? { ...f, holdings: hits } : null;
        })
            .filter((f) => f !== null);
    }, [funds, q]);
    const stockIndex = useMemo(() => {
        const idx = buildStockIndex(funds);
        if (!q)
            return idx;
        return idx.filter(s => s.stock_code.includes(q) || (s.company_name ?? '').toUpperCase().includes(q));
    }, [funds, q]);
    return (_jsxs("div", { children: [_jsxs("div", { className: "flex items-center gap-3 mb-4 flex-wrap", children: [_jsx("div", { className: "flex bg-[#161b22] border border-[#30363d] rounded-lg p-0.5", children: [['fund', '🏦 By Fund'], ['stock', '📊 By Stock']].map(([v, label]) => (_jsx("button", { onClick: () => setView(v), className: `px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${view === v ? 'bg-[#21262d] text-[#58a6ff]' : 'text-[#8b949e] hover:text-[#e6edf3]'}`, children: label }, v))) }), _jsx("input", { type: "text", placeholder: view === 'fund' ? 'Search fund or stock…' : 'Search stock…', value: query, onChange: e => setQuery(e.target.value), className: "bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-[#e6edf3]\n                     w-64 focus:outline-none focus:border-[#58a6ff]/60 placeholder-[#8b949e] transition-colors" }), _jsxs("span", { className: "text-xs text-[#8b949e]", children: [funds.length, " funds \u00B7 ", stockIndex.length, " stocks"] }), _jsxs("button", { onClick: handleRefresh, disabled: refreshing, className: `ml-auto flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold border transition-all
            disabled:opacity-60 disabled:cursor-not-allowed ${refreshing
                            ? 'bg-cyan-950 border-cyan-700 text-cyan-300 animate-pulse'
                            : 'bg-[#58a6ff] border-[#58a6ff] text-[#0d1117] hover:bg-[#79b8ff] hover:scale-105 active:scale-95'}`, children: [_jsx("span", { className: refreshing ? 'animate-spin inline-block' : '', children: "\u21BB" }), refreshing ? 'Updating…' : 'Update now'] })] }), (msg || updatedAt) && (_jsx("div", { className: "mb-3 text-xs text-[#8b949e] flex items-center gap-2", children: msg
                    ? _jsx("span", { className: "text-cyan-300 animate-pulse", children: msg })
                    : _jsxs("span", { children: ["Last updated: ", _jsx("span", { className: "text-[#e6edf3]", children: fmtDate(updatedAt) }), " \u00B7 data from fmarket.vn"] }) })), loading ? (_jsx("div", { className: "py-16 text-center text-[#8b949e] text-sm animate-pulse", children: "Loading funds\u2026" })) : funds.length === 0 ? (_jsxs("div", { className: "py-16 text-center space-y-3", children: [_jsx("div", { className: "text-[#8b949e] text-sm", children: "No fund data yet." }), _jsxs("div", { className: "text-[#8b949e]/60 text-xs", children: ["Click ", _jsx("span", { className: "text-[#58a6ff] font-semibold", children: "Update now" }), " to crawl equity funds from fmarket.vn."] })] })) : view === 'fund' ? (shownFunds.length === 0 ? (_jsxs("div", { className: "py-16 text-center text-[#8b949e] text-sm", children: ["No funds match \u201C", query, "\u201D."] })) : (_jsx("div", { className: "grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4", children: shownFunds.map(f => (_jsx(FundCard, { fund: f, onPick: (symbol, name) => setDetail({ symbol, name }) }, f.fund_id))) }))) : (stockIndex.length === 0 ? (_jsxs("div", { className: "py-16 text-center text-[#8b949e] text-sm", children: ["No stocks match \u201C", query, "\u201D."] })) : (_jsx("div", { className: "grid grid-cols-1 lg:grid-cols-2 gap-3", children: stockIndex.map(s => (_jsx(StockRow, { s: s, onPick: (symbol, name) => setDetail({ symbol, name }) }, s.stock_code))) }))), detail && (_jsx(SymbolModal, { symbol: detail.symbol, name: detail.name, onClose: () => setDetail(null) }))] }));
}
