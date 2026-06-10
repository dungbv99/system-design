import { useCallback, useEffect, useMemo, useState } from 'react'
import type { WyckoffSignal } from '../types'
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

const STRENGTH_META: Record<string, { dot: string; label: string; text: string }> = {
  STRONG:   { dot: 'bg-emerald-400', label: 'Strong',   text: 'text-emerald-300' },
  MODERATE: { dot: 'bg-amber-400',   label: 'Moderate', text: 'text-amber-300'   },
  WEAK:     { dot: 'bg-[#8b949e]',   label: 'Weak',     text: 'text-[#8b949e]'  },
}

const STRENGTH_RANK: Record<string, number> = { STRONG: 0, MODERATE: 1, WEAK: 2 }

// Threshold presets — "how close to the best-buy price is close enough"
const THRESHOLDS = [0.5, 1, 2, 3] as const

interface BuyRow extends WyckoffSignal {
  gapPct: number   // (current - entry) / entry × 100  (negative = below best buy)
  rr:     number | null
}

function PhaseLabel({ phase, sub }: { phase: string; sub: string }) {
  const color = PHASE_COLOR[phase] ?? 'text-[#8b949e]'
  return (
    <span className={`font-semibold ${color}`}>
      {phase} {sub !== '-' && <span className="font-bold">·{sub}</span>}
    </span>
  )
}

function StrengthBadge({ strength }: { strength: string }) {
  const s = STRENGTH_META[strength] ?? STRENGTH_META.WEAK
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  )
}

/** Signed gap badge. Below best-buy (cheaper) = green; at/above = amber. */
function GapBadge({ gapPct }: { gapPct: number }) {
  const below = gapPct <= 0
  const sign  = gapPct > 0 ? '+' : gapPct < 0 ? '−' : ''
  const abs   = Math.abs(gapPct)
  return (
    <span className={`font-bold text-xs px-1.5 py-0.5 rounded tabular-nums ${
      below ? 'text-emerald-300 bg-emerald-950/60' : 'text-amber-300 bg-amber-950/60'
    }`}>
      {sign}{abs.toFixed(2)}%
    </span>
  )
}

// ── Main tab ──────────────────────────────────────────────────────────────────

export function BuyNowTab() {
  const [signals,   setSignals]   = useState<WyckoffSignal[] | null>(null)
  const [loading,   setLoading]   = useState(false)
  const [maxGap,    setMaxGap]    = useState<number>(1)        // percent
  const [strongOnly, setStrongOnly] = useState(false)
  const [detail,    setDetail]    = useState<{ symbol: string; name: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const page = await api.wyckoffSignals('BUY', '', 2000)
      setSignals(page.items)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Build, filter (current price within maxGap% of best-buy entry), and sort.
  const rows: BuyRow[] = useMemo(() => {
    if (!signals) return []
    const out: BuyRow[] = []
    for (const s of signals) {
      if (s.entry_price == null || s.current_price == null || s.entry_price <= 0) continue
      if (strongOnly && s.signal_strength !== 'STRONG') continue
      const gapPct = ((s.current_price - s.entry_price) / s.entry_price) * 100
      if (Math.abs(gapPct) > maxGap) continue
      const rr = (s.stop_loss != null && s.resistance != null && s.entry_price > s.stop_loss)
        ? (s.resistance - s.entry_price) / (s.entry_price - s.stop_loss)
        : null
      out.push({ ...s, gapPct, rr })
    }
    // Closest to entry first; STRONG before MODERATE on ties.
    out.sort((a, b) => {
      const r = (STRENGTH_RANK[a.signal_strength] ?? 9) - (STRENGTH_RANK[b.signal_strength] ?? 9)
      if (r !== 0) return r
      return Math.abs(a.gapPct) - Math.abs(b.gapPct)
    })
    return out
  }, [signals, maxGap, strongOnly])

  const strongCount = rows.filter(r => r.signal_strength === 'STRONG').length

  return (
    <div className="space-y-4">

      {/* ── Heading ────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-bold text-emerald-400 flex items-center gap-2">
            🎯 Buy Now
          </h2>
          <p className="text-xs text-[#8b949e] mt-1 max-w-xl">
            Wyckoff <span className="text-emerald-300 font-semibold">BUY</span> setups where the
            current price is within <span className="text-emerald-300 font-semibold">{maxGap}%</span> of
            the best-buy entry — i.e. you can act at (or near) the ideal price right now.
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
          {THRESHOLDS.map(t => (
            <button key={t} onClick={() => setMaxGap(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all tabular-nums
                ${maxGap === t
                  ? 'bg-[#21262d] border-[#58a6ff] text-[#58a6ff]'
                  : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] hover:border-[#8b949e]/50'}`}>
              ≤ {t}%
            </button>
          ))}
        </div>
        <div className="h-4 w-px bg-[#30363d]" />
        <button onClick={() => setStrongOnly(v => !v)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
            ${strongOnly
              ? 'bg-emerald-950 border-emerald-600 text-emerald-300'
              : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] hover:border-[#8b949e]/50'}`}>
          {strongOnly ? '● ' : '○ '}Strong only
        </button>
        <span className="text-xs text-[#8b949e] ml-auto tabular-nums">
          {rows.length} buyable
          {!strongOnly && strongCount > 0 && (
            <span className="text-emerald-300"> · {strongCount} strong</span>
          )}
        </span>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      {loading && (
        <div className="text-center py-12 text-[#8b949e] text-sm animate-pulse">Loading buy signals…</div>
      )}

      {!loading && (
        <div className="overflow-x-auto rounded-lg border border-[#30363d]">
          <table className="w-full text-xs">
            <thead className="text-[#8b949e] uppercase tracking-wider text-[11px]">
              <tr>
                <th className="px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22]">Symbol</th>
                <th className="px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22]">Company</th>
                <th className="px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]">Exch</th>
                <th className="px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22]">Phase</th>
                <th className="px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]">Strength</th>
                <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]">Price (K₫)</th>
                <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22] text-emerald-400">▶ Best Buy</th>
                <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22] text-amber-400">Gap</th>
                <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22] text-red-400">✕ Stop</th>
                <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]">Target</th>
                <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22] text-amber-400">R:R</th>
                <th className="px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22]">Setup</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-4 py-10 text-center text-[#8b949e]">
                    No BUY setups within {maxGap}% of their best-buy price right now.
                    Try a wider gap or run <span className="text-[#58a6ff]">Refresh Analysis</span> on the Wyckoff tab.
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
                    <StrengthBadge strength={row.signal_strength} />
                  </td>
                  <td className="px-3 py-2.5 text-right font-medium text-[#e6edf3] tabular-nums">
                    {fmtPrice(row.current_price!)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    <span className="font-bold text-emerald-300 bg-emerald-950/60 px-1.5 py-0.5 rounded">
                      {fmtPrice(row.entry_price!)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <GapBadge gapPct={row.gapPct} />
                  </td>
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
                        row.rr >= 2 ? 'text-amber-300 bg-amber-950/60' :
                                      'text-[#8b949e]'
                      }`}>
                        1:{row.rr.toFixed(1)}
                      </span>
                    ) : <span className="text-[#8b949e]">—</span>}
                  </td>
                  <td className="px-3 py-2.5 max-w-[260px]">
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
        Buyable = Wyckoff BUY with current price within the chosen gap of best-buy entry · not financial advice
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
