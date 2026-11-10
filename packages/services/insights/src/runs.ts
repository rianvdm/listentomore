// ABOUTME: Album runs - same-album stretches of a week, graded against the Last.fm tracklist.
// ABOUTME: Also groups back-to-back full albums into chains and measures the week's album-mode share.

import { albumKey } from './types';
import type { AlbumInfo, Scrobble } from './types';
import { norm } from './text';

export type Verdict = 'start_to_finish' | 'most_of' | 'mislabelled' | 'unverified';

export interface AlbumRun {
  artist: string;
  album: string;
  from: number;                   // ts of the run's first scrobble
  to: number;                     // ts of the run's last scrobble
  tracksPlayed: number;           // distinct normalised titles
  tracklistLength: number | null; // distinct normalised titles on the list; null without a list
  coverage: number | null;        // share of the list played; null when the run was not graded
  verdict: Verdict;
  phrase: string;
}

/** Longest gap, in seconds, between two scrobbles of one run. */
const MAX_GAP = 90 * 60;
/** Longest gap, in seconds, between two runs of one chain (exclusive). */
const CHAIN_GAP = 30 * 60;
const MIN_TRACKS = 6;
const MIN_EP_TRACKS = 4;
const MAX_EP_TRACKS = 5;
/** Distinct tracks a same-album run needs to count toward the album-mode share; facts state it. */
export const MODE_MIN_TRACKS = 8;

/**
 * Splits a week into same-album runs: consecutive scrobbles with one albumKey and gaps up to 90 minutes.
 * Scrobbles with no album are skipped, so they neither form nor split a run.
 */
function sameAlbumRuns(week: Scrobble[]): Scrobble[][] {
  const out: Scrobble[][] = [];
  let cur: Scrobble[] = [];
  let curKey = '';
  for (const s of week) {
    if (!norm(s.album)) continue;
    const key = albumKey(s.artist, s.album);
    if (cur.length && (key !== curKey || s.ts - cur[cur.length - 1].ts > MAX_GAP)) {
      out.push(cur);
      cur = [];
    }
    cur.push(s);
    curKey = key;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Non-empty normalised titles in first-seen order, each counted once. */
const distinctTitles = (titles: string[]): string[] => [...new Set(titles.map(norm))].filter(Boolean);

const baseTitle = (title: string): string => title.split(' - ')[0];

/**
 * Index of the tracklist entry a played title matches, or null when it is off-list.
 * An exact match wins, then equal text before ' - ', then the longest title that is a prefix of the other.
 */
function trackIndex(played: string, tracklist: string[]): number | null {
  const exact = tracklist.indexOf(played);
  if (exact >= 0) return exact;
  const base = tracklist.findIndex((t) => baseTitle(t) === baseTitle(played));
  if (base >= 0) return base;
  let best: number | null = null;
  for (let i = 0; i < tracklist.length; i++) {
    const t = tracklist[i];
    if (!t || !played || !(t.startsWith(played) || played.startsWith(t))) continue;
    if (best === null || t.length > tracklist[best].length) best = i;
  }
  return best;
}

interface Grade { coverage: number; covered: number; verdict: Verdict }

/** Grades a run's distinct titles against a distinct, normalised tracklist. */
function grade(played: string[], tracklist: string[]): Grade {
  const indices = played.map((p) => trackIndex(p, tracklist));
  const onList = indices.filter((i): i is number => i !== null);
  const covered = new Set(onList).size;
  const coverage = covered / tracklist.length;
  const increases = onList.slice(1).filter((i, n) => i > onList[n]).length;
  const inOrder = increases / Math.max(1, onList.length - 1);
  const offList = (indices.length - onList.length) / played.length;
  const firstAndLast = onList.includes(0) && onList.includes(tracklist.length - 1);
  if (coverage >= 0.9 && firstAndLast && inOrder >= 0.8 && offList <= 0.1) return { coverage, covered, verdict: 'start_to_finish' };
  if (coverage >= 0.6 && inOrder >= 0.8) return { coverage, covered, verdict: 'most_of' };
  if (offList > 0.3) return { coverage, covered, verdict: 'mislabelled' };
  return { coverage, covered, verdict: 'unverified' };
}

function phrase(verdict: Verdict, artist: string, album: string, tracksPlayed: number, covered: number, tracklistLength: number | null): string {
  switch (verdict) {
    case 'start_to_finish': return `${album} start to finish`;
    case 'most_of': return `${covered} of ${tracklistLength} tracks of ${album}, in order`;
    case 'mislabelled': return `${artist} tracks scrobbled as ${album} are mostly not on that album, so treat them as a run of ${artist} tracks`;
    case 'unverified': return `${tracksPlayed} tracks in a row from ${album}`;
  }
}

/** Builds the graded run for one same-album stretch, or null when it is not a candidate. */
function toAlbumRun(run: Scrobble[], albums: Record<string, AlbumInfo>): AlbumRun | null {
  const { artist, album } = run[0];
  const played = distinctTitles(run.map((s) => s.track));
  const listed = distinctTitles(albums[albumKey(artist, album)]?.tracklist ?? []);
  const tracklist = listed.length ? listed : null;
  const tracklistLength = tracklist?.length ?? null;
  const graded = tracklist ? grade(played, tracklist) : null;
  const wholeEp = tracklistLength !== null && tracklistLength >= MIN_EP_TRACKS && tracklistLength <= MAX_EP_TRACKS
    && graded?.covered === tracklistLength;
  if (played.length < MIN_TRACKS && !wholeEp) return null;
  // A list shorter than the run is usually a single or another release under the same name: it cannot verify the run.
  const usable = graded !== null && tracklistLength !== null && tracklistLength >= played.length ? graded : null;
  const verdict = usable?.verdict ?? 'unverified';
  return {
    artist,
    album,
    from: run[0].ts,
    to: run[run.length - 1].ts,
    tracksPlayed: played.length,
    tracklistLength,
    coverage: usable?.coverage ?? null,
    verdict,
    phrase: phrase(verdict, artist, album, played.length, usable?.covered ?? 0, tracklistLength),
  };
}

/** A same-album stretch that could become an album run once its tracklist is known. */
export interface RunToLookUp {
  artist: string;
  album: string;
  from: number;          // ts of the stretch's first scrobble
  tracksPlayed: number;  // distinct normalised titles
}

/**
 * Same-album stretches of 4+ distinct tracks, longest first, then earliest: the albums whose tracklists
 * are worth fetching. albumRuns cannot choose these, since a 4- or 5-track stretch is a candidate only
 * once a tracklist shows it is a whole EP.
 */
export function runsToLookUp(week: Scrobble[]): RunToLookUp[] {
  return sameAlbumRuns(week)
    .map((run) => ({
      artist: run[0].artist,
      album: run[0].album,
      from: run[0].ts,
      tracksPlayed: distinctTitles(run.map((s) => s.track)).length,
    }))
    .filter((run) => run.tracksPlayed >= MIN_EP_TRACKS)
    .sort((a, b) => b.tracksPlayed - a.tracksPlayed || a.from - b.from);
}

/** Candidate album runs of the week, graded against `albums` (keyed by albumKey), longest first. */
export function albumRuns(week: Scrobble[], albums: Record<string, AlbumInfo>): AlbumRun[] {
  return sameAlbumRuns(week)
    .map((run) => toAlbumRun(run, albums))
    .filter((run): run is AlbumRun => run !== null)
    .sort((a, b) => b.tracksPlayed - a.tracksPlayed || a.from - b.from);
}

/** Chains of 3+ start_to_finish runs, in time order, with under 30 minutes between each. */
export function albumChains(runs: AlbumRun[]): AlbumRun[][] {
  const full = runs.filter((r) => r.verdict === 'start_to_finish').sort((a, b) => a.from - b.from);
  const chains: AlbumRun[][] = [];
  let cur: AlbumRun[] = [];
  for (const run of full) {
    if (cur.length && run.from - cur[cur.length - 1].to >= CHAIN_GAP) {
      chains.push(cur);
      cur = [];
    }
    cur.push(run);
  }
  chains.push(cur);
  return chains.filter((c) => c.length >= 3);
}

/** Share of the week's plays that sit inside same-album runs of 8+ distinct tracks; 0 for an empty week. */
export function albumModeShare(week: Scrobble[]): number {
  if (!week.length) return 0;
  const inRuns = sameAlbumRuns(week)
    .filter((run) => distinctTitles(run.map((s) => s.track)).length >= MODE_MIN_TRACKS)
    .reduce((sum, run) => sum + run.length, 0);
  return inRuns / week.length;
}
