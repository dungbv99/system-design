import { useCallback, useEffect, useState } from 'react'
import type { PortfolioPage } from '../types'
import { api } from '../api'
import { fmtPrice } from '../utils'
import { ExchangeBadge } from '../components/ui'
import { SymbolModal } from '../components/SymbolModal'

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtVnd = (v: number) =>
  v.toLocaleString('vi-VN', { maximumFractionDigits: 0 })

function PL({ value, pct }: { value: number; pct: number }) {
  const up = value >= 0
  return (
    <span className={`font-bold tabular-nums ${up ? 'text-emerald-300' : 'text-red-300'}`}>
      {up ? '+' : '−'}{fmtVnd(Math.abs(value))}₫
      <span className="ml-1 text-[11px] opacity-80">({up ? '+' : ''}{pct.toFixed(2)}%)</span>
    </span>
  )
}

const FILTERS = ['ALL', 'OPEN', 'CLOSED'] as const
type Filter = typeof FILTERS[number]

// ── Main tab ──────────────────────────────────────────────────────────────────

export function PortfolioTab() {
  const [data,    setData]    = useState<PortfolioPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter,  setFilter]  = useState<Filter>('ALL')
  const [busy,    setBusy]    = useState<number | null>(null)
  const [detail,  setDetail]  = useState<{ symbol: string; name: string } | null>(null)

  const load = useCallback(async (f: Filter) => {
    setLoading(true)
    try {
      setData(await api.portfolio(f === 'ALL' ? '' : f))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(filter) }, [load, filter])

  const handleClose = async (id: number) => {
    setBusy(id)
    try { await api.closeTrade(id); await load(filter) }
    finally { setBusy(null) }
  }
  const handleDelete = async (id: number) => {
    if (!confirm('Remove this paper trade?')) return
    setBusy(id)
    try { await api.deleteTrade(id); await load(filter) }
    finally { setBusy(null) }
  }

  const s = data?.summary

  return (
    <div className="space-y-4">

      {/* ── Summary cards ─────────────────────────────────────────────────── */}
      <div className="flex gap-3 flex-wrap">
        <div className="flex-1 min-w-[140px] rounded-xl p-3 border-2 bg-[#161b22] border-[#30363d]">
          <div className="text-lg font-bold tabular-nums text-[#e6edf3]">{s ? fmtVnd(s.cost) : '—'}₫</div>
          <div className="text-xs mt-0.5 text-[#8b949e]">Invested (open)</div>
        </div>
        <div className="flex-1 min-w-[140px] rounded-xl p-3 border-2 bg-[#161b22] border-[#30363d]">
          <div className="text-lg font-bold tabular-nums text-[#e6edf3]">{s ? fmtVnd(s.market_value) : '—'}₫</div>
          <div className="text-xs mt-0.5 text-[#8b949e]">Market value (open)</div>
        </div>
        <div className={`flex-1 min-w-[140px] rounded-xl p-3 border-2 bg-[#161b22] ${
          s && s.pl >= 0 ? 'border-emerald-700' : s ? 'border-red-700' : 'border-[#30363d]'}`}>
          <div className="text-lg">{s ? <PL value={s.pl} pct={s.pl_pct} /> : <span className="text-[#8b949e]">—</span>}</div>
          <div className="text-xs mt-0.5 text-[#8b949e]">Unrealised P/L (open)</div>
        </div>
        <div className="flex-1 min-w-[120px] rounded-xl p-3 border-2 bg-[#161b22] border-[#30363d]">
          <div className="text-lg font-bold tabular-nums text-[#e6edf3]">
            {s ? s.open_count : '—'}<span className="text-[#8b949e] text-sm"> open</span>
            <span className="text-[#8b949e] text-sm"> · {s ? s.closed_count : '—'} closed</span>
          </div>
          <div className="text-xs mt-0.5 text-[#8b949e]">Positions</div>
        </div>
      </div>

      {/* ── Filter bar ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1">
          {FILTERS.map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                ${filter === f
                  ? 'bg-[#21262d] border-[#58a6ff] text-[#58a6ff]'
                  : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] hover:border-[#8b949e]/50'}`}>
              {f}
            </button>
          ))}
        </div>
        <button onClick={() => load(filter)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[#30363d] text-[#8b949e]
                     hover:text-[#e6edf3] hover:border-[#58a6ff]/50 transition-all">
          ⟳ Refresh
        </button>
        {data && <span className="text-xs text-[#8b949e] ml-auto">{data.items.length} trades</span>}
      </div>

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      {loading && (
        <div className="text-center py-12 text-[#8b949e] text-sm animate-pulse">Loading portfolio…</div>
      )}

      {!loading && data && (
        <div className="overflow-x-auto rounded-lg border border-[#30363d]">
          <table className="w-full text-xs">
            <thead className="text-[#8b949e] uppercase tracking-wider text-[11px]">
              <tr>
                <th className="px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22]">Symbol</th>
                <th className="px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]">Exch</th>
                <th className="px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]">Status</th>
                <th className="px-3 py-3 text-left   font-semibold sticky top-0 z-10 bg-[#161b22]">Buy Date</th>
                <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]">Buy (K₫)</th>
                <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]">Qty</th>
                <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]">Now / Close</th>
                <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]">P/L</th>
                <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22] text-red-400">Stop</th>
                <th className="px-3 py-3 text-right  font-semibold sticky top-0 z-10 bg-[#161b22]">Target</th>
                <th className="px-3 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-[#8b949e]">
                    No paper trades yet. Open a symbol and click <span className="text-emerald-300">▸ Assume Buy</span>,
                    or use the Buy button on the Buy Now tab.
                  </td>
                </tr>
              )}
              {data.items.map((t, i) => {
                const closed = t.status === 'CLOSED'
                return (
                  <tr
                    key={t.id}
                    className={`border-t border-[#30363d]/50 cursor-pointer transition-all
                      hover:bg-[#21262d] hover:ring-1 hover:ring-inset hover:ring-[#58a6ff]/20
                      ${i % 2 === 0 ? '' : 'bg-[#161b22]/30'}`}
                    style={{ borderLeft: `4px solid ${t.pl >= 0 ? '#34d399' : '#f87171'}` }}
                    onClick={() => setDetail({ symbol: t.symbol, name: t.name ?? t.symbol })}
                  >
                    <td className="px-3 py-2.5">
                      <span className="font-bold text-emerald-400 tracking-wide">{t.symbol}</span>
                      <div className="text-[#8b949e] truncate max-w-[130px] text-[11px]" title={t.name}>{t.name ?? ''}</div>
                    </td>
                    <td className="px-3 py-2.5 text-center"><ExchangeBadge exchange={t.exchange ?? ''} /></td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-bold border ${
                        closed ? 'bg-[#21262d] text-[#8b949e] border-[#30363d]'
                               : 'bg-emerald-950 text-emerald-300 border-emerald-700'}`}>
                        {t.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-[#8b949e] tabular-nums">{t.buy_date}</td>
                    <td className="px-3 py-2.5 text-right font-medium text-[#e6edf3] tabular-nums">{fmtPrice(t.buy_price)}</td>
                    <td className="px-3 py-2.5 text-right text-[#8b949e] tabular-nums">{t.quantity.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[#e6edf3]">
                      {t.current_price != null ? fmtPrice(t.current_price) : '—'}
                      {closed && <span className="text-[#8b949e] text-[10px] block">@ close</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right"><PL value={t.pl} pct={t.pl_pct} /></td>
                    <td className="px-3 py-2.5 text-right text-red-400/80 tabular-nums">
                      {t.stop_loss != null ? fmtPrice(t.stop_loss) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right text-[#8b949e] tabular-nums">
                      {t.target != null ? fmtPrice(t.target) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-center whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      {!closed && (
                        <button
                          onClick={() => handleClose(t.id)}
                          disabled={busy === t.id}
                          className="px-2 py-1 rounded border border-[#30363d] text-[#8b949e] text-[11px]
                                     hover:border-amber-600 hover:text-amber-300 transition-all disabled:opacity-40 mr-1">
                          {busy === t.id ? '…' : 'Close'}
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(t.id)}
                        disabled={busy === t.id}
                        className="px-2 py-1 rounded border border-[#30363d] text-[#8b949e] text-[11px]
                                   hover:border-red-600 hover:text-red-300 transition-all disabled:opacity-40">
                        ✕
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-[#8b949e]/40 text-right">
        Paper trades — assumed buys at market close · prices update with the daily crawl · not financial advice
      </p>

      {detail && (
        <SymbolModal symbol={detail.symbol} name={detail.name} onClose={() => setDetail(null)} />
      )}
    </div>
  )
}
