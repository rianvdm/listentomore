-- Migration 006: Convert user IDs from username-based to UUID-based
-- 
-- WHY: Current id = lowercase(username) breaks when users sign up via different
-- services (Discogs username ≠ Last.fm username). Need stable UUIDs.
--
-- BEFORE RUNNING:
-- 1. Backup production database
-- 2. Test in local/staging environment first
-- 3. Note: Cache keys will need to be invalidated after migration
--
-- Run with: wrangler d1 execute listentomore --file=./006_uuid_user_ids.sql
--
-- NOTE: D1 enforces FK constraints per-statement. To work around this:
-- 1. Insert new user rows with UUID ids
-- 2. Update FK references to point to new UUIDs
-- 3. Delete old user rows

-- ============================================================================
-- STEP 1: Create mapping table to track old_id -> new_id
-- ============================================================================
CREATE TABLE IF NOT EXISTS _user_id_migration (
  old_id TEXT PRIMARY KEY,
  new_id TEXT NOT NULL,
  username TEXT NOT NULL
);

-- Populate mapping with UUIDs for each existing user
INSERT INTO _user_id_migration (old_id, new_id, username)
SELECT 
  id as old_id,
  lower(hex(randomblob(16))) as new_id,
  COALESCE(username, id) as username
FROM users
WHERE id NOT IN (SELECT old_id FROM _user_id_migration);

-- ============================================================================
-- STEP 2: Ensure username is populated before we change IDs
-- ============================================================================
UPDATE users SET username = id WHERE username IS NULL OR username = '';

-- ============================================================================
-- STEP 3: Insert new user rows with UUID as id (duplicates with new IDs)
-- ============================================================================
INSERT INTO users (id, username, email, lastfm_username, discogs_username, spotify_connected, created_at, updated_at)
SELECT 
  m.new_id,
  u.username || '_TEMP_MIGRATION',  -- Temporary unique username
  NULL,  -- email will be null for now (can't have duplicate)
  u.lastfm_username,
  u.discogs_username,
  u.spotify_connected,
  u.created_at,
  u.updated_at
FROM users u
JOIN _user_id_migration m ON u.id = m.old_id;

-- ============================================================================
-- STEP 4: Update foreign keys to point to new UUID user IDs
-- ============================================================================

-- Update oauth_tokens
UPDATE oauth_tokens SET user_id = (
  SELECT new_id FROM _user_id_migration WHERE _user_id_migration.old_id = oauth_tokens.user_id
) WHERE user_id IN (SELECT old_id FROM _user_id_migration);

-- Update searches
UPDATE searches SET user_id = (
  SELECT new_id FROM _user_id_migration WHERE _user_id_migration.old_id = searches.user_id
) WHERE user_id IN (SELECT old_id FROM _user_id_migration);

-- Update discogs_releases
UPDATE discogs_releases SET user_id = (
  SELECT new_id FROM _user_id_migration WHERE _user_id_migration.old_id = discogs_releases.user_id
) WHERE user_id IN (SELECT old_id FROM _user_id_migration);

-- Update discogs_sync_state
UPDATE discogs_sync_state SET user_id = (
  SELECT new_id FROM _user_id_migration WHERE _user_id_migration.old_id = discogs_sync_state.user_id
) WHERE user_id IN (SELECT old_id FROM _user_id_migration);

-- Update api_keys
UPDATE api_keys SET user_id = (
  SELECT new_id FROM _user_id_migration WHERE _user_id_migration.old_id = api_keys.user_id
) WHERE user_id IN (SELECT old_id FROM _user_id_migration);

-- ============================================================================
-- STEP 5: Delete old user rows (FKs now point to new rows)
-- ============================================================================
DELETE FROM users WHERE id IN (SELECT old_id FROM _user_id_migration);

-- ============================================================================
-- STEP 6: Fix the temporary usernames back to original
-- ============================================================================
UPDATE users SET username = REPLACE(username, '_TEMP_MIGRATION', '')
WHERE username LIKE '%_TEMP_MIGRATION';

-- ============================================================================
-- STEP 7: Add indexes
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_lastfm ON users(lastfm_username);
CREATE INDEX IF NOT EXISTS idx_users_discogs ON users(discogs_username);

-- ============================================================================
-- VERIFICATION QUERIES (run these after migration to verify)
-- ============================================================================
-- 
-- Check users have UUIDs:
-- SELECT id, username, lastfm_username FROM users;
--
-- Check foreign keys updated:
-- SELECT user_id FROM oauth_tokens;
-- SELECT DISTINCT user_id FROM searches LIMIT 5;
-- SELECT DISTINCT user_id FROM discogs_releases LIMIT 5;
--
-- Check mapping table:
-- SELECT * FROM _user_id_migration;
--
-- ============================================================================
-- POST-MIGRATION: Cache invalidation needed
-- ============================================================================
-- 
-- After running this migration, you need to invalidate/update cache keys:
-- - discogs:collection:{old_user_id} -> discogs:collection:{new_user_id}
-- - discogs:last-sync:{old_user_id} -> discogs:last-sync:{new_user_id}
-- - Enrichment progress keys
--
-- Option 1: Let caches expire naturally (6-24 hours)
-- Option 2: Manually delete old keys and trigger re-sync
-- Option 3: Run a script to migrate cache keys using the mapping table
