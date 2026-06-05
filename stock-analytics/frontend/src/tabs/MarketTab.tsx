import { useCallback, useRef, useState, useEffect } from 'react'
import type { Exchange, SymbolRow, SymbolsPage } from '../types'
import { api, PAGE_SIZE } from '../api'
import { fmtPrice, fmtVol } from '../utils'
import { ChangePct, ExchangeBadge, Sparkline, EXCHANGES } from '../components/ui'
import { SymbolModal } from '../components/SymbolModal'

type SortKey = 'symbol' | 'close' | 'change_pct' | 'volume'

export function MarketTab() {
  const [data,     setData]     = useState<SymbolsPage | null>(null)
  const [query,    setQuery]    = useState('')
  const [exchange, setExchange] = useState<Exchange>('')
  const [offset,   setOffset]   = useState(0)
  const [detail,   setDetail]   = useState<SymbolRow | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [sortKey,  setSortKey]  = useState<SortKey>('change_pct')
  const [sortAsc,  setSortAsc]  = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback((q: string, off: number, exc: Exchange) => {
    setLoading(true)
    api.symbols(q, PAGE_SIZE, off, exc, '').then(d => { setData(d); setLoading(false) })
  }, [])

  useEffect(() => { load('', 0, '') }, [load])

  const handleSearch = (val: string) => {
    setQuery(val); setOffset(0)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => load(val, 0, exchange), 300)
  }

  const handleExchange = (exc: Exchange) => {
    setExchange(exc); setOffset(0); load(query, 0, exc)
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(key === 'symbol') }
  }

  const totalPages  = data ? Math.ceil(data.total / PAGE_SIZE) : 0
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1

  const SortTh = ({ col, label, right }: { col: SortKey; label: string; right?: boolean }) => (
    <th
      className={`px-4 py-3 font-semibold cursor-pointer select-none whitespace-nowrap
                  hover:text-[#e6edf3] transition-colors sticky top-0 z-10 bg-[#161b22]
                  ${right ? 'text-right' : 'text-left'}`}
      onClick={() => handleSort(col)}
    >
      {label}
      {sortKey === col && <span className="ml-1 text-[#58a6ff]">{sortAsc ? '↑' : '↓'}</span>}
    </th>
  )

  // Client-side sort of current page data
  const sorted = data ? [...data.items].sort((a, b) => {
    const av = a[sortKey] ?? (sortAsc ? Infinity : -Infinity)
    const bv = b[sortKey] ?? (sortAsc ? Infinity : -Infinity)
    if (typeof av === 'string' && typeof bv === 'string')
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
    return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number)
  }) : []

  return (
    <div>
      {/* Controls */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input
          type="text"
          placeholder="Search symbol or company name…"
          value={query}
          onChange={e => handleSearch(e.target.value)}
          className="bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-[#e6edf3]
                     w-72 focus:outline-none focus:border-[#58a6ff]/60 placeholder-[#8b949e] transition-colors"
        />
        <div className="flex gap-1.5">
          {EXCHANGES.map(exc => (
            <button key={exc.value} onClick={() => handleExchange(exc.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                exchange === exc.value
                  ? `${exc.color} border-current`
                  : 'bg-transparent border-[#30363d] text-[#8b949e] hover:border-[#58a6ff]/40 hover:text-[#e6edf3]'
              }`}>
              {exc.label}
            </button>
          ))}
        </div>
        {data && <span className="text-xs text-[#8b949e]">{data.total.toLocaleString()} symbols</span>}
        {loading && <span className="text-xs text-[#8b949e] animate-pulse">Loading…</span>}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-[#30363d]">
        <table className="w-full text-xs">
          <thead className="text-[#8b949e] uppercase tracking-wider text-[11px]">
            <tr>
              <SortTh col="symbol"     label="Symbol" />
              <th className="px-4 py-3 text-left font-semibold sticky top-0 z-10 bg-[#161b22]">Company</th>
              <SortTh col="close"      label="Close (K₫)" right />
              <SortTh col="change_pct" label="Change"     right />
              <SortTh col="volume"     label="Volume"     right />
              <th className="px-4 py-3 text-center font-semibold sticky top-0 z-10 bg-[#161b22]">Trend</th>
              <th className="px-4 py-3 text-left font-semibold sticky top-0 z-10 bg-[#161b22]">Date</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && !loading && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-[#8b949e]">No symbols found</td></tr>
            )}
            {sorted.map((row, idx) => (
              <tr key={row.symbol}
                  className={`border-t border-[#30363d]/50 cursor-pointer transition-all
                    hover:bg-[#21262d] hover:ring-1 hover:ring-inset hover:ring-[#58a6ff]/20
                    ${idx % 2 === 0 ? '' : 'bg-[#161b22]/30'}`}
                  onClick={() => setDetail(row)}>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-emerald-400 tracking-wide">{row.symbol}</span>
                    <ExchangeBadge exchange={row.exchange} />
                  </div>
                </td>
                <td className="px-4 py-2.5 max-w-[220px]">
                  <span className="text-[#e6edf3] truncate block" title={row.name}>{row.name}</span>
                </td>
                <td className="px-4 py-2.5 text-right font-medium text-[#e6edf3] tabular-nums">
                  {fmtPrice(row.close)}
                </td>
                <td className="px-4 py-2.5 text-right"><ChangePct v={row.change_pct} /></td>
                <td className="px-4 py-2.5 text-right text-[#8b949e] tabular-nums">{fmtVol(row.volume)}</td>
                <td className="px-4 py-2.5 text-center">
                  {row.close != null
                    ? <Sparkline prices={[row.prev_close ?? row.close, row.close]} />
                    : <span className="text-[#8b949e]">—</span>}
                </td>
                <td className="px-4 py-2.5 text-[#8b949e] whitespace-nowrap">{row.latest_date ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3 text-xs text-[#8b949e]">
          <span>Page {currentPage} of {totalPages}</span>
          <div className="flex gap-1.5">
            <button disabled={offset === 0}
              onClick={() => { const o = Math.max(0, offset - PAGE_SIZE); setOffset(o); load(query, o, exchange) }}
              className="px-3 py-1.5 rounded-lg bg-[#21262d] border border-[#30363d] hover:border-[#58a6ff]/40
                         hover:text-[#e6edf3] disabled:opacity-40 disabled:cursor-not-allowed transition-all">
              ← Prev
            </button>
            <button disabled={offset + PAGE_SIZE >= (data?.total ?? 0)}
              onClick={() => { const o = offset + PAGE_SIZE; setOffset(o); load(query, o, exchange) }}
              className="px-3 py-1.5 rounded-lg bg-[#21262d] border border-[#30363d] hover:border-[#58a6ff]/40
                         hover:text-[#e6edf3] disabled:opacity-40 disabled:cursor-not-allowed transition-all">
              Next →
            </button>
          </div>
        </div>
      )}

      {detail && (
        <SymbolModal symbol={detail.symbol} name={detail.name} onClose={() => setDetail(null)} />
      )}
    </div>
  )
}
