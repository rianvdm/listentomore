// ABOUTME: Last.fm user info functionality.
// ABOUTME: Fetches user profile information including avatar image.

import { fetchWithTimeout } from '@listentomore/shared';
import { getTtlSeconds, CACHE_CONFIG } from '@listentomore/config';

const LASTFM_API_BASE = 'https://ws.audioscrobbler.com/2.0';

export interface UserInfoData {
  name: string;
  realname: string;
  url: string;
  image: string | null;
  playcount: number;
  artistCount: number;
  albumCount: number;
  trackCount: number;
  registered: string;
}

interface LastfmUserInfoResponse {
  user: {
    name: string;
    realname: string;
    url: string;
    image: Array<{ '#text': string; size: string }>;
    playcount: string;
    artist_count?: string;
    album_count?: string;
    track_count?: string;
    registered: { unixtime: string };
  };
}

export interface LastfmConfig {
  apiKey: string;
  username: string;
}

export class UserInfo {
  constructor(
    private config: LastfmConfig,
    private cache?: KVNamespace
  ) {}

  async getUserInfo(): Promise<UserInfoData> {
    const cacheKey = `lastfm:userInfo:${this.config.username.toLowerCase()}`;

    // Check cache first
    if (this.cache) {
      const cached = await this.cache.get(cacheKey, 'json');
      if (cached) {
        return cached as UserInfoData;
      }
    }

    const url = `${LASTFM_API_BASE}/?method=user.getinfo&user=${encodeURIComponent(this.config.username)}&api_key=${encodeURIComponent(this.config.apiKey)}&format=json`;

    const response = await fetchWithTimeout(url, { timeout: 'fast' });

    if (!response.ok) {
      throw new Error(`Last.fm API responded with status ${response.status}`);
    }

    const data = (await response.json()) as LastfmUserInfoResponse;
    const user = data.user;

    const userInfo: UserInfoData = {
      name: user.name,
      realname: user.realname || '',
      url: user.url,
      image: user.image?.find((img) => img.size === 'extralarge')?.['#text'] || null,
      playcount: parseInt(user.playcount) || 0,
      artistCount: parseInt(user.artist_count || '0') || 0,
      albumCount: parseInt(user.album_count || '0') || 0,
      trackCount: parseInt(user.track_count || '0') || 0,
      registered: new Date(parseInt(user.registered.unixtime) * 1000).toISOString(),
    };

    // Cache for 30 days (user info doesn't change often)
    if (this.cache) {
      await this.cache.put(cacheKey, JSON.stringify(userInfo), {
        expirationTtl: getTtlSeconds(CACHE_CONFIG.lastfm.userInfo),
      });
    }

    return userInfo;
  }
}
