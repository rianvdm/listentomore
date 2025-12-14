// ABOUTME: Spotify artist operations - details, albums, and related artists.
// ABOUTME: Includes caching with configurable TTLs and distributed rate limiting.

import { CACHE_CONFIG } from '@listentomore/config';
import type { SpotifyAuth } from './auth';
import type { SpotifyRateLimiter } from './rate-limit';
import { spotifyFetch } from './fetch';

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

export interface ArtistDetails {
  id: string;
  name: string;
  genres: string[];
  followers: number;
  popularity: number;
  url: string;
  image: string | null;
}

interface SpotifyArtistResponse {
  id: string;
  name: string;
  genres: string[];
  followers: { total: number };
  popularity: number;
  external_urls: { spotify: string };
  images: Array<{ url: string }>;
}

export class SpotifyArtists {
  constructor(
    private auth: SpotifyAuth,
    private cache: KVNamespace,
    private rateLimiter: SpotifyRateLimiter
  ) {}

  async getArtist(artistId: string): Promise<ArtistDetails> {
    const cacheKey = `spotify:artist:${artistId}`;

    // Check cache
    const cached = await this.cache.get<ArtistDetails>(cacheKey, 'json');
    if (cached) {
      console.log(`[Spotify] Cache hit for artist ${artistId}`);
      return cached;
    }

    console.log(`[Spotify] Cache miss, fetching artist ${artistId} from API`);
    const accessToken = await this.auth.getAccessToken();

    const response = await spotifyFetch(
      `${SPOTIFY_API_BASE}/artists/${encodeURIComponent(artistId)}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 'fast',
      },
      this.rateLimiter
    );

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Artist not found: ${artistId}`);
      }
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After') || 'unknown';
        console.error(`[Spotify] 429 Rate Limited for artist ${artistId}, Retry-After: ${retryAfter}s`);
        throw new Error(`Failed to fetch artist: ${response.status} ${response.statusText}`);
      }
      throw new Error(`Failed to fetch artist: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as SpotifyArtistResponse;

    // Capitalize first letter of each word in genres
    const capitalizedGenres = data.genres.map((genre) =>
      genre
        .split(' ')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
    );

    const artist: ArtistDetails = {
      id: data.id,
      name: data.name,
      genres: capitalizedGenres,
      followers: data.followers.total,
      popularity: data.popularity,
      url: data.external_urls.spotify,
      image: data.images[0]?.url || null,
    };

    // Cache the result
    await this.cache.put(cacheKey, JSON.stringify(artist), {
      expirationTtl: CACHE_CONFIG.spotify.artist.ttlDays * 24 * 60 * 60,
    });

    return artist;
  }

  async getArtists(artistIds: string[]): Promise<ArtistDetails[]> {
    // Fetch artists in parallel, using cache where available
    const results = await Promise.all(artistIds.map((id) => this.getArtist(id)));
    return results;
  }

  async getArtistAlbums(
    artistId: string,
    limit: number = 10
  ): Promise<
    Array<{
      id: string;
      name: string;
      release_date: string;
      images: Array<{ url: string }>;
      album_type: string;
    }>
  > {
    const cacheKey = `spotify:artist:${artistId}:albums:${limit}`;

    // Check cache
    const cached = await this.cache.get(cacheKey, 'json');
    if (cached) {
      return cached as Array<{
        id: string;
        name: string;
        release_date: string;
        images: Array<{ url: string }>;
        album_type: string;
      }>;
    }

    const accessToken = await this.auth.getAccessToken();

    const params = new URLSearchParams({
      include_groups: 'album',
      limit: limit.toString(),
      market: 'US',
    });

    const response = await spotifyFetch(
      `${SPOTIFY_API_BASE}/artists/${encodeURIComponent(artistId)}/albums?${params}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 'fast',
      },
      this.rateLimiter
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch artist albums: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      items: Array<{
        id: string;
        name: string;
        release_date: string;
        images: Array<{ url: string }>;
        album_type: string;
      }>;
    };

    const albums = data.items;

    // Cache the result
    await this.cache.put(cacheKey, JSON.stringify(albums), {
      expirationTtl: CACHE_CONFIG.spotify.artist.ttlDays * 24 * 60 * 60,
    });

    return albums;
  }

  async getRelatedArtists(
    artistId: string,
    limit: number = 5
  ): Promise<Array<{ id: string; name: string; image: string | null }>> {
    const cacheKey = `spotify:artist:${artistId}:related`;

    // Check cache
    const cached = await this.cache.get(cacheKey, 'json');
    if (cached) {
      return (cached as Array<{ id: string; name: string; image: string | null }>).slice(0, limit);
    }

    const accessToken = await this.auth.getAccessToken();

    const response = await spotifyFetch(
      `${SPOTIFY_API_BASE}/artists/${artistId}/related-artists`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 'fast',
      },
      this.rateLimiter
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch related artists: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      artists: Array<{
        id: string;
        name: string;
        images: Array<{ url: string }>;
      }>;
    };

    const relatedArtists = data.artists.map((artist) => ({
      id: artist.id,
      name: artist.name,
      image: artist.images[0]?.url || null,
    }));

    // Cache the full result (up to 20 artists)
    await this.cache.put(cacheKey, JSON.stringify(relatedArtists), {
      expirationTtl: CACHE_CONFIG.spotify.artist.ttlDays * 24 * 60 * 60,
    });

    return relatedArtists.slice(0, limit);
  }
}
