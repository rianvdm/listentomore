// YouTube Music provider using YouTube Data API v3

import type {
  StreamingProvider,
  TrackMetadata,
  AlbumMetadata,
  ProviderResult,
  YouTubeSearchResponse,
  YouTubeSearchItem,
} from '../types';
import { similarity, normalizeString } from '../matching';

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const MUSIC_CATEGORY_ID = '10'; // Music category

// Known official music channels and patterns
const OFFICIAL_CHANNEL_PATTERNS = [
  /vevo$/i,
  /- topic$/i,
  /official$/i,
  /records$/i,
  /music$/i,
];

const OFFICIAL_TITLE_PATTERNS = [
  /official\s*(music\s*)?video/i,
  /official\s*audio/i,
  /official\s*lyric/i,
  /\(audio\)/i,
  /\[audio\]/i,
];

export class YouTubeProvider implements StreamingProvider {
  name = 'youtube';

  constructor(private apiKey: string | undefined) {}

  async searchTrack(metadata: TrackMetadata): Promise<ProviderResult | null> {
    if (!this.apiKey) {
      console.log('[YouTube] No API key configured, using fallback');
      return this.getFallbackTrackUrl(metadata);
    }

    const artist = metadata.artists[0] || '';
    const track = metadata.name;
    const query = `${artist} ${track}`;

    try {
      const url = new URL(`${YOUTUBE_API_BASE}/search`);
      url.searchParams.set('part', 'snippet');
      url.searchParams.set('q', query);
      url.searchParams.set('type', 'video');
      url.searchParams.set('videoCategoryId', MUSIC_CATEGORY_ID);
      url.searchParams.set('maxResults', '10');
      url.searchParams.set('key', this.apiKey);

      console.log(`[YouTube] Searching for track: "${query}"`);

      const response = await fetch(url.toString());

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[YouTube] Search failed: ${response.status} - ${errorText}`);

        if (response.status === 403) {
          // Quota exceeded or API key invalid
          console.log('[YouTube] API quota may be exceeded, using fallback');
        }

        return this.getFallbackTrackUrl(metadata);
      }

      const data = (await response.json()) as YouTubeSearchResponse;

      if (!data.items || data.items.length === 0) {
        console.log(`[YouTube] No results for: "${query}"`);
        return this.getFallbackTrackUrl(metadata);
      }

      // Score and rank results
      const scoredResults = data.items
        .filter((item) => item.id.videoId) // Only videos
        .map((item) => ({
          item,
          score: this.scoreTrackResult(metadata, item),
        }))
        .sort((a, b) => b.score - a.score);

      const best = scoredResults[0];

      if (best && best.score > 0.5) {
        const videoId = best.item.id.videoId!;
        console.log(
          `[YouTube] Match found: "${best.item.snippet.title}" by ${best.item.snippet.channelTitle} (score: ${best.score.toFixed(2)})`
        );

        return {
          url: `https://music.youtube.com/watch?v=${videoId}`,
          confidence: best.score,
          matched: {
            title: best.item.snippet.title,
            channel: best.item.snippet.channelTitle,
          },
        };
      }

      console.log('[YouTube] No high-confidence match found');
      return this.getFallbackTrackUrl(metadata);
    } catch (error) {
      console.error('[YouTube] Search error:', error);
      return this.getFallbackTrackUrl(metadata);
    }
  }

  async searchAlbum(metadata: AlbumMetadata): Promise<ProviderResult | null> {
    if (!this.apiKey) {
      console.log('[YouTube] No API key configured, using fallback');
      return this.getFallbackAlbumUrl(metadata);
    }

    const artist = metadata.artists[0] || '';
    const album = metadata.name;
    const query = `${artist} ${album} full album`;

    try {
      const url = new URL(`${YOUTUBE_API_BASE}/search`);
      url.searchParams.set('part', 'snippet');
      url.searchParams.set('q', query);
      url.searchParams.set('type', 'playlist');
      url.searchParams.set('maxResults', '10');
      url.searchParams.set('key', this.apiKey);

      console.log(`[YouTube] Searching for album: "${query}"`);

      const response = await fetch(url.toString());

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[YouTube] Search failed: ${response.status} - ${errorText}`);
        return this.getFallbackAlbumUrl(metadata);
      }

      const data = (await response.json()) as YouTubeSearchResponse;

      if (!data.items || data.items.length === 0) {
        console.log(`[YouTube] No playlist results for: "${query}"`);
        return this.getFallbackAlbumUrl(metadata);
      }

      // Score and rank results
      const scoredResults = data.items
        .filter((item) => item.id.playlistId) // Only playlists
        .map((item) => ({
          item,
          score: this.scoreAlbumResult(metadata, item),
        }))
        .sort((a, b) => b.score - a.score);

      const best = scoredResults[0];

      if (best && best.score > 0.5) {
        const playlistId = best.item.id.playlistId!;
        console.log(
          `[YouTube] Match found: "${best.item.snippet.title}" by ${best.item.snippet.channelTitle} (score: ${best.score.toFixed(2)})`
        );

        return {
          url: `https://music.youtube.com/playlist?list=${playlistId}`,
          confidence: best.score,
          matched: {
            title: best.item.snippet.title,
            channel: best.item.snippet.channelTitle,
          },
        };
      }

      console.log('[YouTube] No high-confidence album match found, using search fallback');
      return this.getFallbackAlbumUrl(metadata);
    } catch (error) {
      console.error('[YouTube] Search error:', error);
      return this.getFallbackAlbumUrl(metadata);
    }
  }

  private scoreTrackResult(metadata: TrackMetadata, item: YouTubeSearchItem): number {
    let score = 0;
    const title = item.snippet.title;
    const channel = item.snippet.channelTitle;
    const normalizedTitle = normalizeString(title);
    const normalizedTrack = normalizeString(metadata.name);
    const normalizedArtist = normalizeString(metadata.artists[0] || '');

    // Check if title contains the track name (0.4 max)
    const trackSim = similarity(normalizedTrack, normalizedTitle);
    score += 0.4 * Math.min(1, trackSim * 1.5); // Boost partial matches

    // Check if title or channel contains artist (0.3 max)
    const normalizedChannel = normalizeString(channel);
    const artistInTitle = normalizedTitle.includes(normalizedArtist) ? 1 : 0;
    const artistInChannel = normalizedChannel.includes(normalizedArtist) ? 1 : 0;
    score += 0.3 * Math.max(artistInTitle, artistInChannel);

    // Bonus for official channels (0.15 max)
    const isOfficialChannel = OFFICIAL_CHANNEL_PATTERNS.some((pattern) => pattern.test(channel));
    if (isOfficialChannel) {
      score += 0.15;
    }

    // Bonus for official video/audio in title (0.15 max)
    const isOfficialTitle = OFFICIAL_TITLE_PATTERNS.some((pattern) => pattern.test(title));
    if (isOfficialTitle) {
      score += 0.15;
    }

    return Math.min(1, score);
  }

  private scoreAlbumResult(metadata: AlbumMetadata, item: YouTubeSearchItem): number {
    let score = 0;
    const title = item.snippet.title;
    const channel = item.snippet.channelTitle;
    const normalizedTitle = normalizeString(title);
    const normalizedAlbum = normalizeString(metadata.name);
    const normalizedArtist = normalizeString(metadata.artists[0] || '');

    // Check if title contains the album name (0.4 max)
    const albumSim = similarity(normalizedAlbum, normalizedTitle);
    score += 0.4 * Math.min(1, albumSim * 1.5);

    // Check if title or channel contains artist (0.3 max)
    const normalizedChannel = normalizeString(channel);
    const artistInTitle = normalizedTitle.includes(normalizedArtist) ? 1 : 0;
    const artistInChannel = normalizedChannel.includes(normalizedArtist) ? 1 : 0;
    score += 0.3 * Math.max(artistInTitle, artistInChannel);

    // Bonus for Topic channels (auto-generated album playlists) (0.2 max)
    if (/- topic$/i.test(channel)) {
      score += 0.2;
    }

    // Bonus for "full album" in title (0.1 max)
    if (/full\s*album/i.test(title)) {
      score += 0.1;
    }

    return Math.min(1, score);
  }

  private getFallbackTrackUrl(metadata: TrackMetadata): ProviderResult {
    const query = `${metadata.artists[0] || ''} ${metadata.name}`;
    return {
      url: `https://music.youtube.com/search?q=${encodeURIComponent(query)}`,
      confidence: 0,
      fallback: true,
    };
  }

  private getFallbackAlbumUrl(metadata: AlbumMetadata): ProviderResult {
    const query = `${metadata.artists[0] || ''} ${metadata.name}`;
    return {
      url: `https://music.youtube.com/search?q=${encodeURIComponent(query)}`,
      confidence: 0,
      fallback: true,
    };
  }
}
