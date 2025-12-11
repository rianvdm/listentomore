// Discogs collection enrichment - fetches master release data for original year, genres, styles
// Handles rate limiting (60 req/min) and batch processing for large collections

import { DiscogsCollection } from './collection';
import type { NormalizedRelease, CollectionCache, EnrichmentResult } from './types';
import { CACHE_CONFIG, getTtlSeconds } from '@listentomore/config';

// Process in small batches to stay well under rate limit
const BATCH_SIZE = 50;
// Delay between requests (1100ms = ~54 req/min, safe margin under 60)
const REQUEST_DELAY_MS = 1100;
// Save progress every N releases to avoid losing work
const SAVE_INTERVAL = 25;

export interface EnrichmentProgress {
  userId: string;
  total: number;
  processed: number;
  enriched: number;
  skipped: number;
  errors: number;
  startedAt: string;
  lastUpdatedAt: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  currentRelease?: string;
}

export class DiscogsEnrichment {
  private collection: DiscogsCollection;
  private cache: KVNamespace;

  constructor(collection: DiscogsCollection, cache: KVNamespace) {
    this.collection = collection;
    this.cache = cache;
  }

  /**
   * Get enrichment progress for a user
   */
  async getProgress(userId: string): Promise<EnrichmentProgress | null> {
    const key = `discogs:enrichment:progress:${userId}`;
    return this.cache.get(key, 'json') as Promise<EnrichmentProgress | null>;
  }

  /**
   * Check how many releases need enrichment
   */
  async getEnrichmentNeeded(userId: string): Promise<{
    total: number;
    needsEnrichment: number;
    alreadyEnriched: number;
    noMasterId: number;
  }> {
    const cacheKey = `discogs:collection:${userId}`;
    const cached = await this.cache.get(cacheKey, 'json') as CollectionCache | null;

    if (!cached) {
      return { total: 0, needsEnrichment: 0, alreadyEnriched: 0, noMasterId: 0 };
    }

    let needsEnrichment = 0;
    let alreadyEnriched = 0;
    let noMasterId = 0;

    for (const release of cached.releases) {
      if (!release.masterId) {
        noMasterId++;
      } else if (release.masterEnriched) {
        alreadyEnriched++;
      } else {
        needsEnrichment++;
      }
    }

    return {
      total: cached.releases.length,
      needsEnrichment,
      alreadyEnriched,
      noMasterId,
    };
  }

  /**
   * Enrich a batch of releases with master release data
   * Returns after processing one batch (for use with waitUntil or scheduled jobs)
   */
  async enrichBatch(
    userId: string,
    maxItems: number = BATCH_SIZE
  ): Promise<EnrichmentResult> {
    const cacheKey = `discogs:collection:${userId}`;
    const progressKey = `discogs:enrichment:progress:${userId}`;

    // Load current collection
    const cached = await this.cache.get(cacheKey, 'json') as CollectionCache | null;
    if (!cached) {
      return { processed: 0, remaining: 0, errors: 0 };
    }

    // Find releases that need enrichment
    const needsEnrichment = cached.releases.filter(
      (r) => r.masterId && !r.masterEnriched
    );

    if (needsEnrichment.length === 0) {
      // Clear progress if complete
      await this.cache.delete(progressKey);
      return { processed: 0, remaining: 0, errors: 0 };
    }

    // Initialize or update progress
    let progress = await this.getProgress(userId);
    if (!progress || progress.status === 'completed') {
      progress = {
        userId,
        total: needsEnrichment.length,
        processed: 0,
        enriched: 0,
        skipped: 0,
        errors: 0,
        startedAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        status: 'running',
      };
    } else {
      progress.status = 'running';
      progress.lastUpdatedAt = new Date().toISOString();
    }

    // Process batch
    const batch = needsEnrichment.slice(0, maxItems);
    let enrichedCount = 0;
    let errorCount = 0;
    let saveCounter = 0;

    // Create a map for quick lookup
    const releaseMap = new Map(cached.releases.map((r) => [r.id, r]));

    for (const release of batch) {
      progress.currentRelease = `${release.artist} - ${release.title}`;
      progress.lastUpdatedAt = new Date().toISOString();

      try {
        const master = await this.collection.getMasterRelease(release.masterId!);

        if (master) {
          // Update the release in our map
          const existing = releaseMap.get(release.id);
          if (existing) {
            existing.originalYear = master.year || null;
            existing.masterGenres = master.genres || [];
            existing.masterStyles = master.styles || [];
            existing.masterEnriched = true;
          }
          enrichedCount++;
          progress.enriched++;
        } else {
          // Mark as enriched even if master not found (to avoid retrying)
          const existing = releaseMap.get(release.id);
          if (existing) {
            existing.masterEnriched = true;
          }
          progress.skipped++;
        }
      } catch (error) {
        console.error(`Failed to enrich release ${release.id}:`, error);
        errorCount++;
        progress.errors++;
        // Don't mark as enriched so we can retry later
      }

      progress.processed++;
      saveCounter++;

      // Save progress periodically
      if (saveCounter >= SAVE_INTERVAL) {
        await this.saveProgress(progress, progressKey);
        await this.saveCollection(cached, releaseMap, cacheKey);
        saveCounter = 0;
      }

      // Rate limit delay (skip for last item)
      if (batch.indexOf(release) < batch.length - 1) {
        await this.sleep(REQUEST_DELAY_MS);
      }
    }

    // Final save
    await this.saveCollection(cached, releaseMap, cacheKey);

    // Update progress status
    const remaining = needsEnrichment.length - batch.length;
    progress.status = remaining === 0 ? 'completed' : 'running';
    progress.currentRelease = undefined;
    await this.saveProgress(progress, progressKey);

    // Recalculate stats with enriched data
    if (remaining === 0) {
      const updatedReleases = Array.from(releaseMap.values());
      cached.stats = this.collection.calculateStats(updatedReleases);
      await this.cache.put(cacheKey, JSON.stringify(cached), {
        expirationTtl: getTtlSeconds(CACHE_CONFIG.discogs.collection),
      });
    }

    return {
      processed: batch.length,
      remaining,
      errors: errorCount,
    };
  }

  /**
   * Save updated collection to cache
   */
  private async saveCollection(
    cached: CollectionCache,
    releaseMap: Map<number, NormalizedRelease>,
    cacheKey: string
  ): Promise<void> {
    cached.releases = Array.from(releaseMap.values());
    await this.cache.put(cacheKey, JSON.stringify(cached), {
      expirationTtl: getTtlSeconds(CACHE_CONFIG.discogs.collection),
    });
  }

  /**
   * Save enrichment progress
   */
  private async saveProgress(
    progress: EnrichmentProgress,
    progressKey: string
  ): Promise<void> {
    await this.cache.put(progressKey, JSON.stringify(progress), {
      expirationTtl: 86400, // 24 hours
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
