// Centralized cache configuration for all services

export const CACHE_CONFIG = {
  // AI-generated content (expensive to regenerate)
  ai: {
    artistSummary: { ttlDays: 180 },
    albumDetail: { ttlDays: 120 },
    genreSummary: { ttlDays: 180 },
    artistSentence: { ttlDays: 180 },
  },

  // External API data (changes occasionally)
  spotify: {
    search: { ttlDays: 30 },
    album: { ttlDays: 30 },
    artist: { ttlDays: 30 },
    token: { ttlMinutes: 55 }, // Tokens expire in 60 min
  },

  lastfm: {
    artistDetail: { ttlDays: 7 },
    topAlbums: { ttlHours: 1 },
    topArtists: { ttlHours: 1 },
    recentTracks: { ttlMinutes: 0 }, // No caching - always live
    lovedTracks: { ttlHours: 1 },
  },

  discogs: {
    collection: { ttlHours: 8 },
    master: { ttlDays: 90 },
  },

  songlink: {
    links: { ttlDays: 30 },
  },

  // HTTP cache headers for responses
  http: {
    static: { maxAge: 86400, staleWhileRevalidate: 43200 }, // 1 day
    dynamic: { maxAge: 300, staleWhileRevalidate: 60 }, // 5 min
    realtime: { maxAge: 60, staleWhileRevalidate: 30 }, // 1 min
    noCache: { maxAge: 0, staleWhileRevalidate: 0 },
  },
} as const;

type CacheConfigValue =
  | { ttlDays: number }
  | { ttlHours: number }
  | { ttlMinutes: number }
  | { maxAge: number; staleWhileRevalidate: number };

/**
 * Convert any TTL config to seconds
 */
export function getTtlSeconds(config: CacheConfigValue): number {
  if ('ttlDays' in config) return config.ttlDays * 24 * 60 * 60;
  if ('ttlHours' in config) return config.ttlHours * 60 * 60;
  if ('ttlMinutes' in config) return config.ttlMinutes * 60;
  if ('maxAge' in config) return config.maxAge;
  return 0;
}

/**
 * Get HTTP cache header string
 */
export function getCacheHeader(
  type: keyof typeof CACHE_CONFIG.http
): string {
  const config = CACHE_CONFIG.http[type];
  if (config.maxAge === 0) {
    return 'no-cache, no-store, must-revalidate';
  }
  return `public, max-age=${config.maxAge}, stale-while-revalidate=${config.staleWhileRevalidate}`;
}
