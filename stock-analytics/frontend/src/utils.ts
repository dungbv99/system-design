// ── Helpers ───────────────────────────────────────────────────────────────────

export function yesterday(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  if (d.getDay() === 0) d.setDate(d.getDate() - 2)
  if (d.getDay() === 6) d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

export function fmtPrice(v: number | null) {
  if (v == null) return '—'
  return v.toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

export function fmtVol(v: number | null) {
  if (v == null) return '—'
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `${(v / 1_000).toFixed(0)}K`
  return v.toString()
}

export function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

export function duration(start: string, end: string | null) {
  if (!end) return '…'
  const s = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

// ── OHLCV aggregation ─────────────────────────────────────────────────────────

import type { Quote } from './types'

function groupAndReduce(quotes: Quote[], keyFn: (q: Quote) => string): Quote[] {
  const buckets = new Map<string, Quote[]>()
  for (const q of quotes) {
    const k = keyFn(q)
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k)!.push(q)
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([, bars]) => ({
      date:   bars[bars.length - 1].date,
      open:   bars[0].open,
      high:   Math.max(...bars.map(b => b.high)),
      low:    Math.min(...bars.map(b => b.low)),
      close:  bars[bars.length - 1].close,
      volume: bars.reduce((s, b) => s + b.volume, 0),
    }))
}

export function aggregateWeekly(quotes: Quote[]): Quote[] {
  return groupAndReduce(quotes, q => {
    const d   = new Date(q.date)
    const day = d.getDay()
    const mon = new Date(d)
    mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
    return mon.toISOString().slice(0, 10)
  })
}

export function aggregateMonthly(quotes: Quote[]): Quote[] {
  return groupAndReduce(quotes, q => q.date.slice(0, 7))
}
