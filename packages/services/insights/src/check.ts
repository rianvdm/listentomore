// ABOUTME: checkNote - the check a model-written note passes before it is shown: every name it lists is this week's
// ABOUTME: and appears in its text, and every integer it states is in the prompt view the model read.

import { matchKey, stripEdition } from './match';
import { norm } from './text';
import type { WeekFacts } from './types';

/** Why a note failed, in the order checkNote reports them. Carries no names, counts or text, so it is safe to log. */
export type NoteCheckFailure = 'name-unknown' | 'name-absent' | 'number';

/** A comma between two digits, as in "1,204". */
const THOUSANDS_COMMA = /(?<=\d),(?=\d)/g;

/**
 * The digit runs of `text` as numbers, after thousands commas are removed. Numbers written as words are not read.
 * scripts/insights-eval-lib.ts counts a note's numbers with it, so the eval's count and the check read the same digits.
 */
export function integersOf(text: string): number[] {
  return (text.replace(THOUSANDS_COMMA, '').match(/\d+/g) ?? []).map(Number);
}

/**
 * Checks a note against the week it was written from. A listed name fails as unknown when its match key is neither a
 * name of the week nor one with its edition suffix stripped, and as absent when it is not a whole-word run of the
 * note's match key. A name that is all punctuation ("!!!") has an empty match key, so it is compared by norm()
 * instead: known when it equals a week name, present when the note contains it. An integer fails when the prompt view
 * does not state it. Returns each failure type once, in NoteCheckFailure order, or an empty array when the note passes.
 * The names are the model's own list, so a name it leaves out is not caught.
 */
export function checkNote(note: { note: string; names: readonly string[] }, wf: WeekFacts, promptView: string): NoteCheckFailure[] {
  const known = new Set(wf.names.flatMap((n) => [matchKey(n), matchKey(stripEdition(n))]));
  const knownNorm = new Set(wf.names.map(norm));
  const text = ` ${matchKey(note.note)} `;
  const normText = norm(note.note);
  const isKnown = (n: string): boolean => (matchKey(n) ? known.has(matchKey(n)) : knownNorm.has(norm(n)));
  const isPresent = (n: string): boolean => (matchKey(n) ? text.includes(` ${matchKey(n)} `) : normText.includes(norm(n)));
  const stated = new Set(integersOf(promptView));
  const failures: NoteCheckFailure[] = [];
  if (!note.names.every(isKnown)) failures.push('name-unknown');
  if (!note.names.every(isPresent)) failures.push('name-absent');
  if (integersOf(note.note).some((n) => !stated.has(n))) failures.push('number');
  return failures;
}
