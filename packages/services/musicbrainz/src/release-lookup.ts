// ABOUTME: Album UPC lookup via MusicBrainz release search.
// ABOUTME: Searches for releases by artist + album name, extracts barcode (UPC/EAN).

import { CACHE_CONFIG, getTtlSeconds } from '@listentomore/config';
import { musicbrainzFetch } from './fetch';
import type {
  MusicBrainzReleaseSearchResponse,
  MusicBrainzRelease,
  MusicBrainzReleaseLookup,
} from './types';

const MIN_SCORE = 80;

/**
 * Escape special Lucene query characters for MusicBrainz search.
 * Characters: + - && || ! ( ) { } [ ] ^ " ~ * ? : \ /
 */
function escapeLucene(str: string): string {
  return str.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, '\\$&');
}

/**
 * Normalize a string for cache key generation.
 * Lowercases, trims, and removes non-alphanumeric chars.
 */
function normalizeForCacheKey(str: string): string {
  return str.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
}

/**
 * Search MusicBrainz for an album's UPC (barcode).
 *
 * Strategy:
 * 1. Search for releases matching artist + album name
 * 2. Filter to results with score >= 80
 * 3. Prefer results with barcodes already in the search response
 * 4. If best match has no barcode, do a follow-up lookup by MBID
 * 5. Cache the result for 30 days
 */
export async function lookupAlbumUpc(
  artist: string,
  album: string,
  cache: KVNamespace
): Promise<string | null> {
  const cacheKey = `musicbrainz:release:${normalizeForCacheKey(artist)}:${normalizeForCacheKey(album)}`;

  // Check cache (we cache the final UPC value, including null for "not found")
  const cached = await cache.get(cacheKey);
  if (cached !== null) {
    if (cached === '__null__') {
      console.log(`[MusicBrainz] Cache hit (no UPC): ${artist} - ${album}`);
      return null;
    }
    console.log(`[MusicBrainz] Cache hit: UPC ${cached} for ${artist} - ${album}`);
    return cached;
  }

  try {
    // Search for releases
    const query = `release:${escapeLucene(album)} AND artist:${escapeLucene(artist)}`;
    const encoded = encodeURIComponent(query);
    const response = await musicbrainzFetch(
      `/release/?query=${encoded}&fmt=json&limit=5`,
      cache
    );

    const data = (await response.json()) as MusicBrainzReleaseSearchResponse;

    if (!data.releases?.length) {
      console.log(`[MusicBrainz] No releases found for: ${artist} - ${album}`);
      await cacheResult(cache, cacheKey, null);
      return null;
    }

    // Filter to high-quality matches
    const goodMatches = data.releases.filter((r) => r.score >= MIN_SCORE);
    if (!goodMatches.length) {
      console.log(`[MusicBrainz] No releases with score >= ${MIN_SCORE} for: ${artist} - ${album}`);
      await cacheResult(cache, cacheKey, null);
      return null;
    }

    // Pick the best match: prefer Album type with barcode
    const bestMatch = pickBestRelease(goodMatches);

    if (bestMatch.barcode) {
      console.log(`[MusicBrainz] Found UPC in search: ${bestMatch.barcode} (score: ${bestMatch.score})`);
      await cacheResult(cache, cacheKey, bestMatch.barcode);
      return bestMatch.barcode;
    }

    // Best match has no barcode in search -- try a direct lookup
    console.log(`[MusicBrainz] No barcode in search result, looking up MBID: ${bestMatch.id}`);
    const upc = await lookupReleaseBarcode(bestMatch.id, cache);

    await cacheResult(cache, cacheKey, upc);
    return upc;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[MusicBrainz] Release lookup failed for ${artist} - ${album}:`, errorMessage);
    // Don't cache errors -- they might be transient
    return null;
  }
}

/**
 * Pick the best release from a list of search results.
 * Prefers: Album type > has barcode > highest score.
 */
function pickBestRelease(releases: MusicBrainzRelease[]): MusicBrainzRelease {
  return releases.sort((a, b) => {
    // Prefer Album primary type
    const aIsAlbum = a['release-group']?.['primary-type'] === 'Album' ? 1 : 0;
    const bIsAlbum = b['release-group']?.['primary-type'] === 'Album' ? 1 : 0;
    if (aIsAlbum !== bIsAlbum) return bIsAlbum - aIsAlbum;

    // Prefer results with barcodes
    const aHasBarcode = a.barcode ? 1 : 0;
    const bHasBarcode = b.barcode ? 1 : 0;
    if (aHasBarcode !== bHasBarcode) return bHasBarcode - aHasBarcode;

    // Higher score wins
    return b.score - a.score;
  })[0];
}

/**
 * Look up a release by MBID to get its barcode.
 */
async function lookupReleaseBarcode(
  mbid: string,
  cache: KVNamespace
): Promise<string | null> {
  try {
    const response = await musicbrainzFetch(`/release/${mbid}?fmt=json`, cache);
    const data = (await response.json()) as MusicBrainzReleaseLookup;

    if (data.barcode) {
      console.log(`[MusicBrainz] Found barcode via lookup: ${data.barcode}`);
      return data.barcode;
    }

    console.log(`[MusicBrainz] No barcode on release ${mbid}`);
    return null;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[MusicBrainz] Release barcode lookup failed for ${mbid}:`, errorMessage);
    return null;
  }
}

/**
 * Cache a UPC result (including null for "not found").
 */
async function cacheResult(
  cache: KVNamespace,
  cacheKey: string,
  upc: string | null
): Promise<void> {
  const ttl = getTtlSeconds(CACHE_CONFIG.musicbrainz.lookup);
  await cache.put(cacheKey, upc ?? '__null__', { expirationTtl: ttl });
}
