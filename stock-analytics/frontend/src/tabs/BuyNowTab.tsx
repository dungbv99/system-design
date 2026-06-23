import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { fmtPrice } from '../utils'
import { ExchangeBadge } from '../components/ui'
import { SymbolModal } from '../components/SymbolModal'

// ── Types ───────────────────────────────────────────────────────────────────

interface BuyRow {
  symbol: string
  name: string | null
  exchange: string | null
  signal: string            // BUY | HOLD
  score: number
  phase: string
  sub_phase: string
  current_price: number | null
  entry_price: number | null
  stop_loss: number | null
  resistance: number | null
  rsi: number | null
  rs: number | null
  atr: number | null
  gap_pct: number | null
  rr: number | null
  description: string
}

interface BuyNowResp {
  regime: string
  min_score: number
  buyable: BuyRow[]
  watch: BuyRow[]
}

const PHASE_COLOR: Record<string, string> = {
  Accumulation: 'text-cyan-400',
  Markup:       'text-emerald-400',
  Distribution: 'text-orange-400',
  Markdown:     'text-red-400',
  Unknown:      'text-[#8b949e]',
}

const regimeStyle = (r: string): string =>
  r === 'UPTREND'   ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
  : r === 'DOWNTREND' ? 'bg-red-950 text-red-300 border-red-700'
  : 'bg-amber-950 text-amber-300 border-amber-700'

function SignalBadge({ signal }: { signal: string }) {
  // BUY = Wyckoff accumulation breakout; HOLD = established Markup uptrend
  const buy = signal === 'BUY'
  return (
    <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded border ${
      buy ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
          : 'bg-cyan-950 text-cyan-300 border-cyan-700'}`}>
      {buy ? 'BUY' : 'UPTREND'}
    </span>
  )
}

function ScoreDot({ score, min }: { score: number; min: number }) {
  const ok = score >= min
  return (
    <span className={`font-bold tabular-nums ${ok ? 'text-emerald-300' : 'text-amber-300'}`}>
      {score}/8
    </span>
  )
}

// ── Rows table ──────────────────────────────────────────────────────────────

function BuyTable({ rows, min, onPick }: {
  rows: BuyRow[]; min: number; onPick: (r: BuyRow) => void
}) {
  if (rows.length === 0)
    return <div className="px-4 py-8 text-center text-[#6e7681] text-sm">No symbols here right now.</div>

  return (
    <div className="overflow-x-auto rounded-lg border border-[#30363d]">
      <table className="w-full text-xs">
        <thead className="text-[#8b949e] uppercase tracking-wider text-[11px]">
          <tr>
            {['Symbol', 'Company', 'Exch', 'Signal', 'Phase', 'Score', 'Price (K₫)',
              'Entry', 'Gap', 'Stop', 'Target', 'R:R'].map(h => (
              <th key={h} className="px-3 py-3 text-left font-semibold sticky top-0 bg-[#161b22]">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.symbol}
              className={`border-t border-[#30363d]/50 cursor-pointer hover:bg-[#21262d] ${i % 2 ? 'bg-[#161b22]/30' : ''}`}
              onClick={() => onPick(r)}>
              <td className="px-3 py-2.5 font-bold text-emerald-400 tracking-wide">{r.symbol}</td>
              <td className="px-3 py-2.5 max-w-[150px]"><span className="text-[#e6edf3] truncate block" title={r.name ?? ''}>{r.name ?? '—'}</span></td>
              <td className="px-3 py-2.5"><ExchangeBadge exchange={r.exchange ?? ''} /></td>
              <td className="px-3 py-2.5"><SignalBadge signal={r.signal} /></td>
              <td className={`px-3 py-2.5 font-semibold ${PHASE_COLOR[r.phase] ?? 'text-[#8b949e]'}`}>
                {r.phase}{r.sub_phase && r.sub_phase !== '-' ? `·${r.sub_phase}` : ''}
              </td>
              <td className="px-3 py-2.5"><ScoreDot score={r.score} min={min} /></td>
              <td className="px-3 py-2.5 text-right tabular-nums text-[#e6edf3]">{r.current_price != null ? fmtPrice(r.current_price) : '—'}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-emerald-300">{r.entry_price != null ? fmtPrice(r.entry_price) : '—'}</td>
              <td className={`px-3 py-2.5 text-right tabular-nums ${r.gap_pct != null && r.gap_pct <= 0 ? 'text-emerald-300' : 'text-amber-300'}`}>
                {r.gap_pct != null ? `${r.gap_pct > 0 ? '+' : ''}${r.gap_pct.toFixed(1)}%` : '—'}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-red-300/90">{r.stop_loss != null ? fmtPrice(r.stop_loss) : '—'}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-red-400/80">{r.resistance != null ? fmtPrice(r.resistance) : '—'}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">
                {r.rr != null ? <span className={`font-bold ${r.rr >= 2 ? 'text-emerald-300' : 'text-[#8b949e]'}`}>1:{r.rr.toFixed(1)}</span> : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Main tab ──────────────────────────────────────────────────────────────────

export function BuyNowTab() {
  const [data, setData]       = useState<BuyNowResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [detail, setDetail]   = useState<{ symbol: string; name: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { setData(await api.buyNow()) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const pick = (r: BuyRow) => setDetail({ symbol: r.symbol, name: r.name ?? r.symbol })

  return (
    <div className="p-4 space-y-5">
      {/* Heading */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-bold text-emerald-400">🎯 Buy Now</h2>
          <p className="text-xs text-[#8b949e] mt-1 max-w-2xl">
            Mã mà <span className="text-emerald-300 font-semibold">mô hình Wyckoff tối ưu</span> sẽ vào lệnh —
            gồm breakout tích lũy (BUY) và xu hướng tăng đã xác nhận (UPTREND/HOLD).
            {data && <> Regime hiện tại: <span className={`px-1.5 py-0.5 rounded border ${regimeStyle(data.regime)}`}>{data.regime}</span>
              {' '}· ngưỡng điểm ≥ <span className="text-emerald-300 font-semibold">{data.min_score}</span></>}
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className={`self-start px-4 py-2 rounded-lg text-xs font-bold border transition-all ${
            loading ? 'bg-cyan-950 border-cyan-700 text-cyan-300 animate-pulse cursor-not-allowed'
                    : 'bg-[#21262d] border-[#30363d] text-[#8b949e] hover:border-[#58a6ff]/50 hover:text-[#e6edf3]'}`}>
          {loading ? '⏳ Đang quét VN100…' : '⟳ Quét lại'}
        </button>
      </div>

      {loading && <div className="text-center py-12 text-[#8b949e] text-sm animate-pulse">Đang quét 100 mã VN100 theo mô hình hiện tại…</div>}

      {!loading && data && (
        <>
          {/* Buyable now */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-emerald-300">🎯 Mua được ngay</h3>
              <span className="text-xs text-[#8b949e]">({data.buyable.length}) — đủ điều kiện vào lệnh: score ≥ {data.min_score}</span>
            </div>
            <BuyTable rows={data.buyable} min={data.min_score} onPick={pick} />
          </div>

          {/* Approaching */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-amber-300">👀 Sắp mua</h3>
              <span className="text-xs text-[#8b949e]">({data.watch.length}) — còn 1-2 xác nhận (score {data.min_score - 2}–{data.min_score - 1})</span>
            </div>
            <BuyTable rows={data.watch} min={data.min_score} onPick={pick} />
          </div>

          <p className="text-xs text-[#8b949e]/40 text-right">
            Quét trực tiếp VN100 bằng params tối ưu của regime hiện tại · không phải khuyến nghị đầu tư
          </p>
        </>
      )}

      {detail && <SymbolModal symbol={detail.symbol} name={detail.name} onClose={() => setDetail(null)} />}
    </div>
  )
}
