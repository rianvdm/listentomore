// ABOUTME: Tests for the release_week fact - an album run in the week its Spotify release date falls in, with day
// ABOUTME: precision, matching titles and artists, and no edition markers (spec section 2, "Release-week fact").

import { albumKey, albumRuns, releaseWeekFacts } from '../src';
import type { AlbumInfo, ReleaseInfo, Scrobble } from '../src';
import { NOW, context, expectGrounded, only, ts } from './helpers';

const TEN = Array.from({ length: 10 }, (_, i) => `t${i + 1}`);
const MON = ts('2026-11-02T10:00:00');
const WED = ts('2026-11-04T10:00:00');

/** Scrobbles of `tracks` from one album, 240 seconds apart, starting at `start`. */
const listen = (name: string, album: string, tracks: string[], start: number): Scrobble[] =>
  tracks.map((track, i) => ({ artist: name, album, track, ts: start + i * 240 }));

/**
 * A context for `week` (window ending Sun Nov 8 2026 21:17 UTC, timezone null) whose albums each have the TEN
 * tracklist and no earlier plays, with its runs graded from the week and `releases` as the looked-up dates.
 */
function graded(week: Scrobble[], releases?: Record<string, ReleaseInfo>) {
  const albums: Record<string, AlbumInfo> = {};
  for (const s of week) albums[albumKey(s.artist, s.album)] = { tracklist: TEN, userPlaycount: 0, fetchedAt: NOW };
  return context({ week, artists: [], inputs: { albums, releases }, runs: albumRuns(week, albums) });
}

const release = (date: string, title = 'Eternal Embers', artist = 'Meltt'): Record<string, ReleaseInfo> =>
  ({ [albumKey('Meltt', 'Eternal Embers')]: { title, artist, date } });
const full = (start: number) => listen('Meltt', 'Eternal Embers', TEN, start);

describe('release_week', () => {
  it('fires at 80 when the album was played start to finish on its release day', () => {
    const d = only(releaseWeekFacts(graded(full(MON), release('2026-11-02'))), 'release_week');
    expect([d.salience, d.subject]).toEqual([80, 'Meltt']);
    expect(d.statement).toBe('Eternal Embers by Meltt came out on Mon Nov 2, and you played it start to finish that day.');
    expect(d.entities).toEqual(['Eternal Embers', 'Meltt']);
    expect(d.albums).toEqual([{ artist: 'Meltt', album: 'Eternal Embers' }]);
    expect(d.dates).toEqual([MON]);
    expectGrounded(d);
  });

  it('fires at 70 for a most_of run later in the release week', () => {
    const d = only(releaseWeekFacts(graded(listen('Meltt', 'Eternal Embers', TEN.slice(0, 8), WED), release('2026-11-02'))), 'release_week');
    expect(d.salience).toBe(70);
    expect(d.statement).toBe('Eternal Embers by Meltt came out on Mon Nov 2, and you played 8 of 10 tracks of it, in order, on Wed Nov 4.');
    expect(d.quantities).toEqual([
      { value: 8, unit: 'tracks', entity: 'Eternal Embers' },
      { value: 10, unit: 'tracks', entity: 'Eternal Embers' },
    ]);
    // The release day is the first whole hour of that day inside the window, then the run's day.
    expect(d.dates).toEqual([ts('2026-11-02T00:00:00'), WED]);
    expectGrounded(d);
  });

  it('states a start-to-finish run later in the week and a most_of run on the day', () => {
    const later = only(releaseWeekFacts(graded(full(WED), release('2026-11-02'))), 'release_week');
    expect(later.statement).toBe('Eternal Embers by Meltt came out on Mon Nov 2, and you played it start to finish on Wed Nov 4.');
    expect(later.salience).toBe(70);
    expectGrounded(later);
    const most = only(releaseWeekFacts(graded(listen('Meltt', 'Eternal Embers', TEN.slice(0, 8), MON), release('2026-11-02'))), 'release_week');
    expect(most.statement).toBe('Eternal Embers by Meltt came out on Mon Nov 2, and you played 8 of 10 tracks of it, in order, that day.');
    expect(most.salience).toBe(80);
    expectGrounded(most);
  });

  it('makes one fact per album, preferring the run on the release day, then start to finish', () => {
    const week = [...listen('Meltt', 'Eternal Embers', TEN.slice(0, 8), MON), ...full(MON + 4 * 3600), ...full(WED)];
    const d = only(releaseWeekFacts(graded(week, release('2026-11-02'))), 'release_week');
    expect(d.statement).toBe('Eternal Embers by Meltt came out on Mon Nov 2, and you played it start to finish that day.');
    expect(d.dates).toEqual([MON + 4 * 3600]);
    // With no run on the release day, the first run of the week.
    const weekLater = [...full(WED), ...listen('Meltt', 'Eternal Embers', TEN.slice(0, 8), ts('2026-11-05T10:00:00'))];
    expect(only(releaseWeekFacts(graded(weekLater, release('2026-11-02'))), 'release_week').dates[1]).toBe(WED);
  });

  it('skips a Spotify match whose title is another edition or another record', () => { // Review Focus 5
    for (const title of ['Eternal Embers Live', 'Eternal Embers (Deluxe Edition)', 'Embers']) {
      expect(releaseWeekFacts(graded(full(MON), release('2026-11-02', title))), title).toEqual([]);
    }
  });

  it('matches titles and artists through matchKey', () => {
    expect(releaseWeekFacts(graded(full(MON), release('2026-11-02', 'ETERNAL EMBERS', 'MELTT')))).toHaveLength(1);
  });

  it('skips an edition marker on the Last.fm title', () => {
    const remaster = 'Eternal Embers (2026 Remaster)';
    const releases = { [albumKey('Meltt', remaster)]: { title: remaster, artist: 'Meltt', date: '2026-11-02' } };
    expect(releaseWeekFacts(graded(listen('Meltt', remaster, TEN, MON), releases))).toEqual([]);
  });

  it('makes no fact for an unverified run or without releases', () => {
    const shuffled = listen('Meltt', 'Eternal Embers', [...TEN].reverse(), MON);
    expect(graded(shuffled).runs.map((r) => r.verdict)).toEqual(['unverified']);
    expect(releaseWeekFacts(graded(shuffled, release('2026-11-02')))).toEqual([]);
    expect(releaseWeekFacts(graded(full(MON)))).toEqual([]);
  });

  it('needs day precision, a date in the window and on or before the run, and a matching artist', () => {
    for (const date of ['2026-11', '2026', '2026-10-30', '2026-11-03']) {
      expect(releaseWeekFacts(graded(full(MON), release(date))), date).toEqual([]);
    }
    expect(releaseWeekFacts(graded(full(MON), release('2026-11-02', 'Eternal Embers', 'Meltt, Guest')))).toHaveLength(1);
    for (const artist of ['Meltt Tribute Band', 'Someone Else']) {
      expect(releaseWeekFacts(graded(full(MON), release('2026-11-02', 'Eternal Embers', artist))), artist).toEqual([]);
    }
  });

  it('counts a release on the window\'s first day, stated at the first whole hour inside the window', () => {
    // The window starts Sun Nov 1 21:17 UTC.
    const d = only(releaseWeekFacts(graded(full(MON), release('2026-11-01'))), 'release_week');
    expect(d.dates).toEqual([ts('2026-11-01T22:00:00'), MON]);
    expect(d.statement).toBe('Eternal Embers by Meltt came out on Sun Nov 1, and you played it start to finish on Mon Nov 2.');
    expectGrounded(d);
  });

  it('reads dates in the owner\'s timezone', () => {
    // 03:00 UTC Tue Nov 3 is Mon Nov 2 in Los Angeles, the release day there.
    const late = ts('2026-11-03T03:00:00');
    const ctx = graded(full(late), release('2026-11-02'));
    const la = { ...ctx, inputs: { ...ctx.inputs, timezone: 'America/Los_Angeles' } };
    const d = only(releaseWeekFacts(la), 'release_week');
    expect(d.statement).toBe('Eternal Embers by Meltt came out on Mon Nov 2, and you played it start to finish that day.');
    expect(d.salience).toBe(80);
    expectGrounded(d, 'America/Los_Angeles');
    // In UTC the run is on Tue Nov 3, the day after.
    expect(only(releaseWeekFacts(ctx), 'release_week').salience).toBe(70);
  });
});
