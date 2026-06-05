import type { IndicatorDef } from '../types'

export const INDICATOR_DEFS: IndicatorDef[] = [
  // Overlay
  { id:'ma20',       label:'MA 20',             desc:'Simple Moving Average (20)',      category:'Overlay',    color:'#facc15' },
  { id:'ma50',       label:'MA 50',             desc:'Simple Moving Average (50)',      category:'Overlay',    color:'#60a5fa' },
  { id:'ma200',      label:'MA 200',            desc:'Simple Moving Average (200)',     category:'Overlay',    color:'#f472b6' },
  { id:'ema20',      label:'EMA 20',            desc:'Exponential Moving Avg (20)',     category:'Overlay',    color:'#fb923c' },
  { id:'ema50',      label:'EMA 50',            desc:'Exponential Moving Avg (50)',     category:'Overlay',    color:'#34d399' },
  { id:'ema200',     label:'EMA 200',           desc:'Exponential Moving Avg (200)',    category:'Overlay',    color:'#c084fc' },
  { id:'bb',         label:'Bollinger Bands',   desc:'BB (20, ±2 std)',                 category:'Overlay',    color:'#8b5cf6' },
  { id:'vwap',       label:'VWAP',              desc:'Volume Weighted Avg Price (20d)', category:'Overlay',    color:'#f97316' },
  { id:'supertrend', label:'SuperTrend',        desc:'ATR-based trend (10, 3)',         category:'Overlay',    color:'#10b981' },
  { id:'52whl',      label:'52W High/Low',      desc:'Rolling 52-week high and low',   category:'Overlay',    color:'#06b6d4' },
  { id:'volume',     label:'Volume',            desc:'Trading volume bars',            category:'Overlay',    color:'#6b7280' },
  // Oscillator
  { id:'rsi',        label:'RSI (14)',           desc:'Relative Strength Index',        category:'Oscillator', color:'#a78bfa' },
  { id:'macd',       label:'MACD (12,26,9)',     desc:'Moving Avg Convergence Div.',    category:'Oscillator', color:'#22d3ee' },
  { id:'stoch',      label:'Stochastic (14,3)',  desc:'Stochastic Oscillator',          category:'Oscillator', color:'#f59e0b' },
  { id:'aroon',      label:'Aroon (14)',         desc:'Aroon Up/Down oscillator',       category:'Oscillator', color:'#4ade80' },
  { id:'adx',        label:'ADX (14)',           desc:'Avg Directional Index + DI',     category:'Oscillator', color:'#f43f5e' },
  { id:'cci',        label:'CCI (20)',           desc:'Commodity Channel Index',        category:'Oscillator', color:'#eab308' },
  { id:'atr',        label:'ATR (14)',           desc:'Average True Range',             category:'Oscillator', color:'#94a3b8' },
  { id:'williamsr',  label:'Williams %R (14)',   desc:'Williams Percent Range',         category:'Oscillator', color:'#06b6d4' },
  { id:'obv',        label:'OBV',               desc:'On Balance Volume',              category:'Oscillator', color:'#a3e635' },
  { id:'bbw',        label:'BB Width',          desc:'Bollinger Bands Width %',        category:'Oscillator', color:'#e879f9' },
  // New overlays
  { id:'ichimoku',  label:'Ichimoku Cloud',    desc:'Trend + S/R + momentum (9,26,52)',           category:'Overlay',    color:'#26a69a' },
  { id:'psar',      label:'Parabolic SAR',     desc:'Trend-reversal dots (step 0.02, max 0.2)',   category:'Overlay',    color:'#ff9800' },
  { id:'donchian',  label:'Donchian (20)',      desc:'Highest high / lowest low channel',          category:'Overlay',    color:'#00bcd4' },
  { id:'pivot',     label:'Pivot Points',       desc:'Daily PP · R1/R2 · S1/S2 levels',           category:'Overlay',    color:'#90a4ae' },
  { id:'fib',       label:'Fibonacci',          desc:'Auto retracement from full-history H/L',    category:'Overlay',    color:'#ff5722' },
  { id:'wyckoff',   label:'Wyckoff Climax',     desc:'SC/BC volume-climax markers (×2.5 avg vol)',category:'Overlay',    color:'#ce93d8' },
  // New oscillators
  { id:'mfi',       label:'MFI (14)',           desc:'Money Flow Index — volume-weighted RSI',    category:'Oscillator', color:'#26c6da' },
  { id:'roc',       label:'ROC (14)',           desc:'Rate of Change — price momentum %',         category:'Oscillator', color:'#ffca28' },
  { id:'cmf',       label:'CMF (20)',           desc:'Chaikin Money Flow — buy/sell pressure',    category:'Oscillator', color:'#66bb6a' },
]

export const DEFAULT_INDICATORS = new Set(['ma20', 'ma50', 'ma200', 'volume', 'rsi'])
