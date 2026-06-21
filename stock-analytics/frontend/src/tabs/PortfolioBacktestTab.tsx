import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createChart, ColorType, LineStyle, type IChartApi, type Time } from 'lightweight-charts'
import type { PortfolioBacktest, EquityPoint } from '../types'
import { api, VN_INDICES } from '../api'
import { SymbolModal } from '../components/SymbolModal'

// ── Formatting ────────────────────────────────────────────────────────────────

const fmtMoney = (v: number) => {
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(0)}K`
  return v.toFixed(0)
}
const fmtPct  = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
const fmtK    = (v: number) => v.toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

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

    // Starting-capital baseline
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

// ── Metric card ───────────────────────────────────────────────────────────────

function Metric({ label, value, accent, sub }: { label: string; value: string; accent: string; sub?: string }) {
  return (
    <div className="flex-1 min-w-[130px] rounded-xl p-3 border bg-[#161b22] border-[#30363d]">
      <div className="text-[11px] text-[#8b949e] uppercase tracking-wider">{label}</div>
      <div className={`text-lg font-bold tabular-nums mt-0.5 ${accent}`}>{value}</div>
      {sub && <div className="text-[11px] text-[#8b949e] mt-0.5">{sub}</div>}
    </div>
  )
}

const REASON_META: Record<string, { label: string; cls: string }> = {
  target:      { label: 'target',  cls: 'text-emerald-300 bg-emerald-950/60' },
  stop:        { label: 'stop',    cls: 'text-red-300 bg-red-950/60' },
  timeout:     { label: 'timeout', cls: 'text-amber-300 bg-amber-950/60' },
  end_of_data: { label: 'open',    cls: 'text-[#8b949e] bg-[#21262d]' },
}

// ── Main tab ──────────────────────────────────────────────────────────────────

const START_YEARS    = ['2018-01-01', '2020-01-01', '2022-01-01'] as const
const SLOTS          = [4, 6, 8, 10, 12, 16] as const
const CAPITAL_PRESETS = [100, 200, 500, 1000, 2000] as const   // millions of VND
const DEFAULT_CAPITAL = 500_000_000   // 500M VND

export function PortfolioBacktestTab() {
  const [data,    setData]    = useState<PortfolioBacktest | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [start,   setStart]   = useState<string>('2018-01-01')
  const [slots,   setSlots]   = useState<number>(12)
  const [capital, setCapital] = useState<number>(DEFAULT_CAPITAL)
  const [detail,  setDetail]  = useState<{ symbol: string; name: string } | null>(null)
  const [yearFilter,   setYearFilter]   = useState<string>('all')
  const [symbolFilter, setSymbolFilter] = useState<string>('all')
  const [tradeView,    setTradeView]    = useState<'list' | 'symbol'>('list')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const vn100 = useMemo(() => {
    const def = VN_INDICES.vn100
    return 'symbols' in def ? def.symbols : []
  }, [])

  const fetchLatest = useCallback(async () => {
    setLoading(true)
    try { setData(await api.portfolioBacktest()) }
    catch { /* none yet */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    fetchLatest()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [fetchLatest])

  const handleRun = async () => {
    setRunning(true)
    try {
      await api.runPortfolioBacktest(
        vn100, `VN100 Wyckoff ${start.slice(0, 4)}+ (${Math.round(capital / 1e6)}M)`,
        start, capital, slots,
      )
    } catch {
      setRunning(false)
      return
    }
    // poll the shared crawl status until it goes idle, then refetch
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

  // ── Transaction filtering (by year / by symbol) ──────────────────────────
  const trades = useMemo(() => data?.trades ?? [], [data])
  const years  = useMemo(
    () => Array.from(new Set(trades.map(t => t.entry_date.slice(0, 4)))).sort(),
    [trades])
  const symbols = useMemo(
    () => Array.from(new Set(trades.map(t => t.symbol))).sort(),
    [trades])
  const filtered = useMemo(() => trades.filter(t =>
    (yearFilter === 'all'   || t.entry_date.slice(0, 4) === yearFilter) &&
    (symbolFilter === 'all' || t.symbol === symbolFilter)
  ), [trades, yearFilter, symbolFilter])

  const filteredPL = useMemo(() => filtered.reduce((a, t) => a + t.pl, 0), [filtered])

  // Per-symbol aggregation of the (year-filtered) trades.
  const bySymbol = useMemo(() => {
    const yearScoped = trades.filter(t => yearFilter === 'all' || t.entry_date.slice(0, 4) === yearFilter)
    const m = new Map<string, { symbol: string; n: number; wins: number; ret: number; pl: number; best: number; worst: number }>()
    for (const t of yearScoped) {
      const g = m.get(t.symbol) ?? { symbol: t.symbol, n: 0, wins: 0, ret: 0, pl: 0, best: -Infinity, worst: Infinity }
      g.n += 1
      if (t.net_return_pct > 0) g.wins += 1
      g.ret += t.net_return_pct
      g.pl  += t.pl
      g.best  = Math.max(g.best, t.net_return_pct)
      g.worst = Math.min(g.worst, t.net_return_pct)
      m.set(t.symbol, g)
    }
    return Array.from(m.values()).sort((a, b) => b.pl - a.pl)
  }, [trades, yearFilter])

  return (
    <div className="space-y-4">

      {/* ── Heading + controls ────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-bold text-emerald-400 flex items-center gap-2">📉 VN100 Wyckoff Backtest</h2>
          <p className="text-xs text-[#8b949e] mt-1 max-w-2xl">
            Trades the Wyckoff <span className="text-emerald-300 font-semibold">BUY</span> signal across the
            VN100 basket from the chosen start date — one shared cash account, {slots} concurrent position slots,
            stop / target / timeout exits, and a <span className="text-amber-300 font-semibold">3-session minimum hold</span> (T+
            settlement — bought shares can't be sold for the first few days). A walk-forward-validated <span className="text-sky-300 font-semibold">entry-confirmation
            filter</span> (close&gt;MA50, RSI&gt;50, volume expansion, OBV rising, Bollinger %b&lt;0.9, plus a risk-on basket
            regime) keeps the strategy out of counter-trend dips. Long-only (VN has no practical single-stock shorting).
          </p>
        </div>
        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-[#8b949e] uppercase">From</span>
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

          {/* ── Capital (₫) ─────────────────────────────────────────────── */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-[#8b949e] uppercase">Capital (M₫)</span>
            <div className="flex gap-1 items-center">
              {CAPITAL_PRESETS.map(m => (
                <button key={m} onClick={() => setCapital(m * 1e6)} disabled={running}
                  className={`px-2 py-1 rounded-lg text-xs font-medium border transition-all tabular-nums
                    ${Math.round(capital / 1e6) === m ? 'bg-[#21262d] border-[#58a6ff] text-[#58a6ff]'
                                                      : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3]'}`}>
                  {m >= 1000 ? `${m / 1000}B` : m}
                </button>
              ))}
              <input
                type="number" min={1} step={50} disabled={running}
                value={Math.round(capital / 1e6)}
                onChange={e => setCapital(Math.max(1, Number(e.target.value) || 0) * 1e6)}
                className="w-20 bg-[#21262d] border border-[#30363d] text-[#e6edf3] text-xs rounded-lg px-2 py-1
                           focus:border-[#58a6ff] focus:outline-none tabular-nums disabled:opacity-50"
                title="Custom starting capital, in millions of VND"
              />
            </div>
          </div>

          {/* ── Slots ───────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-[#8b949e] uppercase">Slots (≈{(100 / slots).toFixed(0)}%/pos)</span>
            <div className="flex gap-1">
              {SLOTS.map(n => (
                <button key={n} onClick={() => setSlots(n)} disabled={running}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all tabular-nums
                    ${slots === n ? 'bg-[#21262d] border-[#58a6ff] text-[#58a6ff]'
                                  : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3]'}`}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <button onClick={handleRun} disabled={running}
            className={`self-end px-4 py-2 rounded-lg text-xs font-bold border transition-all
              ${running
                ? 'bg-cyan-950 border-cyan-700 text-cyan-300 animate-pulse cursor-not-allowed'
                : 'bg-emerald-950 border-emerald-600 text-emerald-300 hover:border-emerald-400'}`}>
            {running ? '⏳ Running backtest…' : '▶ Run Backtest'}
          </button>
        </div>
      </div>

      {loading && (
        <div className="text-center py-12 text-[#8b949e] text-sm animate-pulse">Loading latest backtest…</div>
      )}

      {!loading && !data && (
        <div className="text-center py-16 text-[#8b949e] border border-dashed border-[#30363d] rounded-xl">
          No backtest yet. Click <span className="text-emerald-300 font-semibold">▶ Run Backtest</span> to trade
          VN100 with the Wyckoff method from {start.slice(0, 4)} → now. Takes ~1–2 minutes.
        </div>
      )}

      {!loading && data && s && (
        <>
          {/* ── Headline metrics ──────────────────────────────────────────── */}
          <div className="flex gap-3 flex-wrap">
            <Metric label="Total Return" accent={s.total_return_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}
              value={fmtPct(s.total_return_pct)}
              sub={`${fmtMoney(s.initial_capital)} → ${fmtMoney(s.final_equity)} ₫`} />
            <Metric label="CAGR" accent="text-emerald-400" value={fmtPct(s.cagr_pct)} sub={`over ${s.years} yrs`} />
            <Metric label="Max Drawdown" accent="text-red-400" value={`−${s.max_drawdown_pct.toFixed(1)}%`} sub="peak→trough" />
            <Metric label="Win Rate" accent="text-[#58a6ff]" value={`${s.win_rate.toFixed(1)}%`}
              sub={`${s.winning_trades}W / ${s.losing_trades}L`} />
            <Metric label="Profit Factor" accent="text-amber-400"
              value={s.profit_factor != null ? s.profit_factor.toFixed(2) : '—'} sub="gross W / gross L" />
            <Metric label="Trades" accent="text-[#e6edf3]" value={s.executed_trades.toLocaleString()}
              sub={`${s.skipped_signals} skipped · ${s.avg_holding_days}d avg`} />
            <Metric label="vs Buy & Hold" accent={s.total_return_pct >= s.benchmark_pct ? 'text-emerald-400' : 'text-amber-400'}
              value={fmtPct(s.benchmark_pct)} sub="median VN100 stock" />
          </div>

          {/* ── Equity curve ──────────────────────────────────────────────── */}
          <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-[#e6edf3]">Equity curve · {s.start_date} → {s.end_date}</span>
              <span className="text-[11px] text-[#8b949e]">
                {data.label} · {s.symbols} symbols · {s.slots} slots ·
                run {new Date(data.created_at).toLocaleString('vi-VN')}
              </span>
            </div>
            <EquityChart curve={data.equity_curve} capital={s.initial_capital} />
          </div>

          {/* ── Yearly returns ────────────────────────────────────────────── */}
          {data.yearly.length > 0 && (
            <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-3">
              <div className="text-xs font-semibold text-[#8b949e] mb-3">Return by year</div>
              <div className="flex gap-2 flex-wrap">
                {data.yearly.map(y => {
                  const pos = y.return_pct >= 0
                  return (
                    <div key={y.year} className="flex flex-col items-center gap-1 min-w-[64px]">
                      <span className={`text-xs font-bold tabular-nums ${pos ? 'text-emerald-400' : 'text-red-400'}`}>
                        {fmtPct(y.return_pct)}
                      </span>
                      <div className="w-full h-16 flex items-end justify-center bg-[#0d1117] rounded">
                        <div className="w-7 rounded-t transition-all"
                          style={{
                            height: `${Math.min(100, Math.abs(y.return_pct) * 0.7 + 6)}%`,
                            background: pos ? '#34d399' : '#f87171',
                          }} />
                      </div>
                      <span className="text-[11px] text-[#8b949e] tabular-nums">{y.year}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Transactions: filter by year / symbol, list or per-symbol ──── */}
          <div className="space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-bold text-[#e6edf3]">Transactions</span>

              {/* view toggle */}
              <div className="flex gap-1">
                {(['list', 'symbol'] as const).map(v => (
                  <button key={v} onClick={() => setTradeView(v)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                      ${tradeView === v ? 'bg-[#21262d] border-[#58a6ff] text-[#58a6ff]'
                                        : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3]'}`}>
                    {v === 'list' ? '📜 By date' : '🏷 By symbol'}
                  </button>
                ))}
              </div>

              <div className="h-4 w-px bg-[#30363d]" />

              {/* year filter */}
              <span className="text-[11px] text-[#8b949e] uppercase">Year</span>
              <div className="flex gap-1 flex-wrap">
                {['all', ...years].map(y => (
                  <button key={y} onClick={() => setYearFilter(y)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all tabular-nums
                      ${yearFilter === y ? 'bg-[#21262d] border-[#58a6ff] text-[#58a6ff]'
                                         : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3]'}`}>
                    {y === 'all' ? 'All' : y}
                  </button>
                ))}
              </div>

              {/* symbol filter (only meaningful in list view) */}
              {tradeView === 'list' && (
                <>
                  <div className="h-4 w-px bg-[#30363d]" />
                  <span className="text-[11px] text-[#8b949e] uppercase">Symbol</span>
                  <select value={symbolFilter} onChange={e => setSymbolFilter(e.target.value)}
                    className="bg-[#21262d] border border-[#30363d] text-[#e6edf3] text-xs rounded-lg px-2 py-1.5
                               focus:border-[#58a6ff] focus:outline-none cursor-pointer">
                    <option value="all">All ({symbols.length})</option>
                    {symbols.map(sym => <option key={sym} value={sym}>{sym}</option>)}
                  </select>
                </>
              )}

              <span className="text-xs text-[#8b949e] ml-auto tabular-nums">
                {tradeView === 'list'
                  ? <>{filtered.length} trades · net P/L{' '}
                      <span className={filteredPL >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                        {filteredPL >= 0 ? '+' : '−'}{fmtMoney(Math.abs(filteredPL))} ₫
                      </span></>
                  : <>{bySymbol.length} symbols traded</>}
              </span>
            </div>

            {/* ── By-date trade list ─────────────────────────────────────── */}
            {tradeView === 'list' && (
              <div className="overflow-x-auto rounded-lg border border-[#30363d] max-h-[520px]">
                <table className="w-full text-xs">
                  <thead className="text-[#8b949e] uppercase tracking-wider text-[11px]">
                    <tr>
                      <th className="px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22]">Symbol</th>
                      <th className="px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22]">Wyckoff</th>
                      <th className="px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22] text-emerald-400">🟢 Buy date</th>
                      <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22] text-emerald-400">Buy (K₫)</th>
                      <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22] text-red-400">✕ Stop (K₫)</th>
                      <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22] text-amber-400">🎯 Target (K₫)</th>
                      <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22] text-amber-400">R:R</th>
                      <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]">Qty</th>
                      <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]">Cost (₫)</th>
                      <th className="px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22] text-red-400">🔴 Sell date</th>
                      <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22] text-red-400">Sell (K₫)</th>
                      <th className="px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]">Exit</th>
                      <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]">Hold</th>
                      <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]">Return</th>
                      <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]">P/L (₫)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 && (
                      <tr><td colSpan={15} className="px-4 py-10 text-center text-[#8b949e]">No trades match this filter.</td></tr>
                    )}
                    {[...filtered].sort((a, b) => a.entry_date.localeCompare(b.entry_date)).map((t, i) => {
                      const win = t.net_return_pct >= 0
                      const rm  = REASON_META[t.exit_reason] ?? REASON_META.end_of_data
                      return (
                        <tr key={`${t.symbol}-${t.entry_date}-${i}`}
                          className={`border-t border-[#30363d]/50 cursor-pointer transition-all
                            hover:bg-[#21262d] ${i % 2 === 0 ? '' : 'bg-[#161b22]/30'}`}
                          style={{ borderLeft: `4px solid ${win ? '#34d399' : '#f87171'}` }}
                          onClick={() => setDetail({ symbol: t.symbol, name: t.symbol })}>
                          <td className="px-3 py-2 font-bold text-emerald-400">{t.symbol}</td>
                          <td className="px-3 py-2 text-[#8b949e]">
                            {t.phase}{t.sub_phase !== '-' && `·${t.sub_phase}`}
                            {t.event && <span className="text-[#58a6ff]"> {t.event}</span>}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-[#e6edf3]">{t.entry_date}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-emerald-300">{fmtK(t.entry_price)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-red-300/90">{fmtK(t.stop_loss)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-amber-300/90">{fmtK(t.target)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {t.entry_price > t.stop_loss ? (
                              <span className="text-amber-300/90">
                                1:{((t.target - t.entry_price) / (t.entry_price - t.stop_loss)).toFixed(1)}
                              </span>
                            ) : <span className="text-[#8b949e]">—</span>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-[#e6edf3]">
                            {(t.shares ?? Math.round(t.alloc / t.entry_price)).toLocaleString('vi-VN')}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-[#8b949e]">{fmtMoney(t.alloc)}</td>
                          <td className="px-3 py-2 tabular-nums text-[#e6edf3]">{t.exit_date}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-red-300">{fmtK(t.exit_price)}</td>
                          <td className="px-3 py-2 text-center">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${rm.cls}`}>{rm.label}</span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-[#8b949e]">{t.holding_days}d</td>
                          <td className={`px-3 py-2 text-right tabular-nums font-bold ${win ? 'text-emerald-400' : 'text-red-400'}`}>
                            {fmtPct(t.net_return_pct)}
                          </td>
                          <td className={`px-3 py-2 text-right tabular-nums ${win ? 'text-emerald-400/90' : 'text-red-400/90'}`}>
                            {t.pl >= 0 ? '+' : '−'}{fmtMoney(Math.abs(t.pl))}
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
                      <th className="px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22]">Symbol</th>
                      <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]">Trades</th>
                      <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]">Win %</th>
                      <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]">Σ Return</th>
                      <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]">Best</th>
                      <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]">Worst</th>
                      <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]">Total P/L (₫)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bySymbol.length === 0 && (
                      <tr><td colSpan={7} className="px-4 py-10 text-center text-[#8b949e]">No trades in this year.</td></tr>
                    )}
                    {bySymbol.map((g, i) => {
                      const win = g.pl >= 0
                      return (
                        <tr key={g.symbol}
                          className={`border-t border-[#30363d]/50 cursor-pointer transition-all
                            hover:bg-[#21262d] ${i % 2 === 0 ? '' : 'bg-[#161b22]/30'}`}
                          style={{ borderLeft: `4px solid ${win ? '#34d399' : '#f87171'}` }}
                          onClick={() => { setSymbolFilter(g.symbol); setTradeView('list') }}
                          title="Show this symbol's trades">
                          <td className="px-3 py-2 font-bold text-emerald-400">{g.symbol}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-[#e6edf3]">{g.n}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-[#58a6ff]">
                            {((g.wins / g.n) * 100).toFixed(0)}%
                          </td>
                          <td className={`px-3 py-2 text-right tabular-nums font-bold ${g.ret >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {fmtPct(g.ret)}
                          </td>
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
            <span className="font-bold text-amber-300">⚠ Read the caveats.</span> These returns are almost certainly
            optimistic. The basket is <span className="font-semibold">today's</span> VN100 — a survivorship-biased set of
            past winners (DIG, DGW, VIX… all had huge 2021 runs). Fills assume the exact analyzed close with no slippage;
            only a flat {s.cost_pct ?? 0.3}% round-trip cost is modelled (buys rounded to {s.lot_size ?? 100}-share HOSE
            lots). Signals are genuine walk-forward (each bar only
            sees prior data), and the equity curve is daily mark-to-market, but real-world results would be materially
            lower. Past performance ≠ future results · not financial advice.
          </div>
        </>
      )}

      {detail && <SymbolModal symbol={detail.symbol} name={detail.name} onClose={() => setDetail(null)} />}
    </div>
  )
}
