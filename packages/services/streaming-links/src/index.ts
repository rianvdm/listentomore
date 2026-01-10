// Streaming Links Service - self-hosted alternative to Songlink
// Designed for extensibility: new providers can be added without changing consumers

import { CACHE_CONFIG } from '@listentomore/config';
import { AppleMusicProvider, type AppleMusicConfig } from './providers/apple-music';
import { YouTubeProvider } from './providers/youtube';
import { extractYear } from './matching';
import { parseStreamingUrl, type ParsedUrl } from './url-parser';
import type {
  TrackMetadata,
  AlbumMetadata,
  StreamingLinksResult,
} from './types';

// Re-export types for consumers
export type { TrackMetadata, AlbumMetadata, StreamingLinksResult, ProviderResult } from './types';
export { AppleMusicProvider, type AppleMusicConfig, type AppleMusicTrackData, type AppleMusicAlbumData } from './providers/apple-music';
export { YouTubeProvider } from './providers/youtube';
export { parseStreamingUrl, isSupportedUrl, type ParsedUrl, type ContentType, type StreamingPlatform } from './url-parser';

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

/**
 * Interface for Spotify lookup operations
 *
 * This interface is designed to be compatible with SpotifyService from @listentomore/spotify.
 * The types match the actual return values from the Spotify service.
 */
export interface SpotifyLookupService {
  // AlbumSearchResult shape from Spotify service
  searchAlbumByArtist(artist: string, album: string): Promise<{
    id: string;
    name: string;
    url: string;
  } | null>;

  // TrackSearchResult shape - no track ID available, only title
  searchTrack(query: string): Promise<{
    title: string;
    artist: string;
    url: string;
  } | null>;

  // AlbumDetails shape from Spotify service (getAlbum returns full details)
  getAlbum(id: string): Promise<{
    id: string;
    name: string;
    artist: string;
    artistIds: string[];
    releaseDate: string;
    tracks: number;
    url: string;
    image: string | null;
    upc: string | null;
  } | null>;

  // Full track details (optional - not all Spotify services implement this)
  getTrack?(id: string): Promise<SpotifyTrackForMetadata | null>;
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
   * Check if Apple Music credentials are configured
   */
  get hasAppleMusicCredentials(): boolean {
    return this.appleMusic.hasCredentials;
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
   * Resolve any supported streaming URL to streaming links.
   *
   * Supports:
   * - Spotify URLs (tracks and albums) - fetches data, gets Apple Music link
   * - Apple Music URLs (tracks and albums) - reverse lookup via Spotify, gets links
   *
   * This is the main entry point for the Discord bot's /listenurl command.
   *
   * @param url - Any supported streaming URL
   * @param spotifyService - Spotify service for lookups (tracks, albums, search)
   * @returns StreamingLinks object with cross-platform links
   */
  async getLinksFromUrl(
    url: string,
    spotifyService: SpotifyLookupService
  ): Promise<StreamingLinks> {
    const parsed = parseStreamingUrl(url);

    console.log(`[StreamingLinks] Resolving URL: ${parsed.platform}/${parsed.contentType}/${parsed.id}`);

    if (parsed.platform === 'unknown' || !parsed.id) {
      console.log(`[StreamingLinks] Unsupported URL: ${url}`);
      return {
        pageUrl: '',
        appleUrl: null,
        songlinkUrl: null,
        deezerUrl: null,
        spotifyUrl: null,
        tidalUrl: null,
        artistName: 'Unknown Artist',
        title: 'Unknown Title',
        thumbnailUrl: null,
        type: 'unknown',
      };
    }

    // Handle Spotify URLs directly
    if (parsed.platform === 'spotify') {
      return this.resolveSpotifyUrl(parsed, spotifyService);
    }

    // Handle Apple Music URLs via reverse lookup
    if (parsed.platform === 'apple-music') {
      return this.resolveAppleMusicUrl(parsed, spotifyService);
    }

    // Shouldn't reach here, but TypeScript needs it
    throw new Error(`Unsupported platform: ${parsed.platform}`);
  }

  /**
   * Resolve a parsed Spotify URL to streaming links
   */
  private async resolveSpotifyUrl(
    parsed: ParsedUrl,
    spotifyService: SpotifyLookupService
  ): Promise<StreamingLinks> {
    const spotifyId = parsed.id!;

    if (parsed.contentType === 'album') {
      const album = await spotifyService.getAlbum(spotifyId);
      if (!album) {
        console.log(`[StreamingLinks] Spotify album not found: ${spotifyId}`);
        return this.createUnknownResult(parsed.originalUrl, 'spotify');
      }

      // Convert AlbumDetails shape to SpotifyAlbumForMetadata shape
      const albumForMetadata = {
        id: album.id,
        name: album.name,
        artists: [{ name: album.artist }],
        total_tracks: album.tracks,
        release_date: album.releaseDate,
        external_ids: album.upc ? { upc: album.upc } : undefined,
        images: album.image ? [{ url: album.image }] : undefined,
      };

      return this.getLinksFromSpotifyUrl(parsed.originalUrl, {
        type: 'album',
        album: albumForMetadata,
      });
    }

    if (parsed.contentType === 'track' && spotifyService.getTrack) {
      const track = await spotifyService.getTrack(spotifyId);
      if (!track) {
        console.log(`[StreamingLinks] Spotify track not found: ${spotifyId}`);
        return this.createUnknownResult(parsed.originalUrl, 'spotify');
      }

      return this.getLinksFromSpotifyUrl(parsed.originalUrl, {
        type: 'track',
        track,
      });
    }

    // Fallback: construct URL without full metadata
    console.log(`[StreamingLinks] No track getter available, returning basic result`);
    return this.createUnknownResult(parsed.originalUrl, 'spotify');
  }

  /**
   * Resolve a parsed Apple Music URL via reverse lookup to Spotify
   */
  private async resolveAppleMusicUrl(
    parsed: ParsedUrl,
    spotifyService: SpotifyLookupService
  ): Promise<StreamingLinks> {
    const appleId = parsed.id!;

    if (parsed.contentType === 'album') {
      // Fetch album data from Apple Music
      const appleAlbum = await this.appleMusic.getAlbumById(appleId);
      if (!appleAlbum) {
        console.log(`[StreamingLinks] Apple Music album not found: ${appleId}`);
        return this.createUnknownResult(parsed.originalUrl, 'apple-music');
      }

      // Search Spotify for matching album
      const spotifyResult = await spotifyService.searchAlbumByArtist(
        appleAlbum.artistName,
        appleAlbum.name
      );

      if (!spotifyResult) {
        console.log(`[StreamingLinks] Could not find Spotify match for Apple album: ${appleAlbum.name}`);
        // Return Apple data without Spotify link
        return {
          pageUrl: '',
          appleUrl: appleAlbum.url,
          songlinkUrl: null,
          deezerUrl: null,
          spotifyUrl: null,
          tidalUrl: null,
          artistName: appleAlbum.artistName,
          title: appleAlbum.name,
          thumbnailUrl: null,
          type: 'album',
        };
      }

      // Get full Spotify album data for proper metadata
      const spotifyAlbum = await spotifyService.getAlbum(spotifyResult.id);
      if (!spotifyAlbum) {
        return {
          pageUrl: '',
          appleUrl: appleAlbum.url,
          songlinkUrl: null,
          deezerUrl: null,
          spotifyUrl: spotifyResult.url,
          tidalUrl: null,
          artistName: appleAlbum.artistName,
          title: appleAlbum.name,
          thumbnailUrl: null,
          type: 'album',
        };
      }

      // Convert AlbumDetails shape to SpotifyAlbumForMetadata shape
      const spotifyAlbumForMetadata = {
        id: spotifyAlbum.id,
        name: spotifyAlbum.name,
        artists: [{ name: spotifyAlbum.artist }],
        total_tracks: spotifyAlbum.tracks,
        release_date: spotifyAlbum.releaseDate,
        external_ids: spotifyAlbum.upc ? { upc: spotifyAlbum.upc } : undefined,
        images: spotifyAlbum.image ? [{ url: spotifyAlbum.image }] : undefined,
      };

      // Now get streaming links the normal way (Spotify → providers)
      const links = await this.getLinksFromSpotifyUrl(spotifyResult.url, {
        type: 'album',
        album: spotifyAlbumForMetadata,
      });

      // Override Apple URL with the one from the original request
      return {
        ...links,
        appleUrl: appleAlbum.url,
      };
    }

    if (parsed.contentType === 'track') {
      // Fetch track data from Apple Music
      const appleTrack = await this.appleMusic.getTrackById(appleId);
      if (!appleTrack) {
        console.log(`[StreamingLinks] Apple Music track not found: ${appleId}`);
        return this.createUnknownResult(parsed.originalUrl, 'apple-music');
      }

      // Search Spotify for matching track
      const query = `${appleTrack.artistName} ${appleTrack.name}`;
      const spotifyResult = await spotifyService.searchTrack(query);

      if (!spotifyResult) {
        console.log(`[StreamingLinks] Could not find Spotify match for Apple track: ${appleTrack.name}`);
        return {
          pageUrl: '',
          appleUrl: appleTrack.url,
          songlinkUrl: null,
          deezerUrl: null,
          spotifyUrl: null,
          tidalUrl: null,
          artistName: appleTrack.artistName,
          title: appleTrack.name,
          thumbnailUrl: null,
          type: 'song',
        };
      }

      // Note: TrackSearchResult doesn't include the track ID, only albumId.
      // For reverse lookups (Apple → Spotify), we return the basic result without
      // full track metadata. This is a limitation of the Spotify search API.
      console.log(`[StreamingLinks] Found Spotify match: "${spotifyResult.title}" by ${spotifyResult.artist}`);
      return {
        pageUrl: '',
        appleUrl: appleTrack.url,
        songlinkUrl: `https://song.link/${spotifyResult.url}`,
        deezerUrl: null,
        spotifyUrl: spotifyResult.url,
        tidalUrl: null,
        artistName: spotifyResult.artist,
        title: spotifyResult.title,
        thumbnailUrl: null,
        type: 'song',
      };
    }

    // Unsupported content type
    return this.createUnknownResult(parsed.originalUrl, 'apple-music');
  }

  /**
   * Create a result for unknown/failed lookups
   */
  private createUnknownResult(
    originalUrl: string,
    platform: 'spotify' | 'apple-music'
  ): StreamingLinks {
    return {
      pageUrl: '',
      appleUrl: platform === 'apple-music' ? originalUrl : null,
      songlinkUrl: null,
      deezerUrl: null,
      spotifyUrl: platform === 'spotify' ? originalUrl : null,
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
