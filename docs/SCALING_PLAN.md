# ListenToMore Scaling Plan

> **For LLMs:** This document provides a comprehensive, prioritized plan for scaling ListenToMore from ~20 users to 1000+ users. It identifies critical bottlenecks, provides implementation timelines, and serves as the master scaling roadmap.

**Last Updated:** 2025-12-14
**Current Scale:** ~20 users, ~14 with Last.fm integration
**Target Scale:** 1000+ users with graceful degradation

---

## Executive Summary

ListenToMore is built on Cloudflare Workers with external API dependencies (Spotify, Last.fm, OpenAI, Perplexity). The architecture is serverless and inherently scalable, but several critical systems will fail under growth without intervention:

### 🔴 **Critical (Will Break Soon)**
1. **Spotify API Rate Limiting** - Single token serving all requests, instance-level rate limiting won't work in Workers
2. **AI API Rate Limiting** - Same issue, instance-level counters don't persist across requests
3. **Database Unbounded Growth** - Searches table has no cleanup, sessions accumulate indefinitely

### 🟡 **High Priority (Will Break with Growth)**
4. **Cron Job Scaling** - Currently ~14 users, will timeout at ~150 users
5. **Last.fm Rate Limiting** - Batched in cron but not in other endpoints
6. **Session Security** - No automated cleanup creates security risk and performance issues

### 🟢 **Medium Priority (Good to Have)**
7. **Monitoring & Alerting** - No visibility into when limits are approached
8. **KV Cache Optimization** - Cost and consistency concerns with large AI cache
9. **Request Deduplication** - Multiple users loading same page = duplicate expensive operations
10. **Cost Tracking** - AI API costs could spiral without visibility

### Implementation Timeline

| Phase | Timeline | Systems | Status |
|-------|----------|---------|--------|
| **Phase 1: Critical Fixes** | Week 1-2 | Spotify rate limiting, AI rate limiting, DB cleanup | 🔴 Not started |
| **Phase 2: Scaling Infrastructure** | Week 3-4 | Cron optimization, Last.fm rate limiting, monitoring | 🟡 Partially done (cron batching) |
| **Phase 3: Optimization** | Week 5-8 | Batch APIs, cache optimization, deduplication | 🟢 Future |
| **Phase 4: Resilience** | Month 3+ | Circuit breakers, multi-region, cost optimization | 🟢 Future |

---

## Current Architecture Analysis

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare Worker                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Spotify  │  │ Last.fm  │  │   AI     │  │ Songlink │   │
│  │ Service  │  │ Service  │  │ Service  │  │ Service  │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
│       │             │             │             │           │
│       └─────────────┴─────────────┴─────────────┘           │
│                         │                                   │
│              ┌──────────┴──────────┐                        │
│              │                     │                        │
│         ┌────▼────┐          ┌────▼────┐                   │
│         │   KV    │          │   D1    │                   │
│         │  Cache  │          │Database │                   │
│         └─────────┘          └─────────┘                   │
└─────────────────────────────────────────────────────────────┘
```

### Known Constraints

| System | Limit | Current Usage | Notes |
|--------|-------|---------------|-------|
| **Cloudflare Worker** | 30s timeout | ~6-7s (cron) | Scheduled workers have same limit |
| **Cloudflare Worker** | 128MB memory | Unknown | No memory monitoring |
| **D1 Database** | 10GB storage | <100MB | Sessions/searches unbounded |
| **KV Cache** | 1GB per value | Unknown | AI cache has 180-day TTLs |
| **Spotify API** | ~180 req/min | Variable | Shared token across all Workers |
| **Last.fm API** | ~5 req/sec | Batched in cron only | Undocumented limit |
| **OpenAI API** | 60 req/min | Variable | Instance-level rate limiting (broken) |
| **Perplexity API** | 30 req/min | Variable | Instance-level rate limiting (broken) |

---

## Phase 1: Critical Fixes (Week 1-2)

These issues will cause production incidents if not addressed immediately.

### 1.1 Spotify Rate Limiting ⚠️ **CRITICAL**

**Problem:**
- December 2025 incident: Googlebot crawl triggered mass 429s
- All requests use single OAuth token (shared rate limit)
- Instance-level rate limiting doesn't work in Workers (each request = new instance)
- Retry-After escalates to 10+ hours if abuse continues

**Current State:**
- Cloudflare rate limiting on verified bots (mitigation)
- Graceful 503 error page (UX mitigation)
- No application-level rate limiting

**Solution:** Implement distributed rate limiting using KV

**Implementation:** See [SPOTIFY_RATE_LIMITING.md](./SPOTIFY_RATE_LIMITING.md) - the plan is still valid.

**Steps:**
1. Create `packages/services/spotify/src/rate-limit.ts` with KV-based rate limiter
2. Create `packages/services/spotify/src/fetch.ts` wrapper with retry logic
3. Update `SpotifyAuth`, `SpotifyAlbums`, `SpotifyArtists`, `SpotifySearch` to use new wrapper
4. Add rate limit config to `packages/config/src/ai.ts`:
   ```typescript
   spotify: {
     requestsPerMinute: 120, // Conservative (actual limit ~180)
     maxRetries: 2,
     retryDelayMs: 1000,
   }
   ```

**Testing:**
- Load test: 200 requests in 60 seconds
- Verify no 429s from Spotify
- Monitor `[Spotify] Rate limit cooldown` logs

**Acceptance Criteria:**
- Zero 429 errors from Spotify under normal load
- Rate limiter logs show throttling before hitting Spotify limits
- Retry logic respects Retry-After header

**Estimated Effort:** 8 hours
**Risk if skipped:** HIGH - Production incidents, hours-long token bans

---

### 1.2 AI Rate Limiting ⚠️ **CRITICAL**

**Problem:**
- OpenAI and Perplexity clients use instance-level rate limiting
- In Cloudflare Workers, each request may run in different isolate
- Rate limit counters don't persist = ineffective rate limiting
- Progressive loading can trigger parallel AI requests

**Current State:**
```typescript
// packages/services/ai/src/openai.ts:87-90
private rateLimitWindow: RateLimitWindow = {
  requestCount: 0,
  windowStart: Date.now(),
};
```
This counter resets on every Worker instance = broken.

**Solution:** Use same KV-based approach as Spotify

**Implementation:**

1. **Create shared rate limiter** in `packages/services/ai/src/rate-limit.ts`:
   ```typescript
   export class AIRateLimiter {
     constructor(
       private cache: KVNamespace,
       private provider: 'openai' | 'perplexity',
       private maxRequests: number
     ) {}

     async acquire(): Promise<void> {
       // Similar to SpotifyRateLimiter
       // Use cache key: `ai:ratelimit:${provider}`
     }
   }
   ```

2. **Update OpenAIClient** to use KV-based limiter:
   ```typescript
   export class OpenAIClient {
     private rateLimiter: AIRateLimiter;

     constructor(apiKey: string, cache: KVNamespace) {
       this.apiKey = apiKey;
       this.rateLimiter = new AIRateLimiter(cache, 'openai', 60);
     }

     private async checkRateLimit(): Promise<void> {
       await this.rateLimiter.acquire();
     }
   }
   ```

3. **Update PerplexityClient** similarly

4. **Update AIService** to pass cache to clients:
   ```typescript
   // packages/services/ai/src/index.ts
   constructor(config: {
     openaiKey: string;
     perplexityKey: string;
     cache: KVNamespace; // Add this
   }) {
     this.openai = new OpenAIClient(config.openaiKey, config.cache);
     this.perplexity = new PerplexityClient(config.perplexityKey, config.cache);
   }
   ```

5. **Update initialization** in `apps/web/src/index.tsx`:
   ```typescript
   const ai = new AIService({
     openaiKey: c.env.OPENAI_API_KEY,
     perplexityKey: c.env.PERPLEXITY_API_KEY,
     cache: c.env.CACHE, // Add this
   });
   ```

**Testing:**
- Trigger multiple AI requests in parallel
- Verify rate limiting logs show coordinated throttling
- Test with multiple concurrent users

**Acceptance Criteria:**
- No 429 errors from OpenAI/Perplexity
- Rate limiter coordinates across Workers
- KV reads add <50ms latency

**Estimated Effort:** 6 hours
**Risk if skipped:** MEDIUM - AI API rate limits, increased costs

---

### 1.3 Database Cleanup & Indexes ⚠️ **CRITICAL**

**Problem:**
- **Searches table:** No cleanup mechanism = unbounded growth
- **Sessions table:** Manual cleanup only (shown in CLAUDE.md docs)
- **D1 limit:** 10GB total - searches could fill this over time
- **Security risk:** Old sessions linger indefinitely (before expiry)

**Current State:**
```sql
-- From migrations/001_initial.sql
CREATE TABLE IF NOT EXISTS searches (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  search_type TEXT NOT NULL,
  query TEXT NOT NULL,
  searched_at TEXT DEFAULT (datetime('now'))
);
-- NO cleanup mechanism!

-- From migrations/006_sessions.sql
CREATE TABLE IF NOT EXISTS sessions (
  expires_at TEXT NOT NULL
);
-- No automated cleanup!
```

**Solution:** Add automated cleanup via cron job

**Implementation:**

1. **Add cleanup function** to scheduled worker in `apps/web/src/index.tsx`:

```typescript
async function scheduled(event: ScheduledEvent, env: Env) {
  const db = new Database(env.DB);

  // Run cleanup every hour (5 min = 12 times/hour, so skip 11/12 runs)
  const shouldRunCleanup = new Date().getMinutes() < 5;

  if (shouldRunCleanup) {
    await cleanupDatabase(db);
  }

  // Existing user listens cron job
  await preWarmUserListensCache(env);
}

async function cleanupDatabase(db: Database) {
  try {
    console.log('[CRON] Starting database cleanup');

    // Clean up expired sessions
    const sessionsDeleted = await db.deleteExpiredSessions();
    console.log(`[CRON] Deleted ${sessionsDeleted} expired sessions`);

    // Clean up old searches (keep last 90 days)
    const searchesDeleted = await db.deleteOldSearches(90);
    console.log(`[CRON] Deleted ${searchesDeleted} searches older than 90 days`);

    // Clean up old recent_searches (keep last 30 days)
    const recentSearchesDeleted = await db.deleteOldRecentSearches(30);
    console.log(`[CRON] Deleted ${recentSearchesDeleted} recent searches older than 30 days`);

  } catch (error) {
    console.error('[CRON] Database cleanup failed:', error);
  }
}
```

2. **Add cleanup methods** to `packages/db/src/index.ts`:

```typescript
async deleteExpiredSessions(): Promise<number> {
  const result = await this.db
    .prepare("DELETE FROM sessions WHERE expires_at < datetime('now')")
    .run();
  return result.meta.changes;
}

async deleteOldSearches(daysToKeep: number): Promise<number> {
  const result = await this.db
    .prepare(
      `DELETE FROM searches
       WHERE searched_at < datetime('now', '-' || ? || ' days')`
    )
    .bind(daysToKeep)
    .run();
  return result.meta.changes;
}

async deleteOldRecentSearches(daysToKeep: number): Promise<number> {
  const result = await this.db
    .prepare(
      `DELETE FROM recent_searches
       WHERE searched_at < datetime('now', '-' || ? || ' days')`
    )
    .bind(daysToKeep)
    .run();
  return result.meta.changes;
}
```

3. **Add database size monitoring**:

```typescript
// In cleanup function
const stats = await db.getDatabaseStats();
console.log(`[CRON] Database size: ${stats.size}MB, ${stats.rowCount} total rows`);

// In packages/db/src/index.ts
async getDatabaseStats(): Promise<{ size: number; rowCount: number }> {
  // D1 doesn't expose size directly, but we can estimate
  const tables = ['users', 'sessions', 'searches', 'recent_searches', 'api_keys'];
  let totalRows = 0;

  for (const table of tables) {
    const result = await this.db
      .prepare(`SELECT COUNT(*) as count FROM ${table}`)
      .first<{ count: number }>();
    totalRows += result?.count ?? 0;
  }

  return { size: 0, rowCount: totalRows }; // Size not available in D1
}
```

4. **Add index for searches cleanup** (migration `008_cleanup_indexes.sql`):

```sql
-- Speed up cleanup queries
CREATE INDEX IF NOT EXISTS idx_searches_cleanup ON searches(searched_at);
CREATE INDEX IF NOT EXISTS idx_recent_searches_cleanup ON recent_searches(searched_at);
```

**Testing:**
- Insert test data with old timestamps
- Run cron job manually
- Verify old data is deleted
- Check logs for row counts

**Acceptance Criteria:**
- Expired sessions deleted within 1 hour of expiry
- Searches older than 90 days are deleted
- Recent searches older than 30 days are deleted
- Cleanup logs show row counts
- No performance impact on queries

**Estimated Effort:** 4 hours
**Risk if skipped:** HIGH - Database fills up, security risk from old sessions

---

## Phase 2: Scaling Infrastructure (Week 3-4)

These will become problems as user count grows beyond 50-100 users.

### 2.1 Last.fm Rate Limiting

**Problem:**
- Last.fm has ~5 req/sec undocumented limit
- Cron job uses batching (good)
- Other endpoints (user stats, recommendations) don't have rate limiting

**Current State:**
- Cron: Batched (4 users/batch, 1s delay) ✅
- User profile endpoints: No rate limiting ❌

**Solution:** Add rate limiting to all Last.fm calls

**Implementation:**

1. **Create Last.fm rate limiter** similar to Spotify:
   ```typescript
   // packages/services/lastfm/src/rate-limit.ts
   export class LastfmRateLimiter {
     constructor(private cache: KVNamespace) {}

     async acquire(): Promise<void> {
       // 5 requests per second limit
       // Use KV key: 'lastfm:ratelimit:state'
     }
   }
   ```

2. **Update LastfmService** to use rate limiter for all API calls

3. **Add config**:
   ```typescript
   // packages/config/src/ai.ts (or new rate-limits.ts)
   lastfm: {
     requestsPerSecond: 4, // Conservative (actual ~5)
     maxRetries: 2,
   }
   ```

**Estimated Effort:** 4 hours
**Priority:** HIGH

---

### 2.2 Cron Job Optimization

**Problem:**
- Current implementation handles ~14 users in ~6-7 seconds
- Will hit 30-second timeout at ~150 users
- USER_LISTENS_SCALING.md has good plan, partially implemented

**Current State:**
- Two-phase processing ✅ (Last.fm batched, Spotify parallel)
- Batch size: 4 users/batch
- No per-user caching ❌
- No active-users-only filtering ❌

**Solution:** Implement per-user caching + active-users-only (Option 2 + Option 4 from USER_LISTENS_SCALING.md)

**Implementation:**

1. **Per-user caching:**
   ```typescript
   // Cache each user's recent track individually
   const userCacheKey = `user-listen:individual:${username}`;

   // On cron: check if user's cache is stale, only fetch if needed
   // On home page: aggregate from individual caches
   ```

2. **Active-users-only filtering:**
   ```typescript
   // Only fetch users who listened in last 2 hours
   const activeUsers = users.filter(async (u) => {
     const cached = await cache.get(`user-listen:individual:${u.lastfm_username}`);
     if (!cached) return true; // New user, fetch
     const data = JSON.parse(cached);
     const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
     return new Date(data.playedAt).getTime() > twoHoursAgo;
   });
   ```

3. **Update home page** to aggregate from individual caches:
   ```typescript
   // Fetch all user listen caches
   const userListens = await Promise.all(
     users.map(u => cache.get(`user-listen:individual:${u.lastfm_username}`))
   );
   // Sort and return top 5
   ```

**Estimated Effort:** 6 hours
**Priority:** HIGH (becomes critical at 100+ users)

---

### 2.3 Monitoring & Alerting

**Problem:**
- No visibility into when limits are approached
- No metrics dashboard
- Hard to know when to implement next scaling phase

**Current State:**
- Logs to Cloudflare ✅
- No structured metrics ❌
- No alerting ❌

**Solution:** Add structured logging + Cloudflare Analytics

**Implementation:**

1. **Add metrics logging** to cron job:
   ```typescript
   // Track key metrics
   const metrics = {
     timestamp: new Date().toISOString(),
     userCount: users.length,
     activeUserCount: activeUsers.length,
     cronDurationMs: totalDuration,
     phase1DurationMs: phase1Duration,
     phase2DurationMs: phase2Duration,
     lastfmErrors: lastfmErrorCount,
     spotifyErrors: spotifyErrorCount,
   };
   console.log('[METRICS]', JSON.stringify(metrics));
   ```

2. **Add rate limit monitoring**:
   ```typescript
   // In rate limiters, log when approaching limits
   if (state.requestCount >= this.maxRequests * 0.8) {
     console.log(`[RATE_LIMIT_WARNING] ${this.service} at 80% capacity`);
   }
   ```

3. **Set up Cloudflare Analytics** custom events (optional, has cost):
   ```typescript
   // Track critical events
   analytics.writeDataPoint({
     blobs: ['rate_limit_hit'],
     doubles: [state.requestCount],
     indexes: [service],
   });
   ```

4. **Add database metrics**:
   ```typescript
   // In cleanup cron
   console.log('[DB_METRICS]', JSON.stringify({
     totalRows: stats.rowCount,
     sessionCount: sessionStats.count,
     searchCount: searchStats.count,
     sessionDeletedCount: sessionsDeleted,
   }));
   ```

**Monitoring Queries:**
```bash
# View cron performance
npx wrangler tail --format=json | grep METRICS

# View rate limit warnings
npx wrangler tail --format=json | grep RATE_LIMIT_WARNING

# View database growth
npx wrangler tail --format=json | grep DB_METRICS
```

**Estimated Effort:** 4 hours
**Priority:** HIGH (needed to trigger future scaling phases)

---

## Phase 3: Optimization (Week 5-8)

These improve performance and reduce costs but aren't critical for basic scaling.

### 3.1 Spotify Batch APIs

**Problem:**
- Cron fetches album images one-by-one (14 API calls for 14 users)
- Spotify provides batch endpoints (20 albums/request)
- Could reduce 14 calls to 1

**Solution:** Implement batch album fetching

See SPOTIFY_RATE_LIMITING.md Phase 3 for details.

**Estimated Effort:** 6 hours
**Priority:** MEDIUM
**Impact:** Reduces Spotify API calls by ~90% in cron job

---

### 3.2 Request Deduplication

**Problem:**
- Multiple users loading same album page = duplicate AI summaries
- Progressive loading can trigger same internal API call multiple times

**Solution:** Add in-flight request tracking

**Implementation:**
```typescript
// packages/services/ai/src/cache.ts
const inFlightRequests = new Map<string, Promise<any>>();

async function getCachedOrFetch(key: string, fetcher: () => Promise<any>) {
  // Check in-flight first
  if (inFlightRequests.has(key)) {
    return inFlightRequests.get(key);
  }

  // Check cache
  const cached = await cache.get(key);
  if (cached) return JSON.parse(cached);

  // Fetch and deduplicate
  const promise = fetcher();
  inFlightRequests.set(key, promise);

  try {
    const result = await promise;
    await cache.put(key, JSON.stringify(result), { ttl });
    return result;
  } finally {
    inFlightRequests.delete(key);
  }
}
```

**Estimated Effort:** 4 hours
**Priority:** MEDIUM
**Impact:** Reduces AI API costs during traffic spikes

---

### 3.3 KV Cache Optimization

**Problem:**
- AI cache has 120-180 day TTLs (huge)
- Eventually consistent KV can cause race conditions
- No cache size monitoring
- Costs unknown

**Solution:**

1. **Review TTLs** - are 180 days needed for all AI content?
   - Album summaries: Rarely change → 180 days ✅
   - Genre summaries: May update with new music → 90 days?
   - Artist summaries: May need updates → 60 days?

2. **Add cache size tracking**:
   ```typescript
   // In cron cleanup
   const cacheStats = await getCacheStats(env.CACHE);
   console.log('[CACHE_METRICS]', JSON.stringify(cacheStats));
   ```

3. **Implement cache eviction** for least-accessed items if size grows

**Estimated Effort:** 6 hours
**Priority:** MEDIUM

---

## Phase 4: Resilience & Advanced Scaling (Month 3+)

Future enhancements for extreme scale.

### 4.1 Circuit Breaker Pattern

Prevent cascade failures when external APIs are down.

See SPOTIFY_RATE_LIMITING.md Option 4 for implementation.

**Estimated Effort:** 8 hours
**Priority:** LOW (nice to have)

---

### 4.2 Multi-Region Deployment

**Problem:**
- D1 is single-region
- High latency for users far from primary region

**Solution:**
- Use D1 Read Replicas (when available)
- Or migrate to Durable Objects for distributed state

**Estimated Effort:** 20+ hours
**Priority:** LOW (only needed at global scale)

---

### 4.3 Cost Optimization

**Problem:**
- AI API costs unknown
- KV costs unknown
- No budget alerts

**Solution:**

1. **Track costs per service**:
   - OpenAI: Log token usage, estimate cost
   - Perplexity: Log request count
   - KV: Track read/write operations
   - D1: Track query count

2. **Add cost estimates** to metrics:
   ```typescript
   const estimatedCost = {
     openai: tokenCount * COST_PER_TOKEN,
     perplexity: requestCount * COST_PER_REQUEST,
     kv: (readCount * KV_READ_COST) + (writeCount * KV_WRITE_COST),
   };
   ```

3. **Set up budget alerts** in Cloudflare dashboard

**Estimated Effort:** 4 hours
**Priority:** LOW (monitor first, optimize if needed)

---

## Implementation Roadmap

### Week 1-2: Critical Fixes
- [ ] 1.1 Spotify rate limiting (8h)
- [ ] 1.2 AI rate limiting (6h)
- [ ] 1.3 Database cleanup (4h)
- **Total:** 18 hours

### Week 3-4: Scaling Infrastructure
- [ ] 2.1 Last.fm rate limiting (4h)
- [ ] 2.2 Cron optimization (6h)
- [ ] 2.3 Monitoring & alerting (4h)
- **Total:** 14 hours

### Week 5-8: Optimization
- [ ] 3.1 Spotify batch APIs (6h)
- [ ] 3.2 Request deduplication (4h)
- [ ] 3.3 KV cache optimization (6h)
- **Total:** 16 hours

### Month 3+: Resilience
- [ ] 4.1 Circuit breakers (8h)
- [ ] 4.2 Multi-region (20h+)
- [ ] 4.3 Cost optimization (4h)
- **Total:** 32+ hours

---

## Monitoring Checklist

### Daily
- [ ] Check Cloudflare Worker errors
- [ ] Review cron job duration logs
- [ ] Check for rate limit warnings

### Weekly
- [ ] Review user count growth
- [ ] Check database row counts
- [ ] Review AI API costs (if available)

### Monthly
- [ ] Analyze cache hit rates
- [ ] Review search/session cleanup effectiveness
- [ ] Plan for next scaling phase if approaching limits

---

## Scaling Triggers

| User Count | Action Required |
|------------|-----------------|
| **50 users** | Implement Phase 1 (Critical Fixes) |
| **100 users** | Implement Phase 2 (Scaling Infrastructure) |
| **150 users** | Must complete Phase 2 (cron timeout risk) |
| **500 users** | Implement Phase 3 (Optimization) + consider Cloudflare Queues |
| **1000+ users** | Implement Phase 4 (Resilience) + evaluate architecture |

---

## Testing Strategy

### Load Testing
```bash
# Test rate limiting
for i in {1..200}; do
  curl -s "https://listentomore.com/album/4LH4d3cOWNNsVw41Gqt2kv" &
done
wait

# Monitor logs
npx wrangler tail | grep "Rate limit"
```

### Database Testing
```bash
# Insert test data
pnpm --filter @listentomore/web exec wrangler d1 execute DB --local \
  --command "INSERT INTO searches (query, searched_at) VALUES ('test', datetime('now', '-100 days'))"

# Run cleanup cron manually
# Verify old data is deleted
```

### Cron Testing
```bash
# Create test users
# Run cron via wrangler
# Measure duration
# Verify <30s timeout
```

---

## Related Documents

- [SPOTIFY_RATE_LIMITING.md](./SPOTIFY_RATE_LIMITING.md) - Detailed Spotify rate limiting implementation
- [USER_LISTENS_SCALING.md](./USER_LISTENS_SCALING.md) - Cron job scaling strategies
- [CLAUDE.md](../CLAUDE.md) - Architecture overview

---

## Appendix: Quick Wins

If you only have 1-2 hours, implement these in order:

1. **Database cleanup cron** (1h) - Prevents unbounded growth
2. **Monitoring logs** (30min) - Visibility into limits
3. **Spotify rate limit logging** (30min) - Warn before incidents

These won't solve the scaling problems but will buy time and provide visibility.
