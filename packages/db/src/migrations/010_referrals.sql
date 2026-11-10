-- Migration 010: Referral tracking
-- referral_clicks records each lookup click from a known referrer (ref=lastfm-mcp), with
-- no identifying data: no IP address, user agent or searched names. users.signup_ref
-- records which referrer a new account came from, so sign-ups can be counted per referrer.

CREATE TABLE IF NOT EXISTS referral_clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('album', 'artist')),
  matched INTEGER NOT NULL,
  signed_in INTEGER NOT NULL,
  is_bot INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_referral_clicks_ref_created ON referral_clicks (ref, created_at);

ALTER TABLE users ADD COLUMN signup_ref TEXT;
