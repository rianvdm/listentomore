// Streaming Links Service Types

/**
 * Metadata extracted from Spotify for a track
 */
export interface TrackMetadata {
  type: 'track';
  id: string;
  isrc: string;
  name: string;
  artists: string[];
  album: string;
  durationMs: number;
  releaseYear: number;
}

/**
 * Metadata extracted from Spotify for an album
 */
export interface AlbumMetadata {
  type: 'album';
  id: string;
  upc?: string;
  name: string;
  artists: string[];
  totalTracks: number;
  releaseYear: number;
}

/**
 * Result from a single streaming provider
 */
export interface ProviderResult {
  url: string;
  confidence: number; // 0-1, where 1 is perfect match
  fallback?: boolean; // true if using search URL instead of direct match
  matched?: {
    [key: string]: string; // What we matched against (for debugging)
  };
}

/**
 * Provider interface - all streaming providers implement this
 */
export interface StreamingProvider {
  name: string;
  searchTrack(metadata: TrackMetadata): Promise<ProviderResult | null>;
  searchAlbum(metadata: AlbumMetadata): Promise<ProviderResult | null>;
}

/**
 * Combined result from all providers
 */
export interface StreamingLinksResult {
  appleMusic: ProviderResult | null;
  youtube: ProviderResult | null;
  source: TrackMetadata | AlbumMetadata;
  cached: boolean;
}

/**
 * Platform link for external API response
 */
export interface PlatformLink {
  url: string;
  confidence: number;
  fallback?: boolean;
  matched?: Record<string, string>;
}

/**
 * YouTube API quota tracking
 */
export interface QuotaStatus {
  youtube: {
    used: number;
    limit: number;
    resetsAt: string;
  };
}

// iTunes Search API response types
export interface ITunesTrackResult {
  trackId: number;
  trackName: string;
  artistName: string;
  collectionName: string;
  trackViewUrl: string;
  trackTimeMillis: number;
  releaseDate?: string;
}

export interface ITunesAlbumResult {
  collectionId: number;
  collectionName: string;
  artistName: string;
  collectionViewUrl: string;
  trackCount: number;
  releaseDate?: string;
}

export interface ITunesSearchResponse {
  resultCount: number;
  results: (ITunesTrackResult | ITunesAlbumResult)[];
}

// YouTube Data API response types
export interface YouTubeSearchItem {
  id: {
    kind: string;
    videoId?: string;
    playlistId?: string;
  };
  snippet: {
    title: string;
    channelTitle: string;
    channelId: string;
    description: string;
  };
}

export interface YouTubeSearchResponse {
  items: YouTubeSearchItem[];
  pageInfo: {
    totalResults: number;
    resultsPerPage: number;
  };
}
