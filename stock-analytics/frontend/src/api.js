// ── VN Index constituents (HOSE, approximate – rebalanced quarterly) ──────────
export const VN_INDICES = {
    vn30: {
        label: 'VN30',
        color: '#3b82f6',
        symbols: [
            'ACB', 'BCM', 'BID', 'BVH', 'CTG', 'FPT', 'GAS', 'GVR', 'HDB', 'HPG',
            'MBB', 'MSN', 'MWG', 'PLX', 'POW', 'SAB', 'SHB', 'SSB', 'SSI', 'STB',
            'TCB', 'TPB', 'VCB', 'VHM', 'VIB', 'VIC', 'VJC', 'VNM', 'VPB', 'VRE',
        ],
    },
    vnmidcap: {
        label: 'VN MidCap',
        color: '#8b5cf6',
        symbols: [
            'APH', 'ASM', 'BCG', 'BSR', 'BTP', 'CAV', 'CMG', 'CNG', 'CRE', 'CTD',
            'DBC', 'DCM', 'DGW', 'DHC', 'DIG', 'DPM', 'EIB', 'EVF', 'GEE', 'GEX',
            'GMD', 'HAH', 'HAR', 'HCM', 'HHS', 'HSG', 'HTN', 'IDC', 'IMP', 'KBC',
            'KDH', 'KHG', 'LDG', 'LHG', 'MSB', 'NLG', 'NTC', 'NVL', 'PDR', 'PHR',
            'PNJ', 'PPC', 'PTB', 'QNS', 'REE', 'SBT', 'SBV', 'SJS', 'SZC', 'TBC',
            'TLG', 'TNG', 'VCI', 'VGC', 'VIX', 'VMC', 'VND', 'VPH', 'VRC', 'VTP',
            'AGG', 'ALT', 'CII', 'DRC', 'HAG', 'HVN', 'KDC', 'LCG', 'PVD', 'VHC',
        ],
    },
    vnsmallcap: {
        label: 'VN SmallCap',
        color: '#f59e0b',
        symbols: [
            'AGR', 'ACC', 'BFC', 'BRC', 'BSI', 'BVS', 'BWE', 'CCL', 'CEO', 'CSV',
            'CTB', 'CTI', 'DVP', 'FTS', 'GMC', 'HAX', 'HBC', 'HDG', 'HUT', 'IJC',
            'ITA', 'KSB', 'LCS', 'LIX', 'MCG', 'MCP', 'NBB', 'NHH', 'NTL', 'NTP',
            'ORS', 'PC1', 'PGC', 'PGD', 'POT', 'PVP', 'PVT', 'QCG', 'RAL', 'SCR',
            'SFC', 'SFG', 'SHI', 'SIP', 'SMC', 'SRC', 'SVC', 'TDG', 'TDH', 'TDP',
            'TDW', 'TGG', 'THG', 'TIP', 'TIX', 'TPC', 'TRA', 'TRC', 'TSC', 'TTF',
            'TVB', 'TVS', 'UDC', 'VBH', 'VCG', 'VGI', 'VHD', 'VIS', 'VNL', 'VOS',
            'VSC', 'VSH', 'VST', 'VTO', 'WHS', 'BIC', 'CLC', 'CMC', 'CMP', 'CNT',
        ],
    },
    vndiamond: {
        label: 'VN Diamond',
        color: '#06b6d4',
        symbols: [
            'ACB', 'BMP', 'CMG', 'CTD', 'FPT', 'GMD', 'HCM', 'MWG', 'PAN',
            'PHR', 'PNJ', 'REE', 'SBT', 'STB', 'TCB', 'VNM', 'VPB',
        ],
    },
};
// ── API client ────────────────────────────────────────────────────────────────
export const api = {
    stats: () => fetch('/api/stats').then(r => r.json()),
    status: () => fetch('/api/crawl/status').then(r => r.json()),
    runs: (limit = 40) => fetch(`/api/crawl/runs?limit=${limit}`).then(r => r.json()),
    symbols: (q = '', limit = 50, offset = 0, exchange = '', symbolsList = '') => fetch(`/api/symbols/list?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}&exchange=${exchange}&symbols=${encodeURIComponent(symbolsList)}`).then(r => r.json()),
    quotes: (symbol, days = 60) => fetch(`/api/symbols/${symbol}/quotes?days=${days}`).then(r => r.json()),
    fetchHistory: (symbol) => fetch(`/api/symbols/${encodeURIComponent(symbol)}/history`, { method: 'POST' }).then(r => r.json()),
    updateInfo: () => fetch('/api/crawl/update-info').then(r => r.json()),
    triggerUpdate: () => fetch('/api/crawl/update', { method: 'POST' }).then(async (r) => {
        if (!r.ok) {
            const b = await r.json().catch(() => ({}));
            throw new Error(b.detail ?? r.statusText);
        }
        return r.json();
    }),
    crawlSymbol: (symbol) => fetch(`/api/symbols/${encodeURIComponent(symbol)}/crawl`, { method: 'POST' }).then(async (r) => {
        if (!r.ok) {
            const b = await r.json().catch(() => ({}));
            throw new Error(b.detail ?? r.statusText);
        }
        return r.json();
    }),
    wyckoffSignals: (signal = '', phase = '', limit = 100, offset = 0) => fetch(`/api/wyckoff/signals?signal=${signal}&phase=${encodeURIComponent(phase)}&limit=${limit}&offset=${offset}`)
        .then(r => r.json()),
    wyckoffSignal: (symbol) => fetch(`/api/symbols/${encodeURIComponent(symbol)}/wyckoff`).then(r => r.json()),
    computeWyckoff: (exchanges = 'HOSE,HNX') => fetch(`/api/wyckoff/compute?exchanges=${encodeURIComponent(exchanges)}`, { method: 'POST' })
        .then(r => r.json()),
    crawl: (date, jobs) => fetch('/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, jobs }),
    }).then(async (r) => {
        if (!r.ok) {
            const b = await r.json().catch(() => ({}));
            throw new Error(b.detail ?? r.statusText);
        }
        return r.json();
    }),
};
// ── Constants ─────────────────────────────────────────────────────────────────
export const ALL_JOBS = ['symbols', 'quotes', 'history', 'foreign', 'news', 'fundamentals'];
export const JOB_LABELS = {
    symbols: 'Symbols',
    quotes: 'Today OHLCV',
    history: 'Full History (all time)',
    foreign: 'Foreign flow',
    news: 'News',
    fundamentals: 'Fundamentals',
};
export const PAGE_SIZE = 50;
