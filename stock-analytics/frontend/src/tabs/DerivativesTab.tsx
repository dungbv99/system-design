import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createChart, CrosshairMode, ColorType, LineStyle,
  type Time,
} from 'lightweight-charts'
import type { Quote, BasisRow, DerivativesOi, DerivativesSummary, WyckoffSignal, MultifactorSignal, IntradayBar } from '../types'
import { api } from '../api'
import { fmtPrice } from '../utils'
import { DEFAULT_INDICATORS } from '../indicators/defs'
import { InteractiveChart } from '../components/InteractiveChart'

// ── Regime styling ────────────────────────────────────────────────────────────

const REGIME_META: Record<string, { label: string; bg: string; text: string; border: string; color: string }> = {
  PREMIUM:  { label: 'PREMIUM',  bg: 'bg-emerald-950', text: 'text-emerald-300', border: 'border-emerald-600', color: '#34d399' },
  DISCOUNT: { label: 'DISCOUNT', bg: 'bg-red-950',     text: 'text-red-300',     border: 'border-red-700',     color: '#f87171' },
  NEUTRAL:  { label: 'NEUTRAL',  bg: 'bg-[#21262d]',   text: 'text-[#8b949e]',  border: 'border-[#30363d]',  color: '#8b949e' },
}

function RegimeBadge({ regime }: { regime: string | null }) {
  const m = REGIME_META[regime ?? 'NEUTRAL'] ?? REGIME_META.NEUTRAL
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-bold ${m.bg} ${m.text} ${m.border}`}>
      {m.label}
    </span>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: {
  label: string; value: string; sub?: React.ReactNode; accent?: string
}) {
  return (
    <div className="flex-1 min-w-[140px] rounded-xl p-3 border-2 bg-[#161b22] border-[#30363d]">
      <div className={`text-lg font-bold tabular-nums ${accent ?? 'text-[#e6edf3]'}`}>{value}</div>
      <div className="text-xs mt-0.5 font-semibold text-[#8b949e] flex items-center gap-1.5">{label}{sub}</div>
    </div>
  )
}

// ── Basis trend chart (baseline at 0, green above / red below) ────────────────

function BasisChart({ rows }: { rows: BasisRow[] }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current || rows.length < 2) return
    const chart = createChart(ref.current, {
      layout:          { background: { type: ColorType.Solid, color: '#0d1117' }, textColor: '#8b949e' },
      grid:            { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
      rightPriceScale: { borderColor: '#30363d' },
      timeScale:       { borderColor: '#30363d', timeVisible: false },
      crosshair:       { mode: CrosshairMode.Normal },
      height: 260,
    })
    const series = chart.addBaselineSeries({
      baseValue:       { type: 'price', price: 0 },
      topLineColor:    '#34d399',
      topFillColor1:   'rgba(52,211,153,0.20)',
      topFillColor2:   'rgba(52,211,153,0.02)',
      bottomLineColor: '#f87171',
      bottomFillColor1:'rgba(248,113,113,0.02)',
      bottomFillColor2:'rgba(248,113,113,0.20)',
      lineWidth:       2,
      priceLineVisible: false,
    })
    series.setData(
      rows.flatMap(r => r.basis == null ? [] : [{ time: r.date as Time, value: r.basis }])
    )
    series.createPriceLine({ price: 0, color: '#6e7681', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'fair' })
    chart.timeScale().fitContent()

    const ro = new ResizeObserver(() => {
      const w = ref.current?.clientWidth
      if (w) chart.applyOptions({ width: w })
    })
    ro.observe(ref.current)
    return () => { ro.disconnect(); chart.remove() }
  }, [rows])

  if (rows.length < 2) return (
    <div className="text-[#8b949e] text-xs py-8 text-center">
      No basis data yet — run "⟳ Recalculate" to crawl VN30 derivatives.
    </div>
  )
  return <div ref={ref} className="w-full" />
}

// ── Open Interest bar chart (only rendered when data exists) ──────────────────

function OiChart({ rows }: { rows: DerivativesOi[] }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current || rows.length < 2) return
    const chart = createChart(ref.current, {
      layout:          { background: { type: ColorType.Solid, color: '#0d1117' }, textColor: '#8b949e' },
      grid:            { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
      rightPriceScale: { borderColor: '#30363d' },
      timeScale:       { borderColor: '#30363d' },
      height: 180,
    })
    const hist = chart.addHistogramSeries({ color: '#58a6ff', priceLineVisible: false })
    hist.setData(rows.flatMap(r => r.open_interest == null ? [] : [{
      time: r.date as Time, value: r.open_interest,
      color: (r.oi_change ?? 0) >= 0 ? '#34d39980' : '#f8717180',
    }]))
    chart.timeScale().fitContent()
    const ro = new ResizeObserver(() => {
      const w = ref.current?.clientWidth
      if (w) chart.applyOptions({ width: w })
    })
    ro.observe(ref.current)
    return () => { ro.disconnect(); chart.remove() }
  }, [rows])

  return <div ref={ref} className="w-full" />
}

// ── Price timeframe selector + intraday chart ─────────────────────────────────

const TF_OPTS = [
  { id: '1',  label: '1m',  days: 10  },   // ~1+ week of sessions
  { id: '5',  label: '5m',  days: 45  },   // ~1.5 months
  { id: '15', label: '15m', days: 120 },   // ~4 months
  { id: '1H', label: '1h',  days: 250 },   // ~1 year
  { id: '1D', label: '1D',  days: 0   },
] as const
type Tf = typeof TF_OPTS[number]['id']

const POLL_MS = 15000   // refresh intraday ~every 15s during the session

/** Candlestick + volume + MA20 chart for live intraday bars (Entrade). */
function IntradayChart({ symbol, tf, days }: { symbol: string; tf: Tf; days: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [bars, setBars] = useState<IntradayBar[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    api.derivativesIntraday(symbol, tf, days)
      .then(b => { setBars(b); setLoading(false) })
      .catch(() => setLoading(false))
  }, [symbol, tf, days])

  useEffect(() => {
    setLoading(true); setBars([]); load()
    const id = setInterval(load, POLL_MS)
    return () => clearInterval(id)
  }, [load])

  useEffect(() => {
    if (!ref.current || bars.length < 2) return
    const chart = createChart(ref.current, {
      layout:          { background: { type: ColorType.Solid, color: '#0d1117' }, textColor: '#8b949e' },
      grid:            { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
      rightPriceScale: { borderColor: '#30363d' },
      timeScale:       { borderColor: '#30363d', timeVisible: true, secondsVisible: false },
      crosshair:       { mode: CrosshairMode.Normal },
      height: 460,
    })
    const candle = chart.addCandlestickSeries({
      upColor: '#34d399', downColor: '#f87171',
      borderUpColor: '#34d399', borderDownColor: '#f87171',
      wickUpColor: '#34d399', wickDownColor: '#f87171',
    })
    candle.setData(bars.map(b => ({ time: b.time as Time, open: b.open, high: b.high, low: b.low, close: b.close })))

    const vol = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol', priceLineVisible: false, lastValueVisible: false })
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } })
    vol.setData(bars.map(b => ({ time: b.time as Time, value: b.volume, color: b.close >= b.open ? '#15803d60' : '#b91c1c60' })))

    const closes = bars.map(b => b.close)
    const ma = closes.map((_, i) => i < 19 ? null : closes.slice(i - 19, i + 1).reduce((a, c) => a + c, 0) / 20)
    const maS = chart.addLineSeries({ color: '#facc15', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
    maS.setData(ma.flatMap((v, i) => v == null ? [] : [{ time: bars[i].time as Time, value: v }]))

    chart.timeScale().fitContent()
    const ro = new ResizeObserver(() => { const w = ref.current?.clientWidth; if (w) chart.applyOptions({ width: w }) })
    ro.observe(ref.current)
    return () => { ro.disconnect(); chart.remove() }
  }, [bars])

  if (loading && bars.length === 0)
    return <div className="text-[#8b949e] text-xs py-12 text-center animate-pulse">Loading {symbol} intraday…</div>
  if (bars.length < 2)
    return <div className="text-[#8b949e] text-xs py-12 text-center">No intraday bars (market may be closed).</div>
  return (
    <>
      <div ref={ref} className="w-full" />
      <div className="text-[10px] text-[#8b949e]/50 text-right pt-1">
        <span className="text-emerald-400">●</span> live · auto-refresh {POLL_MS / 1000}s · MA20 ━ · scroll to zoom
      </div>
    </>
  )
}

// ── Wyckoff signal card ───────────────────────────────────────────────────────

const WY_SIGNAL: Record<string, { bg: string; text: string; border: string }> = {
  BUY:   { bg: 'bg-emerald-950', text: 'text-emerald-300', border: 'border-emerald-600' },
  SHORT: { bg: 'bg-red-950',     text: 'text-red-300',     border: 'border-red-600'     },
  HOLD:  { bg: 'bg-blue-950',    text: 'text-blue-300',    border: 'border-blue-600'    },
  WAIT:  { bg: 'bg-[#21262d]',   text: 'text-[#8b949e]',  border: 'border-[#30363d]'  },
}
const PHASE_COLOR: Record<string, string> = {
  Accumulation: '#22d3ee', Distribution: '#fb923c', Markup: '#34d399', Markdown: '#f87171',
}

function WyckoffCard({ w }: { w: WyckoffSignal | null }) {
  if (!w) return <EmptyCard label="Wyckoff" />
  const sig = WY_SIGNAL[w.signal] ?? WY_SIGNAL.WAIT
  const pCol = PHASE_COLOR[w.phase] ?? '#8b949e'
  const cells = [
    { label: '▶ Best Buy',  value: w.entry_price, color: 'text-emerald-300', bg: 'bg-emerald-950/40 border-emerald-800' },
    { label: '✕ Stop Loss', value: w.stop_loss,   color: 'text-red-300',     bg: 'bg-red-950/40 border-red-800' },
    { label: 'Support',     value: w.support,     color: 'text-emerald-400', bg: 'bg-[#0d1117] border-[#30363d]' },
    { label: 'Resistance',  value: w.resistance,  color: 'text-red-400',     bg: 'bg-[#0d1117] border-[#30363d]' },
  ]
  return (
    <div className="bg-[#0d1117] border border-[#30363d] rounded-lg p-4 space-y-3">
      <div className="text-xs text-[#8b949e] font-semibold uppercase tracking-wider">Wyckoff · VN30F1M</div>
      <div className="flex items-center gap-3 flex-wrap">
        <span className={`inline-flex items-center px-3 py-1 rounded-lg border text-sm font-bold ${sig.bg} ${sig.text} ${sig.border}`}>
          {w.signal} · {w.signal_strength}
        </span>
        <span className="text-sm font-semibold" style={{ color: pCol }}>
          {w.phase}{w.sub_phase !== '-' && <span className="ml-1 font-bold">Phase {w.sub_phase}</span>}
        </span>
        {w.last_event && (
          <span className="text-xs px-2 py-0.5 rounded border border-[#30363d] bg-[#21262d] text-[#e6edf3]">{w.last_event}</span>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {cells.map(c => (
          <div key={c.label} className={`border rounded-lg p-2 text-center ${c.bg}`}>
            <div className={`text-sm font-bold tabular-nums ${c.color}`}>{c.value != null ? fmtPrice(c.value) : '—'}</div>
            <div className="text-[11px] text-[#8b949e]">{c.label}</div>
          </div>
        ))}
      </div>
      {w.description && (
        <div className="text-xs text-[#8b949e] bg-[#161b22] border border-[#30363d] rounded-lg p-3 leading-relaxed">
          {w.description}
        </div>
      )}
    </div>
  )
}

// ── Multi-factor score card ───────────────────────────────────────────────────

const MF_SIGNAL: Record<string, { bg: string; text: string; border: string }> = {
  BUY:   { bg: 'bg-emerald-950', text: 'text-emerald-300', border: 'border-emerald-600' },
  WATCH: { bg: 'bg-amber-950',   text: 'text-amber-300',   border: 'border-amber-600'   },
  AVOID: { bg: 'bg-red-950',     text: 'text-red-300',     border: 'border-red-700'     },
}

function FactorCell({ label, value, reason, color }: { label: string; value: number; reason: string; color: string }) {
  const pct = Math.max(0, Math.min(100, (value / 25) * 100))
  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-2" title={reason}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold" style={{ color }}>{label}</span>
        <span className="text-[11px] font-bold tabular-nums text-[#e6edf3]">{value}<span className="text-[#8b949e]/50">/25</span></span>
      </div>
      <div className="h-1.5 rounded-full bg-[#21262d] overflow-hidden mt-1">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

function MultifactorCard({ m }: { m: MultifactorSignal | null }) {
  if (!m) return <EmptyCard label="Multi-factor" />
  const sig = MF_SIGNAL[m.signal] ?? MF_SIGNAL.WATCH
  const scoreColor = m.total_score >= 70 ? '#34d399' : m.total_score >= 55 ? '#a3e635' : m.total_score >= 40 ? '#f59e0b' : '#f87171'
  return (
    <div className="bg-[#0d1117] border border-[#30363d] rounded-lg p-4 space-y-3">
      <div className="text-xs text-[#8b949e] font-semibold uppercase tracking-wider">Multi-factor · VN30F1M</div>
      <div className="flex items-center gap-3 flex-wrap">
        <span className={`inline-flex items-center px-3 py-1 rounded-lg border text-sm font-bold ${sig.bg} ${sig.text} ${sig.border}`}>
          {m.signal} · {m.confidence}
        </span>
        <div className="flex-1 min-w-[120px] flex items-center gap-2">
          <div className="flex-1 h-2 rounded-full bg-[#21262d] overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, m.total_score))}%`, background: scoreColor }} />
          </div>
          <span className="font-bold tabular-nums w-8 text-right" style={{ color: scoreColor }}>{m.total_score}</span>
        </div>
        <span className="text-xs text-[#8b949e]">{m.factors_agreed}/4 agree</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <FactorCell label="Trend"    value={m.trend_score}    reason={m.trend_reason}    color="#22d3ee" />
        <FactorCell label="Momentum" value={m.momentum_score} reason={m.momentum_reason} color="#a855f7" />
        <FactorCell label="Volume"   value={m.volume_score}   reason={m.volume_reason}   color="#60a5fa" />
        <FactorCell label="Position" value={m.position_score} reason={m.position_reason} color="#fb923c" />
      </div>
      {m.description && (
        <div className="text-xs text-[#8b949e] bg-[#161b22] border border-[#30363d] rounded-lg p-3 leading-relaxed">
          {m.description}
        </div>
      )}
    </div>
  )
}

function EmptyCard({ label }: { label: string }) {
  return (
    <div className="bg-[#0d1117] border border-[#30363d] rounded-lg p-4">
      <div className="text-xs text-[#8b949e] font-semibold uppercase tracking-wider mb-2">{label} · VN30F1M</div>
      <div className="text-xs text-[#8b949e] py-6 text-center">
        No {label} analysis yet — run "⟳ Recalculate" to compute it.
      </div>
    </div>
  )
}

// ── Main tab ──────────────────────────────────────────────────────────────────

export function DerivativesTab() {
  const [summary, setSummary] = useState<DerivativesSummary | null>(null)
  const [quotes,  setQuotes]  = useState<Quote[]>([])
  const [basis,   setBasis]   = useState<BasisRow[]>([])
  const [oi,      setOi]      = useState<DerivativesOi[]>([])
  const [loading, setLoading] = useState(true)
  const [computing, setComputing] = useState(false)
  const [tf, setTf] = useState<Tf>('1D')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, q, b, o] = await Promise.all([
        api.derivativesSummary(),
        api.derivativesQuotes('VN30F1M', 9999),
        api.basis(9999),
        api.derivativesOi('VN30F1M', 120).catch(() => [] as DerivativesOi[]),
      ])
      setSummary(s); setQuotes(q); setBasis(b); setOi(o)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleCompute = async () => {
    setComputing(true)
    try {
      await api.computeDerivatives()
      setTimeout(() => { load(); setComputing(false) }, 12000)
    } catch {
      setComputing(false)
    }
  }

  const b = summary?.basis
  const latest = summary?.quote

  return (
    <div className="space-y-4">

      {/* ── Summary cards ─────────────────────────────────────────────────── */}
      <div className="flex gap-3 flex-wrap items-stretch">
        <StatCard
          label="VN30F1M Close"
          value={latest ? fmtPrice(latest.close) : '—'}
          accent="text-[#58a6ff]"
        />
        <StatCard
          label="Basis (F1M − VN30)"
          value={b?.basis != null ? `${b.basis > 0 ? '+' : ''}${fmtPrice(b.basis)}` : '—'}
          accent={b && b.basis != null ? (b.basis >= 0 ? 'text-emerald-400' : 'text-red-400') : undefined}
          sub={b ? <RegimeBadge regime={b.regime} /> : undefined}
        />
        <StatCard
          label="Basis %"
          value={b?.basis_pct != null ? `${b.basis_pct > 0 ? '+' : ''}${b.basis_pct.toFixed(2)}%` : '—'}
          accent={b && b.basis_pct != null ? (b.basis_pct >= 0 ? 'text-emerald-400' : 'text-red-400') : undefined}
        />
        <StatCard
          label="Spread (F1M − F2M)"
          value={b?.spread_f1m_f2m != null ? `${b.spread_f1m_f2m > 0 ? '+' : ''}${fmtPrice(b.spread_f1m_f2m)}` : '—'}
        />
        <StatCard
          label="VN30 Index"
          value={b?.vn30_close != null ? fmtPrice(b.vn30_close) : '—'}
          accent="text-purple-400"
        />
        <button
          onClick={handleCompute}
          disabled={computing}
          className={`self-center px-4 py-2 rounded-lg text-xs font-bold border transition-all
            ${computing
              ? 'bg-cyan-950 border-cyan-700 text-cyan-300 animate-pulse cursor-not-allowed'
              : 'bg-[#21262d] border-[#30363d] text-[#8b949e] hover:border-[#58a6ff]/50 hover:text-[#e6edf3]'}`}
        >
          {computing ? '⏳ Crawling derivatives…' : '⟳ Recalculate'}
        </button>
      </div>

      {loading && (
        <div className="text-center py-12 text-[#8b949e] text-sm animate-pulse">Loading derivatives…</div>
      )}

      {!loading && (
        <>
          {/* ── VN30F1M price chart — daily (full indicators) or live intraday ─ */}
          <div className="bg-[#0d1117] border border-[#30363d] rounded-lg p-2">
            <div className="flex items-center justify-between px-1 pt-1 pb-2 flex-wrap gap-2">
              <div className="text-xs text-[#8b949e] font-semibold uppercase tracking-wider">
                VN30F1M — {tf === '1D' ? `daily · ${quotes.length} sessions` : 'intraday (live)'}
              </div>
              <div className="flex gap-1">
                {TF_OPTS.map(opt => (
                  <button key={opt.id} onClick={() => setTf(opt.id)}
                    className={`px-2.5 py-1 rounded text-[11px] font-bold border transition-all
                      ${tf === opt.id
                        ? 'bg-[#58a6ff] text-[#0d1117] border-[#58a6ff]'
                        : 'bg-[#21262d] text-[#8b949e] border-[#30363d] hover:text-[#e6edf3] hover:border-[#8b949e]/50'}`}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            {tf === '1D'
              ? (quotes.length >= 5
                  ? <InteractiveChart quotes={quotes} indicators={DEFAULT_INDICATORS} />
                  : <div className="text-[#8b949e] text-xs py-8 text-center">
                      No futures price history yet — run "⟳ Recalculate".
                    </div>)
              : <IntradayChart symbol="VN30F1M" tf={tf} days={TF_OPTS.find(o => o.id === tf)!.days} />}
          </div>

          {/* ── Basis trend ─────────────────────────────────────────────────── */}
          <div className="bg-[#0d1117] border border-[#30363d] rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-[#8b949e] font-semibold uppercase tracking-wider">
                Basis trend (F1M − VN30) · last {basis.length} sessions
              </div>
              <div className="flex items-center gap-3 text-[11px] text-[#8b949e]">
                <span><span className="text-emerald-400">━</span> premium</span>
                <span><span className="text-red-400">━</span> discount</span>
              </div>
            </div>
            <BasisChart rows={basis} />
          </div>

          {/* ── Open Interest (only when data present) ──────────────────────── */}
          {oi.length >= 2 && (
            <div className="bg-[#0d1117] border border-[#30363d] rounded-lg p-3">
              <div className="text-xs text-[#8b949e] font-semibold uppercase tracking-wider mb-2">
                Open Interest · VN30F1M
              </div>
              <OiChart rows={oi} />
            </div>
          )}

          {/* ── Signal cards ────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <WyckoffCard w={summary?.wyckoff ?? null} />
            <MultifactorCard m={summary?.multifactor ?? null} />
          </div>
        </>
      )}

      <p className="text-xs text-[#8b949e]/40 text-right">
        VN30 derivatives · basis = F1M − spot, spread = F1M − F2M · contracts roll on the 3rd Thursday · not financial advice
      </p>
    </div>
  )
}
