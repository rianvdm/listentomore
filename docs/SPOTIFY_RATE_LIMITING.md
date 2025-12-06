# Spotify API Rate Limiting Implementation Plan

> **For LLMs:** This document outlines how to implement application-level rate limiting for Spotify API calls. The goal is to prevent 429 errors from Spotify's API by proactively throttling requests before hitting their limits. This protects the application from external traffic spikes (bots, crawlers, viral traffic) and ensures reliable service for legitimate users.

---

## Background

### The Problem (December 2025 Incident)

Googlebot aggressively crawled `/album/*` and `/artist/*` pages, causing:
1. Cache misses for unique album/artist IDs
2. Each miss triggered a Spotify API call
3. Spotify returned 429 (Too Many Requests)
4. All subsequent requests failed, including legitimate users
5. Error cascaded to internal APIs that also need Spotify data

### Mitigations Already Deployed

| Mitigation | Status | Effect |
|------------|--------|--------|
| `robots.txt` with Crawl-delay | Deployed | Polite bots slow down |
| Cloudflare rate limiting for verified bots | Deployed | Googlebot throttled to 2 req/10s on `/album/*` and `/artist/*` |
| Cloudflare aggressive bot rate limit | Deployed | All verified bots rate limited site-wide |
| Graceful 429 error page (503 response) | Deployed | Better UX during rate limits |
| Detailed Spotify logging | Deployed | Cache hit/miss and 429 with Retry-After logged |

These help but don't protect against:
- Malicious bots ignoring robots.txt
- Sudden viral traffic from legitimate users
- Internal API cascade (home page triggers 40+ parallel requests)

### Why Application-Level Rate Limiting

Application-level rate limiting is the safety net that protects regardless of traffic source. It ensures we never exceed Spotify's limits, even if all other mitigations fail.

### Alternative: Multiple Spotify Apps

Another immediate mitigation is using **separate Spotify developer apps** for different services. Each app has its own rate limit budget, effectively multiplying available quota.

**Recommended split:**
| App | Used For | Why |
|-----|----------|-----|
| Primary app | Album/artist detail pages, search | User-facing, needs to be responsive |
| Secondary app | Streaming-links service | High parallelism from home page (40+ requests) |

This isolates the streaming-links cascade from affecting the main user experience.

See **Appendix: Setting Up a Secondary Spotify App** for implementation details.

---

## Spotify API Rate Limits

### Official Limits

Spotify doesn't publish exact rate limits. From documentation and community experience:

| Aspect | Behavior |
|--------|----------|
| Rate limit type | Rolling window (not fixed) |
| Typical threshold | ~180 requests/minute (varies by endpoint) |
| Response on limit | HTTP 429 with `Retry-After` header |
| Retry-After | Seconds until rate limit resets (typically 1-30s) |
| Token scope | Rate limits apply per access token |

### Official Guidance from Spotify

From [Spotify's Rate Limits documentation](https://developer.spotify.com/documentation/web-api/concepts/rate-limits):

> **Develop a backoff-retry strategy:** When your app has been rate limited it will receive a 429 error response from Spotify. Your app can use this information as a cue to slow down the number of API requests that it makes to the Web API. The header of the 429 response will normally include a Retry-After header with a value in seconds. Consider waiting for the number of seconds specified in Retry-After before your app calls the Web API again.

> **Use batch APIs to your advantage:** Spotify has some APIs — like the Get Multiple Albums endpoint — that allow you to fetch a batch of data in one API request. You can reduce your API requests by calling the batch APIs when you know that you will need data from a set of objects.

### Batch API Endpoints

Spotify provides batch endpoints that significantly reduce API calls:

| Endpoint | Path | Max Items | Current Usage |
|----------|------|-----------|---------------|
| Get Multiple Albums | `GET /albums?ids={ids}` | 20 | Not used - we fetch individually |
| Get Multiple Artists | `GET /artists?ids={ids}` | 50 | Not used - we fetch individually |
| Get Several Tracks | `GET /tracks?ids={ids}` | 50 | Not used |

**Optimization opportunity:** The cron job fetches Spotify album images for ~14 users individually. Using the batch endpoint would reduce 14 API calls to 1.

### Observed Behavior

From production logs, Spotify typically rate limits when we exceed approximately:
- **Search endpoint:** ~100-150 requests/minute
- **Album/Artist detail:** ~150-180 requests/minute
- **Combined:** The shared token means all endpoints share a budget

### Escalating Rate Limits (Critical Learning)

**Spotify escalates `Retry-After` dramatically when you repeatedly hit 429s.** During the December 2025 incident:

| Stage | Retry-After Value | Duration |
|-------|-------------------|----------|
| Initial 429s | 5-30 seconds | Normal |
| Continued abuse | 37,000+ seconds | **10+ hours** |

This means if you continue making requests after receiving 429s, Spotify will effectively **ban your token for hours**. The only recovery options are:
1. Wait 10+ hours for the ban to lift
2. Create a new Spotify app with fresh credentials (new rate limit budget)

**Implication:** Implementing proper rate limiting isn't just about avoiding 429s—it's about avoiding the escalation that leads to hours-long bans.

### Recovery Procedure

If the Spotify token gets banned (Retry-After > 1 hour):

1. **Create new Spotify app** at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
2. **Get new refresh token** via OAuth flow (use `https://listentomore.com/auth/callback` as redirect - add route temporarily if needed)
3. **Update Cloudflare secrets:**
   ```bash
   cd apps/web
   echo "NEW_CLIENT_ID" | npx wrangler secret put SPOTIFY_CLIENT_ID
   echo "NEW_CLIENT_SECRET" | npx wrangler secret put SPOTIFY_CLIENT_SECRET
   echo "NEW_REFRESH_TOKEN" | npx wrangler secret put SPOTIFY_REFRESH_TOKEN
   ```
4. **Clear cached token:**
   ```bash
   npx wrangler kv key delete --namespace-id=a6011a8b5bac4be9a472ff86f8d5fd91 --remote "spotify:token"
   ```
5. **Rotate credentials** afterward since they were exposed during the process

### Key Insight: Single Token

All ListenToMore Spotify requests use a **single OAuth refresh token**. This means:
- Every Worker instance shares the same rate limit budget
- Parallel requests from different users compete for the same quota
- The cron job and user requests share the same limit

---

## Current Architecture

### Spotify Service Structure

```
packages/services/spotify/src/
├── index.ts      # SpotifyService (facade combining all modules)
├── auth.ts       # SpotifyAuth (token refresh, caching)
├── search.ts     # SpotifySearch (search with caching)
├── albums.ts     # SpotifyAlbums (album details with caching)
└── artists.ts    # SpotifyArtists (artist details with caching)
```

### Request Flow

```
User Request → SpotifyService.getAlbum()
                     ↓
              SpotifyAlbums.getAlbum()
                     ↓
              Check KV Cache → Hit? Return cached
                     ↓ Miss
              SpotifyAuth.getAccessToken()
                     ↓
              fetchWithTimeout() → Spotify API
                     ↓
              Cache result in KV
                     ↓
              Return to user
```

### Existing Rate Limiting Pattern (AI Services)

The AI services (OpenAI, Perplexity) already implement rate limiting:

```typescript
// From packages/services/ai/src/openai.ts

interface RateLimitWindow {
  requestCount: number;
  windowStart: number;
}

export class OpenAIClient {
  private rateLimitWindow: RateLimitWindow = {
    requestCount: 0,
    windowStart: Date.now(),
  };

  private async checkRateLimit(): Promise<void> {
    const now = Date.now();
    const windowMs = 60000; // 1 minute window

    // Reset window if expired
    if (now - this.rateLimitWindow.windowStart >= windowMs) {
      this.rateLimitWindow = { requestCount: 0, windowStart: now };
    }

    // Check if we're over the limit
    if (this.rateLimitWindow.requestCount >= RATE_LIMITS.openai.requestsPerMinute) {
      const waitMs = windowMs - (now - this.rateLimitWindow.windowStart);
      console.log(`[OpenAI] Rate limited, waiting ${waitMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      this.rateLimitWindow = { requestCount: 0, windowStart: Date.now() };
    }

    this.rateLimitWindow.requestCount++;
  }
}
```

**Problem with this approach for Spotify:** In a serverless environment (Cloudflare Workers), each request may run in a different isolate. Instance-level counters don't persist across requests, making this pattern ineffective.

---

## Implementation Options

### Option 1: KV-Based Distributed Rate Limiting

**Complexity:** Medium
**Effectiveness:** High
**Recommended:** Yes

Use Cloudflare KV to track request counts across all Worker instances.

```typescript
interface SpotifyRateLimitState {
  requestCount: number;
  windowStart: number;
  retryAfter?: number; // Set when 429 received
}

async function checkRateLimit(cache: KVNamespace): Promise<void> {
  const key = 'spotify:ratelimit:state';
  const now = Date.now();
  const windowMs = 60000;
  const maxRequests = 120; // Conservative limit

  const state = await cache.get<SpotifyRateLimitState>(key, 'json')
    ?? { requestCount: 0, windowStart: now };

  // Check if in cooldown from 429
  if (state.retryAfter && now < state.retryAfter) {
    const waitMs = state.retryAfter - now;
    console.log(`[Spotify] In cooldown, waiting ${waitMs}ms`);
    await new Promise(resolve => setTimeout(resolve, Math.min(waitMs, 5000)));
  }

  // Reset window if expired
  if (now - state.windowStart >= windowMs) {
    state.requestCount = 0;
    state.windowStart = now;
    state.retryAfter = undefined;
  }

  // Check if over limit
  if (state.requestCount >= maxRequests) {
    const waitMs = windowMs - (now - state.windowStart);
    console.log(`[Spotify] Rate limited locally, waiting ${waitMs}ms`);
    await new Promise(resolve => setTimeout(resolve, Math.min(waitMs, 5000)));
    state.requestCount = 0;
    state.windowStart = Date.now();
  }

  state.requestCount++;

  // Write back with short TTL
  await cache.put(key, JSON.stringify(state), { expirationTtl: 120 });
}

async function handleRateLimitResponse(
  response: Response,
  cache: KVNamespace
): Promise<void> {
  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('Retry-After') || '30', 10);
    const state: SpotifyRateLimitState = {
      requestCount: 0,
      windowStart: Date.now(),
      retryAfter: Date.now() + (retryAfter * 1000),
    };
    await cache.put('spotify:ratelimit:state', JSON.stringify(state), {
      expirationTtl: retryAfter + 60
    });
    console.log(`[Spotify] 429 received, cooldown for ${retryAfter}s`);
  }
}
```

**Pros:**
- Works across all Worker instances
- Respects Spotify's `Retry-After` header
- Proactively prevents hitting limits

**Cons:**
- KV read/write adds ~10-50ms latency per request
- KV is eventually consistent (may overshoot briefly)
- Adds complexity to service

### Option 2: Request Queuing with Delays

**Complexity:** Low
**Effectiveness:** Medium
**Recommended:** As supplement to Option 1

Add fixed delays between non-cached Spotify requests.

```typescript
const SPOTIFY_REQUEST_DELAY_MS = 100; // 10 requests/second max

async function makeSpotifyRequest(url: string, options: RequestInit): Promise<Response> {
  // Simple delay to spread out requests
  await new Promise(resolve => setTimeout(resolve, SPOTIFY_REQUEST_DELAY_MS));
  return fetchWithTimeout(url, options);
}
```

**Pros:**
- Simple to implement
- No external dependencies

**Cons:**
- Adds latency to every uncached request
- Doesn't coordinate across instances
- Doesn't handle 429 responses

### Option 3: Retry with Exponential Backoff

**Complexity:** Low
**Effectiveness:** Medium (reactive only)
**Recommended:** Yes, in combination with Option 1

Handle 429 responses gracefully with retries.

```typescript
async function fetchWithRetry(
  url: string,
  options: FetchWithTimeoutOptions,
  maxRetries: number = 2
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetchWithTimeout(url, options);

    if (response.status !== 429) {
      return response;
    }

    if (attempt === maxRetries) {
      return response; // Return 429 to caller
    }

    const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
    const waitMs = Math.min(retryAfter * 1000, 10000); // Cap at 10 seconds
    console.log(`[Spotify] 429, retry ${attempt + 1}/${maxRetries} after ${waitMs}ms`);
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }

  throw new Error('Unreachable');
}
```

**Pros:**
- Recovers from transient rate limits
- Respects `Retry-After` header
- Simple to implement

**Cons:**
- Reactive (waits for 429 before acting)
- Can cause request pile-up under sustained load

### Option 4: Circuit Breaker Pattern

**Complexity:** Medium
**Effectiveness:** High
**Recommended:** Future enhancement

When errors exceed a threshold, "open" the circuit and fail fast for a period.

```typescript
interface CircuitState {
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  lastFailure: number;
  openUntil?: number;
}

const FAILURE_THRESHOLD = 5;
const RESET_TIMEOUT_MS = 30000;

async function checkCircuit(cache: KVNamespace): Promise<boolean> {
  const state = await cache.get<CircuitState>('spotify:circuit', 'json')
    ?? { state: 'closed', failures: 0, lastFailure: 0 };

  if (state.state === 'open') {
    if (Date.now() > (state.openUntil || 0)) {
      state.state = 'half-open';
      await cache.put('spotify:circuit', JSON.stringify(state));
      return true; // Allow one test request
    }
    return false; // Circuit open, fail fast
  }

  return true; // Circuit closed or half-open
}
```

**Pros:**
- Prevents cascade failures
- Fast failure during outages
- Self-healing

**Cons:**
- More complex state management
- Requires tuning thresholds

---

## Recommended Implementation

### Phase 1: Immediate (Low Effort)

1. **Add retry with backoff** to all Spotify API calls
2. **Add config** for Spotify rate limits in `packages/config/src/ai.ts`

### Phase 2: Near-term (Medium Effort)

1. **Implement KV-based rate limiting** in a new `packages/services/spotify/src/rate-limit.ts`
2. **Integrate into SpotifyService** as a shared rate limiter
3. **Log rate limit events** for monitoring

### Phase 3: Batch API Optimization (Medium Effort)

1. **Add batch album fetching** - `getAlbums(ids: string[])` using `/albums?ids=`
2. **Add batch artist fetching** - `getArtists(ids: string[])` using `/artists?ids=`
3. **Update cron job** to use batch endpoints for Spotify image enrichment
4. **Update internal APIs** that fetch multiple items to batch requests

### Phase 4: Future (Higher Effort)

1. **Circuit breaker** for complete Spotify outages
2. **Metrics/alerting** on rate limit frequency

---

## Detailed Implementation Steps

### Step 1: Add Rate Limit Config

**File:** `packages/config/src/ai.ts` (or create `rate-limits.ts`)

```typescript
export const RATE_LIMITS = {
  openai: {
    requestsPerMinute: 60,
    tokensPerMinute: 90000,
  },
  perplexity: {
    requestsPerMinute: 30,
  },
  // Add Spotify
  spotify: {
    requestsPerMinute: 120, // Conservative limit (Spotify allows ~180)
    maxRetries: 2,
    retryDelayMs: 1000,
  },
} as const;
```

### Step 2: Create Rate Limiter Module

**File:** `packages/services/spotify/src/rate-limit.ts`

```typescript
// ABOUTME: Distributed rate limiting for Spotify API using KV storage.
// ABOUTME: Coordinates rate limits across Worker instances.

import { RATE_LIMITS } from '@listentomore/config';

export interface RateLimitState {
  requestCount: number;
  windowStart: number;
  retryAfter?: number;
}

export class SpotifyRateLimiter {
  private cache: KVNamespace;
  private readonly cacheKey = 'spotify:ratelimit:state';
  private readonly windowMs = 60000;
  private readonly maxRequests = RATE_LIMITS.spotify.requestsPerMinute;

  constructor(cache: KVNamespace) {
    this.cache = cache;
  }

  async acquire(): Promise<void> {
    const now = Date.now();
    const state = await this.getState();

    // Check cooldown from previous 429
    if (state.retryAfter && now < state.retryAfter) {
      const waitMs = Math.min(state.retryAfter - now, 10000);
      console.log(`[Spotify] Rate limit cooldown, waiting ${waitMs}ms`);
      await this.sleep(waitMs);
      return this.acquire(); // Retry after wait
    }

    // Reset window if expired
    if (now - state.windowStart >= this.windowMs) {
      await this.setState({
        requestCount: 1,
        windowStart: now,
      });
      return;
    }

    // Check if over limit
    if (state.requestCount >= this.maxRequests) {
      const waitMs = Math.min(this.windowMs - (now - state.windowStart), 10000);
      console.log(`[Spotify] Local rate limit, waiting ${waitMs}ms`);
      await this.sleep(waitMs);
      return this.acquire(); // Retry after wait
    }

    // Increment counter
    await this.setState({
      ...state,
      requestCount: state.requestCount + 1,
    });
  }

  async recordRateLimitResponse(retryAfterSeconds: number): Promise<void> {
    console.log(`[Spotify] 429 received, cooldown for ${retryAfterSeconds}s`);
    await this.setState({
      requestCount: 0,
      windowStart: Date.now(),
      retryAfter: Date.now() + (retryAfterSeconds * 1000),
    });
  }

  private async getState(): Promise<RateLimitState> {
    const cached = await this.cache.get<RateLimitState>(this.cacheKey, 'json');
    return cached ?? { requestCount: 0, windowStart: Date.now() };
  }

  private async setState(state: RateLimitState): Promise<void> {
    await this.cache.put(this.cacheKey, JSON.stringify(state), {
      expirationTtl: 120, // 2 minute TTL
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### Step 3: Create Retry Wrapper

**File:** `packages/services/spotify/src/fetch.ts`

```typescript
// ABOUTME: Spotify-specific fetch with rate limiting and retry logic.
// ABOUTME: Wraps fetchWithTimeout with 429 handling.

import { fetchWithTimeout, FetchWithTimeoutOptions } from '@listentomore/shared';
import { RATE_LIMITS } from '@listentomore/config';
import type { SpotifyRateLimiter } from './rate-limit';

export async function spotifyFetch(
  url: string,
  options: FetchWithTimeoutOptions,
  rateLimiter: SpotifyRateLimiter
): Promise<Response> {
  const maxRetries = RATE_LIMITS.spotify.maxRetries;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Acquire rate limit token before request
    await rateLimiter.acquire();

    const response = await fetchWithTimeout(url, options);

    if (response.status !== 429) {
      return response;
    }

    // Handle 429
    const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
    await rateLimiter.recordRateLimitResponse(retryAfter);

    if (attempt === maxRetries) {
      console.error(`[Spotify] Max retries exceeded for ${url}`);
      return response; // Return 429 to caller
    }

    console.log(`[Spotify] Retry ${attempt + 1}/${maxRetries} for ${url}`);
  }

  throw new Error('Unreachable');
}
```

### Step 4: Integrate into SpotifyService

**File:** `packages/services/spotify/src/index.ts`

```typescript
import { SpotifyRateLimiter } from './rate-limit';

export class SpotifyService {
  public readonly auth: SpotifyAuth;
  public readonly search: SpotifySearch;
  public readonly albums: SpotifyAlbums;
  public readonly artists: SpotifyArtists;
  public readonly rateLimiter: SpotifyRateLimiter;

  constructor(config: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    cache: KVNamespace;
  }) {
    // Create shared rate limiter
    this.rateLimiter = new SpotifyRateLimiter(config.cache);

    this.auth = new SpotifyAuth(/* ... */);
    // Pass rateLimiter to each module
    this.search = new SpotifySearch(this.auth, config.cache, this.rateLimiter);
    this.albums = new SpotifyAlbums(this.auth, config.cache, this.rateLimiter);
    this.artists = new SpotifyArtists(this.auth, config.cache, this.rateLimiter);
  }
}
```

### Step 5: Update Album/Artist/Search Modules

Update each module to use `spotifyFetch` instead of `fetchWithTimeout`:

```typescript
// In albums.ts, artists.ts, search.ts

import { spotifyFetch } from './fetch';
import type { SpotifyRateLimiter } from './rate-limit';

export class SpotifyAlbums {
  constructor(
    private auth: SpotifyAuth,
    private cache: KVNamespace,
    private rateLimiter: SpotifyRateLimiter
  ) {}

  async getAlbum(albumId: string): Promise<AlbumDetails> {
    // ... cache check ...

    const accessToken = await this.auth.getAccessToken();

    // Use spotifyFetch instead of fetchWithTimeout
    const response = await spotifyFetch(
      `${SPOTIFY_API_BASE}/albums/${encodeURIComponent(albumId)}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 'fast',
      },
      this.rateLimiter
    );

    // ... rest of method ...
  }
}
```

---

## Testing Strategy

### Unit Tests

```typescript
describe('SpotifyRateLimiter', () => {
  it('should allow requests under limit', async () => {
    const limiter = new SpotifyRateLimiter(mockKV);
    await limiter.acquire(); // Should not throw
  });

  it('should block when over limit', async () => {
    const limiter = new SpotifyRateLimiter(mockKV);
    // Simulate hitting limit
    await mockKV.put('spotify:ratelimit:state', JSON.stringify({
      requestCount: 120,
      windowStart: Date.now(),
    }));

    const start = Date.now();
    await limiter.acquire();
    expect(Date.now() - start).toBeGreaterThan(1000); // Should have waited
  });

  it('should respect Retry-After from 429', async () => {
    const limiter = new SpotifyRateLimiter(mockKV);
    await limiter.recordRateLimitResponse(5);

    const state = await mockKV.get('spotify:ratelimit:state', 'json');
    expect(state.retryAfter).toBeGreaterThan(Date.now());
  });
});
```

### Integration Tests

1. Deploy to staging
2. Run load test: 200 requests in 60 seconds
3. Verify no 429 errors from Spotify
4. Verify rate limiter logged throttling events

### Monitoring

After deployment, monitor:
- `[Spotify] Rate limit cooldown` log frequency
- `[Spotify] 429 received` occurrences
- Overall album/artist page success rate

---

## Rollout Plan

1. **Week 1:** Implement Phase 1 (retry with backoff)
2. **Week 2:** Implement Phase 2 (KV-based rate limiting)
3. **Week 3:** Monitor and tune limits
4. **Week 4:** Implement Phase 3 (batch APIs) - biggest impact on reducing API calls
5. **Future:** Implement Phase 4 (circuit breaker) if needed

---

## User Experience During Rate Limiting

### Current State (Without Application-Level Rate Limiting)

When Spotify rate limits occur, users experience:

| Page/Feature | Cached Data | Uncached Data |
|--------------|-------------|---------------|
| **Album detail page** | Works normally | Shows "Temporarily Unavailable" (503) |
| **Artist detail page** | Works normally | Shows "Temporarily Unavailable" (503) |
| **Home page** | Partial - cached listens show | Some streaming links may fail silently |
| **Search** | Cached searches work | New searches fail with error |
| **AI summaries** | Work (separate service) | Work (separate service) |
| **Streaming links** | Cached links show | Fail silently (Spotify link only) |

**Key insight:** The site degrades gracefully—cached content continues to work. Only uncached Spotify requests fail.

### During Viral Traffic (Hypothetical)

If ListenToMore goes viral and 1000 users simultaneously visit unique album pages:

**Without rate limiting (current):**
1. First ~150 requests succeed and get cached
2. Spotify returns 429 for remaining ~850 requests
3. If requests continue, Retry-After escalates to hours
4. All uncached requests show "Temporarily Unavailable"
5. Site appears broken for new album/artist pages
6. Manual intervention required (new Spotify app)

**With rate limiting (after implementation):**
1. First ~120 requests/minute proceed normally
2. Excess requests queue/wait (adds latency but succeeds)
3. Users experience slower load times (seconds, not failures)
4. No 429s from Spotify = no escalation risk
5. Site remains functional, just slower under load
6. Caching naturally reduces load as popular items get cached

### Graceful Degradation Strategy

The "Temporarily Unavailable" page (`RateLimitedPage` component) provides:
- Clear message: "We're experiencing high traffic"
- Retry suggestion: "Please try again in a minute or two"
- Navigation: Link to search page
- HTTP 503 status: Tells crawlers the issue is temporary

**File:** `apps/web/src/components/ui/ErrorPage.tsx`

### Monitoring During High Traffic

Watch for these log patterns:

```
[Spotify] Cache hit for album X          ← Good: serving from cache
[Spotify] Cache miss, fetching album X   ← Neutral: hitting API
[Spotify] 429 Rate Limited, Retry-After: 30s  ← Warning: rate limited
[Spotify] 429 Rate Limited, Retry-After: 37000s  ← Critical: token banned
```

If Retry-After exceeds 3600 seconds (1 hour), consider switching to backup Spotify app credentials.

---

## Appendix: Setting Up a Secondary Spotify App

This appendix covers creating a separate Spotify app for the streaming-links service to isolate its rate limit budget.

### Step 1: Create the Spotify App

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Click **Create App**
3. Fill in:
   - **App name:** `ListenToMore-StreamingLinks` (or similar)
   - **App description:** Secondary app for streaming links service
   - **Redirect URI:** `https://listentomore.com/auth/callback`
   - **APIs used:** Check "Web API"
4. Click **Create**
5. Go to **Settings** and note:
   - **Client ID**
   - **Client Secret** (click "View client secret")

### Step 2: Add Temporary OAuth Callback Route

Add this route to `apps/web/src/index.tsx` temporarily to get the refresh token:

```typescript
// Temporary OAuth callback for Spotify token generation (remove after use)
app.get('/auth/callback', (c) => {
  const code = c.req.query('code');
  const error = c.req.query('error');
  if (error) {
    return c.text(`Error: ${error}`, 400);
  }
  if (!code) {
    return c.text('No code received', 400);
  }
  return c.html(
    <html>
      <body style={{ fontFamily: 'monospace', padding: '2rem' }}>
        <h1>Spotify Auth Code</h1>
        <p>Copy this code:</p>
        <textarea readonly style={{ width: '100%', height: '100px', fontSize: '14px' }}>{code}</textarea>
        <p style={{ color: '#666', marginTop: '1rem' }}>Use this in the curl command to get your refresh token.</p>
      </body>
    </html>
  );
});
```

Deploy, then remove this route after getting the token.

### Step 3: Get the Refresh Token

1. **Authorize the app** - Visit this URL (replace `YOUR_CLIENT_ID`):
   ```
   https://accounts.spotify.com/authorize?client_id=YOUR_CLIENT_ID&response_type=code&redirect_uri=https://listentomore.com/auth/callback&scope=user-read-private%20user-read-email
   ```

2. **Copy the code** from the callback page

3. **Exchange for tokens:**
   ```bash
   curl -X POST https://accounts.spotify.com/api/token \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "grant_type=authorization_code" \
     -d "code=YOUR_CODE_HERE" \
     -d "redirect_uri=https://listentomore.com/auth/callback" \
     -d "client_id=YOUR_CLIENT_ID" \
     -d "client_secret=YOUR_CLIENT_SECRET"
   ```

4. **Save the `refresh_token`** from the response

### Step 4: Add Cloudflare Secrets

```bash
cd apps/web

# Secondary app credentials (for streaming-links)
npx wrangler secret put SPOTIFY_STREAMING_CLIENT_ID
# paste client ID

npx wrangler secret put SPOTIFY_STREAMING_CLIENT_SECRET
# paste client secret

npx wrangler secret put SPOTIFY_STREAMING_REFRESH_TOKEN
# paste refresh token
```

### Step 5: Update Environment Bindings

Add to `apps/web/wrangler.toml` under `[vars]` or as secrets:

```toml
# These are set via `wrangler secret put`:
# SPOTIFY_STREAMING_CLIENT_ID
# SPOTIFY_STREAMING_CLIENT_SECRET
# SPOTIFY_STREAMING_REFRESH_TOKEN
```

Update the `Bindings` type in `apps/web/src/index.tsx`:

```typescript
type Bindings = {
  // ... existing bindings ...

  // Secondary Spotify app for streaming-links
  SPOTIFY_STREAMING_CLIENT_ID?: string;
  SPOTIFY_STREAMING_CLIENT_SECRET?: string;
  SPOTIFY_STREAMING_REFRESH_TOKEN?: string;
};
```

### Step 6: Create Secondary SpotifyService

In the middleware that initializes services, create a second SpotifyService for streaming-links:

```typescript
// In apps/web/src/index.tsx middleware

// Primary Spotify service (album/artist pages, search)
const spotify = new SpotifyService({
  clientId: c.env.SPOTIFY_CLIENT_ID,
  clientSecret: c.env.SPOTIFY_CLIENT_SECRET,
  refreshToken: c.env.SPOTIFY_REFRESH_TOKEN,
  cache: c.env.CACHE,
});

// Secondary Spotify service for streaming-links (if configured)
const spotifyStreaming = c.env.SPOTIFY_STREAMING_CLIENT_ID
  ? new SpotifyService({
      clientId: c.env.SPOTIFY_STREAMING_CLIENT_ID,
      clientSecret: c.env.SPOTIFY_STREAMING_CLIENT_SECRET!,
      refreshToken: c.env.SPOTIFY_STREAMING_REFRESH_TOKEN!,
      cache: c.env.CACHE,
    })
  : spotify; // Fall back to primary if not configured

c.set('spotify', spotify);
c.set('spotifyStreaming', spotifyStreaming);
```

### Step 7: Update StreamingLinksService

Update the streaming-links service to use the secondary Spotify service:

```typescript
// In the streaming-links internal API endpoint
app.get('/api/internal/streaming-links', async (c) => {
  // Use secondary Spotify service if available
  const spotify = c.get('spotifyStreaming') as SpotifyService;
  // ... rest of handler
});
```

### Step 8: Clean Up

1. Remove the `/auth/callback` route from `index.tsx`
2. Deploy the changes
3. **Rotate the credentials** - generate new client secret in Spotify dashboard since the original was exposed during setup

### Benefits

- Streaming-links can make 40+ parallel requests without affecting main app
- If streaming-links gets rate limited, album/artist pages still work
- Doubles effective rate limit budget
- Easy rollback - just remove secondary credentials to revert

### Troubleshooting

#### "Invalid refresh token" error

**Symptom:** `{"error":"invalid_grant","error_description":"Invalid refresh token"}`

**Common causes:**

1. **Wrong token type** - You copied the `access_token` instead of `refresh_token`
   - Access tokens start with `BQ` and expire in 1 hour
   - Refresh tokens start with `AQ` and don't expire
   - Always use the `refresh_token` field from the curl response

2. **Token corrupted during secret upload** - Shell escaping issues can corrupt the token
   - Use `printf '%s' 'TOKEN' | npx wrangler secret put SECRET_NAME` to avoid issues
   - Verify token length in logs matches expected (~131 characters for Spotify refresh tokens)

3. **Authorization code expired** - Codes expire within minutes
   - Run the curl command immediately after getting the code
   - If it fails, re-authorize and get a fresh code

4. **Redirect URI mismatch** - Must match exactly what's registered in Spotify app
   - Check for http vs https, trailing slashes, typos
   - Must be exactly: `https://listentomore.com/auth/callback`

**Debugging tips:**

Add temporary logging to verify token is being passed correctly:
```typescript
console.log(`[Spotify] Token len: ${c.env.SPOTIFY_STREAMING_REFRESH_TOKEN?.length}`);
```

Working primary token should be ~131 characters. If secondary token length differs significantly, the secret was corrupted.

#### Verifying the setup works

After setup, check that both apps have separate cached tokens:
```bash
npx wrangler kv key list --namespace-id=YOUR_KV_ID --remote --prefix="spotify:token"
```

Should show two entries with different client IDs:
```json
[
  { "name": "spotify:token:PRIMARY_CLIENT_ID", ... },
  { "name": "spotify:token:SECONDARY_CLIENT_ID", ... }
]
```

#### Token cache key format

Each Spotify app caches its access token separately using the client ID:
- Primary: `spotify:token:{PRIMARY_CLIENT_ID}`
- Secondary: `spotify:token:{SECONDARY_CLIENT_ID}`

This ensures each app maintains its own token and rate limit budget.

#### Implementation notes

The `SpotifyAuth` class in `packages/services/spotify/src/auth.ts` handles token refresh:

1. **Token cache key includes client ID** - Each app has its own cached token
2. **URL encoding** - The refresh token is URL-encoded using `URLSearchParams` to handle special characters
3. **Logging** - Token refresh logs include client ID prefix (first 8 chars) for debugging

---

## References

- [Spotify Web API Rate Limits](https://developer.spotify.com/documentation/web-api/concepts/rate-limits)
- [Cloudflare KV Documentation](https://developers.cloudflare.com/kv/)
- Existing AI rate limiting: `packages/services/ai/src/openai.ts`
- Existing batch processing: `apps/web/src/index.tsx` (cron job)
