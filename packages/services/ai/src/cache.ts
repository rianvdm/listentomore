// AI response cache layer using Cloudflare KV

import { getCacheTtlSeconds, type AITask } from '@listentomore/config';

export interface CacheOptions {
  /** Override the default TTL for this cache entry */
  ttlSeconds?: number;
}

/**
 * Build the KV key for an AI task. Params are lowercased and trimmed, so
 * "OK Computer " and "ok computer" share one entry.
 */
export function aiCacheKey(task: AITask, ...params: string[]): string {
  const normalizedParams = params.map((p) => p.toLowerCase().trim());
  return `ai:${task}:${normalizedParams.join(':')}`;
}

export class AICache {
  constructor(private kv: KVNamespace) {}

  /**
   * Get a cached response
   */
  async get<T>(task: AITask, ...params: string[]): Promise<T | null> {
    const key = aiCacheKey(task, ...params);
    const cached = await this.kv.get(key, 'json');
    if (cached) {
      console.log(`[AICache] Hit for ${key}`);
    }
    return cached as T | null;
  }

  /**
   * Store a response in the cache
   */
  async set<T>(
    task: AITask,
    params: string[],
    value: T,
    options?: CacheOptions
  ): Promise<void> {
    const key = aiCacheKey(task, ...params);
    const ttl = options?.ttlSeconds ?? getCacheTtlSeconds(task);

    // Don't cache if TTL is 0 (e.g., randomFact)
    if (ttl === 0) {
      console.log(`[AICache] Skipping cache for ${key} (TTL=0)`);
      return;
    }

    await this.kv.put(key, JSON.stringify(value), { expirationTtl: ttl });
    console.log(`[AICache] Stored ${key} with TTL ${ttl}s`);
  }

  /**
   * Delete a cached response
   */
  async delete(task: AITask, ...params: string[]): Promise<void> {
    const key = aiCacheKey(task, ...params);
    await this.kv.delete(key);
    console.log(`[AICache] Deleted ${key}`);
  }
}
