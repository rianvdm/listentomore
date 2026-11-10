// ABOUTME: Artist-level week facts - discovery, volume against the artist's normal, genre clusters and returns.
// ABOUTME: Ports build.py's rules with spec section 2's corrections; every stated value is typed on the draft.

import { FIRST_UNDER_THIS_NAME, baselineWeeks, plural, quietAfter, score, writeRun } from './facts-shared';
import type { ArtistWeek } from './history';
import type { AlbumRun } from './runs';
import { StatementBuilder } from './statement';
import { BROAD_TAGS, cleanTags } from './tags';
import { norm } from './text';
import { albumKey } from './types';
import type { Draft, FactContext, QuestionOption, Tier } from './types';
import { dayLabel } from './window';

const DISCOVERY_MIN_PLAYS = 8;
const DISCOVERY_FULL_PLAYS = 30;
const VOLUME_MIN_PLAYS = 20;
const VOLUME_MIN_RATIO = 3;
const VOLUME_MAX_RATIO = 16;
const SPREAD_MIN = 4;
const TOP_DAY_SHARE = 0.7;
const CLUSTER_MIN_PLAYS = 3;
const CLUSTER_MIN_MEMBERS = 3;
const MAX_CLUSTERS = 2;
const RETURNS_MIN_PLAYS = 6;
const RETURN_RUN_MIN_TRACKS = 8;

/** A lapsed artist, whose absence and history are known by definition of the tier. */
type Lapsed = ArtistWeek & { tier: 'lapsed'; lifetimeBefore: number; absentMonths: 3 | 6 | 12 };
/** An artist new under this name: first plays, or 1 to 15 before. */
type New = ArtistWeek & { tier: 'first_under_this_name' | 'barely_known'; lifetimeBefore: number };

// Absence is read only through these guards: absentMonths is set for every tier, including unknown.
const isLapsed = (a: ArtistWeek): a is Lapsed =>
  a.tier === 'lapsed' && a.lifetimeBefore !== null && a.absentMonths !== null;
const isNew = (a: ArtistWeek): a is New =>
  (a.tier === 'first_under_this_name' || a.tier === 'barely_known') && a.lifetimeBefore !== null;

const byPlaysThenName = (a: ArtistWeek, b: ArtistWeek): number => b.plays - a.plays || a.artist.localeCompare(b.artist);

interface PlayDay { ts: number; label: string; plays: number }

/** The days an artist was played this week, in time order; `ts` is the day's first play. */
function playDays(ctx: FactContext, artist: string): PlayDay[] {
  const days = new Map<string, PlayDay>();
  for (const s of ctx.week) {
    if (s.artist !== artist) continue;
    const label = dayLabel(s.ts, ctx.inputs.timezone);
    const day = days.get(label);
    if (day) day.plays++;
    else days.set(label, { ts: s.ts, label, plays: 1 });
  }
  return [...days.values()];
}

/** The run to quote for an artist: a start-to-finish run first, then the longest. Mislabelled runs are never quoted. */
function longestRun(runs: AlbumRun[], artist: string): AlbumRun | null {
  const rank = (r: AlbumRun): number => (r.verdict === 'start_to_finish' ? 1 : 0);
  return runs
    .filter((r) => r.artist === artist && r.verdict !== 'mislabelled')
    .sort((a, b) => rank(b) - rank(a) || b.tracksPlayed - a.tracksPlayed || a.from - b.from)[0] ?? null;
}

// ---------- discovery ----------

function discovery(ctx: FactContext, a: New): Draft {
  const first = a.tier === 'first_under_this_name';
  const days = playDays(ctx, a.artist);
  const b = new StatementBuilder(ctx.inputs.timezone).name(a.artist);
  if (first) {
    b.add(`: ${FIRST_UNDER_THIS_NAME}, `).number(a.plays, 'plays', a.artist).add(' this week');
  } else {
    b.add(': only ').number(a.lifetimeBefore, 'plays', a.artist).add(plural(a.lifetimeBefore, ' play', ' plays')).add(' before this week');
    if (a.playsLastWeek > 0) b.add(' (').number(a.playsLastWeek, 'plays', a.artist).add(' of them last week)');
    b.add(', ').number(a.plays, 'plays', a.artist).add(' this week');
  }
  const run = longestRun(ctx.runs, a.artist);
  if (run) {
    b.add(', including ');
    writeRun(b, run);
  }
  b.add('; played on ').number(days.length, 'days', a.artist).add(plural(days.length, ' day (', ' days ('))
    .each(days, ', ', (w, d) => w.day(d.ts)).add(').');

  const edges: QuestionOption[] = [];
  if (first) {
    edges.push(
      { kind: 'where_from', text: `Where did you come across ${a.artist}?` },
      { kind: 'started', text: `What got you started on ${a.artist} this week?` },
    );
    if (days.length === 1) edges.push({ kind: 'one_sitting', text: `Was that ${a.artist} stretch on ${days[0].label} one sitting?` });
  }
  const novelty = first ? 1 : 0.9;
  return {
    kind: 'discovery',
    salience: score(40 + 60 * novelty * Math.min(1, a.plays / DISCOVERY_FULL_PLAYS)),
    subject: a.artist,
    ...b.build(),
    edges,
  };
}

// ---------- volume against the artist's normal ----------

interface Baseline { weeks: number; mean: (artist: string) => number }

/**
 * The artist's mean weekly raw plays over the baseline weeks: the 4 raw scrobble weeks before this one plus
 * the chart weeks. Missing chart weeks shrink the denominator. Null without a full baseline or with no weeks.
 */
function baselineOf(ctx: FactContext): Baseline | null {
  const weeks = baselineWeeks(ctx);
  if (!weeks) return null;
  return {
    weeks: weeks.length,
    mean: (artist) => weeks.reduce((sum, w) => sum + (w[norm(artist)] ?? 0), 0) / weeks.length,
  };
}

/** Artists with two or more start-to-finish listens of one album; they get a repeat-album fact instead. */
function repeatAlbumArtists(runs: AlbumRun[]): Set<string> {
  const listens = new Map<string, number>();
  for (const r of runs) {
    if (r.verdict === 'start_to_finish') listens.set(albumKey(r.artist, r.album), (listens.get(albumKey(r.artist, r.album)) ?? 0) + 1);
  }
  return new Set(runs.filter((r) => (listens.get(albumKey(r.artist, r.album)) ?? 0) >= 2).map((r) => r.artist));
}

interface Volume { artist: ArtistWeek; mean: number; draft: Draft }

// Not new, lapsed or unknown, as in build.py. Its credit variants (uncertain names with no plays before) are
// already tier unknown here (history.ts), so they are excluded too.
const VOLUME_TIERS: ReadonlySet<Tier> = new Set<Tier>(['all_time_favourite', 'regular', 'occasional']);

/** Writes the usual weekly plays: the rounded mean, or "under 1" for a mean below one play a week. */
function writeUsual(b: StatementBuilder, mean: number, artist: string): void {
  if (mean < 1) b.add('under ').number(1, 'plays', artist);
  else b.number(Math.round(mean), 'plays', artist);
}

function volume(ctx: FactContext, a: ArtistWeek, base: Baseline): Volume | null {
  const mean = base.mean(a.artist);
  // A ratio with a zero denominator suppresses the fact (spec section 2): no baseline plays, no "times the usual".
  if (mean <= 0) return null;
  // Raw counts on both sides: chart weeks count every scrobble.
  const ratio = a.rawPlays / mean;
  if (ratio < VOLUME_MIN_RATIO) return null;

  const days = playDays(ctx, a.artist);
  const top = days.reduce((best, d) => (d.plays > best.plays ? d : best), days[0]);
  const b = new StatementBuilder(ctx.inputs.timezone).name(a.artist).add(': ').number(a.plays, 'plays', a.artist)
    .add(' plays this week against an average of ');
  writeUsual(b, mean, a.artist);
  // "per week", not "a week": the guard reads "a" before a unit word as the number 1.
  b.add(' per week over the previous ').number(base.weeks, 'weeks').add(' weeks');
  if (top && top.plays >= TOP_DAY_SHARE * a.plays) {
    if (top.plays === a.plays) b.add('; all of them on ');
    else b.add('; ').number(top.plays, 'plays', a.artist).add(' of them on ');
    b.day(top.ts);
  }
  b.add('.');

  const last = quietAfter(ctx, ctx.week.filter((s) => s.artist === a.artist));
  const edges: QuestionOption[] = last !== null
    ? [{ kind: 'after', text: `What happened with ${a.artist} after ${dayLabel(last, ctx.inputs.timezone)}?` }]
    : [];
  return {
    artist: a,
    mean,
    draft: {
      kind: 'volume_vs_normal',
      salience: score(Math.min(95, 45 + 8 * Math.log2(Math.min(ratio, VOLUME_MAX_RATIO)) + Math.min(20, a.plays / 2.5))),
      subject: a.artist,
      ...b.build(),
      edges,
    },
  };
}

/** Four or more volume facts become one spread fact, scored as the strongest of them. */
function spread(ctx: FactContext, volumes: Volume[], base: Baseline): Draft {
  const b = new StatementBuilder(ctx.inputs.timezone)
    .word(volumes.length, 'artists', { capital: true }).add(' artists played at ').word(3, 'times')
    .add(' or more times their usual weekly rate (average of the previous ').number(base.weeks, 'weeks').add(' weeks): ')
    .each(volumes, ', ', (w, v) => {
      w.name(v.artist.artist).add(' ').number(v.artist.plays, 'plays', v.artist.artist).add(' (usual ');
      writeUsual(w, v.mean, v.artist.artist);
      w.add(')');
    })
    .add('.');
  return { kind: 'volume_spread', salience: volumes[0].draft.salience, subject: null, ...b.build(), edges: [] };
}

function volumeFacts(ctx: FactContext): Draft[] {
  const base = baselineOf(ctx);
  if (!base) return [];
  const repeats = repeatAlbumArtists(ctx.runs);
  const volumes = [...ctx.artists.values()]
    .filter((a) => a.plays >= VOLUME_MIN_PLAYS && VOLUME_TIERS.has(a.tier) && !repeats.has(a.artist))
    .map((a) => volume(ctx, a, base))
    .filter((v): v is Volume => v !== null)
    .sort((x, y) => y.draft.salience - x.draft.salience || byPlaysThenName(x.artist, y.artist));
  return volumes.length >= SPREAD_MIN ? [spread(ctx, volumes, base)] : volumes.map((v) => v.draft);
}

// ---------- genre clusters ----------

interface Cluster { tag: string; members: Array<Lapsed | New> }

/** Up to two clusters of 3+ lapsed or new artists sharing a top-3 tag that is not broad; each artist joins at most one. */
function findClusters(ctx: FactContext): Cluster[] {
  const candidates = [...ctx.artists.values()]
    .filter((a): a is Lapsed | New => a.plays >= CLUSTER_MIN_PLAYS && (isLapsed(a) || isNew(a)))
    .map((a) => ({ artist: a, tags: cleanTags(ctx.inputs.tags[a.artist] ?? []) }))
    .filter((c) => c.tags.length > 0);
  const used = new Set<string>();
  const clusters: Cluster[] = [];
  for (let i = 0; i < MAX_CLUSTERS; i++) {
    const groups = new Map<string, Array<Lapsed | New>>();
    for (const c of candidates) {
      if (used.has(c.artist.artist)) continue;
      for (const tag of c.tags) {
        if (!BROAD_TAGS.has(tag)) groups.set(tag, [...(groups.get(tag) ?? []), c.artist]);
      }
    }
    const total = (members: ArtistWeek[]): number => members.reduce((sum, a) => sum + a.plays, 0);
    // The largest group wins; ties go to more plays, then to the tag name so the choice is stable.
    const best = [...groups.entries()]
      .sort(([t1, m1], [t2, m2]) => m2.length - m1.length || total(m2) - total(m1) || t1.localeCompare(t2))[0];
    if (!best || best[1].length < CLUSTER_MIN_MEMBERS) break;
    const [tag, members] = best;
    clusters.push({ tag, members: [...members].sort(byPlaysThenName) });
    for (const a of members) used.add(a.artist);
  }
  return clusters;
}

function clusterFact(ctx: FactContext, { tag, members }: Cluster): Draft {
  const back = members.filter(isLapsed);
  // "Few or no plays before", not "new": a member may be barely known, with up to 15 plays before this week.
  const lead = back.length === members.length ? 'came back'
    : back.length === 0 ? 'that had few or no plays before this week, all'
      : 'that either came back or had few or no plays before this week, all';
  const b = new StatementBuilder(ctx.inputs.timezone)
    .word(members.length, 'artists', { capital: true }).add(` ${tag} artists ${lead} in `).word(1, 'weeks')
    .add(` week (Last.fm tag '${tag}'): `)
    .each(members, '; ', (w, a) => {
      w.name(a.artist).add(' (').number(a.plays, 'plays', a.artist).add(' plays; ');
      if (isLapsed(a)) {
        w.number(a.lifetimeBefore, 'plays', a.artist).add(' before, none in the ').number(a.absentMonths, 'months', a.artist)
          .add('+ months before this week)');
      } else if (a.tier === 'first_under_this_name') {
        w.add(`${FIRST_UNDER_THIS_NAME})`);
      } else {
        w.add('only ').number(a.lifetimeBefore, 'plays', a.artist).add(' before)');
      }
    })
    .add('.');
  const edges: QuestionOption[] = back.some((a) => a.absentMonths === 12)
    ? [{ kind: 'started', text: `What got you back into ${tag} this week?` }]
    : [];
  return { kind: 'genre_cluster', salience: score(Math.min(95, 55 + 8 * members.length)), subject: tag, ...b.build(), edges };
}

// ---------- returns ----------

/** Lapsed artists with 6+ plays outside every cluster, as one fact. */
function returnsFact(ctx: FactContext, clustered: Set<string>): Draft | null {
  const rest = [...ctx.artists.values()]
    .filter((a): a is Lapsed => isLapsed(a) && a.plays >= RETURNS_MIN_PLAYS && !clustered.has(a.artist))
    .sort(byPlaysThenName);
  if (rest.length === 0) return null;
  const b = new StatementBuilder(ctx.inputs.timezone).add('Came back to artists absent for months: ')
    .each(rest, '; ', (w, a) => {
      w.name(a.artist).add(' (');
      const run = longestRun(ctx.runs, a.artist);
      if (run && run.tracksPlayed >= RETURN_RUN_MIN_TRACKS) writeRun(w, run);
      else w.number(a.plays, 'plays', a.artist).add(' plays');
      w.add('; ').number(a.lifetimeBefore, 'plays', a.artist).add(' plays before, none in the ')
        .number(a.absentMonths, 'months', a.artist).add('+ months before this week)');
    })
    .add('.');
  const total = rest.reduce((sum, a) => sum + a.plays, 0);
  const lead = rest[0];
  const edges: QuestionOption[] = lead.absentMonths === 12
    ? [{ kind: 'started', text: `What brought ${lead.artist} back after more than a year?` }]
    : [];
  return {
    kind: 'returns',
    salience: score(45 + Math.min(25, total / 2) + (rest.some((a) => a.absentMonths === 12) ? 5 : 0)),
    subject: lead.artist,
    ...b.build(),
    edges,
  };
}

/**
 * Discovery, volume against normal (or one spread fact), genre clusters and returns for the week.
 * Already merged here: repeat-album artists get no volume fact, and a discovery inside a cluster is dropped.
 */
export function artistFacts(ctx: FactContext): Draft[] {
  const clusters = findClusters(ctx);
  const clustered = new Set(clusters.flatMap((c) => c.members.map((a) => a.artist)));
  const discoveries = [...ctx.artists.values()]
    .filter((a): a is New => isNew(a) && a.plays >= DISCOVERY_MIN_PLAYS && !clustered.has(a.artist))
    .map((a) => discovery(ctx, a));
  const returns = returnsFact(ctx, clustered);
  return [
    ...discoveries,
    ...volumeFacts(ctx),
    ...clusters.map((c) => clusterFact(ctx, c)),
    ...(returns ? [returns] : []),
  ];
}
