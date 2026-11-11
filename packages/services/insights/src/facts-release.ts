// ABOUTME: The release_week fact - an album played start to finish or mostly in order in the week Spotify says it
// ABOUTME: came out. Day-precision dates only; edition markers and mismatched titles or artists never fire.

import { score } from './facts-shared';
import { hasEditionMarker, matchKey } from './match';
import type { AlbumRun } from './runs';
import { StatementBuilder } from './statement';
import { albumKey } from './types';
import type { Draft, FactContext, ReleaseInfo } from './types';
import { localDate, tsOnLocalDate, weekWindow } from './window';

const RELEASE_SALIENCE = 70;
/** Added when the run was on the release day itself. */
const RELEASE_DAY_BONUS = 10;
/** Spotify's release_date at day precision; month- and year-precision dates never fire. */
const DAY_PRECISION = /^\d{4}-\d{2}-\d{2}$/;

const SEPARATOR = ', ';

interface Candidate {
  run: AlbumRun;
  release: ReleaseInfo;
  onTheDay: boolean;
  /** A most_of run's tracks played and tracklist length; null for start_to_finish. */
  tracks: { covered: number; length: number } | null;
}

/** The Spotify artist is the run's artist, whole or as one of its ', '-separated names. */
function artistMatches(release: ReleaseInfo, artist: string): boolean {
  const key = matchKey(artist);
  return matchKey(release.artist) === key || release.artist.split(SEPARATOR).some((name) => matchKey(name) === key);
}

/** The release is the record of the run: same title, same artist, and neither title is another edition. */
function sameRecord(release: ReleaseInfo, run: AlbumRun): boolean {
  return !hasEditionMarker(run.album) && !hasEditionMarker(release.title)
    && matchKey(release.title) === matchKey(run.album) && artistMatches(release, run.artist);
}

/**
 * How the statement can state the run: null for start_to_finish, or a most_of run's tracks as writeRun counts them.
 * Undefined for any other verdict, which the fact never states.
 */
function tracksOf(run: AlbumRun): Candidate['tracks'] | undefined {
  if (run.verdict === 'start_to_finish') return null;
  if (run.verdict !== 'most_of' || run.coverage === null || run.tracklistLength === null) return undefined;
  return { covered: Math.round(run.coverage * run.tracklistLength), length: run.tracklistLength };
}

/** Orders an album's candidates: the run on the release day, then a start_to_finish run, then the earliest. */
const preferred = (a: Candidate, b: Candidate): number => Number(b.onTheDay) - Number(a.onTheDay)
  || Number(b.tracks === null) - Number(a.tracks === null)
  || a.run.from - b.run.from;

/**
 * One fact per album with a start_to_finish or most_of run on or after its release date, when that date is in the
 * week window. The run on the release day wins, then a start_to_finish run, then the earliest. Salience 70, plus 10
 * when the run was on the release day. Nothing without release lookups (a visitor's facts).
 */
export function releaseWeekFacts(ctx: FactContext): Draft[] {
  const releases = ctx.inputs.releases;
  if (!releases) return [];
  const tz = ctx.inputs.timezone;
  const window = weekWindow(ctx.inputs.now);
  const windowDate = localDate(window.from, tz);

  const byAlbum = new Map<string, Candidate[]>();
  for (const run of ctx.runs) {
    const tracks = tracksOf(run);
    if (tracks === undefined) continue;
    const key = albumKey(run.artist, run.album);
    const release = releases[key];
    if (!release || !DAY_PRECISION.test(release.date) || !sameRecord(release, run)) continue;
    const runDate = localDate(run.from, tz);
    if (release.date < windowDate || release.date > runDate) continue;
    byAlbum.set(key, [...(byAlbum.get(key) ?? []), { run, release, onTheDay: release.date === runDate, tracks }]);
  }

  const drafts: Draft[] = [];
  for (const candidates of byAlbum.values()) {
    const [{ run, release, onTheDay, tracks }] = [...candidates].sort(preferred);
    const releaseDay = onTheDay ? run.from : tsOnLocalDate(release.date, tz, window.from, run.from);
    if (releaseDay === null) continue;

    const b = new StatementBuilder(tz).album(run.artist, run.album).add(' by ').name(run.artist).add(' came out on ').day(releaseDay)
      .add(', and you played ');
    if (tracks === null) b.add('it start to finish ');
    else b.number(tracks.covered, 'tracks', run.album).add(' of ').number(tracks.length, 'tracks', run.album).add(' tracks of it, in order, ');
    if (onTheDay) b.add('that day.');
    else b.add('on ').day(run.from).add('.');
    drafts.push({
      kind: 'release_week',
      salience: score(RELEASE_SALIENCE + (onTheDay ? RELEASE_DAY_BONUS : 0)),
      subject: run.artist,
      ...b.build(),
      edges: [],
    });
  }
  return drafts;
}
