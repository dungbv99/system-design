import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import type { RegimeRow, BacktestRun, BacktestTradeRow, WyckoffOptSignal, BacktestProgress } from '../api'

// ── Formatting helpers ────────────────────────────────────────────────────────

const fmtFrac = (v: number | null | undefined) =>
  v == null ? '—' : `${(v * 100).toFixed(1)}%`
const fmtNum = (v: number | null | undefined, d = 2) =>
  v == null ? '—' : v.toFixed(d)

const regimeStyle = (r: string): string =>
  r === 'UPTREND'   ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
  : r === 'DOWNTREND' ? 'bg-red-950 text-red-300 border-red-700'
  : 'bg-amber-950 text-amber-300 border-amber-700'

const pctColor = (v: number | null | undefined) =>
  v == null ? 'text-[#8b949e]' : v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-[#8b949e]'

const yearColor = (v: number) =>
  v > 30 ? 'text-emerald-300' : v > 15 ? 'text-amber-300' : v < 0 ? 'text-red-400' : 'text-[#8b949e]'

const exitColor: Record<string, string> = {
  STOP_LOSS: 'text-red-400', REGIME_EXIT: 'text-amber-400', WYCKOFF_EXIT: 'text-purple-400',
  MAX_HOLD: 'text-cyan-400', RS_EXIT: 'text-orange-400', END_OF_DATA: 'text-[#8b949e]',
}

// ── Component ─────────────────────────────────────────────────────────────────

export function WyckoffOptTab() {
  const [regime, setRegime]   = useState<RegimeRow | null>(null)
  const [runs, setRuns]       = useState<BacktestRun[]>([])
  const [selectedRun, setSelectedRun] = useState<number | null>(null)
  const [trades, setTrades]   = useState<BacktestTradeRow[]>([])
  const [params, setParams]   = useState<Record<string, { params: Record<string, number>; sharpe: number | null }>>({})
  const [capital, setCapital] = useState(1_000_000_000)
  const [samples, setSamples] = useState(200)
  const [busy, setBusy]       = useState(false)
  const [msg, setMsg]         = useState('')
  const [progress, setProgress] = useState<BacktestProgress | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Live single-symbol signal
  const [symbol, setSymbol]   = useState('')
  const [signal, setSignal]   = useState<WyckoffOptSignal | null>(null)
  const [sigErr, setSigErr]   = useState('')

  const loadRuns = useCallback(async () => {
    const [reg, rn, pr] = await Promise.all([
      api.regimeLatest().catch(() => null),
      api.backtestRuns(20).catch(() => []),
      api.backtestParams().catch(() => ({})),
    ])
    setRegime(reg); setRuns(rn); setParams(pr)
    if (rn.length && selectedRun == null) setSelectedRun(rn[0].id)
  }, [selectedRun])

  useEffect(() => { void loadRuns() }, [loadRuns])

  // Poll backtest progress every 2s; stop (and reload runs) once it finishes.
  useEffect(() => {
    const poll = async () => {
      const p = await api.backtestProgress().catch(() => null)
      if (!p) return
      setProgress(p)
      if (!p.active && !p.running) {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
        void loadRuns()
      }
    }
    void poll()
    pollRef.current = setInterval(poll, 2000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [loadRuns])

  useEffect(() => {
    if (selectedRun == null) { setTrades([]); return }
    void api.backtestTrades(selectedRun).then(setTrades).catch(() => setTrades([]))
  }, [selectedRun])

  const run = useCallback(async () => {
    setBusy(true); setMsg('')
    try {
      const r = await api.runBacktest(capital, samples)
      setMsg(`${r.message} — poll the runs table below; this can take a while.`)
    } catch (e) {
      setMsg(`Error: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }, [capital, samples])

  const lookup = useCallback(async () => {
    const sym = symbol.trim().toUpperCase()
    if (!sym) return
    setSigErr(''); setSignal(null)
    try { setSignal(await api.wyckoffOpt(sym)) }
    catch (e) { setSigErr((e as Error).message) }
  }, [symbol])

  const selected = useMemo(() => runs.find(r => r.id === selectedRun) ?? null, [runs, selectedRun])

  return (
    <div className="p-4 space-y-4">
      {/* ── Regime + run controls ───────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 bg-[#161b22] border border-[#30363d] rounded p-3">
        <span className="text-[#8b949e] text-xs uppercase">VNIndex Regime</span>
        {regime ? (
          <span className={`px-3 py-1 rounded-full text-xs font-bold border ${regimeStyle(regime.regime)}`}>
            {regime.regime}
          </span>
        ) : <span className="text-[#8b949e]">—</span>}
        {regime?.date && <span className="text-[#8b949e] text-xs">@ {regime.date}</span>}
        {regime?.drawdown != null && (
          <span className="text-xs text-[#8b949e]">drawdown {fmtFrac(regime.drawdown)}</span>
        )}
        {regime?.wyckoff_phase && <span className="text-xs text-[#8b949e]">phase {regime.wyckoff_phase}</span>}

        <div className="flex-1" />

        <label className="text-xs text-[#8b949e]">Capital
          <input type="number" value={capital} onChange={e => setCapital(Number(e.target.value))}
            className="ml-2 w-36 bg-[#0d1117] border border-[#30363d] rounded px-2 py-1 text-xs tabular-nums" />
        </label>
        <label className="text-xs text-[#8b949e]">Samples
          <input type="number" value={samples} onChange={e => setSamples(Number(e.target.value))}
            className="ml-2 w-20 bg-[#0d1117] border border-[#30363d] rounded px-2 py-1 text-xs tabular-nums" />
        </label>
        <button onClick={run} disabled={busy}
          className="px-3 py-1.5 rounded text-xs font-semibold bg-[#238636] hover:bg-[#2ea043] disabled:opacity-50">
          {busy ? '…' : '▶ Run Backtest'}
        </button>
        <button onClick={() => void loadRuns()}
          className="px-3 py-1.5 rounded text-xs font-semibold bg-[#21262d] border border-[#30363d] hover:border-[#58a6ff]">
          ↻ Refresh
        </button>
      </div>
      {msg && <div className="text-xs text-[#58a6ff]">{msg}</div>}

      {/* ── Live progress bar ───────────────────────────────────────────── */}
      {progress && (progress.active || progress.running) && (
        <div className="bg-[#161b22] border border-[#30363d] rounded p-3 space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#e6edf3] font-semibold">
              {progress.overall_pct.toFixed(1)}/100%
              <span className="text-[#8b949e] font-normal"> — {progress.message || progress.phase}</span>
            </span>
            <span className="text-[#8b949e] tabular-nums">
              {progress.phase_current}/{progress.phase_total}
              {progress.eta_sec != null && ` · eta ~${Math.round(progress.eta_sec / 60)}m`}
              {progress.elapsed_sec != null && ` · ${Math.round(progress.elapsed_sec / 60)}m elapsed`}
            </span>
          </div>
          <div className="h-2 bg-[#0d1117] rounded overflow-hidden">
            <div className="h-full bg-[#58a6ff] transition-all duration-500"
              style={{ width: `${progress.overall_pct}%` }} />
          </div>
        </div>
      )}

      {/* ── Live single-symbol optimized signal ─────────────────────────── */}
      <div className="bg-[#161b22] border border-[#30363d] rounded p-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[#8b949e] text-xs uppercase">Live signal</span>
          <input value={symbol} onChange={e => setSymbol(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && lookup()}
            placeholder="symbol e.g. FPT"
            className="w-32 bg-[#0d1117] border border-[#30363d] rounded px-2 py-1 text-xs uppercase" />
          <button onClick={lookup}
            className="px-3 py-1 rounded text-xs bg-[#21262d] border border-[#30363d] hover:border-[#58a6ff]">Lookup</button>
          {sigErr && <span className="text-xs text-red-400">{sigErr}</span>}
        </div>
        {signal && (
          <div className="flex flex-wrap gap-4 text-xs items-center">
            <span className="font-bold text-[#e6edf3]">{signal.symbol}</span>
            <span className={`px-2 py-0.5 rounded font-bold border ${
              signal.signal === 'BUY' ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
              : 'bg-[#21262d] text-[#8b949e] border-[#30363d]'}`}>{signal.signal}</span>
            <span className="text-[#8b949e]">score <b className="text-[#e6edf3]">{signal.score}/8</b></span>
            <span className="text-[#8b949e]">{signal.phase} {signal.sub_phase}</span>
            <span className="text-[#8b949e]">RSI {fmtNum(signal.rsi, 0)}</span>
            <span className="text-[#8b949e]">MACDh {fmtNum(signal.macd_hist, 3)}</span>
            <span className="text-[#8b949e]">CMF {fmtNum(signal.cmf, 2)}</span>
            <span className="text-[#8b949e]">RS {fmtNum(signal.rs, 2)}</span>
            <span className="text-[#8b949e]">ATR {fmtNum(signal.atr, 2)}</span>
            {signal.entry_price != null && <span className="text-[#8b949e]">entry {fmtNum(signal.entry_price)}</span>}
            {signal.stop_loss != null && <span className="text-red-400">stop {fmtNum(signal.stop_loss)}</span>}
            {signal.reasons?.length > 0 && <span className="text-[#6e7681] italic">{signal.reasons.join('; ')}</span>}
          </div>
        )}
      </div>

      {/* ── Optimized params per regime ─────────────────────────────────── */}
      {Object.keys(params).length > 0 && (
        <div className="bg-[#161b22] border border-[#30363d] rounded p-3">
          <div className="text-[#8b949e] text-xs uppercase mb-2">Optimized params per regime</div>
          <div className="flex flex-wrap gap-3">
            {Object.entries(params).map(([reg, info]) => (
              <div key={reg} className="border border-[#30363d] rounded p-2 text-xs">
                <span className={`px-2 py-0.5 rounded-full font-bold border ${regimeStyle(reg)}`}>{reg}</span>
                <span className="ml-2 text-[#8b949e]">sharpe {fmtNum(info.sharpe, 2)}</span>
                <div className="mt-1 text-[#6e7681] max-w-md">
                  {Object.entries(info.params).slice(0, 8).map(([k, v]) => `${k}=${v}`).join('  ')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Backtest runs ───────────────────────────────────────────────── */}
      <div className="bg-[#161b22] border border-[#30363d] rounded overflow-hidden">
        <div className="text-[#8b949e] text-xs uppercase p-2 border-b border-[#30363d]">Backtest runs</div>
        <table className="w-full text-xs">
          <thead className="text-[#8b949e]">
            <tr className="border-b border-[#30363d]">
              {['Run', 'Test', 'Annual', 'Total', 'Sharpe', 'MaxDD', 'Win', 'Trades', 'Hold'].map(h => (
                <th key={h} className="text-left px-2 py-1 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runs.map(r => (
              <tr key={r.id} onClick={() => setSelectedRun(r.id)}
                className={`border-b border-[#21262d] cursor-pointer hover:bg-[#1c2128] ${
                  r.id === selectedRun ? 'bg-[#1c2128]' : ''}`}>
                <td className="px-2 py-1 text-[#8b949e]">#{r.id}</td>
                <td className="px-2 py-1 text-[#8b949e]">{r.test_start?.slice(0, 4)}–{r.test_end?.slice(0, 4)}</td>
                <td className={`px-2 py-1 tabular-nums ${pctColor(r.annual_return)}`}>{fmtFrac(r.annual_return)}</td>
                <td className={`px-2 py-1 tabular-nums ${pctColor(r.total_return)}`}>{fmtFrac(r.total_return)}</td>
                <td className="px-2 py-1 tabular-nums text-[#e6edf3]">{fmtNum(r.sharpe_ratio, 2)}</td>
                <td className="px-2 py-1 tabular-nums text-red-400">{fmtFrac(r.max_drawdown)}</td>
                <td className="px-2 py-1 tabular-nums text-[#8b949e]">{fmtFrac(r.win_rate)}</td>
                <td className="px-2 py-1 tabular-nums text-[#8b949e]">{r.total_trades ?? '—'}</td>
                <td className="px-2 py-1 tabular-nums text-[#8b949e]">{fmtNum(r.avg_hold_days, 0)}d</td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr><td colSpan={9} className="px-2 py-4 text-center text-[#6e7681]">
                No runs yet — click “Run Backtest”, or run `make backtest`.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Selected run: by-year + trades ──────────────────────────────── */}
      {selected && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bg-[#161b22] border border-[#30363d] rounded p-3">
            <div className="text-[#8b949e] text-xs uppercase mb-2">Return by year (#{selected.id})</div>
            <div className="space-y-1">
              {Object.entries(selected.by_year ?? {}).sort().map(([y, v]) => (
                <div key={y} className="flex items-center gap-2 text-xs">
                  <span className="w-10 text-[#8b949e]">{y}</span>
                  <span className={`w-16 tabular-nums text-right ${yearColor(v)}`}>{v > 0 ? '+' : ''}{v.toFixed(1)}%</span>
                  <div className="flex-1 h-3 bg-[#0d1117] rounded overflow-hidden">
                    <div className={v >= 0 ? 'h-full bg-emerald-700' : 'h-full bg-red-800'}
                      style={{ width: `${Math.min(100, Math.abs(v))}%` }} />
                  </div>
                </div>
              ))}
              {Object.keys(selected.by_year ?? {}).length === 0 &&
                <div className="text-[#6e7681] text-xs">no yearly data</div>}
            </div>
          </div>

          <div className="lg:col-span-2 bg-[#161b22] border border-[#30363d] rounded overflow-hidden">
            <div className="text-[#8b949e] text-xs uppercase p-2 border-b border-[#30363d]">
              Trades ({trades.length})
            </div>
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-xs">
                <thead className="text-[#8b949e] sticky top-0 bg-[#161b22]">
                  <tr className="border-b border-[#30363d]">
                    {['Symbol', 'Entry', 'Exit', 'Ret%', 'Hold', 'Exit', 'Regime', 'Sector'].map(h => (
                      <th key={h} className="text-left px-2 py-1 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trades.map(t => (
                    <tr key={t.id} className="border-b border-[#21262d]">
                      <td className="px-2 py-1 font-semibold text-[#e6edf3]">{t.symbol}</td>
                      <td className="px-2 py-1 text-[#8b949e]">{t.entry_date}</td>
                      <td className="px-2 py-1 text-[#8b949e]">{t.exit_date ?? '—'}</td>
                      <td className={`px-2 py-1 tabular-nums ${pctColor(t.pnl_pct)}`}>
                        {t.pnl_pct > 0 ? '+' : ''}{t.pnl_pct.toFixed(1)}%</td>
                      <td className="px-2 py-1 tabular-nums text-[#8b949e]">{t.hold_days ?? '—'}d</td>
                      <td className={`px-2 py-1 ${exitColor[t.exit_type] ?? 'text-[#8b949e]'}`}>{t.exit_type}</td>
                      <td className="px-2 py-1 text-[#8b949e]">{t.regime_at_entry}</td>
                      <td className="px-2 py-1 text-[#6e7681]">{t.ecosystem ?? t.sector}</td>
                    </tr>
                  ))}
                  {trades.length === 0 &&
                    <tr><td colSpan={8} className="px-2 py-4 text-center text-[#6e7681]">no trades</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
