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

export interface MultifactorSignal {
  symbol:          string
  analyzed_at:     string
  total_score:     number
  signal:          'BUY' | 'WATCH' | 'AVOID'
  confidence:      'HIGH' | 'MEDIUM' | 'LOW'
  factors_agreed:  number
  trend_score:     number
  momentum_score:  number
  volume_score:    number
  position_score:  number
  trend_reason:    string
  momentum_reason: string
  volume_reason:   string
  position_reason: string
  current_price:   number | null
  support:         number | null
  resistance:      number | null
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

export interface MultifactorPage {
  total: number
  items: MultifactorSignal[]
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

export interface PaperTrade {
  id:            number
  symbol:        string
  name?:         string
  exchange?:     string
  buy_date:      string
  buy_price:     number
  quantity:      number
  entry_price:   number | null
  stop_loss:     number | null
  target:        number | null
  phase:         string | null
  signal:        string | null
  note:          string | null
  status:        'OPEN' | 'CLOSED'
  close_date:    string | null
  close_price:   number | null
  current_price: number | null
  price_date:    string | null
  cost:          number
  market_value:  number
  pl:            number
  pl_pct:        number
  created_at:    string
}

export interface PortfolioSummary {
  cost:          number
  market_value:  number
  pl:            number
  pl_pct:        number
  open_count:    number
  closed_count:  number
}

export interface PortfolioPage {
  items:   PaperTrade[]
  summary: PortfolioSummary
}

export interface IndicatorDef {
  id:       string
  label:    string
  desc:     string
  category: 'Overlay' | 'Oscillator'
  color:    string
}

// ── Backtest ──────────────────────────────────────────────────────────────────

export interface BacktestTrade {
  symbol:       string
  strategy:     'signal_replay' | 'event_trade'
  signal:       'BUY' | 'SHORT'
  event:        string | null
  phase:        string
  sub_phase:    string
  entry_date:   string
  entry_price:  number
  stop_loss:    number
  target:       number
  exit_date:    string
  exit_price:   number
  exit_reason:  'stop' | 'target' | 'timeout' | 'end_of_data'
  return_pct:   number
  holding_days: number
}

export interface BacktestResult {
  symbol:            string
  strategy:          string
  bars_analyzed:     number
  total_trades:      number
  buy_trades:        number
  short_trades:      number
  winning_trades:    number
  win_rate:          number
  avg_return_pct:    number
  median_return_pct: number
  best_trade_pct:    number
  worst_trade_pct:   number
  total_return_pct:  number
  max_drawdown_pct:  number
  avg_holding_days:  number
  equity_curve:      number[]
  trades:            BacktestTrade[]
}

export interface BacktestResponse {
  signal_replay?: BacktestResult
  event_trades?:  BacktestResult
}
