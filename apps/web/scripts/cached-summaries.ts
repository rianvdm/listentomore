// ABOUTME: One-off launch tooling for public cached summaries: audits cached AI summaries in production KV,
// ABOUTME: deletes approved entries and refreshes the rest's expiry, and backfills D1 entity_pages via Spotify.
//
// Usage (from apps/web):
//   pnpm dlx tsx scripts/cached-summaries.ts audit
//   pnpm dlx tsx scripts/cached-summaries.ts refresh --approve <keys.json> [--yes]
//   pnpm dlx tsx scripts/cached-summaries.ts backfill [--dev-vars <path>] [--yes]
//
// audit is read-only. It prints a Markdown table (key, task, write date,
// flags) to stdout, progress to stderr, and writes eval-output/cached-summaries-audit.json.
// The write date is derived from the KV expiry minus the task's current TTL.
//
// refresh reads a JSON array of keys to delete, deletes them, then re-puts
// every other albumDetail, albumRecommendations, artistSummary and
// genreSummary entry with its current value and a fresh TTL from
// getCacheTtlSeconds(task). Without --yes it only prints what it would do.
// An entry that is not JSON, lacks its text field or has empty text counts as
// failed, and any failure makes the run exit non-zero.
// A list of flagged keys to edit into an approve file:
//   jq '[.[] | select(.flags | length > 0) | .key]' eval-output/cached-summaries-audit.json
//
// backfill maps albumDetail and artistSummary keys to Spotify IDs by exact
// name match and writes eval-output/entity-pages-backfill.sql (INSERT OR
// IGNORE rows) and eval-output/entity-pages-backfill-unmatched.json. It runs
// the SQL against remote D1 only with --yes, which needs migration 009
// (entity_pages) applied first. Spotify client credentials come from
// --dev-vars (default apps/web/.dev.vars); process.env is not consulted.
//
// Every KV and D1 call shells out to `npx wrangler ... --remote`, so these
// commands act on production.

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { aiCacheKey } from '@listentomore/ai';
import { getCacheTtlSeconds } from '@listentomore/config';
import type { EntityPageType } from '@listentomore/db';
import {
  SUMMARY_TASKS,
  auditFlags,
  cacheNamespaceId,
  classifyRefreshValue,
  entityPageInsert,
  parseSummaryKey,
  pickSpotifyMatch,
  summaryText,
} from './cached-summaries-lib';
import type { SummaryTask } from './cached-summaries-lib';

const execFileAsync = promisify(execFile);

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(SCRIPT_DIR, '..');
const OUTPUT_DIR = join(WEB_ROOT, 'eval-output');
const D1_DATABASE = 'listentomore';
const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
/** Parallel wrangler processes for per-key reads and writes. */
const CONCURRENCY = 4;

/** Keys the audit cannot read or parse get this flag in addition to auditFlags. */
const UNREADABLE_FLAG = 'unreadable';

interface KeyEntry {
  name: string;
  expiration?: number;
}

interface AuditRow {
  key: string;
  task: SummaryTask;
  /** ISO date the entry was written, or null when the key has no expiry */
  writtenOn: string | null;
  expiration: number | null;
  length: number;
  flags: string[];
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

type CliArgs =
  | { command: 'audit' }
  | { command: 'refresh'; approvePath: string; yes: boolean }
  | { command: 'backfill'; devVarsPath: string; yes: boolean };

const USAGE =
  'Usage: cached-summaries.ts audit | refresh --approve <keys.json> [--yes] | backfill [--dev-vars <path>] [--yes]';

function parseArgs(argv: string[]): CliArgs {
  const [command, ...rest] = argv;
  if (command !== 'audit' && command !== 'refresh' && command !== 'backfill') {
    throw new Error(USAGE);
  }

  // Each command accepts only its own flags; anything else, including a stray
  // positional argument, is an error rather than silently ignored.
  const allowed: Record<typeof command, { valued: string[]; yes: boolean }> = {
    audit: { valued: [], yes: false },
    refresh: { valued: ['--approve'], yes: true },
    backfill: { valued: ['--dev-vars'], yes: true },
  };
  const { valued, yes: takesYes } = allowed[command];
  const values = new Map<string, string>();
  let yes = false;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--yes' && takesYes) {
      yes = true;
    } else if (valued.includes(arg)) {
      const value = rest[++i];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      values.set(arg, value);
    } else {
      throw new Error(`${command} does not take ${arg}\n${USAGE}`);
    }
  }

  if (command === 'audit') return { command };
  if (command === 'refresh') {
    const approvePath = values.get('--approve');
    if (!approvePath) {
      throw new Error('refresh needs --approve <keys.json> (pass a file holding [] to delete nothing)');
    }
    return { command, approvePath: resolve(approvePath), yes };
  }
  return { command, devVarsPath: resolve(values.get('--dev-vars') ?? join(WEB_ROOT, '.dev.vars')), yes };
}

// ---------------------------------------------------------------------------
// Wrangler
// ---------------------------------------------------------------------------

function namespaceId(): string {
  return cacheNamespaceId(readFileSync(join(WEB_ROOT, 'wrangler.toml'), 'utf8'));
}

/** Run wrangler from apps/web; rejects on a non-zero exit with stderr in the message. */
async function wrangler(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('npx', ['wrangler', ...args], {
      cwd: WEB_ROOT,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`wrangler ${args.slice(0, 3).join(' ')} failed: ${stderr || message}`);
  }
}

async function kvList(nsId: string, prefix: string): Promise<KeyEntry[]> {
  const stdout = await wrangler(['kv', 'key', 'list', '--namespace-id', nsId, '--remote', '--prefix', prefix]);
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed) || parsed.some((k) => typeof k?.name !== 'string')) {
    throw new Error(`Unexpected kv key list output for prefix ${prefix}`);
  }
  return parsed as KeyEntry[];
}

/**
 * The parsed JSON value, or null when the value is not JSON. Rejects when
 * wrangler fails (a 404 for a key that expired since listing, or a network
 * error), because wrangler prints its error text to stdout as well.
 */
async function kvGetText(nsId: string, key: string): Promise<string> {
  return wrangler(['kv', 'key', 'get', key, '--namespace-id', nsId, '--remote', '--text']);
}

async function kvGetJson(nsId: string, key: string): Promise<unknown> {
  const stdout = await kvGetText(nsId, key);
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

async function kvDelete(nsId: string, key: string): Promise<void> {
  await wrangler(['kv', 'key', 'delete', key, '--namespace-id', nsId, '--remote']);
}

/** Put via a temp file so the value reaches KV byte for byte, untouched by argument parsing. */
async function kvPut(nsId: string, key: string, value: string, ttlSeconds: number): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'cached-summaries-'));
  try {
    const path = join(dir, 'value.json');
    writeFileSync(path, value);
    await wrangler([
      'kv', 'key', 'put', key,
      '--path', path,
      '--namespace-id', nsId,
      '--remote',
      '--ttl', String(ttlSeconds),
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Every key under the four summary tasks, in SUMMARY_TASKS order. */
async function listSummaryKeys(
  nsId: string,
  tasks: readonly SummaryTask[] = SUMMARY_TASKS
): Promise<Array<KeyEntry & { task: SummaryTask }>> {
  const all: Array<KeyEntry & { task: SummaryTask }> = [];
  for (const task of tasks) {
    const keys = await kvList(nsId, aiCacheKey(task));
    console.error(`[list] ${task}: ${keys.length} keys`);
    all.push(...keys.map((k) => ({ ...k, task })));
  }
  return all;
}

/** Map with bounded concurrency, preserving input order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ---------------------------------------------------------------------------
// audit
// ---------------------------------------------------------------------------

function writtenOn(task: SummaryTask, expiration: number | undefined): string | null {
  if (!expiration) return null;
  return new Date((expiration - getCacheTtlSeconds(task)) * 1000).toISOString().slice(0, 10);
}

function renderAuditTable(rows: AuditRow[]): string {
  const cell = (s: string): string => s.replace(/\|/g, '\\|');
  const lines = ['| Key | Task | Written | Flags |', '|---|---|---|---|'];
  for (const r of rows) {
    lines.push(`| ${cell(r.key)} | ${r.task} | ${r.writtenOn ?? 'no expiry'} | ${r.flags.join(', ') || '-'} |`);
  }

  const flagged = rows.filter((r) => r.flags.length);
  lines.push('', `**${rows.length} entries, ${flagged.length} flagged.**`, '');
  lines.push('| Task | Entries | Flagged |', '|---|---|---|');
  for (const task of SUMMARY_TASKS) {
    const ofTask = rows.filter((r) => r.task === task);
    lines.push(`| ${task} | ${ofTask.length} | ${ofTask.filter((r) => r.flags.length).length} |`);
  }

  const byFlag = new Map<string, number>();
  for (const flag of flagged.flatMap((r) => r.flags)) byFlag.set(flag, (byFlag.get(flag) ?? 0) + 1);
  if (byFlag.size) {
    lines.push('', '| Flag | Entries |', '|---|---|');
    for (const [flag, count] of [...byFlag].sort((a, b) => b[1] - a[1])) lines.push(`| ${flag} | ${count} |`);
  }
  return lines.join('\n');
}

async function audit(nsId: string): Promise<void> {
  const keys = await listSummaryKeys(nsId);
  let done = 0;
  const rows = await mapLimit(keys, CONCURRENCY, async ({ name, expiration, task }): Promise<AuditRow> => {
    let text: string | null = null;
    try {
      text = summaryText(task, await kvGetJson(nsId, name));
    } catch (error) {
      console.error(`[audit] could not read ${name}:`, error instanceof Error ? error.message : String(error));
    }
    console.error(`[audit ${++done}/${keys.length}] ${name}`);
    return {
      key: name,
      task,
      writtenOn: writtenOn(task, expiration),
      expiration: expiration ?? null,
      length: text?.trim().length ?? 0,
      flags: text === null ? [UNREADABLE_FLAG] : auditFlags(task, text),
    };
  });

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = join(OUTPUT_DIR, 'cached-summaries-audit.json');
  writeFileSync(outPath, `${JSON.stringify(rows, null, 2)}\n`);
  console.log(renderAuditTable(rows));
  console.error(`[audit] Wrote ${outPath}`);
}

// ---------------------------------------------------------------------------
// refresh
// ---------------------------------------------------------------------------

function readApprovedDeletions(path: string): string[] {
  if (!existsSync(path)) throw new Error(`No approve file at ${path}`);
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed) || parsed.some((k) => typeof k !== 'string')) {
    throw new Error(`${path} must hold a JSON array of cache key strings`);
  }
  // Refuse anything outside the four summary tasks, so a stray key can never
  // delete another kind of cache entry.
  const outside = parsed.filter((k) => parseSummaryKey(k) === null);
  if (outside.length) {
    throw new Error(`Approve file holds keys outside the four summary tasks: ${outside.join(', ')}`);
  }
  return [...new Set(parsed as string[])];
}

async function refresh(nsId: string, approvePath: string, yes: boolean): Promise<void> {
  const approved = readApprovedDeletions(approvePath);
  const keys = await listSummaryKeys(nsId);
  const listed = new Set(keys.map((k) => k.name));
  const approvedSet = new Set(approved);

  const toDelete = approved.filter((k) => listed.has(k));
  const missing = approved.filter((k) => !listed.has(k));
  const toRefresh = keys.filter((k) => !approvedSet.has(k.name));
  const mode = yes ? '' : '[dry run] would ';

  for (const key of missing) console.log(`[refresh] approved key not in KV, skipping: ${key}`);
  console.log(`[refresh] ${mode}delete ${toDelete.length} keys`);
  for (const task of SUMMARY_TASKS) {
    const count = toRefresh.filter((k) => k.task === task).length;
    const days = getCacheTtlSeconds(task) / 86400;
    console.log(`[refresh] ${mode}refresh ${count} ${task} keys with a ${days}-day TTL`);
  }
  if (!yes) {
    for (const key of toDelete) console.log(`[refresh] would delete ${key}`);
    console.log('[refresh] Dry run: nothing written. Pass --yes to apply.');
    return;
  }

  let deleted = 0;
  for (const key of toDelete) {
    await kvDelete(nsId, key);
    deleted++;
    console.log(`[refresh] deleted ${key}`);
  }

  const results = await mapLimit(toRefresh, CONCURRENCY, async ({ name, task }): Promise<'refreshed' | 'skipped' | 'failed'> => {
    try {
      const decision = classifyRefreshValue(task, name, await kvGetText(nsId, name));
      if (decision.outcome === 'failed') {
        console.error(`[refresh] failed ${name}: ${decision.reason}`);
        return 'failed';
      }
      if (decision.outcome === 'skipped') {
        console.log(`[refresh] skipped (${decision.reason}; left to expire): ${name}`);
        return 'skipped';
      }
      await kvPut(nsId, name, decision.body, getCacheTtlSeconds(task));
      console.log(`[refresh] refreshed ${name}`);
      return 'refreshed';
    } catch (error) {
      console.error(`[refresh] failed ${name}:`, error instanceof Error ? error.message : String(error));
      return 'failed';
    }
  });

  const count = (r: string): number => results.filter((x) => x === r).length;
  console.log(
    `[refresh] Done: ${deleted} deleted, ${count('refreshed')} refreshed, ` +
      `${count('skipped')} skipped, ${count('failed')} failed`
  );
  if (count('failed')) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// backfill
// ---------------------------------------------------------------------------

/** Parse KEY=value lines from a .dev.vars file. Values may be quoted. */
function readDevVars(path: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).replace(/^export\s+/, '').trim();
    let value = trimmed.slice(eq + 1).trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    vars[key] = value;
  }
  return vars;
}

function spotifyCredentials(devVarsPath: string): { clientId: string; clientSecret: string } {
  const vars = existsSync(devVarsPath) ? readDevVars(devVarsPath) : {};
  const clientId = vars.SPOTIFY_CLIENT_ID;
  const clientSecret = vars.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      `SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must both be set in ${devVarsPath} ` +
        '(pass another file with --dev-vars <path>)'
    );
  }
  return { clientId, clientSecret };
}

async function spotifyToken(creds: { clientId: string; clientSecret: string }): Promise<string> {
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!response.ok) throw new Error(`Spotify token request failed: ${response.status}`);
  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) throw new Error('Spotify token response had no access_token');
  return data.access_token;
}

interface SpotifySearchResponse {
  albums?: { items: Array<{ id: string; name: string; artists: Array<{ name: string }> }> };
  artists?: { items: Array<{ id: string; name: string }> };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** One search call, waiting out a 429 up to three times. */
async function spotifySearch(token: string, query: string, type: 'album' | 'artist'): Promise<SpotifySearchResponse> {
  const url = `${SPOTIFY_API_BASE}/search?q=${encodeURIComponent(query)}&type=${type}&limit=10`;
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 429 && attempt < 3) {
      const wait = Number(response.headers.get('Retry-After') ?? 5);
      console.error(`[backfill] Spotify 429, waiting ${wait}s`);
      await sleep(wait * 1000);
      continue;
    }
    if (!response.ok) throw new Error(`Spotify search failed: ${response.status}`);
    return (await response.json()) as SpotifySearchResponse;
  }
}

/**
 * The Spotify ID for a summary key's page. The album page keys summaries on
 * all of the album's artists joined with ", ", so results are compared the same way.
 */
async function findSpotifyId(token: string, task: SummaryTask, names: string[]): Promise<string | null> {
  if (task === 'albumDetail') {
    const [artist, album] = names;
    const data = await spotifySearch(token, `album:${album} artist:${artist}`, 'album');
    const results = (data.albums?.items ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      artist: a.artists.map((x) => x.name).join(', '),
    }));
    return pickSpotifyMatch({ artist, album }, results);
  }
  const [artist] = names;
  const data = await spotifySearch(token, artist, 'artist');
  return pickSpotifyMatch({ artist }, data.artists?.items ?? []);
}

async function backfill(nsId: string, devVarsPath: string, yes: boolean): Promise<void> {
  const creds = spotifyCredentials(devVarsPath);
  const keys = await listSummaryKeys(nsId, ['albumDetail', 'artistSummary']);
  const token = await spotifyToken(creds);

  const rows: string[] = [];
  const unmatched: Array<{ key: string; reason: string }> = [];
  for (const { name, task } of keys) {
    const parsed = parseSummaryKey(name);
    if (!parsed) {
      unmatched.push({ key: name, reason: 'unparseable key' });
      continue;
    }
    try {
      const id = await findSpotifyId(token, parsed.task, parsed.names);
      if (!id) {
        unmatched.push({ key: name, reason: 'no exact Spotify match' });
        continue;
      }
      const type: EntityPageType = task === 'albumDetail' ? 'album' : 'artist';
      rows.push(entityPageInsert({ cacheKey: name, type, path: `/${type}/${id}` }));
    } catch (error) {
      unmatched.push({ key: name, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const sqlPath = join(OUTPUT_DIR, 'entity-pages-backfill.sql');
  const unmatchedPath = join(OUTPUT_DIR, 'entity-pages-backfill-unmatched.json');
  writeFileSync(sqlPath, rows.length ? `${rows.join('\n')}\n` : '');
  writeFileSync(unmatchedPath, `${JSON.stringify(unmatched, null, 2)}\n`);

  console.log(`[backfill] ${keys.length} keys: ${rows.length} matched, ${unmatched.length} unmatched`);
  for (const u of unmatched) console.log(`[backfill]   unmatched: ${u.key} (${u.reason})`);
  console.log(`[backfill] Wrote ${sqlPath} and ${unmatchedPath}`);

  if (!yes) {
    console.log('[backfill] Dry run: SQL not executed. Pass --yes to run it against remote D1.');
    return;
  }
  if (!rows.length) {
    console.log('[backfill] No rows to insert.');
    return;
  }
  const output = await wrangler(['d1', 'execute', D1_DATABASE, '--remote', '--yes', '--file', sqlPath]);
  console.log(output.trim());
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const nsId = namespaceId();
  if (args.command === 'audit') await audit(nsId);
  else if (args.command === 'refresh') await refresh(nsId, args.approvePath, args.yes);
  else await backfill(nsId, args.devVarsPath, args.yes);
}

main().catch((error) => {
  console.error('[cached-summaries] Failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
