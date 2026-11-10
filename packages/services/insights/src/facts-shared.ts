// ABOUTME: Helpers the artist, album and week fact rules share - clamped scores, run phrases, the baseline weeks
// ABOUTME: and the "after" edge, so every rule states runs and applies spec section 2 the same way.

import type { AlbumRun } from './runs';
import type { StatementBuilder } from './statement';
import { norm } from './text';
import type { FactContext, Scrobble } from './types';
import { dayLabel } from './window';

const BASELINE_RAW_WEEKS = 4;
const QUIET_GAP_SECONDS = 36 * 3600;

/** Clamped to 0..100 and rounded to one decimal. */
export const score = (x: number): number => Math.round(Math.min(100, Math.max(0, x)) * 10) / 10;

export const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** How a statement marks an artist with no plays before this week; the guard reads it to allow the same claim. */
export const FIRST_UNDER_THIS_NAME = 'first plays under this name';

/** Writes a run as runs.ts phrases it, with its album and track counts typed. Callers never pass a mislabelled run. */
export function writeRun(b: StatementBuilder, run: AlbumRun): void {
  if (run.verdict === 'start_to_finish') {
    b.name(run.album).add(' start to finish');
  } else if (run.verdict === 'most_of' && run.coverage !== null && run.tracklistLength !== null) {
    const covered = Math.round(run.coverage * run.tracklistLength);
    b.number(covered, 'tracks', run.album).add(' of ').number(run.tracklistLength, 'tracks', run.album)
      .add(' tracks of ').name(run.album).add(', in order');
  } else {
    b.number(run.tracksPlayed, 'tracks', run.album).add(' tracks in a row from ').name(run.album);
  }
}

/**
 * Raw plays per `norm(artist)` in each baseline week: the 4 raw scrobble weeks before this one, then the chart
 * weeks (spec section 1: 12 weeks, 4 from scrobbles and 8 from charts). Missing chart weeks shrink the list.
 * Null without a full baseline or with no weeks at all.
 */
export function baselineWeeks(ctx: FactContext): Array<Record<string, number>> | null {
  if (ctx.baseline !== 'full') return null;
  const counts = (week: Scrobble[]): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const s of week) out[norm(s.artist)] = (out[norm(s.artist)] ?? 0) + 1;
    return out;
  };
  const weeks = [...ctx.rawWeeks.slice(1, 1 + BASELINE_RAW_WEEKS).map(counts), ...ctx.inputs.chartWeeks.map((w) => w.counts)];
  return weeks.length > 0 ? weeks : null;
}

/**
 * The last play of a subject that has the "after" edge (spec section 2, "Question"): plays on 2+ days this week,
 * then none recorded for 36+ hours before the window end. `played` is the subject's plays this week, ascending.
 */
export function quietAfter(ctx: FactContext, played: Scrobble[]): number | null {
  if (played.length === 0) return null;
  const days = new Set(played.map((s) => dayLabel(s.ts, ctx.inputs.timezone)));
  const last = played[played.length - 1].ts;
  return days.size >= 2 && last <= ctx.inputs.now - QUIET_GAP_SECONDS ? last : null;
}
