// ABOUTME: Apple Music provider using Apple MusicKit API.
// ABOUTME: Uses ISRC/UPC lookup for high-confidence matching, with text search fallback.

import { SignJWT, importPKCS8 } from 'jose';
import { fetchWithTimeout } from '@listentomore/shared';
import type {
  StreamingProvider,
  TrackMetadata,
  AlbumMetadata,
  ProviderResult,
} from '../types';
import { calculateTrackConfidence, calculateAlbumConfidence, extractYear } from '../matching';

const APPLE_MUSIC_API = 'https://api.music.apple.com/v1';
const DEFAULT_STOREFRONT = 'us';
const CONFIDENCE_THRESHOLD = 0.8;
const ISRC_CONFIDENCE = 0.98; // ISRC matches are very reliable
const UPC_CONFIDENCE = 0.98; // UPC matches are very reliable

/**
 * Convert a storefront-specific Apple Music URL to a geo-agnostic URL.
 * Apple will redirect users to their local storefront automatically.
 * e.g., https://music.apple.com/us/album/... → https://music.apple.com/album/...
 */
function toGeoAgnosticUrl(url: string): string {
  return url.replace(/music\.apple\.com\/[a-z]{2}\//, 'music.apple.com/');
}

// MusicKit API response types
interface AppleMusicSongAttributes {
  name: string;
  artistName: string;
  albumName: string;
  durationInMillis: number;
  isrc?: string;
  url: string;
}

interface AppleMusicAlbumAttributes {
  name: string;
  artistName: string;
  trackCount: number;
  releaseDate?: string;
  upc?: string;
  url: string;
}

interface AppleMusicResource<T> {
  id: string;
  type: string;
  href: string;
  attributes: T;
}

interface AppleMusicResponse<T> {
  data: AppleMusicResource<T>[];
}

interface AppleMusicSearchResponse {
  results: {
    songs?: { data: AppleMusicResource<AppleMusicSongAttributes>[] };
    albums?: { data: AppleMusicResource<AppleMusicAlbumAttributes>[] };
  };
}

/**
 * Track data returned from Apple Music API lookup
 * Used for reverse lookup (Apple URL → metadata)
 */
export interface AppleMusicTrackData {
  id: string;
  name: string;
  artistName: string;
  albumName: string;
  durationMs: number;
  isrc?: string;
  url: string;
}

/**
 * Album data returned from Apple Music API lookup
 * Used for reverse lookup (Apple URL → metadata)
 */
export interface AppleMusicAlbumData {
  id: string;
  name: string;
  artistName: string;
  trackCount: number;
  releaseYear: number;
  upc?: string;
  url: string;
}

export interface AppleMusicConfig {
  teamId: string;
  keyId: string;
  privateKey: string;
}

export class AppleMusicProvider implements StreamingProvider {
  name = 'appleMusic';

  private config: AppleMusicConfig | null;
  private cachedToken: { token: string; expiresAt: number } | null = null;

  constructor(config?: AppleMusicConfig) {
    this.config = config || null;
  }

  /**
   * Generate a signed JWT for Apple Music API authentication.
   * Tokens are cached for 50 minutes (API allows up to 6 months, but shorter is safer).
   */
  private async getToken(): Promise<string | null> {
    if (!this.config) {
      return null;
    }

    // Check if cached token is still valid (with 10 min buffer)
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt > now + 10 * 60 * 1000) {
      return this.cachedToken.token;
    }

    try {
      const key = await importPKCS8(this.config.privateKey, 'ES256');

      const token = await new SignJWT({})
        .setProtectedHeader({ alg: 'ES256', kid: this.config.keyId })
        .setIssuer(this.config.teamId)
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(key);

      // Cache for 50 minutes
      this.cachedToken = {
        token,
        expiresAt: now + 50 * 60 * 1000,
      };

      console.log('[AppleMusic] Generated new JWT token');
      return token;
    } catch (error) {
      console.error('[AppleMusic] Failed to generate JWT:', error);
      return null;
    }
  }

  /**
   * Make an authenticated request to the Apple Music API
   */
  private async apiRequest<T>(endpoint: string): Promise<T | null> {
    const token = await this.getToken();
    if (!token) {
      return null;
    }

    const url = `${APPLE_MUSIC_API}${endpoint}`;

    try {
      const response = await fetchWithTimeout(url, {
        timeout: 'fast',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        console.error(`[AppleMusic] API request failed: ${response.status}`);
        return null;
      }

      return (await response.json()) as T;
    } catch (error) {
      console.error('[AppleMusic] API request error:', error);
      return null;
    }
  }

  /**
   * Search for a track by ISRC (most reliable method)
   */
  private async searchByIsrc(
    isrc: string
  ): Promise<AppleMusicResource<AppleMusicSongAttributes> | null> {
    if (!isrc) return null;

    console.log(`[AppleMusic] Searching by ISRC: ${isrc}`);
    const data = await this.apiRequest<AppleMusicResponse<AppleMusicSongAttributes>>(
      `/catalog/${DEFAULT_STOREFRONT}/songs?filter[isrc]=${isrc}`
    );

    if (data?.data?.length) {
      console.log(`[AppleMusic] ISRC match found: "${data.data[0].attributes.name}"`);
      return data.data[0];
    }

    console.log(`[AppleMusic] No ISRC match for: ${isrc}`);
    return null;
  }

  /**
   * Search for an album by UPC (most reliable method)
   */
  private async searchByUpc(
    upc: string
  ): Promise<AppleMusicResource<AppleMusicAlbumAttributes> | null> {
    if (!upc) return null;

    console.log(`[AppleMusic] Searching by UPC: ${upc}`);
    const data = await this.apiRequest<AppleMusicResponse<AppleMusicAlbumAttributes>>(
      `/catalog/${DEFAULT_STOREFRONT}/albums?filter[upc]=${upc}`
    );

    if (data?.data?.length) {
      console.log(`[AppleMusic] UPC match found: "${data.data[0].attributes.name}"`);
      return data.data[0];
    }

    console.log(`[AppleMusic] No UPC match for: ${upc}`);
    return null;
  }

  /**
   * Search for a track by text query (fallback)
   */
  private async searchTrackByText(
    query: string,
    metadata: TrackMetadata
  ): Promise<ProviderResult | null> {
    console.log(`[AppleMusic] Text search for track: "${query}"`);

    const data = await this.apiRequest<AppleMusicSearchResponse>(
      `/catalog/${DEFAULT_STOREFRONT}/search?term=${encodeURIComponent(query)}&types=songs&limit=10`
    );

    const songs = data?.results?.songs?.data;
    if (!songs?.length) {
      console.log(`[AppleMusic] No text search results for: "${query}"`);
      return null;
    }

    // Score each result and find the best match
    let bestMatch: AppleMusicResource<AppleMusicSongAttributes> | null = null;
    let bestConfidence = 0;

    for (const song of songs) {
      const confidence = calculateTrackConfidence(
        {
          artists: metadata.artists,
          name: metadata.name,
          durationMs: metadata.durationMs,
          album: metadata.album,
        },
        {
          artistName: song.attributes.artistName,
          trackName: song.attributes.name,
          trackTimeMillis: song.attributes.durationInMillis,
          collectionName: song.attributes.albumName,
        }
      );

      if (confidence > bestConfidence) {
        bestConfidence = confidence;
        bestMatch = song;
      }
    }

    if (bestMatch && bestConfidence >= CONFIDENCE_THRESHOLD) {
      console.log(
        `[AppleMusic] Text match: "${bestMatch.attributes.name}" (confidence: ${bestConfidence.toFixed(2)})`
      );
      return {
        url: toGeoAgnosticUrl(bestMatch.attributes.url),
        confidence: bestConfidence,
        matched: {
          artist: bestMatch.attributes.artistName,
          track: bestMatch.attributes.name,
          album: bestMatch.attributes.albumName,
        },
      };
    }

    console.log(
      `[AppleMusic] Best text match confidence too low: ${bestConfidence.toFixed(2)} < ${CONFIDENCE_THRESHOLD}`
    );
    return null;
  }

  /**
   * Search for an album by text query (fallback)
   */
  private async searchAlbumByText(
    query: string,
    metadata: AlbumMetadata
  ): Promise<ProviderResult | null> {
    console.log(`[AppleMusic] Text search for album: "${query}"`);

    const data = await this.apiRequest<AppleMusicSearchResponse>(
      `/catalog/${DEFAULT_STOREFRONT}/search?term=${encodeURIComponent(query)}&types=albums&limit=10`
    );

    const albums = data?.results?.albums?.data;
    if (!albums?.length) {
      console.log(`[AppleMusic] No text search results for: "${query}"`);
      return null;
    }

    // Score each result and find the best match
    let bestMatch: AppleMusicResource<AppleMusicAlbumAttributes> | null = null;
    let bestConfidence = 0;

    for (const album of albums) {
      const confidence = calculateAlbumConfidence(
        {
          artists: metadata.artists,
          name: metadata.name,
          totalTracks: metadata.totalTracks,
          releaseYear: metadata.releaseYear,
        },
        {
          artistName: album.attributes.artistName,
          albumName: album.attributes.name,
          trackCount: album.attributes.trackCount,
          releaseYear: extractYear(album.attributes.releaseDate),
        }
      );

      if (confidence > bestConfidence) {
        bestConfidence = confidence;
        bestMatch = album;
      }
    }

    if (bestMatch && bestConfidence >= CONFIDENCE_THRESHOLD) {
      console.log(
        `[AppleMusic] Text match: "${bestMatch.attributes.name}" (confidence: ${bestConfidence.toFixed(2)})`
      );
      return {
        url: toGeoAgnosticUrl(bestMatch.attributes.url),
        confidence: bestConfidence,
        matched: {
          artist: bestMatch.attributes.artistName,
          album: bestMatch.attributes.name,
        },
      };
    }

    console.log(
      `[AppleMusic] Best text match confidence too low: ${bestConfidence.toFixed(2)} < ${CONFIDENCE_THRESHOLD}`
    );
    return null;
  }

  async searchTrack(metadata: TrackMetadata): Promise<ProviderResult | null> {
    // If we have MusicKit credentials, try ISRC first, then text search
    if (this.config) {
      // Try ISRC lookup first (most reliable)
      if (metadata.isrc) {
        const isrcMatch = await this.searchByIsrc(metadata.isrc);
        if (isrcMatch) {
          console.log(`[AppleMusic] Track matched via ISRC: ${metadata.isrc}`);
          return {
            url: toGeoAgnosticUrl(isrcMatch.attributes.url),
            confidence: ISRC_CONFIDENCE,
            matched: {
              artist: isrcMatch.attributes.artistName,
              track: isrcMatch.attributes.name,
              album: isrcMatch.attributes.albumName,
              isrc: metadata.isrc,
            },
          };
        }
      }

      // Fall back to text search via API
      const query = `${metadata.artists[0] || ''} ${metadata.name}`;
      console.log(`[AppleMusic] Track falling back to text search (no ISRC match): ${query}`);
      const textResult = await this.searchTrackByText(query, metadata);
      if (textResult) {
        return textResult;
      }
    }

    // No MusicKit config or API failed - return fallback search URL
    return this.getFallbackTrackUrl(metadata);
  }

  async searchAlbum(metadata: AlbumMetadata): Promise<ProviderResult | null> {
    // If we have MusicKit credentials, try UPC first, then text search
    if (this.config) {
      // Try UPC lookup first (most reliable)
      if (metadata.upc) {
        const upcMatch = await this.searchByUpc(metadata.upc);
        if (upcMatch) {
          console.log(`[AppleMusic] Album matched via UPC: ${metadata.upc}`);
          return {
            url: toGeoAgnosticUrl(upcMatch.attributes.url),
            confidence: UPC_CONFIDENCE,
            matched: {
              artist: upcMatch.attributes.artistName,
              album: upcMatch.attributes.name,
              upc: metadata.upc,
            },
          };
        }
      }

      // Fall back to text search via API
      const query = `${metadata.artists[0] || ''} ${metadata.name}`;
      console.log(`[AppleMusic] Album falling back to text search (no UPC match): ${query}`);
      const textResult = await this.searchAlbumByText(query, metadata);
      if (textResult) {
        return textResult;
      }
    }

    // No MusicKit config or API failed - return fallback search URL
    return this.getFallbackAlbumUrl(metadata);
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

  /**
   * Check if MusicKit credentials are configured
   */
  get hasCredentials(): boolean {
    return this.config !== null;
  }

  /**
   * Get track data by Apple Music ID
   * Used for reverse lookup: Apple Music URL → track metadata
   */
  async getTrackById(id: string): Promise<AppleMusicTrackData | null> {
    if (!this.config) {
      console.log('[AppleMusic] No credentials configured for track lookup');
      return null;
    }

    console.log(`[AppleMusic] Looking up track by ID: ${id}`);
    const data = await this.apiRequest<AppleMusicResponse<AppleMusicSongAttributes>>(
      `/catalog/${DEFAULT_STOREFRONT}/songs/${id}`
    );

    if (!data?.data?.[0]) {
      console.log(`[AppleMusic] Track not found: ${id}`);
      return null;
    }

    const track = data.data[0];
    console.log(`[AppleMusic] Found track: "${track.attributes.name}" by ${track.attributes.artistName}`);

    return {
      id: track.id,
      name: track.attributes.name,
      artistName: track.attributes.artistName,
      albumName: track.attributes.albumName,
      durationMs: track.attributes.durationInMillis,
      isrc: track.attributes.isrc,
      url: toGeoAgnosticUrl(track.attributes.url),
    };
  }

  /**
   * Get album data by Apple Music ID
   * Used for reverse lookup: Apple Music URL → album metadata
   */
  async getAlbumById(id: string): Promise<AppleMusicAlbumData | null> {
    if (!this.config) {
      console.log('[AppleMusic] No credentials configured for album lookup');
      return null;
    }

    console.log(`[AppleMusic] Looking up album by ID: ${id}`);
    const data = await this.apiRequest<AppleMusicResponse<AppleMusicAlbumAttributes>>(
      `/catalog/${DEFAULT_STOREFRONT}/albums/${id}`
    );

    if (!data?.data?.[0]) {
      console.log(`[AppleMusic] Album not found: ${id}`);
      return null;
    }

    const album = data.data[0];
    console.log(`[AppleMusic] Found album: "${album.attributes.name}" by ${album.attributes.artistName}`);

    return {
      id: album.id,
      name: album.attributes.name,
      artistName: album.attributes.artistName,
      trackCount: album.attributes.trackCount,
      releaseYear: extractYear(album.attributes.releaseDate),
      upc: album.attributes.upc,
      url: toGeoAgnosticUrl(album.attributes.url),
    };
  }
}
