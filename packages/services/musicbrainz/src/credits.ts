// ABOUTME: Budgeted MusicBrainz credits client: release lookup by artist and album, release credits, band links.
// ABOUTME: Results and misses are cached globally in KV; each network call counts against a per-instance cap.

import { CACHE_CONFIG, getTtlSeconds } from '@listentomore/config';
import { MusicBrainzApiError, MusicBrainzRateLimitError } from './errors';
import { musicbrainzFetch } from './fetch';
import { pickReleaseGroup, pickEarliestOfficial, parseReleaseCredits, parseArtistBands } from './credits-parse';
import type { MusicBrainzRateLimiter } from './rate-limit';
import type { ArtistBands, CreditsClient, ReleaseCredits, ReleaseRef } from './credits-types';

/** Cloudflare KV rejects keys longer than this. */
const MAX_KEY_BYTES = 512;

/** The wait before the one retry after a 503 or 429, when Retry-After is absent or longer than RETRY_AFTER_MAX_MS. */
export const RETRY_DEFAULT_MS = 2000;
/** The longest Retry-After the retry honours. */
export const RETRY_AFTER_MAX_MS = 5000;

/** Cached in place of a value when MusicBrainz has nothing usable, so the lookup is not repeated. */
const MISS = { miss: true } as const;

/** Thrown before a network call that would exceed the instance's `maxCalls`. */
export class CreditsCapReached extends Error {
  constructor() {
    super('MusicBrainz credits call cap reached');
    this.name = 'CreditsCapReached';
  }
}

/**
 * Escape special Lucene query characters for MusicBrainz search.
 * Characters: + - && || ! ( ) { } [ ] ^ " ~ * ? : \ /
 */
function escapeLucene(str: string): string {
  return str.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, '\\$&');
}

/** One key segment from a name: NFKC, lower case, trimmed, then URI-encoded. */
function seg(name: string): string {
  return encodeURIComponent(name.normalize('NFKC').toLowerCase().trim());
}

/** KV keys for the global credits caches. Values hold no user data. */
export const creditsKeys = {
  releaseGroup: (artist: string, album: string): string => `musicbrainz:credits:rg:${seg(artist)}:${seg(album)}`,
  release: (releaseId: string): string => `musicbrainz:credits:release:${encodeURIComponent(releaseId)}`,
  artist: (artistId: string): string => `musicbrainz:credits:artist:${encodeURIComponent(artistId)}`,
};

function isMiss(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { miss?: unknown }).miss === true;
}

/** The wait before retrying, or null when the error is not a 503 or 429 from MusicBrainz. */
function retryDelay(error: unknown): number | null {
  const retryable = (error instanceof MusicBrainzRateLimitError && error.reason === 'upstream_503')
    || (error instanceof MusicBrainzApiError && error.status === 429);
  if (!retryable) return null;
  const after = error.retryAfterMs;
  return after !== null && after <= RETRY_AFTER_MAX_MS ? after : RETRY_DEFAULT_MS;
}

/**
 * MusicBrainz credits lookups for one request.
 *
 * Cache reads are free. Before each network call the client throws `CreditsCapReached`
 * once `calls` has reached `maxCalls` (`Infinity` lifts the cap). Every call takes a
 * limiter slot, and redirects are never followed. A 503 or 429 is retried once, after the
 * response's Retry-After when that is at most 5 s and after 2 s otherwise; the retry counts
 * against the cap and takes its own slot. A 404 on an entity lookup is a miss and is cached
 * as one; every other error, including a second 503 or 429 and a declined limiter slot,
 * passes through and is never cached. Nothing here logs a name or a request URL.
 */
export class MusicBrainzCredits implements CreditsClient {
  private callCount = 0;
  private readonly maxCalls: number;

  constructor(
    private readonly cache: KVNamespace,
    private readonly limiter: MusicBrainzRateLimiter,
    options: { maxCalls: number }
  ) {
    this.maxCalls = options.maxCalls;
  }

  get calls(): number {
    return this.callCount;
  }

  /**
   * Find the release group for an artist and album, and its earliest official release.
   * Two calls when uncached. No matching group, or a group with no official release, is a miss.
   */
  async findRelease(artist: string, album: string): Promise<ReleaseRef | null> {
    if (!artist.trim() || !album.trim()) return null;

    return this.cached(creditsKeys.releaseGroup(artist, album), async () => {
      const query = `releasegroup:"${escapeLucene(album.trim())}" AND artist:"${escapeLucene(artist.trim())}"`;
      const search = await this.fetchJson(`/release-group/?query=${encodeURIComponent(query)}&fmt=json&limit=5`);
      const releaseGroupId = pickReleaseGroup(search, album);
      if (!releaseGroupId) return null;

      const group = await this.fetchEntity(`/release-group/${encodeURIComponent(releaseGroupId)}?inc=releases&fmt=json`);
      if (group === null) return null;
      const releaseId = pickEarliestOfficial(group);
      return releaseId ? { releaseGroupId, releaseId } : null;
    });
  }

  /** Read a release's album artists and credits. One call when uncached. */
  async releaseCredits(releaseId: string): Promise<ReleaseCredits | null> {
    if (!releaseId) return null;

    return this.cached(creditsKeys.release(releaseId), async () => {
      const release = await this.fetchEntity(
        `/release/${encodeURIComponent(releaseId)}?inc=artist-credits+recordings+artist-rels+recording-level-rels&fmt=json`
      );
      if (release === null) return null;
      const parsed = parseReleaseCredits(release);
      return parsed.releaseId ? parsed : null;
    });
  }

  /** Read an artist's `member of band` links. One call when uncached. */
  async artistBands(artistId: string): Promise<ArtistBands | null> {
    if (!artistId) return null;

    return this.cached(creditsKeys.artist(artistId), async () => {
      const artist = await this.fetchEntity(`/artist/${encodeURIComponent(artistId)}?inc=artist-rels&fmt=json`);
      if (artist === null) return null;
      const parsed = parseArtistBands(artist);
      return parsed.artist.id ? parsed : null;
    });
  }

  /**
   * Serve from KV, or load and cache the result: a value under `credits`, null as a miss
   * under `creditsMiss`. A load that throws caches nothing. Keys over KV's limit skip the cache.
   */
  private async cached<T>(key: string, load: () => Promise<T | null>): Promise<T | null> {
    const cacheable = new TextEncoder().encode(key).length <= MAX_KEY_BYTES;

    if (cacheable) {
      const hit = await this.cache.get<T | typeof MISS>(key, 'json');
      if (hit !== null) return isMiss(hit) ? null : (hit as T);
    }

    const value = await load();

    if (cacheable) {
      const ttl = getTtlSeconds(value === null ? CACHE_CONFIG.musicbrainz.creditsMiss : CACHE_CONFIG.musicbrainz.credits);
      try {
        await this.cache.put(key, JSON.stringify(value ?? MISS), { expirationTtl: ttl });
      } catch (error) {
        // The data is in hand, so a failed write only costs a later call. Log the error's
        // class alone: a KV message could echo the key, and rg keys carry names.
        console.warn('[MusicBrainz] Credits cache write failed:', error instanceof Error ? error.name : 'unknown');
      }
    }

    return value;
  }

  /**
   * One budgeted network call, with the one retry. The endpoint may carry names, so its URL is never logged.
   * Redirects are not followed: an automatic hop would be a second request outside the cap
   * and the limiter, so a 3xx fails like any other HTTP error.
   */
  private async fetchJson(endpoint: string): Promise<unknown> {
    try {
      return await this.fetchOnce(endpoint);
    } catch (error) {
      const delay = retryDelay(error);
      if (delay === null) throw error;
      console.warn(`[MusicBrainz] Credits call retry in ${delay}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return this.fetchOnce(endpoint);
    }
  }

  /** One request: checks and counts against the cap, then takes a limiter slot. */
  private async fetchOnce(endpoint: string): Promise<unknown> {
    if (this.callCount >= this.maxCalls) {
      throw new CreditsCapReached();
    }
    this.callCount += 1;

    const response = await musicbrainzFetch(endpoint, this.limiter, { logUrl: false, followRedirects: false });
    return response.json();
  }

  /** An entity lookup by MBID: a 404 means the entity is gone and reads as null, a miss to cache. */
  private async fetchEntity(endpoint: string): Promise<unknown> {
    try {
      return await this.fetchJson(endpoint);
    } catch (error) {
      if (error instanceof MusicBrainzApiError && error.status === 404) return null;
      throw error;
    }
  }
}
