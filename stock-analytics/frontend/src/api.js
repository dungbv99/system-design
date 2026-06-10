export const VN_INDICES = {
    vn30: {
        label: 'VN30',
        color: '#3b82f6',
        symbols: [
            'ACB', 'BID', 'BSR', 'CTG', 'FPT', 'GAS', 'GVR', 'HDB', 'HPG', 'LPB',
            'MBB', 'MSN', 'MWG', 'PLX', 'SAB', 'SHB', 'SSB', 'SSI', 'STB', 'TCB',
            'TPB', 'VCB', 'VHM', 'VIB', 'VIC', 'VJC', 'VNM', 'VPB', 'VPL', 'VRE',
        ],
    },
    vn100: {
        label: 'VN100',
        color: '#8b5cf6',
        symbols: [
            // VN30
            'ACB', 'BID', 'BSR', 'CTG', 'FPT', 'GAS', 'GVR', 'HDB', 'HPG', 'LPB',
            'MBB', 'MSN', 'MWG', 'PLX', 'SAB', 'SHB', 'SSB', 'SSI', 'STB', 'TCB',
            'TPB', 'VCB', 'VHM', 'VIB', 'VIC', 'VJC', 'VNM', 'VPB', 'VPL', 'VRE',
            // VN MidCap (VN100 = VN30 + VNMID)
            'ANV', 'BAF', 'BCM', 'BMP', 'BSI', 'BVH', 'BWE', 'CII', 'CMG', 'CTD',
            'CTR', 'CTS', 'DBC', 'DCM', 'DGW', 'DIG', 'DPM', 'DSE', 'DXG', 'DXS',
            'EIB', 'EVF', 'FRT', 'FTS', 'GEE', 'GEX', 'GMD', 'HAG', 'HCM', 'HDC',
            'HDG', 'HHV', 'HSG', 'HT1', 'IMP', 'KBC', 'KDC', 'KDH', 'KOS', 'MSB',
            'NAB', 'NKG', 'NLG', 'NT2', 'NVL', 'OCB', 'PAN', 'PC1', 'PDR', 'PHR',
            'PNJ', 'POW', 'PVD', 'PVT', 'REE', 'SBT', 'SCS', 'SIP', 'SJS', 'SZC',
            'TCH', 'VCG', 'VCI', 'VGC', 'VHC', 'VIX', 'VND', 'VPI', 'VSC', 'VTP',
        ],
    },
    vnmid: {
        label: 'VN MidCap',
        color: '#f97316',
        symbols: [
            'ANV', 'BAF', 'BCM', 'BMP', 'BSI', 'BVH', 'BWE', 'CII', 'CMG', 'CTD',
            'CTR', 'CTS', 'DBC', 'DCM', 'DGW', 'DIG', 'DPM', 'DSE', 'DXG', 'DXS',
            'EIB', 'EVF', 'FRT', 'FTS', 'GEE', 'GEX', 'GMD', 'HAG', 'HCM', 'HDC',
            'HDG', 'HHV', 'HSG', 'HT1', 'IMP', 'KBC', 'KDC', 'KDH', 'KOS', 'MSB',
            'NAB', 'NKG', 'NLG', 'NT2', 'NVL', 'OCB', 'PAN', 'PC1', 'PDR', 'PHR',
            'PNJ', 'POW', 'PVD', 'PVT', 'REE', 'SBT', 'SCS', 'SIP', 'SJS', 'SZC',
            'TCH', 'VCG', 'VCI', 'VGC', 'VHC', 'VIX', 'VND', 'VPI', 'VSC', 'VTP',
        ],
    },
    vnsml: {
        label: 'VN SmallCap',
        color: '#f59e0b',
        symbols: [
            'AAA', 'AAM', 'ABT', 'ACC', 'ACL', 'ADG', 'ADP', 'ADS', 'AGG', 'AGR',
            'APG', 'APH', 'ASM', 'ASP', 'AST', 'BCE', 'BFC', 'BIC', 'BKG', 'BMC',
            'BMI', 'BRC', 'BTP', 'C32', 'CCC', 'CCL', 'CDC', 'CHP', 'CIG', 'CKG',
            'CLL', 'CMX', 'CNG', 'CRC', 'CRE', 'CSM', 'CSV', 'CTF', 'CTI', 'D2D',
            'DAH', 'DBD', 'DC4', 'DCL', 'DHA', 'DHC', 'DHM', 'DLG', 'DMC', 'DPG',
            'DPR', 'DRC', 'DRL', 'DSC', 'DSN', 'DTA', 'DVP', 'DXV', 'ELC', 'EVE',
            'EVG', 'FCM', 'FCN', 'FIR', 'FIT', 'FMC', 'GDT', 'GEG', 'GIL', 'GSP',
            'HAH', 'HAP', 'HAR', 'HAX', 'HCD', 'HHP', 'HHS', 'HID', 'HII', 'HMC',
            'HPX', 'HQC', 'HSL', 'HTG', 'HTI', 'HTN', 'HTV', 'HUB', 'HVH', 'ICT',
            'IDI', 'IJC', 'ILB', 'ITC', 'ITD', 'JVC', 'KHG', 'KHP', 'KMR', 'KSB',
            'LAF', 'LBM', 'LCG', 'LGL', 'LHG', 'LIX', 'LSS', 'MCM', 'MCP', 'MHC',
            'MIG', 'MSH', 'NAF', 'NAV', 'NBB', 'NCT', 'NHA', 'NHH', 'NNC', 'NO1',
            'NSC', 'NTL', 'OGC', 'ORS', 'PAC', 'PET', 'PGC', 'PHC', 'PIT', 'PLP',
            'PPC', 'PTB', 'PTC', 'PTL', 'PVP', 'QCG', 'RAL', 'RYG', 'SAM', 'SAV',
            'SBG', 'SCR', 'SFC', 'SFI', 'SGN', 'SGR', 'SGT', 'SHA', 'SHI', 'SJD',
            'SKG', 'SMB', 'ST8', 'STK', 'SVD', 'SVT', 'SZL', 'TCI', 'TCL', 'TCM',
            'TCO', 'TCT', 'TDC', 'TDG', 'TDH', 'TDP', 'TEG', 'THG', 'TIP', 'TLD',
            'TLG', 'TLH', 'TMT', 'TN1', 'TNH', 'TNI', 'TNT', 'TRC', 'TSC', 'TTA',
            'TTF', 'TV2', 'TVB', 'TVS', 'UIC', 'VCA', 'VDS', 'VFG', 'VIP', 'VNL',
            'VOS', 'VPG', 'VPH', 'VPS', 'VRC', 'VSI', 'VTB', 'VTO', 'YBM', 'YEG',
        ],
    },
    vnsi: {
        label: 'VNSI',
        color: '#ec4899',
        symbols: [
            'BCM', 'BID', 'BMP', 'BVH', 'CTD', 'CTG', 'DCM', 'GEX', 'HDB', 'IMP',
            'MBB', 'MWG', 'PAN', 'PVD', 'SBT', 'TCB', 'VCB', 'VIC', 'VNM', 'VPB',
        ],
    },
    vnx50: {
        label: 'VNX50',
        color: '#06b6d4',
        symbols: [
            'ACB', 'BID', 'BSR', 'CTG', 'DCM', 'DPM', 'DXG', 'EIB', 'FPT', 'FRT',
            'GEE', 'GEX', 'GMD', 'HCM', 'HDB', 'HPG', 'IDC', 'KBC', 'KDH', 'LPB',
            'MBB', 'MSB', 'MSN', 'MWG', 'NLG', 'NVL', 'PDR', 'PLX', 'PNJ', 'POW',
            'PVS', 'SHB', 'SHS', 'SSI', 'STB', 'TCB', 'TPB', 'VCB', 'VCG', 'VCI',
            'VHM', 'VIB', 'VIC', 'VIX', 'VJC', 'VND', 'VNM', 'VPB', 'VPI', 'VRE',
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
};
export const VN_SECTORS = {
    vnfin: {
        label: 'Financials', labelVi: 'Tài chính', color: '#3b82f6',
        symbols: [
            'ACB', 'AGR', 'APG', 'BIC', 'BID', 'BMI', 'BSI', 'BVH', 'CTG', 'CTS',
            'DSC', 'DSE', 'EIB', 'EVF', 'FIT', 'FTS', 'HCM', 'HDB', 'LPB', 'MBB',
            'MIG', 'MSB', 'NAB', 'OCB', 'OGC', 'ORS', 'SHB', 'SSB', 'SSI', 'STB',
            'TCB', 'TCI', 'TPB', 'TVB', 'TVS', 'VCB', 'VCI', 'VDS', 'VIB', 'VIX',
            'VND', 'VPB',
        ],
    },
    vnreal: {
        label: 'Real Estate', labelVi: 'Bất động sản', color: '#f97316',
        symbols: [
            'AGG', 'ASM', 'BCM', 'CCL', 'CIG', 'CKG', 'CRE', 'D2D', 'DTA', 'DXG',
            'DXS', 'FIR', 'HAR', 'HDC', 'HPX', 'HQC', 'ITC', 'KBC', 'KDH', 'KHG',
            'KOS', 'LHG', 'NBB', 'NLG', 'NTL', 'NVL', 'PDR', 'PTL', 'QCG', 'SCR',
            'SGR', 'SIP', 'SJS', 'SZL', 'TDC', 'TDH', 'TEG', 'TN1', 'VHM', 'VIC',
            'VPH', 'VPI', 'VRE',
        ],
    },
    vnind: {
        label: 'Industrials', labelVi: 'Công nghiệp', color: '#8b5cf6',
        symbols: [
            'BCE', 'BKG', 'BMP', 'BRC', 'C32', 'CCC', 'CDC', 'CII', 'CLL', 'CTD',
            'CTR', 'DC4', 'DIG', 'DLG', 'DPG', 'DVP', 'EVG', 'FCN', 'GEE', 'GEX',
            'GMD', 'HAH', 'HCD', 'HDG', 'HHV', 'HID', 'HTI', 'HTN', 'HTV', 'HUB',
            'HVH', 'IJC', 'ILB', 'ITD', 'LCG', 'LGL', 'MHC', 'NCT', 'NHA', 'NO1',
            'PC1', 'PET', 'PHC', 'PIT', 'PTC', 'RAL', 'REE', 'RYG', 'SAM', 'SBG',
            'SCS', 'SFI', 'SGN', 'SHA', 'SHI', 'SKG', 'ST8', 'SZC', 'TCH', 'TCL',
            'TCO', 'TIP', 'TLG', 'TNI', 'TSC', 'TV2', 'VCG', 'VGC', 'VIP', 'VJC',
            'VNL', 'VOS', 'VPG', 'VRC', 'VSC', 'VSI', 'VTO', 'VTP',
        ],
    },
    vnmat: {
        label: 'Materials', labelVi: 'Vật liệu', color: '#f59e0b',
        symbols: [
            'AAA', 'ACC', 'ADP', 'APH', 'BFC', 'BMC', 'CRC', 'CSV', 'CTI', 'DCM',
            'DHA', 'DHC', 'DHM', 'DPM', 'DPR', 'DXV', 'FCM', 'GVR', 'HAP', 'HHP',
            'HII', 'HMC', 'HPG', 'HSG', 'HT1', 'KSB', 'LBM', 'MCP', 'NAV', 'NHH',
            'NKG', 'NNC', 'PHR', 'PLP', 'TDP', 'THG', 'TLD', 'TLH', 'TNT', 'TRC',
            'VCA', 'VFG', 'VPS', 'YBM',
        ],
    },
    vncond: {
        label: 'Consumer Discret.', labelVi: 'Tiêu dùng tùy ý', color: '#ec4899',
        symbols: [
            'ADS', 'AST', 'CSM', 'CTF', 'DAH', 'DRC', 'DSN', 'EVE', 'FRT', 'GDT',
            'GIL', 'HAX', 'HHS', 'HTG', 'KMR', 'MSH', 'MWG', 'PAC', 'PNJ', 'PTB',
            'SAV', 'SFC', 'STK', 'SVD', 'SVT', 'TCM', 'TCT', 'TMT', 'TTF', 'VPL', 'VTB',
        ],
    },
    vncons: {
        label: 'Consumer Staples', labelVi: 'Tiêu dùng thiết yếu', color: '#10b981',
        symbols: [
            'AAM', 'ABT', 'ACL', 'ANV', 'BAF', 'CMX', 'DBC', 'FMC', 'HAG', 'HSL',
            'IDI', 'KDC', 'LAF', 'LIX', 'LSS', 'MCM', 'MSN', 'NAF', 'NSC', 'PAN',
            'SAB', 'SBT', 'SMB', 'VHC', 'VNM',
        ],
    },
    vnene: {
        label: 'Energy', labelVi: 'Năng lượng', color: '#f97316',
        symbols: ['ASP', 'BSR', 'CNG', 'GSP', 'PGC', 'PLX', 'PVD', 'PVP', 'PVT', 'TDG'],
    },
    vnheal: {
        label: 'Healthcare', labelVi: 'Y tế - Dược', color: '#06b6d4',
        symbols: ['DBD', 'DCL', 'DMC', 'IMP', 'JVC', 'TNH'],
    },
    vnit: {
        label: 'Technology', labelVi: 'Công nghệ', color: '#84cc16',
        symbols: ['CMG', 'DGW', 'ELC', 'FPT', 'ICT'],
    },
    vnuti: {
        label: 'Utilities', labelVi: 'Tiện ích', color: '#14b8a6',
        symbols: ['BTP', 'BWE', 'CHP', 'DRL', 'GAS', 'GEG', 'KHP', 'NT2', 'POW', 'PPC', 'SJD', 'TTA', 'UIC'],
    },
};
// ── API client ────────────────────────────────────────────────────────────────
export const api = {
    compositions: () => fetch('/api/index-compositions').then(r => r.json()),
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
    computeWyckoff: (exchanges = 'all') => fetch(`/api/wyckoff/compute?exchanges=${encodeURIComponent(exchanges)}`, { method: 'POST' })
        .then(r => r.json()),
    multifactorSignals: (signal = '', minScore = 0, confidence = '', limit = 2000, offset = 0) => fetch(`/api/multifactor/signals?signal=${signal}&min_score=${minScore}&confidence=${confidence}&limit=${limit}&offset=${offset}`)
        .then(r => r.json()),
    multifactorSignal: (symbol) => fetch(`/api/symbols/${encodeURIComponent(symbol)}/multifactor`).then(r => r.json()),
    computeMultifactor: (exchanges = 'all') => fetch(`/api/multifactor/compute?exchanges=${encodeURIComponent(exchanges)}`, { method: 'POST' })
        .then(r => r.json()),
    predictions: (signal = '', horizon = 5, limit = 2000, offset = 0) => fetch(`/api/predictions?signal=${signal}&horizon=${horizon}&limit=${limit}&offset=${offset}`)
        .then(r => r.json()),
    prediction: (symbol) => fetch(`/api/symbols/${encodeURIComponent(symbol)}/prediction`).then(r => r.json()),
    computePredictions: (exchanges = 'HOSE,HNX') => fetch(`/api/predictions/compute?exchanges=${encodeURIComponent(exchanges)}`, { method: 'POST' })
        .then(r => r.json()),
    backtest: (symbol, strategy = 'both', horizon = 20, maxHold = 60) => fetch(`/api/backtest/${encodeURIComponent(symbol)}?strategy=${strategy}&horizon=${horizon}&max_hold=${maxHold}`)
        .then(async (r) => {
        if (!r.ok) {
            const b = await r.json().catch(() => ({}));
            throw new Error(b.detail ?? r.statusText);
        }
        return r.json();
    }),
    // ── Paper trades (assumed buys) ──────────────────────────────────────────
    portfolio: (status = '') => fetch(`/api/portfolio?status=${status}`).then(r => r.json()),
    buyStock: (symbol, quantity = 1000, note = '') => fetch('/api/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, quantity, note }),
    }).then(async (r) => {
        if (!r.ok) {
            const b = await r.json().catch(() => ({}));
            throw new Error(b.detail ?? r.statusText);
        }
        return r.json();
    }),
    closeTrade: (id) => fetch(`/api/portfolio/${id}/close`, { method: 'POST' }).then(async (r) => {
        if (!r.ok) {
            const b = await r.json().catch(() => ({}));
            throw new Error(b.detail ?? r.statusText);
        }
        return r.json();
    }),
    deleteTrade: (id) => fetch(`/api/portfolio/${id}`, { method: 'DELETE' }).then(r => r.json()),
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
