// ABOUTME: Resolves the ?spotifyId= query parameter of an internal AI route into Spotify metadata.
// ABOUTME: Keeps artist and album names out of URLs, where the zone WAF can misread them as SQL injection.

import type { Context } from 'hono';
import { isSpotifyId } from '@listentomore/shared';
import type { InternalAppContext } from '../../types';

/** Either the resolved value or the HTTP response to return instead. */
export type LookupResult<T> = { ok: true; value: T } | { ok: false; response: Response };

export type ResolvedAlbum = {
  artist: string;
  name: string;
  releaseYear: number | undefined;
};

export type ResolvedArtist = {
  name: string;
};

/**
 * Validates the spotifyId query parameter. Returns the ID, or a 400 response.
 */
function readSpotifyId(c: Context<InternalAppContext>): LookupResult<string> {
  const id = c.req.query('spotifyId');
  if (!id) {
    return { ok: false, response: c.json({ error: 'Missing spotifyId parameter' }, 400) };
  }
  if (!isSpotifyId(id)) {
    return { ok: false, response: c.json({ error: 'Invalid spotifyId parameter' }, 400) };
  }
  return { ok: true, value: id };
}

/**
 * Turns a Spotify "not found" failure into a 404 and anything else into a 502.
 */
function lookupFailure(c: Context<InternalAppContext>, kind: 'album' | 'artist', error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  if (/not found/i.test(message)) {
    return c.json({ error: `Spotify ${kind} not found` }, 404);
  }
  console.error(`Internal ${kind} lookup error:`, error);
  return c.json({ error: `Failed to load ${kind} from Spotify` }, 502);
}

/**
 * Loads the album behind ?spotifyId= from the Spotify service. The album page
 * has already fetched the same album, so this is normally a KV cache hit.
 */
export async function resolveSpotifyAlbum(c: Context<InternalAppContext>): Promise<LookupResult<ResolvedAlbum>> {
  const read = readSpotifyId(c);
  if (!read.ok) {
    return read;
  }

  try {
    const album = await c.get('spotify').getAlbum(read.value);
    if (!album) {
      return { ok: false, response: c.json({ error: 'Spotify album not found' }, 404) };
    }
    const year = parseInt(album.releaseDate?.split('-')[0] ?? '', 10);
    return {
      ok: true,
      value: {
        artist: album.artist,
        name: album.name,
        releaseYear: Number.isFinite(year) ? year : undefined,
      },
    };
  } catch (error) {
    return { ok: false, response: lookupFailure(c, 'album', error) };
  }
}

/**
 * Loads the artist behind ?spotifyId= from the Spotify service (normally a KV cache hit).
 */
export async function resolveSpotifyArtist(c: Context<InternalAppContext>): Promise<LookupResult<ResolvedArtist>> {
  const read = readSpotifyId(c);
  if (!read.ok) {
    return read;
  }

  try {
    const artist = await c.get('spotify').getArtist(read.value);
    if (!artist) {
      return { ok: false, response: c.json({ error: 'Spotify artist not found' }, 404) };
    }
    return { ok: true, value: { name: artist.name } };
  } catch (error) {
    return { ok: false, response: lookupFailure(c, 'artist', error) };
  }
}
