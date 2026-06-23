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
  skip_reasons?: string[]
}

interface BuyNowResp {
  regime: string
  min_score: number
  universe?: string
  scanned?: number
  max_gap?: number
  rsi_max?: number
  buyable: BuyRow[]
  extended?: BuyRow[]
  watch: BuyRow[]
}

type Universe = 'vn100' | 'all'
const GAP_CHOICES = [3, 5, 7, 10] as const

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

function rsiColor(v: number | null): string {
  if (v == null) return 'text-[#8b949e]'
  if (v > 80) return 'text-red-400 font-bold'
  if (v > 70) return 'text-amber-300'
  return 'text-[#e6edf3]'
}

function BuyTable({ rows, min, onPick, gapLimit, showReasons }: {
  rows: BuyRow[]; min: number; onPick: (r: BuyRow) => void
  gapLimit?: number; showReasons?: boolean
}) {
  if (rows.length === 0)
    return <div className="px-4 py-8 text-center text-[#6e7681] text-sm">No symbols here right now.</div>

  const headers = ['Symbol', 'Company', 'Exch', 'Signal', 'Phase', 'Score', 'RSI', 'Price (K₫)',
    'Entry MA20', 'Gap', 'Stop', 'Target', 'R:R']
  if (showReasons) headers.push('Lý do chờ')

  // a gap is "good" (at the dip) when within the buy threshold
  const gapOk = (g: number | null) => g != null && (gapLimit == null ? g <= 0 : g <= gapLimit)

  return (
    <div className="overflow-x-auto rounded-lg border border-[#30363d]">
      <table className="w-full text-xs">
        <thead className="text-[#8b949e] uppercase tracking-wider text-[11px]">
          <tr>
            {headers.map(h => (
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
              <td className={`px-3 py-2.5 text-right tabular-nums ${rsiColor(r.rsi)}`}>{r.rsi != null ? r.rsi.toFixed(0) : '—'}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-[#e6edf3]">{r.current_price != null ? fmtPrice(r.current_price) : '—'}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-emerald-300">{r.entry_price != null ? fmtPrice(r.entry_price) : '—'}</td>
              <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${gapOk(r.gap_pct) ? 'text-emerald-300' : 'text-amber-300'}`}>
                {r.gap_pct != null ? `${r.gap_pct > 0 ? '+' : ''}${r.gap_pct.toFixed(1)}%` : '—'}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-red-300/90">{r.stop_loss != null ? fmtPrice(r.stop_loss) : '—'}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-red-400/80">{r.resistance != null ? fmtPrice(r.resistance) : '—'}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">
                {r.rr != null ? <span className={`font-bold ${r.rr >= 2 ? 'text-emerald-300' : 'text-[#8b949e]'}`}>1:{r.rr.toFixed(1)}</span> : '—'}
              </td>
              {showReasons && (
                <td className="px-3 py-2.5 text-amber-300/80 text-[11px] max-w-[220px]">
                  {r.skip_reasons?.join(' · ') || '—'}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Main tab ──────────────────────────────────────────────────────────────────

// Poll the crawl status until it stops running (or a safety timeout fires).
async function waitForCrawl(maxMs = 180_000): Promise<void> {
  const t0 = Date.now()
  // give the backend a beat to flip `running` true before we start polling
  await new Promise(res => setTimeout(res, 1500))
  while (Date.now() - t0 < maxMs) {
    try {
      const s = await api.status()
      if (!s.running) return
    } catch { /* backend busy — keep waiting */ }
    await new Promise(res => setTimeout(res, 2000))
  }
}

export function BuyNowTab() {
  const [data, setData]       = useState<BuyNowResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [phase, setPhase]     = useState('')   // status line while the button works
  const [universe, setUniverse] = useState<Universe>('all')
  const [maxGap, setMaxGap]   = useState<number>(5)   // max % above MA20 to count as "buyable now"
  const [detail, setDetail]   = useState<{ symbol: string; name: string } | null>(null)

  // Rescan only — recompute the model on prices already in the DB (fast).
  const load = useCallback(async (u: Universe, gap: number) => {
    setLoading(true); setPhase('Đang quét theo mô hình hiện tại…')
    try { setData(await api.buyNow(u, gap)) }
    finally { setLoading(false); setPhase('') }
  }, [])

  // Update prices first (crawl from Fireant), wait for it, then rescan.
  const refreshAndScan = useCallback(async (u: Universe, gap: number) => {
    setLoading(true)
    try {
      setPhase('① Đang cập nhật giá mới nhất từ Fireant…')
      try { await api.triggerUpdate() }
      catch (e) {
        // 409 = a crawl is already running; just wait for it to finish.
        if (!String(e).includes('already running')) throw e
      }
      setPhase('② Đang chờ crawl giá hoàn tất…')
      await waitForCrawl()
      setPhase('③ Đang tính lại tín hiệu mua…')
      setData(await api.buyNow(u, gap))
    } catch (e) {
      setPhase(`Lỗi: ${String(e)}`)
      return
    } finally {
      setLoading(false)
    }
    setPhase('')
  }, [])

  useEffect(() => { void load(universe, maxGap) }, [load, universe, maxGap])

  const pick = (r: BuyRow) => setDetail({ symbol: r.symbol, name: r.name ?? r.symbol })

  const uniLabel = universe === 'all' ? 'toàn bộ mã' : 'VN100'

  return (
    <div className="p-4 space-y-5">
      {/* Heading */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-bold text-emerald-400">🎯 Buy Now</h2>
          <p className="text-xs text-[#8b949e] mt-1 max-w-2xl">
            Chỉ những mã mà <span className="text-emerald-300 font-semibold">mô hình Wyckoff tối ưu</span> sẽ
            <span className="text-emerald-300 font-semibold"> vào lệnh ngay tại giá hiện tại</span> — breakout tích lũy (BUY),
            hoặc uptrend vừa hồi về sát MA20 (Gap ≤ <span className="text-emerald-300 font-semibold">{maxGap}%</span>) và chưa quá mua.
            Mã đã chạy xa MA20 (như ABB) bị đẩy xuống mục "Đã vượt điểm mua".
            {data && <> Regime: <span className={`px-1.5 py-0.5 rounded border ${regimeStyle(data.regime)}`}>{data.regime}</span>
              {' '}· score ≥ <span className="text-emerald-300 font-semibold">{data.min_score}</span>
              {data.scanned != null && <> · quét <span className="text-[#e6edf3] font-semibold">{data.scanned}</span> mã</>}</>}
          </p>
        </div>

        <div className="flex items-center gap-2 self-start flex-wrap">
          {/* Gap threshold selector */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[#8b949e]">Gap tối đa</span>
            <div className="flex rounded-lg border border-[#30363d] overflow-hidden text-xs font-semibold">
              {GAP_CHOICES.map(g => (
                <button key={g} onClick={() => setMaxGap(g)} disabled={loading}
                  className={`px-2.5 py-2 transition-all ${
                    maxGap === g ? 'bg-amber-700 text-white'
                                 : 'bg-[#21262d] text-[#8b949e] hover:text-[#e6edf3]'} ${loading ? 'cursor-not-allowed' : ''}`}>
                  {g}%
                </button>
              ))}
            </div>
          </div>

          {/* Universe selector */}
          <div className="flex rounded-lg border border-[#30363d] overflow-hidden text-xs font-semibold">
            {(['vn100', 'all'] as Universe[]).map(u => (
              <button key={u} onClick={() => setUniverse(u)} disabled={loading}
                className={`px-3 py-2 transition-all ${
                  universe === u ? 'bg-[#1f6feb] text-white'
                                 : 'bg-[#21262d] text-[#8b949e] hover:text-[#e6edf3]'} ${loading ? 'cursor-not-allowed' : ''}`}>
                {u === 'vn100' ? 'VN100' : 'Toàn bộ'}
              </button>
            ))}
          </div>

          {/* Quick rescan — no new prices */}
          <button onClick={() => load(universe, maxGap)} disabled={loading}
            className={`px-3 py-2 rounded-lg text-xs font-bold border transition-all ${
              loading ? 'bg-[#161b22] border-[#30363d] text-[#484f58] cursor-not-allowed'
                      : 'bg-[#21262d] border-[#30363d] text-[#8b949e] hover:border-[#58a6ff]/50 hover:text-[#e6edf3]'}`}>
            ⟳ Quét lại
          </button>

          {/* Primary: refresh prices + recompute */}
          <button onClick={() => refreshAndScan(universe, maxGap)} disabled={loading}
            className={`px-4 py-2 rounded-lg text-xs font-bold border transition-all ${
              loading ? 'bg-cyan-950 border-cyan-700 text-cyan-300 animate-pulse cursor-not-allowed'
                      : 'bg-emerald-900/60 border-emerald-700 text-emerald-200 hover:bg-emerald-800/60'}`}>
            {loading ? '⏳ Đang xử lý…' : '🔄 Cập nhật giá & tính lại'}
          </button>
        </div>
      </div>

      {loading && (
        <div className="text-center py-12 text-[#8b949e] text-sm animate-pulse">
          {phase || `Đang quét ${uniLabel} theo mô hình hiện tại…`}
        </div>
      )}

      {!loading && data && (
        <>
          {/* Buyable now */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-emerald-300">🎯 Mua được ngay</h3>
              <span className="text-xs text-[#8b949e]">({data.buyable.length}) — vào lệnh tại giá hiện tại: score ≥ {data.min_score}, Gap ≤ {data.max_gap ?? maxGap}%, RSI ≤ {data.rsi_max ?? 80}</span>
            </div>
            <BuyTable rows={data.buyable} min={data.min_score} onPick={pick} gapLimit={data.max_gap ?? maxGap} />
          </div>

          {/* Extended — qualifies but ran too far above MA20 */}
          {data.extended && data.extended.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-orange-300">⏸ Đã vượt điểm mua — chờ chỉnh về MA20</h3>
                <span className="text-xs text-[#8b949e]">({data.extended.length}) — đủ điểm nhưng giá đã chạy xa MA20 / quá mua → mua bây giờ là đu đỉnh</span>
              </div>
              <BuyTable rows={data.extended} min={data.min_score} onPick={pick} gapLimit={data.max_gap ?? maxGap} showReasons />
            </div>
          )}

          {/* Approaching */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-amber-300">👀 Sắp mua</h3>
              <span className="text-xs text-[#8b949e]">({data.watch.length}) — còn 1-2 xác nhận (score {data.min_score - 2}–{data.min_score - 1})</span>
            </div>
            <BuyTable rows={data.watch} min={data.min_score} onPick={pick} gapLimit={data.max_gap ?? maxGap} />
          </div>

          <p className="text-xs text-[#8b949e]/40 text-right">
            Quét trực tiếp {uniLabel} bằng params tối ưu của regime hiện tại · giá vào/stop/target tính theo dữ liệu mới nhất trong DB · không phải khuyến nghị đầu tư
          </p>
        </>
      )}

      {detail && <SymbolModal symbol={detail.symbol} name={detail.name} onClose={() => setDetail(null)} />}
    </div>
  )
}
