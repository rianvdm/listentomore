// ABOUTME: Spotify search functionality for tracks, albums, and artists.
// ABOUTME: Includes caching and prefers full albums over singles/EPs.

import { CACHE_CONFIG } from '@listentomore/config';
import { fetchWithTimeout } from '@listentomore/shared';
import type { SpotifyAuth } from './auth';

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
    private cache: KVNamespace
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

    const accessToken = await this.auth.getAccessToken();

    const url = `${SPOTIFY_API_BASE}/search?q=${encodeURIComponent(query)}&type=${type}&limit=${limit}`;
    const response = await fetchWithTimeout(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 'fast',
    });

    if (!response.ok) {
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
   */
  async searchAlbumByArtist(artist: string, album: string): Promise<AlbumSearchResult | null> {
    // Use Spotify's field filters for precise matching
    const query = `artist:"${artist}" album:"${album}"`;
    const results = await this.search(query, 'album', 1);
    
    // If field filter search fails, fall back to natural query
    if (!results.length) {
      const fallbackQuery = `${artist} ${album}`;
      const fallbackResults = await this.search(fallbackQuery, 'album', 1);
      return fallbackResults[0] || null;
    }
    
    return results[0] || null;
  }

  async searchArtist(query: string): Promise<ArtistSearchResult | null> {
    const results = await this.search(query, 'artist', 1);
    return results[0] || null;
  }
}
