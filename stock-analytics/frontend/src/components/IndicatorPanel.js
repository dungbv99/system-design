import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { INDICATOR_DEFS } from '../indicators/defs';
export function IndicatorPanel({ active, onChange, onClose }) {
    const [search, setSearch] = useState('');
    const filtered = INDICATOR_DEFS.filter(d => d.label.toLowerCase().includes(search.toLowerCase()) ||
        d.desc.toLowerCase().includes(search.toLowerCase()));
    const categories = ['Overlay', 'Oscillator'];
    const toggle = (id) => {
        const next = new Set(active);
        next.has(id) ? next.delete(id) : next.add(id);
        onChange(next);
    };
    return (_jsxs(_Fragment, { children: [_jsx("div", { className: "fixed inset-0 z-[60]", onClick: onClose }), _jsxs("div", { className: "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[70]\n                      w-80 max-h-[80vh] flex flex-col\n                      bg-[#161b22] border border-[#30363d] rounded-xl shadow-2xl overflow-hidden", children: [_jsxs("div", { className: "flex items-center justify-between px-4 py-3 border-b border-[#30363d] shrink-0", children: [_jsx("span", { className: "text-sm font-bold text-[#e6edf3] tracking-wide", children: "Ch\u1EC9 b\u00E1o k\u1EF9 thu\u1EADt" }), _jsx("button", { onClick: onClose, className: "text-[#8b949e] hover:text-[#e6edf3] transition-colors text-base leading-none", children: "\u2715" })] }), _jsx("div", { className: "px-3 py-2.5 border-b border-[#30363d]/60 shrink-0", children: _jsxs("div", { className: "relative", children: [_jsx("span", { className: "absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8b949e] text-xs", children: "\uD83D\uDD0D" }), _jsx("input", { type: "text", placeholder: "T\u00ECm ki\u1EBFm\u2026", value: search, onChange: e => setSearch(e.target.value), autoFocus: true, className: "w-full bg-[#0d1117] border border-[#30363d] rounded-lg pl-7 pr-3 py-1.5\n                         text-xs text-[#e6edf3] placeholder-[#8b949e]\n                         focus:outline-none focus:border-[#58a6ff]/70 transition-colors" })] }) }), active.size > 0 && !search && (_jsx("div", { className: "px-3 py-2 border-b border-[#30363d]/60 shrink-0 flex flex-wrap gap-1.5", children: INDICATOR_DEFS.filter(d => active.has(d.id)).map(d => (_jsxs("button", { onClick: () => toggle(d.id), className: "flex items-center gap-1 px-2 py-0.5 rounded-full text-xs\n                           bg-[#21262d] hover:bg-[#30363d] text-[#e6edf3] transition-colors", children: [_jsx("span", { className: "w-1.5 h-1.5 rounded-full shrink-0", style: { background: d.color } }), d.label, _jsx("span", { className: "text-[#8b949e] hover:text-red-400 ml-0.5", children: "\u2715" })] }, d.id))) })), _jsxs("div", { className: "overflow-y-auto flex-1 py-1", children: [categories.map(cat => {
                                const items = filtered.filter(d => d.category === cat);
                                if (!items.length)
                                    return null;
                                return (_jsxs("div", { children: [_jsx("div", { className: "px-4 py-1.5 text-[10px] font-bold text-[#8b949e] uppercase tracking-widest\n                                bg-[#0d1117]/40 sticky top-0", children: cat === 'Overlay' ? 'Overlay — vẽ trên nến' : 'Oscillator — bảng riêng' }), items.map(ind => {
                                            const on = active.has(ind.id);
                                            return (_jsxs("button", { onClick: () => toggle(ind.id), className: `w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors
                        ${on ? 'bg-blue-950/50 hover:bg-blue-950/70' : 'hover:bg-[#21262d]/70'}`, children: [_jsx("span", { className: "w-3 h-3 rounded-full shrink-0 border-2 transition-all", style: {
                                                            background: on ? ind.color : 'transparent',
                                                            borderColor: ind.color,
                                                            boxShadow: on ? `0 0 6px ${ind.color}60` : 'none',
                                                        } }), _jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("div", { className: `text-xs font-semibold ${on ? 'text-[#e6edf3]' : 'text-[#8b949e]'}`, children: ind.label }), _jsx("div", { className: "text-[10px] text-[#8b949e]/60 truncate mt-0.5", children: ind.desc })] }), on && (_jsx("span", { className: "text-[#58a6ff] text-xs shrink-0", children: "\u2713" }))] }, ind.id));
                                        })] }, cat));
                            }), filtered.length === 0 && (_jsx("div", { className: "px-4 py-8 text-center text-[#8b949e] text-xs", children: "Kh\u00F4ng t\u00ECm th\u1EA5y ch\u1EC9 b\u00E1o" }))] }), _jsxs("div", { className: "px-4 py-2 border-t border-[#30363d] shrink-0 flex items-center justify-between", children: [_jsxs("span", { className: "text-[10px] text-[#8b949e]", children: [active.size, " \u0111ang hi\u1EC3n th\u1ECB"] }), active.size > 0 && (_jsx("button", { onClick: () => onChange(new Set()), className: "text-[10px] text-[#8b949e] hover:text-red-400 transition-colors", children: "X\u00F3a t\u1EA5t c\u1EA3" }))] })] })] }));
}
