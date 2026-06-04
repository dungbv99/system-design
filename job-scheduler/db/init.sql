CREATE TABLE IF NOT EXISTS workflows (
    id         VARCHAR(36)  PRIMARY KEY,
    name       VARCHAR(255) NOT NULL,
    status     VARCHAR(50)  NOT NULL DEFAULT 'RUNNING', -- RUNNING | COMPLETED | FAILED | CANCELLED
    created_at TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jobs (
    id          VARCHAR(36)  PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    payload     TEXT         NOT NULL DEFAULT '',
    priority    INT          NOT NULL DEFAULT 2,
    -- WAITING: has unresolved deps | PENDING: ready to schedule | ASSIGNED: given to a worker
    -- RUNNING | COMPLETED | DEAD: max retries exceeded | CANCELLED: cascade from failed parent
    status      VARCHAR(50)  NOT NULL DEFAULT 'PENDING',
    workflow_id VARCHAR(36)  REFERENCES workflows(id),
    worker_id   VARCHAR(255),
    retry_count INT          NOT NULL DEFAULT 0,
    max_retries INT          NOT NULL DEFAULT 3,
    error_msg   TEXT,
    created_at  TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- DAG edges: job_id must wait for depends_on to COMPLETE before it can run
CREATE TABLE IF NOT EXISTS job_dependencies (
    job_id     VARCHAR(36) NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    depends_on VARCHAR(36) NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    PRIMARY KEY (job_id, depends_on)
);

CREATE INDEX IF NOT EXISTS idx_jobs_status      ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_worker_id   ON jobs(worker_id);
CREATE INDEX IF NOT EXISTS idx_jobs_priority    ON jobs(priority, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_workflow_id ON jobs(workflow_id);
CREATE INDEX IF NOT EXISTS idx_deps_depends_on  ON job_dependencies(depends_on);
