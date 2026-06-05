import type { Exchange } from '../types'

// ── EXCHANGES constant (shared between ui.tsx and MarketTab) ──────────────────
export const EXCHANGES: { value: Exchange; label: string; color: string }[] = [
  { value: '',      label: 'All',   color: 'bg-[#21262d] text-[#e6edf3]' },
  { value: 'HOSE',  label: 'HOSE',  color: 'bg-blue-950 text-blue-300' },
  { value: 'HNX',   label: 'HNX',   color: 'bg-purple-950 text-purple-300' },
  { value: 'UPCOM', label: 'UPCOM', color: 'bg-amber-950 text-amber-300' },
]

// ── StatCard ──────────────────────────────────────────────────────────────────
export function StatCard({
  label, value, accent, icon, borderColor,
}: {
  label: string
  value: string | number
  accent?: string
  icon?: string
  borderColor?: string
}) {
  return (
    <div
      className="bg-[#161b22] rounded-lg p-4 border border-[#30363d] flex items-start gap-3 min-w-[160px]"
      style={borderColor ? { borderLeftColor: borderColor, borderLeftWidth: '3px' } : {}}
    >
      {icon && (
        <span className="text-xl mt-0.5 shrink-0">{icon}</span>
      )}
      <div>
        <div className={`text-2xl font-bold tabular-nums leading-tight ${accent ?? 'text-[#e6edf3]'}`}>
          {value}
        </div>
        <div className="text-xs text-[#8b949e] mt-0.5">{label}</div>
      </div>
    </div>
  )
}

// ── StatusBadge ───────────────────────────────────────────────────────────────
export function StatusBadge({ status }: { status: string }) {
  const cls = status === 'done'
    ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
    : status === 'error'
    ? 'bg-red-950 text-red-400 border-red-800'
    : status === 'running'
    ? 'bg-cyan-950 text-cyan-300 border-cyan-800'
    : 'bg-[#21262d] text-[#8b949e] border-[#30363d]'

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold border ${cls}`}>
      {status === 'running' && (
        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse shrink-0" />
      )}
      {status}
    </span>
  )
}

// ── ChangePct ─────────────────────────────────────────────────────────────────
export function ChangePct({ v }: { v: number | null }) {
  if (v == null) return <span className="text-[#8b949e]">—</span>
  const up = v > 0
  const flat = v === 0
  const bgCls = flat
    ? 'bg-[#21262d] text-[#8b949e]'
    : up
    ? 'bg-emerald-950 text-emerald-400'
    : 'bg-red-950 text-red-400'
  return (
    <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-bold tabular-nums ${bgCls}`}>
      {!flat && <span>{up ? '▲' : '▼'}</span>}
      {up ? '+' : ''}{v.toFixed(2)}%
    </span>
  )
}

// ── Sparkline ─────────────────────────────────────────────────────────────────
export function Sparkline({ prices }: { prices: number[] }) {
  if (prices.length < 2) return <span className="text-[#8b949e] text-xs">—</span>
  const W = 80, H = 28
  const min = Math.min(...prices), max = Math.max(...prices)
  const range = max - min || 1
  const pts = prices.map((p, i) => {
    const x = (i / (prices.length - 1)) * W
    const y = H - ((p - min) / range) * (H - 4) - 2
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const up = prices[prices.length - 1] >= prices[0]
  return (
    <svg width={W} height={H} className="overflow-visible">
      <polyline points={pts} fill="none"
        stroke={up ? '#34d399' : '#f87171'} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

// ── ExchangeBadge ─────────────────────────────────────────────────────────────
export function ExchangeBadge({ exchange }: { exchange: string | null }) {
  const meta = EXCHANGES.find(e => e.value === exchange)
  if (!meta || !exchange) return <span className="text-[#8b949e] text-xs">—</span>
  return <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${meta.color}`}>{exchange}</span>
}
