// Spotify OAuth token management

import { CACHE_CONFIG } from '@listentomore/config';

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const TOKEN_CACHE_KEY = 'spotify:token';

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
  constructor(
    private config: SpotifyAuthConfig,
    private cache: KVNamespace
  ) {}

  async getAccessToken(): Promise<string> {
    // Check cache first
    const cached = await this.cache.get<SpotifyTokenData>(TOKEN_CACHE_KEY, 'json');

    if (cached && Date.now() < cached.expires_at) {
      return cached.access_token;
    }

    // Token expired or not in cache - refresh it
    return this.refreshAccessToken();
  }

  private async refreshAccessToken(): Promise<string> {
    const credentials = btoa(`${this.config.clientId}:${this.config.clientSecret}`);

    const response = await fetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
      },
      body: `grant_type=refresh_token&refresh_token=${this.config.refreshToken}`,
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

    await this.cache.put(TOKEN_CACHE_KEY, JSON.stringify(tokenData), {
      expirationTtl: CACHE_CONFIG.spotify.token.ttlMinutes * 60,
    });

    return data.access_token;
  }
}
