import { useCallback, useEffect, useState } from 'react'
import { api, type MethodRow } from '../api'

// ── Optimization / backtest methods catalogue ─────────────────────────────────
// Each method is (or will be) its own backend file so they stay independent.
// A method becomes selectable here once it has stored params in the registry
// (method_params, populated when you run that method). Deploying one copies its
// params into optimized_params (DB) → drives both Buy Now and VN100 BT.

type Kind   = 'optimize' | 'evaluate'
type Status = 'available' | 'planned'

interface Method {
  code: string        // registry key, e.g. "3a" / "8+4+7"
  title: string
  kind: Kind
  answers: string     // the question this method answers
  desc: string
  status: Status      // catalogue maturity (whether code exists at all)
  makeCmd: string
  file: string        // backend file (planned or existing)
}

const METHODS: Method[] = [
  {
    code: '3a', title: 'Walk-forward trượt (rolling)', kind: 'optimize',
    answers: 'Phương pháp có edge không nếu re-tune mỗi năm?',
    desc: 'Train 3 năm trượt → test năm kế tiếp, lặp 9 lần (2017→2025). Mỗi năm tối ưu params riêng theo từng regime.',
    status: 'available', makeCmd: 'make backtest-3a', file: 'crawler/opt_backtest.py · run_full_backtest()',
  },
  {
    code: '3b', title: 'Walk-forward neo (anchored / expanding)', kind: 'optimize',
    answers: 'Dùng TOÀN BỘ lịch sử mỗi lần fit thì sao?',
    desc: 'Train từ 2014 → lớn dần (2014–2016 test 2017, 2014–2017 test 2018, …). Mỗi lần fit có nhiều dữ liệu hơn cửa sổ 3 năm cố định.',
    status: 'planned', makeCmd: 'make backtest-3b', file: 'crawler/methods/walk_forward_anchored.py',
  },
  {
    code: '2', title: 'Holdout (train/test một lần)', kind: 'optimize',
    answers: 'Tối ưu tới 2022, test "mù" 2023–2025 ra sao?',
    desc: 'Đơn giản nhất, sát "deploy thật" nhất: tối ưu trên giai đoạn cũ, kiểm định một lần trên giai đoạn gần nhất chưa từng thấy.',
    status: 'planned', makeCmd: 'make backtest-holdout', file: 'crawler/methods/holdout.py',
  },
  {
    code: '6', title: 'Combinatorial Purged CV (CPCV)', kind: 'optimize',
    answers: 'Phân phối Sharpe + xác suất overfit (PBO) là bao nhiêu?',
    desc: 'Nhiều tổ hợp train/test có cắt vùng chồng lấn + embargo chống rò rỉ. Mạnh nhất về thống kê nhưng nặng và phức tạp.',
    status: 'planned', makeCmd: 'make backtest-cpcv', file: 'crawler/methods/cpcv.py',
  },
  {
    code: '7', title: 'Monte Carlo (độ tin cậy)', kind: 'evaluate',
    answers: 'CAGR là thật hay may mắn? Khoảng tin cậy?',
    desc: 'Bootstrap/xáo trộn các lệnh đã khớp → dải CAGR & MaxDD, xác suất thua. Không tạo edge mới, chỉ đo độ bền của một chiến lược.',
    status: 'planned', makeCmd: 'make backtest-montecarlo', file: 'crawler/methods/montecarlo.py',
  },
  {
    code: '8', title: 'Robustness / sensitivity', kind: 'evaluate',
    answers: 'Params là cao nguyên bền hay đỉnh nhọn overfit?',
    desc: 'Quét quanh bộ params tối ưu: nếu hàng xóm cũng tốt → bền; nếu chỉ đúng 1 điểm → overfit. Rẻ, giá trị chống overfit cao.',
    status: 'planned', makeCmd: 'make backtest-robustness', file: 'crawler/methods/robustness.py',
  },
]

const KIND_META: Record<Kind, { label: string; cls: string }> = {
  optimize: { label: 'Tối ưu params', cls: 'text-purple-300 border-purple-800 bg-purple-950/40' },
  evaluate: { label: 'Đánh giá',      cls: 'text-amber-300 border-amber-800 bg-amber-950/40' },
}

// metrics keys differ per method (8+4+7 vs 3a aggregates) — read either.
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)
function metricLine(m: MethodRow['metrics']): string | null {
  if (!m) return null
  const cagr = num(m.cagr_pct) ?? num(m.mean_test_cagr_pct)
  const sharpe = num(m.sharpe)
  const dd = num(m.max_drawdown_pct) ?? num(m.mean_test_max_drawdown_pct)
  const parts: string[] = []
  if (cagr != null) parts.push(`CAGR ${cagr.toFixed(1)}%`)
  if (sharpe != null) parts.push(`Sharpe ${sharpe.toFixed(2)}`)
  if (dd != null) parts.push(`MaxDD ${dd.toFixed(1)}%`)
  return parts.length ? parts.join(' · ') : null
}

export function MethodsTab() {
  const [reg, setReg]       = useState<Record<string, MethodRow>>({})
  const [active, setActive] = useState<string | null>(null)
  const [busy, setBusy]     = useState<string | null>(null)
  const [err, setErr]       = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await api.methods()
      setReg(Object.fromEntries(res.methods.map(m => [m.method, m])))
      setActive(res.active)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const deploy = async (code: string) => {
    if (busy) return
    setBusy(code); setErr(null)
    try {
      const res = await api.deployMethod(code)
      setActive(res.active)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  // Action button shared by catalogue cards + the combo card.
  const ActionButton = ({ code }: { code: string }) => {
    const inReg = code in reg
    const isActive = active === code
    if (isActive) {
      return (
        <span className="text-[11px] font-bold px-3 py-1.5 rounded-lg border bg-emerald-900/40 border-emerald-700 text-emerald-300">
          ✓ Đang dùng (live)
        </span>
      )
    }
    if (inReg) {
      return (
        <button
          onClick={() => deploy(code)}
          disabled={busy != null}
          className={`text-[11px] font-bold px-3 py-1.5 rounded-lg border transition-all ${
            busy === code
              ? 'bg-[#21262d] border-[#30363d] text-[#8b949e] cursor-wait'
              : 'bg-sky-950 border-sky-700 text-sky-300 hover:border-sky-400 hover:text-sky-100 disabled:opacity-50'}`}>
          {busy === code ? '⏳ Đang deploy…' : '→ Dùng phương pháp này'}
        </button>
      )
    }
    return (
      <span className="text-[11px] px-3 py-1.5 rounded-lg border border-[#30363d] bg-[#21262d] text-[#6e7681]">
        Chưa có params — chạy backtest trước
      </span>
    )
  }

  return (
    <div className="p-4 space-y-5">
      <div>
        <h2 className="text-base font-bold text-emerald-400">🧪 Phương pháp tối ưu &amp; backtest</h2>
        <p className="text-xs text-[#8b949e] mt-1 max-w-3xl leading-relaxed">
          Mỗi phương pháp là một cách khác nhau để <span className="text-purple-300 font-semibold">tìm bộ params tối ưu</span> hoặc
          {' '}<span className="text-amber-300 font-semibold">đánh giá độ tin cậy</span> của chiến lược Wyckoff.
          Bấm <span className="text-sky-300 font-semibold">"Dùng phương pháp này"</span> để copy params của nó vào
          {' '}<code className="text-[#e6edf3]">optimized_params</code> (DB) — bộ <span className="text-emerald-300 font-semibold">đang dùng (live)</span> điều khiển
          {' '}cả tab <span className="text-emerald-300">Buy Now</span> lẫn <span className="text-emerald-300">VN100 BT</span>.
          Chỉ phương pháp đã chạy (có params trong kho) mới chọn được.
        </p>
      </div>

      {err && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          Lỗi: {err}
        </div>
      )}
      <div className="rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-[11px] text-[#8b949e]">
        Đang dùng (live): {loading
          ? <span className="text-[#6e7681]">đang tải…</span>
          : <span className="text-emerald-300 font-bold">{active ?? '— (chưa đặt)'}</span>}
        {' · '}Phương pháp có params trong kho: <span className="text-[#e6edf3]">{Object.keys(reg).join(', ') || '—'}</span>
      </div>

      {/* Combo pipeline 8+4+7 — deployable */}
      <div className={`rounded-xl border p-3 ${active === '8+4+7' ? 'border-emerald-600 bg-emerald-950/20' : 'border-emerald-800 bg-[#161b22]'}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-base">★</span>
            <span className="text-sm font-bold text-[#e6edf3]">Pipeline 8 + 4 + 7 (combo) — 1 bộ params toàn cục, bền</span>
          </div>
          <ActionButton code="8+4+7" />
        </div>
        <p className="text-xs text-[#8b949e] mt-2 leading-relaxed max-w-3xl">
          <span className="text-amber-300 font-semibold">(8)</span> tìm "cao nguyên" tham số (loại đỉnh nhọn overfit) →{' '}
          <span className="text-amber-300 font-semibold">(4)</span> chạy <span className="text-[#e6edf3]">liền mạch 2014→nay</span> có lãi kép →{' '}
          <span className="text-amber-300 font-semibold">(7)</span> Monte Carlo đo dải CAGR/MaxDD &amp; xác suất sụt giảm.
        </p>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <code className="text-[11px] text-emerald-300 bg-[#0d1117] border border-[#30363d] rounded px-2 py-1">make backtest-robust</code>
          {metricLine(reg['8+4+7']?.metrics ?? null) && (
            <span className="text-[11px] text-[#e6edf3] font-mono">{metricLine(reg['8+4+7']?.metrics ?? null)}</span>
          )}
          <span className="text-[10px] text-[#6e7681] font-mono">crawler/methods/wyckoff_robust_pipeline.py</span>
        </div>
      </div>

      {(['optimize', 'evaluate'] as Kind[]).map(kind => (
        <div key={kind} className="space-y-2">
          <h3 className={`text-sm font-bold ${kind === 'optimize' ? 'text-purple-300' : 'text-amber-300'}`}>
            {kind === 'optimize' ? '🎯 Tìm bộ params tối ưu' : '📊 Đánh giá độ tin cậy'}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {METHODS.filter(m => m.kind === kind).map(m => {
              const isActive = active === m.code
              const km = KIND_META[m.kind]
              const ml = metricLine(reg[m.code]?.metrics ?? null)
              return (
                <div key={m.code}
                  className={`rounded-xl border p-3 transition-all ${
                    isActive ? 'border-emerald-600 bg-emerald-950/20' : 'border-[#30363d] bg-[#161b22]'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold tabular-nums px-1.5 py-0.5 rounded bg-[#0d1117] border border-[#30363d] text-[#8b949e]">#{m.code}</span>
                      <span className="text-sm font-bold text-[#e6edf3]">{m.title}</span>
                    </div>
                    <ActionButton code={m.code} />
                  </div>

                  <div className="mt-1.5 flex items-center gap-2">
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${km.cls}`}>{km.label}</span>
                    <span className="text-[11px] text-[#58a6ff] italic">{m.answers}</span>
                  </div>

                  <p className="text-xs text-[#8b949e] mt-2 leading-relaxed">{m.desc}</p>

                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <code className="text-[11px] text-emerald-300 bg-[#0d1117] border border-[#30363d] rounded px-2 py-1">{m.makeCmd}</code>
                    {ml && <span className="text-[11px] text-[#e6edf3] font-mono">{ml}</span>}
                  </div>
                  <div className="mt-1.5 text-[10px] text-[#6e7681] font-mono">{m.file}</div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      <p className="text-[11px] text-[#8b949e]/50 text-right">
        Phương pháp chưa có params trong kho → chạy <code>make &lt;lệnh&gt;</code> tương ứng (hoặc nạp file params từ server) rồi mới chọn được.
      </p>
    </div>
  )
}
