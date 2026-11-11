// ABOUTME: The note guard (spec section 3): checks each model sentence against the facts it cites for names,
// ABOUTME: quantities, days and months, banned claims and the note's shape. Failures are short codes for logs.

import { FIRST_UNDER_THIS_NAME } from './facts-shared';
import { PROMPT_FACTS } from './render';
import { norm } from './text';
import { albumKey } from './types';
import type { Fact, Quantity, Unit, WeekFacts } from './types';
import { dayLabel } from './window';

/** One sentence of the model's note and the ids of the facts it draws on. */
export interface NoteSentence { text: string; facts: number[] }
export interface GuardResult { ok: boolean; failures: string[] }

const MIN_SENTENCES = 2;
const MAX_SENTENCES = 6;
const LEAD_FACT_ID = 1;
const MONTHS_PER_YEAR = 12;
/**
 * The counts of the cited facts' albums or artists a sentence may state ("three new albums", "two detours"): up to six
 * (owner ruling), and from two, so a bare 1 never passes as the count of a one-name fact.
 */
const MIN_NAMED_COUNT = 2;
const MAX_NAMED_COUNT = 6;

/** Number words the guard reads, with the unit they imply when they carry one ("twice" is 2 times). */
const NUMBER_WORDS: Record<string, { value: number; unit?: Unit }> = {
  zero: { value: 0 }, one: { value: 1 }, two: { value: 2 }, three: { value: 3 }, four: { value: 4 }, five: { value: 5 },
  six: { value: 6 }, seven: { value: 7 }, eight: { value: 8 }, nine: { value: 9 }, ten: { value: 10 },
  eleven: { value: 11 }, twelve: { value: 12 }, once: { value: 1, unit: 'times' }, twice: { value: 2, unit: 'times' },
};
const NUMBER_WORD = new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join('|')})\\b`, 'g');
/**
 * Number words above twelve, singular or plural ("twenty", "hundreds", "dozens"). Statements write those in digits,
 * so the guard cannot read them: they fail.
 */
const UNREAD_NUMBER_WORD = new RegExp('\\b(thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|tens'
  + '|(?:twent|thirt|fort|fift|sixt|sevent|eight|ninet)(?:y|ies)|(?:hundred|thousand|million|dozen)s?)\\b', 'g');
/** Fractions other than "half a year" ("a year and a half", "3 and a half", "a quarter"): unreadable, so they fail. */
const FRACTION = /\b(half|halves|quarters?|thirds?)\b/g;
/** Digits, with thousands separators or a decimal part. */
const DIGITS = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

/**
 * The words that give a number its unit. "track play(s)" is how statements write plays of an album's tracks ("the
 * album had 0 track plays") and is typed as plays, so it reads as plays, not tracks; "song play(s)" is the same count
 * in other words. A year is 12 months. Songs are tracks and spins are plays.
 */
const UNIT_WORDS: Record<string, Unit> = {
  'track play': 'plays', 'track plays': 'plays', 'song play': 'plays', 'song plays': 'plays', play: 'plays',
  plays: 'plays', spin: 'plays', spins: 'plays',
  track: 'tracks', tracks: 'tracks', song: 'tracks', songs: 'tracks', time: 'times', times: 'times', day: 'days',
  days: 'days', week: 'weeks', weeks: 'weeks', month: 'months', months: 'months', percent: 'percent',
  artist: 'artists', artists: 'artists', album: 'albums', albums: 'albums',
};
const YEAR_WORDS = ['year', 'years'];
const UNIT_PHRASE = [...Object.keys(UNIT_WORDS), ...YEAR_WORDS].sort((a, b) => b.length - a.length).join('|');
const HALF_A_YEAR = /\bhalf an? year\b/g;
// "a" or "an" directly before a unit word is 1 of that unit; "a year" is 12 months. Anywhere else it is no number.
// Artists, albums, songs and spins are left out: "an artist you know well" and "gave it a spin" describe, they do
// not count. Nor does "a <unit> of ..." ("a week of returns", "a day of Boards of Canada"), with up to two words
// between ("a week already full of returns", "a day made up of"): it names a stretch of time by what filled it.
const ARTICLE_PHRASE = UNIT_PHRASE.split('|').filter((w) => !/^(?:artists?|albums?|songs?|spins?)$/.test(w)).join('|');
const ARTICLE_UNIT = new RegExp(
  `\\b(?:a|an) (${ARTICLE_PHRASE})\\b(?! (?:(?:already|so|completely|mostly|full|made|up) ){0,2}of\\b)`,
  'g',
);
/**
 * After "after", "for", "in" or "within", "a <unit>" is a duration whatever follows: "after a week full of silence"
 * is 1 week. Read before ARTICLE_UNIT so its "of" exemption covers only a description of the stretch itself.
 */
const DURATION_ARTICLE = new RegExp(`(?<=\\b(?:after|for|in|within) )(?:a|an) (${ARTICLE_PHRASE})\\b`, 'g');
/** "at once" means together, not 1 time. */
const AT_ONCE = /\bat once\b/g;
/**
 * "in one day", "in a single day", "in one sitting" and "in one go" restate a day the sentence names ("Friday
 * belonged to Boards of Canada, all 41 plays in one day"). Beside a cited weekday or date they are no number;
 * without one they are 1, of days when they say "day".
 */
const IN_ONE_SITTING = /\bin (?:one|a single) (day|sitting|go)\b/g;
/**
 * Words that end a number's phrase rather than describe its unit: '39 this week', '6 per week', '5 of them' and '8
 * after months away' have no unit, where '6 long months' and '8 brand-new tracks' do. Determiners, prepositions,
 * conjunctions and pronouns, plus the number words, so '6 over two days' is not 6 days.
 */
const NOT_A_MODIFIER = [
  'this', 'that', 'these', 'those', 'last', 'next', 'per', 'a', 'an', 'the', 'each', 'every', 'of', 'or', 'and', 'in',
  'on', 'at', 'to', 'from', 'by', 'for', 'after', 'before', 'over', 'under', 'across', 'since', 'within', 'during',
  'into', 'with', 'without', 'than', 'as', 'like', 'until', 'about', 'around', 'through', 'between', 'against', 'but',
  'so', 'then', 'while', 'when', 'which', 'who', 'it', 'its', 'his', 'her', 'their', 'them', 'he', 'she', 'they', 'you',
  'your', 'my', 'our', ...Object.keys(NUMBER_WORDS),
].join('|');
/** A describing word between a number and its unit, hyphenated or not ('long', 'back-to-back'); never a unit word. */
const MODIFIER = `(?!(?:${NOT_A_MODIFIER}|${UNIT_PHRASE})\\b)[a-z]+(?:-[a-z]+)*`;
/** How many describing words may stand between a number and its unit ('6 very long months'). */
const MAX_MODIFIERS = 2;
/**
 * The unit after a number, after a space or hyphen and up to two describing words: '41 plays', '6-month', '40%',
 * '6 back-to-back weeks'. A unit word straight after the hyphen is the unit itself, so 'a 437-play week' is 437 plays,
 * not 437 weeks.
 */
const UNIT_AFTER = new RegExp(
  `^\\+?(?:(%)|-(${UNIT_PHRASE})\\b|[\\s-](?:${MODIFIER} ){0,${MAX_MODIFIERS}}(${UNIT_PHRASE})\\b)`,
);
/**
 * Words that point back or pick one out, not count (owner ruling): "around those two", "these two", "the two of
 * them", "both", "one of your widest weeks", "either of them". Before a unit, "those two" and "these two" still count
 * ("those two days"), and a number after any of them is read as usual ("both got 9 plays").
 */
const NOT_A_COUNT = new RegExp(
  '\\b(?:the two of them|both|one of|either of'
  + `|(?:those|these) two(?![\\s-](?:${MODIFIER} ){0,${MAX_MODIFIERS}}(?:${UNIT_PHRASE})\\b))\\b`,
  'g',
);
/**
 * "a day", "a week", "a month" or "a year" right after a number, or after a number and its plays, tracks or times, is
 * a rate ("under 1 a week", "6 plays a week", "twice a week"), not 1 of that unit. Only the article is matched.
 */
const RATE_ARTICLE = new RegExp(
  `(?<=(?:\\d|\\b(?:${Object.keys(NUMBER_WORDS).join('|')}))(?: (?:plays?|tracks?|times?|songs?|spins?))? )(?:a|an) (?:days?|weeks?|months?|years?)\\b`,
  'g',
);

// Full and abbreviated names, longest first; the first three letters, lower-cased, are the key dayLabel uses.
const WEEKDAYS = 'Monday|Mon|Tuesday|Tues|Tue|Wednesday|Wed|Thursday|Thurs|Thur|Thu|Friday|Fri|Saturday|Sat|Sunday|Sun';
const MONTHS = 'January|Jan|February|Feb|March|Mar|April|Apr|May|June|Jun|July|Jul|August|Aug|September|Sept|Sep'
  + '|October|Oct|November|Nov|December|Dec';
const keyOf = (word: string): string => word.slice(0, 3).toLowerCase();

const WORD_CHAR = /[\p{L}\p{N}]/u;
/** norm() without the lower-casing: same length and indices as norm() for nearly all text. */
const keepCase = (s: string): string => s.normalize('NFKC').replace(/‐/g, '-').replace(/\s+/g, ' ').trim();
const MASK = '#';
const ALLOWED_FIRST_PLAYS = [FIRST_UNDER_THIS_NAME, 'first plays on record'];
/** The plural forms, allowed when the cited facts mark two or more artists as first under this name. */
const PLURAL_FIRST_PLAYS = ['first plays under these names', 'first plays under those names'];

/** What the guard reads once per note: the facts the model saw, and every name in the week, longest first. */
interface GuardContext {
  view: Map<number, Fact>;
  names: string[];                    // normalised
  oneWordSpellings: Map<string, Set<string>>; // normalised one-word name -> its spellings as given ('is' -> 'Is')
  owners: Map<string, number>;        // normalised name -> id of the first fact that names it
  timezone: string | null;
  /**
   * The prompt view's top-artists line, which has no fact id and so counts as cited by every sentence (owner ruling):
   * its artists, normalised, and each one's plays this week keyed by the normalised name. Tier labels give no quantity.
   */
  topArtists: { names: string[]; plays: Map<string, Quantity> };
}

function guardContext(wf: WeekFacts): GuardContext {
  const all = [wf.windowFact, ...wf.facts];
  const owners = new Map<string, number>();
  for (const f of all) for (const e of f.entities) if (!owners.has(norm(e))) owners.set(norm(e), f.id);
  const spellings = [...wf.names, ...all.flatMap((f) => f.entities)].map(keepCase);
  const names = [...new Set(spellings.map(norm))]
    .filter((n) => n.length > 0)
    .sort((a, b) => b.length - a.length || a.localeCompare(b));
  const oneWordSpellings = new Map<string, Set<string>>();
  for (const spelling of spellings) {
    const name = norm(spelling);
    if (name.length === 0 || name.includes(' ')) continue;
    oneWordSpellings.set(name, (oneWordSpellings.get(name) ?? new Set()).add(spelling));
  }
  const view = new Map([wf.windowFact, ...wf.facts.slice(0, PROMPT_FACTS)].map((f) => [f.id, f]));
  const topArtists = {
    names: wf.topArtists.map((a) => norm(a.artist)),
    plays: new Map(wf.topArtists.map((a): [string, Quantity] => [norm(a.artist), { value: a.plays, unit: 'plays', entity: a.artist }])),
  };
  return { view, names, oneWordSpellings, owners, timezone: wf.timezone, topArtists };
}

/**
 * Checks a whole note: rule 4's shape (two to six sentences, some sentence citing fact 1), then rules 1 to 3 and the
 * punctuation ban on each sentence. Sentence failure codes are prefixed with the sentence number
 * ('s2:quantity:41:plays'); note-wide shape codes are not ('shape:lead').
 */
export function guardNote(sentences: NoteSentence[], wf: WeekFacts): GuardResult {
  const ctx = guardContext(wf);
  const failures: string[] = [];
  if (sentences.length < MIN_SENTENCES || sentences.length > MAX_SENTENCES) failures.push(`shape:count:${sentences.length}`);
  const citesLead = ctx.view.has(LEAD_FACT_ID) && sentences.some((s) => s.facts.includes(LEAD_FACT_ID));
  if (sentences.length > 0 && !citesLead) failures.push('shape:lead');
  sentences.forEach((s, i) => {
    const checked = checkSentence(s, ctx);
    // One entry, one sentence: a terminator followed by more text packs two in (names, which may hold "Vol." or
    // "feat.", are masked by then). Fact statements may run to two sentences, so this is a note rule only.
    // A run of two or more dots is an ellipsis, not a sentence end.
    if (/(?:(?<!\.)\.(?!\.)|[!?])['"’”)\]]*\s+\S/.test(checked.masked)) checked.failures.push('shape:multiple-sentences');
    failures.push(...checked.failures.map((f) => `s${i + 1}:${f}`));
  });
  return { ok: failures.length === 0, failures };
}

/** Checks one sentence against the union of the facts it cites (rules 1 to 3); returns unprefixed failure codes. */
export function guardSentence(sentence: NoteSentence, wf: WeekFacts): string[] {
  return checkSentence(sentence, guardContext(wf)).failures;
}

/** Rules 1 to 3 for one sentence, plus its text with names, dates and numbers masked for the note-level checks. */
function checkSentence(sentence: NoteSentence, ctx: GuardContext): { failures: string[]; masked: string } {
  const failures = new Set<string>();
  if (sentence.text.trim() === '') failures.add('shape:empty');
  if (sentence.facts.length === 0) failures.add('shape:uncited');
  const cited: Fact[] = [];
  for (const id of new Set(sentence.facts)) {
    const fact = ctx.view.get(id);
    if (fact) cited.push(fact);
    else failures.add(`shape:unknown-fact:${id}`);
  }

  // `folded` is the norm()ed text the names match on; `cased` keeps capitals for names and day and month names. They
  // share indices, so a mask applies to both, unless lower-casing changed the length (rare letters such as 'İ').
  let folded = norm(sentence.text);
  const kept = keepCase(sentence.text);
  const caseKnown = kept.length === folded.length && kept.toLowerCase() === folded;
  let cased = caseKnown ? kept : folded;
  const mask = (start: number, end: number): void => {
    const fill = MASK.repeat(end - start);
    folded = folded.slice(0, start) + fill + folded.slice(end);
    cased = cased.slice(0, start) + fill + cased.slice(end);
  };

  // Rule 1: every name from the week must be in the cited facts' entities or the top-artists line. Names of two or
  // more words match in any case. A one-word name counts only when spelt as given, so the week's "Is" and "Day" are
  // not named by "the week is" or "on 1 day"; when the sentence's case was lost in normalisation, every match counts.
  const isProse = (name: string, start: number, end: number): boolean => {
    const given = ctx.oneWordSpellings.get(name);
    return caseKnown && given !== undefined && !given.has(cased.slice(start, end));
  };
  const entities = new Set([...cited.flatMap((f) => f.entities.map(norm)), ...ctx.topArtists.names]);
  const named: string[] = [];
  /** Where each name stands in the sentence, for reading a top artist's plays after its name. */
  const mentions: Array<{ name: string; end: number }> = [];
  for (const name of ctx.names) {
    for (let at = folded.indexOf(name); at !== -1; at = folded.indexOf(name, at + 1)) {
      if (!isWholeWord(folded, at, at + name.length) || isProse(name, at, at + name.length)) continue;
      mask(at, at + name.length);
      mentions.push({ name, end: at + name.length });
      if (!named.includes(name)) named.push(name);
    }
  }
  for (const name of named) if (!entities.has(name)) failures.add(`name:${nameOwner(ctx, name)}`);

  // Day and month names must be days the cited facts carry, as dayLabel renders them ('Fri May 29').
  const days = checkDays(cited, ctx.timezone, cased, caseKnown, mask);
  for (const failure of days.failures) failures.add(failure);

  // Rule 2: every number must equal a cited quantity, a top artist's plays or a count of the cited facts' albums or
  // artists. When the sentence names exactly one entity from its cited facts or the top artists, every number must
  // equal a quantity tied to that entity or to none, whatever the punctuation, clause or word order. Collective claims
  // about its peers ("the other three for 3+ months") are not read, so they fail.
  const quantities = cited.flatMap((f) => f.quantities);
  const namedCited = named.filter((n) => entities.has(n));
  const tie = namedCited.length === 1 ? namedCited[0] : null;
  const counts = namedCounts(cited);
  // A count of the cited albums or artists is never attributed to a single entity (review rulings). It is unavailable
  // when the sentence names exactly one entity in all, from the cited facts or the top-artists line, or exactly one of
  // the names that make the count up: "Seasurfer got two albums" and "Depeche Mode got two albums" cannot borrow the
  // count of Seasurfer's and Def Leppard's albums, and "Seasurfer was on 2" is a claim about Seasurfer, while "two
  // detours" beside four names is a count. A number the sentence gives a unit for must match in unit too; without
  // one, the value alone must match.
  const countsUnavailable = tie !== null || named.filter((n) => counts.names.has(n)).length === 1;
  // A top artist's plays count only for a number after that artist's name with no other name in between (review
  // ruling), so "Sisters of Mercy had 6 and Depeche Mode had 17" cannot swap them and "You had 38 plays" names nobody.
  for (const { value, unit, at } of readQuantities(folded, failures, days.namesCitedDay)) {
    const code = `${value}${unit ? `:${unit}` : ''}`;
    const before = mentions.filter((m) => m.end <= at).sort((a, b) => b.end - a.end)[0];
    const top = before === undefined ? undefined : ctx.topArtists.plays.get(before.name);
    const pool = [
      ...quantities,
      ...(top ? [top] : []),
      ...(countsUnavailable ? [] : counts.quantities),
    ];
    const same = pool.filter((q) => q.value === value);
    const fits = unit === undefined ? same : same.filter((q) => q.unit === unit);
    if (same.length === 0) failures.add(`quantity:${code}`);
    else if (fits.length === 0) failures.add(`quantity-unit:${code}`);
    else if (tie !== null && !fits.some((q) => q.entity === undefined || norm(q.entity) === tie)) {
      failures.add(`quantity-entity:${code}`);
    }
  }

  // Rule 3: banned claims. "First plays" is allowed only in its exact forms, citing an under-this-name fact; the
  // plural forms need two or more artists marked first under this name across the cited facts.
  if (/\bfirst[- ]time\b/.test(folded)) failures.add('banned:first-time');
  if (/\bfirst[- ]ever\b/.test(folded)) failures.add('banned:first-ever');
  if (/\bnever\b/.test(folded)) failures.add('banned:never');
  const firstMarks = cited.filter(isFirstUnderThisName)
    .reduce((n, f) => n + f.statement.split(FIRST_UNDER_THIS_NAME).length - 1, 0);
  const allowedFirstPlays = [...ALLOWED_FIRST_PLAYS, ...(firstMarks >= 2 ? PLURAL_FIRST_PLAYS : [])];
  for (const m of folded.matchAll(/\bfirst plays?\b/g)) {
    const rest = folded.slice(m.index);
    if (firstMarks === 0 || !allowedFirstPlays.some((phrase) => rest.startsWith(phrase))) failures.add('banned:first-plays');
  }

  // No em or en dashes, and no questions: the question is code's, appended after the note.
  if (folded.includes('—')) failures.add('punctuation:em-dash');
  if (folded.includes('–')) failures.add('punctuation:en-dash');
  if (folded.includes('?')) failures.add('punctuation:question-mark');
  return { failures: [...failures], masked: folded };
}

/**
 * How many distinct albums, and how many distinct artists, the cited facts name, as untied quantities a sentence may
 * state (owner ruling): each from MIN_NAMED_COUNT to MAX_NAMED_COUNT. A fact's artists are its entities other than its
 * album titles, plus the artist of each album, so a self-titled album counts once as each. Albums count by artist and
 * title; `names` holds every album title and artist counted, normalised, as a sentence would name them.
 */
function namedCounts(cited: Fact[]): { quantities: Quantity[]; names: Set<string> } {
  const albums = new Set<string>();   // albumKey(artist, album): two artists' "Greatest Hits" are two albums
  const artists = new Set<string>();
  const names = new Set<string>();    // album titles and artists, as a sentence names them
  for (const f of cited) {
    const titles = new Set(f.albums.map((a) => norm(a.album)));
    for (const title of titles) names.add(title);
    for (const a of f.albums) {
      albums.add(albumKey(a.artist, a.album));
      artists.add(norm(a.artist));
    }
    for (const e of f.entities) if (!titles.has(norm(e))) artists.add(norm(e));
  }
  for (const artist of artists) names.add(artist);
  const inRange = (n: number): boolean => n >= MIN_NAMED_COUNT && n <= MAX_NAMED_COUNT;
  return {
    quantities: [
      ...(inRange(albums.size) ? [{ value: albums.size, unit: 'albums' as const }] : []),
      ...(inRange(artists.size) ? [{ value: artists.size, unit: 'artists' as const }] : []),
    ],
    names,
  };
}

/** A match counts only as a whole name: no letter or digit runs on from either end of it. */
function isWholeWord(text: string, start: number, end: number): boolean {
  const runsOn = (outside: string | undefined, inside: string): boolean =>
    outside !== undefined && WORD_CHAR.test(outside) && WORD_CHAR.test(inside);
  return !runsOn(text[start - 1], text[start]) && !runsOn(text[end], text[end - 1]);
}

/** The fact a stray name belongs to, for the log: 'fact4', or 'week' when only the scrobbles carry it. */
const nameOwner = (ctx: GuardContext, name: string): string => {
  const id = ctx.owners.get(name);
  return id === undefined ? 'week' : `fact${id}`;
};

/** A cluster or discovery whose statement marks an artist as new under this name (spec section 3, rule 3). */
const isFirstUnderThisName = (f: Fact): boolean =>
  (f.kind === 'discovery' || f.kind === 'genre_cluster') && f.statement.includes(FIRST_UNDER_THIS_NAME);

/**
 * Full dates ('Fri May 29', 'Friday, May 29') must equal a cited day and are masked so their day number is not read
 * as a quantity; a weekday or month on its own must be one a cited day has. Matching needs the capital letter, so
 * "may" the verb is not a month, unless the sentence's case was lost in normalisation. `namesCitedDay` is true when
 * the sentence names at least one weekday or full date that a cited fact carries.
 */
function checkDays(
  cited: Fact[], timezone: string | null, cased: string, caseKnown: boolean, mask: (start: number, end: number) => void,
): { failures: string[]; namesCitedDay: boolean } {
  const days = cited.flatMap((f) => f.dates.map((ts) => dayLabel(ts, timezone).toLowerCase().split(' ')));
  const flags = caseKnown ? 'g' : 'gi';
  const failures: string[] = [];
  let namesCitedDay = false;
  const dates = new RegExp(`\\b(?:(${WEEKDAYS}),? )?(${MONTHS}) (\\d{1,2})(?:st|nd|rd|th)?\\b`, flags);
  for (const m of [...cased.matchAll(dates)]) {
    const [weekday, month, day] = [m[1] === undefined ? null : keyOf(m[1]), keyOf(m[2]), String(Number(m[3]))];
    if (days.some(([w, mo, d]) => (weekday === null || w === weekday) && mo === month && d === day)) namesCitedDay = true;
    else failures.push(`date:${[weekday, month, day].filter((p) => p !== null).join('-')}`);
    mask(m.index, m.index + m[0].length);
  }
  // Re-read after masking: the dates above are gone, so these are weekdays and months on their own.
  const text = cased.replace(dates, (d) => MASK.repeat(d.length));
  for (const m of text.matchAll(new RegExp(`\\b(${WEEKDAYS})\\b`, flags))) {
    if (days.some(([w]) => w === keyOf(m[1]))) namesCitedDay = true;
    else failures.push(`day:${keyOf(m[1])}`);
  }
  for (const m of text.matchAll(new RegExp(`\\b(${MONTHS})\\b`, flags))) {
    if (!days.some(([, mo]) => mo === keyOf(m[1]))) failures.push(`month:${keyOf(m[1])}`);
  }
  return { failures, namesCitedDay };
}

/**
 * Every number the masked, normalised sentence states, with where it starts; an unreadable number word is added to
 * `failures`.
 * `namesCitedDay` (from checkDays) lets "in one day" and its kin restate that day rather than count 1.
 */
function readQuantities(
  text: string, failures: Set<string>, namesCitedDay: boolean,
): Array<{ value: number; unit?: Unit; at: number }> {
  const found: Array<{ value: number; unit?: Unit; at: number }> = [];
  // Each pass masks what it read, so a later pass cannot read it again; masks keep the text's length, so `at` is
  // the number's index in the sentence as given to checkSentence.
  const take = (re: RegExp, read: (m: RegExpExecArray, rest: string) => { value: number; unit?: Unit }): void => {
    for (const m of [...text.matchAll(re)]) {
      const end = m.index + m[0].length;
      found.push({ ...read(m, text.slice(end)), at: m.index });
      text = text.slice(0, m.index) + MASK.repeat(m[0].length) + text.slice(end);
    }
  };
  // `value` of the unit `word` names; years become months.
  const inUnit = (value: number, word: string | undefined): { value: number; unit?: Unit } => {
    if (word === undefined) return { value };
    if (word === '%') return { value, unit: 'percent' };
    return YEAR_WORDS.includes(word) ? { value: value * MONTHS_PER_YEAR, unit: 'months' } : { value, unit: UNIT_WORDS[word] };
  };
  const wordAfter = (rest: string): string | undefined => {
    const m = UNIT_AFTER.exec(rest);
    return m ? m[1] ?? m[2] ?? m[3] : undefined;
  };
  text = text.replace(RATE_ARTICLE, (rate) => MASK.repeat(rate.length));
  text = text.replace(AT_ONCE, (idiom) => MASK.repeat(idiom.length));
  text = text.replace(NOT_A_COUNT, (idiom) => MASK.repeat(idiom.length));
  if (namesCitedDay) text = text.replace(IN_ONE_SITTING, (idiom) => MASK.repeat(idiom.length));
  else take(IN_ONE_SITTING, (m) => (m[1] === 'day' ? { value: 1, unit: 'days' } : { value: 1 }));
  take(HALF_A_YEAR, () => ({ value: MONTHS_PER_YEAR / 2, unit: 'months' }));
  take(DURATION_ARTICLE, (m) => inUnit(1, m[1]));
  take(ARTICLE_UNIT, (m) => inUnit(1, m[1]));
  take(DIGITS, (m, rest) => inUnit(Number(m[0].replace(/,/g, '')), wordAfter(rest)));
  take(NUMBER_WORD, (m, rest) => {
    const word = NUMBER_WORDS[m[1]];
    return word.unit ? { value: word.value, unit: word.unit } : inUnit(word.value, wordAfter(rest));
  });
  for (const m of text.matchAll(UNREAD_NUMBER_WORD)) failures.add(`quantity:word:${m[1]}`);
  for (const m of text.matchAll(FRACTION)) failures.add(`quantity:fraction:${m[1]}`);
  return found;
}
