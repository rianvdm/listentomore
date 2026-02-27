// ABOUTME: MusicBrainz API response types for release and recording lookups.
// ABOUTME: Covers search results and individual entity lookups with ISRCs.

/** A single release (album) from MusicBrainz search results */
export interface MusicBrainzRelease {
  id: string;
  score: number;
  title: string;
  'artist-credit'?: Array<{
    name: string;
    artist: {
      id: string;
      name: string;
    };
  }>;
  date?: string;
  barcode?: string;
  'release-group'?: {
    id: string;
    'primary-type'?: string;
    'secondary-types'?: string[];
  };
  status?: string;
  country?: string;
}

/** Response from MusicBrainz release search endpoint */
export interface MusicBrainzReleaseSearchResponse {
  created: string;
  count: number;
  offset: number;
  releases: MusicBrainzRelease[];
}

/** A single release lookup (for barcode retrieval) */
export interface MusicBrainzReleaseLookup {
  id: string;
  title: string;
  barcode?: string;
  date?: string;
  'artist-credit'?: Array<{
    name: string;
    artist: {
      id: string;
      name: string;
    };
  }>;
}

/** A single recording from MusicBrainz search results */
export interface MusicBrainzRecording {
  id: string;
  score: number;
  title: string;
  'artist-credit'?: Array<{
    name: string;
    artist: {
      id: string;
      name: string;
    };
  }>;
  releases?: Array<{
    id: string;
    title: string;
    'release-group'?: {
      'primary-type'?: string;
    };
  }>;
  length?: number;
}

/** Response from MusicBrainz recording search endpoint */
export interface MusicBrainzRecordingSearchResponse {
  created: string;
  count: number;
  offset: number;
  recordings: MusicBrainzRecording[];
}

/** Recording lookup response with ISRCs included */
export interface MusicBrainzRecordingLookup {
  id: string;
  title: string;
  isrcs?: string[];
  'artist-credit'?: Array<{
    name: string;
    artist: {
      id: string;
      name: string;
    };
  }>;
}
