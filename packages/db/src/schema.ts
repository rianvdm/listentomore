// Database schema type definitions for ListenToMore D1 database

export interface User {
  id: string;
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
