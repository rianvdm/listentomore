// Spotify album operations

import { CACHE_CONFIG } from '@listentomore/config';
import type { SpotifyAuth } from './auth';

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
  label: string | null;
  popularity: number;
  copyrights: string[];
  trackList: AlbumTrack[];
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
  images: Array<{ url: string }>;
  label: string;
  popularity: number;
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
    private cache: KVNamespace
  ) {}

  async getAlbum(albumId: string): Promise<AlbumDetails> {
    const cacheKey = `spotify:album:${albumId}`;

    // Check cache
    const cached = await this.cache.get<AlbumDetails>(cacheKey, 'json');
    if (cached) {
      return cached;
    }

    const accessToken = await this.auth.getAccessToken();

    const response = await fetch(`${SPOTIFY_API_BASE}/albums/${encodeURIComponent(albumId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Album not found: ${albumId}`);
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
      label: data.label || null,
      popularity: data.popularity,
      copyrights: data.copyrights.map((c) => c.text),
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
