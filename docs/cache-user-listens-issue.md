# Problem Summary: Intermittent Cache Corruption in User Listens Feature

**Status: RESOLVED** (2025-12-04)

## The Issue

The "What we're listening to" feature on the home page intermittently shows "no recent listens available"
despite the cron job logging success.

## Key Files

1. `apps/web/src/index.tsx`
   - API endpoint `/api/internal/user-listens` - reads from cache
   - `scheduled()` function - cron job that pre-warms the cache every 5 minutes
2. `packages/config/src/cache.ts`
   - `userListens: { ttlMinutes: 7 }` - cache TTL config
3. `apps/web/wrangler.toml`
   - `crons = ["*/5 * * * *"]` - cron schedule

---

## Root Cause Analysis

### The Smoking Gun

API logs showed this pattern intermittently:

```
2025-12-04 14:25:13 [API] WARNING: Cache has old format (bare array with 0 items). Possible stale worker writing v1 format.
2025-12-04 14:25:13 [API] Cache hit, returning 0 tracks
```

The cache contained `[]` (bare empty array), but **no current code writes that format**. The bare array format was only in OLD code before commit `2afdf13`.

### Timeline Analysis

```
14:20:29 - Cron writes 14 tracks (new format, verified) ✓
14:25:07 - API sees [] (old format) ← Something overwrote the good data!
14:25:10 - API sees [] (old format)
14:25:13 - API sees [] (old format) + WARNING logged
14:25:27 - Cron writes 14 tracks (new format) ✓
14:26:22 - API sees 14 tracks ✓
```

**Between 14:20 and 14:25, old cron code executed and wrote `[]`, overwriting the good data.**

### Root Cause: Stale Worker Instances

Despite deployments showing "100%" rollout, **Cloudflare Workers can have stale instances that occasionally execute cron jobs**.

The sequence:
1. Old code writes bare arrays: `[]`
2. New code writes objects: `{tracks: [...], lastUpdated: "...", version: 2}`
3. Both wrote to the SAME cache key: `user-listens:recent`
4. When old worker executed cron, it overwrote new data with old format
5. This happened intermittently depending on which worker instance ran the cron

### Why Version Marker Wasn't Enough

We added a `version: 2` field inside the cache data to detect old format. However:
- The version field helped us **detect** the problem (via WARNING logs)
- But it didn't **prevent** old code from overwriting new data
- Both old and new code wrote to the SAME cache key

---

## Solution Implemented

### Final Fix: Change Cache Key (2025-12-04)

**Changed the cache key itself** from `user-listens:recent` to `user-listens:v2:recent`.

```typescript
// OLD (both old and new code used this):
const CACHE_KEY = 'user-listens:recent';

// NEW (only new code uses this):
const CACHE_KEY = 'user-listens:v2:recent';
```

This ensures:
- Old workers write to: `user-listens:recent` (ignored by new API)
- New workers write to: `user-listens:v2:recent` (read by new API)
- **Old code cannot corrupt new data because they use different keys**

### Previous Mitigations (still in place)

1. **Made API read-only** for the cache key
   - API no longer writes to cache on cache miss
   - Only the cron job manages cache writes
   - Eliminates race conditions

2. **Added version marker** to cache data
   - Helps detect if any old format data appears (shouldn't happen with new key)

3. **Added write verification** in cron
   - Reads back after write to confirm data is correct
   - Logs warning if verification fails

---

## Lessons Learned

1. **Stale workers persist longer than expected**: Even with "100%" deployment, old worker instances can execute cron jobs intermittently.

2. **Version fields don't prevent overwrites**: Adding a version field inside the data helps detection but doesn't prevent old code from writing to the same key.

3. **Key namespacing is the safest isolation**: When making breaking format changes, changing the cache key itself guarantees old code can't interfere.

4. **Good logging is essential**: The `[API] WARNING` logs let us catch the exact moment old format was detected, which proved the root cause.

---

## Debug Commands

Check current cache value:
```bash
npx wrangler kv key get --namespace-id=a6011a8b5bac4be9a472ff86f8d5fd91 --remote "user-listens:v2:recent"
```

Check cache keys (to verify old key exists separately):
```bash
npx wrangler kv key get --namespace-id=a6011a8b5bac4be9a472ff86f8d5fd91 --remote "user-listens:recent"
```

Delete old cache key (optional cleanup):
```bash
npx wrangler kv key delete --namespace-id=a6011a8b5bac4be9a472ff86f8d5fd91 --remote "user-listens:recent"
```