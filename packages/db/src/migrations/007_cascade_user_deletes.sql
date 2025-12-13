-- Migration: 007_cascade_user_deletes.sql
-- Add ON DELETE CASCADE to foreign keys for proper user deletion

-- SQLite doesn't support altering foreign keys, so we need to recreate tables

-- 1. Recreate searches table with CASCADE
CREATE TABLE searches_new (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT DEFAULT 'default' REFERENCES users(id) ON DELETE CASCADE,
  search_type TEXT NOT NULL,
  query TEXT NOT NULL,
  result_id TEXT,
  result_name TEXT,
  result_artist TEXT,
  searched_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO searches_new SELECT * FROM searches;
DROP TABLE searches;
ALTER TABLE searches_new RENAME TO searches;
CREATE INDEX idx_searches_user_time ON searches(user_id, searched_at DESC);

-- 2. Recreate discogs_sync_state table with CASCADE
CREATE TABLE discogs_sync_state_new (
  id TEXT PRIMARY KEY DEFAULT 'default',
  user_id TEXT DEFAULT 'default' REFERENCES users(id) ON DELETE CASCADE,
  last_full_sync TEXT,
  last_enrichment_sync TEXT,
  current_page INTEGER DEFAULT 0,
  total_pages INTEGER DEFAULT 0,
  enrichment_cursor INTEGER DEFAULT 0,
  status TEXT DEFAULT 'idle',
  error_message TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO discogs_sync_state_new SELECT * FROM discogs_sync_state;
DROP TABLE discogs_sync_state;
ALTER TABLE discogs_sync_state_new RENAME TO discogs_sync_state;

-- 3. Recreate discogs_releases table with CASCADE
CREATE TABLE discogs_releases_new (
  id INTEGER PRIMARY KEY,
  user_id TEXT DEFAULT 'default' REFERENCES users(id) ON DELETE CASCADE,
  instance_id INTEGER,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  year INTEGER,
  original_year INTEGER,
  format TEXT,
  label TEXT,
  genres TEXT,
  styles TEXT,
  master_genres TEXT,
  master_styles TEXT,
  image_url TEXT,
  discogs_url TEXT,
  date_added TEXT,
  rating INTEGER,
  master_id INTEGER,
  master_enriched INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO discogs_releases_new SELECT * FROM discogs_releases;
DROP TABLE discogs_releases;
ALTER TABLE discogs_releases_new RENAME TO discogs_releases;
CREATE INDEX idx_discogs_user ON discogs_releases(user_id);
CREATE INDEX idx_discogs_added ON discogs_releases(user_id, date_added DESC);
CREATE INDEX idx_discogs_master ON discogs_releases(master_id) WHERE master_enriched = 0;
