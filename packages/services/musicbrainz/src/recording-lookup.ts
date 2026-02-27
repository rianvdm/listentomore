// ABOUTME: Track ISRC lookup via MusicBrainz recording search.
// ABOUTME: Searches for recordings by artist + track name, retrieves ISRCs.

import { CACHE_CONFIG, getTtlSeconds } from '@listentomore/config';
import { musicbrainzFetch } from './fetch';
import type {
  MusicBrainzRecordingSearchResponse,
  MusicBrainzRecording,
  MusicBrainzRecordingLookup,
} from './types';

const MIN_SCORE = 80;

/**
 * Escape special Lucene query characters for MusicBrainz search.
 */
function escapeLucene(str: string): string {
  return str.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, '\\$&');
}

/**
 * Normalize a string for cache key generation.
 */
function normalizeForCacheKey(str: string): string {
  return str.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
}

/**
 * Search MusicBrainz for a track's ISRC.
 *
 * Strategy:
 * 1. Search for recordings matching artist + track name
 * 2. Filter to results with score >= 80
 * 3. Look up the best match with ISRCs included
 * 4. Return the first ISRC found
 * 5. Cache the result for 30 days
 */
export async function lookupTrackIsrc(
  artist: string,
  track: string,
  cache: KVNamespace
): Promise<string | null> {
  const cacheKey = `musicbrainz:recording:${normalizeForCacheKey(artist)}:${normalizeForCacheKey(track)}`;

  // Check cache
  const cached = await cache.get(cacheKey);
  if (cached !== null) {
    if (cached === '__null__') {
      console.log(`[MusicBrainz] Cache hit (no ISRC): ${artist} - ${track}`);
      return null;
    }
    console.log(`[MusicBrainz] Cache hit: ISRC ${cached} for ${artist} - ${track}`);
    return cached;
  }

  try {
    // Search for recordings
    const query = `recording:${escapeLucene(track)} AND artist:${escapeLucene(artist)}`;
    const encoded = encodeURIComponent(query);
    const response = await musicbrainzFetch(
      `/recording/?query=${encoded}&fmt=json&limit=5`,
      cache
    );

    const data = (await response.json()) as MusicBrainzRecordingSearchResponse;

    if (!data.recordings?.length) {
      console.log(`[MusicBrainz] No recordings found for: ${artist} - ${track}`);
      await cacheResult(cache, cacheKey, null);
      return null;
    }

    // Filter to high-quality matches and sort by preference
    const goodMatches = data.recordings.filter((r) => r.score >= MIN_SCORE);
    if (!goodMatches.length) {
      console.log(`[MusicBrainz] No recordings with score >= ${MIN_SCORE} for: ${artist} - ${track}`);
      await cacheResult(cache, cacheKey, null);
      return null;
    }

    // Sort by preference (Album releases first, then highest score)
    const sortedMatches = sortRecordings(goodMatches);

    // Try each match until we find one with ISRCs
    // (not all MusicBrainz recordings have ISRCs, even for the same song)
    const MAX_ATTEMPTS = Math.min(sortedMatches.length, 3);
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const match = sortedMatches[i];
      console.log(`[MusicBrainz] Looking up recording ISRCs for MBID: ${match.id} (score: ${match.score}, attempt ${i + 1}/${MAX_ATTEMPTS})`);
      const isrc = await lookupRecordingIsrc(match.id, cache);
      if (isrc) {
        await cacheResult(cache, cacheKey, isrc);
        return isrc;
      }
    }

    console.log(`[MusicBrainz] No ISRCs found in ${MAX_ATTEMPTS} recordings for: ${artist} - ${track}`);
    await cacheResult(cache, cacheKey, null);
    return null;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[MusicBrainz] Recording lookup failed for ${artist} - ${track}:`, errorMessage);
    return null;
  }
}

/**
 * Sort recordings by preference.
 * Prefers: associated with Album release type, then highest score.
 */
function sortRecordings(recordings: MusicBrainzRecording[]): MusicBrainzRecording[] {
  return [...recordings].sort((a, b) => {
    // Prefer recordings from Album releases
    const aFromAlbum = a.releases?.some((r) => r['release-group']?.['primary-type'] === 'Album') ? 1 : 0;
    const bFromAlbum = b.releases?.some((r) => r['release-group']?.['primary-type'] === 'Album') ? 1 : 0;
    if (aFromAlbum !== bFromAlbum) return bFromAlbum - aFromAlbum;

    // Higher score wins
    return b.score - a.score;
  });
}

/**
 * Look up a recording by MBID with ISRCs included.
 */
async function lookupRecordingIsrc(
  mbid: string,
  cache: KVNamespace
): Promise<string | null> {
  try {
    const response = await musicbrainzFetch(
      `/recording/${mbid}?inc=isrcs&fmt=json`,
      cache
    );
    const data = (await response.json()) as MusicBrainzRecordingLookup;

    if (data.isrcs?.length) {
      console.log(`[MusicBrainz] Found ISRC: ${data.isrcs[0]} (${data.isrcs.length} total)`);
      return data.isrcs[0];
    }

    console.log(`[MusicBrainz] No ISRCs on recording ${mbid}`);
    return null;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[MusicBrainz] Recording ISRC lookup failed for ${mbid}:`, errorMessage);
    return null;
  }
}

/**
 * Cache an ISRC result (including null for "not found").
 */
async function cacheResult(
  cache: KVNamespace,
  cacheKey: string,
  isrc: string | null
): Promise<void> {
  const ttl = getTtlSeconds(CACHE_CONFIG.musicbrainz.lookup);
  await cache.put(cacheKey, isrc ?? '__null__', { expirationTtl: ttl });
}
