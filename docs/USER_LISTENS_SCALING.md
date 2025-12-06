# User Listens Scaling Analysis

This document analyzes the scalability of the "What we're listening to" feature on the home page and outlines implementation options when user growth requires optimization.

## Why We Poll All Users

The home page displays the **5 most recent listens** across all users. To determine which users have the most recent activity, we must check every user's Last.fm profile - there's no API that tells us "which of these users listened most recently."

Last.fm's API doesn't support:
- Querying multiple users in a single request
- Webhooks/push notifications for new scrobbles
- Filtering by "most recently active" across accounts

This means polling is the only option. The question becomes: how do we poll efficiently at scale?

## Current Implementation

The cron job runs every 5 minutes and:

1. Fetches ALL users with Last.fm usernames from D1
2. For EACH user (in parallel via `Promise.all`):
   - Makes 1 Last.fm API call to get most recent track
   - Makes 1 Spotify API call to get album image (cached)
3. Caches the combined results in KV with 7-minute TTL

**Location:** `apps/web/src/index.tsx` in the `scheduled()` function

## Scalability Bottlenecks

### API Rate Limits

| Service | Rate Limit | Notes |
|---------|------------|-------|
| Last.fm | ~5 req/sec | No official docs, but commonly reported |
| Spotify | ~180 req/min | With token bucket, varies by endpoint |

### Projected Issues by User Count

| Users | Last.fm calls/5min | Expected Behavior |
|-------|-------------------|-------------------|
| 10 | 10 | Works fine |
| 50 | 50 | Should work, may see occasional rate limits |
| 100 | 100 | Likely to hit rate limits |
| 500 | 500 | Will definitely fail |
| 1000 | 1000 | Worker timeout + rate limits |

### Worker Constraints

- **Wall clock time:** 30 seconds for scheduled workers
- **CPU time:** 30 seconds for scheduled workers
- **Memory:** 128MB default

With 1000 users making parallel API calls, both timeout and rate limits become issues.

## Implementation Options

### Option 1: Batch Processing with Delays

**Complexity:** Low
**When to use:** 50-200 users

```typescript
// Process users in batches of 20 with 1 second delay between batches
const BATCH_SIZE = 20;
const DELAY_MS = 1000;

for (let i = 0; i < users.length; i += BATCH_SIZE) {
  const batch = users.slice(i, i + BATCH_SIZE);
  const results = await Promise.all(batch.map(fetchUserTrack));
  allResults.push(...results);

  if (i + BATCH_SIZE < users.length) {
    await new Promise(resolve => setTimeout(resolve, DELAY_MS));
  }
}
```

**Pros:**
- Simple to implement
- No new infrastructure

**Cons:**
- Still limited by 30-second timeout
- Maximum ~600 users (20 batches × 30 users)

### Option 2: Per-User Caching with Staggered Updates

**Complexity:** Medium
**When to use:** 100-500 users

Instead of refreshing all users every 5 minutes, cache each user's track separately and only refresh stale entries.

```typescript
// Cache key per user
const userCacheKey = `user-listen:${username}`;
const TTL = 5 * 60; // 5 minutes

// On cron: only refresh users whose cache expired
// On page load: aggregate from individual caches
```

**Pros:**
- Spreads API load over time
- More resilient to failures

**Cons:**
- More complex aggregation logic
- More KV reads on page load

### Option 3: Cloudflare Queues

**Complexity:** High
**When to use:** 500+ users

Use Cloudflare Queues to process users asynchronously:

1. Cron job pushes user IDs to a queue
2. Queue consumer processes users one at a time
3. Results stored in KV

```typescript
// Producer (cron)
await env.USER_LISTEN_QUEUE.sendBatch(
  users.map(u => ({ body: { username: u.lastfm_username } }))
);

// Consumer (queue handler)
export default {
  async queue(batch, env) {
    for (const message of batch.messages) {
      await processUser(message.body.username, env);
      message.ack();
    }
  }
};
```

**Pros:**
- Handles any number of users
- Built-in retries
- No timeout issues

**Cons:**
- Requires Cloudflare Queues ($5/mo + usage)
- More complex architecture
- Results may be slightly stale

### Option 4: Active Users Only

**Complexity:** Low
**When to use:** Any scale

Only fetch data for users who have listened to something in the last hour (based on cached playedAt timestamps).

```typescript
// Filter to users with recent activity
const activeUsers = users.filter(u => {
  const cached = await env.CACHE.get(`user-listen:${u.lastfm_username}`);
  if (!cached) return true; // New user, fetch
  const data = JSON.parse(cached);
  const hourAgo = Date.now() - 60 * 60 * 1000;
  return new Date(data.playedAt).getTime() > hourAgo;
});
```

**Pros:**
- Dramatically reduces API calls
- Simple to implement

**Cons:**
- May miss users who just started listening
- Requires per-user caching (Option 2)

## Recommended Path

1. **Now (< 50 users):** Current implementation is fine
2. **50-100 users:** Implement Option 1 (batch processing) ✅ **IMPLEMENTED**
3. **100-500 users:** Implement Option 2 + Option 4 (per-user caching + active users)
4. **500+ users:** Implement Option 3 (Cloudflare Queues)

## Current Implementation (as of Dec 2025)

Batch processing is now active with the following configuration:
- **Batch size:** 4 users per batch (~4 req/sec to stay under Last.fm's ~5/sec limit)
- **Delay between batches:** 1 second
- **Max users before 30s timeout:** ~100 users (25 batches × 1s delay + processing time)

### Logging Output

The cron job now logs detailed progress:
```
[CRON] Found 20 users with Last.fm usernames
[CRON] Processing 20 users in 5 batches (batch size: 4, delay: 1000ms)
[CRON] Batch 1/5 complete (523ms)
[CRON] Batch 2/5 complete (412ms)
...
[CRON] All batches complete: 18 successes, 2 errors in 6234ms
[CRON] API results: 18 tracks, 2 failures
```

## Monitoring

To know when scaling is needed, monitor:

1. Cron execution time in Cloudflare dashboard
2. Rate limit errors in logs (`[CRON] Failed to fetch`)
3. User count growth in D1

```sql
SELECT COUNT(*) FROM users WHERE lastfm_username IS NOT NULL;
```
