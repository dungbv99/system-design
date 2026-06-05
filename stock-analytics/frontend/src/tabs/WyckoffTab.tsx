import { useCallback, useEffect, useState } from 'react'
import type { WyckoffPage } from '../types'
import { api } from '../api'
import { fmtPrice } from '../utils'
import { ExchangeBadge } from '../components/ui'
import { SymbolModal } from '../components/SymbolModal'

// ── Helpers ───────────────────────────────────────────────────────────────────

const SIGNAL_META: Record<string, { label: string; bg: string; text: string; border: string }> = {
  BUY:   { label: 'BUY',   bg: 'bg-emerald-950', text: 'text-emerald-300', border: 'border-emerald-600' },
  SHORT: { label: 'SHORT', bg: 'bg-red-950',     text: 'text-red-300',     border: 'border-red-600'     },
  HOLD:  { label: 'HOLD',  bg: 'bg-blue-950',    text: 'text-blue-300',    border: 'border-blue-600'    },
  WAIT:  { label: 'WAIT',  bg: 'bg-[#21262d]',   text: 'text-[#8b949e]',  border: 'border-[#30363d]'  },
}

const STRENGTH_META: Record<string, { dot: string; label: string }> = {
  STRONG:   { dot: 'bg-emerald-400', label: 'Strong'   },
  MODERATE: { dot: 'bg-amber-400',   label: 'Moderate' },
  WEAK:     { dot: 'bg-[#8b949e]',   label: 'Weak'     },
}

const PHASE_COLOR: Record<string, string> = {
  Accumulation: 'text-cyan-400',
  Distribution: 'text-orange-400',
  Markup:       'text-emerald-400',
  Markdown:     'text-red-400',
  Unknown:      'text-[#8b949e]',
}

const EVENT_COLOR: Record<string, string> = {
  SC:     'text-red-400',
  Spring: 'text-yellow-400',
  Test:   'text-yellow-300',
  SOS:    'text-emerald-400',
  LPS:    'text-emerald-300',
  BC:     'text-orange-400',
  UT:     'text-orange-300',
  UTAD:   'text-red-300',
  LPSY:   'text-red-400',
  AR:     'text-blue-400',
  ST:     'text-blue-300',
}

function SignalBadge({ signal, strength }: { signal: string; strength: string }) {
  const m = SIGNAL_META[signal] ?? SIGNAL_META.WAIT
  const s = STRENGTH_META[strength] ?? STRENGTH_META.WEAK
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-xs font-bold
                      ${m.bg} ${m.text} ${m.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {m.label}
    </span>
  )
}

function PhaseLabel({ phase, sub }: { phase: string; sub: string }) {
  const color = PHASE_COLOR[phase] ?? 'text-[#8b949e]'
  return (
    <span className={`font-semibold ${color}`}>
      {phase} {sub !== '-' && <span className="font-bold">·{sub}</span>}
    </span>
  )
}

function EventBadge({ event }: { event: string }) {
  const color = EVENT_COLOR[event] ?? 'text-[#8b949e]'
  return <span className={`font-bold text-xs ${color}`}>{event}</span>
}

// ── Summary cards ─────────────────────────────────────────────────────────────

function SummaryCard({
  signal, count, strength, active, onClick,
}: {
  signal: string; count: number; strength?: string; active: boolean; onClick: () => void
}) {
  const m = SIGNAL_META[signal] ?? SIGNAL_META.WAIT
  return (
    <button
      onClick={onClick}
      className={`flex-1 min-w-[90px] rounded-xl p-3 border-2 text-left transition-all hover:scale-[1.02]
        ${active ? `${m.bg} ${m.border}` : 'bg-[#161b22] border-[#30363d]'}`}
    >
      <div className={`text-lg font-bold tabular-nums ${active ? m.text : 'text-[#e6edf3]'}`}>{count}</div>
      <div className={`text-xs mt-0.5 font-semibold ${active ? m.text : 'text-[#8b949e]'}`}>
        {signal}{strength ? ` ${strength}` : ''}
      </div>
    </button>
  )
}

// ── Phase diagram ─────────────────────────────────────────────────────────────

const ACCUM_PHASES = ['A','B','C','D','E']
const DISTR_PHASES = ['A','B','C','D']
const PHASE_EVENT_HINT: Record<string,string> = {
  A: 'SC·AR', B: 'ST·Range', C: 'Spring', D: 'SOS·LPS', E: 'Markup',
}
const DISTR_EVENT_HINT: Record<string,string> = {
  A: 'BC·AR', B: 'ST·Range', C: 'UT·UTAD', D: 'LPSY',
}

function PhaseDiagram({ phase, sub }: { phase: string; sub: string }) {
  if (phase !== 'Accumulation' && phase !== 'Distribution') return null
  const phases  = phase === 'Accumulation' ? ACCUM_PHASES : DISTR_PHASES
  const hints   = phase === 'Accumulation' ? PHASE_EVENT_HINT : DISTR_EVENT_HINT
  const acColor = phase === 'Accumulation' ? '#22d3ee' : '#fb923c'

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {phases.map((p, i) => {
        const active = p === sub
        return (
          <div key={p} className="flex items-center gap-1">
            <div className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded text-[10px]
                             border transition-all ${active
                               ? 'border-current font-bold'
                               : 'border-[#30363d] text-[#8b949e]'}`}
                 style={active ? { borderColor: acColor, color: acColor, background: `${acColor}18` } : {}}>
              <span>Phase {p}</span>
              <span className="text-[9px] opacity-70">{hints[p]}</span>
            </div>
            {i < phases.length - 1 && <span className="text-[#30363d] text-xs">→</span>}
          </div>
        )
      })}
      {phase === 'Accumulation' && (
        <><span className="text-[#30363d] text-xs">→</span>
          <span className="text-emerald-400 text-[10px] font-bold px-2 py-1 border border-emerald-800 rounded bg-emerald-950">
            Markup ↑
          </span></>
      )}
      {phase === 'Distribution' && (
        <><span className="text-[#30363d] text-xs">→</span>
          <span className="text-red-400 text-[10px] font-bold px-2 py-1 border border-red-800 rounded bg-red-950">
            Markdown ↓
          </span></>
      )}
    </div>
  )
}

// ── Main tab ──────────────────────────────────────────────────────────────────

const SIGNAL_FILTERS = ['ALL', 'BUY', 'SHORT', 'HOLD', 'WAIT'] as const
type SignalFilter = typeof SIGNAL_FILTERS[number]

export function WyckoffTab() {
  const [data,         setData]         = useState<WyckoffPage | null>(null)
  const [loading,      setLoading]      = useState(false)
  const [computing,    setComputing]    = useState(false)
  const [sigFilter,    setSigFilter]    = useState<SignalFilter>('BUY')
  const [phaseFilter,  setPhaseFilter]  = useState('')
  const [detail,       setDetail]       = useState<{ symbol: string; name: string } | null>(null)

  const load = useCallback(async (sig: SignalFilter, phase: string) => {
    setLoading(true)
    try {
      const d = await api.wyckoffSignals(sig === 'ALL' ? '' : sig, phase, 200)
      setData(d)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(sigFilter, phaseFilter) }, [load, sigFilter, phaseFilter])

  const handleCompute = async () => {
    setComputing(true)
    try {
      await api.computeWyckoff('HOSE,HNX')
      setTimeout(() => {
        load(sigFilter, phaseFilter)
        setComputing(false)
      }, 8000)
    } catch {
      setComputing(false)
    }
  }

  // Count by signal type across all items regardless of active filter
  const [allData, setAllData] = useState<WyckoffPage | null>(null)
  useEffect(() => {
    api.wyckoffSignals('', '', 2000).then(setAllData)
  }, [computing])

  const allCounts = allData?.items.reduce((acc, r) => {
    const key = r.signal
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {} as Record<string, number>) ?? {}

  return (
    <div className="space-y-4">

      {/* ── Summary cards ─────────────────────────────────────────────────── */}
      <div className="flex gap-3 flex-wrap">
        {(['BUY', 'SHORT', 'HOLD', 'WAIT'] as const).map(sig => (
          <SummaryCard
            key={sig}
            signal={sig}
            count={allCounts[sig] ?? 0}
            active={sigFilter === sig}
            onClick={() => { setSigFilter(sig); setPhaseFilter('') }}
          />
        ))}
        <div className="flex-1 min-w-[90px]" />
        <button
          onClick={handleCompute}
          disabled={computing}
          className={`self-center px-4 py-2 rounded-lg text-xs font-bold border transition-all
            ${computing
              ? 'bg-cyan-950 border-cyan-700 text-cyan-300 animate-pulse cursor-not-allowed'
              : 'bg-[#21262d] border-[#30363d] text-[#8b949e] hover:border-[#58a6ff]/50 hover:text-[#e6edf3]'}`}
        >
          {computing ? '⏳ Analysing…' : '⟳ Refresh Analysis'}
        </button>
      </div>

      {/* ── Filter bar ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1">
          {SIGNAL_FILTERS.map(f => (
            <button key={f} onClick={() => { setSigFilter(f); setPhaseFilter('') }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                ${sigFilter === f && phaseFilter === ''
                  ? 'bg-[#21262d] border-[#58a6ff] text-[#58a6ff]'
                  : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] hover:border-[#8b949e]/50'}`}>
              {f}
            </button>
          ))}
        </div>
        <div className="h-4 w-px bg-[#30363d]" />
        {['Accumulation', 'Distribution', 'Markup', 'Markdown'].map(p => (
          <button key={p} onClick={() => { setPhaseFilter(phaseFilter === p ? '' : p); setSigFilter('ALL') }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
              ${phaseFilter === p
                ? `${PHASE_COLOR[p].replace('text-', 'text-')} border-current bg-[#21262d]`
                : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] hover:border-[#8b949e]/50'}`}
            style={phaseFilter === p ? { borderColor: 'currentColor' } : {}}>
            {p}
          </button>
        ))}
        {data && (
          <span className="text-xs text-[#8b949e] ml-auto">
            {data.total} signals
          </span>
        )}
      </div>

      {/* ── Phase diagram (shown when accumulation/distribution filter active) */}
      {phaseFilter && (phaseFilter === 'Accumulation' || phaseFilter === 'Distribution') && (
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-3">
          <div className="text-xs text-[#8b949e] mb-2 font-semibold">{phaseFilter} Cycle</div>
          <PhaseDiagram phase={phaseFilter} sub="" />
        </div>
      )}

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      {loading && (
        <div className="text-center py-12 text-[#8b949e] text-sm animate-pulse">Loading Wyckoff signals…</div>
      )}

      {!loading && data && (
        <div className="overflow-x-auto rounded-lg border border-[#30363d]">
          <table className="w-full text-xs">
            <thead className="text-[#8b949e] uppercase tracking-wider text-[11px]">
              <tr>
                <th className="px-3 py-3 text-left font-semibold sticky top-0 z-10 bg-[#161b22]">Symbol</th>
                <th className="px-3 py-3 text-left font-semibold sticky top-0 z-10 bg-[#161b22]">Company</th>
                <th className="px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]">Exch</th>
                <th className="px-3 py-3 text-left font-semibold sticky top-0 z-10 bg-[#161b22]">Phase</th>
                <th className="px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]">Signal</th>
                <th className="px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]">Last Event</th>
                <th className="px-3 py-3 text-right font-semibold sticky top-0 z-10 bg-[#161b22]">Price (K₫)</th>
                <th className="px-3 py-3 text-right font-semibold sticky top-0 z-10 bg-[#161b22] text-emerald-400">
                  ▶ Best Buy
                </th>
                <th className="px-3 py-3 text-right font-semibold sticky top-0 z-10 bg-[#161b22] text-red-400">
                  ✕ Stop Loss
                </th>
                <th className="px-3 py-3 text-right font-semibold sticky top-0 z-10 bg-[#161b22] text-amber-400">
                  R:R
                </th>
                <th className="px-3 py-3 text-right font-semibold sticky top-0 z-10 bg-[#161b22]">Resistance</th>
                <th className="px-3 py-3 text-left font-semibold sticky top-0 z-10 bg-[#161b22]">Description</th>
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-4 py-10 text-center text-[#8b949e]">
                    No signals match the selected filter
                  </td>
                </tr>
              )}
              {data.items.map((row, i) => {
                // Risk:Reward ratio
                const rr = (row.entry_price && row.stop_loss && row.resistance &&
                            row.entry_price > row.stop_loss)
                  ? ((row.resistance - row.entry_price) / (row.entry_price - row.stop_loss))
                  : null
                return (
                  <tr
                    key={row.symbol}
                    className={`border-t border-[#30363d]/50 cursor-pointer transition-all
                      hover:bg-[#21262d] hover:ring-1 hover:ring-inset hover:ring-[#58a6ff]/20
                      ${i % 2 === 0 ? '' : 'bg-[#161b22]/30'}`}
                    style={{ borderLeft: `4px solid ${
                      row.signal === 'BUY'   ? '#34d399' :
                      row.signal === 'SHORT' ? '#f87171' :
                      row.signal === 'HOLD'  ? '#60a5fa' : '#30363d'
                    }` }}
                    onClick={() => setDetail({ symbol: row.symbol, name: row.name ?? row.symbol })}
                  >
                    <td className="px-3 py-2.5">
                      <span className="font-bold text-emerald-400 tracking-wide">{row.symbol}</span>
                    </td>
                    <td className="px-3 py-2.5 max-w-[150px]">
                      <span className="text-[#e6edf3] truncate block" title={row.name}>{row.name ?? '—'}</span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <ExchangeBadge exchange={row.exchange ?? ''} />
                    </td>
                    <td className="px-3 py-2.5">
                      <PhaseLabel phase={row.phase} sub={row.sub_phase} />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <SignalBadge signal={row.signal} strength={row.signal_strength} />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {row.last_event
                        ? <EventBadge event={row.last_event} />
                        : <span className="text-[#8b949e]">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium text-[#e6edf3] tabular-nums">
                      {row.current_price != null ? fmtPrice(row.current_price) : '—'}
                    </td>
                    {/* ── Best Buy ── */}
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {row.entry_price != null ? (
                        <span className="font-bold text-emerald-300 bg-emerald-950/60 px-1.5 py-0.5 rounded">
                          {fmtPrice(row.entry_price)}
                        </span>
                      ) : <span className="text-[#8b949e]">—</span>}
                    </td>
                    {/* ── Stop Loss ── */}
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {row.stop_loss != null ? (
                        <span className="font-bold text-red-300 bg-red-950/60 px-1.5 py-0.5 rounded">
                          {fmtPrice(row.stop_loss)}
                        </span>
                      ) : <span className="text-[#8b949e]">—</span>}
                    </td>
                    {/* ── R:R ── */}
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {rr != null ? (
                        <span className={`font-bold text-xs px-1.5 py-0.5 rounded ${
                          rr >= 3 ? 'text-emerald-300 bg-emerald-950/60' :
                          rr >= 2 ? 'text-amber-300 bg-amber-950/60' :
                                    'text-[#8b949e]'
                        }`}>
                          1:{rr.toFixed(1)}
                        </span>
                      ) : <span className="text-[#8b949e]">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right text-red-400/80 tabular-nums">
                      {row.resistance != null ? fmtPrice(row.resistance) : '—'}
                    </td>
                    <td className="px-3 py-2.5 max-w-[260px]">
                      <span className="text-[#8b949e] truncate block text-[11px]" title={row.description}>
                        {row.description}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-[#8b949e]/40 text-right">
        Wyckoff signals — HOSE + HNX · updated daily after market close · not financial advice
      </p>

      {detail && (
        <SymbolModal
          symbol={detail.symbol}
          name={detail.name}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  )
}
