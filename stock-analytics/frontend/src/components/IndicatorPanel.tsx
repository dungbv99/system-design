import { useState } from 'react'
import { INDICATOR_DEFS } from '../indicators/defs'

interface Props {
  active:   Set<string>
  onChange: (s: Set<string>) => void
  onClose:  () => void
}

export function IndicatorPanel({ active, onChange, onClose }: Props) {
  const [search, setSearch] = useState('')

  const filtered = INDICATOR_DEFS.filter(
    d => d.label.toLowerCase().includes(search.toLowerCase()) ||
         d.desc.toLowerCase().includes(search.toLowerCase())
  )
  const categories = ['Overlay', 'Oscillator'] as const

  const toggle = (id: string) => {
    const next = new Set(active)
    next.has(id) ? next.delete(id) : next.add(id)
    onChange(next)
  }

  return (
    <>
      {/* backdrop */}
      <div className="fixed inset-0 z-[60]" onClick={onClose} />

      {/* panel */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[70]
                      w-80 max-h-[80vh] flex flex-col
                      bg-[#161b22] border border-[#30363d] rounded-xl shadow-2xl overflow-hidden">

        {/* header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#30363d] shrink-0">
          <span className="text-sm font-bold text-[#e6edf3] tracking-wide">Chỉ báo kỹ thuật</span>
          <button onClick={onClose}
            className="text-[#8b949e] hover:text-[#e6edf3] transition-colors text-base leading-none">✕</button>
        </div>

        {/* search */}
        <div className="px-3 py-2.5 border-b border-[#30363d]/60 shrink-0">
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8b949e] text-xs">🔍</span>
            <input
              type="text"
              placeholder="Tìm kiếm…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
              className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg pl-7 pr-3 py-1.5
                         text-xs text-[#e6edf3] placeholder-[#8b949e]
                         focus:outline-none focus:border-[#58a6ff]/70 transition-colors"
            />
          </div>
        </div>

        {/* active pills */}
        {active.size > 0 && !search && (
          <div className="px-3 py-2 border-b border-[#30363d]/60 shrink-0 flex flex-wrap gap-1.5">
            {INDICATOR_DEFS.filter(d => active.has(d.id)).map(d => (
              <button key={d.id} onClick={() => toggle(d.id)}
                className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs
                           bg-[#21262d] hover:bg-[#30363d] text-[#e6edf3] transition-colors">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: d.color }} />
                {d.label}
                <span className="text-[#8b949e] hover:text-red-400 ml-0.5">✕</span>
              </button>
            ))}
          </div>
        )}

        {/* list */}
        <div className="overflow-y-auto flex-1 py-1">
          {categories.map(cat => {
            const items = filtered.filter(d => d.category === cat)
            if (!items.length) return null
            return (
              <div key={cat}>
                <div className="px-4 py-1.5 text-[10px] font-bold text-[#8b949e] uppercase tracking-widest
                                bg-[#0d1117]/40 sticky top-0">
                  {cat === 'Overlay' ? 'Overlay — vẽ trên nến' : 'Oscillator — bảng riêng'}
                </div>
                {items.map(ind => {
                  const on = active.has(ind.id)
                  return (
                    <button
                      key={ind.id}
                      onClick={() => toggle(ind.id)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors
                        ${on ? 'bg-blue-950/50 hover:bg-blue-950/70' : 'hover:bg-[#21262d]/70'}`}
                    >
                      <span className="w-3 h-3 rounded-full shrink-0 border-2 transition-all"
                        style={{
                          background:   on ? ind.color : 'transparent',
                          borderColor:  ind.color,
                          boxShadow:    on ? `0 0 6px ${ind.color}60` : 'none',
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className={`text-xs font-semibold ${on ? 'text-[#e6edf3]' : 'text-[#8b949e]'}`}>
                          {ind.label}
                        </div>
                        <div className="text-[10px] text-[#8b949e]/60 truncate mt-0.5">{ind.desc}</div>
                      </div>
                      {on && (
                        <span className="text-[#58a6ff] text-xs shrink-0">✓</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
          {filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-[#8b949e] text-xs">Không tìm thấy chỉ báo</div>
          )}
        </div>

        {/* footer */}
        <div className="px-4 py-2 border-t border-[#30363d] shrink-0 flex items-center justify-between">
          <span className="text-[10px] text-[#8b949e]">{active.size} đang hiển thị</span>
          {active.size > 0 && (
            <button onClick={() => onChange(new Set())}
              className="text-[10px] text-[#8b949e] hover:text-red-400 transition-colors">
              Xóa tất cả
            </button>
          )}
        </div>
      </div>
    </>
  )
}
