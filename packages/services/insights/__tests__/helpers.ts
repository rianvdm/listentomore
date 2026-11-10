// ABOUTME: Test helpers for the insights package - fixtures by name, hand-made WeekInputs and FactContexts,
// ABOUTME: and expectGrounded, the check that a fact types every name, number and day it states.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dayLabel, norm, weekWindow } from '../src';
import type { AlbumRun, ArtistWeek, Draft, FactContext, Quantity, Scrobble, Tier, Unit, WeekInputs } from '../src';

/** Reads `__fixtures__/<name>.json` beside this directory, typed as module inputs. */
export function loadFixture(name: string): WeekInputs {
  const path = fileURLToPath(new URL(`../__fixtures__/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as WeekInputs;
}

/** A valid WeekInputs with no plays and complete, empty history lists, all fetched at `now`; overrides replace top-level fields. */
export function makeInputs(overrides: Partial<WeekInputs> = {}): WeekInputs {
  const now = overrides.now ?? 1794172620;
  const empty = () => ({ fetchedAt: now, complete: true, counts: {} });
  return {
    username: 'listener',
    timezone: null,
    now,
    scrobbles: [],
    historyComplete: true,
    currentWeekTruncated: false,
    chartWeeks: [],
    period: { m3: empty(), m6: empty(), m12: empty() },
    overall: { ...empty(), ranks: {} },
    artistLifetime: {},
    albums: {},
    tags: {},
    ...overrides,
  };
}

// ---------- hand-built fact contexts ----------

export const NOW = 1794172620; // Sun Nov 8 2026, 21:17 UTC
export const ts = (iso: string): number => Date.parse(`${iso}Z`) / 1000;

/** `n` plays of `artist` from one album, `gap` seconds apart, starting at `start`. */
export const plays = (artist: string, n: number, start: number, album = 'Album', gap = 240): Scrobble[] =>
  Array.from({ length: n }, (_, i) => ({ artist, album, track: `Track ${i + 1}`, ts: start + i * gap }));

export type ArtistSpec = Partial<ArtistWeek> & { artist: string; tier: Tier; plays: number };
export const artist = (spec: ArtistSpec): ArtistWeek => ({
  rawPlays: spec.plays,
  playsLastWeek: 0,
  lifetimeBefore: null,
  absentMonths: null,
  nameUncertain: false,
  allTimeRank: null,
  ...spec,
});

/** A full 12-week baseline (4 raw scrobble weeks + 8 chart weeks) where each artist has `perWeek` plays every week. */
export function history(perWeek: Record<string, number>, now = NOW): { prior: Scrobble[][]; chartWeeks: WeekInputs['chartWeeks'] } {
  const prior = [1, 2, 3, 4].map((w) =>
    Object.entries(perWeek).flatMap(([name, n]) => plays(name, n, weekWindow(now, w).from + 3600)));
  const counts = Object.fromEntries(Object.entries(perWeek).map(([name, n]) => [norm(name), n]));
  const chartWeeks = [5, 6, 7, 8, 9, 10, 11, 12].map((w) => ({ ...weekWindow(now, w), counts }));
  return { prior, chartWeeks };
}

export interface Setup {
  week: Scrobble[];
  artists: ArtistWeek[];
  inputs?: Partial<WeekInputs>;
  runs?: AlbumRun[];
  prior?: Scrobble[][];
  baseline?: FactContext['baseline'];
}

/** A hand-built FactContext; the raw and deduped weeks are the same scrobbles. */
export function context({ week, artists, inputs = {}, runs = [], prior = [[], [], [], []], baseline = 'full' }: Setup): FactContext {
  const weeks = [week, ...prior];
  return {
    inputs: makeInputs({ now: NOW, ...inputs }),
    artists: new Map(artists.map((a) => [a.artist, a])),
    runs,
    week,
    rawWeeks: weeks,
    weeks,
    baseline,
  };
}

export const ofKind = (drafts: Draft[], kind: Draft['kind']): Draft[] => drafts.filter((d) => d.kind === kind);
export const only = (drafts: Draft[], kind: Draft['kind']): Draft => {
  const found = ofKind(drafts, kind);
  expect(found).toHaveLength(1);
  return found[0];
};

// ---------- grounding ----------

const DAY_LABEL = /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}\b/g;
const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const WORD = new RegExp(`\\b(?:${Object.keys(WORDS).join('|')})\\b`, 'g');
// Task 8's guard reads "a" or "an" before a unit word as 1 of that unit, and "a year" as 12 months.
const ARTICLE_UNIT = /\b(?:a|an) (plays?|tracks?|times?|days?|weeks?|months?|years?|percent|artists?|albums?)\b/gi;
const articleQuantity = (word: string): Pick<Quantity, 'value' | 'unit'> => {
  const singular = word.toLowerCase().replace(/s$/, '');
  if (singular === 'year') return { value: 12, unit: 'months' };
  return { value: 1, unit: (singular === 'percent' ? 'percent' : `${singular}s`) as Unit };
};

/**
 * Everything the statement says is typed on the draft, and nothing typed is missing from it:
 * every name in `entities`, every number (digits or a word) in `quantities`, every day in `dates`.
 * Also checks the clamp and the banned words (spec section 2 anti-goals and section 3 rule 3).
 */
export function expectGrounded(d: Draft, tz: string | null = null): void {
  for (const e of d.entities) expect(d.statement).toContain(e);
  let text = d.statement;
  for (const e of [...d.entities].sort((a, b) => b.length - a.length)) text = text.split(e).join('#');
  const labels = d.dates.map((t) => dayLabel(t, tz));
  for (const label of text.match(DAY_LABEL) ?? []) expect(labels).toContain(label);
  for (const label of labels) expect(text).toContain(label);
  text = text.replace(DAY_LABEL, '#');
  const articles = [...text.matchAll(ARTICLE_UNIT)].map((m) => articleQuantity(m[1]));
  for (const a of articles) expect(d.quantities).toContainEqual(expect.objectContaining(a));
  const stated = [
    ...(text.match(/\d+/g) ?? []).map(Number),
    ...(text.toLowerCase().match(WORD) ?? []).map((w) => WORDS[w]),
    ...articles.map((a) => a.value),
  ];
  const values = d.quantities.map((q) => q.value);
  for (const n of stated) expect(values).toContain(n);
  for (const v of values) expect(stated).toContain(v);
  for (const q of d.quantities) if (q.entity !== undefined) expect(d.entities).toContain(q.entity);
  expect(d.salience).toBeGreaterThanOrEqual(0);
  expect(d.salience).toBeLessThanOrEqual(100);
  expect(d.statement).not.toMatch(/[—–]|stop|first time|first ever|\bsince\b|\bnever\b/i);
  for (const e of d.edges) expect(e.text).not.toMatch(/[—–]|stop/i);
}

// ---------- KV ----------

/** An in-memory KVNamespace with vi.fn methods, copied from apps/web/src/__tests__/utils/mocks.ts (not importable here). */
export function createMockKV(): KVNamespace {
  const store = new Map<string, { value: string; metadata?: unknown }>();

  return {
    get: vi.fn(async (key: string, options?: { type?: string } | string) => {
      const entry = store.get(key);
      if (!entry) return null;

      const type = typeof options === 'string' ? options : options?.type;
      if (type === 'json') {
        return JSON.parse(entry.value);
      }
      return entry.value;
    }),
    put: vi.fn(async (key: string, value: string, options?: { expirationTtl?: number; metadata?: unknown }) => {
      store.set(key, { value, metadata: options?.metadata });
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(async () => ({ keys: [], list_complete: true, cacheStatus: null })),
    getWithMetadata: vi.fn(async (key: string) => {
      const entry = store.get(key);
      if (!entry) return { value: null, metadata: null };
      return { value: entry.value, metadata: entry.metadata || null };
    }),
  } as unknown as KVNamespace;
}
