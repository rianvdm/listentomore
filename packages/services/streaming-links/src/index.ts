// Streaming Links Service - self-hosted alternative to Songlink

import { CACHE_CONFIG } from '@listentomore/config';
import { AppleMusicProvider, type AppleMusicConfig } from './providers/apple-music';
import { YouTubeProvider } from './providers/youtube';
import { extractYear } from './matching';
import type {
  TrackMetadata,
  AlbumMetadata,
  StreamingLinksResult,
} from './types';

export type { TrackMetadata, AlbumMetadata, StreamingLinksResult, ProviderResult } from './types';
export { AppleMusicProvider, type AppleMusicConfig } from './providers/apple-music';
export { YouTubeProvider } from './providers/youtube';

// Backward compatibility type matching songlink service
export interface StreamingLinks {
  pageUrl: string;
  appleUrl: string | null;
  songlinkUrl: string | null;
  deezerUrl: string | null;
  spotifyUrl: string | null;
  tidalUrl: string | null;
  artistName: string;
  title: string;
  thumbnailUrl: string | null;
  type: 'song' | 'album' | 'unknown';
}

interface SpotifyTrackForMetadata {
  id: string;
  name: string;
  artists: Array<{ name: string }>;
  album?: { name: string };
  duration_ms: number;
  external_ids?: { isrc?: string };
  release_date?: string;
}

interface SpotifyAlbumForMetadata {
  id: string;
  name: string;
  artists: Array<{ name: string }>;
  total_tracks: number;
  release_date: string;
  external_ids?: { upc?: string };
  images?: Array<{ url: string }>;
  external_urls?: { spotify?: string };
}

export class StreamingLinksService {
  private appleMusic: AppleMusicProvider;
  // YouTube provider kept for potential future use but not currently called in getTrackLinks/getAlbumLinks
  private youtubeProvider: YouTubeProvider;

  constructor(
    private cache: KVNamespace,
    config: {
      youtubeApiKey?: string;
      appleMusic?: AppleMusicConfig;
    } = {}
  ) {
    this.appleMusic = new AppleMusicProvider(config.appleMusic);
    this.youtubeProvider = new YouTubeProvider(config.youtubeApiKey);
  }

  /**
   * Get the YouTube provider for direct use if needed
   */
  get youtube(): YouTubeProvider {
    return this.youtubeProvider;
  }

  /**
   * Get streaming links for a track
   */
  async getTrackLinks(metadata: TrackMetadata): Promise<StreamingLinksResult> {
    const cacheKey = `streaming-links:track:${metadata.id}`;

    // Check cache
    const cached = await this.cache.get<StreamingLinksResult>(cacheKey, 'json');
    if (cached) {
      console.log(`[StreamingLinks] Cache hit for track ${metadata.id}`);
      return { ...cached, cached: true };
    }

    console.log(`[StreamingLinks] Fetching links for track: ${metadata.name} by ${metadata.artists.join(', ')}`);

    // Query Apple Music (YouTube provider kept but not called - use songlink instead)
    const appleResult = await this.appleMusic.searchTrack(metadata);

    // Generate songlink URL from Spotify ID
    const spotifyUrl = `https://open.spotify.com/track/${metadata.id}`;
    const songlinkUrl = `https://song.link/${spotifyUrl}`;

    const result: StreamingLinksResult = {
      appleMusic: appleResult,
      youtube: null, // YouTube provider available but not used; songlink provides more services
      songlink: songlinkUrl,
      source: metadata,
      cached: false,
    };

    // Cache the result
    await this.cache.put(cacheKey, JSON.stringify(result), {
      expirationTtl: this.getCacheTtl(),
    });

    return result;
  }

  /**
   * Get streaming links for an album
   */
  async getAlbumLinks(metadata: AlbumMetadata): Promise<StreamingLinksResult> {
    const cacheKey = `streaming-links:album:${metadata.id}`;

    // Check cache
    const cached = await this.cache.get<StreamingLinksResult>(cacheKey, 'json');
    if (cached) {
      console.log(`[StreamingLinks] Cache hit for album ${metadata.id}`);
      return { ...cached, cached: true };
    }

    console.log(`[StreamingLinks] Fetching links for album: ${metadata.name} by ${metadata.artists.join(', ')}`);

    // Query Apple Music (YouTube provider kept but not called - use songlink instead)
    const appleResult = await this.appleMusic.searchAlbum(metadata);

    // Generate songlink URL from Spotify ID
    const spotifyUrl = `https://open.spotify.com/album/${metadata.id}`;
    const songlinkUrl = `https://song.link/${spotifyUrl}`;

    const result: StreamingLinksResult = {
      appleMusic: appleResult,
      youtube: null, // YouTube provider available but not used; songlink provides more services
      songlink: songlinkUrl,
      source: metadata,
      cached: false,
    };

    // Cache the result
    await this.cache.put(cacheKey, JSON.stringify(result), {
      expirationTtl: this.getCacheTtl(),
    });

    return result;
  }

  /**
   * Convert a Spotify track response to TrackMetadata
   */
  static trackMetadataFromSpotify(track: SpotifyTrackForMetadata): TrackMetadata {
    return {
      type: 'track',
      id: track.id,
      isrc: track.external_ids?.isrc || '',
      name: track.name,
      artists: track.artists.map((a) => a.name),
      album: track.album?.name || '',
      durationMs: track.duration_ms,
      releaseYear: extractYear(track.release_date),
    };
  }

  /**
   * Convert a Spotify album response to AlbumMetadata
   */
  static albumMetadataFromSpotify(album: SpotifyAlbumForMetadata): AlbumMetadata {
    return {
      type: 'album',
      id: album.id,
      upc: album.external_ids?.upc,
      name: album.name,
      artists: album.artists.map((a) => a.name),
      totalTracks: album.total_tracks,
      releaseYear: extractYear(album.release_date),
    };
  }

  /**
   * Get streaming links in the legacy Songlink format (for backward compatibility)
   * Takes a Spotify URL and returns links in the same format as the old service
   */
  async getLinksFromSpotifyUrl(
    spotifyUrl: string,
    spotifyData: {
      type: 'track' | 'album';
      track?: SpotifyTrackForMetadata;
      album?: SpotifyAlbumForMetadata;
    }
  ): Promise<StreamingLinks> {
    let result: StreamingLinksResult;

    if (spotifyData.type === 'track' && spotifyData.track) {
      const metadata = StreamingLinksService.trackMetadataFromSpotify(spotifyData.track);
      result = await this.getTrackLinks(metadata);

      return {
        pageUrl: '', // No Songlink page anymore
        appleUrl: result.appleMusic?.url || null,
        songlinkUrl: result.songlink,
        deezerUrl: null, // Not implemented yet
        spotifyUrl: spotifyUrl,
        tidalUrl: null, // Not implemented yet
        artistName: metadata.artists[0] || 'Unknown Artist',
        title: metadata.name,
        thumbnailUrl: null,
        type: 'song',
      };
    } else if (spotifyData.type === 'album' && spotifyData.album) {
      const metadata = StreamingLinksService.albumMetadataFromSpotify(spotifyData.album);
      result = await this.getAlbumLinks(metadata);

      return {
        pageUrl: '',
        appleUrl: result.appleMusic?.url || null,
        songlinkUrl: result.songlink,
        deezerUrl: null,
        spotifyUrl: spotifyUrl,
        tidalUrl: null,
        artistName: metadata.artists[0] || 'Unknown Artist',
        title: metadata.name,
        thumbnailUrl: spotifyData.album.images?.[0]?.url || null,
        type: 'album',
      };
    }

    // Fallback for unknown type
    return {
      pageUrl: '',
      appleUrl: null,
      songlinkUrl: null,
      deezerUrl: null,
      spotifyUrl: spotifyUrl,
      tidalUrl: null,
      artistName: 'Unknown Artist',
      title: 'Unknown Title',
      thumbnailUrl: null,
      type: 'unknown',
    };
  }

  /**
   * Clear cache for a specific item
   */
  async clearCache(spotifyId: string, type: 'track' | 'album'): Promise<void> {
    const cacheKey = `streaming-links:${type}:${spotifyId}`;
    await this.cache.delete(cacheKey);
    console.log(`[StreamingLinks] Cache cleared for ${type} ${spotifyId}`);
  }

  private getCacheTtl(): number {
    return CACHE_CONFIG.streamingLinks.links.ttlDays * 24 * 60 * 60;
  }
}
