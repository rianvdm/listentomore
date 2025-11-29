// Spotify artist operations

import { CACHE_CONFIG } from '@listentomore/config';
import type { SpotifyAuth } from './auth';

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
    private cache: KVNamespace
  ) {}

  async getArtist(artistId: string): Promise<ArtistDetails> {
    const cacheKey = `spotify:artist:${artistId}`;

    // Check cache
    const cached = await this.cache.get<ArtistDetails>(cacheKey, 'json');
    if (cached) {
      return cached;
    }

    const accessToken = await this.auth.getAccessToken();

    const response = await fetch(`${SPOTIFY_API_BASE}/artists/${encodeURIComponent(artistId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Artist not found: ${artistId}`);
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
}
