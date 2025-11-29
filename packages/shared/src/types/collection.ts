// Types for Discogs collection data

export interface CollectionRelease {
  id: number; // Discogs release ID
  instanceId: number;
  title: string;
  artist: string;
  year: number | null;
  originalYear: number | null;
  format: string;
  label: string | null;
  genres: string[];
  styles: string[];
  masterGenres: string[];
  masterStyles: string[];
  imageUrl: string | null;
  discogsUrl: string;
  dateAdded: string;
  rating: number | null;
  masterId: number | null;
  masterEnriched: boolean;
}

export interface CollectionStats {
  totalReleases: number;
  uniqueGenres: string[];
  uniqueStyles: string[];
  uniqueFormats: string[];
  releasesByDecade: Record<string, number>;
  topArtists: Array<{ name: string; count: number }>;
  lastUpdated: string;
}

export interface SyncState {
  status: 'idle' | 'syncing' | 'enriching' | 'error';
  currentPage: number;
  totalPages: number;
  enrichmentCursor: number;
  lastFullSync: string | null;
  lastEnrichmentSync: string | null;
  errorMessage: string | null;
}
