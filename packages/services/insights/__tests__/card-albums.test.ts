// ABOUTME: Tests for the card's candidate albums and its cache signature - albums from the top facts and 6+-track
// ABOUTME: runs, ordered by plays this week (spec section 1, "Candidate albums"), read from typed album identities.

import { albumFacts, albumKey, albumRuns, artistFacts, buildWeekFacts, cardAlbums, cardSignature, standoutAlbum } from '../src';
import type { AlbumInfo, AlbumRun, Draft, Fact, Scrobble, WeekFacts } from '../src';
import { artist, context, history, loadFixture, ts } from './helpers';

const MON = ts('2026-11-02T10:00:00');
const WED = ts('2026-11-04T10:00:00');
const FRI = ts('2026-11-06T10:00:00');
const GAP = 240;

const titles = (n: number): string[] => Array.from({ length: n }, (_, i) => `t${i + 1}`);

/** Scrobbles of the first `n` tracks of one album, 240 seconds apart, starting at `start`. */
const listen = (name: string, album: string, n: number, start: number): Scrobble[] =>
  titles(n).map((track, i) => ({ artist: name, album, track, ts: start + i * GAP }));

const tracklists = (week: Scrobble[]): Record<string, AlbumInfo> => {
  const out: Record<string, AlbumInfo> = {};
  for (const s of week) {
    const key = albumKey(s.artist, s.album);
    out[key] = { tracklist: [...(out[key]?.tracklist ?? []), s.track], userPlaycount: null, fetchedAt: MON };
  }
  return out;
};

let nextStart = MON;
/** One graded start-to-finish run of `tracks` tracks; each call starts three hours after the last. */
function run(name: string, album: string, tracks: number): AlbumRun {
  const scrobbles = listen(name, album, tracks, nextStart);
  nextStart += 3 * 3600;
  return albumRuns(scrobbles, tracklists(scrobbles))[0];
}

/** The week behind `runs`: each run's tracks as scrobbles, in time order. */
const weekOf = (runs: AlbumRun[]): Scrobble[] =>
  runs.flatMap((r) => listen(r.artist, r.album, r.tracksPlayed, r.from)).sort((a, b) => a.ts - b.ts);

/** A repeat-album draft built by albumFacts: two start-to-finish listens of a 10-track album. */
function repeatAlbumFact(name: string, album: string): Draft {
  const week = [...listen(name, album, 10, MON), ...listen(name, album, 10, WED)];
  const lists = tracklists(week.slice(0, 10));
  const ctx = context({
    week, artists: [artist({ artist: name, tier: 'regular', plays: 20 })], inputs: { albums: lists }, runs: albumRuns(week, lists),
  });
  const found = albumFacts(ctx).filter((d) => d.kind === 'repeat_album');
  expect(found).toHaveLength(1);
  return found[0];
}

/** A volume draft built by artistFacts: `plays` plays this week against a usual 2 a week. */
function volumeFact(name: string, plays: number): Draft {
  const { prior, chartWeeks } = history({ [name]: 2 });
  const week = listen(name, 'Some Album', plays, FRI);
  const ctx = context({ week, artists: [artist({ artist: name, tier: 'occasional', plays })], prior, inputs: { chartWeeks } });
  const found = artistFacts(ctx).filter((d) => d.kind === 'volume_vs_normal');
  expect(found).toHaveLength(1);
  return found[0];
}

const ranked = (...drafts: Draft[]): Fact[] => drafts.map((d, i) => ({ ...d, id: i + 1 }));

describe('cardAlbums', () => {
  it('lists the top 6 by plays this week, leaving out a standout that ranks 7th', () => {
    const runs = [9, 8, 8, 7, 7, 6].map((n, i) => run(`Artist ${i}`, `A${i}`, n + 3)).concat(run('Seventh', 'A7', 6));
    const facts = [{ ...repeatAlbumFact('Seventh', 'A7'), id: 1 }]; // fact 1: the standout album
    expect(cardAlbums(facts, runs, weekOf(runs)).map((a) => a.album)).toEqual(['A0', 'A1', 'A2', 'A3', 'A4', 'A5']);
    expect(standoutAlbum({ facts })).toEqual({ artist: 'Seventh', album: 'A7' });
  });

  it('takes albums named in the top six facts, with their plays this week', () => {
    const runs = [run('Big', 'Long Run', 12)];
    const week = [...weekOf(runs), ...listen('Seventh', 'A7', 4, FRI)];
    expect(cardAlbums(ranked(repeatAlbumFact('Seventh', 'A7')), runs, week)).toEqual([
      { artist: 'Big', album: 'Long Run', plays: 12 },
      { artist: 'Seventh', album: 'A7', plays: 4 },
    ]);
    // Fact 7 is outside the top six, so its album is no candidate.
    const seven = ranked(...Array.from({ length: 6 }, () => volumeFact('Other', 30)), repeatAlbumFact('Seventh', 'A7'));
    expect(cardAlbums(seven, runs, week).map((a) => a.album)).toEqual(['Long Run']);
  });

  it('takes runs of 6 or more tracks whatever their verdict, and no shorter run', () => {
    const unverified = albumRuns(listen('Celer', 'Capri', 6, MON), {})[0];
    expect(unverified.verdict).toBe('unverified');
    const short = run('Short', 'EP', 5);
    expect(cardAlbums([], [unverified, short], weekOf([unverified, short]))).toEqual([{ artist: 'Celer', album: 'Capri', plays: 6 }]);
  });

  it('never reads an artist named like an album as that album', () => {
    const fire = run('Low', 'Things We Lost in the Fire', 20);
    const week = [...weekOf([fire]), ...listen('David Bowie', 'Low', 3, FRI + 6 * 3600)];
    const facts = ranked(volumeFact('Low', 20)); // fact 1 names the band Low
    expect(facts[0].entities).toContain('Low');
    const albums = cardAlbums(facts, [fire], week);
    expect(albums.map((a) => a.album)).not.toContain('Low');
    expect(albums).toEqual([{ artist: 'Low', album: 'Things We Lost in the Fire', plays: 20 }]);
  });

  it('keeps each artist\'s album apart when two artists share a title', () => {
    const runs = [run('Artist A', 'Greatest Hits', 9), run('Artist B', 'Greatest Hits', 7)];
    expect(cardAlbums([], runs, weekOf(runs))).toEqual([
      { artist: 'Artist A', album: 'Greatest Hits', plays: 9 },
      { artist: 'Artist B', album: 'Greatest Hits', plays: 7 },
    ]);
  });

  it('counts an album once, by its plays this week, when a fact and runs both name it', () => {
    const runs = [run('Meltt', 'Eternal Embers', 10), run('meltt', 'ETERNAL EMBERS', 10)];
    const albums = cardAlbums(ranked(repeatAlbumFact('Meltt', 'Eternal Embers')), runs, weekOf(runs));
    expect(albums).toEqual([{ artist: 'Meltt', album: 'Eternal Embers', plays: 20 }]);
  });

  it('breaks equal plays by album name, then artist name', () => {
    const runs = [run('Zed', 'Same', 8), run('Abe', 'Same', 8), run('Abe', 'Other', 8)];
    expect(cardAlbums([], runs, weekOf(runs)).map((a) => `${a.album}/${a.artist}`)).toEqual(['Other/Abe', 'Same/Abe', 'Same/Zed']);
  });
});

describe('cardSignature', () => {
  const may24 = buildWeekFacts(loadFixture('bordesak-2026-05-24'));

  it('is 16 hex characters', async () => {
    expect(await cardSignature(may24)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('cardSignature changes with the ranked facts, and ignores pulledAt', async () => {
    const base = await cardSignature(may24);
    expect(await cardSignature({ ...may24, pulledAt: may24.pulledAt + 3600 })).toBe(base);
    const [first, second, ...rest] = may24.facts;
    const swapped: WeekFacts = { ...may24, facts: [{ ...second, id: 1 }, { ...first, id: 2 }, ...rest] };
    expect(await cardSignature(swapped)).not.toBe(base);
  });

  it('changes with the card albums and the rule version, and ignores facts below the top six', async () => {
    const base = await cardSignature(may24);
    const fewer: WeekFacts = { ...may24, cardAlbums: may24.cardAlbums.slice(1) };
    expect(await cardSignature(fewer)).not.toBe(base);
    expect(await cardSignature({ ...may24, ruleVersion: 'r0' })).not.toBe(base);
    const seventh: Fact = { ...may24.facts[0], id: may24.facts.length + 1, statement: 'A seventh fact.' };
    expect(may24.facts).toHaveLength(6);
    expect(await cardSignature({ ...may24, facts: [...may24.facts, seventh] })).toBe(base);
  });

  it('changes with the standout album alone, while the ranked statements and the candidates stay fixed', async () => {
    // Fact 2's standout is the album its count of times is typed against; retyping that count moves the standout
    // and leaves the fact's id, kind and statement, and the candidate list, as they were.
    const second = may24.facts[1];
    expect(standoutAlbum(may24)).toEqual({ artist: 'Boards of Canada', album: 'Inferno' });
    const retyped: Fact = {
      ...second,
      quantities: second.quantities.map((q) => (q.unit === 'times' ? { ...q, entity: 'Geogaddi' } : q)),
    };
    const moved: WeekFacts = { ...may24, facts: [may24.facts[0], retyped, ...may24.facts.slice(2)] };
    expect(standoutAlbum(moved)).toEqual({ artist: 'Boards of Canada', album: 'Geogaddi' });
    const ranked = (wf: WeekFacts) => wf.facts.slice(0, 6).map((f) => [f.id, f.kind, f.statement]);
    expect(ranked(moved)).toEqual(ranked(may24));
    expect(moved.cardAlbums).toBe(may24.cardAlbums);
    expect(await cardSignature(moved)).not.toBe(await cardSignature(may24));
  });
});
