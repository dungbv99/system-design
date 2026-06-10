import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { api } from '../api';
import { fmtPrice } from '../utils';
// ── Helpers ───────────────────────────────────────────────────────────────────
const REASON_LABEL = {
    stop: '✕ Stop',
    target: '✓ Target',
    timeout: '⏱ Timeout',
    end_of_data: '— End',
};
const REASON_COLOR = {
    stop: 'text-red-400',
    target: 'text-emerald-400',
    timeout: 'text-amber-400',
    end_of_data: 'text-[#8b949e]',
};
function fmt(v, suffix = '%', decimals = 1) {
    if (v == null)
        return '—';
    const s = Math.abs(v).toFixed(decimals);
    return (v >= 0 ? '+' : '−') + s + suffix;
}
// ── Mini equity curve (SVG polyline) ─────────────────────────────────────────
function EquityCurve({ curve }) {
    if (curve.length < 2)
        return (_jsx("div", { className: "text-xs text-[#8b949e] py-4 text-center", children: "No trades" }));
    const W = 520;
    const H = 120;
    const pad = 8;
    const min = Math.min(0, ...curve);
    const max = Math.max(0, ...curve);
    const range = max - min || 1;
    const xs = curve.map((_, i) => pad + (i / (curve.length - 1)) * (W - pad * 2));
    const ys = curve.map(v => H - pad - ((v - min) / range) * (H - pad * 2));
    const pts = xs.map((x, i) => `${x},${ys[i]}`).join(' ');
    // Zero line
    const zeroY = H - pad - ((0 - min) / range) * (H - pad * 2);
    const lastV = curve[curve.length - 1];
    return (_jsxs("svg", { viewBox: `0 0 ${W} ${H}`, className: "w-full", style: { height: H }, children: [_jsx("line", { x1: pad, y1: zeroY, x2: W - pad, y2: zeroY, stroke: "#30363d", strokeWidth: "1", strokeDasharray: "3 3" }), _jsx("polyline", { points: pts, fill: "none", stroke: lastV >= 0 ? '#34d399' : '#f87171', strokeWidth: "2" }), _jsx("circle", { cx: xs[0], cy: ys[0], r: "3", fill: "#8b949e" }), _jsx("circle", { cx: xs[xs.length - 1], cy: ys[ys.length - 1], r: "3", fill: lastV >= 0 ? '#34d399' : '#f87171' })] }));
}
// ── Summary stat card ─────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color }) {
    return (_jsxs("div", { className: "bg-[#0d1117] border border-[#30363d] rounded-lg p-3 text-center", children: [_jsx("div", { className: `text-base font-bold tabular-nums ${color ?? 'text-[#e6edf3]'}`, children: value }), _jsx("div", { className: "text-[11px] text-[#8b949e]", children: label }), sub && _jsx("div", { className: "text-[10px] text-[#8b949e]/60 mt-0.5", children: sub })] }));
}
// ── Result panel (one strategy) ───────────────────────────────────────────────
function ResultPanel({ result, title }) {
    const [showAll, setShowAll] = useState(false);
    const trades = showAll ? result.trades : result.trades.slice(0, 20);
    const winColor = result.win_rate >= 55 ? 'text-emerald-400'
        : result.win_rate >= 45 ? 'text-amber-400' : 'text-red-400';
    const returnColor = result.total_return_pct >= 0 ? 'text-emerald-400' : 'text-red-400';
    const avgColor = result.avg_return_pct >= 0 ? 'text-emerald-400' : 'text-red-400';
    return (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-sm font-bold text-[#e6edf3]", children: title }), _jsxs("span", { className: "text-xs text-[#8b949e]", children: [result.bars_analyzed, " bars analyzed"] })] }), _jsxs("div", { className: "grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2", children: [_jsx(StatCard, { label: "Total Trades", value: String(result.total_trades) }), _jsx(StatCard, { label: "Win Rate", value: `${result.win_rate}%`, sub: `${result.winning_trades}W / ${result.total_trades - result.winning_trades}L`, color: winColor }), _jsx(StatCard, { label: "Avg Return", value: fmt(result.avg_return_pct), color: avgColor }), _jsx(StatCard, { label: "Median", value: fmt(result.median_return_pct) }), _jsx(StatCard, { label: "Best Trade", value: fmt(result.best_trade_pct), color: "text-emerald-400" }), _jsx(StatCard, { label: "Worst Trade", value: fmt(result.worst_trade_pct), color: "text-red-400" }), _jsx(StatCard, { label: "Total Return", value: fmt(result.total_return_pct), color: returnColor }), _jsx(StatCard, { label: "Max Drawdown", value: fmt(result.max_drawdown_pct, '%', 1), color: "text-red-400" })] }), _jsxs("div", { className: "flex gap-4 text-xs text-[#8b949e] flex-wrap", children: [_jsxs("span", { children: ["BUY trades: ", _jsx("span", { className: "text-emerald-400 font-semibold", children: result.buy_trades })] }), _jsxs("span", { children: ["SHORT trades: ", _jsx("span", { className: "text-red-400 font-semibold", children: result.short_trades })] }), _jsxs("span", { children: ["Avg hold: ", _jsxs("span", { className: "text-[#e6edf3]", children: [result.avg_holding_days, "d"] })] })] }), _jsxs("div", { className: "bg-[#0d1117] border border-[#30363d] rounded-lg p-3", children: [_jsx("div", { className: "text-[11px] text-[#8b949e] font-semibold mb-2 uppercase tracking-wider", children: "Cumulative P&L (% sum per trade)" }), _jsx(EquityCurve, { curve: result.equity_curve })] }), _jsx("div", { className: "overflow-x-auto rounded-lg border border-[#30363d]", children: _jsxs("table", { className: "w-full text-xs", children: [_jsx("thead", { className: "text-[#8b949e] uppercase tracking-wider text-[11px]", children: _jsxs("tr", { children: [_jsx("th", { className: "px-3 py-2 text-left bg-[#161b22] sticky top-0", children: "#" }), _jsx("th", { className: "px-3 py-2 text-left bg-[#161b22] sticky top-0", children: "Signal" }), _jsx("th", { className: "px-3 py-2 text-left bg-[#161b22] sticky top-0", children: "Event" }), _jsx("th", { className: "px-3 py-2 text-left bg-[#161b22] sticky top-0", children: "Phase" }), _jsx("th", { className: "px-3 py-2 text-right bg-[#161b22] sticky top-0", children: "Entry" }), _jsx("th", { className: "px-3 py-2 text-right bg-[#161b22] sticky top-0", children: "Stop" }), _jsx("th", { className: "px-3 py-2 text-right bg-[#161b22] sticky top-0", children: "Target" }), _jsx("th", { className: "px-3 py-2 text-right bg-[#161b22] sticky top-0", children: "Exit" }), _jsx("th", { className: "px-3 py-2 text-left  bg-[#161b22] sticky top-0", children: "Reason" }), _jsx("th", { className: "px-3 py-2 text-right bg-[#161b22] sticky top-0", children: "Return" }), _jsx("th", { className: "px-3 py-2 text-right bg-[#161b22] sticky top-0", children: "Hold" }), _jsx("th", { className: "px-3 py-2 text-left  bg-[#161b22] sticky top-0", children: "Entry Date" }), _jsx("th", { className: "px-3 py-2 text-left  bg-[#161b22] sticky top-0", children: "Exit Date" })] }) }), _jsxs("tbody", { children: [result.total_trades === 0 && (_jsx("tr", { children: _jsx("td", { colSpan: 13, className: "px-4 py-8 text-center text-[#8b949e]", children: "No trades detected" }) })), trades.map((t, i) => {
                                    const win = t.return_pct > 0;
                                    return (_jsxs("tr", { className: `border-t border-[#30363d]/50 ${i % 2 === 0 ? '' : 'bg-[#161b22]/30'}`, style: { borderLeft: `3px solid ${win ? '#34d399' : '#f87171'}` }, children: [_jsx("td", { className: "px-3 py-2 text-[#8b949e]", children: i + 1 }), _jsx("td", { className: "px-3 py-2", children: _jsx("span", { className: `font-bold text-xs px-1.5 py-0.5 rounded border ${t.signal === 'BUY'
                                                        ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                                                        : 'bg-red-950 text-red-300 border-red-700'}`, children: t.signal }) }), _jsx("td", { className: "px-3 py-2 text-amber-400 font-medium", children: t.event ?? _jsx("span", { className: "text-[#8b949e]", children: "\u2014" }) }), _jsxs("td", { className: "px-3 py-2 text-[#8b949e]", children: [t.phase, t.sub_phase !== '-' ? `·${t.sub_phase}` : ''] }), _jsx("td", { className: "px-3 py-2 text-right tabular-nums text-[#e6edf3]", children: fmtPrice(t.entry_price) }), _jsx("td", { className: "px-3 py-2 text-right tabular-nums text-red-400/80", children: fmtPrice(t.stop_loss) }), _jsx("td", { className: "px-3 py-2 text-right tabular-nums text-emerald-400/80", children: fmtPrice(t.target) }), _jsx("td", { className: "px-3 py-2 text-right tabular-nums text-[#e6edf3]", children: fmtPrice(t.exit_price) }), _jsx("td", { className: `px-3 py-2 text-[11px] font-medium ${REASON_COLOR[t.exit_reason] ?? ''}`, children: REASON_LABEL[t.exit_reason] ?? t.exit_reason }), _jsx("td", { className: `px-3 py-2 text-right tabular-nums font-bold ${win ? 'text-emerald-400' : 'text-red-400'}`, children: fmt(t.return_pct) }), _jsxs("td", { className: "px-3 py-2 text-right text-[#8b949e] tabular-nums", children: [t.holding_days, "d"] }), _jsx("td", { className: "px-3 py-2 text-[#8b949e] whitespace-nowrap", children: t.entry_date }), _jsx("td", { className: "px-3 py-2 text-[#8b949e] whitespace-nowrap", children: t.exit_date })] }, i));
                                })] })] }) }), result.total_trades > 20 && (_jsx("button", { onClick: () => setShowAll(s => !s), className: "text-xs text-[#58a6ff] hover:underline", children: showAll ? 'Show fewer' : `Show all ${result.total_trades} trades` }))] }));
}
// ── Main tab ──────────────────────────────────────────────────────────────────
export function BacktestTab() {
    const [symbol, setSymbol] = useState('');
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [result, setResult] = useState(null);
    const [horizon, setHorizon] = useState(20);
    const [maxHold, setMaxHold] = useState(60);
    const [activeTab, setActiveTab] = useState('signal_replay');
    const handleRun = async () => {
        const sym = input.trim().toUpperCase();
        if (!sym)
            return;
        setLoading(true);
        setError(null);
        setResult(null);
        setSymbol(sym);
        try {
            const r = await api.backtest(sym, 'both', horizon, maxHold);
            setResult(r);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Unknown error');
        }
        finally {
            setLoading(false);
        }
    };
    const sr = result?.signal_replay;
    const et = result?.event_trades;
    return (_jsxs("div", { className: "space-y-5", children: [_jsxs("div", { className: "bg-[#161b22] border border-[#30363d] rounded-xl p-5 space-y-4", children: [_jsx("div", { className: "text-sm font-bold text-[#e6edf3]", children: "Walk-forward Wyckoff Backtest" }), _jsxs("div", { className: "text-xs text-[#8b949e] leading-relaxed", children: ["Runs two strategies on full price history.", _jsx("span", { className: "text-cyan-400 font-semibold", children: " Signal replay" }), " enters on BUY/SHORT signal transitions.", _jsx("span", { className: "text-amber-400 font-semibold", children: " Event trades" }), " enters on each Spring / LPS / UTAD / LPSY event."] }), _jsxs("div", { className: "flex gap-3 flex-wrap items-end", children: [_jsxs("div", { className: "flex flex-col gap-1", children: [_jsx("label", { className: "text-[11px] text-[#8b949e] uppercase tracking-wider", children: "Symbol" }), _jsx("input", { value: input, onChange: e => setInput(e.target.value.toUpperCase()), onKeyDown: e => e.key === 'Enter' && handleRun(), placeholder: "e.g. STB", className: "bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm\n                         text-[#e6edf3] placeholder-[#8b949e]/50 focus:outline-none\n                         focus:border-[#58a6ff]/60 w-28" })] }), _jsxs("div", { className: "flex flex-col gap-1", children: [_jsx("label", { className: "text-[11px] text-[#8b949e] uppercase tracking-wider", children: "Signal hold (bars)" }), _jsx("input", { type: "number", min: 5, max: 120, value: horizon, onChange: e => setHorizon(Number(e.target.value)), className: "bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm\n                         text-[#e6edf3] focus:outline-none focus:border-[#58a6ff]/60 w-20" })] }), _jsxs("div", { className: "flex flex-col gap-1", children: [_jsx("label", { className: "text-[11px] text-[#8b949e] uppercase tracking-wider", children: "Event hold (bars)" }), _jsx("input", { type: "number", min: 5, max: 240, value: maxHold, onChange: e => setMaxHold(Number(e.target.value)), className: "bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm\n                         text-[#e6edf3] focus:outline-none focus:border-[#58a6ff]/60 w-20" })] }), _jsx("button", { onClick: handleRun, disabled: loading || !input.trim(), className: `px-5 py-2 rounded-lg text-sm font-bold border transition-all
              ${loading
                                    ? 'bg-cyan-950 border-cyan-700 text-cyan-300 animate-pulse cursor-not-allowed'
                                    : 'bg-[#58a6ff] hover:bg-[#79b8ff] border-transparent text-[#0d1117]'} disabled:opacity-50`, children: loading ? '⏳ Computing…' : '▶ Run Backtest' })] }), loading && (_jsx("div", { className: "text-xs text-[#8b949e] animate-pulse", children: "Walk-forward analysis in progress \u2014 may take 5\u201320s for long histories\u2026" })), error && (_jsx("div", { className: "text-xs text-red-400 bg-red-950/30 border border-red-800 rounded-lg px-3 py-2", children: error }))] }), result && (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("span", { className: "text-sm font-bold text-[#e6edf3]", children: [symbol, " \u2014 Backtest Results"] }), _jsx("div", { className: "flex gap-1", children: ['signal_replay', 'event_trades'].map(tab => (_jsx("button", { onClick: () => setActiveTab(tab), className: `px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                    ${activeTab === tab
                                        ? 'bg-[#21262d] border-[#58a6ff] text-[#58a6ff]'
                                        : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3]'}`, children: tab === 'signal_replay' ? '〜 Signal Replay' : '⚡ Event Trades' }, tab))) })] }), activeTab === 'signal_replay' && sr && (_jsx(ResultPanel, { result: sr, title: "Signal Replay \u2014 enters on BUY/SHORT signal transition" })), activeTab === 'event_trades' && et && (_jsx(ResultPanel, { result: et, title: "Event Trades \u2014 enters on Spring / LPS / UTAD / LPSY" })), _jsx("p", { className: "text-xs text-[#8b949e]/40 text-right", children: "Walk-forward backtest \u00B7 no look-ahead bias \u00B7 results are illustrative, not financial advice" })] }))] }));
}
