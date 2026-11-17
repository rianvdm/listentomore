// ABOUTME: Pure helpers for scripts/insights-eval.ts: the output directory kept inside eval-output/, fixture tags and
// ABOUTME: gold keys, phrases copied from the voice examples, word counts, and the .dev.vars keys a live run needs.

import { isAbsolute, join, relative, resolve } from 'node:path';
import { matchKey } from '@listentomore/insights';

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
