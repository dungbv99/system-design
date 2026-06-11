import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createChart, ColorType, LineStyle } from 'lightweight-charts';
import { api, VN_INDICES } from '../api';
import { SymbolModal } from '../components/SymbolModal';
// ── Formatting ────────────────────────────────────────────────────────────────
const fmtMoney = (v) => {
    if (Math.abs(v) >= 1e9)
        return `${(v / 1e9).toFixed(2)}B`;
    if (Math.abs(v) >= 1e6)
        return `${(v / 1e6).toFixed(1)}M`;
    if (Math.abs(v) >= 1e3)
        return `${(v / 1e3).toFixed(0)}K`;
    return v.toFixed(0);
};
const fmtPct = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
const fmtK = (v) => v.toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
// ── Equity curve chart ────────────────────────────────────────────────────────
function EquityChart({ curve, capital }) {
    const ref = useRef(null);
    useEffect(() => {
        if (!ref.current || curve.length < 2)
            return;
        const chart = createChart(ref.current, {
            layout: { background: { type: ColorType.Solid, color: '#0d1117' }, textColor: '#8b949e' },
            grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
            rightPriceScale: { borderColor: '#30363d' },
            timeScale: { borderColor: '#30363d', timeVisible: false },
            height: 340,
            crosshair: { mode: 1 },
        });
        const area = chart.addAreaSeries({
            lineColor: '#34d399', topColor: 'rgba(52,211,153,0.35)', bottomColor: 'rgba(52,211,153,0.02)',
            lineWidth: 2, priceFormat: { type: 'volume' },
        });
        area.setData(curve.map(p => ({ time: p.date, value: p.equity })));
        // Starting-capital baseline
        const base = chart.addLineSeries({
            color: '#6e7681', lineWidth: 1, lineStyle: LineStyle.Dashed,
            priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        });
        base.setData([
            { time: curve[0].date, value: capital },
            { time: curve[curve.length - 1].date, value: capital },
        ]);
        chart.timeScale().fitContent();
        const onResize = () => chart.applyOptions({ width: ref.current?.clientWidth });
        onResize();
        window.addEventListener('resize', onResize);
        return () => { window.removeEventListener('resize', onResize); chart.remove(); };
    }, [curve, capital]);
    return _jsx("div", { ref: ref, className: "w-full" });
}
// ── Metric card ───────────────────────────────────────────────────────────────
function Metric({ label, value, accent, sub }) {
    return (_jsxs("div", { className: "flex-1 min-w-[130px] rounded-xl p-3 border bg-[#161b22] border-[#30363d]", children: [_jsx("div", { className: "text-[11px] text-[#8b949e] uppercase tracking-wider", children: label }), _jsx("div", { className: `text-lg font-bold tabular-nums mt-0.5 ${accent}`, children: value }), sub && _jsx("div", { className: "text-[11px] text-[#8b949e] mt-0.5", children: sub })] }));
}
const REASON_META = {
    target: { label: 'target', cls: 'text-emerald-300 bg-emerald-950/60' },
    stop: { label: 'stop', cls: 'text-red-300 bg-red-950/60' },
    timeout: { label: 'timeout', cls: 'text-amber-300 bg-amber-950/60' },
    end_of_data: { label: 'open', cls: 'text-[#8b949e] bg-[#21262d]' },
};
// ── Main tab ──────────────────────────────────────────────────────────────────
const START_YEARS = ['2018-01-01', '2020-01-01', '2022-01-01'];
const SLOTS = [4, 6, 8, 10, 12, 16];
const CAPITAL_PRESETS = [100, 200, 500, 1000, 2000]; // millions of VND
const DEFAULT_CAPITAL = 500000000; // 500M VND
export function PortfolioBacktestTab() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [running, setRunning] = useState(false);
    const [start, setStart] = useState('2018-01-01');
    const [slots, setSlots] = useState(8);
    const [capital, setCapital] = useState(DEFAULT_CAPITAL);
    const [detail, setDetail] = useState(null);
    const [yearFilter, setYearFilter] = useState('all');
    const [symbolFilter, setSymbolFilter] = useState('all');
    const [tradeView, setTradeView] = useState('list');
    const pollRef = useRef(null);
    const vn100 = useMemo(() => {
        const def = VN_INDICES.vn100;
        return 'symbols' in def ? def.symbols : [];
    }, []);
    const fetchLatest = useCallback(async () => {
        setLoading(true);
        try {
            setData(await api.portfolioBacktest());
        }
        catch { /* none yet */ }
        finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => {
        fetchLatest();
        return () => { if (pollRef.current)
            clearInterval(pollRef.current); };
    }, [fetchLatest]);
    const handleRun = async () => {
        setRunning(true);
        try {
            await api.runPortfolioBacktest(vn100, `VN100 Wyckoff ${start.slice(0, 4)}+ (${Math.round(capital / 1e6)}M)`, start, capital, slots);
        }
        catch {
            setRunning(false);
            return;
        }
        // poll the shared crawl status until it goes idle, then refetch
        if (pollRef.current)
            clearInterval(pollRef.current);
        let sawRunning = false;
        pollRef.current = setInterval(async () => {
            try {
                const st = await api.status();
                if (st.running) {
                    sawRunning = true;
                    return;
                }
                if (sawRunning || !st.running) {
                    if (pollRef.current)
                        clearInterval(pollRef.current);
                    setRunning(false);
                    await fetchLatest();
                }
            }
            catch { /* keep polling */ }
        }, 3000);
    };
    const s = data?.summary;
    // ── Transaction filtering (by year / by symbol) ──────────────────────────
    const trades = useMemo(() => data?.trades ?? [], [data]);
    const years = useMemo(() => Array.from(new Set(trades.map(t => t.entry_date.slice(0, 4)))).sort(), [trades]);
    const symbols = useMemo(() => Array.from(new Set(trades.map(t => t.symbol))).sort(), [trades]);
    const filtered = useMemo(() => trades.filter(t => (yearFilter === 'all' || t.entry_date.slice(0, 4) === yearFilter) &&
        (symbolFilter === 'all' || t.symbol === symbolFilter)), [trades, yearFilter, symbolFilter]);
    const filteredPL = useMemo(() => filtered.reduce((a, t) => a + t.pl, 0), [filtered]);
    // Per-symbol aggregation of the (year-filtered) trades.
    const bySymbol = useMemo(() => {
        const yearScoped = trades.filter(t => yearFilter === 'all' || t.entry_date.slice(0, 4) === yearFilter);
        const m = new Map();
        for (const t of yearScoped) {
            const g = m.get(t.symbol) ?? { symbol: t.symbol, n: 0, wins: 0, ret: 0, pl: 0, best: -Infinity, worst: Infinity };
            g.n += 1;
            if (t.net_return_pct > 0)
                g.wins += 1;
            g.ret += t.net_return_pct;
            g.pl += t.pl;
            g.best = Math.max(g.best, t.net_return_pct);
            g.worst = Math.min(g.worst, t.net_return_pct);
            m.set(t.symbol, g);
        }
        return Array.from(m.values()).sort((a, b) => b.pl - a.pl);
    }, [trades, yearFilter]);
    return (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex items-start justify-between gap-3 flex-wrap", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-base font-bold text-emerald-400 flex items-center gap-2", children: "\uD83D\uDCC9 VN100 Wyckoff Backtest" }), _jsxs("p", { className: "text-xs text-[#8b949e] mt-1 max-w-2xl", children: ["Trades the Wyckoff ", _jsx("span", { className: "text-emerald-300 font-semibold", children: "BUY" }), " signal across the VN100 basket from the chosen start date \u2014 one shared cash account, ", slots, " concurrent position slots, stop / target / timeout exits, and a ", _jsx("span", { className: "text-amber-300 font-semibold", children: "3-session minimum hold" }), " (T+ settlement \u2014 bought shares can't be sold for the first few days). Long-only (VN has no practical single-stock shorting)."] })] }), _jsxs("div", { className: "flex items-end gap-3 flex-wrap", children: [_jsxs("div", { className: "flex flex-col gap-1", children: [_jsx("span", { className: "text-[10px] text-[#8b949e] uppercase", children: "From" }), _jsx("div", { className: "flex gap-1", children: START_YEARS.map(y => (_jsx("button", { onClick: () => setStart(y), disabled: running, className: `px-2.5 py-1 rounded-lg text-xs font-medium border transition-all tabular-nums
                    ${start === y ? 'bg-[#21262d] border-[#58a6ff] text-[#58a6ff]'
                                                : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3]'}`, children: y.slice(0, 4) }, y))) })] }), _jsxs("div", { className: "flex flex-col gap-1", children: [_jsx("span", { className: "text-[10px] text-[#8b949e] uppercase", children: "Capital (M\u20AB)" }), _jsxs("div", { className: "flex gap-1 items-center", children: [CAPITAL_PRESETS.map(m => (_jsx("button", { onClick: () => setCapital(m * 1e6), disabled: running, className: `px-2 py-1 rounded-lg text-xs font-medium border transition-all tabular-nums
                    ${Math.round(capital / 1e6) === m ? 'bg-[#21262d] border-[#58a6ff] text-[#58a6ff]'
                                                    : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3]'}`, children: m >= 1000 ? `${m / 1000}B` : m }, m))), _jsx("input", { type: "number", min: 1, step: 50, disabled: running, value: Math.round(capital / 1e6), onChange: e => setCapital(Math.max(1, Number(e.target.value) || 0) * 1e6), className: "w-20 bg-[#21262d] border border-[#30363d] text-[#e6edf3] text-xs rounded-lg px-2 py-1\n                           focus:border-[#58a6ff] focus:outline-none tabular-nums disabled:opacity-50", title: "Custom starting capital, in millions of VND" })] })] }), _jsxs("div", { className: "flex flex-col gap-1", children: [_jsxs("span", { className: "text-[10px] text-[#8b949e] uppercase", children: ["Slots (\u2248", (100 / slots).toFixed(0), "%/pos)"] }), _jsx("div", { className: "flex gap-1", children: SLOTS.map(n => (_jsx("button", { onClick: () => setSlots(n), disabled: running, className: `px-2.5 py-1 rounded-lg text-xs font-medium border transition-all tabular-nums
                    ${slots === n ? 'bg-[#21262d] border-[#58a6ff] text-[#58a6ff]'
                                                : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3]'}`, children: n }, n))) })] }), _jsx("button", { onClick: handleRun, disabled: running, className: `self-end px-4 py-2 rounded-lg text-xs font-bold border transition-all
              ${running
                                    ? 'bg-cyan-950 border-cyan-700 text-cyan-300 animate-pulse cursor-not-allowed'
                                    : 'bg-emerald-950 border-emerald-600 text-emerald-300 hover:border-emerald-400'}`, children: running ? '⏳ Running backtest…' : '▶ Run Backtest' })] })] }), loading && (_jsx("div", { className: "text-center py-12 text-[#8b949e] text-sm animate-pulse", children: "Loading latest backtest\u2026" })), !loading && !data && (_jsxs("div", { className: "text-center py-16 text-[#8b949e] border border-dashed border-[#30363d] rounded-xl", children: ["No backtest yet. Click ", _jsx("span", { className: "text-emerald-300 font-semibold", children: "\u25B6 Run Backtest" }), " to trade VN100 with the Wyckoff method from ", start.slice(0, 4), " \u2192 now. Takes ~1\u20132 minutes."] })), !loading && data && s && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex gap-3 flex-wrap", children: [_jsx(Metric, { label: "Total Return", accent: s.total_return_pct >= 0 ? 'text-emerald-400' : 'text-red-400', value: fmtPct(s.total_return_pct), sub: `${fmtMoney(s.initial_capital)} → ${fmtMoney(s.final_equity)} ₫` }), _jsx(Metric, { label: "CAGR", accent: "text-emerald-400", value: fmtPct(s.cagr_pct), sub: `over ${s.years} yrs` }), _jsx(Metric, { label: "Max Drawdown", accent: "text-red-400", value: `−${s.max_drawdown_pct.toFixed(1)}%`, sub: "peak\u2192trough" }), _jsx(Metric, { label: "Win Rate", accent: "text-[#58a6ff]", value: `${s.win_rate.toFixed(1)}%`, sub: `${s.winning_trades}W / ${s.losing_trades}L` }), _jsx(Metric, { label: "Profit Factor", accent: "text-amber-400", value: s.profit_factor != null ? s.profit_factor.toFixed(2) : '—', sub: "gross W / gross L" }), _jsx(Metric, { label: "Trades", accent: "text-[#e6edf3]", value: s.executed_trades.toLocaleString(), sub: `${s.skipped_signals} skipped · ${s.avg_holding_days}d avg` }), _jsx(Metric, { label: "vs Buy & Hold", accent: s.total_return_pct >= s.benchmark_pct ? 'text-emerald-400' : 'text-amber-400', value: fmtPct(s.benchmark_pct), sub: "median VN100 stock" })] }), _jsxs("div", { className: "rounded-lg border border-[#30363d] bg-[#0d1117] p-3", children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsxs("span", { className: "text-xs font-semibold text-[#e6edf3]", children: ["Equity curve \u00B7 ", s.start_date, " \u2192 ", s.end_date] }), _jsxs("span", { className: "text-[11px] text-[#8b949e]", children: [data.label, " \u00B7 ", s.symbols, " symbols \u00B7 ", s.slots, " slots \u00B7 run ", new Date(data.created_at).toLocaleString('vi-VN')] })] }), _jsx(EquityChart, { curve: data.equity_curve, capital: s.initial_capital })] }), data.yearly.length > 0 && (_jsxs("div", { className: "rounded-lg border border-[#30363d] bg-[#161b22] p-3", children: [_jsx("div", { className: "text-xs font-semibold text-[#8b949e] mb-3", children: "Return by year" }), _jsx("div", { className: "flex gap-2 flex-wrap", children: data.yearly.map(y => {
                                    const pos = y.return_pct >= 0;
                                    return (_jsxs("div", { className: "flex flex-col items-center gap-1 min-w-[64px]", children: [_jsx("span", { className: `text-xs font-bold tabular-nums ${pos ? 'text-emerald-400' : 'text-red-400'}`, children: fmtPct(y.return_pct) }), _jsx("div", { className: "w-full h-16 flex items-end justify-center bg-[#0d1117] rounded", children: _jsx("div", { className: "w-7 rounded-t transition-all", style: {
                                                        height: `${Math.min(100, Math.abs(y.return_pct) * 0.7 + 6)}%`,
                                                        background: pos ? '#34d399' : '#f87171',
                                                    } }) }), _jsx("span", { className: "text-[11px] text-[#8b949e] tabular-nums", children: y.year })] }, y.year));
                                }) })] })), _jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "flex items-center gap-3 flex-wrap", children: [_jsx("span", { className: "text-sm font-bold text-[#e6edf3]", children: "Transactions" }), _jsx("div", { className: "flex gap-1", children: ['list', 'symbol'].map(v => (_jsx("button", { onClick: () => setTradeView(v), className: `px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                      ${tradeView === v ? 'bg-[#21262d] border-[#58a6ff] text-[#58a6ff]'
                                                : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3]'}`, children: v === 'list' ? '📜 By date' : '🏷 By symbol' }, v))) }), _jsx("div", { className: "h-4 w-px bg-[#30363d]" }), _jsx("span", { className: "text-[11px] text-[#8b949e] uppercase", children: "Year" }), _jsx("div", { className: "flex gap-1 flex-wrap", children: ['all', ...years].map(y => (_jsx("button", { onClick: () => setYearFilter(y), className: `px-2.5 py-1 rounded-lg text-xs font-medium border transition-all tabular-nums
                      ${yearFilter === y ? 'bg-[#21262d] border-[#58a6ff] text-[#58a6ff]'
                                                : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3]'}`, children: y === 'all' ? 'All' : y }, y))) }), tradeView === 'list' && (_jsxs(_Fragment, { children: [_jsx("div", { className: "h-4 w-px bg-[#30363d]" }), _jsx("span", { className: "text-[11px] text-[#8b949e] uppercase", children: "Symbol" }), _jsxs("select", { value: symbolFilter, onChange: e => setSymbolFilter(e.target.value), className: "bg-[#21262d] border border-[#30363d] text-[#e6edf3] text-xs rounded-lg px-2 py-1.5\n                               focus:border-[#58a6ff] focus:outline-none cursor-pointer", children: [_jsxs("option", { value: "all", children: ["All (", symbols.length, ")"] }), symbols.map(sym => _jsx("option", { value: sym, children: sym }, sym))] })] })), _jsx("span", { className: "text-xs text-[#8b949e] ml-auto tabular-nums", children: tradeView === 'list'
                                            ? _jsxs(_Fragment, { children: [filtered.length, " trades \u00B7 net P/L", ' ', _jsxs("span", { className: filteredPL >= 0 ? 'text-emerald-400' : 'text-red-400', children: [filteredPL >= 0 ? '+' : '−', fmtMoney(Math.abs(filteredPL)), " \u20AB"] })] })
                                            : _jsxs(_Fragment, { children: [bySymbol.length, " symbols traded"] }) })] }), tradeView === 'list' && (_jsx("div", { className: "overflow-x-auto rounded-lg border border-[#30363d] max-h-[520px]", children: _jsxs("table", { className: "w-full text-xs", children: [_jsx("thead", { className: "text-[#8b949e] uppercase tracking-wider text-[11px]", children: _jsxs("tr", { children: [_jsx("th", { className: "px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Symbol" }), _jsx("th", { className: "px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Wyckoff" }), _jsx("th", { className: "px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22] text-emerald-400", children: "\uD83D\uDFE2 Buy date" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22] text-emerald-400", children: "Buy (K\u20AB)" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22] text-red-400", children: "\u2715 Stop (K\u20AB)" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22] text-amber-400", children: "\uD83C\uDFAF Target (K\u20AB)" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22] text-amber-400", children: "R:R" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Qty" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Cost (\u20AB)" }), _jsx("th", { className: "px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22] text-red-400", children: "\uD83D\uDD34 Sell date" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22] text-red-400", children: "Sell (K\u20AB)" }), _jsx("th", { className: "px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Exit" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Hold" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Return" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]", children: "P/L (\u20AB)" })] }) }), _jsxs("tbody", { children: [filtered.length === 0 && (_jsx("tr", { children: _jsx("td", { colSpan: 15, className: "px-4 py-10 text-center text-[#8b949e]", children: "No trades match this filter." }) })), [...filtered].sort((a, b) => a.entry_date.localeCompare(b.entry_date)).map((t, i) => {
                                                    const win = t.net_return_pct >= 0;
                                                    const rm = REASON_META[t.exit_reason] ?? REASON_META.end_of_data;
                                                    return (_jsxs("tr", { className: `border-t border-[#30363d]/50 cursor-pointer transition-all
                            hover:bg-[#21262d] ${i % 2 === 0 ? '' : 'bg-[#161b22]/30'}`, style: { borderLeft: `4px solid ${win ? '#34d399' : '#f87171'}` }, onClick: () => setDetail({ symbol: t.symbol, name: t.symbol }), children: [_jsx("td", { className: "px-3 py-2 font-bold text-emerald-400", children: t.symbol }), _jsxs("td", { className: "px-3 py-2 text-[#8b949e]", children: [t.phase, t.sub_phase !== '-' && `·${t.sub_phase}`, t.event && _jsxs("span", { className: "text-[#58a6ff]", children: [" ", t.event] })] }), _jsx("td", { className: "px-3 py-2 tabular-nums text-[#e6edf3]", children: t.entry_date }), _jsx("td", { className: "px-3 py-2 text-right tabular-nums text-emerald-300", children: fmtK(t.entry_price) }), _jsx("td", { className: "px-3 py-2 text-right tabular-nums text-red-300/90", children: fmtK(t.stop_loss) }), _jsx("td", { className: "px-3 py-2 text-right tabular-nums text-amber-300/90", children: fmtK(t.target) }), _jsx("td", { className: "px-3 py-2 text-right tabular-nums", children: t.entry_price > t.stop_loss ? (_jsxs("span", { className: "text-amber-300/90", children: ["1:", ((t.target - t.entry_price) / (t.entry_price - t.stop_loss)).toFixed(1)] })) : _jsx("span", { className: "text-[#8b949e]", children: "\u2014" }) }), _jsx("td", { className: "px-3 py-2 text-right tabular-nums text-[#e6edf3]", children: (t.shares ?? Math.round(t.alloc / t.entry_price)).toLocaleString('vi-VN') }), _jsx("td", { className: "px-3 py-2 text-right tabular-nums text-[#8b949e]", children: fmtMoney(t.alloc) }), _jsx("td", { className: "px-3 py-2 tabular-nums text-[#e6edf3]", children: t.exit_date }), _jsx("td", { className: "px-3 py-2 text-right tabular-nums text-red-300", children: fmtK(t.exit_price) }), _jsx("td", { className: "px-3 py-2 text-center", children: _jsx("span", { className: `text-[10px] font-bold px-1.5 py-0.5 rounded ${rm.cls}`, children: rm.label }) }), _jsxs("td", { className: "px-3 py-2 text-right tabular-nums text-[#8b949e]", children: [t.holding_days, "d"] }), _jsx("td", { className: `px-3 py-2 text-right tabular-nums font-bold ${win ? 'text-emerald-400' : 'text-red-400'}`, children: fmtPct(t.net_return_pct) }), _jsxs("td", { className: `px-3 py-2 text-right tabular-nums ${win ? 'text-emerald-400/90' : 'text-red-400/90'}`, children: [t.pl >= 0 ? '+' : '−', fmtMoney(Math.abs(t.pl))] })] }, `${t.symbol}-${t.entry_date}-${i}`));
                                                })] })] }) })), tradeView === 'symbol' && (_jsx("div", { className: "overflow-x-auto rounded-lg border border-[#30363d] max-h-[520px]", children: _jsxs("table", { className: "w-full text-xs", children: [_jsx("thead", { className: "text-[#8b949e] uppercase tracking-wider text-[11px]", children: _jsxs("tr", { children: [_jsx("th", { className: "px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Symbol" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Trades" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Win %" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]", children: "\u03A3 Return" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Best" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Worst" }), _jsx("th", { className: "px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]", children: "Total P/L (\u20AB)" })] }) }), _jsxs("tbody", { children: [bySymbol.length === 0 && (_jsx("tr", { children: _jsx("td", { colSpan: 7, className: "px-4 py-10 text-center text-[#8b949e]", children: "No trades in this year." }) })), bySymbol.map((g, i) => {
                                                    const win = g.pl >= 0;
                                                    return (_jsxs("tr", { className: `border-t border-[#30363d]/50 cursor-pointer transition-all
                            hover:bg-[#21262d] ${i % 2 === 0 ? '' : 'bg-[#161b22]/30'}`, style: { borderLeft: `4px solid ${win ? '#34d399' : '#f87171'}` }, onClick: () => { setSymbolFilter(g.symbol); setTradeView('list'); }, title: "Show this symbol's trades", children: [_jsx("td", { className: "px-3 py-2 font-bold text-emerald-400", children: g.symbol }), _jsx("td", { className: "px-3 py-2 text-right tabular-nums text-[#e6edf3]", children: g.n }), _jsxs("td", { className: "px-3 py-2 text-right tabular-nums text-[#58a6ff]", children: [((g.wins / g.n) * 100).toFixed(0), "%"] }), _jsx("td", { className: `px-3 py-2 text-right tabular-nums font-bold ${g.ret >= 0 ? 'text-emerald-400' : 'text-red-400'}`, children: fmtPct(g.ret) }), _jsx("td", { className: "px-3 py-2 text-right tabular-nums text-emerald-400/80", children: fmtPct(g.best) }), _jsx("td", { className: "px-3 py-2 text-right tabular-nums text-red-400/80", children: fmtPct(g.worst) }), _jsxs("td", { className: `px-3 py-2 text-right tabular-nums font-bold ${win ? 'text-emerald-400' : 'text-red-400'}`, children: [g.pl >= 0 ? '+' : '−', fmtMoney(Math.abs(g.pl))] })] }, g.symbol));
                                                })] })] }) }))] }), _jsxs("div", { className: "rounded-lg border border-amber-900/50 bg-amber-950/20 p-3 text-[11px] text-amber-200/70 leading-relaxed", children: [_jsx("span", { className: "font-bold text-amber-300", children: "\u26A0 Read the caveats." }), " These returns are almost certainly optimistic. The basket is ", _jsx("span", { className: "font-semibold", children: "today's" }), " VN100 \u2014 a survivorship-biased set of past winners (DIG, DGW, VIX\u2026 all had huge 2021 runs). Fills assume the exact analyzed close with no slippage; only a flat ", s.cost_pct ?? 0.3, "% round-trip cost is modelled (buys rounded to ", s.lot_size ?? 100, "-share HOSE lots). Signals are genuine walk-forward (each bar only sees prior data), and the equity curve is daily mark-to-market, but real-world results would be materially lower. Past performance \u2260 future results \u00B7 not financial advice."] })] })), detail && _jsx(SymbolModal, { symbol: detail.symbol, name: detail.name, onClose: () => setDetail(null) })] }));
}
