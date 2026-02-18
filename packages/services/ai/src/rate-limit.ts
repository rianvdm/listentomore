// ABOUTME: Distributed rate limiting for AI APIs using KV storage.
// ABOUTME: Coordinates rate limits across Worker instances for OpenAI.

import { RATE_LIMITS } from '@listentomore/config';

export interface AIRateLimitState {
  requestCount: number;
  windowStart: number;
  retryAfter?: number;
}

export type AIProvider = 'openai';

export class AIRateLimiter {
  private readonly cacheKey: string;
  private readonly windowMs = 60000; // 1 minute window
  private readonly maxRequests: number;

  constructor(
    private cache: KVNamespace,
    private provider: AIProvider
  ) {
    this.cacheKey = `ai:ratelimit:${provider}`;
    this.maxRequests = RATE_LIMITS.openai.requestsPerMinute;
  }

  /**
   * Acquire a rate limit token before making an AI API request.
   * Will wait if rate limit is exceeded or in cooldown from a 429.
   */
  async acquire(): Promise<void> {
    const now = Date.now();
    const state = await this.getState();

    // Check cooldown from previous 429
    if (state.retryAfter && now < state.retryAfter) {
      const waitMs = Math.min(state.retryAfter - now, 30000);
      console.log(`[${this.provider}] Rate limit cooldown, waiting ${waitMs}ms`);
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
      const waitMs = Math.min(this.windowMs - (now - state.windowStart), 30000);
      console.log(
        `[${this.provider}] Local rate limit reached (${state.requestCount}/${this.maxRequests}), waiting ${waitMs}ms`
      );
      await this.sleep(waitMs);
      return this.acquire(); // Retry after wait
    }

    // Log when approaching limit (80% threshold)
    if (state.requestCount >= this.maxRequests * 0.8) {
      console.log(
        `[${this.provider}] Rate limit warning: ${state.requestCount}/${this.maxRequests} requests in window`
      );
    }

    // Increment counter
    await this.setState({
      ...state,
      requestCount: state.requestCount + 1,
    });
  }

  /**
   * Record a 429 response from the AI API and enter cooldown.
   * @param retryAfterSeconds - The Retry-After header value in seconds
   */
  async recordRateLimitResponse(retryAfterSeconds: number): Promise<void> {
    console.log(`[${this.provider}] 429 received, entering cooldown for ${retryAfterSeconds}s`);
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
    provider: AIProvider;
    requestCount: number;
    maxRequests: number;
    windowRemainingMs: number;
    inCooldown: boolean;
  }> {
    const state = await this.getState();
    const now = Date.now();
    return {
      provider: this.provider,
      requestCount: state.requestCount,
      maxRequests: this.maxRequests,
      windowRemainingMs: Math.max(0, this.windowMs - (now - state.windowStart)),
      inCooldown: !!(state.retryAfter && now < state.retryAfter),
    };
  }

  private async getState(): Promise<AIRateLimitState> {
    const cached = await this.cache.get<AIRateLimitState>(this.cacheKey, 'json');
    return cached ?? { requestCount: 0, windowStart: Date.now() };
  }

  private async setState(state: AIRateLimitState): Promise<void> {
    await this.cache.put(this.cacheKey, JSON.stringify(state), {
      expirationTtl: 120, // 2 minute TTL
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
