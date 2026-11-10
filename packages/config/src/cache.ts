// Centralized cache configuration for all services

export const CACHE_CONFIG = {
  // NOTE: AI cache TTLs are defined in packages/config/src/ai.ts (AI_TASKS[task].cacheTtlDays)
  // Do not add AI cache config here - use ai.ts for all AI-related caching

  // External API data (changes occasionally)
  spotify: {
    search: { ttlDays: 30 },
    album: { ttlDays: 30 },
    artist: { ttlDays: 30 },
    token: { ttlMinutes: 55 }, // Tokens expire in 60 min
  },

  lastfm: {
    artistDetail: { ttlDays: 30 },
    topAlbums: { ttlHours: 1 },
    topArtists: { ttlHours: 1 },
    recentTracks: { ttlMinutes: 0 }, // No caching - always live
    lovedTracks: { ttlHours: 1 },
    userListens: { ttlMinutes: 7 }, // Aggregated recent listens for home page (cron pre-warms every 5 min)
    userRecommendations: { ttlHours: 6 }, // Personalized artist recommendations
    userInfo: { ttlDays: 30 }, // User profile info (avatar, playcount, etc)
    // Insights history inputs (packages/services/insights/src/collect.ts)
    scrobbleDay: { ttlDays: 40 }, // One completed UTC day of a user's scrobbles; immutable, the current day is never cached
    weeklyChart: { ttlDays: 40 }, // One ended weekly artist chart for a user; immutable
    periodList: { ttlHours: 24 }, // A user's 3, 6 or 12 month top artists
    overallList: { ttlDays: 7 }, // A user's overall top artists
    userArtistCount: { ttlHours: 24 }, // A user's lifetime plays of one artist; never under the global artistDetail key
    albumTracklist: { ttlDays: 30 }, // Global album tracklist, no user data
    userAlbumCount: { ttlHours: 24 }, // A user's plays of one album, kept apart from the global tracklist
    artistTopTags: { ttlDays: 30 }, // Global artist top tags
  },

  userInsights: {
    refreshCooldown: { ttlMinutes: 5 }, // Rate limit for refresh button
    weekFacts: { ttlHours: 24 }, // The computed WeekFacts object for a user
    note: { ttlDays: 8 }, // A guarded note, and the pointer to the note last served to the owner
    generatingMarker: { ttlMinutes: 1 }, // Marks a generation in progress; KV's minimum TTL is 60 seconds
    questionState: { ttlDays: 60 }, // The owner's last question, for rotation
  },

  discogs: {
    collection: { ttlHours: 8 },
    master: { ttlDays: 90 },
  },

  songlink: {
    links: { ttlDays: 30 },
  },

  streamingLinks: {
    links: { ttlDays: 30 }, // Music metadata rarely changes
  },

  musicbrainz: {
    lookup: { ttlDays: 30 }, // ISRCs/UPCs never change once assigned
  },

  // /lookup name → Spotify ID results. Misses expire sooner so new releases resolve within a day.
  lookup: {
    hit: { ttlDays: 30 },
    miss: { ttlDays: 1 },
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
