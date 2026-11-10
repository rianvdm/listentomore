// ABOUTME: Tests for artist-level week facts - discovery, volume against normal, genre clusters and returns.
// ABOUTME: Follows spec section 2 (fact table, "Question", anti-goals); every fact is checked for grounding.

import { albumKey, albumRuns, artistFacts } from '../src';
import type { AlbumRun, ArtistWeek, Scrobble } from '../src';
import { NOW, artist, context, expectGrounded, history, ofKind, only, plays, ts } from './helpers';
import type { ArtistSpec } from './helpers';

const JUNE_NOW = Date.parse('2026-06-20T12:00:00Z') / 1000; // Sat Jun 20 2026, 12:00 UTC

describe('discovery', () => {
  const MON = ts('2026-06-15T10:00:00');
  const THU = ts('2026-06-18T10:00:00');
  const siigaWeek = [...plays('Siiga', 20, MON, 'Hidden Lake'), ...plays('Siiga', 19, THU, 'Hidden Lake')];
  const siiga = artist({ artist: 'Siiga', tier: 'barely_known', plays: 39, lifetimeBefore: 3 });

  it('discovery scales with plays: barely known at 39 plays scores 94', () => {
    const d = only(artistFacts(context({ week: siigaWeek, artists: [siiga], inputs: { now: JUNE_NOW } })), 'discovery');
    expect(d).toMatchObject({ kind: 'discovery', subject: 'Siiga', salience: 94 });
    expect(d.entities).toEqual(['Siiga']);
    expect(d.quantities).toEqual(expect.arrayContaining([
      { value: 3, unit: 'plays', entity: 'Siiga' },
      { value: 39, unit: 'plays', entity: 'Siiga' },
      { value: 2, unit: 'days', entity: 'Siiga' },
    ]));
    expect(d.edges).toEqual([]);
    expectGrounded(d);
  });

  it('discovery needs 8 plays', () => {
    const at = (n: number) => artistFacts(context({
      week: plays('Siiga', n, MON),
      artists: [artist({ artist: 'Siiga', tier: 'barely_known', plays: n, lifetimeBefore: 3 })],
      inputs: { now: JUNE_NOW },
    }));
    expect(ofKind(at(7), 'discovery')).toEqual([]);
    const d = only(at(8), 'discovery');
    expect(d.salience).toBe(54.4); // 40 + 60 * 0.9 * 8/30
    expectGrounded(d);
  });

  it('first under this name at 9 plays scores 58', () => {
    const d = only(artistFacts(context({
      week: plays('Andy Shauf', 9, ts('2026-11-04T19:00:00')),
      artists: [artist({ artist: 'Andy Shauf', tier: 'first_under_this_name', plays: 9, lifetimeBefore: 0 })],
    })), 'discovery');
    expect(d).toMatchObject({ subject: 'Andy Shauf', salience: 58 });
    expect(d.statement).toBe('Andy Shauf: first plays under this name, 9 this week; played on 1 day (Wed Nov 4).');
    expect(d.dates).toEqual([ts('2026-11-04T19:00:00')]);
    expect(d.edges).toContainEqual({ kind: 'one_sitting', text: 'Was that Andy Shauf stretch on Wed Nov 4 one sitting?' });
    expectGrounded(d);
  });

  it('discovery statement names the run and the days', () => {
    const run: AlbumRun = {
      artist: 'Siiga', album: 'Hidden Lake', from: MON, to: MON + 9 * 240, tracksPlayed: 10, tracklistLength: 10,
      coverage: 1, verdict: 'start_to_finish', phrase: 'Hidden Lake start to finish',
    };
    const d = only(artistFacts(context({ week: siigaWeek, artists: [siiga], runs: [run], inputs: { now: JUNE_NOW } })), 'discovery');
    expect(d.statement).toContain('only 3 plays before this week, 39 this week');
    expect(d.statement).toContain('including Hidden Lake start to finish');
    expect(d.statement).toContain('played on 2 days (Mon Jun 15, Thu Jun 18)');
    expect(d.entities).toEqual(['Siiga', 'Hidden Lake']);
    expect(d.dates).toEqual([MON, THU]);
    expectGrounded(d);
  });

  it('the run in a discovery reads exactly as the run phrase, with its numbers typed', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `t${i + 1}`);
    const scrobble = (album: string, tracks: string[], start: number): Scrobble[] =>
      tracks.map((track, i) => ({ artist: 'Siiga', album, track, ts: start + i * 240 }));
    const cases: Array<[Scrobble[], string]> = [
      [scrobble('A', ten.slice(1, 9), MON), '8 of 10 tracks of A, in order'],
      [scrobble('B', ten, MON), '10 tracks in a row from B'],
    ];
    for (const [week, phrase] of cases) {
      const runs = albumRuns(week, { [albumKey('Siiga', 'A')]: { tracklist: ten, userPlaycount: null, fetchedAt: NOW } });
      expect(runs[0].phrase).toBe(phrase);
      const d = only(artistFacts(context({
        week,
        artists: [artist({ artist: 'Siiga', tier: 'barely_known', plays: week.length, lifetimeBefore: 3 })],
        runs,
        inputs: { now: JUNE_NOW },
      })), 'discovery');
      expect(d.statement).toContain(`including ${phrase};`);
      expectGrounded(d);
    }
  });

  it('a mislabelled run is never quoted, and last week is counted inside the plays before', () => {
    const run: AlbumRun = {
      artist: 'Siiga', album: 'Hidden Lake', from: MON, to: MON + 9 * 240, tracksPlayed: 10, tracklistLength: 11,
      coverage: 0.2, verdict: 'mislabelled', phrase: 'mislabelled',
    };
    const d = only(artistFacts(context({
      week: siigaWeek,
      artists: [{ ...siiga, lifetimeBefore: 1, playsLastWeek: 1 }],
      runs: [run],
      inputs: { now: JUNE_NOW },
    })), 'discovery');
    expect(d.statement).toBe('Siiga: only 1 play before this week (1 of them last week), 39 this week; played on 2 days (Mon Jun 15, Thu Jun 18).');
    expectGrounded(d);
  });

  it('an unknown-tier artist gets no discovery, cluster or return, whatever its absence says', () => {
    const week = plays('Mystery', 12, ts('2026-11-04T10:00:00'));
    const drafts = artistFacts(context({
      week,
      artists: [artist({ artist: 'Mystery', tier: 'unknown', plays: 12, absentMonths: 12 })],
      inputs: { tags: { Mystery: ['jazz'] } },
    }));
    expect(drafts).toEqual([]);
  });
});

describe('volume against normal', () => {
  const FRI = ts('2026-11-06T10:00:00');
  const boc = (extra: Partial<ArtistWeek> = {}) => artist({ artist: 'Boards of Canada', tier: 'regular', plays: 41, ...extra });

  it('volume against normal: 41 plays against 6 a week scores 83.6', () => {
    const { prior, chartWeeks } = history({ 'Boards of Canada': 6 });
    const d = only(artistFacts(context({
      week: plays('Boards of Canada', 41, FRI), artists: [boc()], prior, inputs: { chartWeeks },
    })), 'volume_vs_normal');
    expect(d).toMatchObject({ subject: 'Boards of Canada', salience: 83.6 }); // 45 + 8*log2(41/6) + 16.4
    expect(d.statement).toBe('Boards of Canada: 41 plays this week against an average of 6 per week over the previous 12 weeks; '
      + 'all of them on Fri Nov 6.');
    expect(d.quantities).toEqual(expect.arrayContaining([
      { value: 41, unit: 'plays', entity: 'Boards of Canada' },
      { value: 6, unit: 'plays', entity: 'Boards of Canada' },
      { value: 12, unit: 'weeks' },
    ]));
    expect(d.edges).toEqual([]);
    expectGrounded(d);
  });

  it('volume ratio uses raw counts on both sides', () => {
    // Deduped 45 this week, raw 50; chart mean 6 (raw). Ratio 50/6 = 8.33, not 45/6 = 7.5.
    const { prior, chartWeeks } = history({ 'Boards of Canada': 6 });
    const d = only(artistFacts(context({
      week: plays('Boards of Canada', 45, FRI), artists: [boc({ plays: 45, rawPlays: 50 })], prior, inputs: { chartWeeks },
    })), 'volume_vs_normal');
    expect(d.salience).toBe(87.5); // 45 + 8*log2(50/6) + 45/2.5
    expect(d.statement).toContain('45 plays this week');
    expectGrounded(d);
  });

  it('volume fact is suppressed without a full baseline', () => {
    const { prior, chartWeeks } = history({ 'Boards of Canada': 6 });
    for (const baseline of ['partial', 'none'] as const) {
      const drafts = artistFacts(context({
        week: plays('Boards of Canada', 41, FRI), artists: [boc()], prior, inputs: { chartWeeks }, baseline,
      }));
      expect(drafts).toEqual([]);
    }
  });

  it('volume fact is suppressed for new and lapsed artists', () => {
    const { prior, chartWeeks } = history({ 'Boards of Canada': 2 });
    const tiers: ArtistSpec[] = [
      { artist: 'Boards of Canada', tier: 'first_under_this_name', plays: 41, lifetimeBefore: 0 },
      { artist: 'Boards of Canada', tier: 'barely_known', plays: 41, lifetimeBefore: 10 },
      { artist: 'Boards of Canada', tier: 'lapsed', plays: 41, lifetimeBefore: 300, absentMonths: 6 },
      { artist: 'Boards of Canada', tier: 'unknown', plays: 41 },
    ];
    for (const spec of tiers) {
      const drafts = artistFacts(context({ week: plays('Boards of Canada', 41, FRI), artists: [artist(spec)], prior, inputs: { chartWeeks } }));
      expect(ofKind(drafts, 'volume_vs_normal')).toEqual([]);
    }
  });

  it('a zero average suppresses the fact: a ratio with a zero denominator is no fact', () => {
    const { prior, chartWeeks } = history({ Other: 3 });
    const drafts = artistFacts(context({
      week: plays('Hammock', 20, FRI), artists: [artist({ artist: 'Hammock', tier: 'occasional', plays: 20 })], prior, inputs: { chartWeeks },
    }));
    expect(ofKind(drafts, 'volume_vs_normal')).toEqual([]);
  });

  it('an average under one play a week divides by the true mean', () => {
    // Hammock played once in each of 3 of the 12 baseline weeks: a mean of 0.25, so 20 plays is 80 times the usual.
    const { prior, chartWeeks } = history({ Other: 3 });
    const sparse = chartWeeks.map((w, i) => (i < 3 ? { ...w, counts: { ...w.counts, hammock: 1 } } : w));
    const d = only(artistFacts(context({
      week: plays('Hammock', 20, FRI), artists: [artist({ artist: 'Hammock', tier: 'occasional', plays: 20 })], prior, inputs: { chartWeeks: sparse },
    })), 'volume_vs_normal');
    expect(d.salience).toBe(85); // 45 + 8*log2(min(20/0.25, 16)) + 20/2.5
    expect(d.statement).toContain('against an average of under 1 per week');
    expect(d.quantities).toContainEqual({ value: 1, unit: 'plays', entity: 'Hammock' });
    expectGrounded(d);
  });

  it('a baseline with no weeks at all suppresses the fact', () => {
    const ctx = context({ week: plays('Hammock', 20, FRI), artists: [artist({ artist: 'Hammock', tier: 'occasional', plays: 20 })] });
    expect(artistFacts({ ...ctx, rawWeeks: [ctx.week], weeks: [ctx.week] })).toEqual([]);
  });

  it('missing chart weeks shrink the baseline and the statement says so', () => {
    const { prior } = history({ 'Boards of Canada': 6 });
    const d = only(artistFacts(context({ week: plays('Boards of Canada', 41, FRI), artists: [boc()], prior })), 'volume_vs_normal');
    expect(d.statement).toContain('over the previous 4 weeks');
    expect(d.quantities).toContainEqual({ value: 4, unit: 'weeks' });
    expectGrounded(d);
  });

  it('under 3 times the normal, or under 20 plays, is not a volume fact', () => {
    const { prior, chartWeeks } = history({ 'Boards of Canada': 14, Hammock: 0 });
    const drafts = artistFacts(context({
      week: [...plays('Boards of Canada', 41, FRI), ...plays('Hammock', 19, FRI + 86400)],
      artists: [boc(), artist({ artist: 'Hammock', tier: 'occasional', plays: 19 })],
      prior,
      inputs: { chartWeeks },
    }));
    expect(drafts).toEqual([]);
  });

  it('most plays on one day is stated with its count', () => {
    const { prior, chartWeeks } = history({ 'Boards of Canada': 6 });
    const week = [...plays('Boards of Canada', 30, FRI), ...plays('Boards of Canada', 11, FRI + 86400)];
    const d = only(artistFacts(context({ week, artists: [boc()], prior, inputs: { chartWeeks } })), 'volume_vs_normal');
    expect(d.statement).toContain('; 30 of them on Fri Nov 6.');
    expect(d.dates).toEqual([FRI]);
    expectGrounded(d);
  });

  it('no "stop" edge unless plays span 2+ days and end 36+ hours before the window end', () => {
    const { prior, chartWeeks } = history({ Meltt: 2 });
    const meltt = artist({ artist: 'Meltt', tier: 'regular', plays: 24 });
    const edgesFor = (week: Scrobble[]) =>
      only(artistFacts(context({ week, artists: [meltt], prior, inputs: { chartWeeks } })), 'volume_vs_normal').edges;

    const monWed = [...plays('Meltt', 12, ts('2026-11-02T10:00:00')), ...plays('Meltt', 12, ts('2026-11-04T10:00:00'))];
    expect(edgesFor(monWed)).toEqual([{ kind: 'after', text: 'What happened with Meltt after Wed Nov 4?' }]);

    const endsLate = [...plays('Meltt', 12, ts('2026-11-02T10:00:00')), ...plays('Meltt', 12, ts('2026-11-07T10:00:00'))];
    expect(edgesFor(endsLate)).toEqual([]); // last play Sat 10:44, under 36 h before Sun 21:17

    expect(edgesFor(plays('Meltt', 24, ts('2026-11-04T10:00:00')))).toEqual([]); // one day only
  });

  it('an artist with two start-to-finish listens of one album gets no volume fact', () => {
    const { prior, chartWeeks } = history({ 'Boards of Canada': 6 });
    const run = (from: number): AlbumRun => ({
      artist: 'Boards of Canada', album: 'Inferno', from, to: from + 3600, tracksPlayed: 12, tracklistLength: 12,
      coverage: 1, verdict: 'start_to_finish', phrase: 'Inferno start to finish',
    });
    const drafts = artistFacts(context({
      week: plays('Boards of Canada', 41, FRI), artists: [boc()], prior, inputs: { chartWeeks }, runs: [run(FRI), run(FRI + 7200)],
    }));
    expect(ofKind(drafts, 'volume_vs_normal')).toEqual([]);
  });

  it('four or more volume facts merge into one spread fact', () => {
    const names = ['Moby', 'Bowery Electric', 'Pink Floyd', 'Depeche Mode'];
    const base = history({ Moby: 6, 'Bowery Electric': 2, 'Pink Floyd': 0, 'Depeche Mode': 5 });
    // Pink Floyd had 3 plays across the 12 baseline weeks: a mean of 0.25, written as "under 1".
    const prior = base.prior.map((w, i) => (i === 0 ? [...w, ...plays('Pink Floyd', 3, w[0].ts + 60)] : w));
    const chartWeeks = base.chartWeeks;
    const counts = [41, 30, 22, 20];
    const week = names.flatMap((name, i) => plays(name, counts[i], FRI + i * 86400 / 4));
    const artists = names.map((name, i) => artist({ artist: name, tier: 'regular', plays: counts[i] }));

    const merged = artistFacts(context({ week, artists, prior, inputs: { chartWeeks } }));
    expect(ofKind(merged, 'volume_vs_normal')).toEqual([]);
    const d = only(merged, 'volume_spread');
    // Bowery Electric: 30 against 2 has the top single score, 45 + 8*log2(15) + 12.
    expect(d).toMatchObject({ subject: null, salience: 88.3, edges: [] });
    expect(d.statement).toBe('Four artists played at three or more times their usual weekly rate (average of the previous 12 weeks): '
      + 'Bowery Electric 30 (usual 2), Pink Floyd 22 (usual under 1), Moby 41 (usual 6), Depeche Mode 20 (usual 5).');
    expect(d.entities).toEqual(['Bowery Electric', 'Pink Floyd', 'Moby', 'Depeche Mode']);
    expect(d.quantities).toEqual(expect.arrayContaining([
      { value: 4, unit: 'artists' },
      { value: 3, unit: 'times' },
      { value: 22, unit: 'plays', entity: 'Pink Floyd' },
      { value: 1, unit: 'plays', entity: 'Pink Floyd' },
    ]));
    expectGrounded(d);

    const three = artistFacts(context({ week, artists: artists.slice(0, 3), prior, inputs: { chartWeeks } }));
    expect(ofKind(three, 'volume_vs_normal')).toHaveLength(3);
    expect(ofKind(three, 'volume_spread')).toEqual([]);
  });
});

describe('genre clusters and returns', () => {
  const WED = ts('2026-11-04T09:00:00');
  const lapsed = (name: string, n: number, before: number, absent: 3 | 6 | 12): ArtistWeek =>
    artist({ artist: name, tier: 'lapsed', plays: n, lifetimeBefore: before, absentMonths: absent });
  const weekOf = (artists: ArtistWeek[]): Scrobble[] =>
    artists.flatMap((a, i) => plays(a.artist, a.plays, WED + i * 7200));

  const jazz = [
    lapsed('Wes Montgomery', 8, 120, 6),
    lapsed('Wayne Shorter', 6, 45, 6),
    lapsed('Joe Henderson', 6, 80, 12),
    lapsed('Grant Green', 5, 30, 3),
  ];
  const jazzTags = {
    'Wes Montgomery': ['jazz', 'jazz guitar', 'guitar'],
    'Wayne Shorter': ['jazz', 'saxophone', 'hard bop'],
    'Joe Henderson': ['Jazz', 'hard bop', 'seen live'],
    'Grant Green': ['jazz', 'soul jazz', 'blue note'],
  };

  it('four lapsed jazz artists form a cluster scoring 87', () => {
    const drafts = artistFacts(context({ week: weekOf(jazz), artists: jazz, inputs: { tags: jazzTags } }));
    const d = only(drafts, 'genre_cluster');
    expect(d).toMatchObject({ subject: 'jazz', salience: 87 }); // 55 + 8*4
    expect(d.statement.startsWith('Four jazz artists came back in one week')).toBe(true);
    expect(d.statement).toBe("Four jazz artists came back in one week (Last.fm tag 'jazz'): "
      + 'Wes Montgomery (8 plays; 120 before, none in the 6+ months before this week); '
      + 'Joe Henderson (6 plays; 80 before, none in the 12+ months before this week); '
      + 'Wayne Shorter (6 plays; 45 before, none in the 6+ months before this week); '
      + 'Grant Green (5 plays; 30 before, none in the 3+ months before this week).');
    expect(d.entities).toEqual(['Wes Montgomery', 'Joe Henderson', 'Wayne Shorter', 'Grant Green']);
    expect(d.quantities).toEqual(expect.arrayContaining([
      { value: 4, unit: 'artists' },
      { value: 6, unit: 'plays', entity: 'Joe Henderson' },
      { value: 12, unit: 'months', entity: 'Joe Henderson' },
    ]));
    expectGrounded(d);
    // Every member is in the cluster, so no returns fact repeats them.
    expect(ofKind(drafts, 'returns')).toEqual([]);
  });

  it('broad tags never name a cluster', () => {
    const three = [lapsed('Doves', 9, 60, 6), lapsed('Elbow', 8, 90, 6), lapsed('Starsailor', 7, 25, 6)];
    const tags = { Doves: ['indie rock', 'britpop'], Elbow: ['indie rock', 'alternative'], Starsailor: ['indie rock', 'rock'] };
    const drafts = artistFacts(context({ week: weekOf(three), artists: three, inputs: { tags } }));
    expect(ofKind(drafts, 'genre_cluster')).toEqual([]);
    expect(only(drafts, 'returns').entities).toEqual(['Doves', 'Elbow', 'Starsailor']);
  });

  it('noise tags and tags with digits never name a cluster', () => {
    const three = [lapsed('Doves', 9, 60, 6), lapsed('Elbow', 8, 90, 6), lapsed('Starsailor', 7, 25, 6)];
    const tags = { Doves: ['british', '00s'], Elbow: ['british', '00s'], Starsailor: ['british', '00s'] };
    expect(ofKind(artistFacts(context({ week: weekOf(three), artists: three, inputs: { tags } })), 'genre_cluster')).toEqual([]);
  });

  it('mood tags never name a cluster, and a multi-word genre holding a mood word still does', () => {
    const three = [lapsed('Doves', 9, 60, 6), lapsed('Elbow', 8, 90, 6), lapsed('Starsailor', 7, 25, 6)];
    const moody = Object.fromEntries(three.map((a) => [a.artist, ['mellow', 'atmospheric', 'melancholic']]));
    const drafts = artistFacts(context({ week: weekOf(three), artists: three, inputs: { tags: moody } }));
    expect(ofKind(drafts, 'genre_cluster')).toEqual([]);
    expect(only(drafts, 'returns').entities).toEqual(['Doves', 'Elbow', 'Starsailor']);

    const genre = Object.fromEntries(three.map((a) => [a.artist, ['dark', 'dark ambient']]));
    const cluster = only(artistFacts(context({ week: weekOf(three), artists: three, inputs: { tags: genre } })), 'genre_cluster');
    expect(cluster.subject).toBe('dark ambient');
    expectGrounded(cluster);
  });

  it('an artist joins at most one cluster, the largest', () => {
    const members = [
      ...jazz,
      lapsed('Brian Eno', 7, 300, 6),
      lapsed('Harold Budd', 6, 50, 6),
    ];
    const tags = {
      ...jazzTags,
      'Grant Green': ['jazz', 'ambient'],
      'Brian Eno': ['ambient'],
      'Harold Budd': ['ambient'],
    };
    const one = artistFacts(context({ week: weekOf(members), artists: members, inputs: { tags } }));
    expect(only(one, 'genre_cluster').entities).toContain('Grant Green');
    // Eno and Budd are left with two ambient artists: no second cluster, so they are returns.
    expect(only(one, 'returns').entities).toEqual(['Brian Eno', 'Harold Budd']);

    const withThird = [...members, lapsed('Stars of the Lid', 6, 40, 12)];
    const two = artistFacts(context({
      week: weekOf(withThird), artists: withThird, inputs: { tags: { ...tags, 'Stars of the Lid': ['ambient'] } },
    }));
    const clusters = ofKind(two, 'genre_cluster');
    expect(clusters.map((c) => c.subject)).toEqual(['jazz', 'ambient']);
    expect(clusters[0].entities).toContain('Grant Green');
    expect(clusters[1].entities).toEqual(['Brian Eno', 'Harold Budd', 'Stars of the Lid']);
    expect(clusters[1].salience).toBe(79);
    clusters.forEach((c) => expectGrounded(c));
  });

  it('artists without tags join no cluster and break nothing', () => {
    const drafts = artistFacts(context({
      week: weekOf(jazz.slice(0, 3)), artists: jazz.slice(0, 3), inputs: { tags: { 'Wes Montgomery': ['jazz'] } },
    }));
    expect(ofKind(drafts, 'genre_cluster')).toEqual([]);
    expect(only(drafts, 'returns').entities).toEqual(['Wes Montgomery', 'Joe Henderson', 'Wayne Shorter']);
  });

  it('new artists form a cluster, and their discoveries are dropped into it', () => {
    const newcomers = [
      artist({ artist: 'Kamasi Washington', tier: 'first_under_this_name', plays: 12, lifetimeBefore: 0 }),
      artist({ artist: 'Makaya McCraven', tier: 'barely_known', plays: 9, lifetimeBefore: 2 }),
      artist({ artist: 'Nubya Garcia', tier: 'first_under_this_name', plays: 4, lifetimeBefore: 0 }),
    ];
    const tags = { 'Kamasi Washington': ['jazz'], 'Makaya McCraven': ['jazz'], 'Nubya Garcia': ['jazz'] };
    const drafts = artistFacts(context({ week: weekOf(newcomers), artists: newcomers, inputs: { tags } }));
    expect(ofKind(drafts, 'discovery')).toEqual([]);
    const d = only(drafts, 'genre_cluster');
    expect(d.statement).toBe("Three jazz artists that had few or no plays before this week, all in one week (Last.fm tag 'jazz'): "
      + 'Kamasi Washington (12 plays; first plays under this name); Makaya McCraven (9 plays; only 2 before); '
      + 'Nubya Garcia (4 plays; first plays under this name).');
    expect(d.salience).toBe(79);
    expect(d.edges).toEqual([]);
    expectGrounded(d);
  });

  it('a mixed cluster says the artists came back or had few or no plays before', () => {
    const mixed = [jazz[0], jazz[1], artist({ artist: 'Kamasi Washington', tier: 'first_under_this_name', plays: 12, lifetimeBefore: 0 })];
    const tags = { ...jazzTags, 'Kamasi Washington': ['jazz'] };
    const d = only(artistFacts(context({ week: weekOf(mixed), artists: mixed, inputs: { tags } })), 'genre_cluster');
    expect(d.statement.startsWith("Three jazz artists that either came back or had few or no plays before this week, all in one week "
      + "(Last.fm tag 'jazz'): ")).toBe(true);
    expectGrounded(d);
  });

  it('returns: lapsed artists outside clusters become one fact', () => {
    const back = [lapsed('Tracy Chapman', 12, 200, 12), lapsed('Doves', 8, 60, 6), lapsed('Elbow', 5, 90, 6)];
    const run: AlbumRun = {
      artist: 'Tracy Chapman', album: 'Tracy Chapman', from: WED, to: WED + 11 * 240, tracksPlayed: 11, tracklistLength: 11,
      coverage: 1, verdict: 'start_to_finish', phrase: 'Tracy Chapman start to finish',
    };
    const d = only(artistFacts(context({ week: weekOf(back), artists: back, runs: [run] })), 'returns');
    expect(d).toMatchObject({ subject: 'Tracy Chapman', salience: 60 }); // 45 + min(25, 20/2) + 5
    expect(d.statement).toBe('Came back to artists absent for months: '
      + 'Tracy Chapman (Tracy Chapman start to finish; 200 plays before, none in the 12+ months before this week); '
      + 'Doves (8 plays; 60 plays before, none in the 6+ months before this week).');
    expect(d.entities).toEqual(['Tracy Chapman', 'Doves']);
    expectGrounded(d);
  });

  it('absence is phrased against the boundary', () => {
    const back = [lapsed('Doves', 8, 60, 6)];
    const d = only(artistFacts(context({ week: weekOf(back), artists: back })), 'returns');
    expect(d.salience).toBe(49); // 45 + 8/2, no 12-month absence
    expect(d.statement).toContain('none in the 6+ months before this week');
    expect(d.statement).not.toMatch(/since|first time/);
    expect(d.edges).toEqual([]);
    expectGrounded(d);
  });

  it('an edge is attached for first under this name and for a 12-month return', () => {
    const tue = ts('2026-11-03T10:00:00');
    const first = only(artistFacts(context({
      week: [...plays('Andy Shauf', 6, tue), ...plays('Andy Shauf', 6, tue + 86400)],
      artists: [artist({ artist: 'Andy Shauf', tier: 'first_under_this_name', plays: 12, lifetimeBefore: 0 })],
    })), 'discovery');
    expect(first.edges.map((e) => e.kind)).toEqual(['where_from', 'started']);
    expect(first.edges).toEqual([
      { kind: 'where_from', text: 'Where did you come across Andy Shauf?' },
      { kind: 'started', text: 'What got you started on Andy Shauf this week?' },
    ]);

    const cluster = only(artistFacts(context({ week: weekOf(jazz), artists: jazz, inputs: { tags: jazzTags } })), 'genre_cluster');
    expect(cluster.edges).toEqual([{ kind: 'started', text: 'What got you back into jazz this week?' }]);

    const back = [lapsed('Tracy Chapman', 12, 200, 12)];
    const returns = only(artistFacts(context({ week: weekOf(back), artists: back })), 'returns');
    expect(returns.edges).toEqual([{ kind: 'started', text: 'What brought Tracy Chapman back after more than a year?' }]);

    const barely = only(artistFacts(context({
      week: plays('Siiga', 9, tue), artists: [artist({ artist: 'Siiga', tier: 'barely_known', plays: 9, lifetimeBefore: 3 })],
    })), 'discovery');
    expect(barely.edges).toEqual([]);
  });
});
