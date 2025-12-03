// ABOUTME: Last.fm loved tracks functionality.
// ABOUTME: Fetches user's favorited/loved tracks.

import { fetchWithTimeout } from '@listentomore/shared';

const LASTFM_API_BASE = 'https://ws.audioscrobbler.com/2.0';

export interface LovedTrack {
  title: string;
  artist: string;
  dateLiked: string;
  image: string | null;
  songUrl: string;
}

interface LastfmLovedTracksResponse {
  lovedtracks: {
    track: Array<{
      name: string;
      artist: { name: string };
      date?: { uts: string };
      image: Array<{ '#text': string; size: string }>;
      url: string;
    }>;
  };
}

export interface LastfmConfig {
  apiKey: string;
  username: string;
}

export class LovedTracks {
  constructor(private config: LastfmConfig) {}

  async getLovedTracks(limit: number = 10): Promise<LovedTrack[]> {
    const url = `${LASTFM_API_BASE}/?method=user.getlovedtracks&user=${encodeURIComponent(this.config.username)}&api_key=${encodeURIComponent(this.config.apiKey)}&format=json&limit=${limit}`;

    const response = await fetchWithTimeout(url, { timeout: 'fast' });

    if (!response.ok) {
      throw new Error(`Last.fm API responded with status ${response.status}`);
    }

    const data = (await response.json()) as LastfmLovedTracksResponse;
    const tracks = data.lovedtracks?.track || [];

    return tracks.map((track) => ({
      title: track.name,
      artist: track.artist?.name || '',
      dateLiked: track.date?.uts
        ? new Date(parseInt(track.date.uts) * 1000).toLocaleDateString()
        : '',
      image: track.image?.find((img) => img.size === 'extralarge')?.['#text'] || null,
      songUrl: track.url,
    }));
  }
}
