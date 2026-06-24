import { useState } from 'react'

// ── Optimization / backtest methods catalogue ─────────────────────────────────
// Each method is (or will be) its own backend file so they stay independent.
// "Đang dùng" = the method that produced the params currently in optimized_params
// (DB), which drive both the Buy Now and VN100 BT tabs. Selecting a method here is
// a marker for now; the per-method backtest + its own results view get added later.

type Kind   = 'optimize' | 'evaluate'
type Status = 'active' | 'available' | 'planned'

interface Method {
  code: string        // short id, e.g. "3a"
  title: string
  kind: Kind
  answers: string     // the question this method answers
  desc: string
  status: Status
  makeCmd: string
  file: string        // backend file (planned or existing)
}

const METHODS: Method[] = [
  {
    code: '3a', title: 'Walk-forward trượt (rolling)', kind: 'optimize',
    answers: 'Phương pháp có edge không nếu re-tune mỗi năm?',
    desc: 'Train 3 năm trượt → test năm kế tiếp, lặp 9 lần (2017→2025). Mỗi năm tối ưu params riêng. Đây là phương pháp đang tạo ra bộ params hiện tại.',
    status: 'active', makeCmd: 'make backtest-3a', file: 'crawler/opt_backtest.py · run_walk_forward()',
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
    code: '4', title: 'Continuous fixed-params', kind: 'evaluate',
    answers: 'Một bộ params cố định chạy thật suốt 2014→nay ra sao?',
    desc: 'Lấy params hiện tại, chạy liền mạch có compounding, vị thế cuốn chiếu qua các năm. Kết quả thực tế nhất cho "deploy bộ params này". Đã có ở tab VN100 BT.',
    status: 'available', makeCmd: '(tab VN100 BT · nút Tính lại)', file: 'crawler/main.py · run_vn100_model_backtest()',
  },
  {
    code: '7', title: 'Monte Carlo (độ tin cậy)', kind: 'evaluate',
    answers: 'CAGR 13.6% là thật hay may mắn? Khoảng tin cậy?',
    desc: 'Bootstrap/xáo trộn các lệnh đã khớp → dải CAGR & MaxDD, xác suất thua. Không tạo edge mới, chỉ đo độ bền của một chiến lược.',
    status: 'planned', makeCmd: 'make backtest-montecarlo', file: 'crawler/methods/montecarlo.py',
  },
  {
    code: '8', title: 'Robustness / sensitivity', kind: 'evaluate',
    answers: 'Params là cao nguyên bền hay đỉnh nhọn overfit?',
    desc: 'Quét quanh bộ params tối ưu, vẽ heatmap: nếu hàng xóm cũng tốt → bền; nếu chỉ đúng 1 điểm → overfit. Rẻ, giá trị chống overfit cao.',
    status: 'planned', makeCmd: 'make backtest-robustness', file: 'crawler/methods/robustness.py',
  },
]

const STATUS_META: Record<Status, { label: string; cls: string }> = {
  active:    { label: '✅ Đang dùng',   cls: 'bg-emerald-950 text-emerald-300 border-emerald-700' },
  available: { label: '🟢 Đã có',       cls: 'bg-sky-950 text-sky-300 border-sky-700' },
  planned:   { label: '🔜 Sắp có',      cls: 'bg-[#21262d] text-[#8b949e] border-[#30363d]' },
}
const KIND_META: Record<Kind, { label: string; cls: string }> = {
  optimize: { label: 'Tối ưu params', cls: 'text-purple-300 border-purple-800 bg-purple-950/40' },
  evaluate: { label: 'Đánh giá',      cls: 'text-amber-300 border-amber-800 bg-amber-950/40' },
}

const LS_KEY = 'active_method_v1'

export function MethodsTab() {
  const [active, setActive] = useState<string>(() => {
    try { return localStorage.getItem(LS_KEY) || '3a' } catch { return '3a' }
  })
  const choose = (code: string) => {
    setActive(code)
    try { localStorage.setItem(LS_KEY, code) } catch { /* ignore */ }
  }

  return (
    <div className="p-4 space-y-5">
      <div>
        <h2 className="text-base font-bold text-emerald-400">🧪 Phương pháp tối ưu &amp; backtest</h2>
        <p className="text-xs text-[#8b949e] mt-1 max-w-3xl leading-relaxed">
          Mỗi phương pháp là một cách khác nhau để <span className="text-purple-300 font-semibold">tìm bộ params tối ưu</span> hoặc
          {' '}<span className="text-amber-300 font-semibold">đánh giá độ tin cậy</span> của chiến lược Wyckoff. Bộ params của
          phương pháp <span className="text-emerald-300 font-semibold">đang dùng</span> được lưu vào <code className="text-[#e6edf3]">optimized_params</code> (DB)
          và điều khiển cả tab <span className="text-emerald-300">Buy Now</span> lẫn <span className="text-emerald-300">VN100 BT</span>.
          Chọn một phương pháp ở dưới để đánh dấu là đang dùng — phần chạy &amp; kết quả riêng của từng phương pháp sẽ được bổ sung sau.
        </p>
      </div>

      {/* Flow note */}
      <div className="rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-[11px] text-[#8b949e]">
        Luồng: <span className="text-purple-300">Phương pháp</span> →{' '}
        <code className="text-[#e6edf3]">optimized_params</code> (DB) →{' '}
        <span className="text-emerald-300">Buy Now</span> &amp; <span className="text-emerald-300">VN100 BT</span> dùng chung bộ params này.
      </div>

      {/* Combo pipeline 8+4+7 — đã cài đặt */}
      <div className="rounded-xl border border-emerald-700 bg-emerald-950/20 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-base">★</span>
            <span className="text-sm font-bold text-[#e6edf3]">Pipeline 8 + 4 + 7 (combo) — 1 bộ params toàn cục, bền</span>
          </div>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-emerald-950 text-emerald-300 border-emerald-700 whitespace-nowrap">🟢 Đã cài đặt</span>
        </div>
        <p className="text-xs text-[#8b949e] mt-2 leading-relaxed max-w-3xl">
          Quy trình 3 bước chạy liền một mạch: <span className="text-amber-300 font-semibold">(8)</span> tìm “cao nguyên” tham số —
          chỉ chọn bộ params mà các hàng xóm ±1 bước cũng tốt (loại đỉnh nhọn overfit); →{' '}
          <span className="text-amber-300 font-semibold">(4)</span> chạy <span className="text-[#e6edf3]">liền mạch 2014→nay</span> trên cả VN100,
          một tài khoản chung có lãi kép, không reset/đổi params theo năm; →{' '}
          <span className="text-amber-300 font-semibold">(7)</span> Monte Carlo xáo các lệnh đã khớp để ra dải CAGR/MaxDD &amp; xác suất sụt giảm.
          Kết quả ghi ra <code className="text-[#e6edf3]">output/robust_pipeline_*.json</code> + file{' '}
          <code className="text-[#e6edf3]">*_params.sql</code> để deploy, và lưu stage-4 vào tab <span className="text-emerald-300">VN100 BT</span>.
        </p>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <code className="text-[11px] text-emerald-300 bg-[#0d1117] border border-[#30363d] rounded px-2 py-1">make backtest-robust</code>
          <span className="text-[10px] text-[#6e7681] font-mono">crawler/methods/wyckoff_robust_pipeline.py</span>
          <span className="text-[10px] text-[#6e7681]">vars: CAPITAL · SAMPLES · MC · START</span>
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
              const sm = STATUS_META[m.status]
              const km = KIND_META[m.kind]
              return (
                <div key={m.code}
                  className={`rounded-xl border p-3 transition-all ${
                    isActive ? 'border-emerald-600 bg-emerald-950/20' : 'border-[#30363d] bg-[#161b22]'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold tabular-nums px-1.5 py-0.5 rounded bg-[#0d1117] border border-[#30363d] text-[#8b949e]">#{m.code}</span>
                      <span className="text-sm font-bold text-[#e6edf3]">{m.title}</span>
                    </div>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap ${sm.cls}`}>{sm.label}</span>
                  </div>

                  <div className="mt-1.5 flex items-center gap-2">
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${km.cls}`}>{km.label}</span>
                    <span className="text-[11px] text-[#58a6ff] italic">{m.answers}</span>
                  </div>

                  <p className="text-xs text-[#8b949e] mt-2 leading-relaxed">{m.desc}</p>

                  <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
                    <code className="text-[11px] text-emerald-300 bg-[#0d1117] border border-[#30363d] rounded px-2 py-1">{m.makeCmd}</code>
                    <button
                      onClick={() => choose(m.code)}
                      disabled={isActive}
                      className={`text-[11px] font-bold px-3 py-1.5 rounded-lg border transition-all ${
                        isActive ? 'bg-emerald-900/40 border-emerald-700 text-emerald-300 cursor-default'
                                 : 'bg-[#21262d] border-[#30363d] text-[#8b949e] hover:border-[#58a6ff]/50 hover:text-[#e6edf3]'}`}>
                      {isActive ? '✓ Đang dùng' : 'Đặt làm đang dùng'}
                    </button>
                  </div>
                  <div className="mt-1.5 text-[10px] text-[#6e7681] font-mono">{m.file}</div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      <p className="text-[11px] text-[#8b949e]/50 text-right">
        Phương pháp 🔜 chưa được cài đặt — đây là khung danh mục. Mỗi phương pháp khi code xong sẽ là 1 file backend riêng + 1 phần kết quả riêng.
      </p>
    </div>
  )
}
