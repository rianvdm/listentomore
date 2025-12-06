// ABOUTME: Spotify OAuth token management with automatic refresh.
// ABOUTME: Caches access tokens and refreshes them before expiry.

import { CACHE_CONFIG } from '@listentomore/config';
import { fetchWithTimeout } from '@listentomore/shared';

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

export interface SpotifyTokenData {
  access_token: string;
  expires_at: number;
}

export interface SpotifyAuthConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export class SpotifyAuth {
  private tokenCacheKey: string;

  constructor(
    private config: SpotifyAuthConfig,
    private cache: KVNamespace
  ) {
    // Use client ID in cache key so each app has its own token
    this.tokenCacheKey = `spotify:token:${config.clientId}`;
  }

  async getAccessToken(): Promise<string> {
    // Check cache first
    const cached = await this.cache.get<SpotifyTokenData>(this.tokenCacheKey, 'json');

    if (cached && Date.now() < cached.expires_at) {
      return cached.access_token;
    }

    // Token expired or not in cache - refresh it
    return this.refreshAccessToken();
  }

  private async refreshAccessToken(): Promise<string> {
    const clientIdPrefix = this.config.clientId.substring(0, 8);
    console.log(`[Spotify] Refreshing token for app ${clientIdPrefix}...`);

    const credentials = btoa(`${this.config.clientId}:${this.config.clientSecret}`);

    // URL-encode the refresh token to handle special characters
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.config.refreshToken,
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

    // Store in cache
    const tokenData: SpotifyTokenData = {
      access_token: data.access_token,
      expires_at: expiresAt,
    };

    await this.cache.put(this.tokenCacheKey, JSON.stringify(tokenData), {
      expirationTtl: CACHE_CONFIG.spotify.token.ttlMinutes * 60,
    });

    return data.access_token;
  }
}
