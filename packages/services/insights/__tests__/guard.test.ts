// ABOUTME: Tests for the note guard - the round 2 acceptance sentences pass, corrupted ones fail, and every
// ABOUTME: prompt-view fact's own statement passes when it cites only itself (spec section 3).

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PROMPT_FACTS, albumFacts, albumKey, albumRuns, artistFacts, buildWeekFacts, guardNote, guardSentence, releaseWeekFacts, weekFacts,
} from '../src';
import type { AlbumInfo, AlbumRun, ArtistWeek, Draft, Fact, FactKind, NoteSentence, Scrobble, WeekFacts } from '../src';
import { artist, context, history, loadFixture, only, plays, ts } from './helpers';
import type { Setup } from './helpers';

/** Every committed week fixture: the annotated weeks, the held-out weeks and the live week (not the gold summaries). */
const WEEKS = readdirSync(fileURLToPath(new URL('../__fixtures__/', import.meta.url)))
  .filter((file) => file.endsWith('.json') && file !== 'gold.json')
  .map((file) => file.replace(/\.json$/, ''))
  .sort();
const may24 = buildWeekFacts(loadFixture('bordesak-2026-05-24'));
const may31 = buildWeekFacts(loadFixture('bordesak-2026-05-31'));
const jun12 = buildWeekFacts(loadFixture('bordesak-2026-06-12'));

/** The id of the one fact of `kind` about `subject`. */
function idOf(wf: WeekFacts, kind: FactKind, subject: string | null): number {
  const found = wf.facts.filter((f) => f.kind === kind && f.subject === subject);
  expect(found).toHaveLength(1);
  return found[0].id;
}

const jazz = idOf(may24, 'genre_cluster', 'jazz');
const boc = idOf(may24, 'volume_vs_normal', 'Boards of Canada');
const shoegaze = idOf(may24, 'genre_cluster', 'shoegaze');
const returns = idOf(may24, 'returns', 'Tracy Chapman');

const S1: NoteSentence = {
  text: 'Four jazz names came back to you this week: Wes Montgomery with 8 plays, Wayne Shorter and Joe Henderson with 6 each, and Grant Green with 5, and Joe Henderson had been gone for 12+ months.',
  facts: [jazz],
};
const S2: NoteSentence = { text: 'Boards of Canada took over Friday with 41 plays, including Inferno start to finish.', facts: [boc] };
const say = (text: string, ...facts: number[]): NoteSentence => ({ text, facts });

/** `wf` with fact 1 replaced by `lead` and `names` added to the week's names. */
function withLead(
  wf: WeekFacts, lead: Omit<Fact, 'id' | 'salience' | 'edges' | 'albums'> & Partial<Pick<Fact, 'albums'>>, names: string[] = [],
): WeekFacts {
  return {
    ...wf,
    facts: [{ albums: [], ...lead, id: 1, salience: 100, edges: [] }, ...wf.facts.slice(1)],
    names: [...wf.names, ...names],
  };
}

// ---------- synthetic facts of every kind, built as the fact tests build them ----------

const MON = ts('2026-11-02T10:00:00');
const WED = ts('2026-11-04T10:00:00');
const THU = ts('2026-11-05T10:00:00');
const FRI = ts('2026-11-06T10:00:00');
const TEN = Array.from({ length: 10 }, (_, i) => `t${i + 1}`);

const listen = (name: string, album: string, tracks: string[], start: number): Scrobble[] =>
  tracks.map((track, i) => ({ artist: name, album, track, ts: start + i * 240 }));
const albums = (...entries: Array<[string, string, string[] | null, number | null]>): Record<string, AlbumInfo> =>
  Object.fromEntries(entries.map(([name, album, tracklist, userPlaycount]) =>
    [albumKey(name, album), { tracklist, userPlaycount, fetchedAt: ts('2026-11-08T21:17:00') }]));
const graded = (setup: Setup & { albums: Record<string, AlbumInfo> }) => {
  const { albums: lists, inputs = {}, ...rest } = setup;
  return context({ ...rest, inputs: { ...inputs, albums: lists }, runs: albumRuns(setup.week, lists) });
};
const regular = (name: string, n: number): ArtistWeek => artist({ artist: name, tier: 'regular', plays: n, lifetimeBefore: 500 });
const lapsed = (name: string, n: number, before: number, absent: 3 | 6 | 12): ArtistWeek =>
  artist({ artist: name, tier: 'lapsed', plays: n, lifetimeBefore: before, absentMonths: absent });
const weekOf = (artists: ArtistWeek[]): Scrobble[] => artists.flatMap((a, i) => plays(a.artist, a.plays, WED + i * 7200));
const names = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `Artist ${i >= 26 ? 'A' : ''}${String.fromCharCode(65 + (i % 26))}`);
const spread = (artists: string[], perArtist: number): Scrobble[] =>
  artists.flatMap((name, i) => plays(name, perArtist, MON + i * 3600, 'Album', 60));
const atTen = (artists: string[]): Record<string, number> => Object.fromEntries(artists.map((name) => [name, 10]));
const jazzFour = [
  lapsed('Wes Montgomery', 8, 120, 6), lapsed('Wayne Shorter', 6, 45, 6), lapsed('Joe Henderson', 6, 80, 12), lapsed('Grant Green', 5, 30, 3),
];
const jazzTags = Object.fromEntries(jazzFour.map((a) => [a.artist, ['jazz']]));

/** One or more facts of every kind, keyed by kind: a missing kind is a type error. */
const SYNTHETIC: Record<FactKind, () => Draft[]> = {
  discovery: () => {
    const run: AlbumRun = {
      artist: 'Siiga', album: 'Hidden Lake', from: MON, to: MON + 9 * 240, tracksPlayed: 10, tracklistLength: 10,
      coverage: 1, verdict: 'start_to_finish', phrase: 'Hidden Lake start to finish',
    };
    const week = [...plays('Siiga', 20, MON, 'Hidden Lake'), ...plays('Siiga', 19, THU, 'Hidden Lake')];
    const siiga = artist({ artist: 'Siiga', tier: 'barely_known', plays: 39, lifetimeBefore: 3, playsLastWeek: 1 });
    return [
      only(artistFacts(context({ week, artists: [siiga], runs: [run] })), 'discovery'),
      only(artistFacts(context({
        week: plays('Andy Shauf', 9, ts('2026-11-04T19:00:00')),
        artists: [artist({ artist: 'Andy Shauf', tier: 'first_under_this_name', plays: 9, lifetimeBefore: 0 })],
      })), 'discovery'),
    ];
  },
  repeat_album: () => [only(albumFacts(graded({
    week: [...listen('Meltt', 'Eternal Embers', TEN, MON), ...listen('Meltt', 'Eternal Embers', TEN, WED)],
    artists: [regular('Meltt', 20)],
    albums: albums(['Meltt', 'Eternal Embers', TEN, 3 + 20]),
  })), 'repeat_album')],
  volume_vs_normal: () => {
    const { prior, chartWeeks } = history({ 'Boards of Canada': 6 });
    const boc = artist({ artist: 'Boards of Canada', tier: 'regular', plays: 41 });
    return [
      only(artistFacts(context({ week: plays('Boards of Canada', 41, FRI), artists: [boc], prior, inputs: { chartWeeks } })), 'volume_vs_normal'),
      only(artistFacts(context({
        week: [...plays('Boards of Canada', 30, FRI), ...plays('Boards of Canada', 11, FRI + 86400)], artists: [boc], prior, inputs: { chartWeeks },
      })), 'volume_vs_normal'),
    ];
  },
  volume_spread: () => {
    const four = ['Moby', 'Bowery Electric', 'Pink Floyd', 'Depeche Mode'];
    const counts = [41, 30, 22, 20];
    const { prior, chartWeeks } = history({ Moby: 6, 'Bowery Electric': 2, 'Pink Floyd': 1, 'Depeche Mode': 5 });
    return [only(artistFacts(context({
      week: four.flatMap((name, i) => plays(name, counts[i], FRI + i * 86400 / 4)),
      artists: four.map((name, i) => artist({ artist: name, tier: 'regular', plays: counts[i] })),
      prior,
      inputs: { chartWeeks },
    })), 'volume_spread')];
  },
  genre_cluster: () => {
    const newcomers = [
      artist({ artist: 'Kamasi Washington', tier: 'first_under_this_name', plays: 12, lifetimeBefore: 0 }),
      artist({ artist: 'Makaya McCraven', tier: 'barely_known', plays: 9, lifetimeBefore: 2 }),
      artist({ artist: 'Nubya Garcia', tier: 'first_under_this_name', plays: 4, lifetimeBefore: 0 }),
    ];
    const newTags = Object.fromEntries(newcomers.map((a) => [a.artist, ['jazz']]));
    return [
      only(artistFacts(context({ week: weekOf(jazzFour), artists: jazzFour, inputs: { tags: jazzTags } })), 'genre_cluster'),
      only(artistFacts(context({ week: weekOf(newcomers), artists: newcomers, inputs: { tags: newTags } })), 'genre_cluster'),
    ];
  },
  returns: () => {
    const back = [lapsed('Tracy Chapman', 12, 200, 12), lapsed('Doves', 8, 60, 6), lapsed('Elbow', 5, 90, 6)];
    const run: AlbumRun = {
      artist: 'Tracy Chapman', album: 'Tracy Chapman', from: WED, to: WED + 11 * 240, tracksPlayed: 11, tracklistLength: 11,
      coverage: 1, verdict: 'start_to_finish', phrase: 'Tracy Chapman start to finish',
    };
    return [only(artistFacts(context({ week: weekOf(back), artists: back, runs: [run] })), 'returns')];
  },
  breadth: () => {
    const wide = history(atTen(names(18)));
    const narrow = history(atTen(names(4)));
    return [
      only(weekFacts(context({ week: spread(names(27), 10), artists: [], prior: wide.prior, inputs: { chartWeeks: wide.chartWeeks } })), 'breadth'),
      only(weekFacts(context({
        week: [...plays('Combichrist', 12, MON), ...plays('Ghost', 10, WED)], artists: [], prior: narrow.prior, inputs: { chartWeeks: narrow.chartWeeks },
      })), 'breadth'),
    ];
  },
  single_listen: () => [
    only(albumFacts(graded({
      week: plays('Brijean', 36, MON, 'Capri (Remastered 2026)'),
      artists: [regular('Brijean', 36)],
      albums: albums(['Brijean', 'Capri (Remastered 2026)', null, 36]),
    })), 'single_listen'),
    only(albumFacts(graded({
      week: listen('Tracy Chapman', 'Crossroads', TEN, MON),
      artists: [lapsed('Tracy Chapman', 10, 200, 12)],
      albums: albums(['Tracy Chapman', 'Crossroads', TEN, 10 + 2]),
    })), 'single_listen'),
  ],
  album_chain: () => [only(albumFacts(graded({
    week: [
      ...listen('Hammock', 'Oblivion Hymns', TEN, THU),
      ...listen('Stars of the Lid', 'And Their Refinement', TEN, THU + 10 * 240 + 600),
      ...listen('Hammock', 'Universalis', TEN, THU + 20 * 240 + 1200),
    ],
    artists: [regular('Hammock', 20), regular('Stars of the Lid', 10)],
    albums: albums(
      ['Hammock', 'Oblivion Hymns', TEN, null], ['Stars of the Lid', 'And Their Refinement', TEN, null], ['Hammock', 'Universalis', TEN, null],
    ),
  })), 'album_chain')],
  album_mode: () => {
    const weekWith = (start: number, inRuns: number, loose: number): Scrobble[] => [
      ...plays('Grouper', inRuns, start, 'Ruins'),
      ...plays('Various', loose, start + 6 * 3600, 'x').map((s, i) => ({ ...s, album: `Loose ${i}` })),
    ];
    const weekStart = (w: number) => ts('2026-11-08T21:17:00') - (w + 1) * 7 * 86400 + 3600;
    return [only(albumFacts(graded({
      week: weekWith(weekStart(0), 10, 10),
      artists: [regular('Grouper', 10), regular('Various', 10)],
      albums: albums(['Grouper', 'Ruins', plays('Grouper', 10, 0, 'Ruins').map((s) => s.track), null]),
      prior: [weekWith(weekStart(1), 8, 24), weekWith(weekStart(2), 0, 20), weekWith(weekStart(3), 8, 12), weekWith(weekStart(4), 2, 18)],
    })), 'album_mode')];
  },
  release_week: () => [
    only(releaseWeekFacts(graded({
      week: listen('Meltt', 'Eternal Embers', TEN, MON),
      artists: [regular('Meltt', 10)],
      albums: albums(['Meltt', 'Eternal Embers', TEN, 10]),
      inputs: { releases: { [albumKey('Meltt', 'Eternal Embers')]: { title: 'Eternal Embers', artist: 'Meltt', date: '2026-11-02' } } },
    })), 'release_week'),
    only(releaseWeekFacts(graded({
      week: listen('Meltt', 'Eternal Embers', TEN.slice(0, 8), WED),
      artists: [regular('Meltt', 8)],
      albums: albums(['Meltt', 'Eternal Embers', TEN, 8]),
      inputs: { releases: { [albumKey('Meltt', 'Eternal Embers')]: { title: 'Eternal Embers', artist: 'Meltt', date: '2026-11-02' } } },
    })), 'release_week'),
  ],
  last_week_faded: () => {
    const before = Object.entries({ 'Boards of Canada': 40, Hammock: 30, Grouper: 20, Moby: 10, Low: 5 })
      .flatMap(([name, n], i) => plays(name, n, MON - 7 * 86400 + i * 7200));
    const week = [...plays('Boards of Canada', 4, MON), ...plays('Hammock', 3, WED), ...plays('Grouper', 3, THU)];
    return [only(weekFacts(context({ week, artists: [], prior: [before, [], [], []] })), 'last_week_faded')];
  },
  themed_block: () => {
    const rock = ['Doves', 'Elbow', 'Starsailor', 'Keane'];
    const jazz = ['Wes Montgomery', 'Grant Green', 'Joe Henderson', 'Wayne Shorter'];
    const tags = Object.fromEntries([...rock.map((n) => [n, ['rock']]), ...jazz.map((n) => [n, ['jazz']])]);
    const block = ts('2026-11-04T20:00:00');
    const week = [
      ...rock.flatMap((name, i) => plays(name, 25, MON + i * 7200)),
      ...Array.from({ length: 12 }, (_, i) => ({ artist: jazz[i % jazz.length], album: 'Jazz', track: `j${i}`, ts: block + i * 330 })),
    ];
    return [only(weekFacts(context({ week, artists: [], inputs: { tags } })), 'themed_block')];
  },
  volume: () => {
    const { prior } = history({ Moby: 50, Hammock: 50 });
    const week = [...plays('Moby', 100, MON), ...plays('Hammock', 10, WED), ...plays('Grouper', 10, THU)];
    return [only(weekFacts(context({ week, artists: [], prior })), 'volume')];
  },
};

describe('guardNote', () => {
  it('passes the round 2 May 24 note', () => {
    expect(jazz).toBe(1);
    expect(guardNote([S1, S2], may24)).toEqual({ ok: true, failures: [] });
  });

  it('accepts number words, "twice", full weekday names and "a year" for 12 months', () => {
    // Round 2's May 31 lead. The port has no Death Cab repeat-album fact that week (one of the two listens is
    // most_of under the spec's verdict rule), so the round 2 fact is rebuilt here as the lead.
    const album = 'I Built You A Tower';
    const artist = 'Death Cab for Cutie';
    const fri = Date.parse('2026-06-05T19:00:00Z') / 1000;
    const sat = Date.parse('2026-06-06T19:00:00Z') / 1000;
    const wf = withLead(may31, {
      kind: 'repeat_album',
      subject: artist,
      statement: `${album} by ${artist} played start to finish 2 times (Fri Jun 5, Sat Jun 6), 44 plays of ${artist} this week. The album had 1 track play before this week, less than one full listen.`,
      entities: [album, artist],
      quantities: [
        { value: 2, unit: 'times', entity: album },
        { value: 44, unit: 'plays', entity: artist },
        { value: 1, unit: 'plays', entity: album },
        { value: 1, unit: 'times', entity: album },
      ],
      dates: [fri, sat],
    });
    const inferno = idOf(may31, 'repeat_album', 'Boards of Canada');
    expect(guardNote([
      say('You played I Built You A Tower by Death Cab for Cutie start to finish twice, on Friday and Saturday, after it had only one track play before this week.', 1),
      say('Inferno by Boards of Canada also got two full listens, on Monday and Friday.', inferno),
    ], wf)).toEqual({ ok: true, failures: [] });
    expect(guardNote([S1, say('Joe Henderson returned after a year away.', jazz)], may24)).toEqual({ ok: true, failures: [] });
  });

  it('rejects a count moved to another artist', () => {
    const result = guardNote([S1, say('Grant Green had 41 plays.', jazz, boc)], may24);
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(['s2:quantity-entity:41:plays']);
  });

  it('rejects a name from the week that is not in the cited facts', () => {
    // Cat Stevens is in the returns fact and not a top artist; Tracy Chapman, a top artist, counts as cited anywhere.
    const result = guardNote([S1, say('Wes Montgomery and Cat Stevens both came back.', jazz)], may24);
    expect(result).toEqual({ ok: false, failures: [`s2:name:fact${returns}`] });
    expect(guardNote([S1, say('Wes Montgomery and Tracy Chapman both came back.', jazz)], may24).ok).toBe(true);
    // A name in no fact at all is reported against the week.
    const wf = { ...may24, names: [...may24.names, 'Nobody Cited'] };
    expect(guardNote([S1, say('Nobody Cited came back too.', jazz)], wf).failures).toEqual(['s2:name:week']);
  });

  it('rejects a number in no cited fact', () => {
    expect(guardNote([S1, say('Wes Montgomery had 9 plays.', jazz)], may24).failures).toEqual(['s2:quantity:9:plays']);
    expect(guardNote([S1, say('Wes Montgomery came back with nine plays.', jazz)], may24).failures)
      .toEqual(['s2:quantity:9:plays']);
    expect(guardNote([S1, say('That made it 2,000 plays.', jazz)], may24).failures).toEqual(['s2:quantity:2000:plays']);
    expect(guardNote([S1, say('Wes Montgomery came back with twenty plays.', jazz)], may24).failures)
      .toEqual(['s2:quantity:word:twenty']);
  });

  it('reads years as 12 months each and fails fractions it cannot read', () => {
    expect(guardNote([S1, say('Joe Henderson returned after 1 year away.', jazz)], may24).ok).toBe(true);
    // 12 months is Joe Henderson's, not Wes Montgomery's.
    expect(guardNote([S1, say('Wes Montgomery returned after one year away.', jazz)], may24).failures)
      .toEqual(['s2:quantity-entity:12:months']);
    const bocMay31 = idOf(may31, 'repeat_album', 'Boards of Canada');
    expect(guardNote([
      say('Death Cab for Cutie had 44 plays.', 1),
      say('Inferno by Boards of Canada came back after two years, with 37 plays.', bocMay31),
    ], may31).failures).toEqual(['s2:quantity:24:months']);
    expect(guardNote([S1, say('Joe Henderson returned after a year and a half away.', jazz)], may24).failures)
      .toEqual(['s2:quantity:fraction:half']);
    expect(guardNote([S1, say('Joe Henderson returned after 12 and a half months away.', jazz)], may24).failures)
      .toEqual(['s2:quantity:fraction:half']);
  });

  it('matches the unit as well as the value when the sentence gives one', () => {
    // 6 is one of Joe Henderson's plays values, but no cited fact has 6 months.
    expect(guardNote([S1, say('Joe Henderson returned after half a year away.', jazz)], may24).failures)
      .toEqual(['s2:quantity-unit:6:months']);
    // The Boards of Canada fact has 12 weeks, not 12 months.
    expect(guardNote([S1, say('Boards of Canada came back after a year away.', boc)], may24).failures)
      .toEqual(['s2:quantity-unit:12:months']);
    expect(guardNote([S1, say('Wes Montgomery had 8 tracks.', jazz)], may24).failures).toEqual(['s2:quantity-unit:8:tracks']);
    // A hyphen or one describing word between the number and its unit still gives the unit.
    expect(guardNote([S1, say('Joe Henderson came back after a 6-month gap.', jazz)], may24).failures)
      .toEqual(['s2:quantity-unit:6:months']);
    expect(guardNote([S1, say('Joe Henderson came back after 6 long months away.', jazz)], may24).failures)
      .toEqual(['s2:quantity-unit:6:months']);
    expect(guardNote([S1, say('Joe Henderson came back after 6 straight weeks away.', jazz)], may24).failures)
      .toEqual(['s2:quantity-unit:6:weeks']);
    expect(guardNote([S1, say('Wes Montgomery had 8 different tracks in rotation.', jazz)], may24).failures)
      .toEqual(['s2:quantity-unit:8:tracks']);
    expect(guardNote([S1, say('Joe Henderson came back after a 1-year gap.', jazz)], may24).ok).toBe(true);
    // A word that ends the phrase is not a describing word: '6 per week' and '8 this week' carry no unit.
    expect(guardNote([S1, say('Wes Montgomery had 8 this week, against 6 per week for Joe Henderson.', jazz)], may24).ok)
      .toBe(true);
    // "track plays" reads as plays, as the statements type it.
    expect(guardNote([S1, say('Boards of Canada took over Friday with 41 plays; Inferno had 0 track plays before.', boc)], may24).ok)
      .toBe(true);
    // Known limit: the cluster types Joe Henderson's 70 plays before this week as {70, plays, Joe Henderson}, the
    // same unit and entity as his 6 this week, so the guard cannot tell a lifetime count from this week's.
    expect(guardNote([S1, say('Joe Henderson had 70 plays this week.', jazz)], may24).ok).toBe(true);
  });

  it('reads the unit across two describing words, hyphenated ones included', () => {
    const codes = (text: string): string[] => guardNote([S1, say(text, jazz)], may24).failures;
    // Each would read as an untyped 6 or 8 and match a play count if the unit were missed.
    expect(codes('Joe Henderson returned after 6 very long months.')).toEqual(['s2:quantity-unit:6:months']);
    expect(codes('Joe Henderson returned after 6 back-to-back weeks.')).toEqual(['s2:quantity-unit:6:weeks']);
    expect(codes('Wes Montgomery had 8 brand-new tracks.')).toEqual(['s2:quantity-unit:8:tracks']);
    expect(codes('Wes Montgomery had 8 really brand-new tracks.')).toEqual(['s2:quantity-unit:8:tracks']);
    // A unit word, a word that ends the phrase, a number word or punctuation is never a describing word, so the unit
    // read stops there: '8 plays across two long weeks' is 8 plays and 2 weeks, not 8 weeks.
    expect(codes('Wes Montgomery had 8 plays across two long weeks.')).toEqual(['s2:quantity:2:weeks']);
    expect(codes('Wes Montgomery had 8 plays across many weeks.')).toEqual([]);
    expect(codes('Wes Montgomery had 8 this week, against 6 per week for Joe Henderson.')).toEqual([]);
    expect(codes('Wes Montgomery came back with 8 after many months away.')).toEqual([]);
    expect(codes('Wes Montgomery had 8, long this week.')).toEqual([]);
    // Known limit: three describing words are past the reach, so the 8 is read without a unit.
    expect(codes('Wes Montgomery had 8 really very brand-new tracks.')).toEqual([]);
  });

  it('reads songs as tracks and spins as plays', () => {
    const codes = (text: string): string[] => guardNote([S1, say(text, jazz)], may24).failures;
    expect(codes('Wes Montgomery had 9 songs.')).toEqual(['s2:quantity:9:tracks']);
    expect(codes('Wes Montgomery had 8 songs.')).toEqual(['s2:quantity-unit:8:tracks']);
    expect(codes('Wes Montgomery had 8 spins.')).toEqual([]);
    expect(codes('Wes Montgomery had 9 spins.')).toEqual(['s2:quantity:9:plays']);
    expect(codes('Wes Montgomery had 1 spin.')).toEqual(['s2:quantity-unit:1:plays']);
    // "spins a week" is a rate, as "plays a week" is.
    expect(guardNote([S1, say('Boards of Canada took over Friday with 41 spins, after 6 spins a week before.', boc)], may24).ok)
      .toBe(true);
  });

  it('reads "song plays" as plays, as it reads "track plays"', () => {
    // Jun 12: fact 1 is Siiga, fact 2 is Celer, whose Capri (Remastered 2026) had 36 tracks in a row and 0 plays
    // before this week. The 36 plays are Celer's, so "36 song plays" for the album is a count moved to another name.
    const siiga = say('Siiga had 39 plays this week.', 1);
    const codes = (text: string): string[] => guardNote([siiga, say(text, 2)], jun12).failures;
    expect(codes('Capri (Remastered 2026) already had 36 song plays before this week.'))
      .toEqual(['s2:quantity-entity:36:plays']);
    expect(codes('Capri (Remastered 2026) already had 36 song play before this week.'))
      .toEqual(['s2:quantity-entity:36:plays']);
    expect(codes('Celer had 36 song plays on Fri Jun 19.')).toEqual([]);
    // Songs alone are still tracks.
    expect(codes('Celer played 36 tracks in a row from Capri (Remastered 2026).')).toEqual([]);
    expect(codes('Celer played 36 songs in a row from Capri (Remastered 2026).')).toEqual([]);
    expect(guardNote([S1, say('Wes Montgomery had 9 songs.', jazz)], may24).failures).toEqual(['s2:quantity:9:tracks']);
  });

  it('reads "an artist" and "an album" as no number, but counts digits and number words before them', () => {
    expect(guardNote([S1, say('Wes Montgomery, an artist you know well, had 8 plays.', jazz)], may24))
      .toEqual({ ok: true, failures: [] });
    expect(guardNote([S1, say('Boards of Canada took over Friday with 41 plays, all from an album called Inferno.', boc)], may24).ok)
      .toBe(true);
    expect(guardNote([S1, say('Wes Montgomery was one artist with 8 plays.', jazz)], may24).failures)
      .toEqual(['s2:quantity-unit:1:artists']);
  });

  it('fails plural number words', () => {
    expect(guardNote([S1, say('Wes Montgomery came back with hundreds of plays.', jazz)], may24).failures)
      .toEqual(['s2:quantity:word:hundreds']);
    expect(guardNote([S1, say('Wes Montgomery came back with dozens of plays.', jazz)], may24).failures)
      .toEqual(['s2:quantity:word:dozens']);
    expect(guardNote([S1, say('Wes Montgomery came back with thousands of plays.', jazz)], may24).failures)
      .toEqual(['s2:quantity:word:thousands']);
  });

  it('rejects "for the first time" unless a cited fact is a first-under-this-name discovery, and then only as "first plays under this name"', () => {
    expect(guardNote([S1, say('Wes Montgomery came back for the first time.', jazz)], may24).failures)
      .toEqual(['s2:banned:first-time']);
    expect(guardNote([S1, say('Slow Crush, NRTHRN and Spotlight Kid got their first plays under this name.', shoegaze)], may24))
      .toEqual({ ok: true, failures: [] });
    expect(guardNote([S1, say('Slow Crush got its first plays on record.', shoegaze)], may24).ok).toBe(true);
    expect(guardNote([S1, say('You heard Slow Crush for the first time.', shoegaze)], may24).failures)
      .toEqual(['s2:banned:first-time']);
    expect(guardNote([S1, say('Slow Crush got its first ever plays.', shoegaze)], may24).failures)
      .toEqual(['s2:banned:first-ever']);
    expect(guardNote([S1, say('Slow Crush had never come up before.', shoegaze)], may24).failures)
      .toEqual(['s2:banned:never']);
    expect(guardNote([S1, say('Grant Green got his first plays under this name.', jazz)], may24).failures)
      .toEqual(['s2:banned:first-plays']);
    expect(guardNote([S1, say('Slow Crush got its first plays this week.', shoegaze)], may24).failures)
      .toEqual(['s2:banned:first-plays']);
  });

  it('accepts the plural first-plays phrases only for two or more first-under-this-name artists', () => {
    expect(guardNote([S1, say('Slow Crush, NRTHRN and Spotlight Kid got their first plays under these names.', shoegaze)], may24))
      .toEqual({ ok: true, failures: [] });
    expect(guardNote([S1, say('Slow Crush, NRTHRN and Spotlight Kid got first plays under those names.', shoegaze)], may24))
      .toEqual({ ok: true, failures: [] });
    expect(guardNote([S1, say('Grant Green got his first plays under these names.', jazz)], may24).failures)
      .toEqual(['s2:banned:first-plays']);
  });

  it('rejects one sentence, seven sentences and a sentence citing nothing', () => {
    expect(guardNote([S1], may24).failures).toEqual(['shape:count:1']);
    expect(guardNote([S1, S2, S2, S2, S2, S2, S2], may24).failures).toEqual(['shape:count:7']);
    // Citing nothing, the sentence's names and numbers fail too.
    expect(guardNote([S1, { ...S2, facts: [] }], may24).failures).toContain('s2:shape:uncited');
    expect(guardNote([S1, { ...S2, facts: [boc, 99] }], may24).failures).toEqual(['s2:shape:unknown-fact:99']);
    // May 31 has a fact 7, outside the prompt view: the model never saw it, so it cannot cite it.
    const hidden = PROMPT_FACTS + 1;
    expect(may31.facts.some((f) => f.id === hidden)).toBe(true);
    expect(guardNote([say('Death Cab for Cutie had 44 plays.', 1), say('Boards of Canada had 37 plays.', hidden)], may31).failures)
      .toContain(`s2:shape:unknown-fact:${hidden}`);
  });

  it('accepts fact 1 cited by any sentence, and fails a note where no sentence cites it', () => {
    expect(guardNote([S2, S1], may24)).toEqual({ ok: true, failures: [] });
    expect(guardNote([S2, say('Tracy Chapman came back too.', returns)], may24).failures).toEqual(['shape:lead']);
  });

  it('fails only the uncited sentence when one sentence cites nothing', () => {
    const { failures } = guardNote([S1, { ...S2, facts: [] }], may24);
    expect(failures).toContain('s2:shape:uncited');
    expect(failures.every((code) => code.startsWith('s2:'))).toBe(true);
  });

  it('rejects an entry that packs in more than one sentence', () => {
    expect(guardNote([S1, say('Boards of Canada took over Friday with 41 plays. Inferno got a full listen.', boc)], may24).failures)
      .toEqual(['s2:shape:multiple-sentences']);
    expect(guardNote([S1, say('Boards of Canada took over Friday! 41 plays.', boc)], may24).failures)
      .toEqual(['s2:shape:multiple-sentences']);
    // An ellipsis is not a sentence end; a lone abbreviation full stop still is.
    expect(guardNote([S1, say('Boards of Canada took over Friday with 41 plays... all Inferno.', boc)], may24))
      .toEqual({ ok: true, failures: [] });
    expect(guardNote([S1, say('Boards of Canada took over Friday with 41 plays, approx. all of them Inferno.', boc)], may24).failures)
      .toEqual(['s2:shape:multiple-sentences']);
    // Full stops inside names are masked first.
    const names = ['R.E.M.', 'Calm, Vol. 3'];
    const wf = withLead(may24, {
      kind: 'volume_spread', subject: null, statement: 'R.E.M. and Calm, Vol. 3: 3 plays each.',
      entities: names, quantities: [{ value: 3, unit: 'plays' }], dates: [],
    }, names);
    expect(guardNote([say('R.E.M. and Calm, Vol. 3 had 3 plays each.', 1), S2], wf)).toEqual({ ok: true, failures: [] });
  });

  it('rejects a weekday the cited facts do not carry', () => {
    expect(guardNote([S1, say('Boards of Canada took over Tuesday with 41 plays.', boc)], may24).failures)
      .toEqual(['s2:day:tue']);
    expect(guardNote([S1, say('Boards of Canada took over Fri with 41 plays.', boc)], may24).ok).toBe(true);
    expect(guardNote([S1, say('Boards of Canada took over in June with 41 plays.', boc)], may24).failures)
      .toEqual(['s2:month:jun']);
    expect(guardNote([S1, say('Boards of Canada took over on Friday, May 29 with 41 plays.', boc)], may24).ok).toBe(true);
    expect(guardNote([S1, say('Boards of Canada took over on Fri May 30 with 41 plays.', boc)], may24).failures)
      .toEqual(['s2:date:fri-may-30']);
  });

  it('ignores digits inside matched names', () => {
    const wf = withLead(may24, {
      kind: 'repeat_album',
      subject: 'blink-182',
      statement: 'Prophecy At 1420 MHz by blink-182 played start to finish 3 times.',
      entities: ['Prophecy At 1420 MHz', 'blink-182'],
      quantities: [{ value: 3, unit: 'times', entity: 'Prophecy At 1420 MHz' }],
      dates: [],
    }, ['Prophecy At 1420 MHz', 'blink-182']);
    const lead = say('You played Prophecy At 1420 MHz by blink-182 start to finish three times.', 1);
    expect(guardNote([lead, S2], wf)).toEqual({ ok: true, failures: [] });
    expect(guardNote([say('You played blink-182 182 times.', 1), S2], wf).failures).toEqual(['s1:quantity:182:times']);
  });

  it('matches names with regex-special characters and diacritics', () => {
    const names = ['(Hummingbird in the Garden)', 'Sigur Rós', 'AC/DC'];
    const wf = withLead(may24, {
      kind: 'volume_spread',
      subject: null,
      statement: '(Hummingbird in the Garden), Sigur Rós and AC/DC: 3 plays each.',
      entities: names,
      quantities: [{ value: 3, unit: 'plays' }],
      dates: [],
    }, names);
    expect(guardNote([say('(Hummingbird in the Garden), Sigur Rós and AC/DC had 3 plays each.', 1), S2], wf).ok).toBe(true);
    // A decomposed accent and other casing still match after norm.
    expect(guardNote([say('SIGUR RÓS had 3 plays.', 1), S2], wf).ok).toBe(true);
    expect(guardNote([say('Sigur Rós had 3 plays.', 1), say('Boards of Canada took over Friday with 41 plays, more than AC/DC.', boc)], wf).failures)
      .toEqual(['s2:name:fact1']);
  });

  it('matches whole names only', () => {
    const wf = { ...may24, names: [...may24.names, 'Air'] };
    expect(guardNote([S1, say('Boards of Canada filled the airwaves Friday with 41 plays.', boc)], wf).ok).toBe(true);
  });

  it('counts a one-word name only when spelt as given, and longer names in any case', () => {
    // May 24's scrobbles carry an "Is" and a "Day", so these words are names only when written as given.
    expect(may24.names).toEqual(expect.arrayContaining(['Is', 'Day']));
    expect(guardNote([S1, say('Boards of Canada is the act that took over Friday, with 41 plays that day.', boc)], may24))
      .toEqual({ ok: true, failures: [] });
    expect(guardNote([S1, say('Day came back too.', jazz)], may24).failures).toEqual(['s2:name:week']);
    // Names of two or more words are matched whatever the case, so a lower-cased name outside the cited facts fails.
    expect(guardNote([S1, say('Wes Montgomery and cat stevens both came back.', jazz)], may24).failures)
      .toEqual([`s2:name:fact${returns}`]);
    // A name spelt in lower case is matched whatever the case.
    const wf = { ...may24, names: [...may24.names, 'hubris.'] };
    expect(guardNote([S1, say('hubris. came back too.', jazz)], wf).failures).toEqual(['s2:name:week']);
  });

  it('fact 0 may be cited for the week total and average', () => {
    expect(guardNote([S1, say('The week had 455 plays, against a usual 446.', 0)], may24))
      .toEqual({ ok: true, failures: [] });
    expect(guardNote([S1, say('The week had 456 plays.', 0)], may24).failures).toEqual(['s2:quantity:456:plays']);
  });

  it('reads "a week" after a number as a rate, not as 1 week', () => {
    // "N a week" is "N per week"; "a week" on its own is still 1 week.
    expect(guardNote([S1, say('Boards of Canada took over Friday with 41 plays, after 6 a week before.', boc)], may24).ok)
      .toBe(true);
    expect(guardNote([S1, say('Boards of Canada took over Friday with 41 plays, after 6 plays a week before.', boc)], may24).ok)
      .toBe(true);
    // The BoC fact carries a 1 (its folded Inferno listen came "in one run"), so the 1 week fails on its unit.
    expect(guardNote([S1, say('Boards of Canada took over Friday with 41 plays, after a week away.', boc)], may24).failures)
      .toEqual(['s2:quantity-unit:1:weeks']);
  });

  it('reads the word after "<N>-" as the unit when it is one', () => {
    expect(guardNote([S1, say('Wes Montgomery had an 8-play week.', jazz)], may24)).toEqual({ ok: true, failures: [] });
    expect(guardNote([S1, say('Wes Montgomery had a 9-play week.', jazz)], may24).failures).toEqual(['s2:quantity:9:plays']);
  });

  it('ties every number to the one named entity, whatever the punctuation, clause or word order', () => {
    for (const text of [
      'Grant Green had 41 plays.',
      'Grant Green, with 41 plays, came back this week.',
      'Grant Green came back and had 41 plays.',
      'Grant Green returned; he had 41 plays.',
      'You gave 41 plays to Grant Green.',
    ]) {
      expect(guardNote([S1, say(text, jazz, boc)], may24).failures, text).toEqual(['s2:quantity-entity:41:plays']);
    }
    expect(guardNote([S1, say('Joe Henderson came back after 3+ months.', jazz)], may24).failures)
      .toEqual(['s2:quantity-entity:3:months']);
    // A clause about the others is still tied to the one named artist, however it is punctuated.
    const codes = (text: string): string[] => guardNote([S1, say(text, jazz, boc)], may24).failures;
    expect(codes('Joe Henderson came back, the others returned after 3+ months,8 plays went to him.'))
      .toEqual(['s2:quantity-entity:3:months', 's2:quantity-entity:8:plays']);
    expect(codes('Joe Henderson came back, the others returned after 3+ months;8 plays went to him.'))
      .toEqual(['s2:quantity-entity:3:months', 's2:quantity-entity:8:plays']);
    expect(codes('Joe Henderson came back, and the others had 8 plays.')).toEqual(['s2:quantity-entity:8:plays']);
    expect(codes('Joe Henderson came back, the other 3.5 returned after 3+ months.'))
      .toEqual(['s2:quantity:3.5', 's2:quantity-entity:3:months']);
  });

  it('rejects a collective claim about the named artist\'s peers', () => {
    // The guard does not support group claims ("the other three", "the others", "the rest"): under spec section 3,
    // rule 2, a sentence that names one cited entity may only state that entity's quantities or untied ones. The 3
    // months belong to the three peers the sentence leaves unnamed, so it fails, and the note regenerates or falls back.
    // "Three" is read as a plain 3, and the only 3s in the fact are the peers' months.
    expect(guardNote([S1, say('Joe Henderson had gone unplayed for 12+ months, the other three for 3+ months.', jazz)], may24).failures)
      .toEqual(['s2:quantity-entity:3:months', 's2:quantity-entity:3']);
    expect(guardNote([S1, say('The others had gone unplayed for 3+ months, Joe Henderson for 12+ months.', jazz)], may24).failures)
      .toEqual(['s2:quantity-entity:3:months']);
  });

  it('reads "a <unit> of" as a figure of speech, not 1 of that unit', () => {
    // The returns fact carries no 1, so a counted "a week" or "a day" would fail.
    expect(guardNote([S1, say('It was a week of returns, with Tracy Chapman back on 13 plays.', returns)], may24))
      .toEqual({ ok: true, failures: [] });
    expect(guardNote([S1, say('Tracy Chapman and Cat Stevens made it a day of returns.', returns)], may24))
      .toEqual({ ok: true, failures: [] });
    // Without "of", "a week" is still 1 week.
    expect(guardNote([S1, say('Tracy Chapman came back after a week away.', returns)], may24).failures)
      .toEqual(['s2:quantity:1:weeks']);
  });

  it('reads "a week already full of" and "a day full of" as figures of speech', () => {
    expect(guardNote([S1, say('It was a week already full of returns, with Tracy Chapman back on 13 plays.', returns)], may24))
      .toEqual({ ok: true, failures: [] });
    expect(guardNote([S1, say('Tracy Chapman made it a day full of returns.', returns)], may24))
      .toEqual({ ok: true, failures: [] });
    expect(guardNote([S1, say('Tracy Chapman came back after a week out of rotation.', returns)], may24).failures)
      .toEqual(['s2:quantity:1:weeks']);
  });

  it('reads "a <unit> full of" or "a <unit> of" after "after", "for", "in" or "within" as a duration of 1', () => {
    expect(guardNote([S1, say('Tracy Chapman came back after a week full of silence.', returns)], may24).failures)
      .toEqual(['s2:quantity:1:weeks']);
    expect(guardNote([S1, say('Tracy Chapman came back after a week of silence.', returns)], may24).failures)
      .toEqual(['s2:quantity:1:weeks']);
    expect(guardNote([S1, say('Tracy Chapman was gone for a month full of other records.', returns)], may24).failures)
      .toEqual(['s2:quantity:1:months']);
    expect(guardNote([S1, say('Tracy Chapman came back within a day of Cat Stevens.', returns)], may24).failures)
      .toEqual(['s2:quantity:1:days']);
    expect(guardNote([S1, say('Tracy Chapman got 13 plays in a week full of returns.', returns)], may24).failures)
      .toEqual(['s2:quantity:1:weeks']);
  });

  it('reads "at once" as no number, and "once" on its own as 1 time', () => {
    expect(guardNote([S1, say('Tracy Chapman and Cat Stevens came back at once.', returns)], may24))
      .toEqual({ ok: true, failures: [] });
    expect(guardNote([S1, say('Tracy Chapman came back once.', returns)], may24).failures)
      .toEqual(['s2:quantity:1:times']);
  });

  describe('"in one day", "in a single day", "in one sitting" and "in one go"', () => {
    // Fact 1 as a Boards of Canada Friday that carries no 1, so a counted idiom fails.
    const fridayDates = may24.facts.find((f) => f.id === boc)!.dates;
    const friday = withLead(may24, {
      kind: 'volume_vs_normal',
      subject: 'Boards of Canada',
      statement: 'Boards of Canada: 41 plays this week against an average of 6 per week over the previous 12 weeks; all of them on Fri May 29.',
      entities: ['Boards of Canada'],
      quantities: [
        { value: 41, unit: 'plays', entity: 'Boards of Canada' },
        { value: 6, unit: 'plays', entity: 'Boards of Canada' },
        { value: 12, unit: 'weeks' },
      ],
      dates: fridayDates,
    });
    const tracy = say('Tracy Chapman came back too.', returns);
    const lead = (text: string): string[] => guardNote([say(text, 1), tracy], friday).failures;

    it.each([
      ['in one day', '1:days'],
      ['in a single day', '1:days'],
      ['in one sitting', '1'],
      ['in one go', '1'],
    ])('reads "%s" as no number beside a cited weekday or date, and as 1 without one', (idiom, code) => {
      expect(lead(`Friday belonged to Boards of Canada, all 41 plays ${idiom}.`)).toEqual([]);
      expect(lead(`On Fri May 29 Boards of Canada got all 41 plays ${idiom}.`)).toEqual([]);
      expect(lead(`Boards of Canada had 41 plays ${idiom}.`)).toEqual([`s1:quantity:${code}`]);
      // A weekday the cited facts do not carry grounds nothing.
      expect(lead(`Tuesday belonged to Boards of Canada, all 41 plays ${idiom}.`))
        .toEqual(['s1:day:tue', `s1:quantity:${code}`]);
    });
  });

  it('rejects an em dash and a question mark in any sentence', () => {
    expect(guardNote([{ ...S1, text: S1.text.replace(': ', ' — ') }, S2], may24).failures)
      .toEqual(['s1:punctuation:em-dash']);
    expect(guardNote([S1, say('Did Boards of Canada take over Friday?', boc)], may24).failures)
      .toEqual(['s2:punctuation:question-mark']);
  });
});

describe('guardSentence', () => {
  // Grounded sentences from the week-facts-r1 eval that the guard used to fail, each citing what its run cited.
  const live = buildWeekFacts(loadFixture('bordesak-live-2026-11-09'));
  it.each([
    ['live, run 1', live, 'Mutemath got 22 plays this week, all of them on Sun Nov 8, after averaging under 1 a week over the previous 12 weeks.', [1]],
    ['live, run 2', live, 'Mutemath came back hard: 22 plays this week, all of them on Sun Nov 8, after averaging under 1 a week over the previous 12 weeks.', [1]],
    ['Jun 12, run 2', jun12, 'Both tied at the top of a 437-play week.', [0, 1, 2]],
  ] as Array<[string, WeekFacts, string, number[]]>)('passes the eval sentence from %s', (_label, wf, text, facts) => {
    expect(guardSentence({ text, facts }, wf)).toEqual([]);
  });

  // True sentences the guard rejects by design: each names one artist and states its peers' months as a group, which
  // rule 2 does not support (see 'rejects a collective claim about the named artist's peers').
  it.each([
    ['May 24, run 1', 'Joe Henderson had gone unplayed for 12+ months, the other three for 3+ months.'],
    ['May 24, run 2', 'Joe Henderson had gone unplayed for over a year, and the other three for more than 3 months.'],
  ])('fails the group-claim eval sentence from %s', (_label, text) => {
    expect(guardSentence({ text, facts: [1] }, may24)).toEqual(['quantity-entity:3:months', 'quantity-entity:3']);
  });

  it('reads every committed week fixture', () => {
    expect(WEEKS).toHaveLength(6);
  });

  it.each(WEEKS)('passes each prompt-view fact of %s citing only its own statement', (week) => {
    const wf = buildWeekFacts(loadFixture(week));
    const facts = [wf.windowFact, ...wf.facts.slice(0, PROMPT_FACTS)];
    expect(facts.length).toBeGreaterThan(1);
    for (const f of facts) {
      expect({ id: f.id, failures: guardSentence({ text: f.statement, facts: [f.id] }, wf) }).toEqual({ id: f.id, failures: [] });
    }
  });

  it.each(Object.entries(SYNTHETIC) as Array<[FactKind, () => Draft[]]>)(
    'passes each synthetic %s fact citing only its own statement',
    (kind, build) => {
      const drafts = build();
      expect(drafts.length).toBeGreaterThan(0);
      for (const d of drafts) {
        expect(d.kind).toBe(kind);
        // The draft as fact 1 of a week whose only names are its own.
        const wf: WeekFacts = { ...may24, timezone: null, facts: [{ ...d, id: 1 }], names: d.entities };
        expect({ statement: d.statement, failures: guardSentence({ text: d.statement, facts: [1] }, wf) })
          .toEqual({ statement: d.statement, failures: [] });
      }
    },
  );
});

describe('owner rulings after the week-trivia eval', () => {
  /** The release lookups the eval made, so the fact ids match the prompt view each run saw. */
  const released = (artist: string, album: string, date: string) => ({ [albumKey(artist, album)]: { title: album, artist, date } });
  const may31Released = buildWeekFacts({
    ...loadFixture('bordesak-2026-05-31'),
    releases: released('Death Cab for Cutie', 'I Built You A Tower', '2026-06-05'),
  });
  const sep20Released = buildWeekFacts({
    ...loadFixture('bordesak-heldout-2026-09-20'),
    releases: {
      ...released('Linkin Park', 'Unshatter Film Soundtrack (Live in São Paulo)', '2026-09-25'),
      ...released('Leon Bridges', 'Happiness Anytime', '2026-09-25'),
      ...released('Hermanos Gutiérrez', 'Los Ojos Del Cóndor', '2026-09-25'),
    },
  });
  const aug2 = buildWeekFacts({ ...loadFixture('bordesak-heldout-2026-08-02'), releases: {} });
  const live = buildWeekFacts({ ...loadFixture('bordesak-live-2026-11-09'), releases: {} });

  it('builds the weeks the eval runs saw', () => {
    expect(sep20Released.facts.slice(2, 5).map((f) => f.kind)).toEqual(['release_week', 'release_week', 'release_week']);
    expect(may31Released.facts.slice(4, 6).map((f) => f.subject)).toEqual(['Seasurfer', 'Def Leppard']);
  });

  describe('the top-artists line counts as cited by every sentence', () => {
    // The eval's extra weeks belong to other listeners and are not committed, so their top artists are spliced into
    // May 24, whose cited facts carry none of these names or counts.
    const spliced: WeekFacts = {
      ...may24,
      topArtists: [
        { artist: 'Sisters of Mercy', plays: 17, tier: 'all_time_favourite', nameUncertain: false },
        { artist: 'Motörhead', plays: 17, tier: 'all_time_favourite', nameUncertain: false },
        { artist: 'Siouxsie and the Banshees', plays: 7, tier: 'all_time_favourite', nameUncertain: false },
        { artist: 'Depeche Mode', plays: 6, tier: 'all_time_favourite', nameUncertain: false },
      ],
      names: [...may24.names, 'Sisters of Mercy', 'Motörhead', 'Siouxsie and the Banshees', 'Depeche Mode'],
    };

    it.each([
      ['extra-1 r2, run 2', 'Sisters of Mercy and Motörhead still sat on top with 17 plays each, so the newcomers crowded in around your old anchors.', [1, 2, 3]],
      ['extra-2 r1, run 1', 'Your old favourites kept their usual seats, Siouxsie and the Banshees with 7 and Depeche Mode with 6.', [2]],
      ['extra-2 r2, run 1', 'Your favourites held their usual ground underneath, with Siouxsie and the Banshees on 7 and Depeche Mode on 6.', [2]],
    ] as Array<[string, string, number[]]>)('passes the eval sentence from %s', (_label, text, facts) => {
      expect(guardSentence({ text, facts }, spliced)).toEqual([]);
    });

    it('still fails a sentence that cites nothing, on its shape only', () => {
      expect(guardSentence({ text: 'Above all that, Motörhead and Sisters of Mercy held the top spot together on 17 plays each.', facts: [] }, spliced))
        .toEqual(['shape:uncited']);
    });

    it('ties a top artist\'s play count to that artist', () => {
      // Gary Clark Jr. (6 plays, fact 4) is not a top artist; Meltt (38) is.
      expect(live.topArtists.map((a) => a.artist)).not.toContain('Gary Clark Jr.');
      expect(guardSentence({ text: 'Meltt had 38 plays.', facts: [4] }, live)).toEqual([]);
      expect(guardSentence({ text: 'Meltt had 6 plays.', facts: [4] }, live)).toEqual(['quantity-entity:6:plays']);
      // 15 is Seefeel's top-artist count, which only a sentence naming Seefeel before the 15 can use.
      expect(guardSentence({ text: 'Meltt had 15 plays.', facts: [4] }, live)).toEqual(['quantity:15:plays']);
      expect(guardSentence({ text: 'Meltt had 39 plays.', facts: [4] }, live)).toEqual(['quantity:39:plays']);
    });

    it('matches a top artist\'s plays only after that artist\'s name, with no other name in between', () => {
      // May 24's shoegaze fact (3) carries no 6 and no 17, so only the top-artists line could supply them.
      const say3 = (text: string): string[] => guardSentence({ text, facts: [3] }, spliced);
      expect(say3('Sisters of Mercy had 17 plays and Depeche Mode had 6.')).toEqual([]);
      expect(say3('Sisters of Mercy had 6 plays and Depeche Mode had 17 plays.'))
        .toEqual(['quantity:6:plays', 'quantity:17:plays']);
      expect(say3('Sisters of Mercy and Depeche Mode both had 17 plays.')).toEqual(['quantity:17:plays']);
      expect(say3('17 plays went to Sisters of Mercy.')).toEqual(['quantity:17:plays']);
      // Live: 38 is Meltt's; Gary Clark Jr. (fact 4) is not a top artist, and fact 4 carries no 38.
      expect(guardSentence({ text: 'Gary Clark Jr. had 38 plays alongside Meltt.', facts: [4] }, live)).toEqual(['quantity:38:plays']);
      expect(guardSentence({ text: 'You had 38 plays this week.', facts: [4] }, live)).toEqual(['quantity:38:plays']);
    });

    it('reads no quantity from a tier label', () => {
      // Seefeel's tier is "barely known before this week"; the line gives no number but its 15 plays.
      expect(guardSentence({ text: 'Seefeel had 3 plays.', facts: [6] }, live)).toEqual(['quantity:3:plays']);
    });
  });

  describe('a count of the cited facts\' albums or artists', () => {
    it.each([
      ['Sep 20 r1 and r2, run 1', sep20Released, 'Friday was the story this week: three new albums landed on Sep 25 and you went straight through all of them that day.', [3, 4, 5]],
      ['Sep 20 r2, run 2', sep20Released, 'Friday was the story this week: three new albums landed on Sep 25 and you went straight through them that day.', [3, 4, 5]],
      ['May 31 r2, run 1', may31Released, 'Then you took two detours, Dive In by Seasurfer on Thursday and Hysteria by Def Leppard on Saturday, both straight through.', [5, 6]],
      ['May 31 r2, run 2', may31Released, 'Late in the week you also took two full detours, Dive In by Seasurfer on Thursday and Hysteria by Def Leppard on Saturday.', [5, 6]],
    ] as Array<[string, WeekFacts, string, number[]]>)('passes the eval sentence from %s', (_label, wf, text, facts) => {
      expect(guardSentence({ text, facts }, wf)).toEqual([]);
    });

    it('fails a count of albums the cited facts do not name', () => {
      expect(guardSentence({ text: 'Friday was the story this week: four new albums landed on Sep 25.', facts: [3, 4, 5] }, sep20Released))
        .toEqual(['quantity:4:albums']);
      expect(guardSentence({ text: 'Friday was the story this week: two new albums landed on Sep 25.', facts: [3, 4, 5] }, sep20Released))
        .toEqual(['quantity:2:albums']);
      // Three albums and three artists, but no four of either.
      expect(guardSentence({ text: 'Friday was the story this week: four new records landed on Sep 25.', facts: [3, 4, 5] }, sep20Released))
        .toEqual(['quantity:4']);
    });

    it('counts two artists\' albums of the same title as two albums', () => {
      const hits = (id: number, artist: string): Fact => ({
        id, kind: 'repeat_album', salience: 100 - id, subject: artist,
        statement: `You played Greatest Hits by ${artist} start to finish.`,
        entities: [artist, 'Greatest Hits'], albums: [{ artist, album: 'Greatest Hits' }],
        quantities: [], dates: [], edges: [],
      });
      const wf: WeekFacts = {
        ...may24, timezone: null, topArtists: [], facts: [hits(1, 'Queen'), hits(2, 'ABBA')], names: ['Queen', 'ABBA', 'Greatest Hits'],
      };
      expect(guardSentence({ text: 'You played two albums start to finish.', facts: [1, 2] }, wf)).toEqual([]);
      // The title alone is still one of the names that make up the count, so it cannot carry the count by itself.
      expect(guardSentence({ text: 'Greatest Hits was one of two albums you played start to finish.', facts: [1, 2] }, wf))
        .toEqual(['quantity:2:albums']);
    });

    it('counts only up to 6', () => {
      // Aug 2's fact 6 names nine artists; its only 9s are tracks.
      expect(guardSentence({ text: 'Nine artists came back after months away.', facts: [6] }, aug2)).toEqual(['quantity-unit:9:artists']);
    });

    it('does not let a bare number beside one named artist stand for a count', () => {
      // Two albums across facts 5 and 6, but "Seasurfer on 2" claims something about Seasurfer.
      expect(guardSentence({ text: 'Seasurfer was on 2 by Thursday.', facts: [5, 6] }, may31Released)).toEqual(['quantity:2']);
      expect(guardSentence({ text: 'Seasurfer was one of two detours.', facts: [5, 6] }, may31Released)).toEqual(['quantity:2']);
    });

    it('never attributes a count to just one of the albums or artists that make it up', () => {
      // Facts 5 and 6 are Dive In by Seasurfer and Hysteria by Def Leppard: two albums between two artists, so the
      // count may stand beside none of those names or two or more of them, never one.
      expect(guardSentence({ text: 'Seasurfer got two albums played start to finish.', facts: [5, 6] }, may31Released))
        .toEqual(['quantity:2:albums']);
      expect(guardSentence({ text: 'Hysteria was one of two albums played start to finish.', facts: [5, 6] }, may31Released))
        .toEqual(['quantity:2:albums']);
      expect(guardSentence({ text: 'You played two albums start to finish: Dive In and Hysteria.', facts: [5, 6] }, may31Released))
        .toEqual([]);
      expect(guardSentence({ text: 'Two albums got start-to-finish plays this week.', facts: [5, 6] }, may31Released))
        .toEqual([]);
    });

    it('never attributes a count to a top artist named alone', () => {
      // Depeche Mode is on the top-artists line only, so it is not one of the names that make up the count, but the
      // sentence still names exactly one entity and claims the count for it.
      const withDepecheMode: WeekFacts = {
        ...may31Released,
        topArtists: [...may31Released.topArtists, { artist: 'Depeche Mode', plays: 6, tier: 'all_time_favourite', nameUncertain: false }],
        names: [...may31Released.names, 'Depeche Mode'],
      };
      expect(may31Released.names).not.toContain('Depeche Mode');
      expect(guardSentence({ text: 'Depeche Mode got two albums.', facts: [5, 6] }, withDepecheMode))
        .toEqual(['quantity:2:albums']);
      expect(guardSentence({ text: 'You played two albums start to finish: Dive In and Hysteria.', facts: [5, 6] }, withDepecheMode))
        .toEqual([]);
      expect(guardSentence({ text: 'Two albums got start-to-finish plays this week.', facts: [5, 6] }, withDepecheMode))
        .toEqual([]);
    });
  });

  describe('"those two", "these two", "both", "one of", "the two of them" and "either of" are not quantities', () => {
    it.each([
      ['Aug 2 r1, run 1', aug2, 'Around those two, the week spread out wide, with 22 artists reaching 10 or more plays where 14 is usual.', [5]],
      ['live r1, run 1', live, 'All told, 15 artists reached ten plays, which made this one of your widest weeks.', [3]],
    ] as Array<[string, WeekFacts, string, number[]]>)('passes the eval sentence from %s', (_label, wf, text, facts) => {
      expect(guardSentence({ text, facts }, wf)).toEqual([]);
    });

    it.each([
      'Around these two, the week spread out wide.',
      'The two of them set the week going.',
      'Either of them could have led the week.',
      'Both set the week going.',
    ])('reads "%s" as no number', (text) => {
      expect(guardSentence({ text, facts: [5] }, aug2)).toEqual([]);
    });

    it('still reads a number after the idiom, and "those two" before a unit', () => {
      expect(guardSentence({ text: 'Seasurfer and Def Leppard both got 9 plays.', facts: [5, 6] }, may31Released))
        .toEqual(['quantity:9:plays']);
      expect(guardSentence({ text: 'Around those two days, the week spread out wide.', facts: [5] }, aug2)).toEqual(['quantity:2:days']);
      expect(guardSentence({ text: 'One of them had 9 plays.', facts: [5] }, aug2)).toEqual(['quantity:9:plays']);
    });
  });
});
