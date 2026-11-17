// ABOUTME: Pure helpers for scripts/insights-eval.ts: its arguments, the output directory kept inside eval-output/,
// ABOUTME: the fixture preflight, tags and gold keys, copied and repeated phrases, repeated openings, counts, .dev.vars keys.

import { isAbsolute, join, relative, resolve } from 'node:path';
import { buildWeekFacts, integersOf, matchKey, renderPromptView } from '@listentomore/insights';
import type { WeekFacts, WeekInputs } from '@listentomore/insights';
import { maskNames } from './insights-rubric';

/** The eval's arguments as given: the run label and the --extra directory, unchecked on disk. */
export interface EvalArgs {
  label: string;
  extra: string | null;
}

const EVAL_FLAGS = ['--label', '--extra'] as const;
type EvalFlag = (typeof EVAL_FLAGS)[number];
const isEvalFlag = (arg: string): arg is EvalFlag => (EVAL_FLAGS as readonly string[]).includes(arg);

/**
 * `--label <name> [--extra <dir>]`, in either order. Throws, naming the argument, for anything else: an unknown or
 * removed option such as --dry-run or --trivia, a stray value, a flag without a value or a flag given twice. The run
 * must never go ahead with an option it ignores, since it spends money.
 */
export function parseEvalArgs(argv: string[]): EvalArgs {
  const values: Partial<Record<EvalFlag, string>> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!isEvalFlag(flag)) throw new Error(`unsupported argument ${flag}: the eval takes --label <name> [--extra <dir>]`);
    if (values[flag] !== undefined) throw new Error(`${flag} given twice`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    values[flag] = value;
  }
  if (!values['--label']) throw new Error('--label <name> is required');
  return { label: values['--label'], extra: values['--extra'] ?? null };
}

/**
 * `<webRoot>/eval-output/<label>/insights`. Throws for a label that is empty, holds anything but letters, digits, dot,
 * dash and underscore, contains '..' or is '.', and checks the resolved path is inside eval-output/ besides: the
 * output holds prompt views and notes, and only eval-output/ is gitignored.
 */
export function evalOutputDir(webRoot: string, label: string): string {
  if (!/^[\w.-]+$/.test(label) || label === '.' || label.includes('..')) {
    throw new Error('--label must be letters, digits, dot, dash or underscore, and not "." or contain ".."');
  }
  const base = resolve(webRoot, 'eval-output');
  const dir = resolve(join(base, label, 'insights'));
  const rel = relative(base, dir);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('--label resolves outside eval-output/');
  }
  return dir;
}

/**
 * Where a fixture stands against the owner's gold summaries: a gold week has one, and the 2026-06-12 gold week is also
 * the first voice example in the prompt (USER_INSIGHTS_VOICE_EXAMPLES[0]), so its note is no test of the voice.
 * Held-out and live weeks carry the decision; extra weeks are other fixtures passed with --extra.
 */
export type FixtureTag = 'gold' | 'gold, example in prompt' | 'held-out' | 'live' | 'extra';

/** The gold week whose summary is the prompt's first voice example. */
const PROMPT_EXAMPLE_DATE = '2026-06-12';

/** A committed fixture name: `<user>-<date>`, `<user>-heldout-<date>` or `<user>-live-<date>`. */
const COMMITTED_NAME = /^.+?-(?:(heldout|live)-)?(\d{4}-\d{2}-\d{2})$/;
const EXTRA_NAME = /^extra-\d+$/;

/** The tag of a fixture by its name. Throws for a name that is neither a committed fixture's nor `extra-<n>`. */
export function fixtureTag(name: string): FixtureTag {
  if (EXTRA_NAME.test(name)) return 'extra';
  const match = COMMITTED_NAME.exec(name);
  if (!match) throw new Error(`fixture name ${name} is not <user>-<date>, <user>-heldout-<date> or <user>-live-<date>`);
  const [, kind, date] = match;
  if (kind === 'heldout') return 'held-out';
  if (kind === 'live') return 'live';
  return date === PROMPT_EXAMPLE_DATE ? 'gold, example in prompt' : 'gold';
}

/** The gold.json key of a gold week, its date; null for held-out, live, extra and unrecognised names. */
export function goldKey(name: string): string | null {
  if (EXTRA_NAME.test(name)) return null;
  const match = COMMITTED_NAME.exec(name);
  return match && !match[1] ? match[2] : null;
}

/** A fixture with the week facts and prompt view the run sends to the model. */
export type PreparedFixture<F> = F & { wf: WeekFacts; promptView: string };

/**
 * Builds every fixture's week facts and prompt view before the run makes its first model call, so a fixture that
 * passes the loader's shape check but cannot be built stops the run before any money is spent, not part-way through
 * it. Throws naming the fixture's label (`extra-<n>` for --extra fixtures, never the file name) and nothing from the
 * fixture or the error, whose message can quote listening data.
 */
export function preflightFixtures<F extends { name: string; inputs: WeekInputs }>(fixtures: F[]): Array<PreparedFixture<F>> {
  return fixtures.map((fixture) => {
    try {
      const wf = buildWeekFacts(fixture.inputs);
      return { ...fixture, wf, promptView: renderPromptView(wf) };
    } catch {
      throw new Error(`fixture ${fixture.name} failed preflight: its week facts or prompt view could not be built`);
    }
  });
}

/** `text` as matchKey words: lowercase, accents and punctuation dropped. */
const keyWords = (text: string): string[] => matchKey(text).split(' ').filter(Boolean);

/**
 * Every run of `n` or more words the note shares with one of the examples, compared as matchKey words so case and
 * punctuation don't hide a copy. Overlapping shared n-grams join into one span, so an eight-word copy is one phrase.
 */
export function copiedPhrases(note: string, examples: readonly string[], n = 6): string[] {
  const exampleGrams = new Set<string>();
  for (const example of examples) {
    const words = keyWords(example);
    for (let i = 0; i + n <= words.length; i++) exampleGrams.add(words.slice(i, i + n).join(' '));
  }
  const words = keyWords(note);
  const spans: string[] = [];
  let start = -1;
  let end = -1;
  for (let i = 0; i + n <= words.length; i++) {
    if (!exampleGrams.has(words.slice(i, i + n).join(' '))) continue;
    if (start >= 0 && i < end) {
      end = i + n;
      continue;
    }
    if (start >= 0) spans.push(words.slice(start, end).join(' '));
    start = i;
    end = i + n;
  }
  if (start >= 0) spans.push(words.slice(start, end).join(' '));
  return [...new Set(spans)];
}

/** How many integers the note states, read the way checkNote reads them: digit runs, thousands commas removed. */
export function countIntegers(note: string): number {
  return integersOf(note).length;
}

/**
 * Words too common to make a repeated phrase on their own: articles, prepositions, pronouns, forms of be and have,
 * and conjunctions. A phrase made only of these ("of the", "this was") is never reported.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the',
  'of', 'to', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'as', 'into', 'about',
  'and', 'or', 'but',
  'that', 'this', 'it', 'its', 'you', 'your', 'i', 'me', 'my', 'we', 'our', 'they', 'them', 'their',
  'be', 'is', 'are', 'was', 'were', 'been', 'being', 'have', 'has', 'had',
]);

const REPEATED_MIN_WORDS = 2;
const REPEATED_MAX_WORDS = 4;
const REPEATED_CAP = 15;

/** Whether the words of `inner` run, whole, inside the words of `outer`. Both are space-joined matchKey words. */
const containsWords = (outer: string, inner: string): boolean => ` ${outer} `.includes(` ${inner} `);

/**
 * Phrases of two to four matchKey words that turn up in `minNotes` or more of the notes, each with the labels of the
 * notes it is in, in note order: a tic the model carries from week to week. A phrase counts once per note. Skipped: a
 * phrase made only of stopwords, and in each note a phrase inside one of that note's own names, since artist and album
 * names repeat legitimately. A shorter phrase goes when a longer reported one contains it in the same notes. Sorted
 * by the number of notes, most first, then by phrase; at most 15.
 */
export function repeatedPhrases(
  notes: ReadonlyArray<{ label: string; note: string; names: readonly string[] }>,
  minNotes = 3,
): Array<{ phrase: string; labels: string[] }> {
  const found = new Map<string, string[]>();
  for (const { label, note, names } of notes) {
    const nameKeys = names.map(matchKey).filter(Boolean);
    const words = keyWords(note);
    const grams = new Set<string>();
    for (let n = REPEATED_MIN_WORDS; n <= REPEATED_MAX_WORDS; n++) {
      for (let i = 0; i + n <= words.length; i++) {
        const gram = words.slice(i, i + n);
        if (gram.every((word) => STOPWORDS.has(word))) continue;
        const phrase = gram.join(' ');
        if (nameKeys.some((name) => containsWords(name, phrase))) continue;
        grams.add(phrase);
      }
    }
    for (const phrase of grams) {
      const labels = found.get(phrase) ?? [];
      if (!labels.includes(label)) labels.push(label);
      found.set(phrase, labels);
    }
  }
  const reported = [...found]
    .filter(([, labels]) => labels.length >= minNotes)
    .map(([phrase, labels]) => ({ phrase, labels, key: labels.join('\u0000') }));
  return reported
    .filter((short) => !reported.some((long) =>
      long.phrase.length > short.phrase.length && long.key === short.key && containsWords(long.phrase, short.phrase)))
    .sort((a, b) => b.labels.length - a.labels.length || a.phrase.localeCompare(b.phrase))
    .slice(0, REPEATED_CAP)
    .map(({ phrase, labels }) => ({ phrase, labels }));
}

const OPENING_WORDS = 4;

const WEEKDAYS: ReadonlySet<string> = new Set([
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
]);

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
/** Each month's full name and its three-letter abbreviation, as matchKey words. */
const MONTHS: ReadonlySet<string> = new Set([...MONTH_NAMES, ...MONTH_NAMES.map((m) => m.slice(0, 3))]);

const isDayNumber = (word: string | undefined): boolean =>
  word !== undefined && /^\d{1,2}$/.test(word) && Number(word) >= 1 && Number(word) <= 31;

/**
 * matchKey words with each weekday read as "day", each month followed by a day number ("may 29", "aug 7") as "date",
 * and a "day date" pair as one "day", so "Friday, May 29" and "Sunday" open the same way.
 */
function genericDays(words: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (WEEKDAYS.has(word)) {
      out.push('day');
    } else if (MONTHS.has(word) && isDayNumber(words[i + 1])) {
      i++;
      if (out[out.length - 1] !== 'day') out.push('date');
    } else {
      out.push(word);
    }
  }
  return out;
}

/**
 * The note's first four matchKey words after maskNames, with weekdays and dates made generic (see genericDays), so
 * "Siiga owned this week." and "Boards of Canada owned this week." both read "name owned this week", and "Friday Aug 7
 * belonged to U2." and "Sunday belonged to Mutemath." both read "day belonged to name": the frame the note opens on,
 * whoever and whenever fills it.
 */
export function openingFrame(note: string, names: readonly string[]): string {
  return genericDays(keyWords(maskNames(note, names))).slice(0, OPENING_WORDS).join(' ');
}

/**
 * The opening frames shared by `minNotes` or more of the notes, each with the labels of the notes that open on it, in
 * note order: the run-wide habit the repeated-phrase list can miss when generic phrases fill its slots. Sorted by the
 * number of notes, most first, then by frame.
 */
export function repeatedOpenings(
  notes: ReadonlyArray<{ label: string; note: string; names: readonly string[] }>,
  minNotes = 2,
): Array<{ frame: string; labels: string[] }> {
  const found = new Map<string, string[]>();
  for (const { label, note, names } of notes) {
    const frame = openingFrame(note, names);
    if (!frame) continue;
    found.set(frame, [...(found.get(frame) ?? []), label]);
  }
  return [...found]
    .filter(([, labels]) => labels.length >= minNotes)
    .map(([frame, labels]) => ({ frame, labels }))
    .sort((a, b) => b.labels.length - a.labels.length || a.frame.localeCompare(b.frame));
}

/** Whitespace-separated words, across lines and paragraphs. */
export function wordCount(note: string): number {
  return note.split(/\s+/).filter(Boolean).length;
}

/** The .dev.vars key holding each provider's API key. */
const PROVIDER_KEYS: Record<'openai' | 'anthropic', string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

/** The .dev.vars keys a live run needs: the key of each provider its tasks use, once each. */
export function requiredDevVars(providers: Array<'openai' | 'anthropic'>): string[] {
  return [...new Set(providers.map((p) => PROVIDER_KEYS[p]))];
}

/**
 * A message naming every required key that apps/web/.dev.vars lacks or leaves empty, or null when all are set. Keys
 * come from .dev.vars only, never process.env, and the message carries key names, never a value.
 */
export function missingDevVarsError(devVars: Record<string, string>, required: string[]): string | null {
  const missing = required.filter((key) => !devVars[key]);
  return missing.length > 0 ? `apps/web/.dev.vars is missing ${missing.join(', ')}` : null;
}
