import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SymbolRow, SymbolsPage, WyckoffSignal, Prediction } from '../types'
import { api, VN_SECTORS } from '../api'
import { fmtPrice, fmtVol } from '../utils'
import { ExchangeBadge, Sparkline, ChangePct } from '../components/ui'
import { SymbolModal } from '../components/SymbolModal'

const SIG_STYLE: Record<string, { bg: string; text: string; border: string }> = {
  BUY:   { bg: 'bg-emerald-950', text: 'text-emerald-300', border: 'border-emerald-700' },
  SHORT: { bg: 'bg-red-950',     text: 'text-red-300',     border: 'border-red-700'     },
  HOLD:  { bg: 'bg-blue-950',    text: 'text-blue-300',    border: 'border-blue-700'    },
  WAIT:  { bg: 'bg-[#21262d]',   text: 'text-[#8b949e]',  border: 'border-[#30363d]'  },
}
const STRENGTH_DOT: Record<string, string> = {
  STRONG: 'bg-emerald-400', MODERATE: 'bg-amber-400', WEAK: 'bg-[#555]',
}
const PHASE_SHORT: Record<string, string> = {
  Accumulation: 'Acc', Distribution: 'Dist', Markup: 'Up', Markdown: 'Down',
}

function PredictionCell({ p }: { p: Prediction | undefined }) {
  if (!p) return <span className="text-[#8b949e]/50 text-[10px]">—</span>
  const isBuy = p.signal === 'BUY'
  const pct   = Math.round(p.score * 100)
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-bold ${
        isBuy
          ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
          : 'bg-[#21262d] text-[#8b949e] border-[#30363d]'
      }`}>
        {p.signal}
      </span>
      <div className="flex items-center gap-1">
        <div className="w-10 h-1 rounded-full bg-[#30363d] overflow-hidden">
          <div
            className={`h-full rounded-full ${isBuy ? 'bg-emerald-500' : 'bg-[#555]'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className={`text-[9px] tabular-nums ${isBuy ? 'text-emerald-400' : 'text-[#8b949e]'}`}>
          {pct}%
        </span>
      </div>
    </div>
  )
}

function WyckoffCell({ w }: { w: WyckoffSignal | undefined }) {
  if (!w || w.signal === 'WAIT') {
    return <span className="text-[#8b949e]/50 text-[10px]">—</span>
  }
  const s = SIG_STYLE[w.signal] ?? SIG_STYLE.WAIT
  const d = STRENGTH_DOT[w.signal_strength] ?? STRENGTH_DOT.WEAK
  const phase = PHASE_SHORT[w.phase] ?? w.phase
  const sub   = w.sub_phase !== '-' ? `·${w.sub_phase}` : ''
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-bold
                        ${s.bg} ${s.text} ${s.border}`}>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${d}`} />
        {w.signal}
      </span>
      <span className="text-[9px] text-[#8b949e]">{phase}{sub}</span>
    </div>
  )
}

type SectorKey = keyof typeof VN_SECTORS
type SortKey   = 'symbol' | 'close' | 'change_pct' | 'volume' | 'xgb_score'

export function IndustryTab() {
  const [activeSector, setActiveSector] = useState<SectorKey>('vnfin')
  const [data,         setData]         = useState<SymbolsPage | null>(null)
  const [loading,      setLoading]      = useState(false)
  const [detail,       setDetail]       = useState<SymbolRow | null>(null)
  const [sortKey,      setSortKey]      = useState<SortKey>('change_pct')
  const [sortAsc,      setSortAsc]      = useState(false)
  const [wyckoffMap,   setWyckoffMap]   = useState<Map<string, WyckoffSignal>>(new Map())
  const [predMap,      setPredMap]      = useState<Map<string, Prediction>>(new Map())
  const [liveSymbols,  setLiveSymbols]  = useState<Record<string, string[]>>({})
  const [refreshing,   setRefreshing]   = useState(false)

  useEffect(() => {
    api.wyckoffSignals('', '', 2000).then(d => {
      setWyckoffMap(new Map(d.items.map(w => [w.symbol, w])))
    }).catch(() => {})
    api.predictions('', 5, 2000).then(d => {
      setPredMap(new Map(d.items.map(p => [p.symbol, p])))
    }).catch(() => {})
  }, [])

  const sec = VN_SECTORS[activeSector]

  const refreshCompositions = useCallback(() => {
    setRefreshing(true)
    api.compositions()
      .then(c => { setLiveSymbols(c); setData(null) })
      .catch(() => {})
      .finally(() => setRefreshing(false))
  }, [])

  const load = useCallback((key: SectorKey) => {
    const s    = VN_SECTORS[key]
    const syms = liveSymbols[key] ?? s.symbols
    setLoading(true)
    api.symbols('', syms.length, 0, '', syms.join(','))
      .then(d => { setData(d); setLoading(false) })
  }, [liveSymbols])

  useEffect(() => { load(activeSector) }, [load, activeSector])

  const handleSector = (key: SectorKey) => { setActiveSector(key); setData(null) }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(key === 'symbol') }
  }

  const sorted = useMemo(() => {
    if (!data) return []
    return [...data.items].sort((a, b) => {
      let av: string | number, bv: string | number
      if (sortKey === 'xgb_score') {
        av = predMap.get(a.symbol)?.score ?? (sortAsc ? Infinity : -Infinity)
        bv = predMap.get(b.symbol)?.score ?? (sortAsc ? Infinity : -Infinity)
      } else {
        av = a[sortKey] ?? (sortAsc ? Infinity : -Infinity)
        bv = b[sortKey] ?? (sortAsc ? Infinity : -Infinity)
      }
      if (typeof av === 'string' && typeof bv === 'string')
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number)
    })
  }, [data, sortKey, sortAsc, predMap])

  const advances  = sorted.filter(r => (r.change_pct ?? 0) > 0).length
  const declines  = sorted.filter(r => (r.change_pct ?? 0) < 0).length
  const unchanged = sorted.filter(r => r.change_pct != null && r.change_pct === 0).length
  const noData    = sorted.filter(r => r.change_pct == null).length

  const SortTh = ({ col, label, right }: { col: SortKey; label: string; right?: boolean }) => (
    <th
      className={`px-3 py-3 font-semibold cursor-pointer select-none whitespace-nowrap
                  hover:text-[#e6edf3] transition-colors sticky top-0 z-10 bg-[#161b22]
                  ${right ? 'text-right' : 'text-left'}`}
      onClick={() => handleSort(col)}
    >
      {label}
      {sortKey === col && <span className="ml-1 text-[#58a6ff]">{sortAsc ? '↑' : '↓'}</span>}
    </th>
  )

  return (
    <div className="space-y-4">

      {/* ── Sector grid ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs text-[#8b949e]">Select a sector to view its stocks</span>
        <button
          onClick={refreshCompositions}
          disabled={refreshing}
          title="Fetch latest sector compositions from SSI"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all
            ${refreshing
              ? 'border-[#30363d] text-[#8b949e] cursor-not-allowed'
              : 'border-[#58a6ff]/40 text-[#58a6ff] hover:bg-[#58a6ff]/10 hover:border-[#58a6ff]'
            }`}
        >
          <span>↺</span>
          {refreshing ? 'Fetching…' : 'Refresh Symbols'}
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {(Object.keys(VN_SECTORS) as SectorKey[]).map(key => {
          const s     = VN_SECTORS[key]
          const active = key === activeSector
          const live   = liveSymbols[key]
          const count  = live ? live.length : s.symbols.length
          return (
            <button
              key={key}
              onClick={() => handleSector(key)}
              className={`rounded-xl p-4 text-left border-2 transition-all hover:scale-[1.01] ${
                active
                  ? 'shadow-lg scale-[1.02] border-current'
                  : 'border-[#30363d] hover:border-[#8b949e]/50 bg-[#161b22]/50'
              }`}
              style={active ? { borderColor: s.color, background: `${s.color}14` } : {}}
            >
              <div className="font-bold text-sm" style={active ? { color: s.color } : { color: '#8b949e' }}>
                {s.label}
              </div>
              <div className="text-xs mt-0.5" style={{ color: active ? `${s.color}99` : '#6e7681' }}>
                {s.labelVi}
              </div>
              <div className="text-xs text-[#8b949e] mt-0.5">{count} stocks{live ? ' ✓' : ''}</div>
              {active && data && (
                <div className="flex gap-2 mt-1.5 text-xs">
                  <span className="text-emerald-400">▲ {advances}</span>
                  <span className="text-red-400">▼ {declines}</span>
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* ── Market breadth bar ─────────────────────────────────────────────── */}
      {data && !loading && (
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg px-4 py-3 flex items-center gap-6 flex-wrap">
          <span className="text-xs font-bold text-[#e6edf3]">{sec.label}</span>
          <span className="text-xs text-[#8b949e]">{sec.labelVi}</span>
          <div className="flex items-center gap-1.5">
            <div className="h-2 rounded-full bg-emerald-500"
                 style={{ width: `${Math.max(advances * 4, 4)}px` }} />
            <span className="text-xs text-emerald-400 font-semibold">▲ {advances}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 rounded-full bg-red-500"
                 style={{ width: `${Math.max(declines * 4, 4)}px` }} />
            <span className="text-xs text-red-400 font-semibold">▼ {declines}</span>
          </div>
          {unchanged > 0 && <span className="text-xs text-[#8b949e]">= {unchanged}</span>}
          {noData    > 0 && <span className="text-xs text-[#8b949e]/60">no data: {noData}</span>}
          <span className="text-xs text-[#8b949e]/60 ml-auto">click column header to sort</span>
        </div>
      )}

      {/* ── Loading ─────────────────────────────────────────────────────────── */}
      {loading && (
        <div className="text-center py-12 text-[#8b949e] text-sm animate-pulse">
          Loading {sec.label}…
        </div>
      )}

      {/* ── Stock table ─────────────────────────────────────────────────────── */}
      {!loading && data && (
        <div className="overflow-x-auto rounded-lg border border-[#30363d]">
          <table className="w-full text-xs">
            <thead className="text-[#8b949e] uppercase tracking-wider text-[11px]">
              <tr>
                <SortTh col="symbol"     label="Symbol" />
                <th className="px-3 py-3 text-left font-semibold sticky top-0 z-10 bg-[#161b22]">Company</th>
                <th className="px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]">Exch</th>
                <SortTh col="close"      label="Close (K₫)" right />
                <SortTh col="change_pct" label="Change"     right />
                <th className="px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]">Wyckoff</th>
                <th
                  className="px-3 py-3 text-center font-semibold cursor-pointer select-none whitespace-nowrap
                             hover:text-[#e6edf3] transition-colors sticky top-0 z-10 bg-[#161b22] text-purple-400"
                  onClick={() => {
                    if (sortKey === 'xgb_score') setSortAsc(a => !a)
                    else { setSortKey('xgb_score'); setSortAsc(false) }
                  }}
                >
                  XGB 5d
                  {sortKey === 'xgb_score' && <span className="ml-1 text-[#58a6ff]">{sortAsc ? '↑' : '↓'}</span>}
                </th>
                <th className="px-3 py-3 text-right font-semibold sticky top-0 z-10 bg-[#161b22] text-emerald-400">▶ Entry</th>
                <SortTh col="volume"     label="Volume"     right />
                <th className="px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]">Trend</th>
                <th className="px-3 py-3 text-left font-semibold sticky top-0 z-10 bg-[#161b22]">Date</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-[#8b949e]">
                    No data — run a crawl first to populate prices
                  </td>
                </tr>
              )}
              {sorted.map((row, i) => {
                const chgPct = row.change_pct ?? 0
                const hasPct = row.change_pct != null
                const borderColor = !hasPct ? '#30363d'
                  : chgPct > 0 ? '#34d399'
                  : chgPct < 0 ? '#f87171'
                  : '#8b949e'
                return (
                  <tr
                    key={row.symbol}
                    className={`border-t border-[#30363d]/50 cursor-pointer transition-all
                      hover:bg-[#21262d] hover:ring-1 hover:ring-inset hover:ring-[#58a6ff]/20
                      ${i % 2 === 0 ? '' : 'bg-[#161b22]/30'}`}
                    style={{ borderLeft: `4px solid ${borderColor}` }}
                    onClick={() => setDetail(row)}
                  >
                    <td className="px-3 py-2.5">
                      <span className="font-bold text-emerald-400 tracking-wide">{row.symbol}</span>
                    </td>
                    <td className="px-3 py-2.5 max-w-[180px]">
                      <span className="text-[#e6edf3] truncate block" title={row.name}>{row.name}</span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <ExchangeBadge exchange={row.exchange} />
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium text-[#e6edf3] tabular-nums">
                      {fmtPrice(row.close)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <ChangePct v={row.change_pct} />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <WyckoffCell w={wyckoffMap.get(row.symbol)} />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <PredictionCell p={predMap.get(row.symbol)} />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {(() => {
                        const w = wyckoffMap.get(row.symbol)
                        if (!w?.entry_price) return <span className="text-[#8b949e]/50">—</span>
                        return (
                          <span className={`font-bold px-1.5 py-0.5 rounded text-[11px]
                            ${w.signal === 'BUY'   ? 'text-emerald-300 bg-emerald-950/60' :
                              w.signal === 'SHORT' ? 'text-red-300 bg-red-950/60' :
                                                     'text-[#e6edf3]'}`}>
                            {fmtPrice(w.entry_price)}
                          </span>
                        )
                      })()}
                    </td>
                    <td className="px-3 py-2.5 text-right text-[#8b949e] tabular-nums">{fmtVol(row.volume)}</td>
                    <td className="px-3 py-2.5 text-center">
                      {row.close != null
                        ? <Sparkline prices={[row.prev_close ?? row.close, row.close]} />
                        : <span className="text-[#8b949e]">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-[#8b949e] whitespace-nowrap">{row.latest_date ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-[#8b949e]/40 text-right">
        HOSE GICS sectors · sourced from SSI iboard indexGroups
      </p>

      {detail && (
        <SymbolModal symbol={detail.symbol} name={detail.name} onClose={() => setDetail(null)} />
      )}
    </div>
  )
}
