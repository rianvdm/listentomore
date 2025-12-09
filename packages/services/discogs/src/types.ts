// Type definitions for Discogs API responses and service interfaces

// ============================================================================
// Configuration
// ============================================================================

export interface DiscogsConfig {
  /** Personal access token or OAuth access token */
  accessToken: string;
  /** Optional OAuth access token secret (for OAuth 1.0a) */
  accessTokenSecret?: string;
  /** OAuth consumer key (required for OAuth) */
  consumerKey?: string;
  /** OAuth consumer secret (required for OAuth) */
  consumerSecret?: string;
  /** KV namespace for caching */
  cache?: KVNamespace;
  /** User agent string (required by Discogs API) */
  userAgent?: string;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface DiscogsPagination {
  page: number;
  pages: number;
  per_page: number;
  items: number;
  urls: {
    first?: string;
    last?: string;
    prev?: string;
    next?: string;
  };
}

export interface DiscogsArtist {
  name: string;
  anv: string;
  join: string;
  role: string;
  tracks: string;
  id: number;
  resource_url: string;
}

export interface DiscogsFormat {
  name: string;
  qty: string;
  text?: string;
  descriptions?: string[];
}

export interface DiscogsLabel {
  name: string;
  catno: string;
  entity_type: string;
  entity_type_name: string;
  id: number;
  resource_url: string;
}

export interface DiscogsBasicInformation {
  id: number;
  master_id: number | null;
  master_url: string | null;
  resource_url: string;
  thumb: string;
  cover_image: string;
  title: string;
  year: number;
  formats: DiscogsFormat[];
  artists: DiscogsArtist[];
  labels: DiscogsLabel[];
  genres: string[];
  styles: string[];
}

export interface DiscogsCollectionRelease {
  id: number;
  instance_id: number;
  date_added: string;
  rating: number;
  basic_information: DiscogsBasicInformation;
  folder_id: number;
}

export interface DiscogsCollectionResponse {
  pagination: DiscogsPagination;
  releases: DiscogsCollectionRelease[];
}

export interface DiscogsMasterRelease {
  id: number;
  main_release: number;
  most_recent_release: number;
  resource_url: string;
  uri: string;
  versions_url: string;
  main_release_url: string;
  most_recent_release_url: string;
  num_for_sale: number;
  lowest_price: number | null;
  images: Array<{
    type: string;
    uri: string;
    resource_url: string;
    uri150: string;
    width: number;
    height: number;
  }>;
  genres: string[];
  styles: string[];
  year: number;
  tracklist: Array<{
    position: string;
    type_: string;
    title: string;
    duration: string;
  }>;
  artists: DiscogsArtist[];
  title: string;
  data_quality: string;
  videos?: Array<{
    uri: string;
    title: string;
    description: string;
    duration: number;
    embed: boolean;
  }>;
}

export interface DiscogsIdentity {
  id: number;
  username: string;
  resource_url: string;
  consumer_name: string;
}

// ============================================================================
// Normalized Types (for storage/display)
// ============================================================================

export interface NormalizedRelease {
  id: number;
  instanceId: number;
  title: string;
  artist: string;
  artistId: number;
  year: number | null;
  originalYear: number | null;
  format: string;
  formatDetails: string[];
  label: string;
  catalogNumber: string;
  genres: string[];
  styles: string[];
  masterGenres: string[];
  masterStyles: string[];
  imageUrl: string;
  thumbUrl: string;
  discogsUrl: string;
  dateAdded: string;
  rating: number;
  masterId: number | null;
  masterEnriched: boolean;
}

export interface CollectionStats {
  totalItems: number;
  uniqueGenres: string[];
  uniqueFormats: string[];
  uniqueStyles: string[];
  uniqueArtists: number;
  earliestYear: number | null;
  latestYear: number | null;
  lastAdded: string | null;
  genreCounts: Record<string, number>;
  formatCounts: Record<string, number>;
  decadeCounts: Record<string, number>;
  artistCounts: Record<string, number>;
}

export interface CollectionCache {
  userId: string;
  discogsUsername: string;
  lastSynced: string;
  releaseCount: number;
  releases: NormalizedRelease[];
  stats: CollectionStats;
}

// ============================================================================
// Sync Types
// ============================================================================

export interface SyncResult {
  success: boolean;
  releaseCount: number;
  newReleases: number;
  enrichmentQueued: number;
  error?: string;
}

export interface EnrichmentResult {
  processed: number;
  remaining: number;
  errors: number;
}

// ============================================================================
// Rate Limiting
// ============================================================================

export interface RateLimitInfo {
  remaining: number;
  limit: number;
  resetAt: Date | null;
}
