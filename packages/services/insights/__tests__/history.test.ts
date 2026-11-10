// ABOUTME: Tests for per-artist history - lifetime-before with provenance, absence windows and tiers.
// ABOUTME: Follows spec sections 1 ("Provenance") and 2 ("Familiarity tiers").

import { artistWeeks, isNameUncertain, norm, weekWindow } from '../src';
import type { CountList, Scrobble, WeekInputs } from '../src';
import { makeInputs } from './helpers';

const NOW = 1794172620;
const WEEK = weekWindow(NOW);
const LAST_WEEK = weekWindow(NOW, 1);

/** `n` plays of `artist`, four minutes apart, starting an hour into the window that begins at `from`. */
const plays = (artist: string, n: number, from = WEEK.from): Scrobble[] =>
  Array.from({ length: n }, (_, i) => ({ artist, album: 'Album', track: `Track ${i + 1}`, ts: from + 3600 + i * 240 }));

const list = (counts: Record<string, number>, complete = true, fetchedAt = NOW): CountList =>
  ({ fetchedAt, complete, counts });

/** Runs artistWeeks with this week's plays as both the deduped and the raw week. */
const run = (inputs: WeekInputs, week: Scrobble[], lastWeek: Scrobble[] = []) =>
  artistWeeks(inputs, [week, lastWeek], [week, lastWeek]);

it('first under this name: nothing before, history complete', () => {
  const week = plays('Andy Shauf', 9);
  const inputs = makeInputs({
    artistLifetime: { 'Andy Shauf': { count: 9, fetchedAt: NOW } },
    period: { m3: list({ 'andy shauf': 9 }), m6: list({ 'andy shauf': 9 }), m12: list({ 'andy shauf': 9 }) },
  });
  const a = run(inputs, week).get('Andy Shauf');
  expect(a?.lifetimeBefore).toBe(0);
  expect(a?.tier).toBe('first_under_this_name');
  expect(a?.nameUncertain).toBe(false);
});

it('counts deduped plays, raw plays and last week per exact name', () => {
  const raw = plays('Withered Hand', 12);
  const deduped = raw.slice(0, 10);
  const lastWeek = plays('Withered Hand', 3, LAST_WEEK.from);
  const result = artistWeeks(makeInputs(), [deduped, lastWeek], [raw, lastWeek]);
  expect(result.get('Withered Hand')).toMatchObject({ artist: 'Withered Hand', plays: 10, rawPlays: 12, playsLastWeek: 3 });
  expect([...result.keys()]).toEqual(['Withered Hand']);
});

it('barely known: 1 to 15 before', () => {
  const week = plays('Boxer Rebellion', 50);
  const inputs = makeInputs({ overall: { ...list({ 'boxer rebellion': 61 }), ranks: { 'boxer rebellion': 900 } } });
  const a = run(inputs, week).get('Boxer Rebellion');
  expect(a?.lifetimeBefore).toBe(11);
  expect(a?.tier).toBe('barely_known');
});

describe('absence windows', () => {
  const week = plays('The xx', 16);
  const lapsedInputs = (m3Complete: boolean, m6Complete: boolean) => makeInputs({
    artistLifetime: { 'The xx': { count: 237, fetchedAt: NOW } },
    period: { m3: list({ 'the xx': 16 }, m3Complete), m6: list({ 'the xx': 16 }, m6Complete), m12: list({ 'the xx': 30 }) },
  });

  it('lapsed: 20+ before and absent from a complete 6-month list', () => {
    const a = run(lapsedInputs(true, true), week).get('The xx');
    expect(a?.lifetimeBefore).toBe(221);
    expect(a?.absentMonths).toBe(6);
    expect(a?.tier).toBe('lapsed');
  });

  it('absence is unknown when the period list is incomplete', () => {
    const fallsToThree = run(lapsedInputs(true, false), week).get('The xx');
    expect(fallsToThree?.absentMonths).toBe(3);
    expect(fallsToThree?.tier).toBe('lapsed');
    const unknown = run(lapsedInputs(false, false), week).get('The xx');
    expect(unknown?.absentMonths).toBeNull();
    expect(unknown?.tier).toBe('regular');
  });
});

it('lifetime older than some of this week is subtracted only up to fetchedAt', () => {
  const week = plays('Boxer Rebellion', 10);
  const inputs = makeInputs({ artistLifetime: { 'Boxer Rebellion': { count: 100, fetchedAt: week[3].ts } } });
  expect(run(inputs, week).get('Boxer Rebellion')?.lifetimeBefore).toBe(96);
});

it('inconsistent snapshot is unknown', () => {
  const week = plays('Boxer Rebellion', 10);
  const inputs = makeInputs({ artistLifetime: { 'Boxer Rebellion': { count: 3, fetchedAt: NOW } } });
  const a = run(inputs, week).get('Boxer Rebellion');
  expect(a?.lifetimeBefore).toBeNull();
  expect(a?.tier).toBe('unknown');
});

it('prefers the overall list, falls back to getinfo, and takes the larger when both exist', () => {
  const week = plays('Andy Shauf', 10);
  const overall = (count: number, fetchedAt = NOW) => ({ ...list({ 'andy shauf': count }, true, fetchedAt), ranks: {} });
  const before = (inputs: WeekInputs) => run(inputs, week).get('Andy Shauf')?.lifetimeBefore;

  expect(before(makeInputs({ overall: overall(50) }))).toBe(40);
  expect(before(makeInputs({ artistLifetime: { 'Andy Shauf': { count: 45, fetchedAt: NOW } } }))).toBe(35);
  // The overall count (50) was fetched before the week, so nothing is subtracted from it; the
  // larger getinfo count (55) wins and is paired with its own fetchedAt, so all 10 plays come off.
  expect(before(makeInputs({
    overall: overall(50, WEEK.from),
    artistLifetime: { 'Andy Shauf': { count: 55, fetchedAt: NOW } },
  }))).toBe(45);
});

describe('all-time and rotation tiers', () => {
  const week = plays('Boxer Rebellion', 10);
  const present = { 'boxer rebellion': 40 };
  const inputsWith = (rank: number, m6: Record<string, number> = present) => makeInputs({
    overall: { ...list({ 'boxer rebellion': 500 }), ranks: { 'boxer rebellion': rank } },
    period: { m3: list(present), m6: list(m6), m12: list(present) },
  });

  it('all-time favourite at overall rank 25, not 26', () => {
    const at25 = run(inputsWith(25), week).get('Boxer Rebellion');
    expect(at25?.allTimeRank).toBe(25);
    expect(at25?.tier).toBe('all_time_favourite');
    const at26 = run(inputsWith(26), week).get('Boxer Rebellion');
    expect(at26?.allTimeRank).toBe(26);
    expect(at26?.tier).toBe('regular');
  });

  it('16 to 19 before with an absence is regular in the 6-month top 40 and occasional outside it', () => {
    // 27 lifetime - 10 this week = 17 before: too many for barely known, too few for lapsed.
    const absentFromThree = (m6: Record<string, number>) => makeInputs({
      overall: { ...list({ 'boxer rebellion': 27 }), ranks: { 'boxer rebellion': 3000 } },
      period: { m3: list({ 'boxer rebellion': 10 }), m6: list(m6), m12: list({ 'boxer rebellion': 27 }) },
    });
    const inRotation = run(absentFromThree({ 'boxer rebellion': 12 }), week).get('Boxer Rebellion');
    expect(inRotation).toMatchObject({ lifetimeBefore: 17, absentMonths: 3, tier: 'regular' });
    const crowded: Record<string, number> = { 'boxer rebellion': 12 };
    for (let i = 0; i < 40; i++) crowded[norm(`Other ${i}`)] = 100 + i;
    const outside = run(absentFromThree(crowded), week).get('Boxer Rebellion');
    expect(outside).toMatchObject({ lifetimeBefore: 17, absentMonths: 3, tier: 'occasional' });
  });
});

it('credit separators make a name uncertain', () => {
  for (const n of ["Bear's Den + Paul Frith", 'Kenny Burrell & John Coltrane', 'A feat. B', 'Tyler, The Creator', 'AC/DC']) expect(isNameUncertain(n)).toBe(true);
  for (const n of ['Boxer Rebellion', 'Andy Shauf', 'The xx', 'Withered Hand', 'Xx', 'Andrew Bird', 'Featherstone']) expect(isNameUncertain(n)).toBe(false);
});

it('a credit word at the start or end of a name counts as a whole token too', () => {
  for (const n of ['With Confidence', 'X Ambassadors', 'And Also The Trees', 'Elbow With', 'Feat. B', 'FT Island', '+ Plus']) {
    expect(isNameUncertain(n), n).toBe(true);
  }
});

it('an uncertain name with no history is never first_under_this_name', () => {
  const name = 'Kenny Burrell & John Coltrane';
  const week = plays(name, 9);
  const inputs = makeInputs({ artistLifetime: { [name]: { count: 9, fetchedAt: NOW } } });
  const a = run(inputs, week).get(name);
  expect(a?.lifetimeBefore).toBe(0);
  expect(a?.nameUncertain).toBe(true);
  expect(a?.tier).toBe('unknown');
});
