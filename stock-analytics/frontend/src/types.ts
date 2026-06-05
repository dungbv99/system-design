// ── Types ─────────────────────────────────────────────────────────────────────

export interface Stats {
  total_symbols: number
  total_quotes:  number
  latest_date:   string | null
  last_run:      { job: string; run_date: string; status: string; records: number } | null
}

export interface CrawlStatus {
  running:    boolean
  date:       string | null
  jobs:       string[]
  started_at: string | null
}

export interface CrawlRun {
  id:          number
  job:         string
  run_date:    string
  started_at:  string
  finished_at: string | null
  status:      'running' | 'done' | 'error'
  records:     number
  error:       string | null
}

export interface SymbolRow {
  symbol:      string
  name:        string
  exchange:    string | null
  latest_date: string | null
  close:       number | null
  volume:      number | null
  prev_close:  number | null
  change_pct:  number | null
}

export interface SymbolsPage {
  total:    number
  items:    SymbolRow[]
}

export type Exchange = '' | 'HOSE' | 'HNX' | 'UPCOM'

export interface Quote {
  date:   string
  open:   number
  high:   number
  low:    number
  close:  number
  volume: number
}

export interface WyckoffEvent {
  event_type:  string
  date:        string
  price:       number
  volume:      number
  description: string
}

export interface WyckoffSignal {
  symbol:          string
  analyzed_at:     string
  phase:           string
  sub_phase:       string
  signal:          string
  signal_strength: string
  support:         number | null
  resistance:      number | null
  current_price:   number | null
  last_event:      string | null
  entry_price:     number | null
  stop_loss:       number | null
  description:     string
  bars_analyzed:   number
  updated_at:      string
  // joined from symbols table (in list endpoint)
  name?:           string
  exchange?:       string
  industry?:       string
}

export interface WyckoffPage {
  total: number
  items: WyckoffSignal[]
}

export interface Prediction {
  symbol:        string
  predicted_at:  string
  horizon_days:  number
  score:         number
  signal:        'BUY' | 'HOLD'
  model_date:    string
  name?:         string
  exchange?:     string
  industry?:     string
  current_price?: number | null
}

export interface PredictionPage {
  total: number
  items: Prediction[]
}

export interface IndicatorDef {
  id:       string
  label:    string
  desc:     string
  category: 'Overlay' | 'Oscillator'
  color:    string
}
