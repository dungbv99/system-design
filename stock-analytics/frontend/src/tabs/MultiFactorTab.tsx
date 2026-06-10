import { useCallback, useEffect, useState } from 'react'
import type { MultifactorPage } from '../types'
import { api } from '../api'
import { fmtPrice } from '../utils'
import { ExchangeBadge } from '../components/ui'
import { SymbolModal } from '../components/SymbolModal'

// ── Helpers ───────────────────────────────────────────────────────────────────

const SIGNAL_META: Record<string, { label: string; bg: string; text: string; border: string; bar: string }> = {
  BUY:   { label: 'BUY',   bg: 'bg-emerald-950', text: 'text-emerald-300', border: 'border-emerald-600', bar: '#34d399' },
  WATCH: { label: 'WATCH', bg: 'bg-amber-950',   text: 'text-amber-300',   border: 'border-amber-600',   bar: '#f59e0b' },
  AVOID: { label: 'AVOID', bg: 'bg-red-950',     text: 'text-red-300',     border: 'border-red-700',     bar: '#f87171' },
}

const CONF_DOT: Record<string, string> = {
  HIGH:   'bg-emerald-400',
  MEDIUM: 'bg-amber-400',
  LOW:    'bg-[#8b949e]',
}

function SignalBadge({ signal, confidence }: { signal: string; confidence: string }) {
  const m = SIGNAL_META[signal] ?? SIGNAL_META.WATCH
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-xs font-bold
                      ${m.bg} ${m.text} ${m.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${CONF_DOT[confidence] ?? CONF_DOT.LOW}`} />
      {m.label}
    </span>
  )
}

/** Total-score gauge (0–100) with a colour ramp. */
function ScoreBar({ score }: { score: number }) {
  const color = score >= 70 ? '#34d399' : score >= 55 ? '#a3e635' : score >= 40 ? '#f59e0b' : '#f87171'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-[#21262d] overflow-hidden min-w-[60px]">
        <div className="h-full rounded-full transition-all"
             style={{ width: `${Math.max(0, Math.min(100, score))}%`, background: color }} />
      </div>
      <span className="font-bold tabular-nums w-7 text-right" style={{ color }}>{score}</span>
    </div>
  )
}

/** Per-factor mini cell: 0–25 value over a tinted bar. */
function FactorCell({ value, reason }: { value: number; reason: string }) {
  const pct = Math.max(0, Math.min(100, (value / 25) * 100))
  const agreed = value >= 15
  const color = agreed ? '#34d399' : value >= 8 ? '#f59e0b' : '#6e7681'
  return (
    <div className="flex flex-col gap-1 min-w-[52px]" title={reason}>
      <span className={`text-[11px] font-bold tabular-nums ${agreed ? 'text-emerald-300' : 'text-[#8b949e]'}`}>
        {value}<span className="text-[#8b949e]/50">/25</span>
      </span>
      <div className="h-1.5 rounded-full bg-[#21262d] overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

function SummaryCard({
  signal, count, active, onClick,
}: { signal: string; count: number; active: boolean; onClick: () => void }) {
  const m = SIGNAL_META[signal] ?? SIGNAL_META.WATCH
  return (
    <button
      onClick={onClick}
      className={`flex-1 min-w-[90px] rounded-xl p-3 border-2 text-left transition-all hover:scale-[1.02]
        ${active ? `${m.bg} ${m.border}` : 'bg-[#161b22] border-[#30363d]'}`}
    >
      <div className={`text-lg font-bold tabular-nums ${active ? m.text : 'text-[#e6edf3]'}`}>{count}</div>
      <div className={`text-xs mt-0.5 font-semibold ${active ? m.text : 'text-[#8b949e]'}`}>{signal}</div>
    </button>
  )
}

// ── Main tab ──────────────────────────────────────────────────────────────────

const SIGNAL_FILTERS = ['ALL', 'BUY', 'WATCH', 'AVOID'] as const
type SignalFilter = typeof SIGNAL_FILTERS[number]

const CONF_FILTERS = ['HIGH', 'MEDIUM', 'LOW'] as const

export function MultiFactorTab() {
  const [data,      setData]      = useState<MultifactorPage | null>(null)
  const [allData,   setAllData]   = useState<MultifactorPage | null>(null)
  const [loading,   setLoading]   = useState(false)
  const [computing, setComputing] = useState(false)
  const [sigFilter, setSigFilter] = useState<SignalFilter>('BUY')
  const [confFilter, setConfFilter] = useState<string>('')
  const [minScore,  setMinScore]  = useState(0)
  const [detail,    setDetail]    = useState<{ symbol: string; name: string } | null>(null)

  const load = useCallback(async (sig: SignalFilter, conf: string, min: number) => {
    setLoading(true)
    try {
      const d = await api.multifactorSignals(sig === 'ALL' ? '' : sig, min, conf, 500)
      setData(d)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(sigFilter, confFilter, minScore) }, [load, sigFilter, confFilter, minScore])
  useEffect(() => { api.multifactorSignals('', 0, '', 4000).then(setAllData) }, [computing])

  const handleCompute = async () => {
    setComputing(true)
    try {
      await api.computeMultifactor('all')
      setTimeout(() => { load(sigFilter, confFilter, minScore); setComputing(false) }, 12000)
    } catch {
      setComputing(false)
    }
  }

  const counts = allData?.items.reduce((acc, r) => {
    acc[r.signal] = (acc[r.signal] ?? 0) + 1
    return acc
  }, {} as Record<string, number>) ?? {}

  return (
    <div className="space-y-4">

      {/* ── Summary cards ─────────────────────────────────────────────────── */}
      <div className="flex gap-3 flex-wrap">
        {(['BUY', 'WATCH', 'AVOID'] as const).map(sig => (
          <SummaryCard
            key={sig}
            signal={sig}
            count={counts[sig] ?? 0}
            active={sigFilter === sig}
            onClick={() => setSigFilter(sig)}
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
          {computing ? '⏳ Scoring all symbols…' : '⟳ Recalculate All'}
        </button>
      </div>

      {/* ── Filter bar ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1">
          {SIGNAL_FILTERS.map(f => (
            <button key={f} onClick={() => setSigFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                ${sigFilter === f
                  ? 'bg-[#21262d] border-[#58a6ff] text-[#58a6ff]'
                  : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] hover:border-[#8b949e]/50'}`}>
              {f}
            </button>
          ))}
        </div>
        <div className="h-4 w-px bg-[#30363d]" />
        <span className="text-xs text-[#8b949e] font-semibold">Confidence:</span>
        <div className="flex gap-1">
          {CONF_FILTERS.map(c => (
            <button key={c} onClick={() => setConfFilter(confFilter === c ? '' : c)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                ${confFilter === c
                  ? 'bg-[#21262d] border-[#58a6ff] text-[#58a6ff]'
                  : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] hover:border-[#8b949e]/50'}`}>
              {c}
            </button>
          ))}
        </div>
        <div className="h-4 w-px bg-[#30363d]" />
        <span className="text-xs text-[#8b949e] font-semibold">Min score:</span>
        <div className="flex gap-1">
          {[0, 40, 55, 70].map(m => (
            <button key={m} onClick={() => setMinScore(m)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all tabular-nums
                ${minScore === m
                  ? 'bg-[#21262d] border-[#58a6ff] text-[#58a6ff]'
                  : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] hover:border-[#8b949e]/50'}`}>
              ≥ {m}
            </button>
          ))}
        </div>
        {data && <span className="text-xs text-[#8b949e] ml-auto">{data.total} signals</span>}
      </div>

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      {loading && (
        <div className="text-center py-12 text-[#8b949e] text-sm animate-pulse">Loading multi-factor signals…</div>
      )}

      {!loading && data && (
        <div className="overflow-x-auto rounded-lg border border-[#30363d]">
          <table className="w-full text-xs">
            <thead className="text-[#8b949e] uppercase tracking-wider text-[11px]">
              <tr>
                <th className="px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22]">Symbol</th>
                <th className="px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22]">Company</th>
                <th className="px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]">Exch</th>
                <th className="px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]">Signal</th>
                <th className="px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22] min-w-[120px]">Score</th>
                <th className="px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]">Agree</th>
                <th className="px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22] text-cyan-400">Trend</th>
                <th className="px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22] text-purple-400">Mom</th>
                <th className="px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22] text-blue-400">Vol</th>
                <th className="px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22] text-orange-400">Pos</th>
                <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]">Price (K₫)</th>
                <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22] text-emerald-400">▶ Entry</th>
                <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22] text-red-400">✕ Stop</th>
                <th className="px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22]">Description</th>
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={14} className="px-4 py-10 text-center text-[#8b949e]">
                    No signals match the selected filter. Try{' '}
                    <span className="text-[#58a6ff]">Recalculate All</span> if none have been computed yet.
                  </td>
                </tr>
              )}
              {data.items.map((row, i) => (
                <tr
                  key={row.symbol}
                  className={`border-t border-[#30363d]/50 cursor-pointer transition-all
                    hover:bg-[#21262d] hover:ring-1 hover:ring-inset hover:ring-[#58a6ff]/20
                    ${i % 2 === 0 ? '' : 'bg-[#161b22]/30'}`}
                  style={{ borderLeft: `4px solid ${(SIGNAL_META[row.signal] ?? SIGNAL_META.WATCH).bar}` }}
                  onClick={() => setDetail({ symbol: row.symbol, name: row.name ?? row.symbol })}
                >
                  <td className="px-3 py-2.5">
                    <span className="font-bold text-emerald-400 tracking-wide">{row.symbol}</span>
                  </td>
                  <td className="px-3 py-2.5 max-w-[140px]">
                    <span className="text-[#e6edf3] truncate block" title={row.name}>{row.name ?? '—'}</span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <ExchangeBadge exchange={row.exchange ?? ''} />
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <SignalBadge signal={row.signal} confidence={row.confidence} />
                  </td>
                  <td className="px-3 py-2.5"><ScoreBar score={row.total_score} /></td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`font-bold tabular-nums ${
                      row.factors_agreed >= 3 ? 'text-emerald-300' :
                      row.factors_agreed === 2 ? 'text-amber-300' : 'text-[#8b949e]'
                    }`}>{row.factors_agreed}/4</span>
                  </td>
                  <td className="px-3 py-2.5"><FactorCell value={row.trend_score}    reason={row.trend_reason} /></td>
                  <td className="px-3 py-2.5"><FactorCell value={row.momentum_score} reason={row.momentum_reason} /></td>
                  <td className="px-3 py-2.5"><FactorCell value={row.volume_score}   reason={row.volume_reason} /></td>
                  <td className="px-3 py-2.5"><FactorCell value={row.position_score} reason={row.position_reason} /></td>
                  <td className="px-3 py-2.5 text-right font-medium text-[#e6edf3] tabular-nums">
                    {row.current_price != null ? fmtPrice(row.current_price) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {row.entry_price != null ? (
                      <span className="font-bold text-emerald-300 bg-emerald-950/60 px-1.5 py-0.5 rounded">
                        {fmtPrice(row.entry_price)}
                      </span>
                    ) : <span className="text-[#8b949e]">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {row.stop_loss != null ? (
                      <span className="font-bold text-red-300 bg-red-950/60 px-1.5 py-0.5 rounded">
                        {fmtPrice(row.stop_loss)}
                      </span>
                    ) : <span className="text-[#8b949e]">—</span>}
                  </td>
                  <td className="px-3 py-2.5 max-w-[240px]">
                    <span className="text-[#8b949e] truncate block text-[11px]" title={row.description}>
                      {row.description}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-[#8b949e]/40 text-right">
        Multi-factor score = Trend + Momentum + Volume + Position (each 0–25) · agree = factor ≥ 15/25 · not financial advice
      </p>

      {detail && (
        <SymbolModal symbol={detail.symbol} name={detail.name} onClose={() => setDetail(null)} />
      )}
    </div>
  )
}
