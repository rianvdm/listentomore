// ABOUTME: Pure helpers for scripts/cached-summaries.ts: audit flags and refresh outcomes for cached AI
// ABOUTME: summaries, Spotify exact-name matching, cache key parsing, wrangler.toml lookup and backfill SQL.

import { FALLBACK_RESPONSE_PATTERN, isCacheableResponse } from '@listentomore/ai';
import type { EntityPageType } from '@listentomore/db';

export type SummaryTask = 'albumDetail' | 'artistSummary' | 'genreSummary' | 'albumRecommendations';

export const SUMMARY_TASKS: readonly SummaryTask[] = [
  'albumDetail',
  'albumRecommendations',
  'artistSummary',
  'genreSummary',
];

export type AuditFlag =
  | 'empty'
  | 'not-enough-information'
  | 'short'
  | 'no-final-punctuation'
  | 'unbalanced-markdown'
  | 'error-text';

/** Album tasks key on artist and album; the others on a single name. */
const ALBUM_TASKS = new Set<SummaryTask>(['albumDetail', 'albumRecommendations']);

/** Shortest healthy entry, in characters of trimmed text. */
const LENGTH_FLOOR: Record<SummaryTask, number> = {
  albumDetail: 200,
  artistSummary: 200,
  genreSummary: 200,
  albumRecommendations: 100,
};

const FINAL_PUNCTUATION = new Set(['.', '!', '?', ')', '"', "'", '*', '_', ']', '}']);

// Whole-word matches, so names like "Reign of Terror" do not count as error text.
const ERROR_TEXT_PATTERN = /\b(errors?|unable to|i cannot|as an ai)\b/i;

// The shared fallback pattern only matches at the start; an audit also wants
// the phrase when the model buried it after a preamble.
const NOT_ENOUGH_INFORMATION_PATTERN = /not enough information available/i;

function countOf(text: string, token: string): number {
  return text.split(token).length - 1;
}

/**
 * Signs that a cached summary is truncated, empty or junk. Empty text gets
 * only the 'empty' flag, since every other check would also fire on it.
 */
export function auditFlags(task: SummaryTask, text: string): AuditFlag[] {
  const trimmed = text.trim();
  if (!trimmed) return ['empty'];

  const flags: AuditFlag[] = [];
  if (FALLBACK_RESPONSE_PATTERN.test(trimmed) || NOT_ENOUGH_INFORMATION_PATTERN.test(trimmed)) {
    flags.push('not-enough-information');
  }
  if (trimmed.length < LENGTH_FLOOR[task]) {
    flags.push('short');
  }
  if (!FINAL_PUNCTUATION.has(trimmed[trimmed.length - 1])) {
    flags.push('no-final-punctuation');
  }
  if (
    countOf(trimmed, '**') % 2 !== 0 ||
    countOf(trimmed, '[[') !== countOf(trimmed, ']]') ||
    countOf(trimmed, '{{') !== countOf(trimmed, '}}')
  ) {
    flags.push('unbalanced-markdown');
  }
  if (ERROR_TEXT_PATTERN.test(trimmed)) {
    flags.push('error-text');
  }
  return flags;
}

const normalize = (name: string): string => name.toLowerCase().trim();

/**
 * The Spotify ID of the first result whose names equal the wanted ones after
 * lowercasing and trimming. With an album, both album and artist must match;
 * without one, the result name is compared with the artist.
 */
export function pickSpotifyMatch(
  wanted: { artist: string; album?: string },
  results: Array<{ id: string; name: string; artist?: string }>
): string | null {
  const artist = normalize(wanted.artist);
  const album = wanted.album === undefined ? undefined : normalize(wanted.album);

  const match = results.find((r) =>
    album === undefined
      ? normalize(r.name) === artist
      : normalize(r.name) === album && r.artist !== undefined && normalize(r.artist) === artist
  );
  return match?.id ?? null;
}

/**
 * Split a summary cache key built by aiCacheKey back into its task and names.
 * Album keys split at the first colon after the task, so an artist name with a
 * colon parses wrongly; the backfill then finds no exact match and logs it.
 */
export function parseSummaryKey(key: string): { task: SummaryTask; names: string[] } | null {
  const match = /^ai:([^:]+):(.*)$/s.exec(key);
  if (!match) return null;
  const task = SUMMARY_TASKS.find((t) => t === match[1]);
  if (!task) return null;
  const rest = match[2];

  if (!ALBUM_TASKS.has(task)) {
    return rest ? { task, names: [rest] } : null;
  }
  const colon = rest.indexOf(':');
  if (colon <= 0 || colon === rest.length - 1) return null;
  return { task, names: [rest.slice(0, colon), rest.slice(colon + 1)] };
}

/** The text field of a stored entry: `summary` for artists, `content` otherwise. */
export function summaryText(task: SummaryTask, value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const field = task === 'artistSummary' ? 'summary' : 'content';
  const text = (value as Record<string, unknown>)[field];
  return typeof text === 'string' ? text : null;
}

export type RefreshDecision =
  | { outcome: 'refresh'; body: string }
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'failed'; reason: string };

/**
 * What the refresh does with one stored value, given its raw KV text. A value the app could not
 * have written (not JSON, no text field, empty text) is 'failed', so the run exits non-zero instead
 * of reporting success while an approved summary was never refreshed. 'skipped' is reserved for
 * isCacheableResponse refusing the text: a refresh is a cache write, so it obeys the app's rule.
 */
export function classifyRefreshValue(task: SummaryTask, key: string, raw: string): RefreshDecision {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { outcome: 'failed', reason: 'not valid JSON' };
  }
  const text = summaryText(task, value);
  if (text === null) return { outcome: 'failed', reason: 'missing its text field' };
  if (text.trim() === '') return { outcome: 'failed', reason: 'empty text' };
  if (!isCacheableResponse(text, undefined, task, key)) {
    return { outcome: 'skipped', reason: 'refused by isCacheableResponse' };
  }
  return { outcome: 'refresh', body: JSON.stringify(value) };
}

/**
 * The production id of the CACHE KV namespace from wrangler.toml. A minimal
 * reader for the [[kv_namespaces]] tables, which hold flat `key = "value"` lines.
 */
export function cacheNamespaceId(toml: string): string {
  const tables = toml.split(/^\s*\[/m);
  for (const table of tables) {
    if (!table.startsWith('[kv_namespaces]]')) continue;
    const value = (name: string): string | undefined =>
      new RegExp(`^\\s*${name}\\s*=\\s*"([^"]*)"`, 'm').exec(table)?.[1];
    const id = value('id');
    if (value('binding') === 'CACHE' && id) return id;
  }
  throw new Error('No [[kv_namespaces]] entry with binding = "CACHE" and an id in wrangler.toml');
}

/** A SQL string literal with single quotes doubled. */
export function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** One backfill row; INSERT OR IGNORE keeps any row the live app already wrote. */
export function entityPageInsert(row: { cacheKey: string; type: EntityPageType; path: string }): string {
  return (
    'INSERT OR IGNORE INTO entity_pages (cache_key, type, path) VALUES ' +
    `(${sqlString(row.cacheKey)}, ${sqlString(row.type)}, ${sqlString(row.path)});`
  );
}
