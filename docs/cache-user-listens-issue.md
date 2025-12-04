Problem Summary: Intermittent Cache Corruption in User Listens Feature

  The Issue

  The "What we're listening to" feature on the home page intermittently shows "no recent listens available"
  despite the cron job logging success.

  Pattern observed:
  - :X5 minutes (5, 15, 25, 35, 45, 55) - works correctly
  - :X0 minutes (0, 10, 20, 30, 40, 50) - shows empty data

  Key Files

  1. apps/web/src/index.tsx
    - Lines 752-826: API endpoint /api/internal/user-listens - reads from cache, falls back to fetching all users
   on miss
    - Lines 1446-1556: scheduled() function - cron job that pre-warms the cache every 5 minutes
    - Both write to KV key: user-listens:recent
  2. packages/config/src/cache.ts
    - Line 26: userListens: { ttlMinutes: 7 } - cache TTL config
  3. apps/web/wrangler.toml
    - Line 42: crons = ["*/5 * * * *"] - cron schedule

  The Mystery

  What the logs show:
  10:10:20 AM - [CRON] Caching 13 tracks with TTL 420s
  10:10:20 AM - [CRON] Pre-warmed user listens cache with 13 tracks
  10:10:31 AM - [API] Cache hit, returning 0 tracks

  The cron logs that it successfully cached 13 tracks, but 11 seconds later the API sees 0 tracks (cache HIT, not
   miss).

  What's in the cache:
  npx wrangler kv key get --namespace-id=a6011a8b5bac4be9a472ff86f8d5fd91 --remote "user-listens:recent"
  # Returns: []

  The cache contains [] (empty array), but both current code paths write {"tracks": [...], "lastUpdated": "..."}
  format:

  - Cron (line 1543-1548): const cacheData = { tracks: validTracks, lastUpdated: new Date().toISOString() };
  - API (line 815): const cacheData = { tracks: validTracks, lastUpdated };

  Potential Causes to Investigate

  1. Stale Worker Code: The [] format matches OLD code (pre-commit 2afdf13). Despite deploying, could there be
  cached/stale workers running old code?
  2. Race Condition: Could a slow API request (cache miss flow) be overwriting the cron's cache write?
    - API cache miss at 10:09:45 starts fetching
    - Cron runs at 10:10:00, writes good data
    - API finishes at 10:10:20, overwrites with (empty?) data
  3. KV Eventual Consistency: Cloudflare KV is eventually consistent. Could edge location differences cause the
  cron write to not be visible to the API read?
  4. Silent Write Failure: The cron logs success BEFORE await env.CACHE.put(). Could the PUT be failing silently?

  Debug Logging Added (commit b6c968b)

  Cron (lines 1528-1552):
  console.log(`[CRON] Found ${users.length} users with Last.fm usernames`);
  console.log(`[CRON] API results: ${userTracks.length - nullCount} tracks, ${nullCount} failures`);
  console.log(`[CRON] Caching ${validTracks.length} tracks with TTL ${CACHE_TTL_SECONDS}s`);

  API (lines 765, 769, 816):
  console.log(`[API] Cache hit, returning ${tracks.length} tracks`);
  console.log('[API] Cache MISS - fetching from all users');
  console.log(`[API] Writing ${validTracks.length} tracks to cache with TTL ${CACHE_TTL_SECONDS}s`);

---

## Root Cause Analysis

### The Pattern Explained

The failure pattern matches exactly with the cron schedule change from `*/10` to `*/5`:
- **Old cron**: `*/10` → runs at 0, 10, 20, 30, 40, 50 (= `:X0` pattern)
- **New cron**: `*/5` → also runs at 5, 15, 25, 35, 45, 55 (= `:X5` pattern)

The cache contains `[]` (bare array), but **both current code paths** write `{tracks: [...], lastUpdated: "..."}`.
This format only existed in the OLD code before commit `2afdf13`.

### Diagnosis

**Stale Worker Instances**: Cloudflare Workers can have multiple instances running during/after deployments.
An old worker instance running the pre-`2afdf13` code writes `[]` format (bare array) instead of `{tracks: [], lastUpdated}`.

At `:X5` times, only new workers run → works correctly.
At `:X0` times, old worker may run and overwrite → fails.

**Secondary Issue**: Race condition between API cache-miss flow and cron (both writing to same key).

## Solution Implemented

1. **Made API read-only** for the `user-listens:recent` cache key
   - API no longer writes to cache on cache miss
   - Only the cron job manages cache writes
   - Eliminates race conditions

2. **Added version marker** to cache data
   - v1 = old format (bare array)
   - v2 = new format (object with `tracks`, `lastUpdated`, `version`)
   - Helps detect stale workers in logs

3. **Added write verification** in cron
   - Reads back after write to confirm data is correct
   - Logs warning if verification fails

### Post-Deploy Steps

After deploying this fix:
1. Monitor logs for `[API] WARNING` messages about old format or version mismatch
2. If warnings persist, consider deleting and redeploying the worker to clear stale instances
3. Cache key can be manually cleared: `npx wrangler kv key delete --namespace-id=... "user-listens:recent"`