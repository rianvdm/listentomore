// ABOUTME: Distributed rate limiting for Spotify API using KV storage.
// ABOUTME: Coordinates rate limits across Worker instances.

import { RATE_LIMITS } from '@listentomore/config';

export interface RateLimitState {
  requestCount: number;
  windowStart: number;
  retryAfter?: number;
}

export class SpotifyRateLimiter {
  private readonly cacheKey = 'spotify:ratelimit:state';
  private readonly windowMs = 60000; // 1 minute window
  private readonly maxRequests = RATE_LIMITS.spotify.requestsPerMinute;

  constructor(private cache: KVNamespace) {}

  /**
   * Acquire a rate limit token before making a Spotify API request.
   * Will wait if rate limit is exceeded or in cooldown from a 429.
   */
  async acquire(): Promise<void> {
    const now = Date.now();
    const state = await this.getState();

    // Check cooldown from previous 429
    if (state.retryAfter && now < state.retryAfter) {
      const baseWait = Math.min(state.retryAfter - now, 10000);
      const jitter = Math.random() * 2000; // Add 0-2s jitter
      const waitMs = baseWait + jitter;
      console.log(`[Spotify] Rate limit cooldown, waiting ${Math.round(waitMs)}ms`);
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
      const baseWait = Math.min(this.windowMs - (now - state.windowStart), 10000);
      // Add jitter (20-50% of wait time) to prevent thundering herd
      const jitterPercent = 0.2 + Math.random() * 0.3; // 20-50%
      const jitter = baseWait * jitterPercent;
      const waitMs = baseWait + jitter;
      console.log(`[Spotify] Local rate limit reached (${state.requestCount}/${this.maxRequests}), waiting ${Math.round(waitMs)}ms (with jitter)`);
      await this.sleep(waitMs);
      return this.acquire(); // Retry after wait
    }

    // Log when approaching limit (80% threshold)
    if (state.requestCount >= this.maxRequests * 0.8) {
      console.log(`[Spotify] Rate limit warning: ${state.requestCount}/${this.maxRequests} requests in window`);
    }

    // Increment counter
    await this.setState({
      ...state,
      requestCount: state.requestCount + 1,
    });
  }

  /**
   * Record a 429 response from Spotify and enter cooldown.
   * @param retryAfterSeconds - The Retry-After header value in seconds
   */
  async recordRateLimitResponse(retryAfterSeconds: number): Promise<void> {
    console.log(`[Spotify] 429 received, entering cooldown for ${retryAfterSeconds}s`);
    await this.setState({
      requestCount: 0,
      windowStart: Date.now(),
      retryAfter: Date.now() + retryAfterSeconds * 1000,
    });
  }

  /**
   * Get current rate limit state for monitoring/debugging.
   */
  async getStats(): Promise<{
    requestCount: number;
    maxRequests: number;
    windowRemainingMs: number;
    inCooldown: boolean;
  }> {
    const state = await this.getState();
    const now = Date.now();
    return {
      requestCount: state.requestCount,
      maxRequests: this.maxRequests,
      windowRemainingMs: Math.max(0, this.windowMs - (now - state.windowStart)),
      inCooldown: !!(state.retryAfter && now < state.retryAfter),
    };
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
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
