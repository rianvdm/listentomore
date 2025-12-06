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
| Cloudflare rate limiting for verified bots | Deployed | Googlebot throttled to 2 req/10s |
| Graceful 429 error page (503 response) | Deployed | Better UX during rate limits |

These help but don't protect against:
- Malicious bots ignoring robots.txt
- Sudden viral traffic from legitimate users
- Internal API cascade (home page triggers 40+ parallel requests)

### Why Application-Level Rate Limiting

Application-level rate limiting is the safety net that protects regardless of traffic source. It ensures we never exceed Spotify's limits, even if all other mitigations fail.

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

### Observed Behavior

From production logs, Spotify typically rate limits when we exceed approximately:
- **Search endpoint:** ~100-150 requests/minute
- **Album/Artist detail:** ~150-180 requests/minute
- **Combined:** The shared token means all endpoints share a budget

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

### Phase 3: Future (Higher Effort)

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
4. **Future:** Implement Phase 3 if needed

---

## References

- [Spotify Web API Rate Limits](https://developer.spotify.com/documentation/web-api/concepts/rate-limits)
- [Cloudflare KV Documentation](https://developers.cloudflare.com/kv/)
- Existing AI rate limiting: `packages/services/ai/src/openai.ts`
- Existing batch processing: `apps/web/src/index.tsx` (cron job)
