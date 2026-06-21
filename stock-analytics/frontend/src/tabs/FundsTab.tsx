import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Fund, FundHolding } from '../types'
import { api } from '../api'
import { fmtDate } from '../utils'
import { ExchangeBadge } from '../components/ui'
import { SymbolModal } from '../components/SymbolModal'

// ── Formatting ────────────────────────────────────────────────────────────────

const fmtPct = (v: number | null | undefined) =>
  v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`

const pctColor = (v: number | null | undefined) =>
  v == null ? 'text-[#8b949e]' : v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-[#8b949e]'

// Stable color per industry for the holding chips
const INDUSTRY_COLORS = [
  '#58a6ff', '#a855f7', '#34d399', '#f59e0b', '#f87171',
  '#22d3ee', '#fb923c', '#c084fc', '#4ade80', '#ec4899',
]
const industryColor = (s: string | null) => {
  if (!s) return '#8b949e'
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return INDUSTRY_COLORS[Math.abs(h) % INDUSTRY_COLORS.length]
}

// ── Return badges ─────────────────────────────────────────────────────────────

function ReturnRow({ fund }: { fund: Fund }) {
  const items: [string, number | null][] = [
    ['1M', fund.return_1m], ['3M', fund.return_3m],
    ['6M', fund.return_6m], ['12M', fund.return_12m],
  ]
  return (
    <div className="flex gap-3 flex-wrap">
      {items.map(([k, v]) => (
        <div key={k} className="text-center">
          <div className={`text-xs font-bold tabular-nums ${pctColor(v)}`}>{fmtPct(v)}</div>
          <div className="text-[9px] text-[#8b949e] uppercase">{k}</div>
        </div>
      ))}
    </div>
  )
}

// ── Holding bar ───────────────────────────────────────────────────────────────

function HoldingBar({ h, onClick }: { h: FundHolding; onClick: () => void }) {
  const pct = h.net_asset_percent
  return (
    <button
      onClick={onClick}
      title={`${h.stock_code}${h.company_name ? ' · ' + h.company_name : ''}${h.industry ? ' · ' + h.industry : ''}\n${pct.toFixed(2)}% of NAV — click for chart`}
      className="group w-full flex items-center gap-2 py-1 px-1.5 rounded hover:bg-[#21262d] transition-colors text-left"
    >
      <span className="font-bold text-emerald-400 tracking-wide w-12 shrink-0 group-hover:text-emerald-300">
        {h.stock_code}
      </span>
      <div className="flex-1 h-2 rounded-full bg-[#21262d] overflow-hidden min-w-[40px]">
        <div className="h-full rounded-full" style={{ width: `${Math.min(pct * 6, 100)}%`, background: industryColor(h.industry) }} />
      </div>
      <span className="text-xs text-[#e6edf3] tabular-nums w-12 text-right shrink-0">{pct.toFixed(1)}%</span>
    </button>
  )
}

// ── Fund card ─────────────────────────────────────────────────────────────────

function FundCard({ fund, onPick }: { fund: Fund; onPick: (sym: string, name: string) => void }) {
  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-base font-bold text-[#58a6ff] tracking-tight">{fund.short_name}</div>
          <div className="text-[11px] text-[#8b949e] leading-snug line-clamp-2" title={fund.name}>{fund.name}</div>
          {fund.owner_name && (
            <div className="text-[10px] text-[#8b949e]/60 mt-0.5 truncate" title={fund.owner_name}>{fund.owner_name}</div>
          )}
        </div>
        <ReturnRow fund={fund} />
      </div>

      <div className="border-t border-[#30363d] pt-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-[#8b949e] uppercase tracking-wider">
            Top holdings ({fund.holdings.length})
          </span>
          {fund.nav != null && fund.nav > 0 && (
            <span className="text-[10px] text-[#8b949e]">
              NAV {fund.nav.toLocaleString('vi-VN')} ₫
            </span>
          )}
        </div>
        {fund.holdings.length === 0 ? (
          <div className="text-xs text-[#8b949e]/60 py-2 text-center">No holdings reported</div>
        ) : (
          <div className="space-y-0.5">
            {fund.holdings.map(h => (
              <HoldingBar key={h.stock_code} h={h} onClick={() => onPick(h.stock_code, h.company_name ?? h.stock_code)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── By-stock aggregation ──────────────────────────────────────────────────────

interface StockAgg {
  stock_code:   string
  company_name: string | null
  exchange:     string | null
  industry:     string | null
  funds:        { short_name: string; pct: number }[]
  avg_pct:      number
}

function buildStockIndex(funds: Fund[]): StockAgg[] {
  const map = new Map<string, StockAgg>()
  for (const f of funds) {
    for (const h of f.holdings) {
      let agg = map.get(h.stock_code)
      if (!agg) {
        agg = { stock_code: h.stock_code, company_name: h.company_name, exchange: h.exchange, industry: h.industry, funds: [], avg_pct: 0 }
        map.set(h.stock_code, agg)
      }
      agg.funds.push({ short_name: f.short_name, pct: h.net_asset_percent })
    }
  }
  const out = [...map.values()]
  for (const a of out) {
    a.funds.sort((x, y) => y.pct - x.pct)
    a.avg_pct = a.funds.reduce((s, x) => s + x.pct, 0) / a.funds.length
  }
  // Most widely-held first, then by average weight
  out.sort((a, b) => b.funds.length - a.funds.length || b.avg_pct - a.avg_pct)
  return out
}

function StockRow({ s, onPick }: { s: StockAgg; onPick: (sym: string, name: string) => void }) {
  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPick(s.stock_code, s.company_name ?? s.stock_code)}
          className="font-bold text-emerald-400 hover:text-emerald-300 tracking-wide">
          {s.stock_code}
        </button>
        <ExchangeBadge exchange={s.exchange} />
        {s.company_name && <span className="text-xs text-[#8b949e] truncate">{s.company_name}</span>}
        <span className="ml-auto text-xs font-bold text-[#58a6ff] tabular-nums">
          {s.funds.length} {s.funds.length === 1 ? 'fund' : 'funds'}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {s.funds.map(f => (
          <span key={f.short_name}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border border-[#30363d] bg-[#0d1117] text-[#8b949e]">
            <span className="font-semibold text-[#e6edf3]">{f.short_name}</span>
            <span className="tabular-nums text-[#58a6ff]">{f.pct.toFixed(1)}%</span>
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Tab ───────────────────────────────────────────────────────────────────────

export function FundsTab() {
  const [funds,     setFunds]     = useState<Fund[]>([])
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [view,      setView]      = useState<'fund' | 'stock'>('fund')
  const [query,     setQuery]     = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [msg,       setMsg]       = useState<string | null>(null)
  const [detail,    setDetail]    = useState<{ symbol: string; name: string } | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollCountRef = useRef(0)

  const load = useCallback(async () => {
    try {
      const page = await api.funds()
      setFunds(page.funds ?? [])
      setUpdatedAt(page.updated_at)
    } catch { /* backend starting */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const handleRefresh = async () => {
    setRefreshing(true)
    setMsg('Đang lấy dữ liệu quỹ mới nhất từ fmarket…')
    if (pollRef.current) clearInterval(pollRef.current)
    pollCountRef.current = 0
    try {
      await api.refreshFunds()
      // Background job (~10–30s for ~30 funds). Poll until counts settle.
      pollRef.current = setInterval(async () => {
        pollCountRef.current += 1
        await load()
        if (pollCountRef.current >= 8 && pollRef.current) {
          clearInterval(pollRef.current); pollRef.current = null
          setRefreshing(false); setMsg(null)
        }
      }, 3000)
    } catch (e) {
      setMsg(e instanceof Error ? `✕ ${e.message}` : '✕ Update failed')
      setRefreshing(false)
    }
  }

  const q = query.trim().toUpperCase()

  const shownFunds = useMemo(() => {
    if (!q) return funds
    return funds
      .map(f => {
        const fundMatch = f.short_name.toUpperCase().includes(q) || f.name.toUpperCase().includes(q)
        if (fundMatch) return f
        const hits = f.holdings.filter(h => h.stock_code.includes(q))
        return hits.length ? { ...f, holdings: hits } : null
      })
      .filter((f): f is Fund => f !== null)
  }, [funds, q])

  const stockIndex = useMemo(() => {
    const idx = buildStockIndex(funds)
    if (!q) return idx
    return idx.filter(s => s.stock_code.includes(q) || (s.company_name ?? '').toUpperCase().includes(q))
  }, [funds, q])

  return (
    <div>
      {/* Controls */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex bg-[#161b22] border border-[#30363d] rounded-lg p-0.5">
          {([['fund', '🏦 By Fund'], ['stock', '📊 By Stock']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                view === v ? 'bg-[#21262d] text-[#58a6ff]' : 'text-[#8b949e] hover:text-[#e6edf3]'
              }`}>
              {label}
            </button>
          ))}
        </div>

        <input
          type="text"
          placeholder={view === 'fund' ? 'Search fund or stock…' : 'Search stock…'}
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-[#e6edf3]
                     w-64 focus:outline-none focus:border-[#58a6ff]/60 placeholder-[#8b949e] transition-colors"
        />

        <span className="text-xs text-[#8b949e]">
          {funds.length} funds · {stockIndex.length} stocks
        </span>

        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className={`ml-auto flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold border transition-all
            disabled:opacity-60 disabled:cursor-not-allowed ${
            refreshing
              ? 'bg-cyan-950 border-cyan-700 text-cyan-300 animate-pulse'
              : 'bg-[#58a6ff] border-[#58a6ff] text-[#0d1117] hover:bg-[#79b8ff] hover:scale-105 active:scale-95'
          }`}>
          <span className={refreshing ? 'animate-spin inline-block' : ''}>↻</span>
          {refreshing ? 'Updating…' : 'Update now'}
        </button>
      </div>

      {(msg || updatedAt) && (
        <div className="mb-3 text-xs text-[#8b949e] flex items-center gap-2">
          {msg
            ? <span className="text-cyan-300 animate-pulse">{msg}</span>
            : <span>Last updated: <span className="text-[#e6edf3]">{fmtDate(updatedAt)}</span> · data from fmarket.vn</span>}
        </div>
      )}

      {/* Body */}
      {loading ? (
        <div className="py-16 text-center text-[#8b949e] text-sm animate-pulse">Loading funds…</div>
      ) : funds.length === 0 ? (
        <div className="py-16 text-center space-y-3">
          <div className="text-[#8b949e] text-sm">No fund data yet.</div>
          <div className="text-[#8b949e]/60 text-xs">Click <span className="text-[#58a6ff] font-semibold">Update now</span> to crawl equity funds from fmarket.vn.</div>
        </div>
      ) : view === 'fund' ? (
        shownFunds.length === 0 ? (
          <div className="py-16 text-center text-[#8b949e] text-sm">No funds match “{query}”.</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {shownFunds.map(f => (
              <FundCard key={f.fund_id} fund={f} onPick={(symbol, name) => setDetail({ symbol, name })} />
            ))}
          </div>
        )
      ) : (
        stockIndex.length === 0 ? (
          <div className="py-16 text-center text-[#8b949e] text-sm">No stocks match “{query}”.</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {stockIndex.map(s => (
              <StockRow key={s.stock_code} s={s} onPick={(symbol, name) => setDetail({ symbol, name })} />
            ))}
          </div>
        )
      )}

      {detail && (
        <SymbolModal symbol={detail.symbol} name={detail.name} onClose={() => setDetail(null)} />
      )}
    </div>
  )
}
