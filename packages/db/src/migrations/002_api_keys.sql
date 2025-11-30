-- API keys for authentication
-- Run with: wrangler d1 execute listentomore --file=./002_api_keys.sql

-- API keys table
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,

  -- Key identification
  key_hash TEXT NOT NULL UNIQUE,  -- SHA-256 hash of the actual key
  key_prefix TEXT NOT NULL,        -- First 8 chars for identification (e.g., "ltm_abc1")
  name TEXT DEFAULT 'Default',     -- User-friendly name

  -- Access control
  tier TEXT DEFAULT 'standard' CHECK (tier IN ('public', 'standard', 'premium')),
  scopes TEXT DEFAULT '["read"]',  -- JSON array of allowed scopes

  -- Rate limits (requests per minute, NULL = use tier default)
  rate_limit_rpm INTEGER,

  -- Usage tracking
  request_count INTEGER DEFAULT 0,
  last_used_at TEXT,

  -- Lifecycle
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT,  -- NULL = never expires
  revoked_at TEXT   -- NULL = active, set to revoke
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);

-- API usage log (for analytics and abuse detection)
CREATE TABLE IF NOT EXISTS api_usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  api_key_id TEXT REFERENCES api_keys(id) ON DELETE SET NULL,

  -- Request details
  endpoint TEXT NOT NULL,
  method TEXT DEFAULT 'GET',
  status_code INTEGER,

  -- Client info
  ip_address TEXT,
  user_agent TEXT,

  -- Timing
  response_time_ms INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_usage_key_time ON api_usage_log(api_key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_time ON api_usage_log(created_at DESC);

-- Cleanup old usage logs (keep 30 days) - run periodically
-- DELETE FROM api_usage_log WHERE created_at < datetime('now', '-30 days');
