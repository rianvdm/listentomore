// ABOUTME: Pure helpers for scripts/delete-retired-insights-keys.ts: the retired insights and
// ABOUTME: MusicBrainz credits KV prefixes, and parsing a `wrangler kv key list` reply.

/**
 * KV key families that lost their reader and writer when the insights card,
 * the MusicBrainz credits client and the note's closing question were removed.
 * Each ends in a colon so a prefix never matches a longer family name.
 */
export const RETIRED_PREFIXES = [
  'insights:question:',
  'insights:card:',
  'insights:trivia:',
  'musicbrainz:credits:',
] as const;

/**
 * The key names in a `wrangler kv key list` reply. Wrangler can print errors
 * to stdout, so anything other than a JSON array of objects with a string
 * `name` throws rather than reading as an empty or partial list.
 */
export function parseKeyList(stdout: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error('wrangler kv key list did not return JSON');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('wrangler kv key list did not return a JSON array');
  }
  return parsed.map((entry: unknown) => {
    const name = (entry as { name?: unknown } | null)?.name;
    if (typeof name !== 'string') {
      throw new Error('wrangler kv key list returned an entry without a string name');
    }
    return name;
  });
}
