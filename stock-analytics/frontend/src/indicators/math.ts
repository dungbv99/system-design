import type { Quote } from '../types'

// ── Indicator math ────────────────────────────────────────────────────────────

export function calcMA(closes: number[], n: number): (number | null)[] {
  return closes.map((_, i) =>
    i < n - 1 ? null : closes.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n
  )
}

export function calcEMA(closes: number[], n: number): (number | null)[] {
  const k = 2 / (n + 1)
  const out: (number | null)[] = new Array(closes.length).fill(null)
  if (closes.length < n) return out
  out[n - 1] = closes.slice(0, n).reduce((a, b) => a + b, 0) / n
  for (let i = n; i < closes.length; i++) out[i] = closes[i] * k + out[i - 1]! * (1 - k)
  return out
}

export function calcBB(closes: number[], n = 20, mult = 2) {
  return closes.map((_, i) => {
    if (i < n - 1) return null
    const sl   = closes.slice(i - n + 1, i + 1)
    const mean = sl.reduce((a, b) => a + b, 0) / n
    const std  = Math.sqrt(sl.reduce((s, v) => s + (v - mean) ** 2, 0) / n)
    return { upper: mean + mult * std, mid: mean, lower: mean - mult * std }
  })
}

export function calcRSI(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null)
  if (closes.length <= period) return out
  let avgG = 0, avgL = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d > 0) avgG += d; else avgL -= d
  }
  avgG /= period; avgL /= period
  for (let i = period; i < closes.length; i++) {
    if (i > period) {
      const d = closes[i] - closes[i - 1]
      avgG = (avgG * (period - 1) + Math.max(d, 0)) / period
      avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period
    }
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL)
  }
  return out
}

export function calcMACD(closes: number[], fast = 12, slow = 26, sig = 9) {
  const ef = calcEMA(closes, fast)
  const es = calcEMA(closes, slow)
  const macdLine = closes.map((_, i) =>
    ef[i] == null || es[i] == null ? null : ef[i]! - es[i]!
  )
  const validMacd = macdLine.flatMap(v => v == null ? [] : [v])
  const sigEMA = calcEMA(validMacd, sig)
  let vi = 0
  return macdLine.map(m => {
    if (m == null) return { macd: null, signal: null, hist: null }
    const s = sigEMA[vi++]
    return { macd: m, signal: s, hist: s == null ? null : m - s }
  })
}

export function calcStoch(quotes: Quote[], k = 14, d = 3) {
  const kLine = quotes.map((_, i) => {
    if (i < k - 1) return null
    const sl = quotes.slice(i - k + 1, i + 1)
    const hi = Math.max(...sl.map(q => q.high))
    const lo = Math.min(...sl.map(q => q.low))
    return hi === lo ? 50 : (quotes[i].close - lo) / (hi - lo) * 100
  })
  const dLine = kLine.map((_, i) => {
    const vals = kLine.slice(Math.max(0, i - d + 1), i + 1).filter(v => v != null) as number[]
    return vals.length < d ? null : vals.reduce((a, b) => a + b, 0) / vals.length
  })
  return kLine.map((kv, i) => ({ k: kv, d: dLine[i] }))
}

export function calcVWAP(quotes: Quote[], period = 20): (number | null)[] {
  return quotes.map((_, i) => {
    if (i < period - 1) return null
    const sl = quotes.slice(i - period + 1, i + 1)
    const tpv = sl.reduce((s, q) => s + (q.high + q.low + q.close) / 3 * q.volume, 0)
    const vol = sl.reduce((s, q) => s + q.volume, 0)
    return vol === 0 ? null : tpv / vol
  })
}

export function calcSuperTrend(quotes: Quote[], period = 10, mult = 3) {
  const n = quotes.length
  const out: { value: number | null; bullish: boolean }[] = quotes.map(() => ({ value: null, bullish: true }))
  if (n < period + 1) return out

  const tr = quotes.map((q, i) =>
    i === 0 ? q.high - q.low
    : Math.max(q.high - q.low, Math.abs(q.high - quotes[i-1].close), Math.abs(q.low - quotes[i-1].close))
  )
  const atr: number[] = new Array(n).fill(0)
  atr[period] = tr.slice(1, period + 1).reduce((a, b) => a + b) / period
  for (let i = period + 1; i < n; i++) atr[i] = (atr[i-1] * (period - 1) + tr[i]) / period

  let upper = 0, lower = 0, dir = 1
  for (let i = period; i < n; i++) {
    const hl2 = (quotes[i].high + quotes[i].low) / 2
    const bu = hl2 + mult * atr[i]
    const bl = hl2 - mult * atr[i]
    upper = (i === period || bu < upper || quotes[i-1].close > upper) ? bu : upper
    lower = (i === period || bl > lower || quotes[i-1].close < lower) ? bl : lower
    if (i === period) {
      dir = quotes[i].close <= upper ? 1 : -1
    } else {
      if (dir === 1  && quotes[i].close > upper) dir = -1
      else if (dir === -1 && quotes[i].close < lower) dir = 1
    }
    out[i] = { value: dir === 1 ? upper : lower, bullish: dir === -1 }
  }
  return out
}

export function calc52WHL(quotes: Quote[], period = 252) {
  return quotes.map((_, i) => {
    const sl = quotes.slice(Math.max(0, i - period + 1), i + 1)
    return { high: Math.max(...sl.map(q => q.high)), low: Math.min(...sl.map(q => q.low)) }
  })
}

export function calcAroon(quotes: Quote[], period = 14) {
  return quotes.map((_, i) => {
    if (i < period) return { up: null as number|null, down: null as number|null }
    const sl = quotes.slice(i - period, i + 1)
    const hiIdx = sl.reduce((mi, q, j) => q.high > sl[mi].high ? j : mi, 0)
    const loIdx = sl.reduce((mi, q, j) => q.low  < sl[mi].low  ? j : mi, 0)
    return { up: (hiIdx / period) * 100, down: (loIdx / period) * 100 }
  })
}

export function calcADX(quotes: Quote[], period = 14) {
  const n = quotes.length
  const out = quotes.map(() => ({ adx: null as number|null, pdi: null as number|null, ndi: null as number|null }))
  if (n < period * 2 + 1) return out

  const tr = new Array(n).fill(0), pDM = new Array(n).fill(0), nDM = new Array(n).fill(0)
  for (let i = 1; i < n; i++) {
    const q = quotes[i], p = quotes[i-1]
    tr[i] = Math.max(q.high - q.low, Math.abs(q.high - p.close), Math.abs(q.low - p.close))
    const up = q.high - p.high, dn = p.low - q.low
    pDM[i] = up > dn && up > 0 ? up : 0
    nDM[i] = dn > up && dn > 0 ? dn : 0
  }

  let smTR = tr.slice(1, period+1).reduce((a,b)=>a+b)
  let smP  = pDM.slice(1, period+1).reduce((a,b)=>a+b)
  let smN  = nDM.slice(1, period+1).reduce((a,b)=>a+b)

  const pdi: number[] = [], ndi: number[] = [], dx: number[] = []
  const push = (sTR: number, sP: number, sN: number) => {
    const p = sTR===0 ? 0 : sP/sTR*100, nn = sTR===0 ? 0 : sN/sTR*100
    pdi.push(p); ndi.push(nn)
    dx.push(p+nn===0 ? 0 : Math.abs(p-nn)/(p+nn)*100)
  }
  push(smTR, smP, smN)
  for (let i = period+1; i < n; i++) {
    smTR = smTR - smTR/period + tr[i]
    smP  = smP  - smP /period + pDM[i]
    smN  = smN  - smN /period + nDM[i]
    push(smTR, smP, smN)
  }

  let adx = dx.slice(0, period).reduce((a,b)=>a+b) / period
  const adxArr: number[] = [adx]
  for (let i = period; i < dx.length; i++) { adx = (adx*(period-1)+dx[i])/period; adxArr.push(adx) }

  const adxStart = period*2, diStart = period
  for (let i = 0; i < n; i++) {
    out[i] = {
      adx: i-adxStart>=0 && i-adxStart<adxArr.length ? +adxArr[i-adxStart].toFixed(2) : null,
      pdi: i-diStart >=0 && i-diStart <pdi.length    ? +pdi[i-diStart].toFixed(2)     : null,
      ndi: i-diStart >=0 && i-diStart <ndi.length    ? +ndi[i-diStart].toFixed(2)     : null,
    }
  }
  return out
}

export function calcCCI(quotes: Quote[], period = 20): (number | null)[] {
  return quotes.map((_, i) => {
    if (i < period - 1) return null
    const sl = quotes.slice(i - period + 1, i + 1)
    const tp = sl.map(q => (q.high + q.low + q.close) / 3)
    const mean = tp.reduce((a, b) => a + b) / period
    const mad  = tp.reduce((s, v) => s + Math.abs(v - mean), 0) / period
    return mad === 0 ? 0 : (tp[period-1] - mean) / (0.015 * mad)
  })
}

export function calcATR(quotes: Quote[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(quotes.length).fill(null)
  if (quotes.length < period + 1) return out
  const tr = quotes.map((q, i) =>
    i === 0 ? q.high - q.low
    : Math.max(q.high - q.low, Math.abs(q.high - quotes[i-1].close), Math.abs(q.low - quotes[i-1].close))
  )
  let atr = tr.slice(1, period+1).reduce((a,b)=>a+b) / period
  out[period] = +atr.toFixed(4)
  for (let i = period+1; i < quotes.length; i++) {
    atr = (atr*(period-1) + tr[i]) / period
    out[i] = +atr.toFixed(4)
  }
  return out
}

export function calcWilliamsR(quotes: Quote[], period = 14): (number | null)[] {
  return quotes.map((_, i) => {
    if (i < period - 1) return null
    const sl = quotes.slice(i - period + 1, i + 1)
    const hi = Math.max(...sl.map(q => q.high))
    const lo = Math.min(...sl.map(q => q.low))
    return hi === lo ? -50 : (hi - quotes[i].close) / (hi - lo) * -100
  })
}

export function calcOBV(quotes: Quote[]): number[] {
  return quotes.reduce((acc: number[], q, i) => {
    if (i === 0) return [0]
    const prev = acc[i-1]
    if (q.close > quotes[i-1].close) acc.push(prev + q.volume)
    else if (q.close < quotes[i-1].close) acc.push(prev - q.volume)
    else acc.push(prev)
    return acc
  }, [])
}

export function calcBBW(closes: number[], n = 20, mult = 2): (number | null)[] {
  return calcBB(closes, n, mult).map(v => v == null ? null : (v.upper - v.lower) / v.mid * 100)
}

export function calcIchimoku(quotes: Quote[]) {
  const hi = (p: number, i: number) => { let m = -Infinity; for (let j = Math.max(0,i-p+1); j<=i; j++) m = Math.max(m, quotes[j].high);  return m }
  const lo = (p: number, i: number) => { let m =  Infinity; for (let j = Math.max(0,i-p+1); j<=i; j++) m = Math.min(m, quotes[j].low);   return m }
  return quotes.map((_, i) => ({
    tenkan: i >= 8  ? (hi(9,i)  + lo(9,i))  / 2 : null,
    kijun:  i >= 25 ? (hi(26,i) + lo(26,i)) / 2 : null,
    spanA:  i >= 25 ? ((hi(9,i)+lo(9,i))/2 + (hi(26,i)+lo(26,i))/2) / 2 : null,
    spanB:  i >= 51 ? (hi(52,i) + lo(52,i)) / 2 : null,
  }))
}

export function calcParabolicSAR(quotes: Quote[], afStep = 0.02, afMax = 0.2) {
  const out: { sar: number | null; bull: boolean }[] = quotes.map(() => ({ sar: null, bull: true }))
  if (quotes.length < 2) return out
  let bull = true, af = afStep, ep = quotes[0].high, sar = quotes[0].low
  for (let i = 1; i < quotes.length; i++) {
    const { high, low } = quotes[i]
    let ns = sar + af * (ep - sar)
    if (bull) {
      ns = Math.min(ns, quotes[i-1].low, i >= 2 ? quotes[i-2].low : quotes[i-1].low)
      if (low < ns) { bull = false; ns = ep; ep = low;  af = afStep }
      else if (high > ep) { ep = high; af = Math.min(af + afStep, afMax) }
    } else {
      ns = Math.max(ns, quotes[i-1].high, i >= 2 ? quotes[i-2].high : quotes[i-1].high)
      if (high > ns) { bull = true;  ns = ep; ep = high; af = afStep }
      else if (low  < ep) { ep = low;  af = Math.min(af + afStep, afMax) }
    }
    sar = ns
    out[i] = { sar, bull }
  }
  return out
}

export function calcDonchian(quotes: Quote[], period = 20) {
  return quotes.map((_, i) => {
    if (i < period - 1) return { upper: null as number|null, mid: null as number|null, lower: null as number|null }
    const sl = quotes.slice(i - period + 1, i + 1)
    const upper = Math.max(...sl.map(q => q.high))
    const lower = Math.min(...sl.map(q => q.low))
    return { upper, mid: (upper + lower) / 2, lower }
  })
}

export function calcPivotPoints(quotes: Quote[]) {
  return quotes.map((_, i) => {
    if (i === 0) return { pp: null as number|null, r1: null as number|null, r2: null as number|null, s1: null as number|null, s2: null as number|null }
    const { high: h, low: l, close: c } = quotes[i - 1]
    const pp = (h + l + c) / 3
    return { pp, r1: 2*pp - l, r2: pp + (h - l), s1: 2*pp - h, s2: pp - (h - l) }
  })
}

export function calcFibLevels(quotes: Quote[]) {
  const high = Math.max(...quotes.map(q => q.high))
  const low  = Math.min(...quotes.map(q => q.low))
  const diff = high - low
  return [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].map(r => ({ ratio: r, value: high - r * diff }))
}

export function calcMFI(quotes: Quote[], period = 14): (number | null)[] {
  const tp  = quotes.map(q => (q.high + q.low + q.close) / 3)
  const rmf = quotes.map((q, i) => tp[i] * q.volume)
  return quotes.map((_, i) => {
    if (i < period) return null
    let pos = 0, neg = 0
    for (let j = i - period + 1; j <= i; j++) {
      if (j > 0) { if (tp[j] > tp[j-1]) pos += rmf[j]; else neg += rmf[j] }
    }
    return neg === 0 ? 100 : 100 - 100 / (1 + pos / neg)
  })
}

export function calcROC(closes: number[], period = 14): (number | null)[] {
  return closes.map((c, i) => i < period ? null : ((c - closes[i - period]) / closes[i - period]) * 100)
}

export function calcCMF(quotes: Quote[], period = 20): (number | null)[] {
  return quotes.map((_, i) => {
    if (i < period - 1) return null
    let mfv = 0, vol = 0
    for (let j = i - period + 1; j <= i; j++) {
      const { high: h, low: l, close: c, volume: v } = quotes[j]
      const hl = h - l
      if (hl > 0) { mfv += ((c - l) - (h - c)) / hl * v; vol += v }
    }
    return vol === 0 ? 0 : mfv / vol
  })
}

export function calcWyckoffClimax(quotes: Quote[], period = 20, mult = 2.5) {
  return quotes.map((q, i) => {
    if (i < period) return null as string | null
    const avg = quotes.slice(i - period, i).reduce((s, x) => s + x.volume, 0) / period
    if (q.volume < avg * mult) return null
    return q.close < q.open ? 'SC' : 'BC'
  })
}
