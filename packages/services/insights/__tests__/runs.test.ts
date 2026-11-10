// ABOUTME: Tests for album runs - candidates, tracklist verdicts and phrases, chains and album-mode share.
// ABOUTME: Follows spec section 2 ("Album runs") and the album_chain and album_mode rows of its fact table.

import { albumChains, albumKey, albumModeShare, albumRuns, runsToLookUp } from '../src';
import type { AlbumInfo, Scrobble } from '../src';

const TEN = Array.from({ length: 10 }, (_, i) => `t${i + 1}`);
const START = 1793500000;

/** Scrobbles of `tracks` from one album, `gap` seconds apart, starting at `startTs`. */
const play = (artist: string, album: string, tracks: string[], startTs: number, gap = 240): Scrobble[] =>
  tracks.map((track, i) => ({ artist, album, track, ts: startTs + i * gap }));

/** An albums record holding one tracklist per [artist, album, tracklist] entry. */
const lists = (...entries: Array<[string, string, string[] | null]>): Record<string, AlbumInfo> =>
  Object.fromEntries(entries.map(([artist, album, tracklist]) => [albumKey(artist, album), { tracklist, userPlaycount: null, fetchedAt: START }]));

const last = (s: Scrobble[]): number => s[s.length - 1].ts;

it('whole album in order is start_to_finish', () => {
  const week = play('Artist', 'A', TEN, START);
  expect(albumRuns(week, lists(['Artist', 'A', TEN]))).toEqual([{
    artist: 'Artist', album: 'A', from: START, to: START + 9 * 240,
    tracksPlayed: 10, tracklistLength: 10, coverage: 1, verdict: 'start_to_finish', phrase: 'A start to finish',
  }]);
});

it('an ordered excerpt missing both ends is most_of', () => {
  const [run] = albumRuns(play('Artist', 'A', TEN.slice(1, 9), START), lists(['Artist', 'A', TEN]));
  expect(run).toMatchObject({ tracksPlayed: 8, coverage: 0.8, verdict: 'most_of', phrase: '8 of 10 tracks of A, in order' });
});

it('nine of ten including first and last, one swap, is start_to_finish', () => {
  const tracks = ['t1', 't2', 't4', 't3', 't5', 't6', 't7', 't8', 't10'];
  const [run] = albumRuns(play('Artist', 'A', tracks, START), lists(['Artist', 'A', TEN]));
  expect(run).toMatchObject({ tracksPlayed: 9, coverage: 0.9, verdict: 'start_to_finish' });
});

it('more than 30% off-list tracks is mislabelled', () => {
  // 15 plays, 11 of them off-list: 4 list tracks, then 7 other tracks with 4 repeated (11 distinct, so not shorter).
  const eleven = Array.from({ length: 11 }, (_, i) => `l${i + 1}`);
  const tracks = ['l1', 'l2', 'l3', 'l4', 'x1', 'x1', 'x2', 'x2', 'x3', 'x3', 'x4', 'x4', 'x5', 'x6', 'x7'];
  const [run] = albumRuns(play('Röyksopp', 'Profound Mysteries', tracks, START), lists(['Röyksopp', 'Profound Mysteries', eleven]));
  expect(run).toMatchObject({
    tracksPlayed: 11, tracklistLength: 11, verdict: 'mislabelled',
    phrase: 'Röyksopp tracks scrobbled as Profound Mysteries are mostly not on that album, so treat them as a run of Röyksopp tracks',
  });
  // No article sits before the artist, so a vowel-initial name reads correctly too.
  const [vowel] = albumRuns(play('Explosions in the Sky', 'The Earth Is Not a Cold Dead Place', tracks, START),
    lists(['Explosions in the Sky', 'The Earth Is Not a Cold Dead Place', eleven]));
  expect(vowel.phrase).toBe('Explosions in the Sky tracks scrobbled as The Earth Is Not a Cold Dead Place are mostly not on that album, '
    + 'so treat them as a run of Explosions in the Sky tracks');
});

it('a tracklist shorter than the tracks played is unverified, never mislabelled', () => {
  const [run] = albumRuns(play('Artist', 'A', TEN, START), lists(['Artist', 'A', ['t1']]));
  expect(run).toMatchObject({ tracksPlayed: 10, tracklistLength: 1, coverage: null, verdict: 'unverified', phrase: '10 tracks in a row from A' });
});

it('no tracklist is unverified', () => {
  const week = play('Artist', 'A', TEN, START);
  const expected = { tracksPlayed: 10, tracklistLength: null, coverage: null, verdict: 'unverified', phrase: '10 tracks in a row from A' };
  expect(albumRuns(week, lists(['Artist', 'A', null]))).toMatchObject([expected]);
  expect(albumRuns(week, {})).toMatchObject([expected]); // never looked up, as when the lookup cap is reached
  expect(albumRuns(week, lists(['Artist', 'A', []]))).toMatchObject([expected]);
});

it('a 4-track EP played whole is a candidate', () => {
  const ep = ['e1', 'e2', 'e3', 'e4'];
  const [run] = albumRuns(play('Artist', 'EP', ep, START), lists(['Artist', 'EP', ep]));
  expect(run).toMatchObject({ tracksPlayed: 4, tracklistLength: 4, coverage: 1, verdict: 'start_to_finish', phrase: 'EP start to finish' });
});

it('four tracks of a five-track EP are not a candidate', () => {
  const ep = ['e1', 'e2', 'e3', 'e4', 'e5'];
  expect(albumRuns(play('Artist', 'EP', ep.slice(0, 4), START), lists(['Artist', 'EP', ep]))).toEqual([]);
});

it('four tracks of a ten-track album are not a candidate', () => {
  expect(albumRuns(play('Artist', 'A', TEN.slice(0, 4), START), lists(['Artist', 'A', TEN]))).toEqual([]);
});

it('a gap over 90 minutes splits a run', () => {
  const six = TEN.slice(0, 6);
  const first = play('Artist', 'A', six, START);
  const split = [...first, ...play('Artist', 'A', six, last(first) + 5401)];
  expect(albumRuns(split, lists(['Artist', 'A', TEN]))).toHaveLength(2);
  const joined = [...first, ...play('Artist', 'A', TEN.slice(6), last(first) + 5400)];
  expect(albumRuns(joined, lists(['Artist', 'A', TEN]))).toMatchObject([{ tracksPlayed: 10, verdict: 'start_to_finish' }]);
});

it('scrobbles without an album never join a run', () => {
  // Empty-album plays are skipped: they form no run of their own and do not split the run they sit inside.
  const album = play('Artist', 'A', TEN, START);
  const loose = play('Artist', '', ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'], START + 2 * 240 + 60, 1);
  const week = [...album, ...loose].sort((a, b) => a.ts - b.ts);
  expect(albumRuns(week, lists(['Artist', 'A', TEN]))).toMatchObject([{ album: 'A', tracksPlayed: 10, verdict: 'start_to_finish' }]);
  expect(albumRuns(play('Artist', '', TEN, START), {})).toEqual([]);
});

it('a scrobble from another album splits a run', () => {
  const week = [...play('Artist', 'A', TEN.slice(0, 5), START), ...play('Artist', 'B', ['b1'], START + 5 * 240), ...play('Artist', 'A', TEN.slice(5), START + 6 * 240)];
  expect(albumRuns(week, lists(['Artist', 'A', TEN]))).toEqual([]);
});

it('a multi-artist compilation forms no run', () => {
  const week = Array.from({ length: 12 }, (_, i) => ({ artist: `Artist ${i + 1}`, album: 'Now 12', track: `c${i + 1}`, ts: START + i * 240 }));
  expect(albumRuns(week, {})).toEqual([]);
});

it('a repeated track counts once toward coverage', () => {
  const withRepeat = ['t1', 't2', 't3', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10'];
  expect(albumRuns(play('Artist', 'A', withRepeat, START), lists(['Artist', 'A', TEN])))
    .toMatchObject([{ tracksPlayed: 10, coverage: 1, verdict: 'start_to_finish' }]);
  // Five distinct tracks with one repeat are still five tracks, so not a candidate.
  expect(albumRuns(play('Artist', 'A', ['t1', 't2', 't3', 't3', 't4', 't5'], START), lists(['Artist', 'A', TEN]))).toEqual([]);
});

it('titles match across " - 2007 Remaster" suffixes', () => {
  const titles = ['Airbag', 'Paranoid Android', 'Subterranean Homesick Alien', 'Exit Music (For a Film)', 'Let Down', 'Karma Police'];
  const played = titles.map((t) => `${t} - 2007 Remaster`);
  expect(albumRuns(play('Radiohead', 'OK Computer', played, START), lists(['Radiohead', 'OK Computer', titles])))
    .toMatchObject([{ tracksPlayed: 6, coverage: 1, verdict: 'start_to_finish' }]);
  // The reverse, and a different suffix on each side.
  const listed = titles.map((t, i) => (i === 0 ? `${t} - Live` : `${t} - 2007 Remaster`));
  expect(albumRuns(play('Radiohead', 'OK Computer', [titles[0].concat(' - 2007 Remaster'), ...titles.slice(1)], START), lists(['Radiohead', 'OK Computer', listed])))
    .toMatchObject([{ coverage: 1, verdict: 'start_to_finish' }]);
});

it('an exact title beats a longer title it is a prefix of', () => {
  // 't1' is a prefix of 't10'; the played 't10' must land on the last track, not the first.
  expect(albumRuns(play('Artist', 'A', TEN, START), lists(['Artist', 'A', TEN]))[0].verdict).toBe('start_to_finish');
});

it('normalises tracklist titles and counts repeated titles on the list once', () => {
  const listed = ['T1', 'T2', 't2', ...TEN.slice(2)].map((t) => t.toUpperCase());
  expect(albumRuns(play('Artist', 'A', TEN, START), lists(['Artist', 'A', listed])))
    .toMatchObject([{ tracklistLength: 10, coverage: 1, verdict: 'start_to_finish' }]);
});

it('shuffled album tracks with no off-list tracks are unverified', () => {
  const shuffled = ['t5', 't2', 't9', 't1', 't7', 't3', 't10', 't4'];
  expect(albumRuns(play('Artist', 'A', shuffled, START), lists(['Artist', 'A', TEN])))
    .toMatchObject([{ verdict: 'unverified', phrase: '8 tracks in a row from A' }]);
});

it('returns runs longest first', () => {
  const week = [...play('Artist', 'A', TEN.slice(0, 6), START), ...play('Artist', 'B', TEN, START + 7200)];
  expect(albumRuns(week, {}).map((r) => r.album)).toEqual(['B', 'A']);
});

it('three full albums 10 minutes apart form a chain; a 45-minute break ends it', () => {
  const albums = ['A', 'B', 'C', 'D', 'E'];
  const starts = [START];
  const span = 9 * 240;
  starts.push(starts[0] + span + 600, starts[0] + 2 * (span + 600), starts[0] + 3 * (span + 600) + 2100, starts[0] + 4 * (span + 600) + 2100);
  const week = albums.flatMap((album, i) => play('Artist', album, TEN, starts[i]));
  const runs = albumRuns(week, lists(...albums.map((a): [string, string, string[]] => ['Artist', a, TEN])));
  expect(albumChains(runs).map((c) => c.map((r) => r.album))).toEqual([['A', 'B', 'C']]);
});

it('only start_to_finish runs join a chain', () => {
  const span = 9 * 240;
  const week = ['A', 'B', 'C'].flatMap((album, i) => play('Artist', album, album === 'B' ? TEN.slice(1, 9) : TEN, START + i * (span + 600)));
  const runs = albumRuns(week, lists(['Artist', 'A', TEN], ['Artist', 'B', TEN], ['Artist', 'C', TEN]));
  expect(albumChains(runs)).toEqual([]);
});

it('album mode share counts plays inside runs of 8+ distinct tracks', () => {
  const week = [
    ...play('Artist', 'A', [...TEN.slice(0, 8), 't8'], START),          // 9 plays, 8 distinct: counts
    ...play('Artist', 'B', TEN.slice(0, 7), START + 7200),              // 7 distinct: does not
    ...play('Other', '', ['x1', 'x2', 'x3', 'x4'], START + 14400),     // no album: does not
  ];
  expect(albumModeShare(week)).toBeCloseTo(9 / 20);
  expect(albumModeShare([])).toBe(0);
});

describe('runsToLookUp', () => {
  it('lists a 4-track run before any tracklist is known, which albumRuns cannot', () => {
    const week = play('Artist', 'EP', ['e1', 'e2', 'e3', 'e4'], START);
    expect(albumRuns(week, {})).toEqual([]);
    expect(runsToLookUp(week)).toEqual([{ artist: 'Artist', album: 'EP', from: START, tracksPlayed: 4 }]);
  });

  it('counts distinct tracks, so repeats of three tracks are not a run', () => {
    const week = play('Artist', 'A', ['t1', 't2', 't3', 't1', 'T2 ', 't3'], START);
    expect(runsToLookUp(week)).toEqual([]);
  });

  it('skips scrobbles with no album and orders longest first, then earliest', () => {
    const week = [
      ...play('Artist', 'Short', TEN.slice(0, 5), START),
      ...play('Artist', '', TEN, START + 7200),
      ...play('Artist', 'Long', TEN, START + 14400),
      ...play('Artist', 'Also short', TEN.slice(0, 5), START + 21600),
    ];
    expect(runsToLookUp(week).map((r) => [r.album, r.tracksPlayed])).toEqual([['Long', 10], ['Short', 5], ['Also short', 5]]);
  });

  it('splits a run at a gap over 90 minutes, as albumRuns does', () => {
    const week = [...play('Artist', 'A', TEN.slice(0, 4), START), ...play('Artist', 'A', TEN.slice(4, 8), START + 3 * 240 + 90 * 60 + 1)];
    expect(runsToLookUp(week).map((r) => r.tracksPlayed)).toEqual([4, 4]);
  });
});
