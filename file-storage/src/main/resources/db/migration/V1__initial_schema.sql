-- ============================================================
--  V1 – Initial Schema for File Storage System
-- ============================================================

-- Users: identity & quota
CREATE TABLE IF NOT EXISTS users (
    id            VARCHAR(36)  PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    quota_bytes   BIGINT       NOT NULL DEFAULT 15000000000,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Devices: per-user sync clients
CREATE TABLE IF NOT EXISTS devices (
    id          VARCHAR(36)  PRIMARY KEY,
    user_id     VARCHAR(36)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL,
    platform    VARCHAR(50),
    last_seen   TIMESTAMPTZ,
    sync_cursor BIGINT       NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);

-- Nodes: file/folder tree (namespace)
CREATE TABLE IF NOT EXISTS nodes (
    id          VARCHAR(36)  PRIMARY KEY,
    owner_id    VARCHAR(36)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id   VARCHAR(36)  REFERENCES nodes(id) ON DELETE CASCADE,
    name        VARCHAR(500) NOT NULL,
    node_type   VARCHAR(10)  NOT NULL CHECK (node_type IN ('file', 'folder')),
    is_deleted  BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_nodes_owner  ON nodes(owner_id);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);

-- File Versions: immutable, append-only version chain
CREATE TABLE IF NOT EXISTS file_versions (
    id             VARCHAR(36) PRIMARY KEY,
    node_id        VARCHAR(36) NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    version_number INTEGER     NOT NULL,
    size_bytes     BIGINT      NOT NULL DEFAULT 0,
    content_hash   VARCHAR(64),
    block_list     TEXT        NOT NULL DEFAULT '[]',  -- JSON: ordered block hashes
    created_by     VARCHAR(36) REFERENCES devices(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (node_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_fv_node ON file_versions(node_id);

-- Blocks: content-addressed storage units
CREATE TABLE IF NOT EXISTS blocks (
    id          VARCHAR(36)  PRIMARY KEY,
    hash        VARCHAR(64)  NOT NULL UNIQUE,
    size_bytes  INTEGER      NOT NULL DEFAULT 0,
    storage_key VARCHAR(500) NOT NULL,
    ref_count   INTEGER      NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_blocks_hash ON blocks(hash);

-- Upload Sessions: tracks resumable multipart uploads
CREATE TABLE IF NOT EXISTS upload_sessions (
    id              VARCHAR(36) PRIMARY KEY,
    node_id         VARCHAR(36) NOT NULL REFERENCES nodes(id),
    user_id         VARCHAR(36) NOT NULL REFERENCES users(id),
    device_id       VARCHAR(36) REFERENCES devices(id),
    block_hashes    TEXT        NOT NULL DEFAULT '[]',   -- JSON: all block hashes in order
    uploaded_hashes TEXT        NOT NULL DEFAULT '[]',  -- JSON: hashes already uploaded
    status          VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL
);

-- Change Log: global, monotonic, per-user sync ledger
CREATE TABLE IF NOT EXISTS change_log (
    seq         BIGSERIAL   PRIMARY KEY,
    user_id     VARCHAR(36) NOT NULL REFERENCES users(id),
    node_id     VARCHAR(36) NOT NULL REFERENCES nodes(id),
    device_id   VARCHAR(36) REFERENCES devices(id),
    op          VARCHAR(20) NOT NULL,                    -- create|update|delete|move
    version_id  VARCHAR(36) REFERENCES file_versions(id),
    payload     TEXT        NOT NULL DEFAULT '{}',       -- JSON
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cl_user_seq ON change_log(user_id, seq);

-- Shares: access control grants
CREATE TABLE IF NOT EXISTS shares (
    id          VARCHAR(36) PRIMARY KEY,
    node_id     VARCHAR(36) NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    owner_id    VARCHAR(36) NOT NULL REFERENCES users(id),
    share_type  VARCHAR(10) NOT NULL CHECK (share_type IN ('user', 'link')),
    grantee_id  VARCHAR(36) REFERENCES users(id),
    permission  VARCHAR(10) NOT NULL CHECK (permission IN ('read', 'edit', 'admin')),
    token       VARCHAR(64) UNIQUE,
    expires_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shares_node     ON shares(node_id);
CREATE INDEX IF NOT EXISTS idx_shares_grantee  ON shares(grantee_id);
CREATE INDEX IF NOT EXISTS idx_shares_token    ON shares(token);
