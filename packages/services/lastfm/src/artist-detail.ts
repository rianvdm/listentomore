// ABOUTME: Last.fm artist detail functionality.
// ABOUTME: Fetches artist info, tags, similar artists, and bio.

import { CACHE_CONFIG, getTtlSeconds } from '@listentomore/config';
import { fetchWithTimeout } from '@listentomore/shared';

const LASTFM_API_BASE = 'https://ws.audioscrobbler.com/2.0';

export interface ArtistDetail {
  name: string;
  url: string;
  image: string | null;
  tags: string[];
  similar: string[];
  bio: string;
}

export interface ArtistTopAlbum {
  name: string;
  playcount: number;
  url: string;
}

interface LastfmArtistInfoResponse {
  artist: {
    name: string;
    url: string;
    image: Array<{ '#text': string; size: string }>;
    stats?: {
      userplaycount: string;
    };
    tags?: {
      tag: Array<{ name: string }>;
    };
    similar?: {
      artist: Array<{ name: string }>;
    };
    bio?: {
      content: string;
    };
  };
  error?: number;
  message?: string;
}

interface LastfmTopAlbumsResponse {
  topalbums: {
    album: Array<{
      name: string;
      playcount: string;
      url: string;
    }>;
  };
  error?: number;
  message?: string;
}

export interface LastfmConfig {
  apiKey: string;
  username: string;
}

export class ArtistDetails {
  constructor(
    private config: LastfmConfig,
    private cache?: KVNamespace
  ) {}

  async getArtistDetail(artistName: string): Promise<ArtistDetail> {
    // Normalize artist name for cache key
    const cacheKey = `lastfm:artistDetail:${artistName.toLowerCase().trim()}`;

    // Check cache first
    if (this.cache) {
      const cached = await this.cache.get(cacheKey, 'json');
      if (cached) {
        return cached as ArtistDetail;
      }
    }

    const url = `${LASTFM_API_BASE}/?method=artist.getInfo&artist=${encodeURIComponent(artistName)}&api_key=${encodeURIComponent(this.config.apiKey)}&format=json&autocorrect=1`;

    const response = await fetchWithTimeout(url, { timeout: 'fast' });
    const data = (await response.json()) as LastfmArtistInfoResponse;

    if (data.error) {
      throw new Error(data.message || `Failed to fetch artist: ${artistName}`);
    }

    const artist = data.artist;

    // Filter tags: remove "seen live" and any tag with numbers
    const filteredTags = Array.isArray(artist.tags?.tag)
      ? artist.tags.tag
          .filter((tag) => tag.name.toLowerCase() !== 'seen live' && !/\d/.test(tag.name))
          .slice(0, 3)
          .map((tag) => tag.name.charAt(0).toUpperCase() + tag.name.slice(1))
      : [];

    const result: ArtistDetail = {
      name: artist.name,
      url: artist.url,
      image: artist.image?.find((img) => img.size === 'extralarge')?.['#text'] || null,
      tags: filteredTags,
      similar: artist.similar?.artist?.slice(0, 3).map((a) => a.name) || [],
      bio: artist.bio?.content || '',
    };

    // Cache result
    if (this.cache) {
      await this.cache.put(cacheKey, JSON.stringify(result), {
        expirationTtl: getTtlSeconds(CACHE_CONFIG.lastfm.artistDetail),
      });
    }

    return result;
  }

  async getTopAlbums(artistName: string, limit: number = 5): Promise<ArtistTopAlbum[]> {
    // Normalize artist name for cache key
    const cacheKey = `lastfm:artistTopAlbums:${artistName.toLowerCase().trim()}:${limit}`;

    // Check cache first
    if (this.cache) {
      const cached = await this.cache.get(cacheKey, 'json');
      if (cached) {
        return cached as ArtistTopAlbum[];
      }
    }

    const url = `${LASTFM_API_BASE}/?method=artist.getTopAlbums&artist=${encodeURIComponent(artistName)}&api_key=${encodeURIComponent(this.config.apiKey)}&format=json&autocorrect=1&limit=${limit}`;

    const response = await fetchWithTimeout(url, { timeout: 'fast' });
    const data = (await response.json()) as LastfmTopAlbumsResponse;

    if (data.error) {
      throw new Error(data.message || `Failed to fetch top albums for: ${artistName}`);
    }

    const albums = data.topalbums?.album || [];

    const results = albums.map((album) => ({
      name: album.name,
      playcount: parseInt(album.playcount || '0', 10),
      url: album.url,
    }));

    // Cache result (use same TTL as artist detail)
    if (this.cache) {
      await this.cache.put(cacheKey, JSON.stringify(results), {
        expirationTtl: getTtlSeconds(CACHE_CONFIG.lastfm.artistDetail),
      });
    }

    return results;
  }
}
