import type { Stats, CrawlStatus, CrawlRun, SymbolsPage, Quote, WyckoffSignal, WyckoffPage, MultifactorSignal, MultifactorPage, Prediction, PredictionPage, PortfolioPage, PortfolioBacktest, ReportAnalysis, FundsPage, BasisRow, DerivativesOi, DerivativesSummary, IntradayBar } from './types'

// ── VN Index constituents (approximate – HOSE rebalances quarterly) ──────────
// symbols  → small/fixed indices: load by exact symbol list
// exchange → large indices: load all stocks on those exchanges (comma-separated)

export type IndexDef =
  | { label: string; color: string; symbols: string[] }
  | { label: string; color: string; exchange: string; approxCount: number }

export const VN_INDICES: Record<string, IndexDef> = {
  vn30: {
    label: 'VN30',
    color: '#3b82f6',
    symbols: [
      'ACB','BID','BSR','CTG','FPT','GAS','GVR','HDB','HPG','LPB',
      'MBB','MSN','MWG','PLX','SAB','SHB','SSB','SSI','STB','TCB',
      'TPB','VCB','VHM','VIB','VIC','VJC','VNM','VPB','VPL','VRE',
    ],
  },
  vn100: {
    label: 'VN100',
    color: '#8b5cf6',
    symbols: [
      // VN30
      'ACB','BID','BSR','CTG','FPT','GAS','GVR','HDB','HPG','LPB',
      'MBB','MSN','MWG','PLX','SAB','SHB','SSB','SSI','STB','TCB',
      'TPB','VCB','VHM','VIB','VIC','VJC','VNM','VPB','VPL','VRE',
      // VN MidCap (VN100 = VN30 + VNMID)
      'ANV','BAF','BCM','BMP','BSI','BVH','BWE','CII','CMG','CTD',
      'CTR','CTS','DBC','DCM','DGW','DIG','DPM','DSE','DXG','DXS',
      'EIB','EVF','FRT','FTS','GEE','GEX','GMD','HAG','HCM','HDC',
      'HDG','HHV','HSG','HT1','IMP','KBC','KDC','KDH','KOS','MSB',
      'NAB','NKG','NLG','NT2','NVL','OCB','PAN','PC1','PDR','PHR',
      'PNJ','POW','PVD','PVT','REE','SBT','SCS','SIP','SJS','SZC',
      'TCH','VCG','VCI','VGC','VHC','VIX','VND','VPI','VSC','VTP',
    ],
  },
  vnmid: {
    label: 'VN MidCap',
    color: '#f97316',
    symbols: [
      'ANV','BAF','BCM','BMP','BSI','BVH','BWE','CII','CMG','CTD',
      'CTR','CTS','DBC','DCM','DGW','DIG','DPM','DSE','DXG','DXS',
      'EIB','EVF','FRT','FTS','GEE','GEX','GMD','HAG','HCM','HDC',
      'HDG','HHV','HSG','HT1','IMP','KBC','KDC','KDH','KOS','MSB',
      'NAB','NKG','NLG','NT2','NVL','OCB','PAN','PC1','PDR','PHR',
      'PNJ','POW','PVD','PVT','REE','SBT','SCS','SIP','SJS','SZC',
      'TCH','VCG','VCI','VGC','VHC','VIX','VND','VPI','VSC','VTP',
    ],
  },
  vnsml: {
    label: 'VN SmallCap',
    color: '#f59e0b',
    symbols: [
      'AAA','AAM','ABT','ACC','ACL','ADG','ADP','ADS','AGG','AGR',
      'APG','APH','ASM','ASP','AST','BCE','BFC','BIC','BKG','BMC',
      'BMI','BRC','BTP','C32','CCC','CCL','CDC','CHP','CIG','CKG',
      'CLL','CMX','CNG','CRC','CRE','CSM','CSV','CTF','CTI','D2D',
      'DAH','DBD','DC4','DCL','DHA','DHC','DHM','DLG','DMC','DPG',
      'DPR','DRC','DRL','DSC','DSN','DTA','DVP','DXV','ELC','EVE',
      'EVG','FCM','FCN','FIR','FIT','FMC','GDT','GEG','GIL','GSP',
      'HAH','HAP','HAR','HAX','HCD','HHP','HHS','HID','HII','HMC',
      'HPX','HQC','HSL','HTG','HTI','HTN','HTV','HUB','HVH','ICT',
      'IDI','IJC','ILB','ITC','ITD','JVC','KHG','KHP','KMR','KSB',
      'LAF','LBM','LCG','LGL','LHG','LIX','LSS','MCM','MCP','MHC',
      'MIG','MSH','NAF','NAV','NBB','NCT','NHA','NHH','NNC','NO1',
      'NSC','NTL','OGC','ORS','PAC','PET','PGC','PHC','PIT','PLP',
      'PPC','PTB','PTC','PTL','PVP','QCG','RAL','RYG','SAM','SAV',
      'SBG','SCR','SFC','SFI','SGN','SGR','SGT','SHA','SHI','SJD',
      'SKG','SMB','ST8','STK','SVD','SVT','SZL','TCI','TCL','TCM',
      'TCO','TCT','TDC','TDG','TDH','TDP','TEG','THG','TIP','TLD',
      'TLG','TLH','TMT','TN1','TNH','TNI','TNT','TRC','TSC','TTA',
      'TTF','TV2','TVB','TVS','UIC','VCA','VDS','VFG','VIP','VNL',
      'VOS','VPG','VPH','VPS','VRC','VSI','VTB','VTO','YBM','YEG',
    ],
  },
  vnsi: {
    label: 'VNSI',
    color: '#ec4899',
    symbols: [
      'BCM','BID','BMP','BVH','CTD','CTG','DCM','GEX','HDB','IMP',
      'MBB','MWG','PAN','PVD','SBT','TCB','VCB','VIC','VNM','VPB',
    ],
  },
  vnx50: {
    label: 'VNX50',
    color: '#06b6d4',
    symbols: [
      'ACB','BID','BSR','CTG','DCM','DPM','DXG','EIB','FPT','FRT',
      'GEE','GEX','GMD','HCM','HDB','HPG','IDC','KBC','KDH','LPB',
      'MBB','MSB','MSN','MWG','NLG','NVL','PDR','PLX','PNJ','POW',
      'PVS','SHB','SHS','SSI','STB','TCB','TPB','VCB','VCG','VCI',
      'VHM','VIB','VIC','VIX','VJC','VND','VNM','VPB','VPI','VRE',
    ],
  },
  vnxall: {
    label: 'VNXAll',
    color: '#10b981',
    exchange: 'HOSE,HNX',
    approxCount: 700,
  },
  vnall: {
    label: 'VNAll',
    color: '#84cc16',
    exchange: 'HOSE,HNX,UPCOM',
    approxCount: 1532,
  },
}

// ── VN Industry sector constituents (HOSE GICS sectors, sourced from SSI indexGroups) ───
export type SectorDef = { label: string; labelVi: string; color: string; symbols: string[] }

export const VN_SECTORS: Record<string, SectorDef> = {
  vnfin: {
    label: 'Financials', labelVi: 'Tài chính', color: '#3b82f6',
    symbols: [
      'ACB','AGR','APG','BIC','BID','BMI','BSI','BVH','CTG','CTS',
      'DSC','DSE','EIB','EVF','FIT','FTS','HCM','HDB','LPB','MBB',
      'MIG','MSB','NAB','OCB','OGC','ORS','SHB','SSB','SSI','STB',
      'TCB','TCI','TPB','TVB','TVS','VCB','VCI','VDS','VIB','VIX',
      'VND','VPB',
    ],
  },
  vnreal: {
    label: 'Real Estate', labelVi: 'Bất động sản', color: '#f97316',
    symbols: [
      'AGG','ASM','BCM','CCL','CIG','CKG','CRE','D2D','DTA','DXG',
      'DXS','FIR','HAR','HDC','HPX','HQC','ITC','KBC','KDH','KHG',
      'KOS','LHG','NBB','NLG','NTL','NVL','PDR','PTL','QCG','SCR',
      'SGR','SIP','SJS','SZL','TDC','TDH','TEG','TN1','VHM','VIC',
      'VPH','VPI','VRE',
    ],
  },
  vnind: {
    label: 'Industrials', labelVi: 'Công nghiệp', color: '#8b5cf6',
    symbols: [
      'BCE','BKG','BMP','BRC','C32','CCC','CDC','CII','CLL','CTD',
      'CTR','DC4','DIG','DLG','DPG','DVP','EVG','FCN','GEE','GEX',
      'GMD','HAH','HCD','HDG','HHV','HID','HTI','HTN','HTV','HUB',
      'HVH','IJC','ILB','ITD','LCG','LGL','MHC','NCT','NHA','NO1',
      'PC1','PET','PHC','PIT','PTC','RAL','REE','RYG','SAM','SBG',
      'SCS','SFI','SGN','SHA','SHI','SKG','ST8','SZC','TCH','TCL',
      'TCO','TIP','TLG','TNI','TSC','TV2','VCG','VGC','VIP','VJC',
      'VNL','VOS','VPG','VRC','VSC','VSI','VTO','VTP',
    ],
  },
  vnmat: {
    label: 'Materials', labelVi: 'Vật liệu', color: '#f59e0b',
    symbols: [
      'AAA','ACC','ADP','APH','BFC','BMC','CRC','CSV','CTI','DCM',
      'DHA','DHC','DHM','DPM','DPR','DXV','FCM','GVR','HAP','HHP',
      'HII','HMC','HPG','HSG','HT1','KSB','LBM','MCP','NAV','NHH',
      'NKG','NNC','PHR','PLP','TDP','THG','TLD','TLH','TNT','TRC',
      'VCA','VFG','VPS','YBM',
    ],
  },
  vncond: {
    label: 'Consumer Discret.', labelVi: 'Tiêu dùng tùy ý', color: '#ec4899',
    symbols: [
      'ADS','AST','CSM','CTF','DAH','DRC','DSN','EVE','FRT','GDT',
      'GIL','HAX','HHS','HTG','KMR','MSH','MWG','PAC','PNJ','PTB',
      'SAV','SFC','STK','SVD','SVT','TCM','TCT','TMT','TTF','VPL','VTB',
    ],
  },
  vncons: {
    label: 'Consumer Staples', labelVi: 'Tiêu dùng thiết yếu', color: '#10b981',
    symbols: [
      'AAM','ABT','ACL','ANV','BAF','CMX','DBC','FMC','HAG','HSL',
      'IDI','KDC','LAF','LIX','LSS','MCM','MSN','NAF','NSC','PAN',
      'SAB','SBT','SMB','VHC','VNM',
    ],
  },
  vnene: {
    label: 'Energy', labelVi: 'Năng lượng', color: '#f97316',
    symbols: ['ASP','BSR','CNG','GSP','PGC','PLX','PVD','PVP','PVT','TDG'],
  },
  vnheal: {
    label: 'Healthcare', labelVi: 'Y tế - Dược', color: '#06b6d4',
    symbols: ['DBD','DCL','DMC','IMP','JVC','TNH'],
  },
  vnit: {
    label: 'Technology', labelVi: 'Công nghệ', color: '#84cc16',
    symbols: ['CMG','DGW','ELC','FPT','ICT'],
  },
  vnuti: {
    label: 'Utilities', labelVi: 'Tiện ích', color: '#14b8a6',
    symbols: ['BTP','BWE','CHP','DRL','GAS','GEG','KHP','NT2','POW','PPC','SJD','TTA','UIC'],
  },
}

// ── API client ────────────────────────────────────────────────────────────────

export const api = {
  compositions: (): Promise<Record<string, string[]>> =>
    fetch('/api/index-compositions').then(r => r.json()),
  stats:   (): Promise<Stats>        => fetch('/api/stats').then(r => r.json()),
  status:  (): Promise<CrawlStatus>  => fetch('/api/crawl/status').then(r => r.json()),
  runs:    (limit = 40): Promise<CrawlRun[]> =>
    fetch(`/api/crawl/runs?limit=${limit}`).then(r => r.json()),
  symbols: (q = '', limit = 50, offset = 0, exchange = '', symbolsList = ''): Promise<SymbolsPage> =>
    fetch(`/api/symbols/list?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}&exchange=${exchange}&symbols=${encodeURIComponent(symbolsList)}`).then(r => r.json()),
  quotes:  (symbol: string, days = 60): Promise<Quote[]> =>
    fetch(`/api/symbols/${symbol}/quotes?days=${days}`).then(r => r.json()),
  fetchHistory: (symbol: string): Promise<{ message: string; symbol: string }> =>
    fetch(`/api/symbols/${encodeURIComponent(symbol)}/history`, { method: 'POST' }).then(r => r.json()),
  updateInfo: (): Promise<{ latest_date: string | null; from_date: string; to_date: string; up_to_date: boolean }> =>
    fetch('/api/crawl/update-info').then(r => r.json()),
  triggerUpdate: (): Promise<{ message: string }> =>
    fetch('/api/crawl/update', { method: 'POST' }).then(async r => {
      if (!r.ok) {
        const b = await r.json().catch(() => ({}))
        throw new Error((b as { detail?: string }).detail ?? r.statusText)
      }
      return r.json()
    }),
  crawlSymbol: (symbol: string): Promise<{ message: string; symbol: string }> =>
    fetch(`/api/symbols/${encodeURIComponent(symbol)}/crawl`, { method: 'POST' }).then(async r => {
      if (!r.ok) {
        const b = await r.json().catch(() => ({}))
        throw new Error((b as { detail?: string }).detail ?? r.statusText)
      }
      return r.json()
    }),
  wyckoffSignals: (signal = '', phase = '', limit = 100, offset = 0): Promise<WyckoffPage> =>
    fetch(`/api/wyckoff/signals?signal=${signal}&phase=${encodeURIComponent(phase)}&limit=${limit}&offset=${offset}`)
      .then(r => r.json()),
  wyckoffSignal: (symbol: string): Promise<WyckoffSignal> =>
    fetch(`/api/symbols/${encodeURIComponent(symbol)}/wyckoff`).then(r => r.json()),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buyNow: (universe = 'vn100', maxGap = 5, rsiMax = 80): Promise<any> =>
    fetch(`/api/buy-now?universe=${universe}&max_gap=${maxGap}&rsi_max=${rsiMax}`).then(r => r.json()),
  computeWyckoff: (exchanges = 'all'): Promise<{ message: string; exchanges: string[] | string }> =>
    fetch(`/api/wyckoff/compute?exchanges=${encodeURIComponent(exchanges)}`, { method: 'POST' })
      .then(r => r.json()),
  reportAnalysis: (symbol: string, provider = 'gemini'): Promise<ReportAnalysis> =>
    fetch(`/api/symbols/${encodeURIComponent(symbol)}/report-analysis?provider=${provider}`).then(r => r.json()),
  computeReportAnalysis: (symbol: string, provider = 'gemini'): Promise<{ message: string; symbol: string; provider: string }> =>
    fetch(`/api/symbols/${encodeURIComponent(symbol)}/report-analysis?provider=${provider}`, { method: 'POST' })
      .then(async r => {
        if (!r.ok) throw new Error((await r.json()).detail ?? `HTTP ${r.status}`)
        return r.json()
      }),
  multifactorSignals: (signal = '', minScore = 0, confidence = '', limit = 2000, offset = 0): Promise<MultifactorPage> =>
    fetch(`/api/multifactor/signals?signal=${signal}&min_score=${minScore}&confidence=${confidence}&limit=${limit}&offset=${offset}`)
      .then(r => r.json()),
  multifactorSignal: (symbol: string): Promise<MultifactorSignal> =>
    fetch(`/api/symbols/${encodeURIComponent(symbol)}/multifactor`).then(r => r.json()),
  computeMultifactor: (exchanges = 'all'): Promise<{ message: string; exchanges: string[] | string }> =>
    fetch(`/api/multifactor/compute?exchanges=${encodeURIComponent(exchanges)}`, { method: 'POST' })
      .then(r => r.json()),
  predictions: (signal = '', horizon = 5, limit = 2000, offset = 0): Promise<PredictionPage> =>
    fetch(`/api/predictions?signal=${signal}&horizon=${horizon}&limit=${limit}&offset=${offset}`)
      .then(r => r.json()),
  prediction: (symbol: string): Promise<Prediction> =>
    fetch(`/api/symbols/${encodeURIComponent(symbol)}/prediction`).then(r => r.json()),
  computePredictions: (exchanges = 'HOSE,HNX'): Promise<{ message: string; exchanges: string[] }> =>
    fetch(`/api/predictions/compute?exchanges=${encodeURIComponent(exchanges)}`, { method: 'POST' })
      .then(r => r.json()),
  backtest: (
    symbol: string,
    strategy = 'both',
    horizon = 20,
    maxHold = 60,
  ): Promise<import('./types').BacktestResponse> =>
    fetch(`/api/backtest/${encodeURIComponent(symbol)}?strategy=${strategy}&horizon=${horizon}&max_hold=${maxHold}`)
      .then(async r => {
        if (!r.ok) {
          const b = await r.json().catch(() => ({}))
          throw new Error((b as { detail?: string }).detail ?? r.statusText)
        }
        return r.json()
      }),
  // ── Portfolio backtest (Wyckoff over a basket) ───────────────────────────
  portfolioBacktest: (): Promise<PortfolioBacktest | null> =>
    fetch('/api/portfolio-backtest').then(r => r.json()),
  runPortfolioBacktest: (
    symbols: string[], label: string, startDate: string, capital: number, slots: number,
  ): Promise<{ message: string; label: string }> =>
    fetch('/api/portfolio-backtest', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ symbols, label, start_date: startDate, capital, slots }),
    }).then(async r => {
      if (!r.ok) {
        const b = await r.json().catch(() => ({}))
        throw new Error((b as { detail?: string }).detail ?? r.statusText)
      }
      return r.json()
    }),
  // ── Paper trades (assumed buys) ──────────────────────────────────────────
  portfolio: (status = ''): Promise<PortfolioPage> =>
    fetch(`/api/portfolio?status=${status}`).then(r => r.json()),
  buyStock: (symbol: string, quantity = 1000, note = ''): Promise<{ id: number; symbol: string; buy_price: number; quantity: number }> =>
    fetch('/api/portfolio', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ symbol, quantity, note }),
    }).then(async r => {
      if (!r.ok) {
        const b = await r.json().catch(() => ({}))
        throw new Error((b as { detail?: string }).detail ?? r.statusText)
      }
      return r.json()
    }),
  closeTrade: (id: number): Promise<{ id: number; close_price: number }> =>
    fetch(`/api/portfolio/${id}/close`, { method: 'POST' }).then(async r => {
      if (!r.ok) {
        const b = await r.json().catch(() => ({}))
        throw new Error((b as { detail?: string }).detail ?? r.statusText)
      }
      return r.json()
    }),
  deleteTrade: (id: number): Promise<{ id: number; deleted: boolean }> =>
    fetch(`/api/portfolio/${id}`, { method: 'DELETE' }).then(r => r.json()),
  crawl:   (date: string, jobs: string[]): Promise<{ message: string }> =>
    fetch('/api/crawl', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ date, jobs }),
    }).then(async r => {
      if (!r.ok) {
        const b = await r.json().catch(() => ({}))
        throw new Error((b as { detail?: string }).detail ?? r.statusText)
      }
      return r.json()
    }),
  // ── Derivatives (VN30F1M / VN30F2M / VN30 index) ─────────────────────────
  derivativesSummary: (): Promise<DerivativesSummary> =>
    fetch('/api/derivatives/summary').then(r => r.json()),
  derivativesQuotes: (symbol: string, days = 120): Promise<Quote[]> =>
    fetch(`/api/derivatives/quotes/${encodeURIComponent(symbol)}?days=${days}`).then(r => r.json()),
  basis: (days = 90): Promise<BasisRow[]> =>
    fetch(`/api/derivatives/basis?days=${days}`).then(r => r.json()),
  derivativesOi: (symbol: string, days = 90): Promise<DerivativesOi[]> =>
    fetch(`/api/derivatives/oi/${encodeURIComponent(symbol)}?days=${days}`).then(r => r.json()),
  derivativesIntraday: (symbol: string, tf = '5', days = 10): Promise<IntradayBar[]> =>
    fetch(`/api/derivatives/intraday/${encodeURIComponent(symbol)}?tf=${tf}&days=${days}`).then(r => r.json()),
  computeDerivatives: (): Promise<{ message: string }> =>
    fetch('/api/derivatives/compute', { method: 'POST' }).then(async r => {
      if (!r.ok) {
        const b = await r.json().catch(() => ({}))
        throw new Error((b as { detail?: string }).detail ?? r.statusText)
      }
      return r.json()
    }),
  // ── Mutual funds (fmarket equity funds & holdings) ───────────────────────
  funds: (): Promise<FundsPage> =>
    fetch('/api/funds').then(r => r.json()),
  refreshFunds: (): Promise<{ message: string }> =>
    fetch('/api/funds/refresh', { method: 'POST' }).then(async r => {
      if (!r.ok) {
        const b = await r.json().catch(() => ({}))
        throw new Error((b as { detail?: string }).detail ?? r.statusText)
      }
      return r.json()
    }),
  // ── Wyckoff-Optimized (regime + walk-forward backtest) ───────────────────
  regimeLatest: (): Promise<RegimeRow> =>
    fetch('/api/regime/latest').then(r => r.json()),
  regimeHistory: (days = 365): Promise<RegimeRow[]> =>
    fetch(`/api/regime/history?days=${days}`).then(r => r.json()),
  backtestRuns: (limit = 20): Promise<BacktestRun[]> =>
    fetch(`/api/backtest/runs?limit=${limit}`).then(r => r.json()),
  backtestTrades: (runId: number): Promise<BacktestTradeRow[]> =>
    fetch(`/api/backtest/trades/${runId}`).then(r => r.json()),
  backtestParams: (): Promise<Record<string, { params: Record<string, number>; sharpe: number | null }>> =>
    fetch('/api/backtest/params').then(r => r.json()),
  backtestProgress: (): Promise<BacktestProgress> =>
    fetch('/api/backtest/progress').then(r => r.json()),
  runBacktest: (capital: number, samples = 200): Promise<{ status: string; message: string }> =>
    fetch(`/api/backtest/run?capital=${capital}&samples=${samples}`, { method: 'POST' }).then(async r => {
      if (!r.ok) {
        const b = await r.json().catch(() => ({}))
        throw new Error((b as { detail?: string }).detail ?? r.statusText)
      }
      return r.json()
    }),
  wyckoffOpt: (symbol: string): Promise<WyckoffOptSignal> =>
    fetch(`/api/wyckoff-opt/${encodeURIComponent(symbol)}`).then(async r => {
      if (!r.ok) {
        const b = await r.json().catch(() => ({}))
        throw new Error((b as { detail?: string }).detail ?? r.statusText)
      }
      return r.json()
    }),
}

// ── Wyckoff-Optimized response shapes ───────────────────────────────────────

export interface RegimeRow {
  date?: string; regime: string; vnindex?: number | null
  ma20?: number | null; ma50?: number | null; ma200?: number | null
  macd_hist?: number | null; drawdown?: number | null; wyckoff_phase?: string | null
}
export interface BacktestProgress {
  active: boolean; running?: boolean; phase: string | null; message?: string
  phase_current?: number; phase_total?: number; overall_pct: number
  elapsed_sec?: number; eta_sec?: number | null
}
export interface BacktestRun {
  id: number; run_at: string | null; capital: number | null
  train_start?: string; train_end?: string; test_start?: string; test_end?: string
  regime_scope?: string; annual_return: number | null; total_return: number | null
  sharpe_ratio: number | null; max_drawdown: number | null; win_rate: number | null
  total_trades: number | null; avg_hold_days: number | null
  by_year?: Record<string, number>; indicator_ic?: Record<string, number>; notes?: string
}
export interface BacktestTradeRow {
  id: number; symbol: string; entry_date: string; entry_price: number
  exit_date: string | null; exit_price: number | null; shares: number
  pnl: number; pnl_pct: number; hold_days: number | null; exit_type: string
  regime_at_entry: string; wyckoff_phase: string; sector: string; ecosystem: string | null
}
export interface WyckoffOptSignal {
  symbol: string; signal: string; score: number; phase: string; sub_phase: string
  current_price: number | null; entry_price: number | null; stop_loss: number | null
  rsi: number | null; macd_hist: number | null; bb_width: number | null
  force_index: number | null; cmf: number | null; vroc: number | null
  stoch_rsi: number | null; rs: number | null; atr: number | null
  regime: string | null; indicators: Record<string, number | null>; reasons: string[]
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const ALL_JOBS = ['symbols', 'quotes', 'history', 'foreign', 'news', 'fundamentals'] as const
export type Job = typeof ALL_JOBS[number]
export const JOB_LABELS: Record<Job, string> = {
  symbols:      'Symbols',
  quotes:       'Today OHLCV',
  history:      'Full History (all time)',
  foreign:      'Foreign flow',
  news:         'News',
  fundamentals: 'Fundamentals',
}

export const PAGE_SIZE = 50
