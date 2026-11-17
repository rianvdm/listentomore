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

export type RetiredPrefix = (typeof RETIRED_PREFIXES)[number];

export type WranglerOperation = 'list' | 'bulk delete';

/** A Node error code such as ENOENT or ERR_CHILD_PROCESS_STDIO_MAXBUFFER. */
const NODE_ERROR_CODE = /^E[A-Z0-9_]+$/;
const SIGNAL_NAME = /^SIG[A-Z0-9]+$/;

/** The exit status of an execFile rejection, as a fixed token, or null when there isn't one. */
export function exitStatus(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code, signal } = error as { code?: unknown; signal?: unknown };
  if (typeof code === 'number' && Number.isInteger(code)) return `exit code ${code}`;
  if (typeof signal === 'string' && SIGNAL_NAME.test(signal)) return `signal ${signal}`;
  if (typeof code === 'string' && NODE_ERROR_CODE.test(code)) return code;
  return null;
}

/**
 * The message to report when a wrangler call fails. Wrangler's stdout, stderr
 * and the error message can quote API responses that contain key names, which
 * hold usernames and artist names, so the message carries only the operation,
 * the prefix and the exit status.
 */
export function wranglerFailureMessage(
  operation: WranglerOperation,
  prefix: RetiredPrefix,
  error: unknown
): string {
  return `wrangler ${operation} failed for ${prefix} (${exitStatus(error) ?? 'unknown status'})`;
}

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
