-- Migration: Add OAuth tokens table for connected services (Discogs, etc.)
-- This stores encrypted OAuth tokens for third-party service connections

CREATE TABLE IF NOT EXISTS oauth_tokens (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  provider TEXT NOT NULL,  -- 'discogs', 'spotify', etc.
  
  -- Token storage (encrypted)
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,  -- For OAuth 1.0a, this stores the token secret
  
  -- Token metadata
  token_type TEXT DEFAULT 'Bearer',
  scope TEXT,  -- Space-separated scopes
  expires_at TEXT,
  
  -- Provider-specific user info
  provider_user_id TEXT,
  provider_username TEXT,
  
  -- Lifecycle
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_user_provider ON oauth_tokens(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_oauth_provider ON oauth_tokens(provider);
