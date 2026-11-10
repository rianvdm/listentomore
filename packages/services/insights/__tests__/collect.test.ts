// ABOUTME: Tests for collectWeekInputs - UTC day partitions, the per-generation caps, provenance, per-user versus
// ABOUTME: global cache entries, KV keys and the KV operation budget (spec section 1, "Data", "Caps", "Provenance").

import { CACHE_CONFIG, getTtlSeconds } from '@listentomore/config';
import { CAPS, InsightsFetchError, albumKey, collectWeekInputs, keys, userExactKeys, userKeyPrefixes, utcDays } from '../src';
import type { LastfmHistoryClient, Scrobble, WeekInputs } from '../src';
import { NOW, createMockKV, loadFixture } from './helpers';

const DAY = 86400;
const WEEK = 7 * DAY;
const SPAN_FROM = NOW - 35 * DAY;
const TODAY = Math.floor(NOW / DAY) * DAY;
const SETTLE = 48 * 3600;
const dayOf = (ts: number): string => new Date(ts * 1000).toISOString().slice(0, 10);

type Period = '3month' | '6month' | '12month' | 'overall';
type Method = keyof LastfmHistoryClient;

interface FakeData {
  scrobbles?: Scrobble[];
  chartList?: Array<{ from: number; to: number }>;
  charts?: Record<string, Record<string, number>>;          // key: `${from}-${to}`
  top?: Partial<Record<Period, Array<{ name: string; playcount: number }>>>;
  topPageSize?: number;
  artistCounts?: Record<string, number | null>;             // key: exact artist name
  albums?: Record<string, { tracklist: string[] | null; userPlaycount: number | null }>; // key: albumKey
  tags?: Record<string, string[]>;                          // key: exact artist name
  fail?: (method: Method, args: unknown[]) => boolean;
}

/**
 * A LastfmHistoryClient over in-memory data that records every call. Recent tracks come back newest page
 * first, 200 a page, each page in ascending time, with from and to inclusive, as the real client does.
 */
class FakeClient implements LastfmHistoryClient {
  calls: Array<{ method: Method; args: unknown[] }> = [];

  constructor(public data: FakeData = {}) {}

  private record(method: Method, args: unknown[]): void {
    this.calls.push({ method, args });
    if (this.data.fail?.(method, args)) throw new Error(`${method} failed`);
  }

  async getRecentTracksPage(from: number, to: number, page: number) {
    this.record('getRecentTracksPage', [from, to, page]);
    const matching = (this.data.scrobbles ?? []).filter((s) => s.ts >= from && s.ts <= to).sort((a, b) => b.ts - a.ts);
    const tracks = matching.slice((page - 1) * 200, page * 200).sort((a, b) => a.ts - b.ts);
    return { tracks, totalPages: Math.ceil(matching.length / 200) };
  }

  async getWeeklyChartList() {
    this.record('getWeeklyChartList', []);
    return this.data.chartList ?? [];
  }

  async getWeeklyArtistChart(from: number, to: number) {
    this.record('getWeeklyArtistChart', [from, to]);
    return this.data.charts?.[`${from}-${to}`] ?? {};
  }

  async getTopArtistsPage(period: Period, page: number) {
    this.record('getTopArtistsPage', [period, page]);
    const size = this.data.topPageSize ?? 1000;
    const list = this.data.top?.[period] ?? [];
    const artists = list.slice((page - 1) * size, page * size).map((a, i) => ({ ...a, rank: (page - 1) * size + i + 1 }));
    return { artists, totalPages: Math.ceil(list.length / size) };
  }

  async getUserArtistPlaycount(artist: string) {
    this.record('getUserArtistPlaycount', [artist]);
    return this.data.artistCounts?.[artist] ?? null;
  }

  async getAlbumInfo(artist: string, album: string) {
    this.record('getAlbumInfo', [artist, album]);
    return this.data.albums?.[albumKey(artist, album)] ?? { tracklist: null, userPlaycount: null };
  }

  async getArtistTopTags(artist: string) {
    this.record('getArtistTopTags', [artist]);
    return this.data.tags?.[artist] ?? [];
  }

  of(method: Method): unknown[][] {
    return this.calls.filter((c) => c.method === method).map((c) => c.args);
  }
}

const collect = (client: LastfmHistoryClient, kv: KVNamespace, now = NOW, extra: Partial<Parameters<typeof collectWeekInputs>[0]> = {}) =>
  collectWeekInputs({ client, kv, username: 'Alice', timezone: null, now, ...extra });

/** `n` scrobbles spread evenly over [from, to), cycling through 12 tracks of one album. */
const spread = (n: number, from: number, to: number, artist = 'Low', album = 'Secret Name'): Scrobble[] =>
  Array.from({ length: n }, (_, i) => ({ artist, album, track: `T${i % 12}`, ts: from + Math.floor((i * (to - from)) / n) }));

/** One scrobble an hour over [from, to). */
const hourly = (from: number, to: number): Scrobble[] => spread(Math.floor((to - from) / 3600), from, to);

/** `tracks` distinct tracks of one album, 4 minutes apart, from `start`. */
const run = (artist: string, album: string, tracks: number, start: number): Scrobble[] =>
  Array.from({ length: tracks }, (_, i) => ({ artist, album, track: `${album} ${i + 1}`, ts: start + i * 240 }));

const putKeys = (kv: KVNamespace): string[] => vi.mocked(kv.put).mock.calls.map((c) => c[0]);
const readJson = async <T>(kv: KVNamespace, key: string): Promise<T | null> => (await kv.get(key, 'json')) as T | null;
const kvOps = (kv: KVNamespace): number => vi.mocked(kv.get).mock.calls.length + vi.mocked(kv.put).mock.calls.length;
const inWindow = (scrobbles: Scrobble[], now = NOW): Scrobble[] =>
  scrobbles.filter((s) => s.ts >= now - 35 * DAY && s.ts < now).sort((a, b) => a.ts - b.ts);

describe('keys', () => {
  it('lower-cases the username and normalises names', () => {
    expect(keys.scrobbleDay('Alice', '2026-11-08')).toBe('lastfm:scrobbles:alice:2026-11-08');
    expect(keys.chart('Alice', 1, 2)).toBe('lastfm:chart:alice:1-2');
    expect(keys.topList('Alice', '6month')).toBe('lastfm:toplist:alice:6month');
    expect(keys.userArtist('Alice', ' Sigur  Rós ')).toBe('lastfm:userartist:alice:sigur rós');
    expect(keys.tracklist('Low', 'Secret  Name')).toBe('lastfm:tracklist:low:secret%20name');
    expect(keys.userAlbum('Alice', 'Low', 'Secret Name')).toBe('lastfm:useralbum:alice:low:secret%20name');
    expect(keys.topTags('LOW')).toBe('lastfm:toptags:low');
    expect([keys.facts('Alice'), keys.question('Alice'), keys.generating('Alice'), keys.last('Alice')])
      .toEqual(['insights:facts:alice', 'insights:question:alice', 'insights:generating:alice', 'insights:last:alice']);
  });

  it('album keys encode each name, so a colon inside a name cannot move the boundary', () => {
    expect(keys.tracklist('A:B', 'C')).not.toBe(keys.tracklist('A', 'B:C'));
    expect(keys.userAlbum('alice', 'A:B', 'C')).not.toBe(keys.userAlbum('alice', 'A', 'B:C'));
    expect(keys.tracklist('A:B', 'C')).toBe('lastfm:tracklist:a%3Ab:c');
    expect(keys.userAlbum('Alice', 'A', 'B:C')).toBe('lastfm:useralbum:alice:a:b%3Ac');
    // The user segment stays plain, so account deletion's prefix still finds the user's album counts.
    expect(keys.userAlbum('Alice', 'A:B', '50%')).toMatch(/^lastfm:useralbum:alice:/);
    expect(userKeyPrefixes('Alice').some((p) => keys.userAlbum('Alice', 'A:B', 'C').startsWith(p))).toBe(true);
  });

  it('user prefixes end in a colon and exact keys are the single-key families', () => {
    const prefixes = userKeyPrefixes('Alice');
    expect(prefixes).toEqual([
      'lastfm:scrobbles:alice:', 'lastfm:chart:alice:', 'lastfm:toplist:alice:',
      'lastfm:userartist:alice:', 'lastfm:useralbum:alice:', 'ai:userInsightsSummary:alice:',
    ]);
    expect(prefixes.some((p) => keys.scrobbleDay('alice2', '2026-11-08').startsWith(p))).toBe(false);
    expect(userExactKeys('Alice')).toEqual(['insights:facts:alice', 'insights:question:alice', 'insights:generating:alice', 'insights:last:alice']);
  });
});

describe('collectWeekInputs', () => {
  it('fetches a completed UTC day once and serves it from KV afterwards', async () => {
    const kv = createMockKV();
    const data = { scrobbles: hourly(NOW - 36 * DAY, NOW) };
    const first = await collect(new FakeClient(data), kv);
    // NOW is 21:17 UTC, so the newest settled day (ended 48+ h ago) is three days back.
    const settled = dayOf(TODAY - 3 * DAY);
    const liveFrom = TODAY - 2 * DAY;

    expect(await readJson(kv, keys.scrobbleDay('alice', settled))).toEqual({
      fetchedAt: NOW,
      scrobbles: data.scrobbles.filter((s) => dayOf(s.ts) === settled),
    });
    const ttl = vi.mocked(kv.put).mock.calls.find((c) => c[0] === keys.scrobbleDay('alice', settled))?.[2];
    expect(ttl).toEqual({ expirationTtl: getTtlSeconds(CACHE_CONFIG.lastfm.scrobbleDay) });

    const client = new FakeClient(data);
    const second = await collect(client, kv, NOW + 3600);

    // Only the current day and the two days not yet settled are fetched again, in one range; settled days come from KV.
    expect(client.of('getRecentTracksPage')).toHaveLength(1);
    for (const [from, to] of client.of('getRecentTracksPage') as number[][]) {
      expect(from).toBeGreaterThanOrEqual(liveFrom - 1);
      expect(to).toBeGreaterThan(TODAY);
    }
    expect(first.scrobbles).toEqual(inWindow(data.scrobbles));
    expect(second.scrobbles).toEqual(inWindow(data.scrobbles, NOW + 3600));
  });

  it('always refetches the current UTC day', async () => {
    const kv = createMockKV();
    const data = { scrobbles: hourly(NOW - 36 * DAY, NOW) };
    await collect(new FakeClient(data), kv);
    const late: Scrobble = { artist: 'Low', album: 'Secret Name', track: 'Late', ts: NOW + 60 };
    data.scrobbles.push(late);

    const client = new FakeClient(data);
    const result = await collect(client, kv, NOW + 120);

    expect(client.of('getRecentTracksPage').some(([, to]) => (to as number) >= NOW + 60)).toBe(true);
    expect(result.scrobbles).toContainEqual(late);
    expect(putKeys(kv)).not.toContain(keys.scrobbleDay('alice', dayOf(NOW)));
  });

  it('moving the window by a day reuses every cached day it still overlaps', async () => {
    const kv = createMockKV();
    const data = { scrobbles: hourly(NOW - 36 * DAY, NOW + DAY) };
    await collect(new FakeClient(data), kv);

    const client = new FakeClient(data);
    const result = await collect(client, kv, NOW + DAY);

    // One range: the day that settled since the first run, the two unsettled days and the current day.
    // Every older day the window still overlaps comes from KV.
    const calls = client.of('getRecentTracksPage') as number[][];
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(TODAY - 2 * DAY - 1);
    expect(vi.mocked(kv.get).mock.calls.map((c) => c[0]).filter((k) => k.startsWith('lastfm:scrobbles:')))
      .toContain(keys.scrobbleDay('alice', dayOf(TODAY - 3 * DAY)));
    expect(result.scrobbles).toEqual(inWindow(data.scrobbles, NOW + DAY));
  });

  it('refetches a day that ended 47 h ago and never writes it; caches it once 48 h have passed', async () => {
    const day = dayOf(TODAY - 2 * DAY);
    const dayEnd = TODAY - DAY;
    const data = { scrobbles: hourly(NOW - 36 * DAY, TODAY + DAY) };

    const recent = createMockKV();
    const client = new FakeClient(data);
    await collect(client, recent, dayEnd + SETTLE - 3600);
    await collect(client, recent, dayEnd + SETTLE - 1800);
    expect(putKeys(recent)).not.toContain(keys.scrobbleDay('alice', day));
    // Both runs read the day live.
    const reads = (client.of('getRecentTracksPage') as number[][]).filter(([from, to]) => from < dayEnd && to > dayEnd - DAY);
    expect(reads).toHaveLength(2);

    const settled = createMockKV();
    await collect(new FakeClient(data), settled, dayEnd + SETTLE);
    expect(putKeys(settled)).toContain(keys.scrobbleDay('alice', day));
  });

  it('filters partition contents to [now - 35 d, now)', async () => {
    const kv = createMockKV();
    const at = (ts: number, track: string): Scrobble => ({ artist: 'Low', album: '', track, ts });
    const scrobbles = [at(SPAN_FROM - 1, 'before'), at(SPAN_FROM, 'first'), at(NOW - 1, 'last'), at(NOW, 'now')];

    const result = await collect(new FakeClient({ scrobbles }), kv);

    expect(result.scrobbles.map((s) => s.track)).toEqual(['first', 'last']);
    // The partition itself keeps every scrobble of its UTC day, including the one before the window.
    const firstDay = await readJson<{ scrobbles: Scrobble[] }>(kv, keys.scrobbleDay('alice', dayOf(SPAN_FROM)));
    expect(firstDay?.scrobbles.map((s) => s.track)).toEqual(['before', 'first']);
  });

  it('stops history at 20 pages, marks historyComplete false, and still caches the days it got', async () => {
    const kv = createMockKV();
    const weekStart = Math.floor((NOW - WEEK) / DAY) * DAY;     // the first UTC day the week overlaps
    const historyDays = utcDays(SPAN_FROM, weekStart);
    const scrobbles = [
      ...historyDays.flatMap((day) => spread(250, Date.parse(`${day}T00:00:00Z`) / 1000, Date.parse(`${day}T00:00:00Z`) / 1000 + DAY)),
      ...spread(80, weekStart, NOW),
    ];
    const client = new FakeClient({ scrobbles });

    const result = await collect(client, kv);

    const historyCalls = client.of('getRecentTracksPage').filter(([, to]) => (to as number) <= weekStart);
    expect(historyCalls).toHaveLength(CAPS.historyPages);
    expect(result.historyComplete).toBe(false);
    // 20 pages of 200 hold 4,000 of the newest history scrobbles: 16 days, the oldest of them partly.
    const cached = historyDays.filter((day) => putKeys(kv).includes(keys.scrobbleDay('alice', day)));
    expect(cached).toEqual(historyDays.slice(-15));
    for (const day of cached) {
      expect((await readJson<{ scrobbles: Scrobble[] }>(kv, keys.scrobbleDay('alice', day)))?.scrobbles).toHaveLength(250);
    }

    // A later load fetches only the days still missing and completes the history.
    const again = await collect(new FakeClient({ scrobbles }), kv, NOW + 60);
    expect(again.historyComplete).toBe(true);
    expect(again.scrobbles).toEqual(inWindow(scrobbles, NOW + 60));
  });

  it('stops the current week at 15 pages and sets currentWeekTruncated', async () => {
    const kv = createMockKV();
    const week = spread(3400, NOW - WEEK, NOW);
    const client = new FakeClient({ scrobbles: [...spread(100, SPAN_FROM, NOW - WEEK), ...week] });

    const result = await collect(client, kv);

    const weekCalls = client.of('getRecentTracksPage').filter(([, to]) => (to as number) === NOW);
    expect(weekCalls).toHaveLength(CAPS.currentWeekPages);
    expect(result.currentWeekTruncated).toBe(true);
    expect(result.scrobbles.filter((s) => s.ts >= NOW - WEEK)).toEqual(week.slice(-3000));
    // The week's first UTC day starts before the week, so the cut also left part of last week unread.
    expect(result.historyComplete).toBe(false);
    // No partly read day is cached.
    for (const key of putKeys(kv).filter((k) => k.startsWith('lastfm:scrobbles:'))) {
      const day = key.split(':').pop() as string;
      const stored = await readJson<{ scrobbles: Scrobble[] }>(kv, key);
      expect(stored?.scrobbles).toHaveLength([...week, ...spread(100, SPAN_FROM, NOW - WEEK)].filter((s) => dayOf(s.ts) === day).length);
    }
  });

  it('throws InsightsFetchError when the current week cannot be fetched and writes nothing', async () => {
    const scrobbles = [...hourly(SPAN_FROM, NOW - WEEK), ...spread(900, NOW - WEEK, NOW)];
    for (const failingPage of [1, 3]) {
      const kv = createMockKV();
      const client = new FakeClient({
        scrobbles,
        fail: (method, args) => method === 'getRecentTracksPage' && args[1] === NOW && args[2] === failingPage,
      });

      await expect(collect(client, kv)).rejects.toBeInstanceOf(InsightsFetchError);
      expect(kv.put).not.toHaveBeenCalled();
    }
  });

  it('hands no writes to defer when the current week cannot be fetched', async () => {
    const kv = createMockKV();
    const deferred: Array<Promise<unknown>> = [];
    const client = new FakeClient({
      scrobbles: [...hourly(SPAN_FROM, NOW - WEEK), ...spread(900, NOW - WEEK, NOW)],
      fail: (method, args) => method === 'getRecentTracksPage' && args[1] === NOW && args[2] === 3,
    });

    await expect(collect(client, kv, NOW, { defer: (p) => deferred.push(p) })).rejects.toBeInstanceOf(InsightsFetchError);
    expect(deferred).toEqual([]);
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('a failed history page ends history incomplete and still caches the newer days it read', async () => {
    const kv = createMockKV();
    const weekStart = Math.floor((NOW - WEEK) / DAY) * DAY;
    const historyDays = utcDays(SPAN_FROM, weekStart);
    const start = (day: string) => Date.parse(`${day}T00:00:00Z`) / 1000;
    const scrobbles = [...historyDays.flatMap((day) => spread(100, start(day), start(day) + DAY)), ...spread(80, weekStart, NOW)];
    const client = new FakeClient({
      scrobbles,
      fail: (method, args) => method === 'getRecentTracksPage' && (args[1] as number) <= weekStart && args[2] === 3,
    });

    const result = await collect(client, kv);

    expect(result.historyComplete).toBe(false);
    // Pages 1 and 2 hold the newest 400 history scrobbles: four days, the oldest of them only from its first second,
    // so the three newer days are whole and cached, and nothing older is.
    const cached = historyDays.filter((day) => putKeys(kv).includes(keys.scrobbleDay('alice', day)));
    expect(cached).toEqual(historyDays.slice(-3));
  });

  it('a scrobble at exactly UTC midnight lands in one partition and appears once', async () => {
    const midnight = TODAY - 4 * DAY;
    const scrobbles = [...hourly(SPAN_FROM, midnight), { artist: 'Low', album: '', track: 'Midnight', ts: midnight }, ...hourly(midnight + 1, NOW)];
    const kv = createMockKV();
    const first = await collect(new FakeClient({ scrobbles }), kv);

    const partition = async (ts: number) =>
      (await readJson<{ scrobbles: Scrobble[] }>(kv, keys.scrobbleDay('alice', dayOf(ts))))?.scrobbles.filter((s) => s.track === 'Midnight');
    expect(await partition(midnight)).toHaveLength(1);
    expect(await partition(midnight - 1)).toHaveLength(0);
    expect(first.scrobbles.filter((s) => s.track === 'Midnight')).toHaveLength(1);

    // With only the day before missing, its range ends at that midnight and must not pick the scrobble up again.
    await kv.delete(keys.scrobbleDay('alice', dayOf(midnight - 1)));
    const second = await collect(new FakeClient({ scrobbles }), kv, NOW + 60);
    expect(second.scrobbles.filter((s) => s.track === 'Midnight')).toHaveLength(1);
    expect(await partition(midnight - 1)).toHaveLength(0);
  });

  it('fetches period lists page by page to totalPages, capped at 3, and records complete', async () => {
    const names = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Artist ${i + 1}`, playcount: 100 - i }));
    const client = new FakeClient({
      topPageSize: 2,
      top: { '3month': names(4), '6month': names(7), '12month': names(6), overall: names(5) },
    });

    const result = await collect(client, createMockKV());

    const pages = (period: Period) => client.of('getTopArtistsPage').filter(([p]) => p === period).map(([, page]) => page);
    expect(pages('3month')).toEqual([1, 2]);
    expect(pages('6month')).toEqual([1, 2, 3]);
    expect(pages('12month')).toEqual([1, 2, 3]);
    expect(pages('overall')).toEqual([1, 2]);
    expect(result.period.m3).toMatchObject({ complete: true, counts: { 'artist 1': 100, 'artist 4': 97 } });
    expect(result.period.m6.complete).toBe(false);
    expect(Object.keys(result.period.m6.counts)).toHaveLength(6);
    expect(result.period.m12.complete).toBe(true);
    expect(result.overall).toMatchObject({ complete: false, ranks: { 'artist 1': 1, 'artist 4': 4 } });
    expect(Object.keys(result.overall.counts)).toHaveLength(4);
  });

  it('records fetchedAt on every list, lifetime count and album', async () => {
    const kv = createMockKV();
    const data: FakeData = {
      scrobbles: run('Low', 'Secret Name', 8, NOW - DAY),
      top: { '3month': [{ name: 'Low', playcount: 50 }], '6month': [{ name: 'Low', playcount: 60 }], '12month': [{ name: 'Low', playcount: 70 }], overall: [{ name: 'Low', playcount: 80 }] },
      artistCounts: { Low: 80 },
      albums: { [albumKey('Low', 'Secret Name')]: { tracklist: ['a'], userPlaycount: 20 } },
    };
    const first = await collect(new FakeClient(data), kv);
    const later = await collect(new FakeClient(data), kv, NOW + 3600);

    for (const result of [first, later]) {
      const { m3, m6, m12 } = result.period;
      expect([m3, m6, m12, result.overall].map((l) => l.fetchedAt)).toEqual([NOW, NOW, NOW, NOW]);
      expect(result.artistLifetime).toEqual({ Low: { count: 80, fetchedAt: NOW } });
      expect(result.albums[albumKey('Low', 'Secret Name')]).toEqual({ tracklist: ['a'], userPlaycount: 20, fetchedAt: NOW });
    }
  });

  it('looks up at most 25 artists, 20 albums (longest runs first) and 45 tag sets', async () => {
    const name = (i: number) => `Artist ${String(i).padStart(2, '0')}`;
    const start = NOW - 6 * DAY;
    // Artists 1..22 each play one album run of i + 3 distinct tracks (4..25); 23..30 play 5 times, 31..50 three times.
    const scrobbles = [
      ...Array.from({ length: 22 }, (_, i) => run(name(i + 1), `Album ${i + 1}`, i + 4, start + i * 3 * 3600)).flat(),
      ...Array.from({ length: 28 }, (_, i) => spread(i < 8 ? 5 : 3, start + (70 + i) * 3600, start + (71 + i) * 3600, name(i + 23), '')).flat(),
    ];
    // Every artist's lifetime count is this week's plays, so all 50 are new: tag targets beyond the cap.
    const counts = new Map<string, number>();
    for (const s of scrobbles) counts.set(s.artist, (counts.get(s.artist) ?? 0) + 1);
    const overall = [...counts].map(([artist, playcount]) => ({ name: artist, playcount }));
    const client = new FakeClient({ scrobbles, top: { overall } });

    const result = await collect(client, createMockKV());

    expect(client.of('getUserArtistPlaycount')).toHaveLength(CAPS.artistLookups);
    expect(client.of('getAlbumInfo').map(([, album]) => album).sort())
      .toEqual(Array.from({ length: 20 }, (_, i) => `Album ${i + 3}`).sort());
    expect(client.of('getArtistTopTags')).toHaveLength(CAPS.tagLookups);
    expect(Object.keys(result.tags)).toHaveLength(CAPS.tagLookups);
  });

  it('leaves artists with under 3 plays out of the top-by-plays tag targets', async () => {
    const scrobbles = [...spread(3, NOW - DAY, NOW - DAY + 3600, 'Three', ''), ...spread(2, NOW - 2 * DAY, NOW - 2 * DAY + 3600, 'Two', '')];
    const client = new FakeClient({ scrobbles });

    await collect(client, createMockKV());

    expect(client.of('getArtistTopTags')).toEqual([['Three']]);
  });

  it('looks up the album of a 4-track run, which could be a whole EP', async () => {
    const client = new FakeClient({
      scrobbles: run('Hammock', 'EP', 4, NOW - DAY),
      albums: { [albumKey('Hammock', 'EP')]: { tracklist: ['EP 1', 'EP 2', 'EP 3', 'EP 4'], userPlaycount: 4 } },
    });

    const result = await collect(client, createMockKV());

    expect(client.of('getAlbumInfo')).toEqual([['Hammock', 'EP']]);
    expect(result.albums[albumKey('Hammock', 'EP')]?.tracklist).toHaveLength(4);
  });

  it('stores the tracklist globally and the user count per user', async () => {
    const kv = createMockKV();
    await collect(new FakeClient({
      scrobbles: run('Low', 'Secret Name', 6, NOW - DAY),
      albums: { [albumKey('Low', 'Secret Name')]: { tracklist: ['a', 'b'], userPlaycount: 42 } },
    }), kv);

    const tracklistKey = putKeys(kv).find((k) => k.startsWith('lastfm:tracklist:'));
    expect(tracklistKey).toBe('lastfm:tracklist:low:secret%20name');
    const global = await readJson<Record<string, unknown>>(kv, tracklistKey as string);
    expect(global).toEqual({ tracklist: ['a', 'b'], fetchedAt: NOW });
    expect(await readJson(kv, 'lastfm:useralbum:alice:low:secret%20name')).toEqual({ userPlaycount: 42, fetchedAt: NOW });
  });

  it("never serves one user's album count to another", async () => {
    const kv = createMockKV();
    const scrobbles = run('Low', 'Secret Name', 6, NOW - DAY);
    const tracklist = ['a', 'b', 'c', 'd', 'e', 'f'];
    const forUser = (count: number) => new FakeClient({
      scrobbles,
      artistCounts: { Low: count * 10 },
      albums: { [albumKey('Low', 'Secret Name')]: { tracklist, userPlaycount: count } },
    });
    await collect(forUser(42), kv);

    const bobClient = forUser(3);
    const bob = await collect(bobClient, kv, NOW, { username: 'Bob' });

    expect(bob.albums[albumKey('Low', 'Secret Name')]?.userPlaycount).toBe(3);
    expect(bob.artistLifetime.Low?.count).toBe(30);
    expect(bobClient.of('getAlbumInfo')).toHaveLength(1);
  });

  it('stops at 150 total fetches and returns what it has', async () => {
    // Every per-kind cap reached at once still stays inside the total: it is a backstop.
    const heavy = new FakeClient({
      scrobbles: [...spread(9000, SPAN_FROM, NOW - WEEK), ...spread(3400, NOW - WEEK, NOW)],
      chartList: Array.from({ length: 12 }, (_, i) => ({ from: SPAN_FROM - (i + 1) * WEEK, to: SPAN_FROM - i * WEEK })),
      topPageSize: 1,
      top: Object.fromEntries((['3month', '6month', '12month', 'overall'] as Period[]).map((p) => [p, [1, 2, 3, 4].map((i) => ({ name: `X${i}`, playcount: i }))])),
    });
    await collect(heavy, createMockKV());
    expect(heavy.calls.length).toBeLessThanOrEqual(CAPS.totalFetches);

    // A smaller total stops the generation early, current week first, and still returns inputs.
    const scrobbles = [...hourly(SPAN_FROM, NOW - WEEK), ...Array.from({ length: 30 }, (_, i) => spread(5, NOW - DAY + i * 600, NOW - DAY + (i + 1) * 600, `A${i}`, '')).flat()];
    const client = new FakeClient({ scrobbles });
    const result = await collect(client, createMockKV(), NOW, { caps: { ...CAPS, totalFetches: 30 } });

    expect(client.calls).toHaveLength(30);
    expect(result.scrobbles.filter((s) => s.ts >= NOW - WEEK)).toHaveLength(150);
    expect(Object.keys(result.tags).length).toBeLessThan(30);
  });

  it('a cold generation stays under 500 KV operations', async () => {
    const fixture = loadFixture('bordesak-2026-06-12');
    const kv = createMockKV();
    const cold = fakeFromFixture(fixture);

    const result = await collect(cold, kv, fixture.now, { username: fixture.username });

    expect(kvOps(kv)).toBeLessThan(500);
    expect(cold.calls.length).toBeLessThanOrEqual(CAPS.totalFetches);
    expect(result.scrobbles).toEqual(inWindow(fixture.scrobbles, fixture.now));
    expect(result.chartWeeks).toEqual(fixture.chartWeeks);

    // Warm, an hour later: under 20 Last.fm calls (spec "What success looks like").
    vi.mocked(kv.get).mockClear();
    vi.mocked(kv.put).mockClear();
    const warm = fakeFromFixture(fixture);
    await collect(warm, kv, fixture.now + 3600, { username: fixture.username });
    expect(warm.calls.length).toBeLessThan(20);
    expect(kvOps(kv)).toBeLessThan(500);
  });

  it('a failing tag or album lookup is skipped, not fatal', async () => {
    const kv = createMockKV();
    const logged = [vi.spyOn(console, 'warn').mockImplementation(() => {}), vi.spyOn(console, 'error').mockImplementation(() => {})];
    const client = new FakeClient({
      scrobbles: [...run('Bad', 'Broken', 6, NOW - 2 * DAY), ...run('Good', 'Fine', 6, NOW - DAY)],
      albums: { [albumKey('Good', 'Fine')]: { tracklist: ['x'], userPlaycount: 1 } },
      tags: { Bad: ['jazz'], Good: ['ambient'] },
      fail: (method, args) => (method === 'getAlbumInfo' && args[0] === 'Bad') || (method === 'getArtistTopTags' && args[0] === 'Good'),
    });

    const result = await collect(client, kv);

    expect(Object.keys(result.albums)).toEqual([albumKey('Good', 'Fine')]);
    expect(result.tags).toEqual({ Bad: ['jazz'] });
    expect(putKeys(kv)).not.toContain(keys.topTags('Good'));
    expect(putKeys(kv).filter((k) => k.includes('broken'))).toEqual([]);
    // Logs carry counts, never names.
    const text = JSON.stringify(logged.flatMap((spy) => spy.mock.calls));
    for (const word of ['Bad', 'Broken', 'Good', 'Fine']) expect(text).not.toContain(word);
    for (const spy of logged) spy.mockRestore();
  });

  it('picks 8 chart weeks that end before the 35-day span', async () => {
    const kv = createMockKV();
    const boundary = SPAN_FROM - 3 * DAY;   // a chart boundary 3 days before the span starts
    const chartList = Array.from({ length: 20 }, (_, i) => ({ from: boundary + (i - 14) * WEEK, to: boundary + (i - 13) * WEEK }));
    const charts = Object.fromEntries(chartList.map((w, i) => [`${w.from}-${w.to}`, { low: i }]));
    const client = new FakeClient({ chartList, charts });

    const result = await collect(client, kv);

    const expected = chartList.filter((w) => w.to <= SPAN_FROM).slice(-8);
    expect(result.chartWeeks.map(({ from, to }) => ({ from, to }))).toEqual(expected);
    expect(result.chartWeeks.every((w) => w.counts.low === chartList.findIndex((c) => c.from === w.from))).toBe(true);
    expect(client.of('getWeeklyArtistChart')).toHaveLength(8);

    const again = new FakeClient({ chartList, charts });
    await collect(again, kv, NOW + 3600);
    expect(again.of('getWeeklyArtistChart')).toHaveLength(0);
  });

  it('hands every KV write to defer when given one', async () => {
    const kv = createMockKV();
    const deferred: Array<Promise<unknown>> = [];

    await collect(new FakeClient({ scrobbles: hourly(SPAN_FROM, NOW) }), kv, NOW, { defer: (p) => deferred.push(p) });

    expect(deferred.length).toBe(vi.mocked(kv.put).mock.calls.length);
    expect(deferred.length).toBeGreaterThan(0);
  });
});

/** A fake client that serves a fixture's data, with weekly chart boundaries continuing past its 8 chart weeks. */
function fakeFromFixture(f: WeekInputs): FakeClient {
  const last = f.chartWeeks[f.chartWeeks.length - 1];
  const later = Array.from({ length: 7 }, (_, i) => ({ from: last.to + i * WEEK, to: last.to + (i + 1) * WEEK }));
  const asList = (counts: Record<string, number>) =>
    Object.entries(counts).sort(([a, x], [b, y]) => y - x || a.localeCompare(b)).map(([name, playcount]) => ({ name, playcount }));
  const albums: FakeData['albums'] = {};
  for (const [key, info] of Object.entries(f.albums)) albums[key] = { tracklist: info.tracklist, userPlaycount: info.userPlaycount };
  return new FakeClient({
    scrobbles: f.scrobbles,
    chartList: [...f.chartWeeks.map(({ from, to }) => ({ from, to })), ...later],
    charts: Object.fromEntries(f.chartWeeks.map((w) => [`${w.from}-${w.to}`, w.counts])),
    top: { '3month': asList(f.period.m3.counts), '6month': asList(f.period.m6.counts), '12month': asList(f.period.m12.counts), overall: asList(f.overall.counts) },
    artistCounts: Object.fromEntries(Object.entries(f.artistLifetime).map(([a, v]) => [a, v.count])),
    albums,
    tags: f.tags,
  });
}
