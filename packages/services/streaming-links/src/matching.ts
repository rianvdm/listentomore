// String matching utilities for streaming link resolution

/**
 * Calculate Levenshtein distance between two strings
 */
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  // Initialize matrix
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }

  // Fill in the matrix
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[a.length][b.length];
}

/**
 * Calculate similarity between two strings (0-1, where 1 is identical)
 */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;

  // Normalize strings for comparison
  const normA = normalizeString(a);
  const normB = normalizeString(b);

  if (normA === normB) return 1;
  if (normA.length === 0 || normB.length === 0) return 0;

  const distance = levenshteinDistance(normA, normB);
  const maxLength = Math.max(normA.length, normB.length);

  return 1 - distance / maxLength;
}

/**
 * Decode common HTML entities that appear in API responses (e.g., YouTube)
 */
function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#38;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/**
 * Normalize a string for comparison
 * - Decode HTML entities
 * - Lowercase
 * - Remove special characters
 * - Normalize whitespace
 * - Remove common suffixes (remaster, deluxe, etc.)
 */
export function normalizeString(str: string): string {
  return (
    decodeHtmlEntities(str)
      .toLowerCase()
      // Remove content in parentheses/brackets (remaster notes, etc.)
      .replace(/\s*[\(\[][^\)\]]*[\)\]]\s*/g, ' ')
      // Remove special characters except spaces
      .replace(/[^\w\s]/g, '')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Extract year from a date string
 */
export function extractYear(dateStr: string | undefined): number {
  if (!dateStr) return 0;
  const match = dateStr.match(/(\d{4})/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Calculate track confidence score
 */
export function calculateTrackConfidence(
  source: {
    artists: string[];
    name: string;
    durationMs: number;
    album?: string;
  },
  result: {
    artistName: string;
    trackName: string;
    trackTimeMillis?: number;
    collectionName?: string;
  }
): number {
  const weights = {
    artist: 0.35,
    track: 0.35,
    duration: 0.2,
    album: 0.1,
  };

  let score = 0;

  // Artist similarity (use primary artist)
  const artistSim = similarity(source.artists[0] || '', result.artistName || '');
  score += weights.artist * artistSim;

  // Track name similarity
  const trackSim = similarity(source.name, result.trackName || '');
  score += weights.track * trackSim;

  // Duration match (within 5 seconds = 1.0, within 30 seconds = 0.5)
  if (source.durationMs && result.trackTimeMillis) {
    const durationDiff = Math.abs(source.durationMs - result.trackTimeMillis);
    if (durationDiff < 5000) {
      score += weights.duration * 1.0;
    } else if (durationDiff < 30000) {
      score += weights.duration * 0.5;
    }
  }

  // Album match (bonus, not required)
  if (source.album && result.collectionName) {
    const albumSim = similarity(source.album, result.collectionName);
    score += weights.album * albumSim;
  }

  return score;
}

/**
 * Calculate album confidence score
 */
export function calculateAlbumConfidence(
  source: {
    artists: string[];
    name: string;
    totalTracks?: number;
    releaseYear?: number;
  },
  result: {
    artistName: string;
    albumName: string;
    trackCount?: number;
    releaseYear?: number;
  }
): number {
  const weights = {
    artist: 0.4,
    album: 0.4,
    trackCount: 0.1,
    releaseYear: 0.1,
  };

  let score = 0;

  // Artist similarity
  const artistSim = similarity(source.artists[0] || '', result.artistName || '');
  score += weights.artist * artistSim;

  // Album name similarity
  const albumSim = similarity(source.name, result.albumName || '');
  score += weights.album * albumSim;

  // Track count match (within 2 = 1.0, within 5 = 0.5)
  if (source.totalTracks && result.trackCount) {
    const trackDiff = Math.abs(source.totalTracks - result.trackCount);
    if (trackDiff <= 2) {
      score += weights.trackCount * 1.0;
    } else if (trackDiff <= 5) {
      score += weights.trackCount * 0.5;
    }
  }

  // Release year match
  if (source.releaseYear && result.releaseYear && source.releaseYear === result.releaseYear) {
    score += weights.releaseYear * 1.0;
  }

  return score;
}
