// ABOUTME: Last.fm recent tracks functionality.
// ABOUTME: Fetches user's recently played tracks including now playing.

import { fetchWithTimeout } from '@listentomore/shared';

const LASTFM_API_BASE = 'https://ws.audioscrobbler.com/2.0';

export interface RecentTrack {
  artist: string;
  album: string;
  name: string;
  url: string;
  image: string | null;
  nowPlaying: boolean;
  playedAt: string | null;
}

interface LastfmRecentTracksResponse {
  recenttracks: {
    track: Array<{
      artist: { '#text': string };
      album: { '#text': string };
      name: string;
      url: string;
      image: Array<{ '#text': string; size: string }>;
      '@attr'?: { nowplaying: string };
      date?: { uts: string };
    }>;
  };
}

export interface LastfmConfig {
  apiKey: string;
  username: string;
}

export class RecentTracks {
  constructor(private config: LastfmConfig) {}

  async getRecentTracks(limit: number = 10): Promise<RecentTrack[]> {
    const url = `${LASTFM_API_BASE}/?method=user.getrecenttracks&user=${encodeURIComponent(this.config.username)}&api_key=${encodeURIComponent(this.config.apiKey)}&limit=${limit}&format=json`;

    const response = await fetchWithTimeout(url, { timeout: 'fast' });

    if (!response.ok) {
      throw new Error(`Last.fm API responded with status ${response.status}`);
    }

    const data = (await response.json()) as LastfmRecentTracksResponse;
    const tracks = data.recenttracks?.track || [];

    return tracks.map((track) => ({
      artist: track.artist['#text'] || '',
      album: track.album['#text'] || '',
      name: track.name,
      url: track.url,
      image: track.image?.find((img) => img.size === 'extralarge')?.['#text'] || null,
      nowPlaying: track['@attr']?.nowplaying === 'true',
      playedAt: track.date?.uts ? new Date(parseInt(track.date.uts) * 1000).toISOString() : null,
    }));
  }

  async getMostRecentTrack(): Promise<RecentTrack | null> {
    const tracks = await this.getRecentTracks(1);
    return tracks[0] || null;
  }

  async getCurrentlyPlaying(): Promise<RecentTrack | null> {
    const tracks = await this.getRecentTracks(1);
    const track = tracks[0];
    return track?.nowPlaying ? track : null;
  }
}
