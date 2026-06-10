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
    description     TEXT,
    bars_analyzed   INT          NOT NULL DEFAULT 0,
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
