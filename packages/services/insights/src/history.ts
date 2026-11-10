// ABOUTME: Per-artist history for the week - lifetime plays before it, absence windows and familiarity tier.
// ABOUTME: Follows spec sections 1 ("Provenance") and 2 ("Familiarity tiers"); build.py is the reference.

import type { CountList, Scrobble, Tier, WeekInputs } from './types';
import { norm } from './text';

export interface ArtistWeek {
  artist: string;                   // exact name as scrobbled
  plays: number;                    // deduped plays this week
  rawPlays: number;                 // raw plays this week
  playsLastWeek: number;            // deduped plays last week
  lifetimeBefore: number | null;    // plays before this week; null when history is missing or inconsistent
  absentMonths: 3 | 6 | 12 | null;  // largest complete period list with no plays before this week
  tier: Tier;
  nameUncertain: boolean;
  allTimeRank: number | null;       // rank in the overall list now
}

const BARELY_KNOWN_MAX = 15;
const LAPSED_MIN = 20;
const ALL_TIME_FAVOURITE_RANK = 25;
const ROTATION_SIZE = 40;
const ABSENCE_WINDOWS = [[12, 'm12'], [6, 'm6'], [3, 'm3']] as const;
const CREDIT_WORDS = new Set(['&', 'and', 'feat', 'feat.', 'ft', 'ft.', 'x', 'with', '+']);

/**
 * True when any whole token of the normalised name is a credit separator, or the name has a comma
 * or slash, so it may be a collaboration credit rather than an artist the listener knows under
 * another name (spec section 2, "Familiarity tiers"). Every token counts, the first and last too,
 * so "With Confidence", "X Ambassadors", "AC/DC" and "Tyler, The Creator" are caught along with
 * real credits: the cost is only a withheld first-plays claim.
 */
export function isNameUncertain(name: string): boolean {
  if (/[,/]/.test(name)) return true;
  return norm(name).split(' ').some((word) => CREDIT_WORDS.has(word));
}

const countBy = (scrobbles: Scrobble[], key: (s: Scrobble) => string): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const s of scrobbles) counts.set(key(s), (counts.get(key(s)) ?? 0) + 1);
  return counts;
};

/**
 * Builds the history of every artist played this week, keyed by exact artist name.
 * `weeks[0]` / `rawWeeks[0]` are this week deduped / raw; `weeks[1]` is last week deduped.
 *
 * Every history count is a snapshot taken at its `fetchedAt`, so "before this week" subtracts only
 * the raw plays this week at or before that moment. Lists are keyed by `norm(artist)`, so raw plays
 * are matched by normalised name too.
 */
export function artistWeeks(inputs: WeekInputs, weeks: Scrobble[][], rawWeeks: Scrobble[][]): Map<string, ArtistWeek> {
  const thisWeek = weeks[0] ?? [];
  const plays = countBy(thisWeek, (s) => s.artist);
  const rawPlays = countBy(rawWeeks[0] ?? [], (s) => s.artist);
  const playsLastWeek = countBy(weeks[1] ?? [], (s) => s.artist);

  const rawTimes = new Map<string, number[]>();
  for (const s of rawWeeks[0] ?? []) {
    const times = rawTimes.get(norm(s.artist));
    if (times) times.push(s.ts);
    else rawTimes.set(norm(s.artist), [s.ts]);
  }
  const rawPlaysThrough = (key: string, fetchedAt: number): number =>
    (rawTimes.get(key) ?? []).filter((ts) => ts <= fetchedAt).length;

  const rotation = new Set(
    Object.entries(inputs.period.m6.counts)
      .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
      .slice(0, ROTATION_SIZE)
      .map(([key]) => key),
  );

  const lifetimeBefore = (artist: string, key: string): number | null => {
    const snapshots = [
      { count: inputs.overall.counts[key], fetchedAt: inputs.overall.fetchedAt },
      inputs.artistLifetime[artist],
    ].filter((s): s is { count: number; fetchedAt: number } => s !== undefined && s.count !== undefined);
    if (snapshots.length === 0) return null;
    // The larger count wins; on a tie the overall list, listed first, is kept.
    const largest = snapshots.reduce((best, s) => (s.count > best.count ? s : best));
    const before = largest.count - rawPlaysThrough(key, largest.fetchedAt);
    return before < 0 ? null : before;
  };

  // Absence from a period list means zero plays only when the list is complete.
  const absentMonths = (key: string): 3 | 6 | 12 | null => {
    for (const [months, period] of ABSENCE_WINDOWS) {
      const list: CountList = inputs.period[period];
      if (list.complete && (list.counts[key] ?? 0) - rawPlaysThrough(key, list.fetchedAt) === 0) return months;
    }
    return null;
  };

  const result = new Map<string, ArtistWeek>();
  for (const [artist, count] of plays) {
    const key = norm(artist);
    const before = lifetimeBefore(artist, key);
    const absent = absentMonths(key);
    const nameUncertain = isNameUncertain(artist);
    const allTimeRank = inputs.overall.ranks[key] ?? null;

    let tier: Tier;
    if (before === null) tier = 'unknown';
    else if (before === 0) tier = nameUncertain ? 'unknown' : 'first_under_this_name';
    else if (before <= BARELY_KNOWN_MAX) tier = 'barely_known';
    else if (before >= LAPSED_MIN && absent !== null) tier = 'lapsed';
    else if (allTimeRank !== null && allTimeRank <= ALL_TIME_FAVOURITE_RANK) tier = 'all_time_favourite';
    else if (rotation.has(key) || absent === null) tier = 'regular';
    else tier = 'occasional';

    result.set(artist, {
      artist,
      plays: count,
      rawPlays: rawPlays.get(artist) ?? 0,
      playsLastWeek: playsLastWeek.get(artist) ?? 0,
      lifetimeBefore: before,
      absentMonths: absent,
      tier,
      nameUncertain,
      allTimeRank,
    });
  }
  return result;
}
