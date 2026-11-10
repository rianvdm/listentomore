// ABOUTME: Renders a WeekFacts object as the model's prompt view, the note signature for the reuse rule, and the
// ABOUTME: code-written line for visitors, quiet weeks and the guard's fallback (spec sections 2, 4 and 5).

import { FIRST_UNDER_THIS_NAME, plural } from './facts-shared';
import type { Fact, Quantity, Tier, Unit, WeekFacts } from './types';
import { dayLabel } from './window';

/** How many ranked facts the model sees (spec section 2, "Fact kinds and salience"). */
export const PROMPT_FACTS = 6;
/** Under this share of the 4-week average, a quiet week is called quiet rather than "nothing stood out". */
const QUIET_SHARE = 0.8;
const SIGNATURE_HEX = 16;

const TIER_LABELS: Record<Tier, string> = {
  first_under_this_name: FIRST_UNDER_THIS_NAME,
  barely_known: 'barely known before this week',
  lapsed: 'lapsed',
  all_time_favourite: 'all-time favourite',
  regular: 'regular',
  occasional: 'occasional',
  unknown: 'history unknown',
};

/** The top-artists line of the prompt view; also part of the note signature. */
function topArtistsLine(wf: WeekFacts): string {
  if (wf.topArtists.length === 0) return 'Top artists this week: none.';
  return `Top artists this week, with how well the listener knows them: ${wf.topArtists
    .map((a) => `${a.artist} ${a.plays} ${plural(a.plays, 'play', 'plays')} (${TIER_LABELS[a.tier]})`)
    .join(', ')}.`;
}

/**
 * The model's input: fact 0 (the window line), the top six facts numbered by id, the top artists with tier labels,
 * and the caveats. Never the question: the model does not see or write it (spec section 2, "Question").
 */
export function renderPromptView(wf: WeekFacts): string {
  const top = wf.facts.slice(0, PROMPT_FACTS);
  return [
    `0. ${wf.windowFact.statement}`,
    '',
    ...(top.length > 0 ? ['Ranked facts, most notable first:', ...top.map((f) => `${f.id}. ${f.statement}`)] : ['No ranked facts this week.']),
    '',
    topArtistsLine(wf),
    '',
    `Caveats: ${wf.caveats.join('; ')}.`,
  ].join('\n');
}

/**
 * The note's cache signature (spec section 5, "One reuse rule"): the first 16 hex characters of SHA-256 over the
 * rule version, the prompt version, fact 0's quantities, the top six facts' ids and statements, the top-artists line
 * and the caveats. A note may cite fact 0 for the week's plays and the usual week, so those values are hashed; its
 * day labels, the window timestamps and pulledAt are left out, so a moving window with the same facts reuses the note.
 */
export async function noteSignature(wf: WeekFacts, promptVersion: string): Promise<string> {
  const payload = JSON.stringify([
    wf.ruleVersion,
    promptVersion,
    // Fact 0's values and units (the week's plays and the usual week), not its day labels, which move daily.
    wf.windowFact.quantities.map((q) => [q.value, q.unit]),
    wf.facts.slice(0, PROMPT_FACTS).map((f) => [f.id, f.statement]),
    topArtistsLine(wf),
    wf.caveats,
  ]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, SIGNATURE_HEX);
}

// ---------- code-rendered lines ----------

type Person = 'second' | 'third';

interface Voice {
  subject: string;     // 'You' | username
  their: string;       // 'your' | 'their'
  owner: string;       // 'your' | "<username>'s"
}

const voiceOf = (wf: WeekFacts, person: Person): Voice => (person === 'second'
  ? { subject: 'You', their: 'your', owner: 'your' }
  : { subject: wf.username, their: 'their', owner: `${wf.username}'s` });

/** The values of one unit, in the order the statement states them; `entity` narrows to one name. */
const values = (f: Fact, unit: Unit, entity?: string): number[] =>
  f.quantities.filter((q: Quantity) => q.unit === unit && (entity === undefined || q.entity === entity)).map((q) => q.value);

/** Distinct entities of the quantities in one unit: the artists a returns fact names carry a months value each. */
const entitiesWith = (f: Fact, unit: Unit): string[] =>
  [...new Set(f.quantities.filter((q) => q.unit === unit && q.entity !== undefined).map((q) => q.entity as string))];

/** The other name a subject's fact carries (its album); a self-titled album is the subject itself. */
const albumOf = (f: Fact): string | undefined => f.entities.find((e) => e !== f.subject) ?? f.subject ?? undefined;

const others = (n: number): string => `${n} other ${plural(n, 'artist', 'artists')}`;

/**
 * One template per fact kind, built from the fact's kind, subject, entities, quantities and dates; the statement is
 * never read or edited. Returns null when a value the template needs is missing, so the caller falls back.
 */
function factLine(wf: WeekFacts, f: Fact, v: Voice): string | null {
  const day = f.dates.length > 0 ? dayLabel(f.dates[0], wf.timezone) : undefined;
  switch (f.kind) {
    case 'discovery': {
      if (!f.subject) return null;
      // The count and the tier come from the top artists: a discovery's plays values mix earlier and this week's
      // plays, and equal values merge, so position cannot say which is which. Outside the top artists the line
      // makes no claim about the artist's history.
      const top = wf.topArtists.find((a) => a.artist === f.subject);
      if (!top) return `${v.subject} played ${f.subject} this week.`;
      const played = `${v.subject} played ${f.subject} ${top.plays} ${plural(top.plays, 'time', 'times')} this week`;
      if (top.tier === 'first_under_this_name') return `${played}, the ${FIRST_UNDER_THIS_NAME}.`;
      // A barely known discovery states its earlier plays first, so the first plays value is the earlier count.
      const before = values(f, 'plays', f.subject)[0];
      return top.tier === 'barely_known' && before !== undefined
        ? `${played}, after only ${before} ${plural(before, 'play', 'plays')} before this week.`
        : `${played}.`;
    }
    case 'repeat_album': {
      const album = f.entities[0];
      const n = album !== undefined ? values(f, 'times', album)[0] : undefined;
      return f.subject && album !== undefined && n !== undefined
        ? `${v.subject} played ${album} by ${f.subject} start to finish ${n} times this week.` : null;
    }
    case 'volume_vs_normal': {
      const n = values(f, 'plays', f.subject ?? undefined)[0];
      return f.subject && n !== undefined
        ? `${v.subject} played ${f.subject} ${n} ${plural(n, 'time', 'times')} this week, at 3 or more times ${v.their} usual rate.` : null;
    }
    case 'volume_spread': {
      const n = values(f, 'artists')[0];
      return n !== undefined && f.entities[0] !== undefined
        // "including", not "led by": the spread lists its artists by salience, not by plays.
        ? `${v.subject} played ${n} artists at 3 or more times ${v.their} usual rate this week, including ${f.entities[0]}.` : null;
    }
    case 'genre_cluster': {
      const n = values(f, 'artists')[0];
      return f.subject && n !== undefined && f.entities[0] !== undefined
        ? `${v.subject} played ${n} ${f.subject} artists this week that had been away for months or had few or no plays before this week, led by ${f.entities[0]}.`
        : null;
    }
    case 'returns': {
      const back = entitiesWith(f, 'months');
      if (!f.subject || back.length === 0) return null;
      const rest = back.length - 1;
      return `${v.subject} came back to ${f.subject}${rest > 0 ? ` and ${others(rest)}` : ''} this week after months away.`;
    }
    case 'breadth': {
      const [now, usual] = values(f, 'artists');
      // The threshold is the one plays value tied to no artist; a narrow week also ties each named artist's plays.
      const threshold = f.quantities.find((q) => q.unit === 'plays' && q.entity === undefined)?.value;
      if (now === undefined || usual === undefined || threshold === undefined) return null;
      // Both kinds now name artists; a narrow week is the one below its usual count.
      const only = now < usual ? 'only ' : '';
      return `${v.subject} played ${only}${now} ${plural(now, 'artist', 'artists')} ${threshold} or more times this week, against a usual ${usual}.`;
    }
    case 'single_listen': {
      const album = albumOf(f);
      if (!f.subject || album === undefined || day === undefined) return null;
      // A start-to-finish listen states no track count unless it is long; any other run states the tracks played first.
      const tracks = values(f, 'tracks', album)[0];
      return tracks === undefined
        ? `${v.subject} played ${album} by ${f.subject} start to finish on ${day}.`
        : `${v.subject} played ${tracks} tracks from ${album} by ${f.subject} on ${day}.`;
    }
    case 'album_chain': {
      const n = values(f, 'albums')[0];
      return n !== undefined && day !== undefined && f.entities[0] !== undefined
        ? `${v.subject} played ${n} albums back to back, start to finish, on ${day}, starting with ${f.entities[0]}.` : null;
    }
    case 'album_mode': {
      const share = values(f, 'percent')[0];
      const tracks = values(f, 'tracks')[0];
      const weeks = values(f, 'weeks')[0];
      return share !== undefined && tracks !== undefined && weeks !== undefined
        ? `${share}% of ${v.owner} plays this week came in runs of ${tracks} or more tracks from one album, the highest share of the last ${weeks} weeks.`
        : null;
    }
    case 'last_week_faded': {
      const [first] = f.entities;
      if (first === undefined) return null;
      const rest = f.entities.length - 1;
      return rest > 0
        ? `${first} and ${others(rest)} from ${v.owner} top artists last week had few or no plays this week.`
        : `${first}, one of ${v.owner} top artists last week, had few or no plays this week.`;
    }
    case 'themed_block': {
      const n = values(f, 'plays')[0];
      const artists = values(f, 'artists')[0];
      return n !== undefined && artists !== undefined && day !== undefined && f.entities[0] !== undefined
        ? `${v.subject} played ${n} tracks from ${artists} artists in one stretch on ${day}, led by ${f.entities[0]}.` : null;
    }
    case 'volume': {
      const [plays, usual] = values(f, 'plays');
      return plays !== undefined && usual !== undefined ? `${v.subject} had ${plays} plays this week, against a usual ${usual}.` : null;
    }
  }
}

/** The quiet-week sentence by volume (spec section 2, "Quiet week"). */
function quietLine(wf: WeekFacts, person: Person): string {
  const n = wf.plays.deduped;
  const top = wf.topArtists[0]?.artist;
  const forUser = person === 'third' ? ` for ${wf.username}` : '';
  if (n === 0 || top === undefined) return `No plays recorded${forUser} this week.`;
  const plays = `${n} ${plural(n, 'play', 'plays')}`;
  if (wf.priorAverage !== null && n < QUIET_SHARE * wf.priorAverage) return `A quiet week${forUser}: ${plays}. ${top} came up most.`;
  return `Nothing stood out${forUser} this week: ${plays}, led by ${top}.`;
}

/**
 * The code-rendered sentence: for the rank-1 fact in second person (the owner's fallback) or third person (the
 * visitor's line, spec section 4), or the quiet sentence when the week is quiet. No question, no adjectives for music.
 */
export function renderLine(wf: WeekFacts, person: Person): string {
  const lead = wf.facts[0];
  if (wf.quiet || lead === undefined) return quietLine(wf, person);
  return factLine(wf, lead, voiceOf(wf, person)) ?? quietLine(wf, person);
}
