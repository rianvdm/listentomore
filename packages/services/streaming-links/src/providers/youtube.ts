// ABOUTME: YouTube provider using YouTube Data API v3.
// ABOUTME: Searches for track videos with smart scoring, albums use search URLs.

import { fetchWithTimeout } from '@listentomore/shared';
import type {
  StreamingProvider,
  TrackMetadata,
  AlbumMetadata,
  ProviderResult,
  YouTubeSearchResponse,
  YouTubeSearchItem,
} from '../types';
import { normalizeString } from '../matching';

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

      const response = await fetchWithTimeout(url.toString(), { timeout: 'fast' });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[YouTube] Search failed: ${response.status} - ${errorText}`);

        if (response.status === 403) {
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
        .filter((item) => item.id.videoId)
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
          url: `https://www.youtube.com/watch?v=${videoId}`,
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
    // Albums don't have a direct YouTube equivalent, so just return a search URL
    // This saves an API call and provides a reasonable user experience
    console.log(`[YouTube] Returning search URL for album: "${metadata.name}" by ${metadata.artists[0]}`);
    return this.getFallbackAlbumUrl(metadata);
  }

  private scoreTrackResult(metadata: TrackMetadata, item: YouTubeSearchItem): number {
    let score = 0;
    const title = item.snippet.title;
    const channel = item.snippet.channelTitle;
    const normalizedTitle = normalizeString(title);
    const normalizedTrack = normalizeString(metadata.name);
    const normalizedArtist = normalizeString(metadata.artists[0] || '');

    // Check if title contains the track name (0.4 max)
    if (normalizedTitle.includes(normalizedTrack)) {
      score += 0.4;
    } else {
      // Check token overlap for partial matches
      const trackTokens = normalizedTrack.split(/\s+/).filter((t) => t.length > 2);
      const titleTokens = normalizedTitle.split(/\s+/);
      const matchedTokens = trackTokens.filter((t) => titleTokens.includes(t));
      const tokenOverlap = trackTokens.length > 0 ? matchedTokens.length / trackTokens.length : 0;
      score += 0.4 * tokenOverlap;
    }

    // Check if title or channel contains artist (0.3 max)
    const normalizedChannel = normalizeString(channel);
    if (normalizedTitle.includes(normalizedArtist) || normalizedChannel.includes(normalizedArtist)) {
      score += 0.3;
    } else {
      const artistTokens = normalizedArtist.split(/\s+/).filter((t) => t.length > 2);
      const channelTokens = normalizedChannel.split(/\s+/);
      const titleTokens = normalizedTitle.split(/\s+/);
      const allTargetTokens = [...new Set([...channelTokens, ...titleTokens])];
      const matchedArtistTokens = artistTokens.filter((t) => allTargetTokens.includes(t));
      const artistOverlap = artistTokens.length > 0 ? matchedArtistTokens.length / artistTokens.length : 0;
      score += 0.3 * artistOverlap;
    }

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

  private getFallbackTrackUrl(metadata: TrackMetadata): ProviderResult {
    const query = `${metadata.artists[0] || ''} ${metadata.name}`;
    return {
      url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
      confidence: 0,
      fallback: true,
    };
  }

  private getFallbackAlbumUrl(metadata: AlbumMetadata): ProviderResult {
    const query = `${metadata.artists[0] || ''} ${metadata.name} album`;
    return {
      url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
      confidence: 0,
      fallback: true,
    };
  }
}
