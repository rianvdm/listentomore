// Discogs service - collection fetching and management for ListenToMore

export { DiscogsClient } from './client';
export { DiscogsCollection } from './collection';
export { DiscogsEnrichment } from './enrichment';
export type { EnrichmentProgress } from './enrichment';
export { DiscogsOAuthService, encryptToken, decryptToken } from './oauth';
export type { DiscogsOAuthConfig, OAuthTokenPair } from './oauth';
export type * from './types';

import { DiscogsCollection } from './collection';
import { DiscogsEnrichment } from './enrichment';
import type { EnrichmentProgress } from './enrichment';
import type { DiscogsConfig, NormalizedRelease, CollectionStats, CollectionCache, EnrichmentResult } from './types';
import { CACHE_CONFIG, getTtlSeconds } from '@listentomore/config';

/**
 * Main Discogs service class - convenience wrapper around sub-services
 */
export class DiscogsService {
  public readonly collection: DiscogsCollection;
  public readonly enrichment: DiscogsEnrichment | null;
  private cache?: KVNamespace;
  private userId?: string;

  constructor(config: DiscogsConfig & { userId?: string }) {
    this.collection = new DiscogsCollection(config);
    this.cache = config.cache;
    this.userId = config.userId;
    // Enrichment requires cache
    this.enrichment = config.cache ? new DiscogsEnrichment(this.collection, config.cache) : null;
  }

  /**
   * Set the user ID for cache operations
   */
  setUserId(userId: string): void {
    this.userId = userId;
  }

  /**
   * Get cached collection for a user
   */
  async getCachedCollection(userId?: string): Promise<CollectionCache | null> {
    const id = userId || this.userId;
    if (!this.cache || !id) return null;

    const cacheKey = `discogs:collection:${id}`;
    return this.cache.get(cacheKey, 'json') as Promise<CollectionCache | null>;
  }

  /**
   * Sync collection from Discogs and cache it
   * Preserves enrichment data from previous sync, handles deletions automatically
   */
  async syncCollection(
    userId: string,
    discogsUsername: string,
    onProgress?: (current: number, total: number) => void
  ): Promise<CollectionCache & { deleted: number; added: number }> {
    // Set username for API calls
    this.collection.setUsername(discogsUsername);

    // Load existing cache to preserve enrichment data
    const existingCache = await this.getCachedCollection(userId);
    const existingReleasesMap = new Map(
      existingCache?.releases.map((r) => [r.id, r]) || []
    );
    const previousCount = existingCache?.releaseCount || 0;

    // Fetch all releases from Discogs API
    const freshReleases = await this.collection.getAllReleases(onProgress);

    // Track IDs for deletion detection
    const freshIds = new Set(freshReleases.map((r) => r.id));

    // Merge: preserve enrichment data from existing releases
    const mergedReleases = freshReleases.map((release) => {
      const existing = existingReleasesMap.get(release.id);
      if (existing && existing.masterEnriched) {
        // Preserve enrichment data
        return {
          ...release,
          originalYear: existing.originalYear,
          masterGenres: existing.masterGenres,
          masterStyles: existing.masterStyles,
          masterEnriched: existing.masterEnriched,
        };
      }
      return release;
    });

    // Count deletions (releases in old cache but not in fresh data)
    let deletedCount = 0;
    for (const [id] of existingReleasesMap) {
      if (!freshIds.has(id)) {
        deletedCount++;
      }
    }

    // Count additions (releases in fresh data but not in old cache)
    const addedCount = freshReleases.filter((r) => !existingReleasesMap.has(r.id)).length;

    if (deletedCount > 0 || addedCount > 0) {
      console.log(
        `[Discogs Sync] Changes detected: +${addedCount} added, -${deletedCount} deleted (was ${previousCount}, now ${mergedReleases.length})`
      );
    }

    // Calculate stats with merged data
    const stats = this.collection.calculateStats(mergedReleases);

    // Build cache object
    const cacheData: CollectionCache = {
      userId,
      discogsUsername,
      lastSynced: new Date().toISOString(),
      releaseCount: mergedReleases.length,
      releases: mergedReleases,
      stats,
    };

    // Store in cache
    if (this.cache) {
      const cacheKey = `discogs:collection:${userId}`;
      await this.cache.put(cacheKey, JSON.stringify(cacheData), {
        expirationTtl: getTtlSeconds(CACHE_CONFIG.discogs.collection),
      });
    }

    return { ...cacheData, deleted: deletedCount, added: addedCount };
  }

  /**
   * Get collection stats only (lighter weight than full collection)
   */
  async getCollectionStats(userId?: string): Promise<{
    lastSynced: string;
    releaseCount: number;
    stats: CollectionStats;
  } | null> {
    const cached = await this.getCachedCollection(userId);
    if (!cached) return null;

    return {
      lastSynced: cached.lastSynced,
      releaseCount: cached.releaseCount,
      stats: cached.stats,
    };
  }

  /**
   * Get releases with optional filtering
   */
  async getFilteredReleases(
    userId: string,
    filters?: {
      genre?: string;
      format?: string;
      decade?: string;
      style?: string;
      search?: string;
    }
  ): Promise<NormalizedRelease[]> {
    const cached = await this.getCachedCollection(userId);
    if (!cached) return [];

    let releases = cached.releases;

    if (filters) {
      if (filters.genre) {
        releases = releases.filter((r) => {
          const genres = r.masterGenres.length > 0 ? r.masterGenres : r.genres;
          return genres.includes(filters.genre!);
        });
      }

      if (filters.format) {
        releases = releases.filter((r) => r.format === filters.format);
      }

      if (filters.decade) {
        const decadeStart = parseInt(filters.decade.replace('s', ''), 10);
        releases = releases.filter((r) => {
          const year = r.originalYear || r.year;
          return year && year >= decadeStart && year < decadeStart + 10;
        });
      }

      if (filters.style) {
        releases = releases.filter((r) => {
          const styles = r.masterStyles.length > 0 ? r.masterStyles : r.styles;
          return styles.includes(filters.style!);
        });
      }

      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        releases = releases.filter(
          (r) =>
            r.title.toLowerCase().includes(searchLower) ||
            r.artist.toLowerCase().includes(searchLower) ||
            r.label.toLowerCase().includes(searchLower)
        );
      }
    }

    return releases;
  }

  /**
   * Get enrichment progress for a user
   */
  async getEnrichmentProgress(userId?: string): Promise<EnrichmentProgress | null> {
    const id = userId || this.userId;
    if (!this.enrichment || !id) return null;
    return this.enrichment.getProgress(id);
  }

  /**
   * Check how many releases need enrichment
   */
  async getEnrichmentNeeded(userId?: string): Promise<{
    total: number;
    needsEnrichment: number;
    alreadyEnriched: number;
    noMasterId: number;
  } | null> {
    const id = userId || this.userId;
    if (!this.enrichment || !id) return null;
    return this.enrichment.getEnrichmentNeeded(id);
  }

  /**
   * Enrich a batch of releases with master release data
   */
  async enrichBatch(userId?: string, maxItems?: number): Promise<EnrichmentResult | null> {
    const id = userId || this.userId;
    if (!this.enrichment || !id) return null;
    return this.enrichment.enrichBatch(id, maxItems);
  }
}
