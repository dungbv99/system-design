import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from 'react';
import { api, ALL_JOBS, JOB_LABELS } from '../api';
import { yesterday, fmtDate } from '../utils';
export function CrawlTab({ crawlStatus, isRunning, onRefresh }) {
    const [selectedDate, setSelectedDate] = useState(yesterday);
    const [selectedJobs, setSelectedJobs] = useState(['symbols', 'quotes', 'foreign', 'news']);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [toast, setToast] = useState(null);
    const [updateInfo, setUpdateInfo] = useState(null);
    const [updateLoading, setUpdateLoading] = useState(false);
    const [updateError, setUpdateError] = useState(null);
    const [updateToast, setUpdateToast] = useState(null);
    const [symbolInput, setSymbolInput] = useState('');
    const [symSubmitting, setSymSubmitting] = useState(false);
    const [symError, setSymError] = useState(null);
    const [symToast, setSymToast] = useState(null);
    const [adjusting, setAdjusting] = useState(false);
    const [adjustError, setAdjustError] = useState(null);
    const [adjustToast, setAdjustToast] = useState(null);
    const toggleJob = (job) => setSelectedJobs(prev => prev.includes(job) ? prev.filter(j => j !== job) : [...prev, job]);
    const loadUpdateInfo = useCallback(async () => {
        try {
            setUpdateInfo(await api.updateInfo());
        }
        catch { /* ignore */ }
    }, []);
    useEffect(() => { loadUpdateInfo(); }, [loadUpdateInfo]);
    const handleUpdate = async () => {
        setUpdateLoading(true);
        setUpdateError(null);
        try {
            await api.triggerUpdate();
            setUpdateToast('Update started — fetching new trading days…');
            setTimeout(() => setUpdateToast(null), 5000);
            onRefresh();
        }
        catch (e) {
            setUpdateError(e instanceof Error ? e.message : 'Request failed');
        }
        finally {
            setUpdateLoading(false);
        }
    };
    const handleSymbolCrawl = async () => {
        const sym = symbolInput.trim().toUpperCase();
        if (!sym)
            return;
        setSymSubmitting(true);
        setSymError(null);
        setSymToast(null);
        try {
            await api.crawlSymbol(sym);
            setSymToast(`Crawl started for ${sym} — history + fundamentals`);
            setTimeout(() => setSymToast(null), 5000);
            onRefresh();
        }
        catch (e) {
            setSymError(e instanceof Error ? e.message : 'Request failed');
        }
        finally {
            setSymSubmitting(false);
        }
    };
    const handleAdjustAll = async () => {
        setAdjusting(true);
        setAdjustError(null);
        try {
            // jobs=['history'] re-pulls the full dividend-adjusted series (from 2000)
            // for every HOSE/HNX/UPCOM symbol and overwrites the stored prices.
            const today = new Date().toISOString().slice(0, 10);
            await api.crawl(today, ['history']);
            setAdjustToast('Re-adjusting all prices — full history re-fetch started (several minutes).');
            setTimeout(() => setAdjustToast(null), 6000);
            onRefresh();
        }
        catch (e) {
            setAdjustError(e instanceof Error ? e.message : 'Request failed');
        }
        finally {
            setAdjusting(false);
        }
    };
    const handleCrawl = async () => {
        if (!selectedDate || selectedJobs.length === 0)
            return;
        setSubmitting(true);
        setError(null);
        try {
            await api.crawl(selectedDate, selectedJobs);
            setToast(`Crawl started for ${selectedDate}`);
            setTimeout(() => setToast(null), 3000);
            onRefresh();
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Request failed');
        }
        finally {
            setSubmitting(false);
        }
    };
    return (_jsxs("div", { className: "space-y-5", children: [_jsxs("div", { className: "bg-[#161b22] rounded-xl p-5 border border-[#30363d]", children: [_jsxs("div", { className: "flex items-center justify-between flex-wrap gap-3", children: [_jsxs("div", { children: [_jsx("h2", { className: "font-bold text-[#e6edf3] text-sm", children: "Sync to Today" }), updateInfo && !updateInfo.up_to_date && (_jsxs("p", { className: "text-xs text-[#8b949e] mt-0.5", children: ["Will fetch\u00A0", _jsx("span", { className: "text-emerald-400 font-semibold", children: updateInfo.from_date }), "\u00A0\u2192\u00A0", _jsx("span", { className: "text-emerald-400 font-semibold", children: updateInfo.to_date }), "\u00A0for all HOSE / HNX / UPCOM symbols"] })), updateInfo?.up_to_date && (_jsxs("p", { className: "text-xs text-emerald-500 mt-0.5", children: ["\u2713 Already up to date (latest: ", updateInfo.latest_date, ")"] })), !updateInfo && (_jsx("p", { className: "text-xs text-[#8b949e]/60 mt-0.5", children: "Checking latest date\u2026" }))] }), _jsx("button", { onClick: handleUpdate, disabled: isRunning || updateLoading || updateInfo?.up_to_date === true, className: "px-5 py-2 rounded-lg bg-[#58a6ff] hover:bg-[#79b8ff] text-[#0d1117] font-bold\n                       text-sm transition-all hover:scale-105 active:scale-95\n                       disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 whitespace-nowrap", children: updateLoading ? 'Starting…' : isRunning ? 'Crawl Running…' : '↑ Update Now' })] }), updateError && (_jsx("div", { className: "mt-3 bg-red-950 border border-red-800 rounded-lg px-3 py-2 text-red-400 text-xs", children: updateError }))] }), updateToast && (_jsxs("div", { className: "fixed bottom-6 right-6 bg-[#161b22] border border-[#58a6ff]/50 text-[#58a6ff] px-4 py-2.5 rounded-xl shadow-xl text-sm font-medium z-50", children: ["\u2191 ", updateToast] })), _jsxs("div", { className: "bg-[#161b22] rounded-xl p-5 border border-[#30363d]", children: [_jsxs("div", { className: "flex items-center justify-between flex-wrap gap-3", children: [_jsxs("div", { children: [_jsx("h2", { className: "font-bold text-[#e6edf3] text-sm", children: "Adjust All Prices" }), _jsxs("p", { className: "text-xs text-[#8b949e] mt-0.5 max-w-xl", children: ["Re-fetch the full ", _jsx("span", { className: "text-amber-300 font-semibold", children: "dividend-adjusted" }), " price history for ", _jsx("span", { className: "text-emerald-400 font-semibold", children: "every" }), " HOSE / HNX / UPCOM symbol and overwrite stored prices. Use after dividends or splits shift the adjusted series."] }), _jsx("p", { className: "text-xs text-[#8b949e]/50 mt-1", children: "~1,500 symbols \u00B7 re-pulls from 2000 \u00B7 takes several minutes." })] }), _jsx("button", { onClick: handleAdjustAll, disabled: isRunning || adjusting, className: "px-5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-[#0d1117] font-bold\n                       text-sm transition-all hover:scale-105 active:scale-95\n                       disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 whitespace-nowrap", children: adjusting ? 'Starting…' : isRunning ? 'Crawl Running…' : '↻ Adjust All Prices' })] }), adjustError && (_jsx("div", { className: "mt-3 bg-red-950 border border-red-800 rounded-lg px-3 py-2 text-red-400 text-xs", children: adjustError }))] }), adjustToast && (_jsxs("div", { className: "fixed bottom-6 right-6 bg-amber-950 border border-amber-700 text-amber-300 px-4 py-2.5 rounded-xl shadow-xl text-sm font-medium z-50", children: ["\u21BB ", adjustToast] })), isRunning && crawlStatus && (_jsxs("div", { className: "bg-cyan-950/50 border border-cyan-700/60 rounded-xl px-5 py-4", children: [_jsxs("div", { className: "flex items-center gap-2 mb-2", children: [_jsx("div", { className: "w-2 h-2 rounded-full bg-cyan-400 animate-pulse" }), _jsx("span", { className: "font-semibold text-cyan-300 text-sm", children: "Crawl in progress" })] }), _jsxs("div", { className: "text-xs text-[#8b949e] space-y-1", children: [_jsxs("div", { children: [_jsx("span", { className: "text-[#8b949e]/60", children: "Date: " }), crawlStatus.date] }), _jsxs("div", { children: [_jsx("span", { className: "text-[#8b949e]/60", children: "Jobs: " }), crawlStatus.jobs.join(', ')] }), _jsxs("div", { children: [_jsx("span", { className: "text-[#8b949e]/60", children: "Started: " }), fmtDate(crawlStatus.started_at)] })] }), _jsx("div", { className: "mt-3 h-1 bg-[#21262d] rounded-full overflow-hidden", children: _jsx("div", { className: "h-1 bg-cyan-500 rounded-full w-2/5 animate-pulse" }) })] })), _jsxs("div", { className: "bg-[#161b22] rounded-xl p-5 border border-[#30363d] space-y-4", children: [_jsx("h2", { className: "font-bold text-[#e6edf3] text-sm", children: "Trigger Crawl" }), _jsxs("div", { children: [_jsx("label", { className: "block text-xs text-[#8b949e] mb-1", children: "Target Date" }), _jsx("input", { type: "date", value: selectedDate, max: new Date().toISOString().slice(0, 10), onChange: e => setSelectedDate(e.target.value), className: "bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-[#e6edf3]\n                       focus:outline-none focus:border-[#58a6ff]/60 w-48 transition-colors" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-xs text-[#8b949e] mb-2", children: "Data to Fetch" }), _jsx("div", { className: "flex flex-wrap gap-2", children: ALL_JOBS.map(job => {
                                    const on = selectedJobs.includes(job);
                                    return (_jsxs("button", { type: "button", onClick: () => toggleJob(job), className: `px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${on ? 'bg-emerald-950 border-emerald-700 text-emerald-300'
                                            : 'bg-[#21262d] border-[#30363d] text-[#8b949e] hover:border-[#58a6ff]/40 hover:text-[#e6edf3]'}`, children: [on ? '✓ ' : '', JOB_LABELS[job]] }, job));
                                }) }), _jsx("p", { className: "text-xs text-[#8b949e]/50 mt-1.5", children: "Fundamentals makes ~1100 API calls and takes several minutes." })] }), error && _jsx("div", { className: "bg-red-950 border border-red-800 rounded-lg px-3 py-2 text-red-400 text-xs", children: error }), _jsx("button", { onClick: handleCrawl, disabled: isRunning || submitting || selectedJobs.length === 0 || !selectedDate, className: "px-5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-bold\n                     text-sm transition-all hover:scale-105 active:scale-95\n                     disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100", children: submitting ? 'Starting…' : isRunning ? 'Crawl Running…' : '▶ Start Crawl' })] }), toast && (_jsxs("div", { className: "fixed bottom-6 right-6 bg-emerald-950 border border-emerald-700 text-emerald-300 px-4 py-2.5 rounded-xl shadow-xl text-sm font-medium z-50", children: ["\u2713 ", toast] })), _jsxs("div", { className: "bg-[#161b22] rounded-xl p-5 border border-[#30363d] space-y-4", children: [_jsxs("div", { children: [_jsx("h2", { className: "font-bold text-[#e6edf3] text-sm", children: "Crawl Single Symbol" }), _jsx("p", { className: "text-xs text-[#8b949e] mt-0.5", children: "Fetch full price history + fundamentals for one ticker." })] }), _jsxs("div", { className: "flex gap-2 items-start", children: [_jsx("div", { className: "flex-1", children: _jsx("input", { type: "text", placeholder: "e.g. VCB", value: symbolInput, maxLength: 10, onChange: e => { setSymbolInput(e.target.value.toUpperCase()); setSymError(null); }, onKeyDown: e => e.key === 'Enter' && handleSymbolCrawl(), className: "w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm\n                         font-bold text-emerald-400 tracking-widest uppercase\n                         focus:outline-none focus:border-[#58a6ff]/60 placeholder-[#8b949e]/50 transition-colors" }) }), _jsx("button", { onClick: handleSymbolCrawl, disabled: symSubmitting || !symbolInput.trim(), className: "px-5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-bold\n                       text-sm transition-all hover:scale-105 active:scale-95\n                       disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 whitespace-nowrap", children: symSubmitting ? 'Starting…' : '▶ Crawl Symbol' })] }), _jsx("div", { className: "flex flex-wrap gap-2 text-xs text-[#8b949e]", children: ['Price History (all time)', 'Fundamentals'].map(tag => (_jsx("span", { className: "px-2 py-0.5 bg-[#21262d] border border-[#30363d] rounded-full", children: tag }, tag))) }), symError && (_jsx("div", { className: "bg-red-950 border border-red-800 rounded-lg px-3 py-2 text-red-400 text-xs", children: symError }))] }), symToast && (_jsxs("div", { className: "fixed bottom-6 right-6 bg-[#161b22] border border-[#58a6ff]/50 text-[#58a6ff] px-4 py-2.5 rounded-xl shadow-xl text-sm font-medium z-50", children: ["\u2713 ", symToast] }))] }));
}
