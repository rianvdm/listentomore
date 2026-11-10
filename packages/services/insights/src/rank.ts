// ABOUTME: Ranks fact drafts into the week's facts (the single-listen fold, clamping, order, ids) and chooses
// ABOUTME: the closing question in code. Follows spec section 2, "Merging", "Quiet week" and "Question".

import type { Draft, Fact, QuestionKind, WeekFacts } from './types';

/** A week whose top fact scores under this is quiet: no model call, a code sentence instead. */
export const QUIET_THRESHOLD = 50;

/** How many ranked facts can carry the question: rank 1, or rank 2 when rank 1 has none. */
const QUESTION_RANKS = 2;

const clamp = (salience: number): number => Math.min(100, Math.max(0, salience));

const unique = <T>(items: T[], same: (a: T, b: T) => boolean): T[] =>
  items.filter((item, i) => items.findIndex((other) => same(item, other)) === i);

/**
 * True when `host` already covers `artist`, as build.py's `covered` map does: a discovery, repeat-album or volume
 * fact about the artist, a cluster with the artist as a member, or the returns fact that names the artist. A spread
 * fact covers its artists too: in build.py their volume facts absorbed the listen before merging into the spread.
 * Breadth, last week faded, themed blocks and chains only list names, so they never cover an artist.
 */
function covers(host: Draft, artist: string): boolean {
  switch (host.kind) {
    case 'discovery':
    case 'repeat_album':
    case 'volume_vs_normal':
      return host.subject === artist;
    case 'genre_cluster':
    case 'volume_spread':
      return host.entities.includes(artist); // these statements name only artists
    case 'returns':
      // Each returned artist carries a months value; the fact's other entities are album names.
      return host.quantities.some((q) => q.unit === 'months' && q.entity === artist);
    default:
      return false;
  }
}

/**
 * Appends a single listen to a volume fact, as build.py lines 469-480 do: "<volume statement minus its final
 * period>; includes <run and reasons>." The listen's statement is "<artist> on <day>: <run and reasons>."; its run
 * phrase never repeats the artist, so there is no " by <artist>" to remove. The host takes on the listen's entities,
 * quantities and dates. When the host does not already name the listen's day, the day is written in
 * ("; includes, on <day>, <run and reasons>"), so every date the host carries is in its statement.
 */
function foldInto(host: Draft, single: Draft): Draft {
  const prefix = `${single.subject ?? ''} on `;
  const colon = single.statement.indexOf(': ', prefix.length);
  // Without the expected prefix there is no run text to carry over, so the listen is only dropped.
  if (!single.statement.startsWith(prefix) || colon < 0) return host;
  const day = single.statement.slice(prefix.length, colon);
  const body = single.statement.slice(colon + 2);
  const includes = host.statement.includes(day) ? `includes ${body}` : `includes, on ${day}, ${body}`;
  return {
    ...host,
    statement: `${host.statement.replace(/\.$/, '')}; ${includes}`,
    entities: unique([...host.entities, ...single.entities], (a, b) => a === b),
    quantities: unique([...host.quantities, ...single.quantities],
      (a, b) => a.value === b.value && a.unit === b.unit && a.entity === b.entity),
    dates: unique([...host.dates, ...single.dates], (a, b) => a === b),
  };
}

/**
 * Spec section 2, "Merging", as build.py applies it: a single listen whose artist is covered by another fact folds
 * into it, whatever the two saliences. A volume fact absorbs the listen into its statement; any other host already
 * states the artist's runs, so the listen is dropped.
 *
 * build.py then drops volume facts of repeat-album artists, merges four or more volume facts into a spread and drops
 * discoveries inside a cluster. artistFacts (Task 5) has already done those three, in that order, so they are not
 * repeated here. The outcome is the same as build.py's: a listen by a repeat-album artist folds into the repeat
 * fact, and a listen by a spread artist folds into the spread, whose statement (like build.py's) restates only each
 * artist's plays and usual rate, so it has no absorbed run text and no absorbed entities to carry.
 */
function fold(drafts: Draft[]): Draft[] {
  let out = [...drafts];
  for (const single of drafts.filter((d) => d.kind === 'single_listen' && d.subject !== null)) {
    const artist = single.subject as string;
    const hosts = out.filter((d) => d.kind !== 'single_listen' && covers(d, artist));
    if (hosts.length === 0) continue;
    const volume = hosts.find((d) => d.kind === 'volume_vs_normal');
    out = out.filter((d) => d !== single).map((d) => (d === volume ? foldInto(d, single) : d));
  }
  return out;
}

/**
 * The plays a fact ties on (spec section 2: "Ties break by plays, then by name"): its subject's plays this week
 * when the subject is an artist, otherwise the plays this week of every artist it names. Zero without `plays`.
 */
function tiePlays(d: Draft, plays: ReadonlyMap<string, number>): number {
  if (d.subject !== null && plays.has(d.subject)) return plays.get(d.subject) ?? 0;
  return [...new Set(d.entities)].reduce((sum, name) => sum + (plays.get(name) ?? 0), 0);
}

/** Its subject, or its statement for a fact about no one, so every tie has a stable order. */
const tieName = (d: Draft): string => d.subject ?? d.statement;

/**
 * Merges, clamps to 0..100, sorts (salience, then plays, then name) and numbers the drafts from 1.
 * `plays` maps each artist played this week, by exact name, to its deduped plays.
 */
export function rankFacts(drafts: Draft[], plays: ReadonlyMap<string, number> = new Map()): Fact[] {
  return fold(drafts)
    .map((d) => ({ ...d, salience: clamp(d.salience) }))
    .sort((a, b) => b.salience - a.salience || tiePlays(b, plays) - tiePlays(a, plays) || tieName(a).localeCompare(tieName(b)))
    .map((d, i) => ({ id: i + 1, ...d }));
}

/**
 * The closing question (spec section 2, "Question"), from rank 1's edges or, when rank 1 has none, rank 2's.
 * With the same subject as the last question, the same question is kept; otherwise its kind rotates away from
 * the last kind. A fact whose only edges repeat the last kind for a new subject passes to rank 2.
 */
export function chooseQuestion(facts: Fact[], last: { kind: QuestionKind; subject: string } | null): WeekFacts['question'] {
  for (const fact of facts.slice(0, QUESTION_RANKS)) {
    if (fact.edges.length === 0) continue;
    const subject = fact.subject ?? '';
    const option = last !== null && last.subject === subject
      ? fact.edges.find((e) => e.kind === last.kind) ?? fact.edges[0]
      : fact.edges.find((e) => e.kind !== last?.kind);
    if (option) return { ...option, subject };
  }
  return null;
}
