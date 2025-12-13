-- Migration: 005_user_auth.sql
-- Add authentication fields for Last.fm-based user auth

-- Session key from Last.fm (for authenticated API calls)
ALTER TABLE users ADD COLUMN lastfm_session_key TEXT;

-- Profile fields
ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users ADD COLUMN avatar_url TEXT;
ALTER TABLE users ADD COLUMN bio TEXT;

-- Privacy: 'public' (anyone), 'private' (only owner)
ALTER TABLE users ADD COLUMN profile_visibility TEXT DEFAULT 'public';

-- Login tracking
ALTER TABLE users ADD COLUMN last_login_at TEXT;
ALTER TABLE users ADD COLUMN login_count INTEGER DEFAULT 0;

-- Set defaults for existing users
UPDATE users SET
  profile_visibility = 'public',
  display_name = COALESCE(lastfm_username, username),
  login_count = 0
WHERE profile_visibility IS NULL;
