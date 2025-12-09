// Discogs API client with rate limiting and error handling

import type { DiscogsConfig, RateLimitInfo } from './types';

const DISCOGS_API_BASE = 'https://api.discogs.com';
const DEFAULT_USER_AGENT = 'ListenToMore/1.0 +https://listentomore.com';

// Discogs rate limits: 60 req/min authenticated, 25 req/min unauthenticated
const RATE_LIMIT_AUTHENTICATED = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

export class DiscogsClient {
  private accessToken: string;
  private accessTokenSecret?: string;
  private consumerKey?: string;
  private consumerSecret?: string;
  private userAgent: string;
  private useOAuth: boolean;
  private rateLimitInfo: RateLimitInfo = {
    remaining: RATE_LIMIT_AUTHENTICATED,
    limit: RATE_LIMIT_AUTHENTICATED,
    resetAt: null,
  };

  constructor(config: DiscogsConfig) {
    this.accessToken = config.accessToken;
    this.accessTokenSecret = config.accessTokenSecret;
    this.consumerKey = config.consumerKey;
    this.consumerSecret = config.consumerSecret;
    this.userAgent = config.userAgent || DEFAULT_USER_AGENT;
    // Use OAuth 1.0a if we have all the credentials
    this.useOAuth = !!(config.accessTokenSecret && config.consumerKey && config.consumerSecret);
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

    // Build authorization header
    let authHeader: string;
    if (this.useOAuth && this.consumerKey && this.consumerSecret && this.accessTokenSecret) {
      // OAuth 1.0a - sign the request
      authHeader = await this.buildOAuthHeader(method, url.toString());
    } else {
      // Personal access token
      authHeader = `Discogs token=${this.accessToken}`;
    }

    const headers: Record<string, string> = {
      Authorization: authHeader,
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

  /**
   * Build OAuth 1.0a Authorization header
   */
  private async buildOAuthHeader(method: string, urlString: string): Promise<string> {
    const url = new URL(urlString);
    
    const oauthParams: Record<string, string> = {
      oauth_consumer_key: this.consumerKey!,
      oauth_nonce: this.generateNonce(),
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_token: this.accessToken,
      oauth_version: '1.0',
    };

    // Collect all parameters (OAuth + query string)
    const allParams: Record<string, string> = { ...oauthParams };
    url.searchParams.forEach((value, key) => {
      allParams[key] = value;
    });

    // Generate signature
    const signature = await this.generateSignature(
      method,
      `${url.origin}${url.pathname}`,
      allParams
    );

    // Build header
    const headerParams = Object.keys(oauthParams)
      .sort()
      .map((key) => `${this.percentEncode(key)}="${this.percentEncode(oauthParams[key])}"`)
      .join(', ');

    return `OAuth ${headerParams}, oauth_signature="${this.percentEncode(signature)}"`;
  }

  /**
   * Generate OAuth signature using HMAC-SHA1
   */
  private async generateSignature(
    method: string,
    baseUrl: string,
    params: Record<string, string>
  ): Promise<string> {
    // Sort parameters alphabetically
    const sortedParams = Object.keys(params)
      .sort()
      .map((key) => `${this.percentEncode(key)}=${this.percentEncode(params[key])}`)
      .join('&');

    // Create signature base string
    const signatureBase = [
      method.toUpperCase(),
      this.percentEncode(baseUrl),
      this.percentEncode(sortedParams),
    ].join('&');

    // Create signing key
    const signingKey = `${this.percentEncode(this.consumerSecret!)}&${this.percentEncode(this.accessTokenSecret!)}`;

    // Generate HMAC-SHA1 signature using Web Crypto API
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(signingKey),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    );

    const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(signatureBase));

    // Convert to base64
    return btoa(String.fromCharCode(...new Uint8Array(signatureBytes)));
  }

  /**
   * Generate a random nonce
   */
  private generateNonce(): string {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Percent-encode a string per RFC 3986
   */
  private percentEncode(str: string): string {
    return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  }
}
