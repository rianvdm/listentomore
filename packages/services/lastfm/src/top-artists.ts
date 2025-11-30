// Last.fm top artists functionality

import { CACHE_CONFIG } from '@listentomore/config';

const LASTFM_API_BASE = 'https://ws.audioscrobbler.com/2.0';
const BACKUP_IMAGE_URL = 'https://file.elezea.com/noun-no-image.png';

export type TimePeriod = '7day' | '1month' | '3month' | '6month' | '12month' | 'overall';

export interface TopArtist {
  name: string;
  playcount: number;
  url: string;
  image: string;
  tags: string[];
  bio: string;
}

interface LastfmTopArtistsResponse {
  topartists: {
    artist: Array<{
      name: string;
      playcount: string;
      url: string;
    }>;
  };
}

interface LastfmArtistInfoResponse {
  artist: {
    name: string;
    url: string;
    image: Array<{ '#text': string; size: string }>;
    tags?: {
      tag: Array<{ name: string }>;
    };
    bio?: {
      summary: string;
    };
  };
  error?: number;
  message?: string;
}

export interface LastfmConfig {
  apiKey: string;
  username: string;
}

export class TopArtists {
  constructor(
    private config: LastfmConfig,
    private cache?: KVNamespace
  ) {}

  async getTopArtists(
    period: TimePeriod = '7day',
    limit: number = 6,
    includeDetails: boolean = true
  ): Promise<TopArtist[]> {
    // Check cache first
    const cacheKey = `lastfm:topartists:${this.config.username}:${period}:${limit}`;
    if (this.cache) {
      const cached = await this.cache.get(cacheKey, 'json');
      if (cached) {
        return cached as TopArtist[];
      }
    }

    const url = `${LASTFM_API_BASE}/?method=user.gettopartists&user=${encodeURIComponent(this.config.username)}&api_key=${encodeURIComponent(this.config.apiKey)}&period=${period}&limit=${limit}&format=json`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Last.fm API responded with status ${response.status}`);
    }

    const data = (await response.json()) as LastfmTopArtistsResponse;
    const artists = data.topartists?.artist || [];

    let results: TopArtist[];

    if (!includeDetails) {
      results = artists.map((artist) => ({
        name: artist.name,
        playcount: parseInt(artist.playcount, 10),
        url: artist.url,
        image: BACKUP_IMAGE_URL,
        tags: [],
        bio: '',
      }));
    } else {
      // Fetch details for each artist in parallel
      results = await Promise.all(
        artists.map(async (artist) => {
          try {
            return await this.getArtistWithDetails(artist.name, parseInt(artist.playcount, 10), artist.url);
          } catch (error) {
            // Return minimal data if detail fetch fails
            return {
              name: artist.name,
              playcount: parseInt(artist.playcount, 10),
              url: artist.url,
              image: BACKUP_IMAGE_URL,
              tags: [],
              bio: '',
            };
          }
        })
      );
    }

    // Cache results
    if (this.cache) {
      await this.cache.put(cacheKey, JSON.stringify(results), {
        expirationTtl: CACHE_CONFIG.lastfm.topArtists.ttlHours * 60 * 60,
      });
    }

    return results;
  }

  private async getArtistWithDetails(
    name: string,
    playcount: number,
    fallbackUrl: string
  ): Promise<TopArtist> {
    const url = `${LASTFM_API_BASE}/?method=artist.getinfo&artist=${encodeURIComponent(name)}&user=${encodeURIComponent(this.config.username)}&api_key=${encodeURIComponent(this.config.apiKey)}&format=json`;

    const response = await fetch(url);
    const data = (await response.json()) as LastfmArtistInfoResponse;

    if (data.error) {
      throw new Error(data.message || 'Failed to fetch artist details');
    }

    const artist = data.artist;
    const image = artist.image?.find((img) => img.size === 'extralarge')?.['#text'] || BACKUP_IMAGE_URL;

    // Filter tags: remove "seen live" and any tag with numbers
    const filteredTags = Array.isArray(artist.tags?.tag)
      ? artist.tags.tag
          .filter((tag) => tag.name.toLowerCase() !== 'seen live' && !/\d/.test(tag.name))
          .slice(0, 3)
          .map((tag) => tag.name.charAt(0).toUpperCase() + tag.name.slice(1))
      : [];

    return {
      name: artist.name || name,
      playcount,
      url: artist.url || fallbackUrl,
      image,
      tags: filteredTags,
      bio: artist.bio?.summary || '',
    };
  }
}
