// ABOUTME: Spotify album operations - fetching album details and track lists.
// ABOUTME: Includes caching with configurable TTLs and distributed rate limiting.

import { CACHE_CONFIG } from '@listentomore/config';
import type { SpotifyAuth } from './auth';
import type { SpotifyRateLimiter } from './rate-limit';
import { spotifyFetch } from './fetch';

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

export interface AlbumDetails {
  id: string;
  name: string;
  artist: string;
  artistIds: string[];
  releaseDate: string;
  tracks: number;
  genres: string[];
  url: string;
  image: string | null;
  /** May be undefined after Spotify Feb 2026 API changes */
  label?: string | null;
  /** May be undefined after Spotify Feb 2026 API changes */
  popularity?: number;
  copyrights: string[];
  trackList: AlbumTrack[];
  /** Universal Product Code - used for Apple Music lookups */
  upc: string | null;
  /** European Article Number - alternative to UPC */
  ean: string | null;
}

export interface AlbumTrack {
  number: number;
  name: string;
  duration: number; // milliseconds
  preview: string | null;
  artists: string[];
}

interface SpotifyAlbumResponse {
  id: string;
  name: string;
  artists: Array<{ name: string; id: string }>;
  release_date: string;
  total_tracks: number;
  genres: string[];
  external_urls: { spotify: string };
  /** Removed in Spotify Feb 2026 API changes for Development Mode apps */
  external_ids?: { upc?: string; ean?: string };
  images: Array<{ url: string }>;
  /** May be removed in Spotify Feb 2026 API changes */
  label?: string;
  /** May be removed in Spotify Feb 2026 API changes */
  popularity?: number;
  copyrights: Array<{ text: string }>;
  tracks: {
    items: Array<{
      track_number: number;
      name: string;
      duration_ms: number;
      preview_url: string | null;
      artists: Array<{ name: string }>;
    }>;
  };
}

export class SpotifyAlbums {
  constructor(
    private auth: SpotifyAuth,
    private cache: KVNamespace,
    private rateLimiter: SpotifyRateLimiter
  ) {}

  async getAlbum(albumId: string): Promise<AlbumDetails> {
    // v2: Added upc/ean fields
    const cacheKey = `spotify:album:v2:${albumId}`;

    // Check cache
    const cached = await this.cache.get<AlbumDetails>(cacheKey, 'json');
    if (cached) {
      console.log(`[Spotify] Cache hit for album ${albumId}`);
      return cached;
    }

    console.log(`[Spotify] Cache miss, fetching album ${albumId} from API`);
    const accessToken = await this.auth.getAccessToken();

    const response = await spotifyFetch(
      `${SPOTIFY_API_BASE}/albums/${encodeURIComponent(albumId)}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 'fast',
      },
      this.rateLimiter
    );

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Album not found: ${albumId}`);
      }
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After') || 'unknown';
        console.error(`[Spotify] 429 Rate Limited for album ${albumId}, Retry-After: ${retryAfter}s`);
        throw new Error(`Failed to fetch album: ${response.status} ${response.statusText}`);
      }
      throw new Error(`Failed to fetch album: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as SpotifyAlbumResponse;

    const album: AlbumDetails = {
      id: data.id,
      name: data.name,
      artist: data.artists.map((a) => a.name).join(', '),
      artistIds: data.artists.map((a) => a.id),
      releaseDate: data.release_date,
      tracks: data.total_tracks,
      genres: data.genres || [],
      url: data.external_urls.spotify,
      image: data.images[0]?.url || null,
      label: data.label ?? null,
      popularity: data.popularity ?? undefined,
      copyrights: data.copyrights.map((c) => c.text),
      upc: data.external_ids?.upc || null,
      ean: data.external_ids?.ean || null,
      trackList: data.tracks.items.map((track) => ({
        number: track.track_number,
        name: track.name,
        duration: track.duration_ms,
        preview: track.preview_url,
        artists: track.artists.map((a) => a.name),
      })),
    };

    // Cache the result
    await this.cache.put(cacheKey, JSON.stringify(album), {
      expirationTtl: CACHE_CONFIG.spotify.album.ttlDays * 24 * 60 * 60,
    });

    return album;
  }

  async getAlbums(albumIds: string[]): Promise<AlbumDetails[]> {
    // Fetch albums in parallel, using cache where available
    const results = await Promise.all(albumIds.map((id) => this.getAlbum(id)));
    return results;
  }
}
