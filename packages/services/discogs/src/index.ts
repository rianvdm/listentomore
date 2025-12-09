// Discogs service - collection fetching and management for ListenToMore

export { DiscogsClient } from './client';
export { DiscogsCollection } from './collection';
export type * from './types';

import { DiscogsCollection } from './collection';
import type { DiscogsConfig, NormalizedRelease, CollectionStats, CollectionCache } from './types';
import { CACHE_CONFIG, getTtlSeconds } from '@listentomore/config';

/**
 * Main Discogs service class - convenience wrapper around sub-services
 */
export class DiscogsService {
  public readonly collection: DiscogsCollection;
  private cache?: KVNamespace;
  private userId?: string;

  constructor(config: DiscogsConfig & { userId?: string }) {
    this.collection = new DiscogsCollection(config);
    this.cache = config.cache;
    this.userId = config.userId;
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
   */
  async syncCollection(
    userId: string,
    discogsUsername: string,
    onProgress?: (current: number, total: number) => void
  ): Promise<CollectionCache> {
    // Set username for API calls
    this.collection.setUsername(discogsUsername);

    // Fetch all releases
    const releases = await this.collection.getAllReleases(onProgress);

    // Calculate stats
    const stats = this.collection.calculateStats(releases);

    // Build cache object
    const cacheData: CollectionCache = {
      userId,
      discogsUsername,
      lastSynced: new Date().toISOString(),
      releaseCount: releases.length,
      releases,
      stats,
    };

    // Store in cache
    if (this.cache) {
      const cacheKey = `discogs:collection:${userId}`;
      await this.cache.put(cacheKey, JSON.stringify(cacheData), {
        expirationTtl: getTtlSeconds(CACHE_CONFIG.discogs.collection),
      });
    }

    return cacheData;
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
}
