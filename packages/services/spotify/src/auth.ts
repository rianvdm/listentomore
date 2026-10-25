// ABOUTME: Spotify OAuth token management with automatic refresh.
// ABOUTME: Caches access tokens and refreshes them before expiry.

import { CACHE_CONFIG } from '@listentomore/config';
import { fetchWithTimeout } from '@listentomore/shared';
import { createDefer } from './defer';
import type { Defer } from './defer';

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

export interface SpotifyTokenData {
  access_token: string;
  expires_at: number;
}

export interface SpotifyAuthConfig {
  clientId: string;
  clientSecret: string;
}

export class SpotifyAuth {
  private tokenCacheKey: string;

  constructor(
    private config: SpotifyAuthConfig,
    private cache: KVNamespace,
    private defer: Defer = createDefer()
  ) {
    // Use client ID in cache key so each app has its own token
    this.tokenCacheKey = `spotify:token:${config.clientId}`;
  }

  async getAccessToken(): Promise<string> {
    // Use the cached token if still valid, otherwise fetch a new one
    return (await this.readCachedToken()) ?? this.fetchAccessToken();
  }

  /**
   * Start the cached-token KV read now and return a function that resolves the token later.
   * Lets a caller overlap the token read with its own cache read. The prefetch never calls
   * Spotify: a refresh only happens if the returned function is called and the cache is empty.
   */
  prefetchAccessToken(): () => Promise<string> {
    const cached = this.readCachedToken();
    // Mark the rejection handled for callers that never need the token (cache hits);
    // awaiting `cached` below still surfaces the error to callers that do.
    cached.catch(() => {});
    return async () => (await cached) ?? this.fetchAccessToken();
  }

  private async readCachedToken(): Promise<string | null> {
    const cached = await this.cache.get<SpotifyTokenData>(this.tokenCacheKey, 'json');
    return cached && Date.now() < cached.expires_at ? cached.access_token : null;
  }

  private async fetchAccessToken(): Promise<string> {
    const clientIdPrefix = this.config.clientId.substring(0, 8);
    console.log(`[Spotify] Fetching client-credentials token for app ${clientIdPrefix}...`);

    const credentials = btoa(`${this.config.clientId}:${this.config.clientSecret}`);

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
    });

    const response = await fetchWithTimeout(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
      },
      body: body.toString(),
      timeout: 'fast',
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to refresh Spotify token: ${response.status} ${error}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    // Calculate expiration time (subtract buffer to refresh early)
    const expiresAt = Date.now() + data.expires_in * 1000 - 60000;

    // Store in cache without blocking the caller on the KV write
    const tokenData: SpotifyTokenData = {
      access_token: data.access_token,
      expires_at: expiresAt,
    };

    this.defer(
      this.cache.put(this.tokenCacheKey, JSON.stringify(tokenData), {
        expirationTtl: CACHE_CONFIG.spotify.token.ttlMinutes * 60,
      }),
      'token cache write'
    );

    return data.access_token;
  }
}
