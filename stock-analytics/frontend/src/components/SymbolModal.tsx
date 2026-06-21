import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Quote, WyckoffSignal, Prediction, ReportAnalysis } from '../types'
import { api } from '../api'
import { DEFAULT_INDICATORS } from '../indicators/defs'
import { fmtPrice } from '../utils'
import { ChangePct } from './ui'
import { IndicatorPanel } from './IndicatorPanel'
import { InteractiveChart } from './InteractiveChart'

// ── Wyckoff panel ─────────────────────────────────────────────────────────────

const SIGNAL_STYLE: Record<string, { bg: string; text: string; border: string }> = {
  BUY:   { bg: 'bg-emerald-950', text: 'text-emerald-300', border: 'border-emerald-600' },
  SHORT: { bg: 'bg-red-950',     text: 'text-red-300',     border: 'border-red-600'     },
  HOLD:  { bg: 'bg-blue-950',    text: 'text-blue-300',    border: 'border-blue-600'    },
  WAIT:  { bg: 'bg-[#21262d]',   text: 'text-[#8b949e]',  border: 'border-[#30363d]'  },
}
const STRENGTH_DOT: Record<string, string> = {
  STRONG: 'bg-emerald-400', MODERATE: 'bg-amber-400', WEAK: 'bg-[#8b949e]',
}
const PHASE_COLOR: Record<string, string> = {
  Accumulation: '#22d3ee', Distribution: '#fb923c', Markup: '#34d399', Markdown: '#f87171',
}
const EVENT_COLOR: Record<string, string> = {
  SC:'#f87171', Spring:'#fbbf24', Test:'#fde68a', SOS:'#34d399', LPS:'#6ee7b7',
  BC:'#fb923c', UT:'#fdba74',    UTAD:'#fca5a5', LPSY:'#f87171',
  AR:'#60a5fa', ST:'#93c5fd',
}
const PHASE_STEPS_ACCUM = [
  { sub:'A', hint:'SC · AR', tip:'Selling Climax & first bounce' },
  { sub:'B', hint:'ST · Range', tip:'Building the cause' },
  { sub:'C', hint:'Spring', tip:'Last shake-out below support' },
  { sub:'D', hint:'SOS · LPS', tip:'Sign of Strength + best buy entry' },
  { sub:'E', hint:'Markup ↑', tip:'Full uptrend begins' },
]
const PHASE_STEPS_DISTR = [
  { sub:'A', hint:'BC · AR', tip:'Buying Climax & first drop' },
  { sub:'B', hint:'ST · Range', tip:'Distributing shares' },
  { sub:'C', hint:'UT / UTAD', tip:'Bull trap above resistance' },
  { sub:'D', hint:'LPSY', tip:'Last weak rally before decline' },
]

function WyckoffPanel({ symbol }: { symbol: string }) {
  const [data, setData]     = useState<WyckoffSignal | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr]       = useState(false)

  useEffect(() => {
    setLoading(true); setErr(false)
    api.wyckoffSignal(symbol)
      .then(d => { setData(d); setLoading(false) })
      .catch(() => { setErr(true); setLoading(false) })
  }, [symbol])

  if (loading) return (
    <div className="animate-pulse text-xs text-[#8b949e] py-3 text-center">
      Loading Wyckoff analysis…
    </div>
  )
  if (err || !data) return (
    <div className="text-xs text-[#8b949e] py-3 text-center">
      No Wyckoff analysis yet.{' '}
      <button
        className="text-[#58a6ff] hover:underline"
        onClick={() => {
          api.computeWyckoff('HOSE,HNX').then(() =>
            setTimeout(() => api.wyckoffSignal(symbol).then(setData).catch(() => setErr(true)), 6000)
          )
        }}
      >
        Compute now
      </button>
    </div>
  )

  const sig   = SIGNAL_STYLE[data.signal]  ?? SIGNAL_STYLE.WAIT
  const dot   = STRENGTH_DOT[data.signal_strength] ?? STRENGTH_DOT.WEAK
  const pCol  = PHASE_COLOR[data.phase]    ?? '#8b949e'
  const isAccum = data.phase === 'Accumulation'
  const isDistr = data.phase === 'Distribution'
  const steps = isAccum ? PHASE_STEPS_ACCUM : isDistr ? PHASE_STEPS_DISTR : []



  return (
    <div className="space-y-3">

      {/* Signal + phase row */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border text-sm font-bold
                          ${sig.bg} ${sig.text} ${sig.border}`}>
          <span className={`w-2 h-2 rounded-full ${dot}`} />
          {data.signal} · {data.signal_strength}
        </span>
        <span className="text-sm font-semibold" style={{ color: pCol }}>
          {data.phase}
          {data.sub_phase !== '-' && (
            <span className="ml-1 font-bold">Phase {data.sub_phase}</span>
          )}
        </span>
        {data.last_event && (
          <span className="text-xs px-2 py-0.5 rounded border border-[#30363d] bg-[#21262d]"
                style={{ color: EVENT_COLOR[data.last_event] ?? '#8b949e' }}>
            {data.last_event}
          </span>
        )}
        <span className="text-xs text-[#8b949e] ml-auto">{data.bars_analyzed} bars</span>
      </div>

      {/* Phase progress (accumulation/distribution only) */}
      {steps.length > 0 && (
        <div className="flex items-start gap-1 flex-wrap">
          {steps.map((step, i) => {
            const active = step.sub === data.sub_phase
            return (
              <div key={step.sub} className="flex items-center gap-1">
                <div
                  title={step.tip}
                  className={`flex flex-col items-center px-2 py-1 rounded text-[10px] border cursor-default transition-all
                               ${active ? 'font-bold' : 'text-[#8b949e] border-[#30363d]'}`}
                  style={active
                    ? { borderColor: pCol, color: pCol, background: `${pCol}18` }
                    : {}}
                >
                  <span>Phase {step.sub}</span>
                  <span className="opacity-70">{step.hint}</span>
                </div>
                {i < steps.length - 1 && <span className="text-[#30363d] text-xs">→</span>}
              </div>
            )
          })}
          <span className="text-[#30363d] text-xs">→</span>
          {isAccum && <span className="text-emerald-400 text-[10px] font-bold px-2 py-1 border border-emerald-800 rounded bg-emerald-950">Markup ↑</span>}
          {isDistr && <span className="text-red-400 text-[10px] font-bold px-2 py-1 border border-red-800 rounded bg-red-950">Markdown ↓</span>}
        </div>
      )}

      {/* Entry / Stop / Support / Resistance */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: '▶ Best Buy',   value: data.entry_price != null ? fmtPrice(data.entry_price) : '—', color: 'text-emerald-300', bg: 'bg-emerald-950/40 border-emerald-800' },
          { label: '✕ Stop Loss',  value: data.stop_loss   != null ? fmtPrice(data.stop_loss)   : '—', color: 'text-red-300',     bg: 'bg-red-950/40 border-red-800'         },
          { label: 'Support',      value: data.support     != null ? fmtPrice(data.support)     : '—', color: 'text-emerald-400', bg: 'bg-[#0d1117] border-[#30363d]'        },
          { label: 'Resistance',   value: data.resistance  != null ? fmtPrice(data.resistance)  : '—', color: 'text-red-400',     bg: 'bg-[#0d1117] border-[#30363d]'        },
        ].map(({ label, value, color, bg }) => (
          <div key={label} className={`border rounded-lg p-2 text-center ${bg}`}>
            <div className={`text-sm font-bold tabular-nums ${color}`}>{value}</div>
            <div className="text-[11px] text-[#8b949e]">{label}</div>
          </div>
        ))}
      </div>

      {/* Risk : Reward */}
      {data.entry_price && data.stop_loss && data.resistance && data.entry_price > data.stop_loss && (
        (() => {
          const risk   = data.entry_price - data.stop_loss
          const reward = data.resistance  - data.entry_price
          const rr     = reward / risk
          return (
            <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg border
              ${rr >= 3 ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
                        : rr >= 2 ? 'bg-amber-950/40 border-amber-800 text-amber-300'
                                  : 'bg-[#0d1117] border-[#30363d] text-[#8b949e]'}`}>
              <span className="font-bold">R:R = 1:{rr.toFixed(1)}</span>
              <span className="text-[#8b949e]">·</span>
              <span>Risk {((risk / data.entry_price) * 100).toFixed(1)}%</span>
              <span className="text-[#8b949e]">·</span>
              <span>Target +{((reward / data.entry_price) * 100).toFixed(1)}%</span>
            </div>
          )
        })()
      )}

      {/* Description */}
      <div className="text-xs text-[#8b949e] bg-[#0d1117] border border-[#30363d] rounded-lg p-3 leading-relaxed">
        {data.description}
      </div>
    </div>
  )
}

// ── XGB prediction panel ──────────────────────────────────────────────────────

const TOP_FEATURES = [
  { name: '5-day return',  weight: 0.157, desc: 'recent momentum' },
  { name: '1-day return',  weight: 0.131, desc: 'latest session' },
  { name: 'vs MA-20',      weight: 0.107, desc: 'proximity to trend mean' },
  { name: '60-day return', weight: 0.102, desc: 'medium-term trend' },
  { name: 'vs MA-60',      weight: 0.099, desc: 'long-term alignment' },
]

function XGBPanel({ symbol }: { symbol: string }) {
  const [data,      setData]      = useState<Prediction | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [err,       setErr]       = useState(false)
  const [computing, setComputing] = useState(false)

  const load = useCallback(() => {
    setLoading(true); setErr(false)
    api.prediction(symbol)
      .then(d => { setData(d); setLoading(false) })
      .catch(() => { setErr(true); setLoading(false) })
  }, [symbol])

  useEffect(() => { load() }, [load])

  const handleCompute = async () => {
    setComputing(true)
    try {
      await api.computePredictions('HOSE,HNX')
      setTimeout(load, 15000)
    } catch {
      setErr(true)
    } finally {
      setComputing(false)
    }
  }

  if (loading) return (
    <div className="animate-pulse text-xs text-[#8b949e] py-6 text-center">
      Loading XGBoost prediction…
    </div>
  )
  if (err || !data) return (
    <div className="text-xs text-[#8b949e] py-6 text-center space-y-2">
      <div>No prediction found for <span className="text-[#e6edf3] font-semibold">{symbol}</span>.</div>
      <button
        onClick={handleCompute}
        disabled={computing}
        className="text-[#58a6ff] hover:underline disabled:opacity-50"
      >
        {computing ? 'Computing (takes ~30s)…' : 'Compute predictions now'}
      </button>
    </div>
  )

  const isBuy = data.signal === 'BUY'
  const pct   = Math.round(data.score * 100)

  return (
    <div className="space-y-4">

      {/* ── Signal + confidence ─────────────────────────────────────────── */}
      <div className="flex items-center gap-4 flex-wrap">
        <span className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-bold
          ${isBuy
            ? 'bg-emerald-950 text-emerald-300 border-emerald-600'
            : 'bg-[#21262d] text-[#8b949e] border-[#30363d]'}`}>
          {isBuy ? '▲' : '■'} {data.signal}
        </span>
        <div>
          <div className={`text-3xl font-bold tabular-nums leading-none ${isBuy ? 'text-emerald-300' : 'text-[#8b949e]'}`}>
            {pct}%
          </div>
          <div className="text-[10px] text-[#8b949e] mt-0.5">BUY probability</div>
        </div>
        <div className="ml-auto text-right text-[11px] text-[#8b949e] space-y-0.5">
          <div>Horizon: <span className="text-[#e6edf3]">5 trading days</span></div>
          <div>Target: <span className="text-[#e6edf3]">+3% return</span></div>
          <div className="text-[10px] opacity-60">Model trained {data.model_date}</div>
        </div>
      </div>

      {/* ── Score gauge ─────────────────────────────────────────────────── */}
      <div>
        <div className="relative h-3 rounded-full bg-[#21262d] overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${isBuy ? 'bg-emerald-500' : 'bg-[#444]'}`}
            style={{ width: `${pct}%` }}
          />
          {/* BUY threshold line at 55% */}
          <div className="absolute top-0 bottom-0 w-0.5 bg-[#58a6ff]/70" style={{ left: '55%' }} />
        </div>
        <div className="flex justify-between text-[10px] mt-1 text-[#8b949e]">
          <span>0%</span>
          <span className="text-[#58a6ff]">55% BUY threshold</span>
          <span>100%</span>
        </div>
      </div>

      {/* ── Top features ────────────────────────────────────────────────── */}
      <div className="bg-[#0d1117] border border-[#30363d] rounded-lg p-3 space-y-2">
        <div className="text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider mb-1">
          Top model features
        </div>
        {TOP_FEATURES.map(f => (
          <div key={f.name} className="flex items-center gap-2">
            <span className="text-[11px] text-[#e6edf3] w-28 shrink-0">{f.name}</span>
            <div className="flex-1 h-1.5 rounded-full bg-[#30363d] overflow-hidden">
              <div className="h-full rounded-full bg-purple-500/70" style={{ width: `${f.weight * 550}%` }} />
            </div>
            <span className="text-[10px] text-[#8b949e] w-7 text-right">{Math.round(f.weight * 100)}%</span>
            <span className="text-[10px] text-[#8b949e]/50 hidden sm:block w-36">{f.desc}</span>
          </div>
        ))}
        <div className="text-[10px] text-[#8b949e]/40 pt-1 border-t border-[#30363d]">
          Also uses ceiling hits, foreign flow, RSI, MACD, Bollinger bands (VN-specific model)
        </div>
      </div>

      {/* ── Interpretation ──────────────────────────────────────────────── */}
      <div className={`text-xs px-3 py-2.5 rounded-lg border leading-relaxed
        ${isBuy
          ? 'bg-emerald-950/30 border-emerald-800 text-emerald-200'
          : 'bg-[#0d1117] border-[#30363d] text-[#8b949e]'}`}>
        {isBuy
          ? `Model gives ${pct}% probability that ${symbol} returns +3%+ within 5 days. ` +
            `Verify with Wyckoff phase before entering — strong setups combine BUY signal + Accumulation phase C/D.`
          : `Confidence below 55% threshold (${pct}%). ${symbol} does not show a sufficient momentum pattern. ` +
            `Wait for a higher-probability setup or check Wyckoff for context.`
        }
      </div>

      <div className="text-[10px] text-[#8b949e]/40 text-right">
        Predicted {data.predicted_at} · XGBoost classifier · T+2.5 settlement · not financial advice
      </div>
    </div>
  )
}

// ── Quarterly report panel (Vietstock BCTC → Gemini) ─────────────────────────

/** Inline **bold** segments. */
function mdBold(text: string, keyBase: string): ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
    i % 2 === 1
      ? <strong key={`${keyBase}-${i}`} className="text-[#e6edf3] font-semibold">{part}</strong>
      : part
  )
}

/** Tiny markdown renderer: ## headings, "- " bullets, **bold**, _italic line_, paragraphs. */
function MdLite({ text }: { text: string }) {
  const out: ReactNode[] = []
  let bullets: string[] = []
  let key = 0

  const flushBullets = () => {
    if (!bullets.length) return
    out.push(
      <ul key={`ul${key++}`} className="list-disc pl-5 space-y-1 mb-3">
        {bullets.map((b, i) => <li key={i} className="leading-relaxed">{mdBold(b, `b${key}-${i}`)}</li>)}
      </ul>
    )
    bullets = []
  }

  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    const t = line.trim()
    if (!t) { flushBullets(); continue }
    if (/^#{1,4}\s/.test(t)) {
      flushBullets()
      out.push(
        <div key={`h${key++}`} className="text-[#58a6ff] font-bold text-sm mt-4 mb-2">
          {mdBold(t.replace(/^#{1,4}\s*/, ''), `h${key}`)}
        </div>
      )
    } else if (/^[-*]\s+/.test(t)) {
      bullets.push(t.replace(/^[-*]\s+/, ''))
    } else if (/^_.*_$/.test(t)) {
      flushBullets()
      out.push(
        <div key={`i${key++}`} className="italic text-[#8b949e]/70 text-[11px] mt-3">
          {t.replace(/^_|_$/g, '')}
        </div>
      )
    } else {
      flushBullets()
      out.push(
        <p key={`p${key++}`} className="mb-2 leading-relaxed">{mdBold(t, `p${key}`)}</p>
      )
    }
  }
  flushBullets()
  return <div className="text-xs text-[#c9d1d9]">{out}</div>
}

const PROVIDERS = [
  { id: 'gemini' as const, label: '✨ Gemini' },
  { id: 'claude' as const, label: '🤖 Claude' },
]

function ReportPanel({ symbol }: { symbol: string }) {
  const [provider, setProvider] = useState<'gemini' | 'claude'>('gemini')
  const [data,     setData]     = useState<ReportAnalysis | null>(null)
  const [starting, setStarting] = useState(false)
  const [errMsg,   setErrMsg]   = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(() => {
    api.reportAnalysis(symbol, provider)
      .then(setData)
      .catch(() => setErrMsg('Không gọi được API — kiểm tra crawler logs.'))
  }, [symbol, provider])

  useEffect(() => {
    setData(null); setErrMsg(null)
    load()
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  }, [load])

  // Poll while the backend job runs (crawl + LLM ≈ 30–120s)
  useEffect(() => {
    if (data?.status === 'running' && !pollRef.current) {
      pollRef.current = setInterval(load, 5000)
    }
    if (data?.status !== 'running' && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [data, load])

  const start = async () => {
    setStarting(true); setErrMsg(null)
    try {
      await api.computeReportAnalysis(symbol, provider)
      setData({ status: 'running' })
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'Không khởi động được phân tích')
    } finally {
      setStarting(false)
    }
  }

  const providerLabel = provider === 'claude' ? 'Claude' : 'Gemini'

  const providerTabs = (
    <div className="flex gap-1">
      {PROVIDERS.map(p => (
        <button key={p.id} onClick={() => setProvider(p.id)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
            ${provider === p.id
              ? 'bg-[#21262d] border-[#58a6ff] text-[#58a6ff]'
              : 'border-[#30363d] text-[#8b949e] hover:border-[#58a6ff]/50 hover:text-[#e6edf3]'}`}>
          {p.label}
        </button>
      ))}
    </div>
  )

  const startButton = (label: string) => (
    <button
      onClick={start}
      disabled={starting || data?.status === 'running'}
      className="px-4 py-2 bg-[#58a6ff] hover:bg-[#79b8ff] disabled:opacity-50 disabled:cursor-not-allowed
                 text-[#0d1117] text-xs rounded-lg font-bold transition-all hover:scale-105 active:scale-95">
      {starting ? 'Đang khởi động…' : label}
    </button>
  )

  const body = () => {
    if (!data && !errMsg) return (
      <div className="animate-pulse text-xs text-[#8b949e] py-3 text-center">Đang kiểm tra…</div>
    )

    if (data?.status === 'running') return (
      <div className="py-8 text-center space-y-2">
        <div className="text-xs text-cyan-300 animate-pulse">
          ⏳ Đang tải BCTC từ Vietstock và phân tích bằng {providerLabel}… (~1–2 phút)
        </div>
        <div className="text-[10px] text-[#8b949e]/60">Trang tự cập nhật khi xong — không cần tải lại.</div>
      </div>
    )

    if (errMsg || data?.status === 'error') return (
      <div className="py-6 text-center space-y-3">
        <div className="text-xs text-red-300 bg-red-950/40 border border-red-800 rounded-lg px-3 py-2 inline-block max-w-lg">
          ✕ {errMsg ?? data?.error ?? 'Lỗi không xác định'}
        </div>
        <div>{startButton('↻ Thử lại')}</div>
      </div>
    )

    if (data?.status === 'ready') return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-xs">
            <span className="font-bold text-[#e6edf3]">{data.title}</span>
            {data.pdf_url && (
              <a href={data.pdf_url} target="_blank" rel="noreferrer"
                 className="ml-2 text-[#58a6ff] hover:underline">PDF gốc ↗</a>
            )}
            <div className="text-[10px] text-[#8b949e]/60 mt-0.5">
              {data.model} · phân tích lúc {data.created_at?.slice(0, 16).replace('T', ' ')}
            </div>
          </div>
          {startButton('↻ Kiểm tra quý mới')}
        </div>
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4 max-h-[28rem] overflow-y-auto">
          <MdLite text={data.analysis ?? ''} />
        </div>
      </div>
    )

    // status === 'none' — chưa có phân tích nào
    return (
      <div className="py-8 text-center space-y-3">
        <div className="text-xs text-[#8b949e]">
          Chưa có phân tích BCTC bằng {providerLabel} cho <span className="text-[#e6edf3] font-semibold">{symbol}</span>.
        </div>
        <div className="text-[10px] text-[#8b949e]/60 max-w-md mx-auto">
          Hệ thống sẽ crawl BCTC quý gần nhất từ Vietstock, gửi cho {providerLabel} phân tích
          (chất lượng lợi nhuận, dòng tiền, định giá, kết hợp Wyckoff) rồi lưu lại — mỗi quý chỉ phân tích một lần cho mỗi AI.
        </div>
        {startButton(`📑 Phân tích bằng ${providerLabel}`)}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {providerTabs}
      {body()}
    </div>
  )
}

interface Props {
  symbol:  string
  name:    string
  onClose: () => void
}

export function SymbolModal({ symbol, name, onClose }: Props) {
  const [quotes,       setQuotes]       = useState<Quote[]>([])
  const [loading,      setLoading]      = useState(true)
  const [indicators,   setIndicators]   = useState<Set<string>>(DEFAULT_INDICATORS)
  const [showPicker,   setShowPicker]   = useState(false)
  const [fetchingHist, setFetchingHist] = useState(false)
  const [fetchMsg,     setFetchMsg]     = useState<string | null>(null)
  const [activePanel,  setActivePanel]  = useState<'chart' | 'wyckoff' | 'xgb' | 'report'>('chart')
  const [buying,       setBuying]       = useState(false)
  const [buyMsg,       setBuyMsg]       = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollCountRef = useRef(0)

  const handleAssumeBuy = async () => {
    setBuying(true)
    setBuyMsg(null)
    try {
      const r = await api.buyStock(symbol, 1000)
      setBuyMsg(`✓ Bought 1,000 ${symbol} @ ${fmtPrice(r.buy_price)} — see Portfolio tab.`)
      setTimeout(() => setBuyMsg(null), 5000)
    } catch (e) {
      setBuyMsg(e instanceof Error ? `✕ ${e.message}` : '✕ Buy failed')
    } finally {
      setBuying(false)
    }
  }

  const loadQuotes = useCallback(() => {
    setLoading(true)
    api.quotes(symbol, 9999).then(q => { setQuotes(q); setLoading(false) })
  }, [symbol])

  useEffect(() => { loadQuotes() }, [loadQuotes])

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  // Re-crawl the full (dividend-adjusted) history from the source, then reload
  // the chart. Used both to fill an empty chart and to re-sync prices after a
  // dividend/split has shifted the adjusted series.
  const handleFetchHistory = async () => {
    setFetchingHist(true)
    setFetchMsg('Re-fetching adjusted history… updating chart.')
    if (pollRef.current) clearInterval(pollRef.current)
    pollCountRef.current = 0
    try {
      await api.fetchHistory(symbol)
      // The crawl runs in the background (~3-10s). Poll a handful of times so
      // we pick up the freshly-adjusted rows regardless of how many we already had.
      pollRef.current = setInterval(() => {
        pollCountRef.current += 1
        loadQuotes()
        if (pollCountRef.current >= 4 && pollRef.current) {
          clearInterval(pollRef.current)
          pollRef.current = null
          setFetchMsg(null)
        }
      }, 3000)
    } catch {
      setFetchMsg('Request failed — check crawler logs.')
    } finally {
      setFetchingHist(false)
    }
  }

  const latest = quotes[quotes.length - 1]
  const prev   = quotes[quotes.length - 2]
  const chg    = latest && prev ? ((latest.close - prev.close) / prev.close * 100) : null

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
         onClick={e => { if (e.target === e.currentTarget) { setShowPicker(false); onClose() } }}>
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 w-full max-w-[92vw] max-h-[95vh] overflow-y-auto shadow-2xl">

        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-3">
              <span className="text-xl font-bold text-[#e6edf3] tracking-wide">{symbol}</span>
              {latest && <ChangePct v={chg} />}
            </div>
            <div className="text-xs text-[#8b949e] mt-0.5 max-w-xs truncate">{name}</div>
          </div>
          <div className="flex items-center gap-2 ml-4">
            {/* Assume buy — record a 1,000-share paper trade at the latest close */}
            <button
              onClick={handleAssumeBuy}
              disabled={buying}
              title="Assume you buy 1,000 shares now at the latest close, then track it on the Portfolio tab"
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all
                disabled:opacity-50 disabled:cursor-not-allowed
                ${buying
                  ? 'bg-emerald-950 border-emerald-700 text-emerald-300 animate-pulse'
                  : 'bg-emerald-700 border-emerald-600 text-white hover:bg-emerald-600 hover:scale-105 active:scale-95'}`}>
              {buying ? '…' : '▸ Assume Buy 1,000'}
            </button>
            {/* Panel switcher */}
            {([
              { id: 'chart',   label: '📈 Chart'   },
              { id: 'wyckoff', label: '〜 Wyckoff'  },
              { id: 'xgb',     label: '🤖 XGB Pred' },
              { id: 'report',  label: '📑 BCTC'    },
            ] as const).map(({ id, label }) => (
              <button key={id} onClick={() => setActivePanel(id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                  ${activePanel === id
                    ? 'bg-[#21262d] border-[#58a6ff] text-[#58a6ff]'
                    : 'border-[#30363d] text-[#8b949e] hover:border-[#58a6ff]/50 hover:text-[#e6edf3]'}`}>
                {label}
              </button>
            ))}
            {activePanel === 'chart' && (
              <>
                <button
                  onClick={handleFetchHistory}
                  disabled={fetchingHist || pollRef.current !== null}
                  title="Re-fetch the full dividend-adjusted price history from source and refresh the chart"
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                    disabled:opacity-50 disabled:cursor-not-allowed
                    ${fetchingHist || pollRef.current
                      ? 'bg-cyan-950 border-cyan-700 text-cyan-300 animate-pulse'
                      : 'bg-[#21262d] border-[#30363d] text-[#8b949e] hover:border-[#58a6ff]/50 hover:text-[#e6edf3]'}`}>
                  <span>↻</span> {fetchingHist || pollRef.current ? 'Updating…' : 'Adjust prices'}
                </button>
                <button
                  onClick={() => setShowPicker(p => !p)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                    ${showPicker
                      ? 'bg-blue-950 border-[#58a6ff] text-[#58a6ff]'
                      : 'bg-[#21262d] border-[#30363d] text-[#8b949e] hover:border-[#58a6ff]/50 hover:text-[#e6edf3]'}`}>
                  <span>⊕</span> Chỉ báo
                  <span className="bg-[#30363d] text-[#e6edf3] rounded-full px-1.5 text-xs ml-0.5">
                    {indicators.size}
                  </span>
                </button>
              </>
            )}
            <button onClick={onClose}
              className="text-[#8b949e] hover:text-[#e6edf3] transition-colors w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[#21262d]">
              ✕
            </button>
          </div>
        </div>

        {buyMsg && (
          <div className={`mb-3 text-xs px-3 py-2 rounded-lg border ${
            buyMsg.startsWith('✓')
              ? 'bg-emerald-950/50 border-emerald-700 text-emerald-300'
              : 'bg-red-950/50 border-red-800 text-red-300'}`}>
            {buyMsg}
          </div>
        )}

        {showPicker && (
          <IndicatorPanel
            active={indicators}
            onChange={s => setIndicators(new Set(s))}
            onClose={() => setShowPicker(false)}
          />
        )}

        {/* Key stats */}
        {latest && (
          <div className="grid grid-cols-4 gap-2 mb-4">
            {[
              { label: 'Close', value: fmtPrice(latest.close) },
              { label: 'Open',  value: fmtPrice(latest.open)  },
              { label: 'High',  value: fmtPrice(latest.high)  },
              { label: 'Low',   value: fmtPrice(latest.low)   },
            ].map(({ label, value }) => (
              <div key={label} className="bg-[#0d1117] border border-[#30363d] rounded-lg p-2.5 text-center">
                <div className="text-sm font-bold text-[#e6edf3] tabular-nums">{value}</div>
                <div className="text-xs text-[#8b949e]">{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Chart / Wyckoff panel switcher */}
        {activePanel === 'chart' ? (
          <>
            <div className="text-xs text-[#8b949e] mb-1 flex items-center gap-2">
              <span>{quotes.length} trading days</span>
              {fetchMsg && <span className="text-cyan-300 animate-pulse">· {fetchMsg}</span>}
            </div>
            {loading ? (
              <div className="h-48 flex items-center justify-center text-[#8b949e] text-xs animate-pulse">Loading…</div>
            ) : quotes.length < 5 ? (
              <div className="mb-4 bg-[#0d1117] border border-[#30363d] rounded-lg p-6 flex flex-col items-center gap-3 text-center">
                <div className="text-[#8b949e] text-xs">No price history found for <span className="text-[#e6edf3] font-semibold">{symbol}</span></div>
                <div className="text-[#8b949e]/60 text-xs">Run "Full History" in the Crawl tab, or load just this symbol:</div>
                <button
                  onClick={handleFetchHistory}
                  disabled={fetchingHist || pollRef.current !== null}
                  className="px-4 py-2 bg-[#58a6ff] hover:bg-[#79b8ff] disabled:opacity-50 disabled:cursor-not-allowed
                             text-[#0d1117] text-xs rounded-lg font-bold transition-all hover:scale-105 active:scale-95">
                  {fetchingHist ? 'Starting…' : pollRef.current ? 'Fetching…' : '↓ Load History for this symbol'}
                </button>
                {fetchMsg && (
                  <div className="text-xs text-[#58a6ff] animate-pulse">{fetchMsg}</div>
                )}
              </div>
            ) : (
              <div className="mb-4 bg-[#0d1117] border border-[#30363d] rounded-lg p-2" onClick={() => setShowPicker(false)}>
                <InteractiveChart quotes={quotes} indicators={indicators} />
              </div>
            )}
          </>
        ) : activePanel === 'wyckoff' ? (
          <div className="mb-4 bg-[#0d1117] border border-[#30363d] rounded-lg p-4">
            <div className="text-xs text-[#8b949e] font-semibold uppercase tracking-wider mb-3">
              Wyckoff Analysis
            </div>
            <WyckoffPanel symbol={symbol} />
          </div>
        ) : activePanel === 'xgb' ? (
          <div className="mb-4 bg-[#0d1117] border border-[#30363d] rounded-lg p-4">
            <div className="text-xs text-[#8b949e] font-semibold uppercase tracking-wider mb-3">
              XGBoost Prediction · 5-day horizon
            </div>
            <XGBPanel symbol={symbol} />
          </div>
        ) : (
          <div className="mb-4 bg-[#0d1117] border border-[#30363d] rounded-lg p-4">
            <div className="text-xs text-[#8b949e] font-semibold uppercase tracking-wider mb-3">
              Phân tích BCTC quý gần nhất · Vietstock → Gemini
            </div>
            <ReportPanel symbol={symbol} />
          </div>
        )}

      </div>
    </div>
  )
}
