-- Migration 009: Entity page index
-- Album and artist AI summaries are cached under name-based keys, but their pages
-- live at Spotify-ID URLs. Each row maps a cache key to the page it belongs to,
-- so the sitemap can list pages that have a cached summary.

CREATE TABLE IF NOT EXISTS entity_pages (
  cache_key TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('album', 'artist')),
  path TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
