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

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_daily_quotes_date   ON daily_quotes  (date DESC);
CREATE INDEX IF NOT EXISTS idx_foreign_date        ON foreign_trading (date DESC);
CREATE INDEX IF NOT EXISTS idx_news_published      ON news          (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_symbol         ON news          (symbol);
CREATE INDEX IF NOT EXISTS idx_crawl_runs_job_date ON crawl_runs    (job, run_date DESC);
