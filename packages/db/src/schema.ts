// Database schema type definitions for ListenToMore D1 database

export interface User {
  id: string;
  username: string | null;
  email: string | null;
  lastfm_username: string | null;
  discogs_username: string | null;
  spotify_connected: number;
  created_at: string;
  updated_at: string;
}

export interface Search {
  id: string;
  user_id: string;
  search_type: 'album' | 'artist';
  query: string;
  result_id: string | null;
  result_name: string | null;
  result_artist: string | null;
  searched_at: string;
}

export interface RecentSearch {
  id: string;
  spotify_id: string;
  album_name: string;
  artist_name: string;
  image_url: string | null;
  searched_at: string;
}

export type DiscogsSyncStatus = 'idle' | 'syncing' | 'enriching' | 'error';

export interface DiscogsSyncState {
  id: string;
  user_id: string;
  last_full_sync: string | null;
  last_enrichment_sync: string | null;
  current_page: number;
  total_pages: number;
  enrichment_cursor: number;
  status: DiscogsSyncStatus;
  error_message: string | null;
  updated_at: string;
}

export interface DiscogsRelease {
  id: number;
  user_id: string;
  instance_id: number | null;
  title: string;
  artist: string;
  year: number | null;
  original_year: number | null;
  format: string | null;
  label: string | null;
  genres: string | null; // JSON array
  styles: string | null; // JSON array
  master_genres: string | null; // JSON array
  master_styles: string | null; // JSON array
  image_url: string | null;
  discogs_url: string | null;
  date_added: string | null;
  rating: number | null;
  master_id: number | null;
  master_enriched: number;
  created_at: string;
  updated_at: string;
}

export interface RateLimit {
  service: 'discogs' | 'spotify' | 'openai' | 'perplexity';
  requests_remaining: number;
  window_reset_at: string | null;
  updated_at: string;
}

// OAuth token storage for connected services
export type OAuthProvider = 'discogs' | 'spotify';

export interface OAuthToken {
  id: string;
  user_id: string;
  provider: OAuthProvider;
  access_token_encrypted: string;
  refresh_token_encrypted: string | null; // For OAuth 1.0a, stores token secret
  token_type: string;
  scope: string | null;
  expires_at: string | null;
  provider_user_id: string | null;
  provider_username: string | null;
  created_at: string;
  updated_at: string;
}

// API Key types
export type ApiKeyTier = 'public' | 'standard' | 'premium';
export type ApiKeyScope = 'read' | 'write' | 'ai';

export interface ApiKey {
  id: string;
  user_id: string | null;
  key_hash: string;
  key_prefix: string;
  name: string;
  tier: ApiKeyTier;
  scopes: string; // JSON array of ApiKeyScope
  rate_limit_rpm: number | null;
  request_count: number;
  last_used_at: string | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

export interface ApiUsageLog {
  id: number;
  api_key_id: string | null;
  endpoint: string;
  method: string;
  status_code: number | null;
  ip_address: string | null;
  user_agent: string | null;
  response_time_ms: number | null;
  created_at: string;
}

// Parsed API key with scopes as array
export interface ParsedApiKey extends Omit<ApiKey, 'scopes'> {
  scopes: ApiKeyScope[];
}

// Parse scopes from ApiKey
export function parseApiKey(key: ApiKey): ParsedApiKey {
  return {
    ...key,
    scopes: key.scopes ? JSON.parse(key.scopes) : ['read'],
  };
}

// Default rate limits per tier (requests per minute)
export const TIER_RATE_LIMITS: Record<ApiKeyTier, number> = {
  public: 10,    // Very limited for anonymous access
  standard: 60,  // Normal authenticated access
  premium: 300,  // High-volume access
};

// Helper types for parsed JSON fields
export interface ParsedDiscogsRelease extends Omit<DiscogsRelease, 'genres' | 'styles' | 'master_genres' | 'master_styles'> {
  genres: string[];
  styles: string[];
  master_genres: string[];
  master_styles: string[];
}

// Parse JSON array fields from DiscogsRelease
export function parseDiscogsRelease(release: DiscogsRelease): ParsedDiscogsRelease {
  return {
    ...release,
    genres: release.genres ? JSON.parse(release.genres) : [],
    styles: release.styles ? JSON.parse(release.styles) : [],
    master_genres: release.master_genres ? JSON.parse(release.master_genres) : [],
    master_styles: release.master_styles ? JSON.parse(release.master_styles) : [],
  };
}
