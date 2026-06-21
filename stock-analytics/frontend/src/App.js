import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { StatCard } from './components/ui';
import { MarketTab } from './tabs/MarketTab';
import { VnBoardTab } from './tabs/VnBoardTab';
import { IndustryTab } from './tabs/IndustryTab';
import { WyckoffTab } from './tabs/WyckoffTab';
import { MultiFactorTab } from './tabs/MultiFactorTab';
import { DerivativesTab } from './tabs/DerivativesTab';
import { BuyNowTab } from './tabs/BuyNowTab';
import { StrongBuyTab } from './tabs/StrongBuyTab';
import { PortfolioTab } from './tabs/PortfolioTab';
import { BacktestTab } from './tabs/BacktestTab';
import { PortfolioBacktestTab } from './tabs/PortfolioBacktestTab';
import { FundsTab } from './tabs/FundsTab';
import { CrawlTab } from './tabs/CrawlTab';
import { HistoryTab } from './tabs/HistoryTab';
// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
    const [stats, setStats] = useState(null);
    const [crawlStatus, setCrawlStatus] = useState(null);
    const [runs, setRuns] = useState([]);
    const [activeTab, setActiveTab] = useState('market');
    const [now, setNow] = useState(() => new Date());
    const intervalRef = useRef(null);
    const refresh = useCallback(async () => {
        try {
            const [s, cs, r] = await Promise.all([api.stats(), api.status(), api.runs()]);
            setStats(s);
            setCrawlStatus(cs);
            setRuns(r);
        }
        catch { /* backend starting */ }
    }, []);
    useEffect(() => {
        refresh();
        const running = crawlStatus?.running ?? false;
        if (intervalRef.current)
            clearInterval(intervalRef.current);
        intervalRef.current = setInterval(refresh, running ? 2000 : 8000);
        return () => { if (intervalRef.current)
            clearInterval(intervalRef.current); };
    }, [refresh, crawlStatus?.running]);
    // Clock tick
    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(id);
    }, []);
    const isRunning = crawlStatus?.running ?? false;
    const TABS = [
        { id: 'market', label: '📈 Market' },
        { id: 'board', label: '📊 VN Board' },
        { id: 'industry', label: '🏭 Industry' },
        { id: 'wyckoff', label: '〜 Wyckoff' },
        { id: 'multifactor', label: '⚖ Multi-Factor' },
        { id: 'derivatives', label: '🔗 Phái sinh' },
        { id: 'buynow', label: '🎯 Buy Now' },
        { id: 'strongbuy', label: '🔥 Strong Buy' },
        { id: 'portfolio', label: '💼 Portfolio' },
        { id: 'backtest', label: '⏪ Backtest' },
        { id: 'vn100bt', label: '📉 VN100 BT' },
        { id: 'funds', label: '🏦 Funds' },
        { id: 'crawl', label: isRunning ? '⏳ Crawl' : '▶ Crawl' },
        { id: 'history', label: '📋 History' },
    ];
    const lastRunAccent = stats?.last_run?.status === 'done'
        ? 'text-emerald-400' : 'text-amber-400';
    return (_jsxs("div", { className: "min-h-screen bg-[#0d1117] text-[#e6edf3] text-sm", style: { fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace" }, children: [_jsxs("header", { className: "bg-[#161b22] border-b border-[#30363d] border-t-2 border-t-[#58a6ff]\n                         px-6 py-0 flex items-center justify-between sticky top-0 z-20 h-14", children: [_jsxs("div", { className: "flex items-center gap-4", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "text-[#58a6ff] font-bold text-base tracking-tight", children: "\uD83D\uDCC8 Stock Analytics" }), _jsx("span", { className: "text-[#8b949e]/60 text-xs", children: "\u00B7" }), _jsx("span", { className: "text-[#8b949e] text-xs", children: "Vietnam Market" })] }), _jsx("span", { className: `px-2.5 py-0.5 rounded-full text-xs font-semibold border transition-all ${isRunning
                                    ? 'bg-cyan-950 text-cyan-300 border-cyan-700 animate-pulse'
                                    : 'bg-[#21262d] text-[#8b949e] border-[#30363d]'}`, children: isRunning ? '⏳ crawling…' : '● idle' })] }), _jsxs("div", { className: "flex items-center gap-4 text-xs text-[#8b949e]", children: [_jsx("span", { className: "hidden sm:block", children: now.toLocaleDateString('vi-VN', { weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' }) }), _jsx("span", { className: "tabular-nums font-medium text-[#e6edf3]", children: now.toLocaleTimeString('vi-VN') })] })] }), _jsxs("div", { className: "px-6 py-3 flex gap-3 flex-wrap border-b border-[#30363d] bg-[#0d1117]", children: [_jsx(StatCard, { label: "Listed Symbols", value: stats?.total_symbols.toLocaleString() ?? '—', accent: "text-[#58a6ff]", icon: "\uD83C\uDFE6", borderColor: "#58a6ff" }), _jsx(StatCard, { label: "Price Records", value: stats?.total_quotes.toLocaleString() ?? '—', accent: "text-purple-400", icon: "\uD83D\uDCCA", borderColor: "#a855f7" }), _jsx(StatCard, { label: "Latest Date", value: stats?.latest_date ?? '—', accent: "text-emerald-400", icon: "\uD83D\uDCC5", borderColor: "#34d399" }), _jsx(StatCard, { label: "Last Crawl", value: stats?.last_run?.status ?? '—', accent: lastRunAccent, icon: "\uD83E\uDD16", borderColor: stats?.last_run?.status === 'done' ? '#34d399' : '#f59e0b' })] }), _jsx("div", { className: "px-6 flex border-b border-[#30363d] bg-[#0d1117] sticky top-14 z-10 overflow-x-auto scrollbar-none", children: TABS.map(tab => (_jsx("button", { onClick: () => setActiveTab(tab.id), className: `px-5 py-3 text-sm font-medium border-b-4 transition-all cursor-pointer ${activeTab === tab.id
                        ? 'border-[#58a6ff] text-[#58a6ff]'
                        : 'border-transparent text-[#8b949e] hover:text-[#e6edf3] hover:border-[#30363d]'}`, children: tab.label }, tab.id))) }), _jsxs("main", { className: "px-6 py-5 max-w-screen-xl mx-auto", children: [activeTab === 'market' && _jsx(MarketTab, {}), activeTab === 'board' && _jsx(VnBoardTab, {}), activeTab === 'industry' && _jsx(IndustryTab, {}), activeTab === 'wyckoff' && _jsx(WyckoffTab, {}), activeTab === 'multifactor' && _jsx(MultiFactorTab, {}), activeTab === 'derivatives' && _jsx(DerivativesTab, {}), activeTab === 'buynow' && _jsx(BuyNowTab, {}), activeTab === 'strongbuy' && _jsx(StrongBuyTab, {}), activeTab === 'portfolio' && _jsx(PortfolioTab, {}), activeTab === 'backtest' && _jsx(BacktestTab, {}), activeTab === 'vn100bt' && _jsx(PortfolioBacktestTab, {}), activeTab === 'funds' && _jsx(FundsTab, {}), activeTab === 'crawl' && _jsx(CrawlTab, { crawlStatus: crawlStatus, isRunning: isRunning, onRefresh: refresh }), activeTab === 'history' && _jsx(HistoryTab, { runs: runs })] }), _jsx("footer", { className: "border-t border-[#30363d] px-6 py-3 text-center text-xs text-[#8b949e]/50", children: "D\u1EEF li\u1EC7u t\u1EEB Fireant \u00B7 HOSE / HNX / UPCOM" })] }));
}
