import { useCallback, useEffect, useRef, useState } from 'react'
import type { Stats, CrawlStatus, CrawlRun } from './types'
import { api } from './api'
import { StatCard } from './components/ui'
import { MarketTab }    from './tabs/MarketTab'
import { VnBoardTab }   from './tabs/VnBoardTab'
import { IndustryTab }  from './tabs/IndustryTab'
import { WyckoffTab }   from './tabs/WyckoffTab'
import { MultiFactorTab } from './tabs/MultiFactorTab'
import { BuyNowTab }    from './tabs/BuyNowTab'
import { StrongBuyTab } from './tabs/StrongBuyTab'
import { PortfolioTab } from './tabs/PortfolioTab'
import { BacktestTab }  from './tabs/BacktestTab'
import { PortfolioBacktestTab } from './tabs/PortfolioBacktestTab'
import { CrawlTab }     from './tabs/CrawlTab'
import { HistoryTab }   from './tabs/HistoryTab'

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [stats,       setStats]       = useState<Stats | null>(null)
  const [crawlStatus, setCrawlStatus] = useState<CrawlStatus | null>(null)
  const [runs,        setRuns]        = useState<CrawlRun[]>([])
  const [activeTab,   setActiveTab]   = useState<'market' | 'board' | 'industry' | 'wyckoff' | 'multifactor' | 'buynow' | 'strongbuy' | 'portfolio' | 'backtest' | 'vn100bt' | 'crawl' | 'history'>('market')
  const [now,         setNow]         = useState(() => new Date())

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [s, cs, r] = await Promise.all([api.stats(), api.status(), api.runs()])
      setStats(s); setCrawlStatus(cs); setRuns(r)
    } catch { /* backend starting */ }
  }, [])

  useEffect(() => {
    refresh()
    const running = crawlStatus?.running ?? false
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(refresh, running ? 2000 : 8000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [refresh, crawlStatus?.running])

  // Clock tick
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const isRunning = crawlStatus?.running ?? false

  const TABS = [
    { id: 'market',   label: '📈 Market'    },
    { id: 'board',    label: '📊 VN Board'  },
    { id: 'industry', label: '🏭 Industry'  },
    { id: 'wyckoff',  label: '〜 Wyckoff'   },
    { id: 'multifactor', label: '⚖ Multi-Factor' },
    { id: 'buynow',   label: '🎯 Buy Now'   },
    { id: 'strongbuy', label: '🔥 Strong Buy' },
    { id: 'portfolio', label: '💼 Portfolio' },
    { id: 'backtest', label: '⏪ Backtest'  },
    { id: 'vn100bt',  label: '📉 VN100 BT'  },
    { id: 'crawl',    label: isRunning ? '⏳ Crawl' : '▶ Crawl' },
    { id: 'history',  label: '📋 History'  },
  ] as const

  const lastRunAccent = stats?.last_run?.status === 'done'
    ? 'text-emerald-400' : 'text-amber-400'

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#e6edf3] text-sm"
         style={{ fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace" }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="bg-[#161b22] border-b border-[#30363d] border-t-2 border-t-[#58a6ff]
                         px-6 py-0 flex items-center justify-between sticky top-0 z-20 h-14">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-[#58a6ff] font-bold text-base tracking-tight">📈 Stock Analytics</span>
            <span className="text-[#8b949e]/60 text-xs">·</span>
            <span className="text-[#8b949e] text-xs">Vietnam Market</span>
          </div>
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border transition-all ${
            isRunning
              ? 'bg-cyan-950 text-cyan-300 border-cyan-700 animate-pulse'
              : 'bg-[#21262d] text-[#8b949e] border-[#30363d]'
          }`}>
            {isRunning ? '⏳ crawling…' : '● idle'}
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs text-[#8b949e]">
          <span className="hidden sm:block">{now.toLocaleDateString('vi-VN', { weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' })}</span>
          <span className="tabular-nums font-medium text-[#e6edf3]">{now.toLocaleTimeString('vi-VN')}</span>
        </div>
      </header>

      {/* ── Stat bar ────────────────────────────────────────────────────── */}
      <div className="px-6 py-3 flex gap-3 flex-wrap border-b border-[#30363d] bg-[#0d1117]">
        <StatCard
          label="Listed Symbols"
          value={stats?.total_symbols.toLocaleString() ?? '—'}
          accent="text-[#58a6ff]"
          icon="🏦"
          borderColor="#58a6ff"
        />
        <StatCard
          label="Price Records"
          value={stats?.total_quotes.toLocaleString() ?? '—'}
          accent="text-purple-400"
          icon="📊"
          borderColor="#a855f7"
        />
        <StatCard
          label="Latest Date"
          value={stats?.latest_date ?? '—'}
          accent="text-emerald-400"
          icon="📅"
          borderColor="#34d399"
        />
        <StatCard
          label="Last Crawl"
          value={stats?.last_run?.status ?? '—'}
          accent={lastRunAccent}
          icon="🤖"
          borderColor={stats?.last_run?.status === 'done' ? '#34d399' : '#f59e0b'}
        />
      </div>

      {/* ── Tab nav ─────────────────────────────────────────────────────── */}
      <div className="px-6 flex border-b border-[#30363d] bg-[#0d1117] sticky top-14 z-10">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-5 py-3 text-sm font-medium border-b-4 transition-all cursor-pointer ${
              activeTab === tab.id
                ? 'border-[#58a6ff] text-[#58a6ff]'
                : 'border-transparent text-[#8b949e] hover:text-[#e6edf3] hover:border-[#30363d]'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <main className="px-6 py-5 max-w-screen-xl mx-auto">
        {activeTab === 'market'   && <MarketTab />}
        {activeTab === 'board'    && <VnBoardTab />}
        {activeTab === 'industry' && <IndustryTab />}
        {activeTab === 'wyckoff'  && <WyckoffTab />}
        {activeTab === 'multifactor' && <MultiFactorTab />}
        {activeTab === 'buynow'   && <BuyNowTab />}
        {activeTab === 'strongbuy' && <StrongBuyTab />}
        {activeTab === 'portfolio' && <PortfolioTab />}
        {activeTab === 'backtest' && <BacktestTab />}
        {activeTab === 'vn100bt'  && <PortfolioBacktestTab />}
        {activeTab === 'crawl'   && <CrawlTab crawlStatus={crawlStatus} isRunning={isRunning} onRefresh={refresh} />}
        {activeTab === 'history' && <HistoryTab runs={runs} />}
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-[#30363d] px-6 py-3 text-center text-xs text-[#8b949e]/50">
        Dữ liệu từ Fireant · HOSE / HNX / UPCOM
      </footer>
    </div>
  )
}
