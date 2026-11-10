// ABOUTME: Week-level facts - breadth against the usual week, last week's top artists fading, themed blocks and volume.
// ABOUTME: Ports build.py's rules with spec section 2's corrections; every stated value is typed on the draft.

import { baselineWeeks, plural, score } from './facts-shared';
import { StatementBuilder } from './statement';
import { BUCKET_LABELS, bucketOf } from './tags';
import { norm } from './text';
import type { Draft, FactContext, Scrobble } from './types';
import { localHour } from './window';

const BREADTH_MIN_PLAYS = 10;
const WIDE_RATIO = 1.5;
const WIDE_MIN_MORE = 4;
const NARROW_RATIO = 0.5;
const NARROW_MIN_MEDIAN = 4;
const FADED_TOP = 5;
const FADED_MAX_SHARE = 0.1;
const BLOCK_MAX_GAP = 2 * 3600;
const BLOCK_MAX_INTERRUPTIONS = 3;
const BLOCK_MIN_MINUTES = 60;
const BLOCK_LAST_TRACK_MINUTES = 4;
const BLOCK_MIN_PLAYS = 12;
const BLOCK_MIN_ARTISTS = 4;
const BLOCK_MAX_SHARE = 0.15;
const BLOCK_NAMED_ARTISTS = 4;
const VOLUME_WEEKS = 4;
const VOLUME_MIN_CHANGE = 20;

/** Plays per exact artist name, in first-seen order. */
const countByArtist = (week: Scrobble[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const s of week) counts.set(s.artist, (counts.get(s.artist) ?? 0) + 1);
  return counts;
};

const byCountThenName = ([n1, c1]: [string, number], [n2, c2]: [string, number]): number => c2 - c1 || n1.localeCompare(n2);

const median = (xs: number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const mean = (xs: number[]): number => xs.reduce((sum, x) => sum + x, 0) / xs.length;

// ---------- breadth ----------

/**
 * Artists at 10+ raw plays this week against the median of the same count over the baseline weeks (raw on both
 * sides, because chart weeks count every scrobble). Wide at 1.5 times the median and 4 more; narrow at half or
 * less with a median of 4+. A median of zero is a zero denominator and suppresses the fact.
 */
function breadth(ctx: FactContext): Draft | null {
  const weeks = baselineWeeks(ctx);
  if (!weeks) return null;
  const usual = median(weeks.map((w) => Object.values(w).filter((n) => n >= BREADTH_MIN_PLAYS).length));
  if (usual === 0) return null;

  // Counted by normalised name, as the baseline is; each artist is named as first scrobbled this week.
  const counts = new Map<string, [string, number]>();
  for (const s of ctx.rawWeeks[0] ?? []) {
    const entry = counts.get(norm(s.artist));
    if (entry) entry[1]++;
    else counts.set(norm(s.artist), [s.artist, 1]);
  }
  const reached = [...counts.values()].filter(([, n]) => n >= BREADTH_MIN_PLAYS).sort(byCountThenName);
  const now = reached.length;
  const wide = now >= WIDE_RATIO * usual && now - usual >= WIDE_MIN_MORE;
  const narrow = usual >= NARROW_MIN_MEDIAN && now <= NARROW_RATIO * usual;
  if (!wide && !narrow) return null;

  // A narrow week names its few artists, so a note naming one of them stays grounded. Each qualified on raw plays;
  // its deduped count is given only when it also meets the threshold, so no count contradicts "10 or more plays".
  const deduped = new Map<string, number>();
  for (const s of ctx.week) deduped.set(norm(s.artist), (deduped.get(norm(s.artist)) ?? 0) + 1);
  const b = new StatementBuilder(ctx.inputs.timezone).add(wide ? 'A wide week: ' : 'A narrow week: only ')
    .number(now, 'artists').add(plural(now, ' artist reached ', ' artists reached ')).number(BREADTH_MIN_PLAYS, 'plays')
    .add(' or more plays');
  if (narrow && now > 0) {
    b.add(' (').each(reached, '; ', (w, [name]) => {
      const plays = deduped.get(norm(name)) ?? 0;
      w.name(name);
      if (plays >= BREADTH_MIN_PLAYS) w.add(', ').number(plays, 'plays', name).add(' plays');
    }).add(')');
  }
  b.add(', against a usual ').number(Math.round(usual), 'artists').add(' (median of the previous ')
    .number(weeks.length, 'weeks').add(plural(weeks.length, ' week)', ' weeks)'));
  if (wide) b.add(': ').each(reached, ', ', (w, [name]) => w.name(name));
  b.add('.');
  return {
    kind: 'breadth',
    salience: wide ? score(60 + 30 * Math.min(1, now / usual - 1)) : 55,
    subject: null,
    ...b.build(),
    edges: [],
  };
}

// ---------- last week faded ----------

/**
 * Last week's top five artists that played at 10% or less of last week's count. Suppressed when the history is
 * incomplete (spec section 1, caps): the inputs do not say which days are missing, so last week may be one.
 */
function lastWeekFaded(ctx: FactContext): Draft | null {
  if (!ctx.inputs.historyComplete) return null;
  const now = countByArtist(ctx.week);
  const faded = [...countByArtist(ctx.weeks[1] ?? []).entries()]
    .sort(byCountThenName)
    .slice(0, FADED_TOP)
    .filter(([name, last]) => (now.get(name) ?? 0) / last <= FADED_MAX_SHARE);
  if (faded.length === 0) return null;
  const b = new StatementBuilder(ctx.inputs.timezone).add("Last week's top artists dropped away: ")
    .each(faded, ', ', (w, [name, last]) => {
      w.name(name).add(' (').number(last, 'plays', name).add(plural(last, ' play last week, ', ' plays last week, '))
        .number(now.get(name) ?? 0, 'plays', name).add(' this week)');
    })
    .add('.');
  return { kind: 'last_week_faded', salience: 45, subject: null, ...b.build(), edges: [] };
}

// ---------- themed blocks ----------

interface Block { theme: string; plays: Scrobble[]; from: number; to: number }

/**
 * Stretches of the week in one genre bucket, as build.py finds them: a gap over 2 hours ends a block, and up to
 * three plays outside the bucket in a row are carried as interruptions; a fourth ends it. Plays with no bucket
 * never start a block. Only the block's in-bucket plays are kept, because the statement counts plays of the theme.
 */
function themedBlocks(week: Scrobble[], bucket: (artist: string) => string | null): Block[] {
  const blocks: Block[] = [];
  const flush = (cur: Scrobble[]): void => {
    const theme = cur.length ? bucket(cur[0].artist) : null;
    if (theme === null) return;
    blocks.push({ theme, plays: cur.filter((s) => bucket(s.artist) === theme), from: cur[0].ts, to: cur[cur.length - 1].ts });
  };
  let cur: Scrobble[] = [];
  let pending: Scrobble[] = [];
  for (const s of week) {
    const b = bucket(s.artist);
    if (cur.length && s.ts - cur[cur.length - 1].ts > BLOCK_MAX_GAP) {
      flush(cur);
      cur = [];
      pending = [];
    }
    if (cur.length && b !== bucket(cur[0].artist)) {
      pending.push(s);
      if (pending.length <= BLOCK_MAX_INTERRUPTIONS) continue;
      flush(cur);
      cur = pending.filter((p) => bucket(p.artist) !== null).slice(-1);
      pending = [];
      continue;
    }
    if (b === null) continue;
    cur.push(...pending, s);
    pending = [];
  }
  flush(cur);
  return blocks;
}

const DAYPARTS: ReadonlyArray<readonly [number, string]> = [
  [9, 'early morning'], [12, 'morning'], [17, 'afternoon'], [21, 'evening'], [24, 'late night'],
];

/** 'afternoon' and so on in the owner's timezone; null without one, since a UTC hour would mislabel the day part. */
function daypart(ts: number, tz: string | null): string | null {
  const hour = localHour(ts, tz);
  return hour === null ? null : DAYPARTS.find(([end]) => hour < end)?.[1] ?? null;
}

/** Blocks of 60+ minutes, 12+ plays and 4+ artists in one bucket that is under 15% of the week. */
function themedBlockFacts(ctx: FactContext): Draft[] {
  if (ctx.week.length === 0) return [];
  const buckets = new Map<string, string | null>();
  const bucket = (artist: string): string | null => {
    if (!buckets.has(artist)) buckets.set(artist, bucketOf(ctx.inputs.tags[artist] ?? []));
    return buckets.get(artist) ?? null;
  };
  const weekShare = (theme: string): number => ctx.week.filter((s) => bucket(s.artist) === theme).length / ctx.week.length;

  return themedBlocks(ctx.week, bucket)
    .filter((block) => {
      const minutes = Math.floor((block.to - block.from) / 60) + BLOCK_LAST_TRACK_MINUTES;
      return minutes >= BLOCK_MIN_MINUTES && block.plays.length >= BLOCK_MIN_PLAYS
        && countByArtist(block.plays).size >= BLOCK_MIN_ARTISTS && weekShare(block.theme) < BLOCK_MAX_SHARE;
    })
    .map((block) => {
      const label = BUCKET_LABELS[block.theme] ?? block.theme;
      const artists = [...countByArtist(block.plays).entries()].sort(byCountThenName);
      const part = daypart(block.from, ctx.inputs.timezone);
      const b = new StatementBuilder(ctx.inputs.timezone).day(block.from).add(part ? `, ${part}: ` : ': ')
        .number(block.plays.length, 'plays').add(` plays of ${label} from `).number(artists.length, 'artists')
        .add(' artists (most played: ').each(artists.slice(0, BLOCK_NAMED_ARTISTS), ', ', (w, [name]) => w.name(name))
        .add(`); ${label} is `).number(Math.round(100 * weekShare(block.theme)), 'percent').add("% of the week's plays.");
      return { kind: 'themed_block', salience: 40, subject: null, ...b.build(), edges: [] };
    });
}

// ---------- volume ----------

/**
 * Deduped plays this week against the mean of the 4 prior weeks, both rounded as stated, firing at 20% or more
 * either way. Needs a full baseline; an average of zero is a zero denominator and suppresses the fact.
 */
function volume(ctx: FactContext): Draft | null {
  if (ctx.baseline !== 'full') return null;
  const prior = ctx.weeks.slice(1, 1 + VOLUME_WEEKS);
  if (prior.length < VOLUME_WEEKS) return null;
  const usualPlays = Math.round(mean(prior.map((w) => w.length)));
  if (usualPlays === 0) return null;
  const artistCount = (week: Scrobble[]): number => new Set(week.map((s) => norm(s.artist))).size;
  const usualArtists = Math.round(mean(prior.map(artistCount)));
  const plays = ctx.week.length;
  const artists = artistCount(ctx.week);
  const change = Math.round((100 * (plays - usualPlays)) / usualPlays);
  if (Math.abs(change) < VOLUME_MIN_CHANGE) return null;

  const b = new StatementBuilder(ctx.inputs.timezone)
    .number(plays, 'plays').add(plural(plays, ' play this week, ', ' plays this week, '))
    .number(Math.abs(change), 'percent').add(`% ${change > 0 ? 'above' : 'below'} the `).number(VOLUME_WEEKS, 'weeks')
    .add('-week average of ').number(usualPlays, 'plays').add('; ')
    .number(artists, 'artists').add(plural(artists, ' artist against a usual ', ' artists against a usual '))
    .number(usualArtists, 'artists').add('.');
  return { kind: 'volume', salience: 35, subject: null, ...b.build(), edges: [] };
}

/** Breadth, last week's top artists fading, themed blocks and total volume for the week. */
export function weekFacts(ctx: FactContext): Draft[] {
  const wide = breadth(ctx);
  const faded = lastWeekFaded(ctx);
  const total = volume(ctx);
  return [
    ...(wide ? [wide] : []),
    ...(faded ? [faded] : []),
    ...themedBlockFacts(ctx),
    ...(total ? [total] : []),
  ];
}
