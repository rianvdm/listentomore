-- Initial schema for ListenToMore D1 database
-- Run with: wrangler d1 execute listentomore --file=./001_initial.sql

-- Users table (for future multi-user support)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email TEXT UNIQUE,
  lastfm_username TEXT,
  discogs_username TEXT,
  spotify_connected INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- For single-user mode, we'll have one row with id = 'default'
INSERT OR IGNORE INTO users (id, lastfm_username, discogs_username)
VALUES ('default', NULL, NULL);

-- Search history
CREATE TABLE IF NOT EXISTS searches (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT DEFAULT 'default' REFERENCES users(id),
  search_type TEXT NOT NULL, -- 'album', 'artist'
  query TEXT NOT NULL,
  result_id TEXT, -- Spotify ID if found
  result_name TEXT,
  result_artist TEXT,
  searched_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_searches_user_time ON searches(user_id, searched_at DESC);

-- Recent community searches (for home page)
CREATE TABLE IF NOT EXISTS recent_searches (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  spotify_id TEXT NOT NULL,
  album_name TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  image_url TEXT,
  searched_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_recent_searches_time ON recent_searches(searched_at DESC);

-- Discogs sync state (for pagination/enrichment tracking)
CREATE TABLE IF NOT EXISTS discogs_sync_state (
  id TEXT PRIMARY KEY DEFAULT 'default',
  user_id TEXT DEFAULT 'default' REFERENCES users(id),
  last_full_sync TEXT,
  last_enrichment_sync TEXT,
  current_page INTEGER DEFAULT 0,
  total_pages INTEGER DEFAULT 0,
  enrichment_cursor INTEGER DEFAULT 0,
  status TEXT DEFAULT 'idle', -- 'idle', 'syncing', 'enriching', 'error'
  error_message TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO discogs_sync_state (id) VALUES ('default');

-- Discogs collection (normalized)
CREATE TABLE IF NOT EXISTS discogs_releases (
  id INTEGER PRIMARY KEY, -- Discogs release ID
  user_id TEXT DEFAULT 'default' REFERENCES users(id),
  instance_id INTEGER,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  year INTEGER,
  original_year INTEGER, -- From master
  format TEXT,
  label TEXT,
  genres TEXT, -- JSON array
  styles TEXT, -- JSON array
  master_genres TEXT, -- JSON array (from master)
  master_styles TEXT, -- JSON array (from master)
  image_url TEXT,
  discogs_url TEXT,
  date_added TEXT,
  rating INTEGER,
  master_id INTEGER,
  master_enriched INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_discogs_user ON discogs_releases(user_id);
CREATE INDEX IF NOT EXISTS idx_discogs_added ON discogs_releases(user_id, date_added DESC);
CREATE INDEX IF NOT EXISTS idx_discogs_master ON discogs_releases(master_id) WHERE master_enriched = 0;

-- Rate limit tracking (shared across services)
CREATE TABLE IF NOT EXISTS rate_limits (
  service TEXT PRIMARY KEY, -- 'discogs', 'spotify', 'openai', 'perplexity'
  requests_remaining INTEGER,
  window_reset_at TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO rate_limits (service, requests_remaining) VALUES
  ('discogs', 60),
  ('spotify', 100),
  ('openai', 60),
  ('perplexity', 30);
