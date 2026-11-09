// ABOUTME: Name-based /lookup route: resolves an artist (and optional album) name to a Spotify ID and redirects to its page.
// ABOUTME: Strict matching with a KV result cache and referral click counting; any doubt or failure redirects to search.

import type { Context } from 'hono';
import { CACHE_CONFIG, getTtlSeconds } from '@listentomore/config';
import type { Database } from '@listentomore/db';
import { createServiceDefer, isSpotifyId } from '@listentomore/shared';
import type { Defer } from '@listentomore/shared';
import type { SpotifyService } from '@listentomore/spotify';
import { normalizeName, pickAlbumMatch, pickArtistMatch, stripEdition } from '../utils/lookup-match';
import { isBotRequest, readRef } from '../utils/referral';
import { getWaitUntil } from '../utils/wait-until';

const MAX_NAME_LENGTH = 300;
const CANDIDATE_LIMIT = 10;
const CACHE_KEY_PREFIX = 'lookup:v1';
// Workers KV rejects keys longer than 512 bytes; longer lookups skip the cache.
const KV_MAX_KEY_BYTES = 512;

type LookupType = 'album' | 'artist';

/** What the lookup cache stores: a resolved Spotify ID, or a remembered miss. */
type CachedLookup = { id: string } | { miss: true };

/** A resolved Spotify ID, or null for a miss. */
type Resolution = string | null;

interface CloudflareBotSignal {
  botManagement?: { verifiedBot?: boolean };
}

/**
 * The lookup-cache key on the full normalized names, so "Rumours" and "Rumours (Super Deluxe)"
 * are separate entries. Null when the key is too long for KV and the result goes uncached.
 */
function lookupCacheKey(artist: string, album: string | null): string | null {
  const key =
    album === null
      ? `${CACHE_KEY_PREFIX}:artist:${normalizeName(artist)}`
      : `${CACHE_KEY_PREFIX}:album:${normalizeName(artist)}|${normalizeName(album)}`;
  return new TextEncoder().encode(key).length <= KV_MAX_KEY_BYTES ? key : null;
}

/**
 * Reads a cached resolution: a valid ID, null for a cached miss (including an ID that fails
 * the Spotify ID check), or undefined when nothing usable is cached or the read fails.
 */
async function readLookupCache(cache: KVNamespace, key: string): Promise<Resolution | undefined> {
  let cached: unknown;
  try {
    cached = await cache.get(key, 'json');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Lookup] Cache read failed, resolving with Spotify:', errorMessage, error);
    return undefined;
  }

  if (typeof cached !== 'object' || cached === null) return undefined;
  if ('miss' in cached && cached.miss === true) return null;
  if ('id' in cached) {
    return typeof cached.id === 'string' && isSpotifyId(cached.id) ? cached.id : null;
  }
  return undefined;
}

/** Stores a resolution off the response path; a failed write is logged by `defer`. */
function writeLookupCache(cache: KVNamespace, key: string, resolution: Resolution, defer: Defer): void {
  const value: CachedLookup = resolution === null ? { miss: true } : { id: resolution };
  const ttl = getTtlSeconds(resolution === null ? CACHE_CONFIG.lookup.miss : CACHE_CONFIG.lookup.hit);
  // Async wrapper so a synchronous throw from the binding becomes a logged rejection.
  const write = async (): Promise<void> => {
    await cache.put(key, JSON.stringify(value), { expirationTtl: ttl });
  };
  defer(write(), 'lookup cache write');
}

/** Spotify field filters cannot escape quotes, so they are dropped from the names. */
function fieldFilterQuery(artist: string, album: string): string {
  const unquote = (name: string) => name.replace(/"/g, '');
  return `artist:"${unquote(artist)}" album:"${unquote(album)}"`;
}

/** Tries field filters, then field filters without edition suffixes, then a natural query. */
async function findAlbumId(spotify: SpotifyService, artist: string, album: string): Promise<Resolution> {
  const queries = [fieldFilterQuery(artist, album)];
  const baseTitle = stripEdition(album);
  if (baseTitle && baseTitle !== album) {
    queries.push(fieldFilterQuery(artist, baseTitle));
  }
  queries.push(`${artist} ${album}`);

  for (const query of queries) {
    const candidates = await spotify.searchAlbumCandidates(query, CANDIDATE_LIMIT);
    const match = pickAlbumMatch(candidates, artist, album);
    if (match) return isSpotifyId(match.id) ? match.id : null;
  }
  return null;
}

async function findArtistId(spotify: SpotifyService, artist: string): Promise<Resolution> {
  const candidates = await spotify.searchArtistCandidates(artist, CANDIDATE_LIMIT);
  const match = pickArtistMatch(candidates, artist);
  return match && isSpotifyId(match.id) ? match.id : null;
}

/**
 * GET /lookup?artist=<name>[&album=<name>][&ref=<ref>]
 * Redirects to /album/<id> or /artist/<id> on a strict match, otherwise to the search page.
 */
export async function handleLookup(c: Context): Promise<Response> {
  // Every response, including 400s, stays out of indexes and shared caches.
  c.header('X-Robots-Tag', 'noindex');
  c.header('Cache-Control', 'no-store');

  const artist = c.req.query('artist')?.trim() ?? '';
  const album = c.req.query('album')?.trim() || null;
  if (!artist) return c.text('Missing artist', 400);
  if (artist.length > MAX_NAME_LENGTH || (album?.length ?? 0) > MAX_NAME_LENGTH) {
    return c.text('Name too long', 400);
  }

  const type: LookupType = album === null ? 'artist' : 'album';
  const ref = readRef(c.req.queries('ref'));
  const defer = createServiceDefer('[Lookup]', getWaitUntil(c));
  const cache = c.env.CACHE as KVNamespace;
  const spotify = c.get('spotify') as SpotifyService;

  const resolve = async (): Promise<Resolution> => {
    // A name made only of punctuation cannot be matched strictly.
    if (!normalizeName(artist) || (album !== null && !normalizeName(album))) return null;

    const key = lookupCacheKey(artist, album);
    if (key) {
      const cached = await readLookupCache(cache, key);
      if (cached !== undefined) return cached;
    }

    let resolution: Resolution;
    try {
      resolution = album === null ? await findArtistId(spotify, artist) : await findAlbumId(spotify, artist, album);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[Lookup] Spotify search failed, redirecting to search:', errorMessage, error);
      return null;
    }

    if (key) writeLookupCache(cache, key, resolution, defer);
    return resolution;
  };

  const spotifyId = await resolve();

  if (ref) {
    const db = c.get('db') as Database;
    const cf = (c.req.raw as { cf?: unknown }).cf as CloudflareBotSignal | undefined;
    defer(
      db.recordReferralClick({
        ref,
        type,
        matched: spotifyId !== null,
        signedIn: Boolean(c.get('currentUser')),
        isBot: isBotRequest(c.req.header('User-Agent'), cf),
      }),
      'referral click',
    );
  }

  if (spotifyId !== null) {
    return c.redirect(`/${type}/${spotifyId}${ref ? `?ref=${ref}` : ''}`, 302);
  }
  const searchQuery = album === null ? artist : `${artist} ${album}`;
  return c.redirect(`/${type}?q=${encodeURIComponent(searchQuery)}`, 302);
}
