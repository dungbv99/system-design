import { useCallback, useEffect, useMemo, useState } from 'react'
import type { WyckoffSignal, MultifactorSignal } from '../types'
import { api } from '../api'
import { fmtPrice } from '../utils'
import { ExchangeBadge } from '../components/ui'
import { SymbolModal } from '../components/SymbolModal'

// ── Helpers ───────────────────────────────────────────────────────────────────

const PHASE_COLOR: Record<string, string> = {
  Accumulation: 'text-cyan-400',
  Distribution: 'text-orange-400',
  Markup:       'text-emerald-400',
  Markdown:     'text-red-400',
  Unknown:      'text-[#8b949e]',
}

const STRENGTH_RANK: Record<string, number> = { STRONG: 0, MODERATE: 1, WEAK: 2 }

/** A symbol that is BUY in BOTH the Wyckoff and the Multi-factor engine. */
interface ConsensusRow {
  symbol:        string
  name:          string
  exchange:      string | null
  current_price: number | null
  // Wyckoff side
  phase:         string
  sub_phase:     string
  strength:      string
  entry_price:   number | null
  stop_loss:     number | null
  resistance:    number | null
  // Multi-factor side
  score:         number
  confidence:    string
  factors_agreed: number
  // derived
  gapPct:        number | null   // (current - entry) / entry × 100
  rr:            number | null
}

function ScorePill({ score }: { score: number }) {
  const color = score >= 70 ? '#34d399' : score >= 55 ? '#a3e635' : '#f59e0b'
  return (
    <span className="font-bold tabular-nums px-1.5 py-0.5 rounded text-xs"
          style={{ color, background: `${color}22` }}>
      {score}
    </span>
  )
}

function GapBadge({ gapPct }: { gapPct: number | null }) {
  if (gapPct == null) return <span className="text-[#8b949e]">—</span>
  const below = gapPct <= 0
  const sign  = gapPct > 0 ? '+' : gapPct < 0 ? '−' : ''
  return (
    <span className={`font-bold text-xs px-1.5 py-0.5 rounded tabular-nums ${
      below ? 'text-emerald-300 bg-emerald-950/60' : 'text-amber-300 bg-amber-950/60'
    }`}>
      {sign}{Math.abs(gapPct).toFixed(2)}%
    </span>
  )
}

// ── Main tab ──────────────────────────────────────────────────────────────────

const GAP_THRESHOLDS = [1, 2, 3, 5, 100] as const

export function StrongBuyTab() {
  const [wyckoff,  setWyckoff]  = useState<WyckoffSignal[] | null>(null)
  const [multi,    setMulti]    = useState<MultifactorSignal[] | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [maxGap,   setMaxGap]   = useState<number>(3)
  const [highOnly, setHighOnly] = useState(false)
  const [detail,   setDetail]   = useState<{ symbol: string; name: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [w, m] = await Promise.all([
        api.wyckoffSignals('BUY', '', 4000),
        api.multifactorSignals('BUY', 0, '', 4000),
      ])
      setWyckoff(w.items)
      setMulti(m.items)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Intersect by symbol → only stocks both engines call BUY.
  const rows: ConsensusRow[] = useMemo(() => {
    if (!wyckoff || !multi) return []
    const mfBySymbol = new Map(multi.map(m => [m.symbol, m]))
    const out: ConsensusRow[] = []
    for (const w of wyckoff) {
      const m = mfBySymbol.get(w.symbol)
      if (!m) continue
      if (highOnly && m.confidence !== 'HIGH') continue
      const entry = w.entry_price ?? m.entry_price
      const gapPct = (entry != null && entry > 0 && w.current_price != null)
        ? ((w.current_price - entry) / entry) * 100
        : null
      if (gapPct != null && Math.abs(gapPct) > maxGap) continue
      const stop = w.stop_loss ?? m.stop_loss
      const rr = (entry != null && stop != null && w.resistance != null && entry > stop)
        ? (w.resistance - entry) / (entry - stop)
        : null
      out.push({
        symbol: w.symbol,
        name: w.name ?? w.symbol,
        exchange: w.exchange ?? null,
        current_price: w.current_price,
        phase: w.phase,
        sub_phase: w.sub_phase,
        strength: w.signal_strength,
        entry_price: entry,
        stop_loss: stop,
        resistance: w.resistance,
        score: m.total_score,
        confidence: m.confidence,
        factors_agreed: m.factors_agreed,
        gapPct,
        rr,
      })
    }
    // Highest multi-factor score first; STRONG Wyckoff breaks ties.
    out.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return (STRENGTH_RANK[a.strength] ?? 9) - (STRENGTH_RANK[b.strength] ?? 9)
    })
    return out
  }, [wyckoff, multi, maxGap, highOnly])

  const highCount = rows.filter(r => r.confidence === 'HIGH').length

  return (
    <div className="space-y-4">

      {/* ── Heading ────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-bold text-emerald-400 flex items-center gap-2">🔥 Strong Buy</h2>
          <p className="text-xs text-[#8b949e] mt-1 max-w-2xl">
            Consensus picks — symbols flagged <span className="text-emerald-300 font-semibold">BUY</span> by
            <span className="text-cyan-300 font-semibold"> both</span> the Wyckoff engine and the Multi-factor
            score, with price within <span className="text-emerald-300 font-semibold">{maxGap === 100 ? 'any' : `${maxGap}%`}</span> of
            the best-buy entry. Two independent methods agreeing = higher conviction.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className={`self-start px-4 py-2 rounded-lg text-xs font-bold border transition-all
            ${loading
              ? 'bg-cyan-950 border-cyan-700 text-cyan-300 animate-pulse cursor-not-allowed'
              : 'bg-[#21262d] border-[#30363d] text-[#8b949e] hover:border-[#58a6ff]/50 hover:text-[#e6edf3]'}`}
        >
          {loading ? '⏳ Loading…' : '⟳ Reload'}
        </button>
      </div>

      {/* ── Controls ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-[#8b949e] font-semibold">Max gap from best buy:</span>
        <div className="flex gap-1">
          {GAP_THRESHOLDS.map(t => (
            <button key={t} onClick={() => setMaxGap(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all tabular-nums
                ${maxGap === t
                  ? 'bg-[#21262d] border-[#58a6ff] text-[#58a6ff]'
                  : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] hover:border-[#8b949e]/50'}`}>
              {t === 100 ? 'Any' : `≤ ${t}%`}
            </button>
          ))}
        </div>
        <div className="h-4 w-px bg-[#30363d]" />
        <button onClick={() => setHighOnly(v => !v)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
            ${highOnly
              ? 'bg-emerald-950 border-emerald-600 text-emerald-300'
              : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] hover:border-[#8b949e]/50'}`}>
          {highOnly ? '● ' : '○ '}HIGH confidence only
        </button>
        <span className="text-xs text-[#8b949e] ml-auto tabular-nums">
          {rows.length} consensus
          {!highOnly && highCount > 0 && <span className="text-emerald-300"> · {highCount} high</span>}
        </span>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      {loading && (
        <div className="text-center py-12 text-[#8b949e] text-sm animate-pulse">Loading consensus signals…</div>
      )}

      {!loading && (
        <div className="overflow-x-auto rounded-lg border border-[#30363d]">
          <table className="w-full text-xs">
            <thead className="text-[#8b949e] uppercase tracking-wider text-[11px]">
              <tr>
                <th className="px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22]">Symbol</th>
                <th className="px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22]">Company</th>
                <th className="px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]">Exch</th>
                <th className="px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22]">Wyckoff Phase</th>
                <th className="px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22] text-purple-400">MF Score</th>
                <th className="px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]">Conf</th>
                <th className="px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]">Agree</th>
                <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]">Price (K₫)</th>
                <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22] text-emerald-400">▶ Best Buy</th>
                <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22] text-amber-400">Gap</th>
                <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22] text-red-400">✕ Stop</th>
                <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]">Target</th>
                <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22] text-amber-400">R:R</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-4 py-10 text-center text-[#8b949e]">
                    No symbols are BUY in both engines within the chosen gap. Widen the gap, drop HIGH-only,
                    or run <span className="text-[#58a6ff]">Recalculate All</span> on the Wyckoff and Multi-Factor tabs.
                  </td>
                </tr>
              )}
              {rows.map((row, i) => (
                <tr
                  key={row.symbol}
                  className={`border-t border-[#30363d]/50 cursor-pointer transition-all
                    hover:bg-[#21262d] hover:ring-1 hover:ring-inset hover:ring-[#58a6ff]/20
                    ${i % 2 === 0 ? '' : 'bg-[#161b22]/30'}`}
                  style={{ borderLeft: '4px solid #34d399' }}
                  onClick={() => setDetail({ symbol: row.symbol, name: row.name })}
                >
                  <td className="px-3 py-2.5">
                    <span className="font-bold text-emerald-400 tracking-wide">{row.symbol}</span>
                  </td>
                  <td className="px-3 py-2.5 max-w-[150px]">
                    <span className="text-[#e6edf3] truncate block" title={row.name}>{row.name}</span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <ExchangeBadge exchange={row.exchange ?? ''} />
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`font-semibold ${PHASE_COLOR[row.phase] ?? 'text-[#8b949e]'}`}>
                      {row.phase} {row.sub_phase !== '-' && <span className="font-bold">·{row.sub_phase}</span>}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center"><ScorePill score={row.score} /></td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`text-xs font-bold ${
                      row.confidence === 'HIGH' ? 'text-emerald-300' :
                      row.confidence === 'MEDIUM' ? 'text-amber-300' : 'text-[#8b949e]'
                    }`}>{row.confidence}</span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`font-bold tabular-nums ${
                      row.factors_agreed >= 3 ? 'text-emerald-300' :
                      row.factors_agreed === 2 ? 'text-amber-300' : 'text-[#8b949e]'
                    }`}>{row.factors_agreed}/4</span>
                  </td>
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
                  <td className="px-3 py-2.5 text-right"><GapBadge gapPct={row.gapPct} /></td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {row.stop_loss != null
                      ? <span className="font-medium text-red-300/90">{fmtPrice(row.stop_loss)}</span>
                      : <span className="text-[#8b949e]">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right text-red-400/80 tabular-nums">
                    {row.resistance != null ? fmtPrice(row.resistance) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {row.rr != null ? (
                      <span className={`font-bold text-xs px-1.5 py-0.5 rounded ${
                        row.rr >= 3 ? 'text-emerald-300 bg-emerald-950/60' :
                        row.rr >= 2 ? 'text-amber-300 bg-amber-950/60' : 'text-[#8b949e]'
                      }`}>
                        1:{row.rr.toFixed(1)}
                      </span>
                    ) : <span className="text-[#8b949e]">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-[#8b949e]/40 text-right">
        Consensus = BUY in both Wyckoff and Multi-factor · sorted by multi-factor score · not financial advice
      </p>

      {detail && (
        <SymbolModal symbol={detail.symbol} name={detail.name} onClose={() => setDetail(null)} />
      )}
    </div>
  )
}
