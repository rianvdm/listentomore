-- Migration 011: Owner timezone
-- users.timezone holds the owner's IANA timezone, set from the request's cf.timezone on
-- signed-in page loads and validated with Intl before it is stored. NULL means unknown:
-- insights fall back to UTC and omit time-of-day phrases.

ALTER TABLE users ADD COLUMN timezone TEXT;
