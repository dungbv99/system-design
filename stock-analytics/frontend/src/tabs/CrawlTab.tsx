import { useCallback, useEffect, useState } from 'react'
import type { CrawlStatus } from '../types'
import { api, ALL_JOBS, JOB_LABELS, type Job } from '../api'
import { yesterday, fmtDate } from '../utils'

interface Props {
  crawlStatus: CrawlStatus | null
  isRunning:   boolean
  onRefresh:   () => void
}

export function CrawlTab({ crawlStatus, isRunning, onRefresh }: Props) {
  const [selectedDate, setSelectedDate] = useState(yesterday)
  const [selectedJobs, setSelectedJobs] = useState<Job[]>(['symbols', 'quotes', 'foreign', 'news'])
  const [submitting,   setSubmitting]   = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [toast,        setToast]        = useState<string | null>(null)

  const [updateInfo,    setUpdateInfo]    = useState<{ latest_date: string | null; from_date: string; to_date: string; up_to_date: boolean } | null>(null)
  const [updateLoading, setUpdateLoading] = useState(false)
  const [updateError,   setUpdateError]   = useState<string | null>(null)
  const [updateToast,   setUpdateToast]   = useState<string | null>(null)

  const [symbolInput,   setSymbolInput]   = useState('')
  const [symSubmitting, setSymSubmitting] = useState(false)
  const [symError,      setSymError]      = useState<string | null>(null)
  const [symToast,      setSymToast]      = useState<string | null>(null)

  const toggleJob = (job: Job) =>
    setSelectedJobs(prev => prev.includes(job) ? prev.filter(j => j !== job) : [...prev, job])

  const loadUpdateInfo = useCallback(async () => {
    try { setUpdateInfo(await api.updateInfo()) } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadUpdateInfo() }, [loadUpdateInfo])

  const handleUpdate = async () => {
    setUpdateLoading(true); setUpdateError(null)
    try {
      await api.triggerUpdate()
      setUpdateToast('Update started — fetching new trading days…')
      setTimeout(() => setUpdateToast(null), 5000)
      onRefresh()
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setUpdateLoading(false)
    }
  }

  const handleSymbolCrawl = async () => {
    const sym = symbolInput.trim().toUpperCase()
    if (!sym) return
    setSymSubmitting(true); setSymError(null); setSymToast(null)
    try {
      await api.crawlSymbol(sym)
      setSymToast(`Crawl started for ${sym} — history + fundamentals`)
      setTimeout(() => setSymToast(null), 5000)
      onRefresh()
    } catch (e) {
      setSymError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setSymSubmitting(false)
    }
  }

  const handleCrawl = async () => {
    if (!selectedDate || selectedJobs.length === 0) return
    setSubmitting(true); setError(null)
    try {
      await api.crawl(selectedDate, selectedJobs)
      setToast(`Crawl started for ${selectedDate}`)
      setTimeout(() => setToast(null), 3000)
      onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-5">

      {/* ── Sync to Today ──────────────────────────────────────────────────── */}
      <div className="bg-[#161b22] rounded-xl p-5 border border-[#30363d]">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-bold text-[#e6edf3] text-sm">Sync to Today</h2>
            {updateInfo && !updateInfo.up_to_date && (
              <p className="text-xs text-[#8b949e] mt-0.5">
                Will fetch&nbsp;
                <span className="text-emerald-400 font-semibold">{updateInfo.from_date}</span>
                &nbsp;→&nbsp;
                <span className="text-emerald-400 font-semibold">{updateInfo.to_date}</span>
                &nbsp;for all HOSE / HNX / UPCOM symbols
              </p>
            )}
            {updateInfo?.up_to_date && (
              <p className="text-xs text-emerald-500 mt-0.5">✓ Already up to date (latest: {updateInfo.latest_date})</p>
            )}
            {!updateInfo && (
              <p className="text-xs text-[#8b949e]/60 mt-0.5">Checking latest date…</p>
            )}
          </div>
          <button
            onClick={handleUpdate}
            disabled={isRunning || updateLoading || updateInfo?.up_to_date === true}
            className="px-5 py-2 rounded-lg bg-[#58a6ff] hover:bg-[#79b8ff] text-[#0d1117] font-bold
                       text-sm transition-all hover:scale-105 active:scale-95
                       disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 whitespace-nowrap">
            {updateLoading ? 'Starting…' : isRunning ? 'Crawl Running…' : '↑ Update Now'}
          </button>
        </div>
        {updateError && (
          <div className="mt-3 bg-red-950 border border-red-800 rounded-lg px-3 py-2 text-red-400 text-xs">
            {updateError}
          </div>
        )}
      </div>

      {updateToast && (
        <div className="fixed bottom-6 right-6 bg-[#161b22] border border-[#58a6ff]/50 text-[#58a6ff] px-4 py-2.5 rounded-xl shadow-xl text-sm font-medium z-50">
          ↑ {updateToast}
        </div>
      )}

      {/* ── Running indicator ──────────────────────────────────────────────── */}
      {isRunning && crawlStatus && (
        <div className="bg-cyan-950/50 border border-cyan-700/60 rounded-xl px-5 py-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <span className="font-semibold text-cyan-300 text-sm">Crawl in progress</span>
          </div>
          <div className="text-xs text-[#8b949e] space-y-1">
            <div><span className="text-[#8b949e]/60">Date: </span>{crawlStatus.date}</div>
            <div><span className="text-[#8b949e]/60">Jobs: </span>{crawlStatus.jobs.join(', ')}</div>
            <div><span className="text-[#8b949e]/60">Started: </span>{fmtDate(crawlStatus.started_at)}</div>
          </div>
          <div className="mt-3 h-1 bg-[#21262d] rounded-full overflow-hidden">
            <div className="h-1 bg-cyan-500 rounded-full w-2/5 animate-pulse" />
          </div>
        </div>
      )}

      {/* ── Trigger Crawl ─────────────────────────────────────────────────── */}
      <div className="bg-[#161b22] rounded-xl p-5 border border-[#30363d] space-y-4">
        <h2 className="font-bold text-[#e6edf3] text-sm">Trigger Crawl</h2>
        <div>
          <label className="block text-xs text-[#8b949e] mb-1">Target Date</label>
          <input type="date" value={selectedDate}
            max={new Date().toISOString().slice(0, 10)}
            onChange={e => setSelectedDate(e.target.value)}
            className="bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-[#e6edf3]
                       focus:outline-none focus:border-[#58a6ff]/60 w-48 transition-colors" />
        </div>
        <div>
          <label className="block text-xs text-[#8b949e] mb-2">Data to Fetch</label>
          <div className="flex flex-wrap gap-2">
            {ALL_JOBS.map(job => {
              const on = selectedJobs.includes(job)
              return (
                <button key={job} type="button" onClick={() => toggleJob(job)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                    on ? 'bg-emerald-950 border-emerald-700 text-emerald-300'
                       : 'bg-[#21262d] border-[#30363d] text-[#8b949e] hover:border-[#58a6ff]/40 hover:text-[#e6edf3]'}`}>
                  {on ? '✓ ' : ''}{JOB_LABELS[job]}
                </button>
              )
            })}
          </div>
          <p className="text-xs text-[#8b949e]/50 mt-1.5">Fundamentals makes ~1100 API calls and takes several minutes.</p>
        </div>
        {error && <div className="bg-red-950 border border-red-800 rounded-lg px-3 py-2 text-red-400 text-xs">{error}</div>}
        <button onClick={handleCrawl}
          disabled={isRunning || submitting || selectedJobs.length === 0 || !selectedDate}
          className="px-5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-bold
                     text-sm transition-all hover:scale-105 active:scale-95
                     disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100">
          {submitting ? 'Starting…' : isRunning ? 'Crawl Running…' : '▶ Start Crawl'}
        </button>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 bg-emerald-950 border border-emerald-700 text-emerald-300 px-4 py-2.5 rounded-xl shadow-xl text-sm font-medium z-50">
          ✓ {toast}
        </div>
      )}

      {/* ── Symbol crawl ──────────────────────────────────────────────────── */}
      <div className="bg-[#161b22] rounded-xl p-5 border border-[#30363d] space-y-4">
        <div>
          <h2 className="font-bold text-[#e6edf3] text-sm">Crawl Single Symbol</h2>
          <p className="text-xs text-[#8b949e] mt-0.5">
            Fetch full price history + fundamentals for one ticker.
          </p>
        </div>

        <div className="flex gap-2 items-start">
          <div className="flex-1">
            <input
              type="text"
              placeholder="e.g. VCB"
              value={symbolInput}
              maxLength={10}
              onChange={e => { setSymbolInput(e.target.value.toUpperCase()); setSymError(null) }}
              onKeyDown={e => e.key === 'Enter' && handleSymbolCrawl()}
              className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm
                         font-bold text-emerald-400 tracking-widest uppercase
                         focus:outline-none focus:border-[#58a6ff]/60 placeholder-[#8b949e]/50 transition-colors"
            />
          </div>
          <button
            onClick={handleSymbolCrawl}
            disabled={symSubmitting || !symbolInput.trim()}
            className="px-5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-bold
                       text-sm transition-all hover:scale-105 active:scale-95
                       disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 whitespace-nowrap">
            {symSubmitting ? 'Starting…' : '▶ Crawl Symbol'}
          </button>
        </div>

        <div className="flex flex-wrap gap-2 text-xs text-[#8b949e]">
          {['Price History (all time)', 'Fundamentals'].map(tag => (
            <span key={tag} className="px-2 py-0.5 bg-[#21262d] border border-[#30363d] rounded-full">{tag}</span>
          ))}
        </div>

        {symError && (
          <div className="bg-red-950 border border-red-800 rounded-lg px-3 py-2 text-red-400 text-xs">
            {symError}
          </div>
        )}
      </div>

      {symToast && (
        <div className="fixed bottom-6 right-6 bg-[#161b22] border border-[#58a6ff]/50 text-[#58a6ff] px-4 py-2.5 rounded-xl shadow-xl text-sm font-medium z-50">
          ✓ {symToast}
        </div>
      )}
    </div>
  )
}
