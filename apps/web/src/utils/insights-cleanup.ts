// ABOUTME: Deletes one user's per-user KV data on account deletion: the insights families from @listentomore/insights
// ABOUTME: and the older per-user Last.fm caches (user info, top lists, loved tracks, artist detail with a play count).

import { userExactKeys, userKeyPrefixes } from '@listentomore/insights';

/**
 * Exact keys outside @listentomore/insights. `lastfm:userInfo` is keyed on the lower-cased name
 * (packages/services/lastfm/src/user-info.ts).
 */
function lastfmExactKeys(lower: string): string[] {
  return [`lastfm:userInfo:${lower}`];
}

/**
 * Prefixes outside @listentomore/insights. The per-user artist detail is keyed on the lower-cased
 * name (artist-detail.ts). Top artists, top albums and loved tracks are keyed on the username as the
 * LastfmService was given it (top-artists.ts, top-albums.ts, loved-tracks.ts), which is usually the
 * stored `lastfm_username`, so both spellings are cleared. Each ends in ':' so 'alice' never
 * matches 'alice2'.
 */
function lastfmPrefixes(lower: string, names: string[]): string[] {
  return [
    `lastfm:userArtistDetail:${lower}:`,
    ...names.flatMap((name) => [
      `lastfm:topartists:${name}:`,
      `lastfm:topalbums:${name}:`,
      `lastfm:lovedtracks:${name}:`,
    ]),
  ];
}

/** Lists every key under a prefix, one page at a time, and deletes them all. */
async function deleteListed(kv: KVNamespace, prefix: string): Promise<number> {
  let deleted = 0;
  let cursor: string | undefined;
  for (;;) {
    const page = await kv.list({ prefix, cursor });
    const names = page.keys.map((k) => k.name);
    await Promise.all(names.map((name) => kv.delete(name)));
    deleted += names.length;
    if (page.list_complete) return deleted;
    cursor = page.cursor;
  }
}

/**
 * Deletes every per-user cache key of one Last.fm user and returns how many existed.
 *
 * Exact keys are deleted by exact match, never by prefix ('insights:facts:alice' is a prefix of
 * 'insights:facts:alice2'). Prefix families are listed with cursor pagination. The global
 * `lastfm:artistDetail:<artist>` family is never listed or touched.
 *
 * Throws if KV fails; the caller decides whether that blocks the rest of the deletion.
 */
export async function deleteUserInsightsData(kv: KVNamespace, lastfmUsername: string): Promise<number> {
  const lower = lastfmUsername.toLowerCase();
  const names = [...new Set([lower, lastfmUsername])];
  let deleted = 0;

  // Every exact key is deleted; the read only decides whether it counts, so a stale read never skips one.
  for (const key of [...userExactKeys(lower), ...lastfmExactKeys(lower)]) {
    const existed = (await kv.get(key)) !== null;
    await kv.delete(key);
    if (existed) deleted++;
  }

  for (const prefix of [...userKeyPrefixes(lower), ...lastfmPrefixes(lower, names)]) {
    deleted += await deleteListed(kv, prefix);
  }

  return deleted;
}
