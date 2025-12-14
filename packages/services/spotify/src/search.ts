// ABOUTME: Spotify search functionality for tracks, albums, and artists.
// ABOUTME: Includes caching, prefers full albums over singles/EPs, and distributed rate limiting.

import { CACHE_CONFIG } from '@listentomore/config';
import type { SpotifyAuth } from './auth';
import type { SpotifyRateLimiter } from './rate-limit';
import { spotifyFetch } from './fetch';

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

export type SearchType = 'track' | 'album' | 'artist';

export interface TrackSearchResult {
  title: string;
  artist: string;
  artistIds: string[];
  album: string;
  albumId: string;
  url: string;
  image: string | null;
  preview: string | null;
}

export interface AlbumSearchResult {
  name: string;
  id: string;
  artist: string;
  artistIds: string[];
  releaseDate: string;
  tracks: number;
  url: string;
  image: string | null;
}

export interface ArtistSearchResult {
  name: string;
  id: string;
  url: string;
  image: string | null;
}

export type SearchResult = TrackSearchResult | AlbumSearchResult | ArtistSearchResult;

interface SpotifySearchResponse {
  tracks?: {
    items: SpotifyTrack[];
  };
  albums?: {
    items: SpotifyAlbum[];
  };
  artists?: {
    items: SpotifyArtist[];
  };
}

interface SpotifyTrack {
  name: string;
  artists: SpotifyArtistRef[];
  album: {
    name: string;
    id: string;
    images: SpotifyImage[];
  };
  external_urls: { spotify: string };
  preview_url: string | null;
}

interface SpotifyAlbum {
  name: string;
  id: string;
  artists: SpotifyArtistRef[];
  release_date: string;
  total_tracks: number;
  album_type: string;
  external_urls: { spotify: string };
  images: SpotifyImage[];
}

interface SpotifyArtist {
  name: string;
  id: string;
  external_urls: { spotify: string };
  images: SpotifyImage[];
}

interface SpotifyArtistRef {
  name: string;
  id: string;
}

interface SpotifyImage {
  url: string;
  height: number;
  width: number;
}

export class SpotifySearch {
  constructor(
    private auth: SpotifyAuth,
    private cache: KVNamespace,
    private rateLimiter: SpotifyRateLimiter
  ) {}

  async search<T extends SearchType>(
    query: string,
    type: T,
    limit: number = 1
  ): Promise<T extends 'track' ? TrackSearchResult[] : T extends 'album' ? AlbumSearchResult[] : ArtistSearchResult[]> {
    const cacheKey = `spotify:search:${type}:${query}`;

    // Check cache
    const cached = await this.cache.get(cacheKey, 'json');
    if (cached) {
      return cached as T extends 'track' ? TrackSearchResult[] : T extends 'album' ? AlbumSearchResult[] : ArtistSearchResult[];
    }

    console.log(`[Spotify] Cache miss, searching API: ${type} "${query}"`);
    const accessToken = await this.auth.getAccessToken();

    const url = `${SPOTIFY_API_BASE}/search?q=${encodeURIComponent(query)}&type=${type}&limit=${limit}`;
    const response = await spotifyFetch(
      url,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 'fast',
      },
      this.rateLimiter
    );

    if (!response.ok) {
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After') || 'unknown';
        console.error(`[Spotify] 429 Rate Limited for search "${query}", Retry-After: ${retryAfter}s`);
      }
      throw new Error(`Spotify search failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as SpotifySearchResponse;
    let results: SearchResult[];

    if (type === 'track' && data.tracks) {
      results = data.tracks.items.map((item) => ({
        title: item.name,
        artist: item.artists.map((a) => a.name).join(', '),
        artistIds: item.artists.map((a) => a.id),
        album: item.album.name,
        albumId: item.album.id,
        url: item.external_urls.spotify,
        image: item.album.images[0]?.url || null,
        preview: item.preview_url,
      }));
    } else if (type === 'album' && data.albums) {
      // Prefer full albums over singles/EPs
      const items = data.albums.items;
      const fullAlbums = items.filter((item) => item.album_type === 'album');
      const albumsToProcess = fullAlbums.length > 0 ? fullAlbums : items;

      results = albumsToProcess.map((item) => ({
        name: item.name,
        id: item.id,
        artist: item.artists.map((a) => a.name).join(', '),
        artistIds: item.artists.map((a) => a.id),
        releaseDate: item.release_date,
        tracks: item.total_tracks,
        url: item.external_urls.spotify,
        image: item.images[0]?.url || null,
      }));
    } else if (type === 'artist' && data.artists) {
      results = data.artists.items.map((item) => ({
        name: item.name,
        id: item.id,
        url: item.external_urls.spotify,
        image: item.images[0]?.url || null,
      }));
    } else {
      results = [];
    }

    // Cache results
    await this.cache.put(cacheKey, JSON.stringify(results), {
      expirationTtl: CACHE_CONFIG.spotify.search.ttlDays * 24 * 60 * 60,
    });

    return results as T extends 'track' ? TrackSearchResult[] : T extends 'album' ? AlbumSearchResult[] : ArtistSearchResult[];
  }

  async searchTrack(query: string): Promise<TrackSearchResult | null> {
    const results = await this.search(query, 'track', 1);
    return results[0] || null;
  }

  async searchAlbum(query: string): Promise<AlbumSearchResult | null> {
    const results = await this.search(query, 'album', 1);
    return results[0] || null;
  }

  /**
   * Search for an album using Spotify field filters for more precise matching.
   * Use this when you have structured artist/album data (e.g., from Last.fm).
   * Fetches 3 results and picks the best match by album name similarity.
   */
  async searchAlbumByArtist(artist: string, album: string): Promise<AlbumSearchResult | null> {
    // Use Spotify's field filters for precise matching
    const query = `artist:"${artist}" album:"${album}"`;
    console.log(`[Spotify] Searching with field filters: ${query}`);
    const results = await this.search(query, 'album', 3);
    
    // If field filter search fails, fall back to natural query
    if (!results.length) {
      const fallbackQuery = `${artist} ${album}`;
      console.log(`[Spotify] Field filter failed, falling back to: ${fallbackQuery}`);
      const fallbackResults = await this.search(fallbackQuery, 'album', 3);
      return this.pickBestAlbumMatch(fallbackResults, album);
    }
    
    return this.pickBestAlbumMatch(results, album);
  }

  /**
   * Pick the best album match from results by comparing album names.
   * Prefers exact match, then closest match by length similarity.
   */
  private pickBestAlbumMatch(results: AlbumSearchResult[], targetAlbum: string): AlbumSearchResult | null {
    if (!results.length) return null;
    if (results.length === 1) return results[0];

    const targetLower = targetAlbum.toLowerCase();
    
    // Exact match wins
    const exactMatch = results.find(r => r.name.toLowerCase() === targetLower);
    if (exactMatch) return exactMatch;

    // Prefer album name that starts with target (handles "Voices" vs "Voices 2")
    const startsWithMatch = results.find(r => r.name.toLowerCase().startsWith(targetLower));
    if (startsWithMatch) return startsWithMatch;

    // Prefer shorter names when target is contained (avoids "Deluxe Edition" variants)
    const containsMatches = results.filter(r => r.name.toLowerCase().includes(targetLower));
    if (containsMatches.length) {
      containsMatches.sort((a, b) => a.name.length - b.name.length);
      return containsMatches[0];
    }

    // Fall back to first result
    return results[0];
  }

  async searchArtist(query: string): Promise<ArtistSearchResult | null> {
    const results = await this.search(query, 'artist', 1);
    return results[0] || null;
  }
}
