-- ── Symbols ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS symbols (
    symbol      VARCHAR(50)  PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    exchange    VARCHAR(10),              -- HOSE | HNX | UPCOM
    industry    VARCHAR(255),
    updated_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- ── Daily OHLCV ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS daily_quotes (
    symbol   VARCHAR(50)  NOT NULL REFERENCES symbols(symbol) ON DELETE CASCADE,
    date     DATE         NOT NULL,
    open     NUMERIC(12,2),
    high     NUMERIC(12,2),
    low      NUMERIC(12,2),
    close    NUMERIC(12,2),
    volume   BIGINT,
    value    NUMERIC(20,2),             -- total trading value (VND)
    PRIMARY KEY (symbol, date)
);

-- ── Foreign investor flow ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS foreign_trading (
    symbol    VARCHAR(50)  NOT NULL REFERENCES symbols(symbol) ON DELETE CASCADE,
    date      DATE         NOT NULL,
    buy_vol   BIGINT,
    sell_vol  BIGINT,
    buy_val   NUMERIC(20,2),
    sell_val  NUMERIC(20,2),
    net_vol   BIGINT GENERATED ALWAYS AS (buy_vol - sell_vol) STORED,
    PRIMARY KEY (symbol, date)
);

-- ── Company fundamentals (quarterly) ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fundamentals (
    symbol      VARCHAR(50)   NOT NULL REFERENCES symbols(symbol) ON DELETE CASCADE,
    year        SMALLINT      NOT NULL,
    quarter     SMALLINT      NOT NULL,  -- 0 = annual
    revenue     NUMERIC(20,2),
    net_profit  NUMERIC(20,2),
    eps         NUMERIC(12,2),
    pe          NUMERIC(10,2),
    pb          NUMERIC(10,2),
    roe         NUMERIC(8,4),
    roa         NUMERIC(8,4),
    fetched_at  TIMESTAMP     NOT NULL DEFAULT NOW(),
    PRIMARY KEY (symbol, year, quarter)
);

-- ── News & company announcements ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS news (
    id           BIGSERIAL   PRIMARY KEY,
    symbol       VARCHAR(50),            -- NULL = market-wide news
    title        TEXT        NOT NULL,
    content      TEXT,
    source       VARCHAR(255),
    url          TEXT,
    published_at TIMESTAMP,
    fetched_at   TIMESTAMP   NOT NULL DEFAULT NOW(),
    UNIQUE (symbol, title, published_at)
);

-- ── Crawl audit log ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crawl_runs (
    id          BIGSERIAL   PRIMARY KEY,
    job         VARCHAR(50) NOT NULL,    -- symbols | quotes | foreign | fundamentals | news
    run_date    DATE        NOT NULL,
    started_at  TIMESTAMP   NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMP,
    status      VARCHAR(50) NOT NULL DEFAULT 'running',  -- running | done | error
    records     INT         NOT NULL DEFAULT 0,
    error       TEXT
);

-- ── Wyckoff Analysis Results ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wyckoff_signals (
    symbol          VARCHAR(50)  PRIMARY KEY REFERENCES symbols(symbol) ON DELETE CASCADE,
    analyzed_at     TIMESTAMP    NOT NULL,
    phase           VARCHAR(50)  NOT NULL,   -- Accumulation|Distribution|Markup|Markdown|Unknown
    sub_phase       VARCHAR(5)   NOT NULL,   -- A|B|C|D|E|-
    signal          VARCHAR(20)  NOT NULL,   -- BUY|SHORT|WAIT|HOLD
    signal_strength VARCHAR(20)  NOT NULL,   -- STRONG|MODERATE|WEAK
    support         NUMERIC(12,2),
    resistance      NUMERIC(12,2),
    current_price   NUMERIC(12,2),
    last_event      VARCHAR(20),             -- SC|Spring|SOS|LPS|BC|UT|LPSY …
    entry_price     NUMERIC(12,2),           -- optimal entry level
    stop_loss       NUMERIC(12,2),           -- stop-loss level
    target          NUMERIC(12,2),           -- take-profit level (= resistance for BUY)
    rr_ratio        NUMERIC(6,2),            -- reward/risk = (target-entry)/(entry-stop); BUY requires >= 1.5
    description     TEXT,
    bars_analyzed   INT          NOT NULL DEFAULT 0,
    score           INT,                     -- optimized confirmation score 0-8 (compute_wyckoff)
    updated_at      TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- ── Multi-Factor Signals ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS multifactor_signals (
    symbol           VARCHAR(50)   PRIMARY KEY REFERENCES symbols(symbol) ON DELETE CASCADE,
    analyzed_at      TIMESTAMPTZ   NOT NULL,
    total_score      INTEGER       NOT NULL,
    signal           VARCHAR(10)   NOT NULL,    -- BUY | WATCH | AVOID
    confidence       VARCHAR(10),               -- HIGH | MEDIUM | LOW
    factors_agreed   INTEGER,                   -- 0–4
    trend_score      INTEGER,
    momentum_score   INTEGER,
    volume_score     INTEGER,
    position_score   INTEGER,
    trend_reason     TEXT,
    momentum_reason  TEXT,
    volume_reason    TEXT,
    position_reason  TEXT,
    current_price    NUMERIC(12, 2),
    support          NUMERIC(12, 2),
    resistance       NUMERIC(12, 2),
    entry_price      NUMERIC(12, 2),
    stop_loss        NUMERIC(12, 2),
    description      TEXT,
    bars_analyzed    INTEGER,
    updated_at       TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mf_signal     ON multifactor_signals (signal);
CREATE INDEX IF NOT EXISTS idx_mf_score      ON multifactor_signals (total_score DESC);
CREATE INDEX IF NOT EXISTS idx_mf_updated    ON multifactor_signals (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_mf_confidence ON multifactor_signals (confidence);

-- ── XGBoost predictions ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS predictions (
    symbol        VARCHAR(50)  NOT NULL REFERENCES symbols(symbol) ON DELETE CASCADE,
    predicted_at  DATE         NOT NULL,
    horizon_days  INT          NOT NULL DEFAULT 5,
    score         NUMERIC(6,4) NOT NULL,   -- XGBoost BUY probability (0–1)
    signal        VARCHAR(10)  NOT NULL,   -- BUY | HOLD
    model_date    DATE         NOT NULL,   -- training-cutoff date for traceability
    PRIMARY KEY (symbol, predicted_at, horizon_days)
);

-- ── Portfolio backtest runs (Wyckoff over a basket, e.g. VN100) ───────────────

CREATE TABLE IF NOT EXISTS portfolio_backtests (
    id           BIGSERIAL   PRIMARY KEY,
    label        VARCHAR(100) NOT NULL,          -- e.g. 'VN100 Wyckoff 2018+'
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    params       JSONB        NOT NULL,          -- start_date, capital, slots, …
    summary      JSONB        NOT NULL,          -- headline metrics
    equity_curve JSONB        NOT NULL,          -- [{date, equity, drawdown_pct}]
    yearly       JSONB        NOT NULL,          -- [{year, return_pct, equity}]
    trades       JSONB        NOT NULL           -- executed trades
);

CREATE INDEX IF NOT EXISTS idx_portfolio_backtests_created ON portfolio_backtests (created_at DESC);

-- ── Paper trades (assumed buys, for performance review) ───────────────────────

CREATE TABLE IF NOT EXISTS paper_trades (
    id          BIGSERIAL     PRIMARY KEY,
    symbol      VARCHAR(50)   NOT NULL REFERENCES symbols(symbol) ON DELETE CASCADE,
    buy_date    DATE          NOT NULL DEFAULT CURRENT_DATE,
    buy_price   NUMERIC(12,2) NOT NULL,
    quantity    INTEGER       NOT NULL DEFAULT 1000,
    -- snapshot of the Wyckoff plan at buy time (optional)
    entry_price NUMERIC(12,2),
    stop_loss   NUMERIC(12,2),
    target      NUMERIC(12,2),
    phase       VARCHAR(50),
    signal      VARCHAR(20),
    note        TEXT,
    status      VARCHAR(10)   NOT NULL DEFAULT 'OPEN',  -- OPEN | CLOSED
    close_date  DATE,
    close_price NUMERIC(12,2),
    created_at  TIMESTAMP     NOT NULL DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_daily_quotes_date   ON daily_quotes  (date DESC);
CREATE INDEX IF NOT EXISTS idx_foreign_date        ON foreign_trading (date DESC);
CREATE INDEX IF NOT EXISTS idx_news_published      ON news          (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_symbol         ON news          (symbol);
CREATE INDEX IF NOT EXISTS idx_crawl_runs_job_date ON crawl_runs    (job, run_date DESC);
CREATE INDEX IF NOT EXISTS idx_wyckoff_signal      ON wyckoff_signals (signal, signal_strength);
CREATE INDEX IF NOT EXISTS idx_wyckoff_phase       ON wyckoff_signals (phase);
CREATE INDEX IF NOT EXISTS idx_predictions_signal  ON predictions   (signal, predicted_at DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_score   ON predictions   (predicted_at DESC, score DESC);
CREATE INDEX IF NOT EXISTS idx_paper_trades_status  ON paper_trades  (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_paper_trades_symbol  ON paper_trades  (symbol);

-- ── Quarterly financial-report analyses (Vietstock BCTC → LLM) ────────────────

CREATE TABLE IF NOT EXISTS report_analyses (
    symbol     VARCHAR(50) NOT NULL,
    year       SMALLINT    NOT NULL,
    quarter    SMALLINT    NOT NULL,
    title      TEXT,
    pdf_url    TEXT,
    model      VARCHAR(80),
    analysis   TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (symbol, year, quarter)
);

-- ── Mutual funds (equity funds) & their stock holdings — fmarket.vn ───────────
-- Refreshed wholesale on each "Update now": both tables are TRUNCATEd then
-- re-inserted, so any fund or stock that is no longer held simply disappears.

CREATE TABLE IF NOT EXISTS funds (
    fund_id          INTEGER      PRIMARY KEY,        -- fmarket product id
    short_name       VARCHAR(40)  NOT NULL,
    name             TEXT         NOT NULL,
    owner_name       TEXT,                            -- fund management company
    fund_type        VARCHAR(60),                     -- e.g. 'Quỹ cổ phiếu'
    nav              NUMERIC(16,2),                   -- NAV per unit (VND)
    nav_update_at    DATE,
    return_1m        NUMERIC(8,2),
    return_3m        NUMERIC(8,2),
    return_6m        NUMERIC(8,2),
    return_12m       NUMERIC(8,2),
    return_36m       NUMERIC(8,2),
    return_inception NUMERIC(8,2),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fund_holdings (
    id                BIGSERIAL    PRIMARY KEY,
    fund_id           INTEGER      NOT NULL REFERENCES funds(fund_id) ON DELETE CASCADE,
    stock_code        VARCHAR(20)  NOT NULL,
    industry          VARCHAR(120),
    net_asset_percent NUMERIC(8,2) NOT NULL DEFAULT 0,  -- % of fund NAV
    price             NUMERIC(16,2),
    update_at         DATE
);

CREATE INDEX IF NOT EXISTS idx_fund_holdings_fund  ON fund_holdings (fund_id);
CREATE INDEX IF NOT EXISTS idx_fund_holdings_stock ON fund_holdings (stock_code);

-- ── Derivatives (VN30F1M / VN30F2M futures + VN30 index) ──────────────────────
-- OHLCV is keyed by a logical symbol ('VN30F1M' | 'VN30F2M' | 'VN30'); the
-- crawler resolves F1M/F2M to the real front-month contract on each run, so the
-- series rolls forward automatically across monthly expiries. No FK to symbols
-- because VN30 / VN30F2M are not stock tickers.

CREATE TABLE IF NOT EXISTS derivatives_quotes (
    symbol   VARCHAR(20)  NOT NULL,        -- 'VN30F1M' | 'VN30F2M' | 'VN30'
    date     DATE         NOT NULL,
    open     NUMERIC(12,2),
    high     NUMERIC(12,2),
    low      NUMERIC(12,2),
    close    NUMERIC(12,2),
    volume   BIGINT,
    PRIMARY KEY (symbol, date)
);

CREATE INDEX IF NOT EXISTS idx_deriv_quotes_date ON derivatives_quotes (date DESC);

-- Open Interest per contract (optional — KBS does not provide it yet)
CREATE TABLE IF NOT EXISTS derivatives_oi (
    symbol        VARCHAR(20) NOT NULL,
    date          DATE        NOT NULL,
    open_interest BIGINT,
    oi_change     BIGINT,
    PRIMARY KEY (symbol, date)
);

-- Daily basis & calendar spread, computed from derivatives_quotes
CREATE TABLE IF NOT EXISTS derivatives_basis (
    date           DATE          PRIMARY KEY,
    f1m_close      NUMERIC(12,2),
    f2m_close      NUMERIC(12,2),
    vn30_close     NUMERIC(12,2),
    basis          NUMERIC(12,2),   -- f1m_close - vn30_close
    basis_pct      NUMERIC(8,4),    -- basis / vn30_close * 100
    spread_f1m_f2m NUMERIC(12,2),   -- f1m_close - f2m_close
    regime         VARCHAR(10),     -- 'PREMIUM' | 'DISCOUNT' | 'NEUTRAL'
    updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deriv_basis_date ON derivatives_basis (date DESC);

-- Synthetic symbols row so wyckoff_signals / multifactor_signals (which JOIN
-- symbols) can store and list VN30F1M alongside stocks with no query changes.
INSERT INTO symbols (symbol, name, exchange, industry)
VALUES ('VN30F1M', 'VN30 Index Futures (front month)', 'DERIV', 'Derivatives')
ON CONFLICT (symbol) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────────
-- Wyckoff-Optimized pipeline (README_WYCKOFF_OPTIMIZED.md §10)
-- ──────────────────────────────────────────────────────────────────────────────

-- Track VN100 membership. Mark the basket with:
--   UPDATE symbols SET is_vn100 = true WHERE symbol IN ('ACB','BID',...);
-- or via store.mark_vn100(list) / `make mark-vn100`.
ALTER TABLE symbols ADD COLUMN IF NOT EXISTS is_vn100 BOOLEAN DEFAULT FALSE;

-- Daily VNIndex regime classification
CREATE TABLE IF NOT EXISTS regime_history (
    date          DATE         PRIMARY KEY,
    regime        VARCHAR(12)  NOT NULL,   -- UPTREND | DOWNTREND | SIDEWAYS
    vnindex       NUMERIC(12,2),
    ma20          NUMERIC(12,2),
    ma50          NUMERIC(12,2),
    ma200         NUMERIC(12,2),
    macd_hist     NUMERIC(12,4),
    drawdown      NUMERIC(6,4),            -- from 60-day high
    wyckoff_phase VARCHAR(20),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_regime_date ON regime_history (date DESC);

-- Backtest run metadata
CREATE TABLE IF NOT EXISTS backtest_runs (
    id            SERIAL PRIMARY KEY,
    run_at        TIMESTAMPTZ DEFAULT NOW(),
    capital       NUMERIC(18,2),
    train_start   DATE,
    train_end     DATE,
    test_start    DATE,
    test_end      DATE,
    params        JSONB,
    regime_scope  VARCHAR(12),             -- UPTREND | SIDEWAYS | DOWNTREND | ALL
    annual_return NUMERIC(10,4),
    total_return  NUMERIC(10,4),
    sharpe_ratio  NUMERIC(8,3),
    max_drawdown  NUMERIC(6,4),
    win_rate      NUMERIC(6,4),
    total_trades  INTEGER,
    avg_hold_days NUMERIC(8,1),
    by_year       JSONB,
    indicator_ic  JSONB,
    notes         TEXT
);

-- Individual trade log
CREATE TABLE IF NOT EXISTS backtest_trades (
    id              SERIAL PRIMARY KEY,
    run_id          INTEGER REFERENCES backtest_runs(id) ON DELETE CASCADE,
    symbol          VARCHAR(20),
    entry_date      DATE,
    entry_price     NUMERIC(14,2),
    exit_date       DATE,
    exit_price      NUMERIC(14,2),
    shares          INTEGER,
    pnl             NUMERIC(16,2),
    pnl_pct         NUMERIC(10,4),
    hold_days       INTEGER,
    exit_type       VARCHAR(20),           -- STOP_LOSS | WYCKOFF_EXIT | REGIME_EXIT | MAX_HOLD | RS_EXIT | END_OF_DATA
    regime_at_entry VARCHAR(12),
    wyckoff_phase   VARCHAR(30),
    sector          VARCHAR(80),
    ecosystem       VARCHAR(30)            -- VINGROUP | GELEX | NULL
);
CREATE INDEX IF NOT EXISTS idx_bt_trades_run    ON backtest_trades (run_id);
CREATE INDEX IF NOT EXISTS idx_bt_trades_symbol ON backtest_trades (symbol);
CREATE INDEX IF NOT EXISTS idx_bt_trades_exit   ON backtest_trades (exit_type);

-- Latest winning params per regime
CREATE TABLE IF NOT EXISTS optimized_params (
    regime     VARCHAR(12) PRIMARY KEY,    -- UPTREND | SIDEWAYS | DOWNTREND
    params     JSONB       NOT NULL,
    run_id     INTEGER REFERENCES backtest_runs(id),
    sharpe     NUMERIC(8,3),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
