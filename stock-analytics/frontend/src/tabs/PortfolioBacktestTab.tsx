import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createChart, ColorType, LineStyle, type IChartApi, type Time } from 'lightweight-charts'
import { api } from '../api'
import { SymbolModal } from '../components/SymbolModal'

// ── Types (model-native trade shape from /api/vn100-model-backtest) ───────────

interface ModelTrade {
  symbol: string
  entry_date: string
  entry_price: number
  exit_date: string | null
  exit_price: number | null
  shares: number
  pnl: number
  pnl_pct: number
  hold_days: number | null
  exit_type: string
  regime_at_entry: string | null
  wyckoff_phase: string | null
  sector: string | null
}
interface EquityPoint { date: string; equity: number }
interface Summary {
  start_date: string; end_date: string; years: number
  initial_capital: number; final_equity: number
  total_return_pct: number; cagr_pct: number; sharpe: number | null
  max_drawdown_pct: number; win_rate: number
  winning_trades: number; losing_trades: number; executed_trades: number
  regime_exit_trades: number; avg_holding_days: number
  profit_factor: number | null; best_trade_pct: number; worst_trade_pct: number
  symbols: number
}
interface ModelBacktest {
  label: string
  created_at: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: { regime_params: Record<string, any>; capital: number; start_date: string; end_date: string }
  summary: Summary
  equity_curve: EquityPoint[]
  yearly: { year: string; return_pct: number }[]
  trades: ModelTrade[]
}

// ── Formatting ────────────────────────────────────────────────────────────────

const fmtMoney = (v: number) => {
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(0)}K`
  return v.toFixed(0)
}
const fmtPct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
const fmtK   = (v: number | null) => v == null ? '—' : v.toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

// Exit reason (model exit_type) → human label + colour.
const EXIT_META: Record<string, { label: string; cls: string }> = {
  STOP_LOSS:    { label: 'stop/trailing', cls: 'text-amber-300 bg-amber-950/60' },
  MAX_HOLD:     { label: 'hết hạn giữ',   cls: 'text-sky-300 bg-sky-950/60' },
  REGIME_EXIT:  { label: 'regime ↓',      cls: 'text-red-300 bg-red-950/60' },
  WYCKOFF_EXIT: { label: 'phân phối',     cls: 'text-orange-300 bg-orange-950/60' },
  RS_EXIT:      { label: 'RS yếu',        cls: 'text-purple-300 bg-purple-950/60' },
  END_OF_DATA:  { label: 'đang giữ',      cls: 'text-[#8b949e] bg-[#21262d]' },
}
const exitMeta = (t: string) => EXIT_META[t] ?? { label: t.toLowerCase(), cls: 'text-[#8b949e] bg-[#21262d]' }

const regimeCls = (r: string | null) =>
  r === 'UPTREND' ? 'text-emerald-300' : r === 'DOWNTREND' ? 'text-red-300' : 'text-amber-300'

// ── Equity curve chart ────────────────────────────────────────────────────────

function EquityChart({ curve, capital }: { curve: EquityPoint[]; capital: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current || curve.length < 2) return
    const chart: IChartApi = createChart(ref.current, {
      layout:          { background: { type: ColorType.Solid, color: '#0d1117' }, textColor: '#8b949e' },
      grid:            { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
      rightPriceScale: { borderColor: '#30363d' },
      timeScale:       { borderColor: '#30363d', timeVisible: false },
      height:          340,
      crosshair:       { mode: 1 },
    })
    const area = chart.addAreaSeries({
      lineColor: '#34d399', topColor: 'rgba(52,211,153,0.35)', bottomColor: 'rgba(52,211,153,0.02)',
      lineWidth: 2, priceFormat: { type: 'volume' },
    })
    area.setData(curve.map(p => ({ time: p.date as Time, value: p.equity })))
    const base = chart.addLineSeries({
      color: '#6e7681', lineWidth: 1, lineStyle: LineStyle.Dashed,
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    })
    base.setData([
      { time: curve[0].date as Time, value: capital },
      { time: curve[curve.length - 1].date as Time, value: capital },
    ])
    chart.timeScale().fitContent()
    const onResize = () => chart.applyOptions({ width: ref.current?.clientWidth })
    onResize()
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); chart.remove() }
  }, [curve, capital])
  return <div ref={ref} className="w-full" />
}

function Metric({ label, value, accent, sub }: { label: string; value: string; accent: string; sub?: string }) {
  return (
    <div className="flex-1 min-w-[130px] rounded-xl p-3 border bg-[#161b22] border-[#30363d]">
      <div className="text-[11px] text-[#8b949e] uppercase tracking-wider">{label}</div>
      <div className={`text-lg font-bold tabular-nums mt-0.5 ${accent}`}>{value}</div>
      {sub && <div className="text-[11px] text-[#8b949e] mt-0.5">{sub}</div>}
    </div>
  )
}

// ── Params-used panel (per-regime, the live optimized params) ─────────────────

const PARAM_KEYS = ['min_signal_score', 'max_entry_gap_pct', 'rsi_entry_max', 'rsi_exit_min',
  'atr_stop_mult', 'atr_trail_pct', 'profit_giveback_pct', 'top_n_sectors', 'rs_min_ratio'] as const

function ParamsPanel({ regimeParams }: { regimeParams: Record<string, Record<string, number>> }) {
  const [open, setOpen] = useState(false)
  const regimes = ['UPTREND', 'SIDEWAYS', 'DOWNTREND'].filter(r => regimeParams[r])
  if (regimes.length === 0) return null
  return (
    <div className="rounded-lg border border-[#30363d] bg-[#161b22]">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-[#8b949e] hover:text-[#e6edf3]">
        <span>⚙ Tham số Wyckoff đang dùng (đọc từ DB · per-regime)</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="overflow-x-auto border-t border-[#30363d]">
          <table className="w-full text-xs">
            <thead className="text-[#8b949e] text-[11px]">
              <tr><th className="px-3 py-2 text-left">Param</th>
                {regimes.map(r => <th key={r} className={`px-3 py-2 text-right ${regimeCls(r)}`}>{r}</th>)}</tr>
            </thead>
            <tbody>
              {PARAM_KEYS.map(k => (
                <tr key={k} className="border-t border-[#30363d]/40">
                  <td className="px-3 py-1.5 text-[#8b949e]">{k}</td>
                  {regimes.map(r => (
                    <td key={r} className="px-3 py-1.5 text-right tabular-nums text-[#e6edf3]">
                      {regimeParams[r]?.[k] ?? '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Main tab ──────────────────────────────────────────────────────────────────

const START_YEARS     = ['2014-01-01', '2016-01-01', '2018-01-01', '2020-01-01', '2022-01-01'] as const
const CAPITAL_PRESETS = [100, 200, 500, 1000, 2000] as const   // millions of VND
const DEFAULT_CAPITAL = 1_000_000_000

export function PortfolioBacktestTab() {
  const [data,    setData]    = useState<ModelBacktest | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [start,   setStart]   = useState<string>('2014-01-01')
  const [capital, setCapital] = useState<number>(DEFAULT_CAPITAL)
  const [detail,  setDetail]  = useState<{ symbol: string; name: string } | null>(null)
  const [yearFilter,   setYearFilter]   = useState<string>('all')
  const [symbolFilter, setSymbolFilter] = useState<string>('all')
  const [tradeView,    setTradeView]    = useState<'list' | 'symbol'>('list')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchLatest = useCallback(async () => {
    setLoading(true)
    try { setData(await api.vn100ModelBacktest()) }
    catch { /* none yet */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    fetchLatest()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [fetchLatest])

  const handleRun = async () => {
    setRunning(true)
    try { await api.runVn100ModelBacktest(start, capital) }
    catch { setRunning(false); return }
    if (pollRef.current) clearInterval(pollRef.current)
    let sawRunning = false
    pollRef.current = setInterval(async () => {
      try {
        const st = await api.status()
        if (st.running) { sawRunning = true; return }
        if (sawRunning || !st.running) {
          if (pollRef.current) clearInterval(pollRef.current)
          setRunning(false)
          await fetchLatest()
        }
      } catch { /* keep polling */ }
    }, 3000)
  }

  const s = data?.summary
  const trades = useMemo(() => data?.trades ?? [], [data])
  const years  = useMemo(() => Array.from(new Set(trades.map(t => t.entry_date.slice(0, 4)))).sort(), [trades])
  const symbols = useMemo(() => Array.from(new Set(trades.map(t => t.symbol))).sort(), [trades])
  const filtered = useMemo(() => trades.filter(t =>
    (yearFilter === 'all'   || t.entry_date.slice(0, 4) === yearFilter) &&
    (symbolFilter === 'all' || t.symbol === symbolFilter)
  ), [trades, yearFilter, symbolFilter])
  const filteredPL = useMemo(() => filtered.reduce((a, t) => a + t.pnl, 0), [filtered])

  const bySymbol = useMemo(() => {
    const scoped = trades.filter(t => yearFilter === 'all' || t.entry_date.slice(0, 4) === yearFilter)
    const m = new Map<string, { symbol: string; n: number; wins: number; ret: number; pl: number; best: number; worst: number }>()
    for (const t of scoped) {
      const g = m.get(t.symbol) ?? { symbol: t.symbol, n: 0, wins: 0, ret: 0, pl: 0, best: -Infinity, worst: Infinity }
      g.n += 1
      if (t.pnl_pct > 0) g.wins += 1
      g.ret += t.pnl_pct; g.pl += t.pnl
      g.best = Math.max(g.best, t.pnl_pct); g.worst = Math.min(g.worst, t.pnl_pct)
      m.set(t.symbol, g)
    }
    return Array.from(m.values()).sort((a, b) => b.pl - a.pl)
  }, [trades, yearFilter])

  return (
    <div className="space-y-4">
      {/* ── Heading + controls ────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-bold text-emerald-400 flex items-center gap-2">📉 VN100 — Backtest model Wyckoff hiện tại</h2>
          <p className="text-xs text-[#8b949e] mt-1 max-w-2xl">
            Chạy lại <span className="text-emerald-300 font-semibold">mô hình Wyckoff tối ưu hiện tại</span> (params per-regime
            đọc trực tiếp từ DB — đúng bộ tham số tab Buy Now đang dùng) trên lịch sử VN100. Mỗi lần bạn đổi params (insert
            SQL mới) → bấm <span className="text-emerald-300 font-semibold">Tính lại</span> để xem hiệu suất mới. Tối đa 8 vị thế,
            lọc regime + ngành, trailing-stop theo ATR, T+ ≥ 3 phiên. Long-only.
          </p>
        </div>
        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-[#8b949e] uppercase">Từ năm</span>
            <div className="flex gap-1">
              {START_YEARS.map(y => (
                <button key={y} onClick={() => setStart(y)} disabled={running}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all tabular-nums
                    ${start === y ? 'bg-[#21262d] border-[#58a6ff] text-[#58a6ff]'
                                  : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3]'}`}>
                  {y.slice(0, 4)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-[#8b949e] uppercase">Vốn (M₫)</span>
            <div className="flex gap-1 items-center">
              {CAPITAL_PRESETS.map(m => (
                <button key={m} onClick={() => setCapital(m * 1e6)} disabled={running}
                  className={`px-2 py-1 rounded-lg text-xs font-medium border transition-all tabular-nums
                    ${Math.round(capital / 1e6) === m ? 'bg-[#21262d] border-[#58a6ff] text-[#58a6ff]'
                                                      : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3]'}`}>
                  {m >= 1000 ? `${m / 1000}B` : m}
                </button>
              ))}
            </div>
          </div>
          <button onClick={handleRun} disabled={running}
            className={`self-end px-4 py-2 rounded-lg text-xs font-bold border transition-all
              ${running
                ? 'bg-cyan-950 border-cyan-700 text-cyan-300 animate-pulse cursor-not-allowed'
                : 'bg-emerald-950 border-emerald-600 text-emerald-300 hover:border-emerald-400'}`}>
            {running ? '⏳ Đang tính lại…' : '🔄 Tính lại'}
          </button>
        </div>
      </div>

      {running && (
        <div className="rounded-lg border border-cyan-900/50 bg-cyan-950/20 p-3 text-[11px] text-cyan-200/80">
          Đang chạy backtest model trên VN100… Lần chạy ĐẦU phải dựng snapshot (~10 phút) rồi cache lại; các lần sau nhanh hơn nhiều.
        </div>
      )}
      {loading && <div className="text-center py-12 text-[#8b949e] text-sm animate-pulse">Đang tải backtest gần nhất…</div>}

      {!loading && !data && (
        <div className="text-center py-16 text-[#8b949e] border border-dashed border-[#30363d] rounded-xl">
          Chưa có backtest. Bấm <span className="text-emerald-300 font-semibold">🔄 Tính lại</span> để chạy model hiện tại trên VN100.
        </div>
      )}

      {!loading && data && s && (
        <>
          {data.params?.regime_params && <ParamsPanel regimeParams={data.params.regime_params} />}

          {/* ── Headline metrics ──────────────────────────────────────────── */}
          <div className="flex gap-3 flex-wrap">
            <Metric label="Tổng lợi nhuận" accent={s.total_return_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}
              value={fmtPct(s.total_return_pct)} sub={`${fmtMoney(s.initial_capital)} → ${fmtMoney(s.final_equity)} ₫`} />
            <Metric label="CAGR" accent="text-emerald-400" value={fmtPct(s.cagr_pct)} sub={`qua ${s.years} năm`} />
            <Metric label="Sharpe" accent="text-[#58a6ff]" value={s.sharpe != null ? s.sharpe.toFixed(2) : '—'} sub="rủi ro-điều chỉnh" />
            <Metric label="Max Drawdown" accent="text-red-400" value={`−${s.max_drawdown_pct.toFixed(1)}%`} sub="đỉnh→đáy" />
            <Metric label="Win Rate" accent="text-[#58a6ff]" value={`${s.win_rate.toFixed(1)}%`} sub={`${s.winning_trades}W / ${s.losing_trades}L`} />
            <Metric label="Profit Factor" accent="text-amber-400" value={s.profit_factor != null ? s.profit_factor.toFixed(2) : '—'} sub="lãi gộp / lỗ gộp" />
            <Metric label="Số lệnh" accent="text-[#e6edf3]" value={s.executed_trades.toLocaleString()} sub={`${s.avg_holding_days}d giữ TB`} />
          </div>

          {/* ── Equity curve ──────────────────────────────────────────────── */}
          <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-[#e6edf3]">Đường vốn · {s.start_date} → {s.end_date}</span>
              <span className="text-[11px] text-[#8b949e]">
                {data.label} · {s.symbols} mã · chạy {new Date(data.created_at).toLocaleString('vi-VN')}
              </span>
            </div>
            <EquityChart curve={data.equity_curve} capital={s.initial_capital} />
          </div>

          {/* ── Yearly returns ────────────────────────────────────────────── */}
          {data.yearly.length > 0 && (
            <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-3">
              <div className="text-xs font-semibold text-[#8b949e] mb-3">Lợi nhuận theo năm</div>
              <div className="flex gap-2 flex-wrap">
                {data.yearly.map(y => {
                  const pos = y.return_pct >= 0
                  return (
                    <div key={y.year} className="flex flex-col items-center gap-1 min-w-[64px]">
                      <span className={`text-xs font-bold tabular-nums ${pos ? 'text-emerald-400' : 'text-red-400'}`}>{fmtPct(y.return_pct)}</span>
                      <div className="w-full h-16 flex items-end justify-center bg-[#0d1117] rounded">
                        <div className="w-7 rounded-t transition-all"
                          style={{ height: `${Math.min(100, Math.abs(y.return_pct) * 0.7 + 6)}%`, background: pos ? '#34d399' : '#f87171' }} />
                      </div>
                      <span className="text-[11px] text-[#8b949e] tabular-nums">{y.year}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Transactions ──────────────────────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-bold text-[#e6edf3]">Lệnh giao dịch</span>
              <div className="flex gap-1">
                {(['list', 'symbol'] as const).map(v => (
                  <button key={v} onClick={() => setTradeView(v)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                      ${tradeView === v ? 'bg-[#21262d] border-[#58a6ff] text-[#58a6ff]' : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3]'}`}>
                    {v === 'list' ? '📜 Theo ngày' : '🏷 Theo mã'}
                  </button>
                ))}
              </div>
              <div className="h-4 w-px bg-[#30363d]" />
              <span className="text-[11px] text-[#8b949e] uppercase">Năm</span>
              <div className="flex gap-1 flex-wrap">
                {['all', ...years].map(y => (
                  <button key={y} onClick={() => setYearFilter(y)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all tabular-nums
                      ${yearFilter === y ? 'bg-[#21262d] border-[#58a6ff] text-[#58a6ff]' : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3]'}`}>
                    {y === 'all' ? 'Tất cả' : y}
                  </button>
                ))}
              </div>
              {tradeView === 'list' && (
                <>
                  <div className="h-4 w-px bg-[#30363d]" />
                  <span className="text-[11px] text-[#8b949e] uppercase">Mã</span>
                  <select value={symbolFilter} onChange={e => setSymbolFilter(e.target.value)}
                    className="bg-[#21262d] border border-[#30363d] text-[#e6edf3] text-xs rounded-lg px-2 py-1.5 focus:border-[#58a6ff] focus:outline-none cursor-pointer">
                    <option value="all">Tất cả ({symbols.length})</option>
                    {symbols.map(sym => <option key={sym} value={sym}>{sym}</option>)}
                  </select>
                </>
              )}
              <span className="text-xs text-[#8b949e] ml-auto tabular-nums">
                {tradeView === 'list'
                  ? <>{filtered.length} lệnh · P/L ròng{' '}
                      <span className={filteredPL >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                        {filteredPL >= 0 ? '+' : '−'}{fmtMoney(Math.abs(filteredPL))} ₫</span></>
                  : <>{bySymbol.length} mã đã giao dịch</>}
              </span>
            </div>

            {/* ── By-date trade list ─────────────────────────────────────── */}
            {tradeView === 'list' && (
              <div className="overflow-x-auto rounded-lg border border-[#30363d] max-h-[520px]">
                <table className="w-full text-xs">
                  <thead className="text-[#8b949e] uppercase tracking-wider text-[11px]">
                    <tr>
                      <th className="px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22]">Mã</th>
                      <th className="px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22]">Regime</th>
                      <th className="px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22]">Wyckoff</th>
                      <th className="px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22] text-emerald-400">🟢 Ngày mua</th>
                      <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22] text-emerald-400">Giá mua</th>
                      <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]">SL</th>
                      <th className="px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22] text-red-400">🔴 Ngày bán</th>
                      <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22] text-red-400">Giá bán</th>
                      <th className="px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]">Lý do bán</th>
                      <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]">Giữ</th>
                      <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]">% Lãi/Lỗ</th>
                      <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]">P/L (₫)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 && (
                      <tr><td colSpan={12} className="px-4 py-10 text-center text-[#8b949e]">Không có lệnh khớp bộ lọc.</td></tr>
                    )}
                    {[...filtered].sort((a, b) => a.entry_date.localeCompare(b.entry_date)).map((t, i) => {
                      const win = t.pnl_pct >= 0
                      const rm  = exitMeta(t.exit_type)
                      return (
                        <tr key={`${t.symbol}-${t.entry_date}-${i}`}
                          className={`border-t border-[#30363d]/50 cursor-pointer transition-all hover:bg-[#21262d] ${i % 2 === 0 ? '' : 'bg-[#161b22]/30'}`}
                          style={{ borderLeft: `4px solid ${win ? '#34d399' : '#f87171'}` }}
                          onClick={() => setDetail({ symbol: t.symbol, name: t.symbol })}>
                          <td className="px-3 py-2 font-bold text-emerald-400">{t.symbol}</td>
                          <td className={`px-3 py-2 text-[11px] font-semibold ${regimeCls(t.regime_at_entry)}`}>{t.regime_at_entry ?? '—'}</td>
                          <td className="px-3 py-2 text-[#8b949e]">{t.wyckoff_phase ?? '—'}</td>
                          <td className="px-3 py-2 tabular-nums text-[#e6edf3]">{t.entry_date}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-emerald-300">{fmtK(t.entry_price)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-[#8b949e]">{t.shares.toLocaleString('vi-VN')}</td>
                          <td className="px-3 py-2 tabular-nums text-[#e6edf3]">{t.exit_date ?? '—'}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-red-300">{fmtK(t.exit_price)}</td>
                          <td className="px-3 py-2 text-center">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${rm.cls}`}>{rm.label}</span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-[#8b949e]">{t.hold_days != null ? `${t.hold_days}d` : '—'}</td>
                          <td className={`px-3 py-2 text-right tabular-nums font-bold ${win ? 'text-emerald-400' : 'text-red-400'}`}>{fmtPct(t.pnl_pct)}</td>
                          <td className={`px-3 py-2 text-right tabular-nums ${win ? 'text-emerald-400/90' : 'text-red-400/90'}`}>
                            {t.pnl >= 0 ? '+' : '−'}{fmtMoney(Math.abs(t.pnl))}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Per-symbol breakdown ───────────────────────────────────── */}
            {tradeView === 'symbol' && (
              <div className="overflow-x-auto rounded-lg border border-[#30363d] max-h-[520px]">
                <table className="w-full text-xs">
                  <thead className="text-[#8b949e] uppercase tracking-wider text-[11px]">
                    <tr>
                      <th className="px-3 py-3 text-left  font-semibold sticky top-0 z-10 bg-[#161b22]">Mã</th>
                      <th className="px-3 py-3 text-right font-semibold sticky top-0 z-10 bg-[#161b22]">Lệnh</th>
                      <th className="px-3 py-3 text-right font-semibold sticky top-0 z-10 bg-[#161b22]">Win %</th>
                      <th className="px-3 py-3 text-right font-semibold sticky top-0 z-10 bg-[#161b22]">Σ %</th>
                      <th className="px-3 py-3 text-right font-semibold sticky top-0 z-10 bg-[#161b22]">Tốt nhất</th>
                      <th className="px-3 py-3 text-right font-semibold sticky top-0 z-10 bg-[#161b22]">Tệ nhất</th>
                      <th className="px-3 py-3 text-right font-semibold sticky top-0 z-10 bg-[#161b22]">Tổng P/L (₫)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bySymbol.length === 0 && (
                      <tr><td colSpan={7} className="px-4 py-10 text-center text-[#8b949e]">Không có lệnh trong năm này.</td></tr>
                    )}
                    {bySymbol.map((g, i) => {
                      const win = g.pl >= 0
                      return (
                        <tr key={g.symbol}
                          className={`border-t border-[#30363d]/50 cursor-pointer transition-all hover:bg-[#21262d] ${i % 2 === 0 ? '' : 'bg-[#161b22]/30'}`}
                          style={{ borderLeft: `4px solid ${win ? '#34d399' : '#f87171'}` }}
                          onClick={() => { setSymbolFilter(g.symbol); setTradeView('list') }}>
                          <td className="px-3 py-2 font-bold text-emerald-400">{g.symbol}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-[#e6edf3]">{g.n}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-[#58a6ff]">{((g.wins / g.n) * 100).toFixed(0)}%</td>
                          <td className={`px-3 py-2 text-right tabular-nums font-bold ${g.ret >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtPct(g.ret)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-emerald-400/80">{fmtPct(g.best)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-red-400/80">{fmtPct(g.worst)}</td>
                          <td className={`px-3 py-2 text-right tabular-nums font-bold ${win ? 'text-emerald-400' : 'text-red-400'}`}>
                            {g.pl >= 0 ? '+' : '−'}{fmtMoney(Math.abs(g.pl))}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-3 text-[11px] text-amber-200/70 leading-relaxed">
            <span className="font-bold text-amber-300">⚠ Lưu ý.</span> Rổ là VN100 <span className="font-semibold">hiện tại</span> (thiên lệch sống sót).
            Khớp lệnh giả định tại giá mở cửa phiên kế tiếp, chưa mô hình hóa trượt giá/phí. Tín hiệu là walk-forward (mỗi phiên chỉ thấy dữ liệu quá khứ).
            Kết quả thực tế sẽ thấp hơn. Quá khứ ≠ tương lai · không phải khuyến nghị đầu tư.
          </div>
        </>
      )}

      {detail && <SymbolModal symbol={detail.symbol} name={detail.name} onClose={() => setDetail(null)} />}
    </div>
  )
}
