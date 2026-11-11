// ABOUTME: Tests for album-level week facts - repeat albums, single listens, album chains and album mode.
// ABOUTME: Follows spec section 2 (fact table, "Album runs", "Question"); every fact is checked for grounding.

import { albumFacts, albumKey, albumRuns } from '../src';
import type { AlbumInfo, ArtistWeek, Scrobble } from '../src';
import { NOW, artist, context, expectGrounded, ofKind, only, plays, ts } from './helpers';
import type { Setup } from './helpers';

const TEN = Array.from({ length: 10 }, (_, i) => `t${i + 1}`);
const MON = ts('2026-11-02T10:00:00');
const WED = ts('2026-11-04T10:00:00');
const THU = ts('2026-11-05T10:00:00');
const FRI = ts('2026-11-06T10:00:00');
const SAT = ts('2026-11-07T10:00:00');

/** Scrobbles of `tracks` from one album, 240 seconds apart, starting at `start`. */
const listen = (name: string, album: string, tracks: string[], start: number): Scrobble[] =>
  tracks.map((track, i) => ({ artist: name, album, track, ts: start + i * 240 }));

/** An albums record: one AlbumInfo per [artist, album, tracklist, userPlaycount], fetched at NOW. */
const albums = (...entries: Array<[string, string, string[] | null, number | null]>): Record<string, AlbumInfo> =>
  Object.fromEntries(entries.map(([name, album, tracklist, userPlaycount]) =>
    [albumKey(name, album), { tracklist, userPlaycount, fetchedAt: NOW }]));

/** A context whose runs are graded from the week itself, as buildWeekFacts will grade them. */
function graded(setup: Setup & { albums: Record<string, AlbumInfo> }) {
  const { albums: lists, inputs = {}, ...rest } = setup;
  return context({ ...rest, inputs: { ...inputs, albums: lists }, runs: albumRuns(setup.week, lists) });
}

const regular = (name: string, n: number, extra: Partial<ArtistWeek> = {}): ArtistWeek =>
  artist({ artist: name, tier: 'regular', plays: n, lifetimeBefore: 500, ...extra });

describe('repeat album', () => {
  it('two start_to_finish listens of a new album score 100', () => {
    const week = [...listen('Meltt', 'Eternal Embers', TEN, MON), ...listen('Meltt', 'Eternal Embers', TEN, WED)];
    const drafts = albumFacts(graded({
      week, artists: [regular('Meltt', 20)], albums: albums(['Meltt', 'Eternal Embers', TEN, 3 + 20]),
    }));
    const d = only(drafts, 'repeat_album');
    expect(d).toMatchObject({ subject: 'Meltt', salience: 100 }); // 40 + 10*2 + 40*1.0
    expect(d.statement).toBe('Eternal Embers by Meltt played start to finish 2 times (Mon Nov 2, Wed Nov 4), '
      + '20 plays of Meltt this week. The album had 3 track plays before this week, less than one full listen. '
      + 'Last play of it this week: Wed Nov 4.');
    expect(d.entities).toEqual(['Eternal Embers', 'Meltt']);
    expect(d.quantities).toEqual(expect.arrayContaining([
      { value: 2, unit: 'times', entity: 'Eternal Embers' },
      { value: 20, unit: 'plays', entity: 'Meltt' },
      { value: 3, unit: 'plays', entity: 'Eternal Embers' },
      { value: 1, unit: 'times', entity: 'Eternal Embers' },
    ]));
    expectGrounded(d);
    // A repeated album is never also a single listen.
    expect(ofKind(drafts, 'single_listen')).toEqual([]);
  });

  it('three listens of a familiar album score 74', () => {
    const week = [MON, WED, SAT].flatMap((start) => listen('Meltt', 'Eternal Embers', TEN, start));
    const d = only(albumFacts(graded({
      week, artists: [regular('Meltt', 30)], albums: albums(['Meltt', 'Eternal Embers', TEN, 100 + 30]),
    })), 'repeat_album');
    expect(d.salience).toBe(74); // 40 + 30 + 40*0.1
    expect(d.statement).toBe('Eternal Embers by Meltt played start to finish 3 times (Mon Nov 2, Wed Nov 4, Sat Nov 7), '
      + "30 plays of Meltt this week. The album had about 10 full listens' worth of plays before this week.");
    expect(d.edges).toEqual([]); // last play Sat 10:36, under 72 hours before Sun 21:17
    expectGrounded(d);
  });

  it('listens are capped at three, and two on one day are counted on that day', () => {
    const week = [MON, WED, WED + 3 * 3600, SAT].flatMap((start) => listen('Meltt', 'Eternal Embers', TEN, start));
    const d = only(albumFacts(graded({
      week, artists: [regular('Meltt', 40)], albums: albums(['Meltt', 'Eternal Embers', TEN, 40]),
    })), 'repeat_album');
    expect(d.salience).toBe(100); // 40 + 10*min(4, 3) + 40*1.0, before = 0
    expect(d.statement).toContain('played start to finish 4 times (Mon Nov 2, 2 times on Wed Nov 4, Sat Nov 7)');
    expect(d.statement).toContain('The album had 0 track plays before this week, less than one full listen.');
    expectGrounded(d);
  });

  it('most_of runs never count toward a repeat', () => {
    const week = [...listen('Meltt', 'Eternal Embers', TEN, MON), ...listen('Meltt', 'Eternal Embers', TEN.slice(1, 9), WED)];
    const ctx = graded({ week, artists: [regular('Meltt', 18)], albums: albums(['Meltt', 'Eternal Embers', TEN, 3 + 18]) });
    expect(ctx.runs.map((r) => r.verdict)).toEqual(['start_to_finish', 'most_of']);
    expect(ofKind(albumFacts(ctx), 'repeat_album')).toEqual([]);
  });

  it('album familiarity is "less than one full listen" under one tracklist of prior plays', () => {
    const week = [...listen('Meltt', 'Eternal Embers', TEN, MON), ...listen('Meltt', 'Eternal Embers', TEN, WED)];
    const at = (userPlaycount: number | null) => only(albumFacts(graded({
      week, artists: [regular('Meltt', 20)], albums: albums(['Meltt', 'Eternal Embers', TEN, userPlaycount]),
    })), 'repeat_album');

    const nine = at(9 + 20);
    expect(nine.salience).toBe(100);
    expect(nine.statement).toContain('The album had 9 track plays before this week, less than one full listen.');
    expectGrounded(nine);

    const one = at(1 + 20);
    expect(one.statement).toContain('The album had 1 track play before this week, less than one full listen.');
    expectGrounded(one);

    const ten = at(10 + 20);
    expect(ten.salience).toBe(80); // 40 + 20 + 40*0.5
    expect(ten.statement).toContain("The album had about 1 full listen's worth of plays before this week.");
    expectGrounded(ten);

    const unknown = at(null);
    expect(unknown.salience).toBe(64); // 40 + 20 + 40*0.1
    expect(unknown.statement).not.toContain('The album had');
    expectGrounded(unknown);

    // A count below this week's own plays is inconsistent: the album's history is unknown, not new.
    const inconsistent = at(12);
    expect(inconsistent.salience).toBe(64);
    expect(inconsistent.statement).not.toContain('The album had');
  });

  it('asks what happened after the last play when an album played on 2+ days goes quiet for 72+ hours', () => {
    const lists = albums(['Meltt', 'Eternal Embers', TEN, 23]);
    const edgesFor = (week: Scrobble[]) =>
      only(albumFacts(graded({ week, artists: [regular('Meltt', week.length)], albums: lists })), 'repeat_album').edges;

    const monThu = [...listen('Meltt', 'Eternal Embers', TEN, MON), ...listen('Meltt', 'Eternal Embers', TEN, THU)];
    // Last play Thu 10:36, 82.7 h before Sun 21:17.
    expect(edgesFor(monThu)).toEqual([{ kind: 'after', text: 'What happened with Eternal Embers after Thu Nov 5?' }]);

    const wedTwice = [...listen('Meltt', 'Eternal Embers', TEN, WED), ...listen('Meltt', 'Eternal Embers', TEN, WED + 3 * 3600)];
    expect(edgesFor(wedTwice)).toEqual([]); // one day only

    const monFri = [...listen('Meltt', 'Eternal Embers', TEN, MON), ...listen('Meltt', 'Eternal Embers', TEN, FRI)];
    expect(edgesFor(monFri)).toEqual([]); // last play Fri 10:36, 58.6 h before Sun 21:17: an edge under the old 36 h rule
  });
});

describe('single listen', () => {
  // Ten artists whose tags fill the week's top ten, each with more plays than any single album below.
  const TOP_TEN = ['ambient', 'jazz', 'folk', 'shoegaze', 'house', 'techno', 'post-rock', 'soul', 'funk', 'blues'];
  const fillers = TOP_TEN.map((tag, i) => ({ name: `Filler ${String.fromCharCode(65 + i)}`, tag }));
  const fillerWeek = fillers.flatMap((f, i) => plays(f.name, 12, THU + 3 * 3600 + i * 3600, `Single ${i}`, 30)
    .map((s, n) => ({ ...s, album: `${f.name} single ${n}` })));
  const fillerTags = Object.fromEntries(fillers.map((f) => [f.name, [f.tag]]));
  const fillerArtists = fillers.map((f) => regular(f.name, 12));

  it('a single 36-track unverified run is notable as long and new', () => {
    const week = plays('Brijean', 36, MON, 'Capri (Remastered 2026)');
    const d = only(albumFacts(graded({
      week, artists: [regular('Brijean', 36)], albums: albums(['Brijean', 'Capri (Remastered 2026)', null, 36]),
    })), 'single_listen');
    expect(d).toMatchObject({ subject: 'Brijean', salience: 80 }); // 45 + 25 new + 10 long
    expect(d.statement).toContain('36 tracks in a row from Capri (Remastered 2026)');
    expect(d.statement).toBe('Brijean on Mon Nov 2: 36 tracks in a row from Capri (Remastered 2026) in one run; '
      + 'the album had 0 track plays before this week.');
    expect(d.entities).toEqual(['Brijean', 'Capri (Remastered 2026)']);
    // "one run" is typed and tied to the album, so a note saying the tracks came in one run is grounded.
    expect(d.quantities).toContainEqual({ value: 1, unit: 'times', entity: 'Capri (Remastered 2026)' });
    expect(d.dates).toEqual([MON]);
    expectGrounded(d);
  });

  it('a single listen fires for a genre outlier', () => {
    const week = [...listen('Astrud Gilberto', 'Beach Samba', TEN, MON), ...fillerWeek];
    const d = only(albumFacts(graded({
      week,
      artists: [regular('Astrud Gilberto', 10), ...fillerArtists],
      albums: albums(['Astrud Gilberto', 'Beach Samba', TEN, 100 + 10]),
      inputs: { tags: { ...fillerTags, 'Astrud Gilberto': ['bossa nova', 'jazz'] } },
    })), 'single_listen');
    expect(d.salience).toBe(55); // 45 + 10 outlier
    expect(d.statement).toBe("Astrud Gilberto on Mon Nov 2: Beach Samba start to finish in one run; Astrud Gilberto is tagged 'bossa nova' "
      + "on Last.fm, a tag outside the week's most played tags.");
    expectGrounded(d);
  });

  it('a mood tag is never the outlier tag a single listen names', () => {
    const week = [...listen('Astrud Gilberto', 'Beach Samba', TEN, MON), ...fillerWeek];
    const d = only(albumFacts(graded({
      week,
      artists: [regular('Astrud Gilberto', 10), ...fillerArtists],
      albums: albums(['Astrud Gilberto', 'Beach Samba', TEN, 100 + 10]),
      inputs: { tags: { ...fillerTags, 'Astrud Gilberto': ['mellow', 'relaxing', 'bossa nova', 'jazz'] } },
    })), 'single_listen');
    expect(d.statement).toContain("Astrud Gilberto is tagged 'bossa nova' on Last.fm");
    expectGrounded(d);
  });

  it('a familiar in-genre full listen under 20 tracks does not fire', () => {
    const week = [...listen('Nils Frahm', 'Spaces', TEN, MON), ...fillerWeek];
    const drafts = albumFacts(graded({
      week,
      artists: [regular('Nils Frahm', 10), ...fillerArtists],
      albums: albums(['Nils Frahm', 'Spaces', TEN, 100 + 10]),
      inputs: { tags: { ...fillerTags, 'Nils Frahm': ['ambient', 'piano'] } },
    }));
    expect(ofKind(drafts, 'single_listen')).toEqual([]);

    // Nineteen unverified tracks of a familiar album are not long either.
    const nineteen = plays('Nils Frahm', 19, MON, 'All Melody');
    expect(albumFacts(graded({
      week: nineteen, artists: [regular('Nils Frahm', 19)], albums: albums(['Nils Frahm', 'All Melody', null, 300]),
    }))).toEqual([]);
  });

  it('a long start_to_finish listen states its track count, and a mislabelled run is never a single listen', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `s${i + 1}`);
    const long = only(albumFacts(graded({
      week: listen('Sufjan Stevens', 'Illinois', twenty, MON),
      artists: [regular('Sufjan Stevens', 20)],
      albums: albums(['Sufjan Stevens', 'Illinois', twenty, 500]),
    })), 'single_listen');
    expect(long.salience).toBe(55); // 45 + 10 long
    expect(long.statement).toBe('Sufjan Stevens on Mon Nov 2: Illinois start to finish (20 tracks) in one run.');
    expectGrounded(long);

    // Twenty tracks scrobbled as Illinois, none of them on its tracklist.
    const offList = plays('Sufjan Stevens', 20, MON, 'Illinois');
    const ctx = graded({ week: offList, artists: [regular('Sufjan Stevens', 20)], albums: albums(['Sufjan Stevens', 'Illinois', twenty, 500]) });
    expect(ctx.runs.map((r) => r.verdict)).toEqual(['mislabelled']);
    expect(albumFacts(ctx)).toEqual([]);
  });

  it('a 12-month return asks what brought the artist back', () => {
    const d = only(albumFacts(graded({
      week: listen('Tracy Chapman', 'Crossroads', TEN, MON),
      artists: [artist({ artist: 'Tracy Chapman', tier: 'lapsed', plays: 10, lifetimeBefore: 200, absentMonths: 12 })],
      albums: albums(['Tracy Chapman', 'Crossroads', TEN, 10 + 2]),
    })), 'single_listen');
    expect(d.salience).toBe(70); // 45 + 25 new
    expect(d.edges).toEqual([{ kind: 'started', text: 'What brought Tracy Chapman back after more than a year?' }]);
    expectGrounded(d);
  });
});

describe('album chain', () => {
  it('three albums back to back make a chain at 60', () => {
    const week = [
      ...listen('Hammock', 'Oblivion Hymns', TEN, THU),
      ...listen('Stars of the Lid', 'And Their Refinement', TEN, THU + 10 * 240 + 600),
      ...listen('Hammock', 'Universalis', TEN, THU + 20 * 240 + 1200),
    ];
    const ctx = graded({
      week,
      artists: [regular('Hammock', 20), regular('Stars of the Lid', 10)],
      albums: albums(
        ['Hammock', 'Oblivion Hymns', TEN, null],
        ['Stars of the Lid', 'And Their Refinement', TEN, null],
        ['Hammock', 'Universalis', TEN, null],
      ),
    });
    const d = only(albumFacts(ctx), 'album_chain');
    expect(d).toMatchObject({ salience: 60, subject: null, edges: [] });
    expect(d.statement).toBe('Thu Nov 5: 3 albums back to back, start to finish: Oblivion Hymns (Hammock), '
      + 'And Their Refinement (Stars of the Lid), Universalis (Hammock).');
    expect(d.entities).toEqual(['Oblivion Hymns', 'Hammock', 'And Their Refinement', 'Stars of the Lid', 'Universalis']);
    expect(d.quantities).toEqual([{ value: 3, unit: 'albums' }]);
    expectGrounded(d);
  });
});

describe('album identities', () => {
  it('repeat, single-listen and chain facts record their albums with artists', () => {
    const repeat = only(albumFacts(graded({
      week: [...listen('Meltt', 'Eternal Embers', TEN, MON), ...listen('Meltt', 'Eternal Embers', TEN, WED)],
      artists: [regular('Meltt', 20)], albums: albums(['Meltt', 'Eternal Embers', TEN, 20]),
    })), 'repeat_album');
    expect(repeat.albums).toEqual([{ artist: 'Meltt', album: 'Eternal Embers' }]);

    const single = only(albumFacts(graded({
      week: plays('Brijean', 36, MON, 'Capri (Remastered 2026)'),
      artists: [regular('Brijean', 36)], albums: albums(['Brijean', 'Capri (Remastered 2026)', null, 36]),
    })), 'single_listen');
    expect(single.albums).toEqual([{ artist: 'Brijean', album: 'Capri (Remastered 2026)' }]);

    // A chain is three or more albums; the third is Def Leppard again, so its artist is written twice.
    const chain = only(albumFacts(graded({
      week: [
        ...listen('Def Leppard', 'Hysteria', TEN, SAT),
        ...listen('Khruangbin', 'A La Sala', TEN, SAT + 10 * 240 + 600),
        ...listen('Def Leppard', 'Pyromania', TEN, SAT + 20 * 240 + 1200),
      ],
      artists: [regular('Def Leppard', 20), regular('Khruangbin', 10)],
      albums: albums(['Def Leppard', 'Hysteria', TEN, null], ['Khruangbin', 'A La Sala', TEN, null], ['Def Leppard', 'Pyromania', TEN, null]),
    })), 'album_chain');
    expect(chain.albums).toEqual([
      { artist: 'Def Leppard', album: 'Hysteria' },
      { artist: 'Khruangbin', album: 'A La Sala' },
      { artist: 'Def Leppard', album: 'Pyromania' },
    ]);
  });

  it('a self-titled album is one album and one entity', () => {
    const d = only(albumFacts(graded({
      week: [...listen('Weezer', 'Weezer', TEN, MON), ...listen('Weezer', 'Weezer', TEN, WED)],
      artists: [regular('Weezer', 20)], albums: albums(['Weezer', 'Weezer', TEN, 20]),
    })), 'repeat_album');
    expect(d.entities).toEqual(['Weezer']);
    expect(d.albums).toEqual([{ artist: 'Weezer', album: 'Weezer' }]);
  });
});

describe('album mode', () => {
  /** `inRuns` plays inside one same-album run, then `loose` plays each from a different album. */
  const weekWith = (start: number, inRuns: number, loose: number): Scrobble[] => [
    ...plays('Grouper', inRuns, start, 'Ruins'),
    ...plays('Various', loose, start + 6 * 3600, 'x').map((s, i) => ({ ...s, album: `Loose ${i}` })),
  ];
  const weekStart = (w: number) => NOW - (w + 1) * 7 * 86400 + 3600;

  it('album mode fires only when strictly the highest of five weeks', () => {
    const week = weekWith(weekStart(0), 10, 10);
    const ctx = graded({
      week,
      artists: [regular('Grouper', 10), regular('Various', 10)],
      albums: albums(['Grouper', 'Ruins', plays('Grouper', 10, 0, 'Ruins').map((s) => s.track), null]),
      prior: [weekWith(weekStart(1), 8, 24), weekWith(weekStart(2), 0, 20), weekWith(weekStart(3), 8, 12), weekWith(weekStart(4), 2, 18)],
    });
    const d = only(albumFacts(ctx), 'album_mode');
    expect(d).toMatchObject({ salience: 50, subject: null, edges: [] });
    expect(d.statement).toBe('1 start-to-finish album listen across 1 album; 50% of plays came in runs of 8 or more tracks '
      + 'from one album, the highest share of the last 5 weeks (the 4 weeks before, most recent first: 25%, 0%, 40%, 0%).');
    expectGrounded(d);

    // A tie with a prior week is not the highest.
    const tie = { ...ctx, weeks: [ctx.week, weekWith(weekStart(1), 10, 10), ...ctx.weeks.slice(2)] };
    expect(ofKind(albumFacts(tie), 'album_mode')).toEqual([]);
  });

  it('album mode needs a full baseline and plays in every one of the five weeks', () => {
    const week = weekWith(weekStart(0), 10, 10);
    const prior = [1, 2, 3, 4].map((w) => weekWith(weekStart(w), 0, 20));
    for (const baseline of ['partial', 'none'] as const) {
      expect(ofKind(albumFacts(graded({ week, artists: [], albums: {}, prior, baseline })), 'album_mode')).toEqual([]);
    }
    expect(only(albumFacts(graded({ week, artists: [], albums: {}, prior })), 'album_mode').statement)
      .toMatch(/^50% of plays came in runs/); // no start-to-finish listens to count without a tracklist
    const emptyWeek = [...prior.slice(0, 3), []];
    expect(ofKind(albumFacts(graded({ week, artists: [], albums: {}, prior: emptyWeek })), 'album_mode')).toEqual([]);
    expect(ofKind(albumFacts(graded({ week, artists: [], albums: {}, prior: prior.slice(0, 3) })), 'album_mode')).toEqual([]);
  });
});
