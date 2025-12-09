// Discogs API client with rate limiting and error handling

import type { DiscogsConfig, RateLimitInfo } from './types';

const DISCOGS_API_BASE = 'https://api.discogs.com';
const DEFAULT_USER_AGENT = 'ListenToMore/1.0 +https://listentomore.com';

// Discogs rate limits: 60 req/min authenticated, 25 req/min unauthenticated
const RATE_LIMIT_AUTHENTICATED = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

export class DiscogsClient {
  private accessToken: string;
  private userAgent: string;
  private rateLimitInfo: RateLimitInfo = {
    remaining: RATE_LIMIT_AUTHENTICATED,
    limit: RATE_LIMIT_AUTHENTICATED,
    resetAt: null,
  };

  constructor(config: DiscogsConfig) {
    this.accessToken = config.accessToken;
    this.userAgent = config.userAgent || DEFAULT_USER_AGENT;
  }

  /**
   * Make an authenticated request to the Discogs API
   */
  async request<T>(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
      params?: Record<string, string | number>;
      body?: unknown;
      skipRateLimit?: boolean;
    } = {}
  ): Promise<T> {
    const { method = 'GET', params, body, skipRateLimit = false } = options;

    // Check rate limit before making request
    if (!skipRateLimit) {
      await this.waitForRateLimit();
    }

    // Build URL with query params
    const url = new URL(`${DISCOGS_API_BASE}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, String(value));
      });
    }

    const headers: Record<string, string> = {
      Authorization: `Discogs token=${this.accessToken}`,
      'User-Agent': this.userAgent,
      Accept: 'application/vnd.discogs.v2.discogs+json',
    };

    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url.toString(), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    // Update rate limit info from response headers
    this.updateRateLimitFromHeaders(response.headers);

    if (!response.ok) {
      if (response.status === 429) {
        // Rate limited - wait and retry
        const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
        console.warn(`Discogs rate limited. Waiting ${retryAfter}s before retry.`);
        await this.sleep(retryAfter * 1000);
        return this.request<T>(endpoint, options);
      }

      const errorText = await response.text();
      throw new Error(`Discogs API error ${response.status}: ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Update rate limit info from response headers
   */
  private updateRateLimitFromHeaders(headers: Headers): void {
    const remaining = headers.get('X-Discogs-Ratelimit-Remaining');
    const limit = headers.get('X-Discogs-Ratelimit');

    if (remaining !== null) {
      this.rateLimitInfo.remaining = parseInt(remaining, 10);
    }
    if (limit !== null) {
      this.rateLimitInfo.limit = parseInt(limit, 10);
    }
  }

  /**
   * Wait if we're close to rate limit
   */
  private async waitForRateLimit(): Promise<void> {
    // If we have plenty of requests remaining, proceed
    if (this.rateLimitInfo.remaining > 5) {
      return;
    }

    // If we're low on requests, wait a bit
    const waitTime = Math.ceil(RATE_LIMIT_WINDOW_MS / this.rateLimitInfo.limit);
    console.log(`Discogs rate limit low (${this.rateLimitInfo.remaining} remaining). Waiting ${waitTime}ms.`);
    await this.sleep(waitTime);
  }

  /**
   * Get current rate limit info
   */
  getRateLimitInfo(): RateLimitInfo {
    return { ...this.rateLimitInfo };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
