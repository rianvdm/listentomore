// ABOUTME: buildWeekFacts - turns one WeekInputs into the ranked WeekFacts object: weeks, dedupe, baseline,
// ABOUTME: the fact rules, ranking, the question, the window line, top artists, caveats, names and card albums.

import { cardAlbums } from './card-albums';
import { dedupe } from './dedupe';
import { albumFacts } from './facts-album';
import { artistFacts } from './facts-artist';
import { releaseWeekFacts } from './facts-release';
import { plural } from './facts-shared';
import { weekFacts } from './facts-week';
import { artistWeeks } from './history';
import type { ArtistWeek } from './history';
import { QUIET_THRESHOLD, chooseQuestion, rankFacts } from './rank';
import { albumRuns } from './runs';
import type { AlbumRun } from './runs';
import { StatementBuilder } from './statement';
import { RULE_VERSION, albumKey } from './types';
import type { FactContext, FactKind, QuestionKind, Scrobble, WeekFacts, WeekInputs } from './types';
import { weekWindow } from './window';

/** This week plus the four before it: the 35 days of scrobbles the inputs carry. */
const WEEKS = 5;
/** Prior weeks with plays, and usable baseline weeks, an account needs for a baseline (spec section 1, "Provenance"). */
const MIN_BASELINE_WEEKS = 4;
const TOP_ARTISTS = 8;
const WINDOW_DAYS = 7;
/** Facts that state a share of the week, which a truncated week cannot support (spec section 1, caps). */
const SHARE_KINDS: ReadonlySet<FactKind> = new Set<FactKind>(['album_mode', 'themed_block']);

export const TRUNCATED_CAVEAT = 'this week has more scrobbles than could be read, so its counts cover only the most recent plays';
export const DUPLICATES_CAVEAT = 'counts exclude likely duplicate scrobbles';

const byPlaysThenName = (a: ArtistWeek, b: ArtistWeek): number => b.plays - a.plays || a.artist.localeCompare(b.artist);

/**
 * 'none' with fewer than 4 prior weeks with plays or fewer than 4 usable baseline weeks (prior scrobble weeks
 * and chart weeks with plays); 'partial' when the history page cap was hit; otherwise 'full'.
 */
function baselineOf(inputs: WeekInputs, rawWeeks: Scrobble[][]): FactContext['baseline'] {
  const priorWithPlays = rawWeeks.slice(1).filter((w) => w.length > 0).length;
  const chartWithPlays = inputs.chartWeeks.filter((w) => Object.values(w.counts).some((n) => n > 0)).length;
  if (priorWithPlays < MIN_BASELINE_WEEKS || priorWithPlays + chartWithPlays < MIN_BASELINE_WEEKS) return 'none';
  return inputs.historyComplete ? 'full' : 'partial';
}

/**
 * Mean deduped plays of the 4 prior weeks, rounded as the window line states it. Null unless the baseline is
 * full: a partial history may be missing days of those weeks, which is why the volume fact is suppressed too.
 */
function priorAverageOf(baseline: FactContext['baseline'], weeks: Scrobble[][]): number | null {
  if (baseline !== 'full') return null;
  const prior = weeks.slice(1);
  return Math.round(prior.reduce((sum, w) => sum + w.length, 0) / prior.length);
}

/** Fact 0: "Week: <from> to <to> (rolling 7 days). N plays; the usual week is about M." with typed values. */
function windowFact(inputs: WeekInputs, plays: number, priorAverage: number | null): WeekFacts['windowFact'] {
  const { from, to } = weekWindow(inputs.now);
  const b = new StatementBuilder(inputs.timezone).add('Week: ').day(from).add(' to ').day(to - 1)
    .add(' (rolling ').number(WINDOW_DAYS, 'days').add(' days). ').number(plays, 'plays').add(plural(plays, ' play', ' plays'));
  if (priorAverage !== null) b.add('; the usual week is about ').number(priorAverage, 'plays');
  b.add('.');
  return { id: 0, kind: 'volume', salience: 0, subject: null, ...b.build(), edges: [] };
}

/** Mislabelled runs (one caveat per album, in run order), truncation, and the dedupe note. */
function caveatsOf(inputs: WeekInputs, runs: AlbumRun[]): string[] {
  const seen = new Set<string>();
  const caveats: string[] = [];
  for (const run of runs) {
    const key = albumKey(run.artist, run.album);
    if (run.verdict !== 'mislabelled' || seen.has(key)) continue;
    seen.add(key);
    caveats.push(run.phrase);
  }
  if (inputs.currentWeekTruncated) caveats.push(TRUNCATED_CAVEAT);
  caveats.push(DUPLICATES_CAVEAT);
  return caveats;
}

/**
 * The week's facts, ranked, with everything the prompt view, the guard and the code lines read.
 * `lastQuestion` is the owner's stored last question, for rotation; visitors pass nothing.
 */
export function buildWeekFacts(
  inputs: WeekInputs,
  opts: { lastQuestion?: { kind: QuestionKind; subject: string } | null } = {},
): WeekFacts {
  const rawWeeks = Array.from({ length: WEEKS }, (_, back) => {
    const { from, to } = weekWindow(inputs.now, back);
    return inputs.scrobbles.filter((s) => s.ts >= from && s.ts < to);
  });
  const weeks = rawWeeks.map((w) => dedupe(w).kept);
  const baseline = baselineOf(inputs, rawWeeks);
  const artists = artistWeeks(inputs, weeks, rawWeeks);
  const ctx: FactContext = { inputs, artists, runs: albumRuns(weeks[0], inputs.albums), week: weeks[0], rawWeeks, weeks, baseline };

  const drafts = [...artistFacts(ctx), ...albumFacts(ctx), ...releaseWeekFacts(ctx), ...weekFacts(ctx)]
    .filter((d) => !(inputs.currentWeekTruncated && SHARE_KINDS.has(d.kind)));
  const facts = rankFacts(drafts, new Map([...artists.values()].map((a) => [a.artist, a.plays])));
  const quiet = facts.length === 0 || facts[0].salience < QUIET_THRESHOLD;
  const priorAverage = priorAverageOf(baseline, weeks);

  const names = new Set<string>();
  for (const s of rawWeeks[0]) {
    names.add(s.artist);
    if (s.album.trim()) names.add(s.album);
  }
  for (const f of facts) for (const e of f.entities) names.add(e);

  return {
    schema: 'week-facts/v1',
    ruleVersion: RULE_VERSION,
    username: inputs.username,
    timezone: inputs.timezone,
    window: weekWindow(inputs.now),
    pulledAt: inputs.now,
    plays: { deduped: weeks[0].length, raw: rawWeeks[0].length, duplicatesRemoved: rawWeeks[0].length - weeks[0].length },
    priorAverage,
    baseline,
    windowFact: windowFact(inputs, weeks[0].length, priorAverage),
    facts,
    topArtists: [...artists.values()].sort(byPlaysThenName).slice(0, TOP_ARTISTS)
      .map(({ artist, plays, tier, nameUncertain }) => ({ artist, plays, tier, nameUncertain })),
    caveats: caveatsOf(inputs, ctx.runs),
    quiet,
    // A quiet week gets the code sentence and no note, so nothing for a question to follow.
    question: quiet ? null : chooseQuestion(facts, opts.lastQuestion ?? null),
    names: [...names].sort((a, b) => a.localeCompare(b)),
    releasesChecked: inputs.releases !== undefined,
    cardAlbums: cardAlbums(facts, ctx.runs, weeks[0]),
  };
}
