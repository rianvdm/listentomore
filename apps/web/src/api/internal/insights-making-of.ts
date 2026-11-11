// ABOUTME: The making-of fact for the insights card: one cited albumTrivia fact per album, checked with the copy
// ABOUTME: rubric and regenerated once, cached globally as the fact for 120 days or as none for 30 (spec section 1).

import { CACHE_CONFIG, getTtlSeconds } from '@listentomore/config';
import { isCacheableResponse } from '@listentomore/ai';
import type { AIResponseMetadata, AIService, AlbumTriviaResult } from '@listentomore/ai';
import { checkCopyRubric, keys, stripEdition } from '@listentomore/insights';
import { errorKind } from '../../utils/error-kind';

/** One regeneration after a rubric failure, then no card (spec section 1, "Making-of fallback"). */
const TRIVIA_ATTEMPTS = 2;

export type MakingOfResult =
  | { status: 'found'; text: string; sourceUrl: string; calls: AIResponseMetadata[] }
  | { status: 'none' | 'error'; calls: AIResponseMetadata[] };

/**
 * Web search error codes that say something about this request, not the service: the search budget ran out
 * (max_uses_exceeded) or the model's query was bad. A NONE after one is a genuine "could not verify". Every other
 * code (too_many_requests, unavailable, anything new) is treated as transient.
 */
const NON_TRANSIENT_SEARCH_ERRORS: ReadonlySet<string> = new Set(['max_uses_exceeded', 'invalid_input', 'query_too_long']);

function hasTransientSearchError(metadata: AIResponseMetadata | undefined): boolean {
  return (metadata?.features?.webSearchErrors ?? []).some((code) => !NON_TRANSIENT_SEARCH_ERRORS.has(code));
}

/** The cache entry under `keys.trivia`: a checked, cited fact, or the record that the album has none. */
type CachedTrivia = { text: string; sourceUrl: string } | { none: true };

function isCachedTrivia(value: unknown): value is CachedTrivia {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return entry.none === true || (typeof entry.text === 'string' && typeof entry.sourceUrl === 'string');
}

const plural = (n: number): string => (n === 1 ? '' : 's');

async function readCached(kv: KVNamespace, key: string): Promise<CachedTrivia | null> {
  try {
    const value: unknown = await kv.get(key, 'json');
    return isCachedTrivia(value) ? value : null;
  } catch (error) {
    console.error('[Insights making-of] Cache read failed:', errorKind(error));
    return null;
  }
}

async function writeCached(kv: KVNamespace, key: string, entry: CachedTrivia): Promise<void> {
  const ttl = 'none' in entry ? CACHE_CONFIG.albumTrivia.none : CACHE_CONFIG.albumTrivia.fact;
  try {
    // KV directly, not AICache: AICache's log lines carry the key, and this key holds the names.
    await kv.put(key, JSON.stringify(entry), { expirationTtl: getTtlSeconds(ttl) });
  } catch (error) {
    console.error('[Insights making-of] Cache write failed:', errorKind(error));
  }
}

/**
 * The making-of fact for one album, asked and cached for the original record: an edition suffix ('(Remastered
 * 2026)') is dropped from the title first, so every edition shares one entry. A cached fact or none is served
 * without a model call. On a miss, up to
 * TRIVIA_ATTEMPTS albumTrivia calls: a cited fact that passes the copy rubric is cached as found, NONE or an answer
 * with no https citation is cached as none at once, a fact that trips the rubric spends the next attempt, and a
 * second rubric failure is cached as none. A thrown call or an uncacheable reply (truncated, refused, still paused,
 * empty) returns error and writes nothing, so the next owner view tries again. So does any none outcome when an
 * attempt hit a transient web search error: the NONE may come from the outage, and caching it would hide the card
 * for every listener for 30 days. Log lines carry the outcome and the attempt count only: no names, fact text or
 * source URL.
 */
export async function makingOfFact(
  ai: AIService,
  kv: KVNamespace,
  artist: string,
  album: string
): Promise<MakingOfResult> {
  const title = stripEdition(album);
  // keys.trivia drops the suffix itself, so this is the same key for every edition.
  const key = keys.trivia(artist, album);
  const calls: AIResponseMetadata[] = [];
  let transientSearchError = false;

  // A none outcome is cached, unless a transient search failure may have caused it.
  const settleNone = async (attempts: number, reason: string): Promise<MakingOfResult> => {
    if (transientSearchError) {
      console.log(`[Insights making-of] error after ${attempts} attempt${plural(attempts)}: ${reason}, web search failed`);
      return { status: 'error', calls };
    }
    await writeCached(kv, key, { none: true });
    console.log(`[Insights making-of] none after ${attempts} attempt${plural(attempts)}: ${reason}`);
    return { status: 'none', calls };
  };

  const cached = await readCached(kv, key);
  if (cached) {
    return 'none' in cached
      ? { status: 'none', calls }
      : { status: 'found', text: cached.text, sourceUrl: cached.sourceUrl, calls };
  }

  for (let attempt = 1; attempt <= TRIVIA_ATTEMPTS; attempt++) {
    let result: AlbumTriviaResult;
    try {
      result = await ai.getAlbumTrivia(artist, title);
    } catch (error) {
      console.error(`[Insights making-of] error on attempt ${attempt}: call failed (${errorKind(error)})`);
      return { status: 'error', calls };
    }
    if (result.metadata) calls.push(result.metadata);

    if (!isCacheableResponse(result.raw, result.metadata, 'albumTrivia')) {
      console.log(`[Insights making-of] error on attempt ${attempt}: uncacheable reply`);
      return { status: 'error', calls };
    }

    transientSearchError ||= hasTransientSearchError(result.metadata);

    if (result.text === null || result.sourceUrl === null) {
      return settleNone(attempt, result.text === null ? 'no fact' : 'no https citation');
    }

    if (checkCopyRubric(result.text, [artist, title, album]).length === 0) {
      await writeCached(kv, key, { text: result.text, sourceUrl: result.sourceUrl });
      console.log(`[Insights making-of] found after ${attempt} attempt${plural(attempt)}`);
      return { status: 'found', text: result.text, sourceUrl: result.sourceUrl, calls };
    }
  }

  return settleNone(TRIVIA_ATTEMPTS, 'copy rubric');
}
