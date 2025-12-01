// Apple Music provider using iTunes Search API

import type {
  StreamingProvider,
  TrackMetadata,
  AlbumMetadata,
  ProviderResult,
  ITunesSearchResponse,
  ITunesTrackResult,
  ITunesAlbumResult,
} from '../types';
import { calculateTrackConfidence, calculateAlbumConfidence, extractYear } from '../matching';

const ITUNES_SEARCH_API = 'https://itunes.apple.com/search';
const CONFIDENCE_THRESHOLD = 0.8;

export class AppleMusicProvider implements StreamingProvider {
  name = 'appleMusic';

  async searchTrack(metadata: TrackMetadata): Promise<ProviderResult | null> {
    const artist = metadata.artists[0] || '';
    const track = metadata.name;

    // Build search query with quoted terms for better matching
    const query = `${artist} ${track}`;

    try {
      const url = new URL(ITUNES_SEARCH_API);
      url.searchParams.set('term', query);
      url.searchParams.set('entity', 'song');
      url.searchParams.set('limit', '10');

      console.log(`[AppleMusic] Searching for track: "${query}"`);

      const response = await fetch(url.toString());

      if (!response.ok) {
        console.error(`[AppleMusic] Search failed: ${response.status}`);
        return this.getFallbackTrackUrl(metadata);
      }

      const data = (await response.json()) as ITunesSearchResponse;

      if (data.resultCount === 0) {
        console.log(`[AppleMusic] No results for: "${query}"`);
        return this.getFallbackTrackUrl(metadata);
      }

      // Score each result and find the best match
      let bestMatch: ITunesTrackResult | null = null;
      let bestConfidence = 0;

      for (const result of data.results as ITunesTrackResult[]) {
        const confidence = calculateTrackConfidence(
          {
            artists: metadata.artists,
            name: metadata.name,
            durationMs: metadata.durationMs,
            album: metadata.album,
          },
          {
            artistName: result.artistName,
            trackName: result.trackName,
            trackTimeMillis: result.trackTimeMillis,
            collectionName: result.collectionName,
          }
        );

        if (confidence > bestConfidence) {
          bestConfidence = confidence;
          bestMatch = result;
        }
      }

      if (bestMatch && bestConfidence >= CONFIDENCE_THRESHOLD) {
        console.log(
          `[AppleMusic] Match found: "${bestMatch.trackName}" by ${bestMatch.artistName} (confidence: ${bestConfidence.toFixed(2)})`
        );

        return {
          url: bestMatch.trackViewUrl,
          confidence: bestConfidence,
          matched: {
            artist: bestMatch.artistName,
            track: bestMatch.trackName,
            album: bestMatch.collectionName,
          },
        };
      }

      console.log(
        `[AppleMusic] Best match confidence too low: ${bestConfidence.toFixed(2)} < ${CONFIDENCE_THRESHOLD}`
      );
      return this.getFallbackTrackUrl(metadata);
    } catch (error) {
      console.error('[AppleMusic] Search error:', error);
      return this.getFallbackTrackUrl(metadata);
    }
  }

  async searchAlbum(metadata: AlbumMetadata): Promise<ProviderResult | null> {
    const artist = metadata.artists[0] || '';
    const album = metadata.name;

    const query = `${artist} ${album}`;

    try {
      const url = new URL(ITUNES_SEARCH_API);
      url.searchParams.set('term', query);
      url.searchParams.set('entity', 'album');
      url.searchParams.set('limit', '10');

      console.log(`[AppleMusic] Searching for album: "${query}"`);

      const response = await fetch(url.toString());

      if (!response.ok) {
        console.error(`[AppleMusic] Search failed: ${response.status}`);
        return this.getFallbackAlbumUrl(metadata);
      }

      const data = (await response.json()) as ITunesSearchResponse;

      if (data.resultCount === 0) {
        console.log(`[AppleMusic] No results for: "${query}"`);
        return this.getFallbackAlbumUrl(metadata);
      }

      // Score each result and find the best match
      let bestMatch: ITunesAlbumResult | null = null;
      let bestConfidence = 0;

      for (const result of data.results as ITunesAlbumResult[]) {
        const confidence = calculateAlbumConfidence(
          {
            artists: metadata.artists,
            name: metadata.name,
            totalTracks: metadata.totalTracks,
            releaseYear: metadata.releaseYear,
          },
          {
            artistName: result.artistName,
            albumName: result.collectionName,
            trackCount: result.trackCount,
            releaseYear: extractYear(result.releaseDate),
          }
        );

        if (confidence > bestConfidence) {
          bestConfidence = confidence;
          bestMatch = result;
        }
      }

      if (bestMatch && bestConfidence >= CONFIDENCE_THRESHOLD) {
        console.log(
          `[AppleMusic] Match found: "${bestMatch.collectionName}" by ${bestMatch.artistName} (confidence: ${bestConfidence.toFixed(2)})`
        );

        return {
          url: bestMatch.collectionViewUrl,
          confidence: bestConfidence,
          matched: {
            artist: bestMatch.artistName,
            album: bestMatch.collectionName,
          },
        };
      }

      console.log(
        `[AppleMusic] Best match confidence too low: ${bestConfidence.toFixed(2)} < ${CONFIDENCE_THRESHOLD}`
      );
      return this.getFallbackAlbumUrl(metadata);
    } catch (error) {
      console.error('[AppleMusic] Search error:', error);
      return this.getFallbackAlbumUrl(metadata);
    }
  }

  private getFallbackTrackUrl(metadata: TrackMetadata): ProviderResult {
    const query = `${metadata.artists[0] || ''} ${metadata.name}`;
    return {
      url: `https://music.apple.com/search?term=${encodeURIComponent(query)}`,
      confidence: 0,
      fallback: true,
    };
  }

  private getFallbackAlbumUrl(metadata: AlbumMetadata): ProviderResult {
    const query = `${metadata.artists[0] || ''} ${metadata.name}`;
    return {
      url: `https://music.apple.com/search?term=${encodeURIComponent(query)}`,
      confidence: 0,
      fallback: true,
    };
  }
}
