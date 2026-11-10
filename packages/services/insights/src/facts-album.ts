// ABOUTME: Album-level week facts - repeat albums, notable single listens, album chains and album mode.
// ABOUTME: Ports build.py's rules with spec section 2's corrections; every stated value is typed on the draft.

import { plural, quietAfter, score, writeRun } from './facts-shared';
import { MODE_MIN_TRACKS, albumChains, albumModeShare } from './runs';
import type { AlbumRun } from './runs';
import { StatementBuilder } from './statement';
import { cleanTags } from './tags';
import { albumKey } from './types';
import type { Draft, FactContext, QuestionOption, Scrobble } from './types';
import { dayLabel } from './window';

const REPEAT_MIN_LISTENS = 2;
const REPEAT_MAX_LISTENS = 3;
const LONG_RUN_TRACKS = 20;
const WEEK_TOP_TAGS = 10;
const ALBUM_MODE_WEEKS = 5;

const isFull = (r: AlbumRun): boolean => r.verdict === 'start_to_finish';

/** The album's plays this week (deduped), in time order. */
const albumPlays = (week: Scrobble[], artist: string, album: string): Scrobble[] => {
  const key = albumKey(artist, album);
  return week.filter((s) => albumKey(s.artist, s.album) === key);
};

/**
 * Track plays of the album before this week, from a consistent snapshot (spec section 1, "Provenance"):
 * the user's album count minus this week's raw plays of it up to that count's `fetchedAt`.
 * Null when the count is missing, or when the result is negative and so the count is inconsistent.
 */
function albumBefore(ctx: FactContext, artist: string, album: string): number | null {
  const info = ctx.inputs.albums[albumKey(artist, album)];
  if (!info || info.userPlaycount === null) return null;
  const played = albumPlays(ctx.rawWeeks[0] ?? [], artist, album).filter((s) => s.ts <= info.fetchedAt).length;
  const before = info.userPlaycount - played;
  return before < 0 ? null : before;
}

const artistPlays = (ctx: FactContext, artist: string): number =>
  ctx.artists.get(artist)?.plays ?? ctx.week.filter((s) => s.artist === artist).length;

// ---------- repeat album ----------

/** Start-to-finish runs grouped by album, each group in time order, groups in order of their first listen. */
function fullListensByAlbum(runs: AlbumRun[]): AlbumRun[][] {
  const groups = new Map<string, AlbumRun[]>();
  for (const run of runs.filter(isFull).sort((a, b) => a.from - b.from)) {
    const key = albumKey(run.artist, run.album);
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  return [...groups.values()];
}

interface ListenDay { ts: number; listens: number }

/** The days of the listens, in order; `ts` is the first listen's start that day. */
function listenDays(listens: AlbumRun[], tz: string | null): ListenDay[] {
  const days = new Map<string, ListenDay>();
  for (const run of listens) {
    const label = dayLabel(run.from, tz);
    const day = days.get(label);
    if (day) day.listens++;
    else days.set(label, { ts: run.from, listens: 1 });
  }
  return [...days.values()];
}

/** Two or more start-to-finish listens of one album, scored by how new the album is (spec section 2). */
function repeatAlbum(ctx: FactContext, listens: AlbumRun[]): Draft {
  const { artist, album, tracklistLength } = listens[0];
  const tz = ctx.inputs.timezone;
  const before = albumBefore(ctx, artist, album);
  // How many times through the album its earlier track plays add up to; null when unknown.
  const familiarity = before !== null && tracklistLength ? { before, times: before / tracklistLength } : null;
  const novelty = familiarity === null ? 0.1 : familiarity.times < 1 ? 1 : familiarity.times < 3 ? 0.5 : 0.1;

  const b = new StatementBuilder(tz).name(album).add(' by ').name(artist).add(' played start to finish ')
    .number(listens.length, 'times', album).add(' times (')
    .each(listenDays(listens, tz), ', ', (w, d) => {
      if (d.listens > 1) w.number(d.listens, 'times', album).add(' times on ');
      w.day(d.ts);
    })
    .add('), ').number(artistPlays(ctx, artist), 'plays', artist).add(' plays of ').name(artist).add(' this week.');
  if (familiarity && familiarity.times < 1) {
    b.add(' The album had ').number(familiarity.before, 'plays', album)
      .add(plural(familiarity.before, ' track play', ' track plays')).add(' before this week, less than ')
      .word(1, 'times', { entity: album }).add(' full listen.');
  } else if (familiarity) {
    const times = Math.round(familiarity.times);
    b.add(' The album had about ').number(times, 'times', album)
      .add(plural(times, " full listen's", " full listens'")).add(' worth of plays before this week.');
  }

  const last = quietAfter(ctx, albumPlays(ctx.week, artist, album));
  const edges: QuestionOption[] = [];
  if (last !== null) {
    b.add(' Last play of it this week: ').day(last).add('.');
    edges.push({ kind: 'after', text: `What happened with ${album} after ${dayLabel(last, tz)}?` });
  }
  return {
    kind: 'repeat_album',
    salience: score(40 + 10 * Math.min(listens.length, REPEAT_MAX_LISTENS) + 40 * novelty),
    subject: artist,
    ...b.build(),
    edges,
  };
}

// ---------- single listen ----------

/** The week's ten most played tags: each artist's clean top tags, weighted by its plays this week. */
function weekTopTags(ctx: FactContext): Set<string> {
  const counts = new Map<string, number>();
  for (const a of ctx.artists.values()) {
    for (const tag of cleanTags(ctx.inputs.tags[a.artist] ?? [])) counts.set(tag, (counts.get(tag) ?? 0) + a.plays);
  }
  return new Set([...counts.entries()]
    .sort(([t1, n1], [t2, n2]) => n2 - n1 || t1.localeCompare(t2))
    .slice(0, WEEK_TOP_TAGS)
    .map(([tag]) => tag));
}

/**
 * One start-to-finish listen or a run of 20+ tracks, when the album was new, the artist's top tag is outside
 * the week's top ten, or the run is long. Longest runs first; one fact per album; repeated albums are skipped.
 * Mislabelled runs are never quoted: build.py let them through at 20+ tracks. The run is stated as "in one run".
 */
function singleListens(ctx: FactContext, repeated: Set<string>): Draft[] {
  const topTags = weekTopTags(ctx);
  const done = new Set(repeated);
  const drafts: Draft[] = [];
  const longestFirst = [...ctx.runs].sort((a, b) => b.tracksPlayed - a.tracksPlayed || a.from - b.from);
  for (const run of longestFirst) {
    const key = albumKey(run.artist, run.album);
    const long = run.tracksPlayed >= LONG_RUN_TRACKS;
    if (done.has(key) || run.verdict === 'mislabelled' || !(isFull(run) || long)) continue;
    const before = albumBefore(ctx, run.artist, run.album);
    // One listen's worth of plays: the tracklist, unless it is shorter than the run and so a different release.
    const listen = run.tracklistLength !== null && run.tracklistLength >= run.tracksPlayed ? run.tracklistLength : run.tracksPlayed;
    const isNew = before !== null && before < listen;
    const topTag = cleanTags(ctx.inputs.tags[run.artist] ?? [])[0] ?? null;
    const outlier = topTag !== null && !topTags.has(topTag);
    if (!(isNew || outlier || long)) continue;
    done.add(key);

    const b = new StatementBuilder(ctx.inputs.timezone).name(run.artist).add(' on ').day(run.from).add(': ');
    writeRun(b, run);
    if (isFull(run) && long) b.add(' (').number(run.tracksPlayed, 'tracks', run.album).add(' tracks)');
    // Typed, so a note that says the tracks came "in one run" is grounded; rank.ts carries it into a volume host.
    b.add(run.verdict === 'most_of' ? ', in ' : ' in ').word(1, 'times', { entity: run.album }).add(' run');
    if (isNew && before !== null) {
      b.add('; the album had ').number(before, 'plays', run.album).add(plural(before, ' track play', ' track plays'))
        .add(' before this week');
    }
    if (outlier) {
      b.add('; ').name(run.artist).add(` is tagged '${topTag}' on Last.fm, a tag outside the week's most played tags`);
    }
    b.add('.');

    const a = ctx.artists.get(run.artist);
    const edges: QuestionOption[] = a?.tier === 'lapsed' && a.absentMonths === 12
      ? [{ kind: 'started', text: `What brought ${run.artist} back after more than a year?` }]
      : [];
    drafts.push({
      kind: 'single_listen',
      salience: score(45 + (isNew ? 25 : 0) + (outlier ? 10 : 0) + (long ? 10 : 0)),
      subject: run.artist,
      ...b.build(),
      edges,
    });
  }
  return drafts;
}

// ---------- album chain ----------

function chainFact(ctx: FactContext, chain: AlbumRun[]): Draft {
  const b = new StatementBuilder(ctx.inputs.timezone).day(chain[0].from).add(': ')
    .number(chain.length, 'albums').add(' albums back to back, start to finish: ')
    .each(chain, ', ', (w, r) => w.name(r.album).add(' (').name(r.artist).add(')'))
    .add('.');
  return { kind: 'album_chain', salience: 60, subject: null, ...b.build(), edges: [] };
}

// ---------- album mode ----------

/**
 * This week's share of plays inside 8+-track same-album runs, when it is strictly the highest of the last five
 * weeks. Shares are compared as the whole percentages the statement states, so it never claims "highest" over
 * an equal figure. Needs a full baseline, and plays in all five weeks: an empty week has no share to compare.
 */
function albumMode(ctx: FactContext): Draft | null {
  if (ctx.baseline !== 'full') return null;
  const weeks = ctx.weeks.slice(0, ALBUM_MODE_WEEKS);
  if (weeks.length < ALBUM_MODE_WEEKS || weeks.some((w) => w.length === 0)) return null;
  const [share, ...prior] = weeks.map((w) => Math.round(albumModeShare(w) * 100));
  if (share <= Math.max(...prior)) return null;

  const listens = ctx.runs.filter(isFull);
  const albums = new Set(listens.map((r) => albumKey(r.artist, r.album))).size;
  const b = new StatementBuilder(ctx.inputs.timezone);
  if (listens.length > 0) {
    b.number(listens.length, 'times').add(plural(listens.length, ' start-to-finish album listen', ' start-to-finish album listens'))
      .add(' across ').number(albums, 'albums').add(plural(albums, ' album; ', ' albums; '));
  }
  b.number(share, 'percent').add('% of plays came in runs of ').number(MODE_MIN_TRACKS, 'tracks').add(' or more tracks from ')
    .word(1, 'albums').add(' album, the highest share of the last ').number(ALBUM_MODE_WEEKS, 'weeks').add(' weeks (the ')
    .number(prior.length, 'weeks').add(' weeks before, most recent first: ')
    .each(prior, ', ', (w, p) => w.number(p, 'percent').add('%'))
    .add(').');
  return { kind: 'album_mode', salience: 50, subject: null, ...b.build(), edges: [] };
}

/** Repeat albums, notable single listens, album chains and album mode for the week. */
export function albumFacts(ctx: FactContext): Draft[] {
  const repeats = fullListensByAlbum(ctx.runs)
    .filter((listens) => listens.length >= REPEAT_MIN_LISTENS)
    .sort((a, b) => b.length - a.length || a[0].from - b[0].from);
  const repeated = new Set(repeats.map((listens) => albumKey(listens[0].artist, listens[0].album)));
  const mode = albumMode(ctx);
  return [
    ...repeats.map((listens) => repeatAlbum(ctx, listens)),
    ...singleListens(ctx, repeated),
    ...albumChains(ctx.runs).map((chain) => chainFact(ctx, chain)),
    ...(mode ? [mode] : []),
  ];
}
