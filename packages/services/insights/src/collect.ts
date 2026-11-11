// ABOUTME: collectWeekInputs - reads one listener's WeekInputs from Last.fm through KV: UTC day partitions, chart
// ABOUTME: weeks, top lists and per-artist and per-album lookups, bounded by per-generation caps, with fetchedAt provenance.

import { CACHE_CONFIG, getTtlSeconds } from '@listentomore/config';
import { dedupe } from './dedupe';
import { artistWeeks } from './history';
import { keys } from './keys';
import { hasEditionMarker } from './match';
import { albumRuns, runsToLookUp } from './runs';
import { norm } from './text';
import { albumKey } from './types';
import type { AlbumInfo, CountList, LastfmHistoryClient, ReleaseInfo, ReleaseLookup, Scrobble, WeekInputs } from './types';
import { utcDays, weekWindow } from './window';

/**
 * Per-generation bounds (spec section 1, "Caps and degraded behaviour"). Fetches count Last.fm client calls; retries
 * inside a call do not. Release lookups go to Spotify, so they have their own cap and stay outside totalFetches.
 */
export const CAPS = {
  currentWeekPages: 15,
  historyPages: 20,
  albumLookups: 20,
  artistLookups: 25,
  tagLookups: 45,
  totalFetches: 150,
  releaseLookups: 6,
} as const;
export type Caps = { [K in keyof typeof CAPS]: number };

/** The current week could not be read, so there is nothing to generate from. Nothing was cached. */
export class InsightsFetchError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'InsightsFetchError';
  }
}

export interface CollectArgs {
  client: LastfmHistoryClient;
  kv: KVNamespace;
  username: string;
  timezone: string | null;
  now: number;
  /** Takes each fire-and-forget KV write (the route passes waitUntil); without it, writes are awaited. */
  defer?: (p: Promise<unknown>) => void;
  /** Overrides CAPS; for tests. */
  caps?: Caps;
  /** Finds albums' Spotify releases for the release_week fact. The owner's view only; without it, none are looked up. */
  releases?: ReleaseLookup;
}

const DAY = 86400;
/**
 * How long after its end a day or chart week becomes immutable and cacheable. Last.fm accepts backdated
 * scrobbles (offline players and batch scrobblers submit plays hours or days late), so a just-ended day
 * cached for 40 days would miss them. Until then it is fetched live, like the current day, and never stored.
 */
const SETTLE_SECONDS = 48 * 3600;
const SPAN_DAYS = 35;
const CONCURRENCY = 4;
const CHART_WEEKS = 8;
const PERIOD_PAGES = 3;
const OVERALL_PAGES = 2;
/** Plays this week an artist needs for a lifetime-count lookup. */
const LOOKUP_MIN_PLAYS = 4;
/** Plays an artist needs to be a tag target, as in build.py; genre clusters count members with 3+ plays. */
const TAG_MIN_PLAYS = 3;
const TAG_TOP_ARTISTS = 40;
/** Workers KV rejects longer keys; an entity whose key would be longer is fetched but not cached. */
const MAX_KEY_BYTES = 512;

type Period = '3month' | '6month' | '12month' | 'overall';
type TopList = CountList & { ranks: Record<string, number> };

interface DayPartition { fetchedAt: number; scrobbles: Scrobble[] }
interface ChartEntry { fetchedAt: number; counts: Record<string, number> }
interface ArtistCountEntry { count: number | null; fetchedAt: number }
interface TracklistEntry { tracklist: string[] | null; fetchedAt: number }
interface AlbumCountEntry { userPlaycount: number | null; fetchedAt: number }
interface TagsEntry { tags: string[]; fetchedAt: number }

const keyBytes = new TextEncoder();
const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const dayStart = (day: string): number => Date.parse(`${day}T00:00:00Z`) / 1000;
const dayOf = (ts: number): string => new Date(ts * 1000).toISOString().slice(0, 10);

/** Runs `fn` over `items`, at most `limit` at a time, keeping input order in the results. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** KV reads and writes for one generation. Reads that fail are misses; writes never fail the generation. */
class Store {
  private readonly pending: Array<Promise<unknown>> = [];

  constructor(private readonly kv: KVNamespace, private readonly defer?: (p: Promise<unknown>) => void) {}

  async read<T>(key: string): Promise<T | null> {
    if (keyBytes.encode(key).length > MAX_KEY_BYTES) return null;
    try {
      return (await this.kv.get(key, 'json')) as T | null;
    } catch (error) {
      console.error('Insights cache read failed:', errorMessage(error));
      return null;
    }
  }

  write(key: string, value: unknown, ttlSeconds: number): void {
    if (keyBytes.encode(key).length > MAX_KEY_BYTES) return;
    const put = this.kv.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds }).catch((error: unknown) => {
      console.error('Insights cache write failed:', errorMessage(error));
    });
    if (this.defer) this.defer(put);
    else this.pending.push(put);
  }

  async flush(): Promise<void> {
    await Promise.all(this.pending);
  }
}

/** Counts every client call against the generation's total, and the calls that failed and were skipped. */
class Budget {
  private used = 0;
  failures = 0;

  constructor(private readonly total: number) {}

  take(): boolean {
    if (this.used >= this.total) return false;
    this.used++;
    return true;
  }
}

/** Contiguous runs of `days` (ascending), newest run first. */
function contiguousRanges(days: string[]): string[][] {
  const ranges: string[][] = [];
  for (const day of days) {
    const last = ranges[ranges.length - 1];
    if (last && dayStart(day) === dayStart(last[last.length - 1]) + DAY) last.push(day);
    else ranges.push([day]);
  }
  return ranges.reverse();
}

interface RangeResult {
  tracks: Scrobble[];
  /** Days of the range whose every scrobble was read. */
  covered: string[];
  /** Why the range stopped short: the page cap (or the total), or a failed page. */
  cut: 'cap' | 'error' | null;
  pagesUsed: number;
  error?: unknown;
}

/**
 * Reads the scrobbles of a run of UTC days, up to `pageCap` pages. Last.fm returns the newest page first,
 * so when the range stops short, every day that starts after the oldest scrobble read is still whole.
 */
async function fetchRange(
  client: LastfmHistoryClient,
  budget: Budget,
  days: string[],
  now: number,
  pageCap: number,
): Promise<RangeResult> {
  const start = dayStart(days[0]);
  const end = Math.min(dayStart(days[days.length - 1]) + DAY, now);
  // Last.fm does not say whether from and to are inclusive: ask from a second early, up to the end boundary
  // itself, and keep only [start, end).
  const page = async (n: number): Promise<{ tracks: Scrobble[]; totalPages: number } | Error | null> => {
    if (!budget.take()) return null;
    try {
      return await client.getRecentTracksPage(start - 1, end, n);
    } catch (error) {
      budget.failures++;
      return error instanceof Error ? error : new Error(String(error));
    }
  };
  if (pageCap < 1) return { tracks: [], covered: [], cut: 'cap', pagesUsed: 0 };

  const first = await page(1);
  if (first === null) return { tracks: [], covered: [], cut: 'cap', pagesUsed: 0 };
  if (first instanceof Error) return { tracks: [], covered: [], cut: 'error', pagesUsed: 1, error: first };

  const totalPages = Math.max(1, first.totalPages);
  const wanted = Math.min(totalPages, pageCap);
  const rest = await mapLimit(Array.from({ length: wanted - 1 }, (_, i) => i + 2), CONCURRENCY, page);
  const pages = [first, ...rest];
  const stop = pages.findIndex((p) => p === null || p instanceof Error);
  const read = (stop === -1 ? pages : pages.slice(0, stop)) as Array<{ tracks: Scrobble[]; totalPages: number }>;
  const failed = stop === -1 ? null : pages[stop];
  const pagesUsed = pages.filter((p) => p !== null).length;

  const tracks = read.flatMap((p) => p.tracks).filter((s) => s.ts >= start && s.ts < end);
  if (read.length === totalPages) return { tracks, covered: days, cut: null, pagesUsed };
  const oldest = Math.min(...read.flatMap((p) => p.tracks.map((s) => s.ts)));
  return {
    tracks,
    covered: days.filter((day) => dayStart(day) > oldest),
    cut: failed instanceof Error ? 'error' : 'cap',
    pagesUsed,
    error: failed ?? undefined,
  };
}

interface SegmentResult { tracks: Scrobble[]; covered: string[]; cut: RangeResult['cut']; error?: unknown }

/** Reads runs of days newest first, sharing one page cap, and stops at the first run that stops short. */
async function fetchSegment(
  client: LastfmHistoryClient,
  budget: Budget,
  days: string[],
  now: number,
  pageCap: number,
): Promise<SegmentResult> {
  const result: SegmentResult = { tracks: [], covered: [], cut: null };
  let pagesLeft = pageCap;
  for (const range of contiguousRanges(days)) {
    const got = await fetchRange(client, budget, range, now, pagesLeft);
    pagesLeft -= got.pagesUsed;
    result.tracks.push(...got.tracks);
    result.covered.push(...got.covered);
    if (got.cut) return { ...result, cut: got.cut, error: got.error };
  }
  return result;
}

/** The scrobbles of [now - 35 d, now), plus whether the history and the current week were read whole. */
async function collectScrobbles(
  args: CollectArgs,
  store: Store,
  budget: Budget,
  caps: Caps,
): Promise<{ scrobbles: Scrobble[]; historyComplete: boolean; currentWeekTruncated: boolean }> {
  const { client, username, now } = args;
  const spanFrom = now - SPAN_DAYS * DAY;
  const weekFrom = weekWindow(now).from;
  const days = utcDays(spanFrom, now);
  const isSettled = (day: string): boolean => dayStart(day) + DAY + SETTLE_SECONDS <= now;

  const cached = new Map<string, Scrobble[]>();
  await Promise.all(days.filter(isSettled).map(async (day) => {
    const partition = await store.read<DayPartition>(keys.scrobbleDay(username, day));
    if (partition) cached.set(day, partition.scrobbles);
  }));
  const missing = days.filter((day) => !cached.has(day));
  const inWeek = (day: string): boolean => dayStart(day) + DAY > weekFrom;

  // The current week first, so it is whole before any history page is spent.
  const week = await fetchSegment(client, budget, missing.filter(inWeek), now, caps.currentWeekPages);
  if (week.cut === 'error') {
    throw new InsightsFetchError(`Could not read the current week: ${errorMessage(week.error)}`, { cause: week.error });
  }
  const history = await fetchSegment(client, budget, missing.filter((day) => !inWeek(day)), now, caps.historyPages);

  const fetched = [...week.tracks, ...history.tracks];
  // Only settled days read whole are immutable; the current day and recent days are never stored.
  for (const day of [...week.covered, ...history.covered].filter(isSettled)) {
    const scrobbles = fetched.filter((s) => dayOf(s.ts) === day).sort((a, b) => a.ts - b.ts);
    store.write(keys.scrobbleDay(username, day), { fetchedAt: now, scrobbles }, getTtlSeconds(CACHE_CONFIG.lastfm.scrobbleDay));
  }

  const scrobbles = [...[...cached.values()].flat(), ...fetched]
    .filter((s) => s.ts >= spanFrom && s.ts < now)
    .sort((a, b) => a.ts - b.ts);
  // The week's first UTC day starts before the week, so a week segment cut short also leaves part of last week unread.
  return { scrobbles, historyComplete: history.cut === null && week.cut === null, currentWeekTruncated: week.cut !== null };
}

/** The 8 latest chart weeks that end by the start of the scrobble span, oldest first. Missing weeks are skipped. */
async function collectChartWeeks(args: CollectArgs, store: Store, budget: Budget): Promise<WeekInputs['chartWeeks']> {
  const { client, username, now } = args;
  if (!budget.take()) return [];
  let list: Array<{ from: number; to: number }>;
  try {
    list = await client.getWeeklyChartList();
  } catch {
    budget.failures++;
    return [];
  }
  const spanFrom = now - SPAN_DAYS * DAY;
  const picked = list.filter((w) => w.to <= spanFrom).sort((a, b) => b.to - a.to).slice(0, CHART_WEEKS);

  const weeks = await mapLimit(picked, CONCURRENCY, async ({ from, to }) => {
    const key = keys.chart(username, from, to);
    const hit = await store.read<ChartEntry>(key);
    if (hit) return { from, to, counts: hit.counts };
    if (!budget.take()) return null;
    try {
      const counts = await client.getWeeklyArtistChart(from, to);
      // A chart week is immutable once it has settled.
      if (to + SETTLE_SECONDS <= now) store.write(key, { fetchedAt: now, counts }, getTtlSeconds(CACHE_CONFIG.lastfm.weeklyChart));
      return { from, to, counts };
    } catch {
      budget.failures++;
      return null;
    }
  });
  return weeks.filter((w): w is WeekInputs['chartWeeks'][number] => w !== null).sort((a, b) => a.from - b.from);
}

/**
 * One top-artists list, read page by page to its totalPages, at most `maxPages`. `complete` says every page
 * was read. A list cut short by the page cap is cached as it is; one cut short by a failure is not.
 */
async function collectTopList(args: CollectArgs, store: Store, budget: Budget, period: Period, maxPages: number): Promise<TopList> {
  const { client, username, now } = args;
  const key = keys.topList(username, period);
  // Only the overall list is stored with ranks.
  const hit = await store.read<CountList & { ranks?: Record<string, number> }>(key);
  if (hit) return { ...hit, ranks: hit.ranks ?? {} };

  const counts: Record<string, number> = {};
  const ranks: Record<string, number> = {};
  let totalPages = 1;
  let read = 0;
  let failed = false;
  for (let page = 1; page <= Math.min(totalPages, maxPages); page++) {
    if (!budget.take()) {
      failed = true;
      break;
    }
    try {
      const result = await client.getTopArtistsPage(period, page);
      totalPages = result.totalPages;
      read++;
      // Names that normalise alike keep the larger count and the better rank.
      for (const { name, playcount, rank } of result.artists) {
        const k = norm(name);
        if (!k) continue;
        counts[k] = Math.max(counts[k] ?? 0, playcount);
        ranks[k] = Math.min(ranks[k] ?? rank, rank);
      }
    } catch {
      budget.failures++;
      failed = true;
      break;
    }
  }
  const list: TopList = { fetchedAt: now, complete: !failed && read >= totalPages, counts, ranks };
  if (!failed) {
    const ttl = period === 'overall' ? CACHE_CONFIG.lastfm.overallList : CACHE_CONFIG.lastfm.periodList;
    store.write(key, period === 'overall' ? list : { fetchedAt: now, complete: list.complete, counts }, getTtlSeconds(ttl));
  }
  return list;
}

/** Lifetime plays for the week's top artists with 4+ plays, per user. */
async function collectArtistCounts(
  args: CollectArgs,
  store: Store,
  budget: Budget,
  artists: string[],
): Promise<WeekInputs['artistLifetime']> {
  const { client, username, now } = args;
  const out: WeekInputs['artistLifetime'] = {};
  await mapLimit(artists, CONCURRENCY, async (artist) => {
    const key = keys.userArtist(username, artist);
    let entry = await store.read<ArtistCountEntry>(key);
    if (!entry) {
      if (!budget.take()) return;
      try {
        entry = { count: await client.getUserArtistPlaycount(artist), fetchedAt: now };
      } catch {
        budget.failures++;
        return;
      }
      store.write(key, entry, getTtlSeconds(CACHE_CONFIG.lastfm.userArtistCount));
    }
    if (entry.count !== null) out[artist] = { count: entry.count, fetchedAt: entry.fetchedAt };
  });
  return out;
}

/**
 * Tracklists (global) and the user's play counts (per user) for the week's longest same-album runs.
 * The two are cached apart so one user's count is never served to another.
 */
async function collectAlbums(
  args: CollectArgs,
  store: Store,
  budget: Budget,
  targets: Array<{ artist: string; album: string }>,
): Promise<WeekInputs['albums']> {
  const { client, username, now } = args;
  const out: WeekInputs['albums'] = {};
  await mapLimit(targets, CONCURRENCY, async ({ artist, album }) => {
    const tracklistKey = keys.tracklist(artist, album);
    const countKey = keys.userAlbum(username, artist, album);
    const [list, count] = await Promise.all([store.read<TracklistEntry>(tracklistKey), store.read<AlbumCountEntry>(countKey)]);
    let info: AlbumInfo;
    if (list && count) {
      info = { tracklist: list.tracklist, userPlaycount: count.userPlaycount, fetchedAt: count.fetchedAt };
    } else {
      if (!budget.take()) return;
      try {
        info = { ...(await client.getAlbumInfo(artist, album)), fetchedAt: now };
      } catch {
        budget.failures++;
        return;
      }
      if (!list) {
        store.write(tracklistKey, { tracklist: info.tracklist, fetchedAt: now }, getTtlSeconds(CACHE_CONFIG.lastfm.albumTracklist));
      }
      store.write(countKey, { userPlaycount: info.userPlaycount, fetchedAt: now }, getTtlSeconds(CACHE_CONFIG.lastfm.userAlbumCount));
    }
    out[albumKey(artist, album)] = info;
  });
  return out;
}

/** Top tags (global) for the artists the tag rules read. */
async function collectTags(args: CollectArgs, store: Store, budget: Budget, artists: string[]): Promise<WeekInputs['tags']> {
  const { client, now } = args;
  const out: WeekInputs['tags'] = {};
  await mapLimit(artists, CONCURRENCY, async (artist) => {
    const key = keys.topTags(artist);
    const hit = await store.read<TagsEntry>(key);
    if (hit) {
      out[artist] = hit.tags;
      return;
    }
    if (!budget.take()) return;
    try {
      out[artist] = await client.getArtistTopTags(artist);
    } catch {
      budget.failures++;
      return;
    }
    store.write(key, { tags: out[artist], fetchedAt: now }, getTtlSeconds(CACHE_CONFIG.lastfm.artistTopTags));
  });
  return out;
}

/** Release lookups for one week, and how many of them threw. */
interface ReleaseResult { releases: Record<string, ReleaseInfo>; failures: number }

/**
 * Looks up the releases of this week's start_to_finish and most_of albums, each once, most played this week first,
 * then by name. Titles with an edition marker are dropped before the cap without a call: release_week skips them.
 * A lookup that throws or finds nothing leaves its album out.
 */
async function lookUpReleases(inputs: WeekInputs, lookup: ReleaseLookup, limit: number): Promise<ReleaseResult> {
  const { from, to } = weekWindow(inputs.now);
  const week = dedupe(inputs.scrobbles.filter((s) => s.ts >= from && s.ts < to)).kept;
  const plays = new Map<string, number>();
  for (const s of week) plays.set(albumKey(s.artist, s.album), (plays.get(albumKey(s.artist, s.album)) ?? 0) + 1);

  // An album played in two runs is looked up once, under the spelling of its longest run.
  const targets = new Map<string, { artist: string; album: string }>();
  for (const run of albumRuns(week, inputs.albums)) {
    const key = albumKey(run.artist, run.album);
    if ((run.verdict === 'start_to_finish' || run.verdict === 'most_of') && !targets.has(key)) targets.set(key, run);
  }
  const ordered = [...targets.entries()]
    .filter(([, target]) => !hasEditionMarker(target.album))
    .sort(([k1, a], [k2, b]) => (plays.get(k2) ?? 0) - (plays.get(k1) ?? 0)
      || a.album.localeCompare(b.album) || a.artist.localeCompare(b.artist))
    .slice(0, limit);

  const result: ReleaseResult = { releases: {}, failures: 0 };
  await mapLimit(ordered, CONCURRENCY, async ([key, { artist, album }]) => {
    try {
      const release = await lookup(artist, album);
      if (release) result.releases[key] = release;
    } catch {
      result.failures++;
    }
  });
  return result;
}

/**
 * Release dates for the week's album runs (spec section 2, "Release-week fact"), keyed by albumKey: at most `limit`
 * lookups, 4 at a time. A lookup that throws is skipped.
 */
export async function collectReleases(
  inputs: WeekInputs,
  lookup: ReleaseLookup,
  limit: number = CAPS.releaseLookups,
): Promise<Record<string, ReleaseInfo>> {
  return (await lookUpReleases(inputs, lookup, limit)).releases;
}

/**
 * Fetches everything buildWeekFacts reads for `username` at `now`, through KV.
 *
 * Order: the current week, then uncached history days, newest first; the chart list and 8 chart weeks; the
 * period and overall lists; lifetime counts for this week's top artists; album lookups for its longest runs;
 * tags for the artists the tag rules read, alongside release lookups when `releases` is given. Each stage runs at
 * most 4 calls at a time. Hitting a cap or a failed lookup degrades the inputs (spec section 1); only a current
 * week that cannot be read throws.
 */
export async function collectWeekInputs(args: CollectArgs): Promise<WeekInputs> {
  const { username, timezone, now } = args;
  const caps = args.caps ?? CAPS;
  const store = new Store(args.kv, args.defer);
  const budget = new Budget(caps.totalFetches);

  const { scrobbles, historyComplete, currentWeekTruncated } = await collectScrobbles(args, store, budget, caps);
  const chartWeeks = await collectChartWeeks(args, store, budget);
  const [m3, m6, m12, overall] = await mapLimit(
    [['3month', PERIOD_PAGES], ['6month', PERIOD_PAGES], ['12month', PERIOD_PAGES], ['overall', OVERALL_PAGES]] as Array<[Period, number]>,
    CONCURRENCY,
    ([period, pages]) => collectTopList(args, store, budget, period, pages),
  );
  const period = {
    m3: { fetchedAt: m3.fetchedAt, complete: m3.complete, counts: m3.counts },
    m6: { fetchedAt: m6.fetchedAt, complete: m6.complete, counts: m6.counts },
    m12: { fetchedAt: m12.fetchedAt, complete: m12.complete, counts: m12.counts },
  };

  const { from: weekFrom } = weekWindow(now);
  const rawWeek = scrobbles.filter((s) => s.ts >= weekFrom);
  const week = dedupe(rawWeek).kept;
  const plays = new Map<string, number>();
  for (const s of week) plays.set(s.artist, (plays.get(s.artist) ?? 0) + 1);
  const byPlays = [...plays.entries()].sort(([a, x], [b, y]) => y - x || a.localeCompare(b)).map(([artist]) => artist);

  const lookupArtists = byPlays.filter((a) => (plays.get(a) ?? 0) >= LOOKUP_MIN_PLAYS).slice(0, caps.artistLookups);
  const artistLifetime = await collectArtistCounts(args, store, budget, lookupArtists);

  // An album played in two runs is looked up once, under the spelling of its longest run.
  const albumTargets = new Map<string, { artist: string; album: string }>();
  for (const r of runsToLookUp(week)) {
    const key = albumKey(r.artist, r.album);
    if (!albumTargets.has(key)) albumTargets.set(key, r);
  }
  const albums = await collectAlbums(args, store, budget, [...albumTargets.values()].slice(0, caps.albumLookups));

  // Tiers from what is known so far choose the new and lapsed-looking artists the cluster rule reads.
  const partial: WeekInputs = {
    username, timezone, now, scrobbles: [], historyComplete, currentWeekTruncated, chartWeeks, period, overall,
    artistLifetime, albums, tags: {},
  };
  const tiers = artistWeeks(partial, [week], [rawWeek]);
  const newOrLapsed = byPlays.filter((a) => {
    const info = tiers.get(a);
    return info !== undefined && info.plays >= TAG_MIN_PLAYS
      && (info.tier === 'first_under_this_name' || info.tier === 'barely_known' || info.tier === 'lapsed');
  });
  const runArtists = albumRuns(week, albums).map((r) => r.artist);
  const topArtists = byPlays.slice(0, TAG_TOP_ARTISTS).filter((a) => (plays.get(a) ?? 0) >= TAG_MIN_PLAYS);
  const tagArtists = [...new Set([...newOrLapsed, ...runArtists, ...topArtists])].slice(0, caps.tagLookups);
  // Release lookups read Spotify, not Last.fm, so they run beside the tag lookups.
  const [tags, looked] = await Promise.all([
    collectTags(args, store, budget, tagArtists),
    args.releases ? lookUpReleases({ ...partial, scrobbles }, args.releases, caps.releaseLookups) : null,
  ]);

  // Counts only: never names, scrobbles or inputs.
  const releaseFailures = looked?.failures ?? 0;
  if (budget.failures > 0 || releaseFailures > 0) {
    console.warn('Insights collect skipped failed calls:', { lastfm: budget.failures, releases: releaseFailures });
  }
  if (!args.defer) await store.flush();
  return { ...partial, scrobbles, tags, ...(looked ? { releases: looked.releases } : {}) };
}
