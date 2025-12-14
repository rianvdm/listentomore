-- Migration 008: Remove unused search tables
-- These tables were planned for search history features but never implemented
-- Database methods exist but are never called

-- Drop searches table (per-user search history)
DROP TABLE IF EXISTS searches;

-- Drop recent_searches table (community-wide recent searches)
DROP TABLE IF EXISTS recent_searches;

-- Note: api_usage_log is NOT dropped - it's actively used for API analytics
