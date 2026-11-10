// ABOUTME: Captures one listener's current-week WeekInputs from live Last.fm through the real collectWeekInputs,
// ABOUTME: printing cold and warm fetch counts, KV operations, elapsed time and KV bytes split per user and global.
//
// Usage (from apps/web):
//   pnpm dlx tsx scripts/capture-week-inputs.ts --user <lastfm user> --tz America/Los_Angeles --out <path.json>
//
// Runs the collector twice against one in-memory KV at the same `now`: the cold run starts from an empty cache, the
// warm run reads what the cold run stored. The figures are the measured input to the spec's storage budget
// (section 5: under 1.5 MB per user). Per-user bytes are keys under userKeyPrefixes(user); the rest are global
// (tracklists and tags, shared across users). Writes the cold run's WeekInputs to --out.
//
// LASTFM_API_KEY comes from apps/web/.dev.vars only, never from the shell. Nothing here prints the key, the
// scrobbles or any name: only counts.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectWeekInputs, userKeyPrefixes } from '@listentomore/insights';
import type { LastfmHistoryClient, WeekInputs } from '@listentomore/insights';
import { LastfmHistory } from '@listentomore/lastfm';
import { byteLength, createMemoryKV, readDevVars } from './script-env';
import type { KvOps, MemoryKV } from './script-env';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(SCRIPT_DIR, '..');
const LASTFM_HOST = 'ws.audioscrobbler.com';

interface CliArgs {
  user: string;
  tz: string;
  out: string;
}

function parseArgs(argv: string[]): CliArgs {
  const valueOf = (flag: string): string => {
    const i = argv.indexOf(flag);
    const value = i < 0 ? undefined : argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} <value> is required`);
    return value;
  };
  const args = { user: valueOf('--user'), tz: valueOf('--tz'), out: resolve(valueOf('--out')) };
  // Throws a RangeError for a zone name the runtime does not know.
  new Intl.DateTimeFormat('en-US', { timeZone: args.tz });
  return args;
}

interface RunFigures {
  label: 'cold' | 'warm';
  /** Client calls by method; a rate-limit retry inside a call is one call. */
  calls: Record<string, number>;
  /** HTTP requests to Last.fm, retries included. */
  httpRequests: number;
  kv: KvOps;
  elapsedSeconds: number;
  /** Value bytes written during this run. */
  written: { perUser: number; global: number; keysPerUser: number; keysGlobal: number };
  /** Value bytes held in KV after this run. */
  stored: { perUser: number; global: number };
}

/** Wraps the history client to count its calls by method. */
function countingClient(client: LastfmHistoryClient, calls: Record<string, number>): LastfmHistoryClient {
  const counted = <A extends unknown[], R>(method: keyof LastfmHistoryClient, fn: (...args: A) => R) =>
    (...args: A): R => {
      calls[method] = (calls[method] ?? 0) + 1;
      return fn(...args);
    };
  return {
    getRecentTracksPage: counted('getRecentTracksPage', client.getRecentTracksPage.bind(client)),
    getWeeklyChartList: counted('getWeeklyChartList', client.getWeeklyChartList.bind(client)),
    getWeeklyArtistChart: counted('getWeeklyArtistChart', client.getWeeklyArtistChart.bind(client)),
    getTopArtistsPage: counted('getTopArtistsPage', client.getTopArtistsPage.bind(client)),
    getUserArtistPlaycount: counted('getUserArtistPlaycount', client.getUserArtistPlaycount.bind(client)),
    getAlbumInfo: counted('getAlbumInfo', client.getAlbumInfo.bind(client)),
    getArtistTopTags: counted('getArtistTopTags', client.getArtistTopTags.bind(client)),
  };
}

/** Counts fetch() requests to Last.fm for the duration of `fn`. */
async function countingHttp<T>(fn: () => Promise<T>): Promise<{ result: T; requests: number }> {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (new URL(url).hostname === LASTFM_HOST) requests++;
    return original(input, init);
  };
  try {
    return { result: await fn(), requests };
  } finally {
    globalThis.fetch = original;
  }
}

function splitBytes(entries: Array<{ key: string; bytes: number }>, user: string) {
  const prefixes = userKeyPrefixes(user);
  const isUser = (key: string): boolean => prefixes.some((p) => key.startsWith(p));
  const sum = (list: typeof entries): number => list.reduce((s, e) => s + e.bytes, 0);
  const perUser = entries.filter((e) => isUser(e.key));
  const global = entries.filter((e) => !isUser(e.key));
  return { perUser: sum(perUser), global: sum(global), keysPerUser: perUser.length, keysGlobal: global.length };
}

async function runOnce(
  label: RunFigures['label'],
  memory: MemoryKV,
  history: LastfmHistory,
  args: CliArgs,
  now: number,
): Promise<{ inputs: WeekInputs; figures: RunFigures }> {
  memory.resetCounters();
  const calls: Record<string, number> = {};
  const started = performance.now();
  const { result: inputs, requests } = await countingHttp(() =>
    collectWeekInputs({
      client: countingClient(history, calls),
      kv: memory.kv,
      username: args.user,
      timezone: args.tz,
      now,
    }),
  );
  const elapsedSeconds = (performance.now() - started) / 1000;
  const stored = splitBytes(
    [...memory.store.entries()].map(([key, value]) => ({ key, bytes: byteLength(value) })),
    args.user,
  );
  return {
    inputs,
    figures: {
      label,
      calls,
      httpRequests: requests,
      kv: { ...memory.ops },
      elapsedSeconds,
      written: splitBytes(memory.writes, args.user),
      stored: { perUser: stored.perUser, global: stored.global },
    },
  };
}

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;

function printFigures(f: RunFigures): void {
  const total = Object.values(f.calls).reduce((a, b) => a + b, 0);
  const methods = Object.entries(f.calls).map(([m, n]) => `${m}=${n}`).join(' ') || 'none';
  console.log(`[capture] ${f.label}: ${total} Last.fm calls (${f.httpRequests} HTTP requests) in ${f.elapsedSeconds.toFixed(1)}s`);
  console.log(`[capture] ${f.label}:   by method: ${methods}`);
  console.log(
    `[capture] ${f.label}:   KV: ${f.kv.gets} gets (${f.kv.hits} hits), ${f.kv.puts} puts, ${f.kv.deletes} deletes, ${f.kv.lists} lists`,
  );
  console.log(
    `[capture] ${f.label}:   written: per-user ${kb(f.written.perUser)} in ${f.written.keysPerUser} keys, ` +
      `global ${kb(f.written.global)} in ${f.written.keysGlobal} keys`,
  );
  console.log(`[capture] ${f.label}:   stored after run: per-user ${kb(f.stored.perUser)}, global ${kb(f.stored.global)}`);
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = readDevVars(join(WEB_ROOT, '.dev.vars')).LASTFM_API_KEY;
  if (!apiKey) throw new Error('LASTFM_API_KEY is not set in apps/web/.dev.vars');

  const history = new LastfmHistory({ apiKey, username: args.user });
  const memory = createMemoryKV();
  const now = Math.floor(Date.now() / 1000);

  const cold = await runOnce('cold', memory, history, args, now);
  printFigures(cold.figures);
  const warm = await runOnce('warm', memory, history, args, now);
  printFigures(warm.figures);

  const inputs = cold.inputs;
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(inputs));
  console.log(
    `[capture] Wrote ${args.out}: ${inputs.scrobbles.length} scrobbles, ${inputs.chartWeeks.length} chart weeks, ` +
      `historyComplete=${inputs.historyComplete}, currentWeekTruncated=${inputs.currentWeekTruncated}`,
  );
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error('[capture] Failed:', err instanceof Error ? err.message : String(err));
    process.exitCode = 2;
  },
);
