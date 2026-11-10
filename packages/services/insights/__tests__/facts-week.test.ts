// ABOUTME: Tests for week-level facts - breadth, last week faded, themed blocks and total volume.
// ABOUTME: Follows spec section 2 (fact table) and section 1's baseline suppressions; every fact is checked for grounding.

import { weekFacts } from '../src';
import type { Scrobble } from '../src';
import { context, expectGrounded, history, ofKind, only, plays, ts } from './helpers';

const MON = ts('2026-11-02T10:00:00');
const WED = ts('2026-11-04T10:00:00');
const THU = ts('2026-11-05T10:00:00');

/** `n` distinct artist names: 'Artist A' .. 'Artist Z', 'Artist AA', ... */
const names = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `Artist ${i >= 26 ? 'A' : ''}${String.fromCharCode(65 + (i % 26))}`);

/** `perArtist` plays of each artist, one artist per hour from Monday. */
const spread = (artists: string[], perArtist: number): Scrobble[] =>
  artists.flatMap((name, i) => plays(name, perArtist, MON + i * 3600, 'Album', 60));

const atTen = (artists: string[]): Record<string, number> => Object.fromEntries(artists.map((name) => [name, 10]));

describe('breadth', () => {
  it('wide week: 27 artists at 10+ against a median of 18 scores 75', () => {
    const { prior, chartWeeks } = history(atTen(names(18)));
    const now = names(27);
    const d = only(weekFacts(context({ week: spread(now, 10), artists: [], prior, inputs: { chartWeeks } })), 'breadth');
    expect(d).toMatchObject({ salience: 75, subject: null, edges: [] }); // 60 + 30*(27/18 - 1)
    expect(d.statement).toBe('A wide week: 27 artists reached 10 or more plays, against a usual 18 (median of the previous 12 weeks): '
      + `${[...now].sort((a, b) => a.localeCompare(b)).join(', ')}.`);
    expect(d.quantities).toEqual([
      { value: 27, unit: 'artists' },
      { value: 10, unit: 'plays' },
      { value: 18, unit: 'artists' },
      { value: 12, unit: 'weeks' },
    ]);
    expectGrounded(d);
  });

  it('breadth counts raw plays this week', () => {
    const { prior, chartWeeks } = history(atTen(names(18)));
    const raw = spread(names(27), 10);
    const deduped = raw.filter((s) => s.track !== 'Track 10'); // 9 plays each after dedupe
    const ctx = context({ week: deduped, artists: [], prior, inputs: { chartWeeks } });
    expect(only(weekFacts({ ...ctx, rawWeeks: [raw, ...ctx.rawWeeks.slice(1)] }), 'breadth').salience).toBe(75);
  });

  it('15 against a median of 18 is not wide', () => {
    const { prior, chartWeeks } = history(atTen(names(18)));
    expect(ofKind(weekFacts(context({ week: spread(names(15), 10), artists: [], prior, inputs: { chartWeeks } })), 'breadth'))
      .toEqual([]);
  });

  it('wide also needs at least 4 more artists than the median', () => {
    const { prior, chartWeeks } = history(atTen(names(6)));
    // 9 is 1.5 times 6 but only 3 more.
    expect(ofKind(weekFacts(context({ week: spread(names(9), 10), artists: [], prior, inputs: { chartWeeks } })), 'breadth'))
      .toEqual([]);
  });

  it('narrow week needs a median of at least 4', () => {
    const three = history(atTen(names(3)));
    expect(ofKind(weekFacts(context({
      week: spread(names(1), 10), artists: [], prior: three.prior, inputs: { chartWeeks: three.chartWeeks },
    })), 'breadth')).toEqual([]);

    const four = history(atTen(names(4)));
    const d = only(weekFacts(context({
      week: spread(names(2), 10), artists: [], prior: four.prior, inputs: { chartWeeks: four.chartWeeks },
    })), 'breadth');
    expect(d.salience).toBe(55);
    expect(d.statement).toBe('A narrow week: only 2 artists reached 10 or more plays (Artist A, 10 plays; Artist B, 10 plays), '
      + 'against a usual 4 (median of the previous 12 weeks).');
    expectGrounded(d);
  });

  it('a narrow week names its artists by raw plays, then name, each with deduped plays tied to it', () => {
    const { prior, chartWeeks } = history(atTen(names(4)));
    // Raw: Combichrist 14, Ghost 12, Alpha 12; deduped: Combichrist 12, Ghost 10, Alpha 11.
    const raw = [...plays('Combichrist', 14, MON), ...plays('Ghost', 12, WED), ...plays('Alpha', 12, THU)];
    const drop = new Set([raw[0], raw[1], raw[14], raw[15], raw[26]]);

    const one = plays('Combichrist', 12, MON);
    const d = only(weekFacts(context({ week: one, artists: [], prior, inputs: { chartWeeks } })), 'breadth');
    expect(d.statement).toBe('A narrow week: only 1 artist reached 10 or more plays (Combichrist, 12 plays), against a usual 4 '
      + '(median of the previous 12 weeks).');
    expect(d.entities).toEqual(['Combichrist']);
    expect(d.quantities).toContainEqual({ value: 12, unit: 'plays', entity: 'Combichrist' });
    expectGrounded(d);

    const eight = history(atTen(names(8)));
    const three = only(weekFacts({
      ...context({ week: raw.filter((s) => !drop.has(s)), artists: [], prior: eight.prior, inputs: { chartWeeks: eight.chartWeeks } }),
      rawWeeks: [raw, ...eight.prior],
    }), 'breadth');
    expect(three.statement).toBe('A narrow week: only 3 artists reached 10 or more plays '
      + '(Combichrist, 12 plays; Alpha, 11 plays; Ghost, 10 plays), against a usual 8 (median of the previous 12 weeks).');
    expect(three.quantities).toContainEqual({ value: 10, unit: 'plays', entity: 'Ghost' });
    expect(three.quantities).toContainEqual({ value: 10, unit: 'plays' });
    expectGrounded(three);
  });

  it('a narrow-week artist under 10 deduped plays is named without a count', () => {
    const { prior, chartWeeks } = history(atTen(names(4)));
    // 10 raw scrobbles qualify Combichrist; one is a likely duplicate, so 9 deduped plays.
    const raw = plays('Combichrist', 10, MON);
    const ctx = context({ week: raw.slice(1), artists: [], prior, inputs: { chartWeeks } });
    const d = only(weekFacts({ ...ctx, rawWeeks: [raw, ...ctx.rawWeeks.slice(1)] }), 'breadth');
    expect(d.statement).toBe('A narrow week: only 1 artist reached 10 or more plays (Combichrist), against a usual 4 '
      + '(median of the previous 12 weeks).');
    expect(d.entities).toEqual(['Combichrist']);
    expect(d.quantities.some((q) => q.entity === 'Combichrist')).toBe(false);
    expectGrounded(d);
  });

  it('a median of zero suppresses the fact', () => {
    const { prior, chartWeeks } = history({});
    expect(ofKind(weekFacts(context({ week: spread(names(6), 10), artists: [], prior, inputs: { chartWeeks } })), 'breadth'))
      .toEqual([]);
  });

  it('missing chart weeks shrink the baseline and the statement says so', () => {
    const { prior } = history(atTen(names(18)));
    const d = only(weekFacts(context({ week: spread(names(27), 10), artists: [], prior })), 'breadth');
    expect(d.statement).toContain('(median of the previous 4 weeks)');
    expectGrounded(d);
  });
});

describe('last week faded', () => {
  const lastWeek = (counts: Record<string, number>): Scrobble[] =>
    Object.entries(counts).flatMap(([name, n], i) => plays(name, n, MON - 7 * 86400 + i * 7200));
  const before = lastWeek({ 'Boards of Canada': 40, Hammock: 30, Grouper: 20, Moby: 10, Low: 5, Doves: 4 });
  const thisWeek = [...plays('Boards of Canada', 4, MON), ...plays('Hammock', 3, WED), ...plays('Grouper', 3, THU)];

  it('last week faded lists top artists at 10% or less', () => {
    const d = only(weekFacts(context({ week: thisWeek, artists: [], prior: [before, [], [], []] })), 'last_week_faded');
    expect(d).toMatchObject({ salience: 45, subject: null, edges: [] });
    // Grouper (3 of 20) is above 10%; Doves is not among last week's top five.
    expect(d.statement).toBe("Last week's top artists dropped away: Boards of Canada (40 plays last week, 4 this week), "
      + 'Hammock (30 plays last week, 3 this week), Moby (10 plays last week, 0 this week), Low (5 plays last week, 0 this week).');
    expect(d.entities).toEqual(['Boards of Canada', 'Hammock', 'Moby', 'Low']);
    expect(d.quantities).toContainEqual({ value: 0, unit: 'plays', entity: 'Moby' });
    expectGrounded(d);
  });

  it('does not need a baseline, but is suppressed when the history is incomplete', () => {
    const prior = [before, [], [], []];
    expect(ofKind(weekFacts(context({ week: thisWeek, artists: [], prior, baseline: 'none' })), 'last_week_faded')).toHaveLength(1);
    expect(ofKind(weekFacts(context({
      week: thisWeek, artists: [], prior, baseline: 'partial', inputs: { historyComplete: false },
    })), 'last_week_faded')).toEqual([]);
  });

  it('nothing fades when last week was empty', () => {
    expect(ofKind(weekFacts(context({ week: thisWeek, artists: [] })), 'last_week_faded')).toEqual([]);
  });
});

describe('volume', () => {
  const { prior } = history({ Moby: 50, Hammock: 50 }); // 100 plays and 2 artists in each of the 4 prior weeks
  const weekOf = (total: number): Scrobble[] =>
    [...plays('Moby', total - 20, MON), ...plays('Hammock', 10, WED), ...plays('Grouper', 10, THU)];
  const volumeAt = (total: number) => ofKind(weekFacts(context({ week: weekOf(total), artists: [], prior })), 'volume');

  it('volume fires at +/-20% against the 4-week average', () => {
    const [up] = volumeAt(120);
    expect(up).toMatchObject({ salience: 35, subject: null, edges: [] });
    expect(up.statement).toBe('120 plays this week, 20% above the 4-week average of 100; 3 artists against a usual 2.');
    expect(up.quantities).toEqual([
      { value: 120, unit: 'plays' },
      { value: 20, unit: 'percent' },
      { value: 4, unit: 'weeks' },
      { value: 100, unit: 'plays' },
      { value: 3, unit: 'artists' },
      { value: 2, unit: 'artists' },
    ]);
    expectGrounded(up);

    const [down] = volumeAt(80);
    expect(down.statement).toBe('80 plays this week, 20% below the 4-week average of 100; 3 artists against a usual 2.');
    expectGrounded(down);

    expect(volumeAt(119)).toEqual([]);
    expect(volumeAt(81)).toEqual([]);
  });

  it('an empty baseline suppresses the fact', () => {
    expect(ofKind(weekFacts(context({ week: weekOf(120), artists: [] })), 'volume')).toEqual([]);
  });
});

it('week-level baseline facts are suppressed when the baseline is partial or none', () => {
  const { prior, chartWeeks } = history(atTen(names(18))); // 180 plays and a breadth of 18 each week
  const week = [...spread(names(27), 10), ...plays('Moby', 50, THU)];
  const full = weekFacts(context({ week, artists: [], prior, inputs: { chartWeeks } }));
  expect(ofKind(full, 'breadth')).toHaveLength(1);
  expect(ofKind(full, 'volume')).toHaveLength(1);
  for (const baseline of ['partial', 'none'] as const) {
    const drafts = weekFacts(context({ week, artists: [], prior, inputs: { chartWeeks }, baseline }));
    expect(ofKind(drafts, 'breadth')).toEqual([]);
    expect(ofKind(drafts, 'volume')).toEqual([]);
  }
});

describe('themed block', () => {
  const ROCK = ['Doves', 'Elbow', 'Starsailor', 'Keane'];
  const JAZZ = ['Wes Montgomery', 'Grant Green', 'Joe Henderson', 'Wayne Shorter'];
  const tags = Object.fromEntries([...ROCK.map((n) => [n, ['rock']]), ...JAZZ.map((n) => [n, ['jazz']])]);
  const BLOCK = ts('2026-11-04T20:00:00'); // Wed 12:00 PM in Los Angeles

  const rock = (perArtist: number): Scrobble[] => ROCK.flatMap((name, i) => plays(name, perArtist, MON + i * 7200));
  /** `n` jazz plays rotating through `artists`, `gap` seconds apart. */
  const jazz = (n: number, gap = 330, artists = JAZZ): Scrobble[] =>
    Array.from({ length: n }, (_, i) => ({ artist: artists[i % artists.length], album: 'Jazz', track: `j${i}`, ts: BLOCK + i * gap }));
  const blocks = (week: Scrobble[], timezone: string | null = null) =>
    ofKind(weekFacts(context({ week, artists: [], inputs: { tags, timezone } })), 'themed_block');

  it('themed block needs 60 minutes, 12 plays, 4 artists and a bucket under 15% of the week', () => {
    const [d] = blocks([...rock(25), ...jazz(12)]);
    expect(d).toMatchObject({ salience: 40, subject: null, edges: [] });
    expect(d.statement).toBe('Wed Nov 4: 12 plays of jazz from 4 artists (most played: Grant Green, Joe Henderson, Wayne Shorter, '
      + "Wes Montgomery); jazz is 11% of the week's plays.");
    expect(d.dates).toEqual([BLOCK]);
    expectGrounded(d);

    expect(blocks([...rock(25), ...jazz(11)])).toEqual([]); // 11 plays
    expect(blocks([...rock(25), ...jazz(12, 330, JAZZ.slice(0, 3))])).toEqual([]); // 3 artists
    expect(blocks([...rock(25), ...jazz(12, 300)])).toEqual([]); // 55 minutes between first and last, 59 with the last track
    expect(blocks([...rock(15), ...jazz(12)])).toEqual([]); // jazz is 12 of 72 plays, 17%
  });

  it('names the part of the day in the owner timezone', () => {
    const tz = 'America/Los_Angeles';
    const [d] = blocks([...rock(25), ...jazz(12)], tz);
    expect(d.statement.startsWith('Wed Nov 4, afternoon: 12 plays of jazz')).toBe(true);
    expectGrounded(d, tz);
  });

  it('up to three plays outside the bucket do not break a block, and are not counted in it', () => {
    const block = jazz(12);
    const interrupted = (n: number): Scrobble[] => [
      ...block.slice(0, 6),
      ...Array.from({ length: n }, (_, i) => ({ artist: 'Doves', album: 'Lost Souls', track: `x${i}`, ts: block[5].ts + 10 + i })),
      ...block.slice(6),
    ];
    const [d] = blocks([...rock(25), ...interrupted(3)]);
    expect(d.statement).toContain('12 plays of jazz from 4 artists');
    expectGrounded(d);
    expect(blocks([...rock(25), ...interrupted(4)])).toEqual([]);
  });
});
