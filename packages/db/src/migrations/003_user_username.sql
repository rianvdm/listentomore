-- Add username column to users table for URL-friendly user profiles
-- Run with: wrangler d1 execute listentomore --file=./003_user_username.sql

-- Add username column (URL slug for user profiles)
ALTER TABLE users ADD COLUMN username TEXT;

-- Set default user's username to 'rian'
UPDATE users SET username = 'rian' WHERE id = 'default';

-- Create unique index for fast username lookups (enforces uniqueness)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
