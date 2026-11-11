// ABOUTME: Tests for ranking and buildWeekFacts - fixture leads, baselines, truncation, merging, the quiet rule
// ABOUTME: and the code-chosen question (spec section 2, "Merging", "Quiet week", "Question"; section 1 caps).

import {
  QUIET_THRESHOLD, TRUNCATED_CAVEAT, albumKey, albumRuns, buildWeekFacts, chooseQuestion, dayLabel, dedupe, rankFacts, weekWindow,
} from '../src';
import type { Draft, Fact, FactKind, QuestionOption, Scrobble } from '../src';
import { NOW, expectGrounded, loadFixture, makeInputs, plays, ts } from './helpers';

const FIXTURES = ['bordesak-2026-05-24', 'bordesak-2026-05-31', 'bordesak-2026-06-12'];
const BASELINE_KINDS: FactKind[] = ['volume_vs_normal', 'volume_spread', 'breadth', 'album_mode', 'volume'];
const SHARE_KINDS: FactKind[] = ['album_mode', 'themed_block'];

const kinds = (facts: Fact[]): FactKind[] => facts.map((f) => f.kind);

const draft = (over: Partial<Draft>): Draft => ({
  kind: 'discovery', salience: 50, subject: null, statement: 'A fact.', entities: [], albums: [], quantities: [], dates: [], edges: [],
  ...over,
});

const fact = (over: Partial<Fact>): Fact => ({ id: 1, ...draft(over), ...over });

const MON = ts('2026-11-02T10:00:00');
const WED = ts('2026-11-04T10:00:00');

describe('fixture leads', () => {
  it('May 24 leads with the jazz cluster, then Boards of Canada', () => {
    const wf = buildWeekFacts(loadFixture('bordesak-2026-05-24'));
    expect(wf.facts[0]).toMatchObject({ id: 1, kind: 'genre_cluster', subject: 'jazz' });
    expect(wf.facts[1]).toMatchObject({ kind: 'volume_vs_normal', subject: 'Boards of Canada' });
    expect(wf.question?.text).toBe('What got you back into jazz this week?');
    expect(wf.plays).toMatchObject({ raw: 488, deduped: 455 });
  });

  it('Jun 12 leads with Siiga, then Celer and The Police', () => {
    const wf = buildWeekFacts(loadFixture('bordesak-2026-06-12'));
    expect(wf.facts.slice(0, 3).map((f) => f.subject)).toEqual(['Siiga', 'Celer', 'The Police']);
    expect(wf.facts[0].kind).toBe('discovery');
    expect(wf.question).toBeNull();
  });

  // Spec section 2's start_to_finish rule (>= 90% of the tracklist, including its first and last track) makes the
  // second listen most_of, so Death Cab for Cutie has one full listen and no repeat; the owner chose not to prescribe a May 31 lead.
  it('May 31 has no Death Cab repeat: the second I Built You A Tower listen covers 9 of 11 tracks', () => {
    const inputs = loadFixture('bordesak-2026-05-31');
    const { from, to } = weekWindow(inputs.now);
    const week = dedupe(inputs.scrobbles.filter((s) => s.ts >= from && s.ts < to)).kept;
    const tower = albumRuns(week, inputs.albums)
      .filter((r) => r.artist === 'Death Cab for Cutie' && r.album === 'I Built You A Tower');
    const second = tower.find((r) => r.from === 1780792595);
    expect(second).toMatchObject({ verdict: 'most_of', tracksPlayed: 9, tracklistLength: 11 });
    expect(Math.round((second?.coverage ?? 0) * 11)).toBe(9);
    expect(tower.filter((r) => r.verdict === 'start_to_finish')).toHaveLength(1);
    const facts = buildWeekFacts(inputs).facts;
    expect(facts.filter((f) => f.kind === 'repeat_album' && f.subject === 'Death Cab for Cutie')).toEqual([]);
  });

  it('never claims a first for a name with uncertain or unknown history', () => {
    for (const n of FIXTURES) {
      for (const f of buildWeekFacts(loadFixture(n)).facts) {
        if (f.statement.includes('first plays')) expect(f.statement).toContain('first plays under this name');
      }
    }
  });

  it('every fixture fact and the window fact are grounded, with ids from 0 and salience in order', () => {
    for (const n of FIXTURES) {
      const wf = buildWeekFacts(loadFixture(n));
      expect(wf.windowFact.id).toBe(0);
      expectGrounded(wf.windowFact, wf.timezone);
      wf.facts.forEach((f, i) => {
        expect(f.id).toBe(i + 1);
        expectGrounded(f, wf.timezone);
        if (i > 0) expect(f.salience).toBeLessThanOrEqual(wf.facts[i - 1].salience);
      });
    }
  });
});

describe('buildWeekFacts', () => {
  it('an empty week is quiet with no facts and no question', () => {
    const wf = buildWeekFacts(makeInputs({}));
    expect(wf.quiet).toBe(true);
    expect(wf.facts).toEqual([]);
    expect(wf.question).toBeNull();
    expect(wf.baseline).toBe('none');
    expect(wf.priorAverage).toBeNull();
    expect(wf.windowFact.statement).toBe('Week: Sun Nov 1 to Sun Nov 8 (rolling 7 days). 0 plays.');
    expect(wf.caveats).toEqual(['counts exclude likely duplicate scrobbles']);
  });

  it('fills the window, plays, top artists and names', () => {
    const inputs = makeInputs({ scrobbles: [...plays('A', 5, MON, 'Alpha'), ...plays('B', 7, WED, 'Beta')] });
    const wf = buildWeekFacts(inputs);
    expect(wf).toMatchObject({
      schema: 'week-facts/v1', username: 'listener', timezone: null, window: weekWindow(NOW), pulledAt: NOW,
      plays: { raw: 12, deduped: 12, duplicatesRemoved: 0 },
    });
    expect(wf.topArtists).toEqual([
      { artist: 'B', plays: 7, tier: 'unknown', nameUncertain: false },
      { artist: 'A', plays: 5, tier: 'unknown', nameUncertain: false },
    ]);
    expect(wf.names).toEqual(['A', 'Alpha', 'B', 'Beta']);
  });

  it('releasesChecked is false without releases and true with them', () => {
    const scrobbles = Array.from({ length: 10 }, (_, i) => ({ artist: 'Meltt', album: 'Eternal Embers', track: `t${i + 1}`, ts: MON + i * 240 }));
    const albums = { [albumKey('Meltt', 'Eternal Embers')]: { tracklist: scrobbles.map((s) => s.track), userPlaycount: 10, fetchedAt: NOW } };
    const without = buildWeekFacts(makeInputs({ scrobbles, albums }));
    expect(without.releasesChecked).toBe(false);
    expect(without.facts.filter((f) => f.kind === 'release_week')).toEqual([]);
    const releases = { [albumKey('Meltt', 'Eternal Embers')]: { title: 'Eternal Embers', artist: 'Meltt', date: '2026-11-02' } };
    const checked = buildWeekFacts(makeInputs({ scrobbles, albums, releases }));
    expect(checked.releasesChecked).toBe(true);
    expect(checked.facts.find((f) => f.kind === 'release_week')).toMatchObject({ salience: 80, subject: 'Meltt' });
    expect(buildWeekFacts(makeInputs({ scrobbles, albums, releases: {} })).releasesChecked).toBe(true);
  });

  it('a new account with one prior week has no baseline facts', () => {
    const prior = weekWindow(NOW, 1).from + 3600;
    // Enough this week to fire every baseline fact if a baseline existed: 30 plays of a regular against 1 a week.
    const inputs = makeInputs({
      scrobbles: [...plays('Regular', 2, prior), ...plays('Regular', 30, MON, 'Album', 60)],
      overall: { fetchedAt: NOW, complete: true, counts: { regular: 500 }, ranks: { regular: 100 } },
    });
    const wf = buildWeekFacts(inputs);
    expect(wf.baseline).toBe('none');
    expect(wf.priorAverage).toBeNull();
    expect(kinds(wf.facts).filter((k) => BASELINE_KINDS.includes(k))).toEqual([]);
    expect(wf.windowFact.statement).not.toContain('usual');
  });

  it('a full baseline states the 4-week average in the window fact', () => {
    const scrobbles = [4, 3, 2, 1].flatMap((w) => plays('Regular', 10 * w, weekWindow(NOW, w).from + 3600, 'Album', 60));
    const wf = buildWeekFacts(makeInputs({ scrobbles: [...scrobbles, ...plays('Regular', 20, MON, 'Album', 60)] }));
    expect(wf.baseline).toBe('full');
    expect(wf.priorAverage).toBe(25);
    expect(wf.windowFact.statement).toBe('Week: Sun Nov 1 to Sun Nov 8 (rolling 7 days). 20 plays; the usual week is about 25.');
    expect(wf.windowFact.quantities).toEqual([{ value: 7, unit: 'days' }, { value: 20, unit: 'plays' }, { value: 25, unit: 'plays' }]);
  });

  it('a truncated current week adds a caveat and drops share facts', () => {
    // Four quiet prior weeks with no albums; this week a jazz block on Monday (10% of the week), filler on Wednesday
    // and one 8-track album run on Friday (the highest album-mode share of the five weeks).
    const prior = [1, 2, 3, 4].flatMap((w) => plays('Filler', 10, weekWindow(NOW, w).from + 3600, ''));
    const jazz = ['J1', 'J2', 'J3', 'J4'];
    const block = jazz.flatMap((name, i) => plays(name, 3, MON + i * 3 * 360, '', 360));
    const inputs = makeInputs({
      scrobbles: [...prior, ...block, ...plays('Filler', 100, WED, ''), ...plays('Album Artist', 8, ts('2026-11-06T10:00:00'))]
        .sort((a, b) => a.ts - b.ts),
      tags: Object.fromEntries(jazz.map((name) => [name, ['jazz']])),
    });
    const full = buildWeekFacts(inputs);
    expect(kinds(full.facts)).toEqual(expect.arrayContaining(SHARE_KINDS));
    expect(full.caveats).not.toContain(TRUNCATED_CAVEAT);

    const wf = buildWeekFacts({ ...inputs, currentWeekTruncated: true });
    expect(kinds(wf.facts).filter((k) => SHARE_KINDS.includes(k))).toEqual([]);
    expect(wf.facts.length).toBe(full.facts.length - 2);
    expect(wf.caveats).toEqual([TRUNCATED_CAVEAT, 'counts exclude likely duplicate scrobbles']);
  });

  it('a partial history marks the baseline partial', () => {
    for (const n of FIXTURES) {
      const full = buildWeekFacts(loadFixture(n));
      expect(full.baseline).toBe('full');
      const wf = buildWeekFacts({ ...loadFixture(n), historyComplete: false });
      expect(wf.baseline).toBe('partial');
      expect(wf.priorAverage).toBeNull();
      expect(kinds(wf.facts).filter((k) => [...BASELINE_KINDS, 'last_week_faded'].includes(k))).toEqual([]);
    }
  });

  it('mislabelled runs become caveats in the artist-named wording', () => {
    const tracks = (prefix: string): Scrobble[] =>
      Array.from({ length: 8 }, (_, i) => ({ artist: 'Meltt', album: 'Wrong', track: `${prefix}${i}`, ts: MON + i * 240 }));
    const wf = buildWeekFacts(makeInputs({
      scrobbles: tracks('x'),
      albums: { [albumKey('Meltt', 'Wrong')]: { tracklist: Array.from({ length: 10 }, (_, i) => `y${i}`), userPlaycount: null, fetchedAt: NOW } },
    }));
    expect(wf.caveats[0]).toBe('Meltt tracks scrobbled as Wrong are mostly not on that album, so treat them as a run of Meltt tracks');
  });

  it('a discovery inside a cluster is dropped', () => {
    const names = ['Wes', 'Grant', 'Joe'];
    const wf = buildWeekFacts(makeInputs({
      scrobbles: names.flatMap((name, i) => plays(name, 10, MON + i * 7200)),
      artistLifetime: Object.fromEntries(names.map((name) => [name, { count: 10, fetchedAt: NOW }])),
      tags: Object.fromEntries(names.map((name) => [name, ['jazz']])),
    }));
    expect(wf.facts[0]).toMatchObject({ kind: 'genre_cluster', subject: 'jazz' });
    expect(kinds(wf.facts)).not.toContain('discovery');
  });

  it('a 25-play week with a 9-play first-timer is not quiet', () => {
    const wf = buildWeekFacts(makeInputs({
      scrobbles: [...plays('Newcomer', 9, MON), ...plays('Someone', 16, WED, 'Other')],
      artistLifetime: { Newcomer: { count: 9, fetchedAt: NOW } },
    }));
    expect(wf.plays.deduped).toBe(25);
    expect(wf.facts[0]).toMatchObject({ kind: 'discovery', subject: 'Newcomer', salience: 58 }); // 40 + 60 * 9/30
    expect(wf.facts[0].salience).toBeGreaterThanOrEqual(QUIET_THRESHOLD);
    expect(wf.quiet).toBe(false);
    expect(wf.question?.kind).toBe('where_from');
  });

  it('a week whose top fact scores under the threshold is quiet and has no question', () => {
    // No album, so no runs: the only fact is last week's top artist fading, at 45.
    const lastWeek = weekWindow(NOW, 1).from + 3600;
    const wf = buildWeekFacts(makeInputs({ scrobbles: [...plays('Old', 10, lastWeek, ''), ...plays('Someone', 30, MON, '')] }));
    expect(wf.facts.map((f) => [f.kind, f.salience])).toEqual([['last_week_faded', 45]]);
    expect(wf.quiet).toBe(true);
    expect(wf.question).toBeNull();
  });

  it('passes the last question through to the rotation', () => {
    const inputs = makeInputs({
      scrobbles: plays('Newcomer', 9, MON),
      artistLifetime: { Newcomer: { count: 9, fetchedAt: NOW } },
    });
    expect(buildWeekFacts(inputs).question?.kind).toBe('where_from');
    expect(buildWeekFacts(inputs, { lastQuestion: { kind: 'where_from', subject: 'Someone else' } }).question?.kind).toBe('started');
  });
});

describe('rankFacts', () => {
  it('scores are clamped to 100 and ties break by plays then name', () => {
    const facts = rankFacts([
      draft({ subject: 'Zed', salience: 70 }),
      draft({ subject: 'Bea', salience: 70 }),
      draft({ subject: 'Abe', salience: 70 }),
      draft({ subject: 'Max', salience: 130 }),
      draft({ subject: null, salience: -5, kind: 'volume' }),
    ], new Map([['Zed', 20], ['Bea', 5], ['Abe', 5], ['Max', 1]]));
    expect(facts.map((f) => [f.id, f.subject, f.salience])).toEqual([
      [1, 'Max', 100], [2, 'Zed', 70], [3, 'Abe', 70], [4, 'Bea', 70], [5, null, 0],
    ]);
  });

  it('a fact about a tag or about no one ties on the plays of the artists it names', () => {
    const facts = rankFacts([
      draft({ kind: 'themed_block', salience: 40, entities: ['A'] }),
      draft({ kind: 'themed_block', salience: 40, entities: ['B', 'C'] }),
    ], new Map([['A', 10], ['B', 6], ['C', 6]]));
    expect(facts.map((f) => f.entities)).toEqual([['B', 'C'], ['A']]);
  });

  const BOC = 'Boards of Canada';
  const BOC_VOLUME = 'Boards of Canada: 41 plays this week against an average of 2 per week over the previous 12 weeks';
  const volumeOf = (over: Partial<Draft> = {}): Draft => draft({
    kind: 'volume_vs_normal', salience: 60, subject: BOC, statement: `${BOC_VOLUME}.`, entities: [BOC],
    quantities: [{ value: 41, unit: 'plays', entity: BOC }, { value: 2, unit: 'plays', entity: BOC }, { value: 12, unit: 'weeks' }],
    ...over,
  });
  const inferno = (over: Partial<Draft> = {}): Draft => draft({
    kind: 'single_listen', salience: 70, subject: BOC,
    statement: 'Boards of Canada on Fri May 29: Inferno start to finish in one run; the album had 0 track plays before this week.',
    entities: [BOC, 'Inferno'],
    albums: [{ artist: BOC, album: 'Inferno' }],
    quantities: [{ value: 1, unit: 'times', entity: 'Inferno' }, { value: 0, unit: 'plays', entity: 'Inferno' }],
    dates: [ts('2026-05-29T20:00:00')],
    ...over,
  });

  it('a single listen folds into a volume fact about its artist, whatever the two saliences', () => {
    const friday = ts('2026-05-29T18:00:00');
    const volume = volumeOf({ statement: `${BOC_VOLUME}; all of them on Fri May 29.`, dates: [friday] });
    const facts = rankFacts([inferno(), volume]); // the listen (70) outscores the volume fact (60)
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      id: 1, kind: 'volume_vs_normal', salience: 60,
      statement: `${BOC_VOLUME}; all of them on Fri May 29; includes Inferno start to finish in one run; `
        + 'the album had 0 track plays before this week.',
      entities: [BOC, 'Inferno'],
      dates: [friday, ts('2026-05-29T20:00:00')],
    });
    expect(facts[0].quantities).toContainEqual({ value: 0, unit: 'plays', entity: 'Inferno' });
    expect(facts[0].quantities).toContainEqual({ value: 1, unit: 'times', entity: 'Inferno' }); // "in one run" stays grounded
    expectGrounded(facts[0]);
  });

  it('a folded single listen carries its album into the host', () => {
    const facts = rankFacts([volumeOf(), inferno()]);
    expect(facts).toHaveLength(1);
    expect(facts[0].albums).toEqual([{ artist: BOC, album: 'Inferno' }]);
    // An album the host already records is not recorded twice.
    const twice = rankFacts([volumeOf({ albums: [{ artist: BOC, album: 'Inferno' }] }), inferno()]);
    expect(twice[0].albums).toEqual([{ artist: BOC, album: 'Inferno' }]);
  });

  it('a volume fact that does not name the listen\'s day has the day written in', () => {
    const facts = rankFacts([volumeOf(), inferno()]);
    expect(facts[0]).toMatchObject({
      statement: `${BOC_VOLUME}; includes, on Fri May 29, Inferno start to finish in one run; the album had 0 track plays before this week.`,
      dates: [ts('2026-05-29T20:00:00')],
    });
    expectGrounded(facts[0]);
  });

  it('a single listen by an artist covered by another fact is dropped into it', () => {
    const strong = { salience: 90 }; // stronger than every host below
    const hosts: Draft[] = [
      draft({ kind: 'discovery', subject: 'A', entities: ['A'] }),
      draft({ kind: 'repeat_album', subject: 'A', entities: ['Record', 'A'] }),
      draft({ kind: 'genre_cluster', subject: 'jazz', entities: ['Wes', 'A', 'Joe'] }),
      draft({ kind: 'returns', subject: 'Joe', entities: ['Joe', 'A'], quantities: [{ value: 6, unit: 'months', entity: 'A' }] }),
      draft({ kind: 'volume_spread', entities: ['W', 'X', 'A', 'Y'] }),
    ];
    for (const host of hosts) {
      const facts = rankFacts([host, draft({ kind: 'single_listen', subject: 'A', entities: ['A', 'Album'], ...strong })]);
      expect(facts, host.kind).toEqual([{ id: 1, ...host }]);
    }
  });

  it('a fact that only names the artist, or names an album of that name, does not cover it', () => {
    const facts = rankFacts([
      draft({ kind: 'breadth', salience: 90, entities: ['B'] }),
      draft({ kind: 'last_week_faded', salience: 45, entities: ['B'] }),
      // A returns fact whose album shares the artist's name: only returned artists carry a months value.
      draft({ kind: 'returns', salience: 60, subject: 'Joe', entities: ['Joe', 'B'],
        quantities: [{ value: 9, unit: 'tracks', entity: 'B' }, { value: 12, unit: 'months', entity: 'Joe' }] }),
      draft({ kind: 'discovery', salience: 58, subject: 'C', entities: ['C'] }),
      draft({ kind: 'single_listen', salience: 80, subject: 'B', entities: ['B', 'Y'] }),
    ]);
    expect(kinds(facts)).toEqual(['breadth', 'single_listen', 'returns', 'discovery', 'last_week_faded']);
  });

  it('on May 24 the Boards of Canada volume fact carries the Inferno listen and its day', () => {
    const wf = buildWeekFacts(loadFixture('bordesak-2026-05-24'));
    const boc = wf.facts.find((f) => f.kind === 'volume_vs_normal' && f.subject === BOC);
    expect(boc?.entities).toContain('Inferno');
    expect(boc?.statement).toContain('includes Inferno start to finish');
    expect(boc?.dates.map((d) => dayLabel(d, wf.timezone))).toContain('Fri May 29');
    expect(wf.facts.filter((f) => f.kind === 'single_listen' && f.subject === BOC)).toEqual([]);
    if (boc) expectGrounded(boc, wf.timezone);
  });
});

describe('card albums', () => {
  it('May 24 card albums include Inferno by Boards of Canada', () => {
    const wf = buildWeekFacts(loadFixture('bordesak-2026-05-24'));
    expect(wf.cardAlbums).toContainEqual(expect.objectContaining({ artist: 'Boards of Canada', album: 'Inferno' }));
    expect(wf.cardAlbums.length).toBeGreaterThan(0);
    expect(wf.cardAlbums.length).toBeLessThanOrEqual(6);
    const plays = wf.cardAlbums.map((a) => a.plays);
    expect(plays).toEqual([...plays].sort((a, b) => b - a));
  });

  it('an empty week has no card albums', () => {
    expect(buildWeekFacts(makeInputs()).cardAlbums).toEqual([]);
  });
});

describe('chooseQuestion', () => {
  const where: QuestionOption = { kind: 'where_from', text: 'Where did you come across Siiga?' };
  const started: QuestionOption = { kind: 'started', text: 'What got you started on Siiga this week?' };
  const lead = fact({ id: 1, subject: 'Siiga', edges: [where, started] });

  it('takes the lead fact\'s first edge with no stored question', () => {
    expect(chooseQuestion([lead], null)).toEqual({ ...where, subject: 'Siiga' });
  });

  it('the question keeps the same text for the same subject and rotates kind for a new one', () => {
    expect(chooseQuestion([lead], { kind: 'started', subject: 'Siiga' })).toEqual({ ...started, subject: 'Siiga' });
    expect(chooseQuestion([lead], { kind: 'where_from', subject: 'Siiga' })).toEqual({ ...where, subject: 'Siiga' });
    expect(chooseQuestion([lead], { kind: 'where_from', subject: 'Celer' })).toEqual({ ...started, subject: 'Siiga' });
  });

  it('falls to rank 2 when rank 1 has no edge, or none that rotates away', () => {
    const after: QuestionOption = { kind: 'after', text: 'What happened with Celer after Wed Jun 17?' };
    const second = fact({ id: 2, subject: 'Celer', edges: [after] });
    expect(chooseQuestion([fact({ id: 1, subject: 'X' }), second], null)).toEqual({ ...after, subject: 'Celer' });
    const onlyWhere = fact({ id: 1, subject: 'Siiga', edges: [where] });
    expect(chooseQuestion([onlyWhere, second], { kind: 'where_from', subject: 'Someone' })).toEqual({ ...after, subject: 'Celer' });
  });

  it('no question when neither of the top two facts has an edge', () => {
    const third = fact({ id: 3, subject: 'Z', edges: [where] });
    expect(chooseQuestion([fact({ id: 1, subject: 'X' }), fact({ id: 2, subject: 'Y' }), third], null)).toBeNull();
    expect(chooseQuestion([], null)).toBeNull();
  });
});
