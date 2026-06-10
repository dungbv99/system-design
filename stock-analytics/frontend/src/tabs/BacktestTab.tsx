import { useState } from 'react'
import type { BacktestResult, BacktestResponse } from '../types'
import { api } from '../api'
import { fmtPrice } from '../utils'

// ── Helpers ───────────────────────────────────────────────────────────────────

const REASON_LABEL: Record<string, string> = {
  stop:         '✕ Stop',
  target:       '✓ Target',
  timeout:      '⏱ Timeout',
  end_of_data:  '— End',
}

const REASON_COLOR: Record<string, string> = {
  stop:         'text-red-400',
  target:       'text-emerald-400',
  timeout:      'text-amber-400',
  end_of_data:  'text-[#8b949e]',
}

function fmt(v: number | null | undefined, suffix = '%', decimals = 1): string {
  if (v == null) return '—'
  const s = Math.abs(v).toFixed(decimals)
  return (v >= 0 ? '+' : '−') + s + suffix
}

// ── Mini equity curve (SVG polyline) ─────────────────────────────────────────

function EquityCurve({ curve }: { curve: number[] }) {
  if (curve.length < 2) return (
    <div className="text-xs text-[#8b949e] py-4 text-center">No trades</div>
  )

  const W = 520
  const H = 120
  const pad = 8
  const min = Math.min(0, ...curve)
  const max = Math.max(0, ...curve)
  const range = max - min || 1

  const xs = curve.map((_, i) => pad + (i / (curve.length - 1)) * (W - pad * 2))
  const ys = curve.map(v => H - pad - ((v - min) / range) * (H - pad * 2))

  const pts = xs.map((x, i) => `${x},${ys[i]}`).join(' ')

  // Zero line
  const zeroY = H - pad - ((0 - min) / range) * (H - pad * 2)
  const lastV = curve[curve.length - 1]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
      {/* zero line */}
      <line x1={pad} y1={zeroY} x2={W - pad} y2={zeroY}
        stroke="#30363d" strokeWidth="1" strokeDasharray="3 3" />
      {/* equity polyline */}
      <polyline points={pts} fill="none"
        stroke={lastV >= 0 ? '#34d399' : '#f87171'} strokeWidth="2" />
      {/* dots at first and last */}
      <circle cx={xs[0]}             cy={ys[0]}             r="3" fill="#8b949e" />
      <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r="3"
        fill={lastV >= 0 ? '#34d399' : '#f87171'} />
    </svg>
  )
}

// ── Summary stat card ─────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: {
  label: string; value: string; sub?: string; color?: string
}) {
  return (
    <div className="bg-[#0d1117] border border-[#30363d] rounded-lg p-3 text-center">
      <div className={`text-base font-bold tabular-nums ${color ?? 'text-[#e6edf3]'}`}>{value}</div>
      <div className="text-[11px] text-[#8b949e]">{label}</div>
      {sub && <div className="text-[10px] text-[#8b949e]/60 mt-0.5">{sub}</div>}
    </div>
  )
}

// ── Result panel (one strategy) ───────────────────────────────────────────────

function ResultPanel({ result, title }: { result: BacktestResult; title: string }) {
  const [showAll, setShowAll] = useState(false)
  const trades = showAll ? result.trades : result.trades.slice(0, 20)

  const winColor     = result.win_rate >= 55 ? 'text-emerald-400'
                     : result.win_rate >= 45 ? 'text-amber-400' : 'text-red-400'
  const returnColor  = result.total_return_pct >= 0 ? 'text-emerald-400' : 'text-red-400'
  const avgColor     = result.avg_return_pct   >= 0 ? 'text-emerald-400' : 'text-red-400'

  return (
    <div className="space-y-4">
      {/* Title + bars */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-[#e6edf3]">{title}</span>
        <span className="text-xs text-[#8b949e]">{result.bars_analyzed} bars analyzed</span>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        <StatCard label="Total Trades"  value={String(result.total_trades)} />
        <StatCard label="Win Rate"      value={`${result.win_rate}%`}
          sub={`${result.winning_trades}W / ${result.total_trades - result.winning_trades}L`}
          color={winColor} />
        <StatCard label="Avg Return"    value={fmt(result.avg_return_pct)}   color={avgColor} />
        <StatCard label="Median"        value={fmt(result.median_return_pct)} />
        <StatCard label="Best Trade"    value={fmt(result.best_trade_pct)}   color="text-emerald-400" />
        <StatCard label="Worst Trade"   value={fmt(result.worst_trade_pct)}  color="text-red-400" />
        <StatCard label="Total Return"  value={fmt(result.total_return_pct)} color={returnColor} />
        <StatCard label="Max Drawdown"  value={fmt(result.max_drawdown_pct, '%', 1)}
          color="text-red-400" />
      </div>

      {/* Secondary stats */}
      <div className="flex gap-4 text-xs text-[#8b949e] flex-wrap">
        <span>BUY trades: <span className="text-emerald-400 font-semibold">{result.buy_trades}</span></span>
        <span>SHORT trades: <span className="text-red-400 font-semibold">{result.short_trades}</span></span>
        <span>Avg hold: <span className="text-[#e6edf3]">{result.avg_holding_days}d</span></span>
      </div>

      {/* Equity curve */}
      <div className="bg-[#0d1117] border border-[#30363d] rounded-lg p-3">
        <div className="text-[11px] text-[#8b949e] font-semibold mb-2 uppercase tracking-wider">
          Cumulative P&L (% sum per trade)
        </div>
        <EquityCurve curve={result.equity_curve} />
      </div>

      {/* Trade table */}
      <div className="overflow-x-auto rounded-lg border border-[#30363d]">
        <table className="w-full text-xs">
          <thead className="text-[#8b949e] uppercase tracking-wider text-[11px]">
            <tr>
              <th className="px-3 py-2 text-left bg-[#161b22] sticky top-0">#</th>
              <th className="px-3 py-2 text-left bg-[#161b22] sticky top-0">Signal</th>
              <th className="px-3 py-2 text-left bg-[#161b22] sticky top-0">Event</th>
              <th className="px-3 py-2 text-left bg-[#161b22] sticky top-0">Phase</th>
              <th className="px-3 py-2 text-right bg-[#161b22] sticky top-0">Entry</th>
              <th className="px-3 py-2 text-right bg-[#161b22] sticky top-0">Stop</th>
              <th className="px-3 py-2 text-right bg-[#161b22] sticky top-0">Target</th>
              <th className="px-3 py-2 text-right bg-[#161b22] sticky top-0">Exit</th>
              <th className="px-3 py-2 text-left  bg-[#161b22] sticky top-0">Reason</th>
              <th className="px-3 py-2 text-right bg-[#161b22] sticky top-0">Return</th>
              <th className="px-3 py-2 text-right bg-[#161b22] sticky top-0">Hold</th>
              <th className="px-3 py-2 text-left  bg-[#161b22] sticky top-0">Entry Date</th>
              <th className="px-3 py-2 text-left  bg-[#161b22] sticky top-0">Exit Date</th>
            </tr>
          </thead>
          <tbody>
            {result.total_trades === 0 && (
              <tr>
                <td colSpan={13} className="px-4 py-8 text-center text-[#8b949e]">
                  No trades detected
                </td>
              </tr>
            )}
            {trades.map((t, i) => {
              const win = t.return_pct > 0
              return (
                <tr key={i}
                  className={`border-t border-[#30363d]/50 ${i % 2 === 0 ? '' : 'bg-[#161b22]/30'}`}
                  style={{ borderLeft: `3px solid ${win ? '#34d399' : '#f87171'}` }}>
                  <td className="px-3 py-2 text-[#8b949e]">{i + 1}</td>
                  <td className="px-3 py-2">
                    <span className={`font-bold text-xs px-1.5 py-0.5 rounded border ${
                      t.signal === 'BUY'
                        ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                        : 'bg-red-950 text-red-300 border-red-700'
                    }`}>{t.signal}</span>
                  </td>
                  <td className="px-3 py-2 text-amber-400 font-medium">
                    {t.event ?? <span className="text-[#8b949e]">—</span>}
                  </td>
                  <td className="px-3 py-2 text-[#8b949e]">
                    {t.phase}{t.sub_phase !== '-' ? `·${t.sub_phase}` : ''}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-[#e6edf3]">
                    {fmtPrice(t.entry_price)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-red-400/80">
                    {fmtPrice(t.stop_loss)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-400/80">
                    {fmtPrice(t.target)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-[#e6edf3]">
                    {fmtPrice(t.exit_price)}
                  </td>
                  <td className={`px-3 py-2 text-[11px] font-medium ${REASON_COLOR[t.exit_reason] ?? ''}`}>
                    {REASON_LABEL[t.exit_reason] ?? t.exit_reason}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums font-bold ${win ? 'text-emerald-400' : 'text-red-400'}`}>
                    {fmt(t.return_pct)}
                  </td>
                  <td className="px-3 py-2 text-right text-[#8b949e] tabular-nums">{t.holding_days}d</td>
                  <td className="px-3 py-2 text-[#8b949e] whitespace-nowrap">{t.entry_date}</td>
                  <td className="px-3 py-2 text-[#8b949e] whitespace-nowrap">{t.exit_date}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {result.total_trades > 20 && (
        <button
          onClick={() => setShowAll(s => !s)}
          className="text-xs text-[#58a6ff] hover:underline">
          {showAll ? 'Show fewer' : `Show all ${result.total_trades} trades`}
        </button>
      )}
    </div>
  )
}

// ── Main tab ──────────────────────────────────────────────────────────────────

export function BacktestTab() {
  const [symbol,    setSymbol]    = useState('')
  const [input,     setInput]     = useState('')
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [result,    setResult]    = useState<BacktestResponse | null>(null)
  const [horizon,   setHorizon]   = useState(20)
  const [maxHold,   setMaxHold]   = useState(60)
  const [activeTab, setActiveTab] = useState<'signal_replay' | 'event_trades'>('signal_replay')

  const handleRun = async () => {
    const sym = input.trim().toUpperCase()
    if (!sym) return
    setLoading(true)
    setError(null)
    setResult(null)
    setSymbol(sym)
    try {
      const r = await api.backtest(sym, 'both', horizon, maxHold)
      setResult(r)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const sr = result?.signal_replay
  const et = result?.event_trades

  return (
    <div className="space-y-5">

      {/* ── Controls ─────────────────────────────────────────────────────── */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5 space-y-4">
        <div className="text-sm font-bold text-[#e6edf3]">Walk-forward Wyckoff Backtest</div>
        <div className="text-xs text-[#8b949e] leading-relaxed">
          Runs two strategies on full price history.
          <span className="text-cyan-400 font-semibold"> Signal replay</span> enters on BUY/SHORT signal transitions.
          <span className="text-amber-400 font-semibold"> Event trades</span> enters on each Spring / LPS / UTAD / LPSY event.
        </div>

        <div className="flex gap-3 flex-wrap items-end">
          {/* Symbol input */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-[#8b949e] uppercase tracking-wider">Symbol</label>
            <input
              value={input}
              onChange={e => setInput(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && handleRun()}
              placeholder="e.g. STB"
              className="bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm
                         text-[#e6edf3] placeholder-[#8b949e]/50 focus:outline-none
                         focus:border-[#58a6ff]/60 w-28"
            />
          </div>

          {/* Signal replay horizon */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-[#8b949e] uppercase tracking-wider">
              Signal hold (bars)
            </label>
            <input
              type="number" min={5} max={120} value={horizon}
              onChange={e => setHorizon(Number(e.target.value))}
              className="bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm
                         text-[#e6edf3] focus:outline-none focus:border-[#58a6ff]/60 w-20"
            />
          </div>

          {/* Event trades max hold */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-[#8b949e] uppercase tracking-wider">
              Event hold (bars)
            </label>
            <input
              type="number" min={5} max={240} value={maxHold}
              onChange={e => setMaxHold(Number(e.target.value))}
              className="bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm
                         text-[#e6edf3] focus:outline-none focus:border-[#58a6ff]/60 w-20"
            />
          </div>

          {/* Run button */}
          <button
            onClick={handleRun}
            disabled={loading || !input.trim()}
            className={`px-5 py-2 rounded-lg text-sm font-bold border transition-all
              ${loading
                ? 'bg-cyan-950 border-cyan-700 text-cyan-300 animate-pulse cursor-not-allowed'
                : 'bg-[#58a6ff] hover:bg-[#79b8ff] border-transparent text-[#0d1117]'
              } disabled:opacity-50`}>
            {loading ? '⏳ Computing…' : '▶ Run Backtest'}
          </button>
        </div>

        {loading && (
          <div className="text-xs text-[#8b949e] animate-pulse">
            Walk-forward analysis in progress — may take 5–20s for long histories…
          </div>
        )}
        {error && (
          <div className="text-xs text-red-400 bg-red-950/30 border border-red-800 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
      </div>

      {/* ── Results ──────────────────────────────────────────────────────── */}
      {result && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-[#e6edf3]">{symbol} — Backtest Results</span>
            <div className="flex gap-1">
              {(['signal_replay', 'event_trades'] as const).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                    ${activeTab === tab
                      ? 'bg-[#21262d] border-[#58a6ff] text-[#58a6ff]'
                      : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3]'}`}>
                  {tab === 'signal_replay' ? '〜 Signal Replay' : '⚡ Event Trades'}
                </button>
              ))}
            </div>
          </div>

          {activeTab === 'signal_replay' && sr && (
            <ResultPanel result={sr} title="Signal Replay — enters on BUY/SHORT signal transition" />
          )}
          {activeTab === 'event_trades' && et && (
            <ResultPanel result={et} title="Event Trades — enters on Spring / LPS / UTAD / LPSY" />
          )}

          <p className="text-xs text-[#8b949e]/40 text-right">
            Walk-forward backtest · no look-ahead bias · results are illustrative, not financial advice
          </p>
        </div>
      )}
    </div>
  )
}
