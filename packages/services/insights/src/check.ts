// ABOUTME: checkNote - the check a model-written note passes before it is shown: every name it lists is this week's
// ABOUTME: and appears in its text, and every integer it states is in the prompt view the model read.

import { matchKey, stripEdition } from './match';
import type { WeekFacts } from './types';

/** Why a note failed, in the order checkNote reports them. Carries no names, counts or text, so it is safe to log. */
export type NoteCheckFailure = 'name-unknown' | 'name-absent' | 'number';

/** A comma between two digits, as in "1,204". */
const THOUSANDS_COMMA = /(?<=\d),(?=\d)/g;

/** The digit runs of `text` as numbers, after thousands commas are removed. Numbers written as words are not read. */
const integersOf = (text: string): number[] => (text.replace(THOUSANDS_COMMA, '').match(/\d+/g) ?? []).map(Number);

/**
 * Checks a note against the week it was written from. A listed name fails as unknown when its match key is neither a
 * name of the week nor one with its edition suffix stripped, and as absent when it is not a whole-word run of the
 * note's match key. An integer fails when the prompt view does not state it. Returns each failure type once, in
 * NoteCheckFailure order, or an empty array when the note passes. The names are the model's own list, so a name it
 * leaves out is not caught.
 */
export function checkNote(note: { note: string; names: readonly string[] }, wf: WeekFacts, promptView: string): NoteCheckFailure[] {
  const known = new Set(wf.names.flatMap((n) => [matchKey(n), matchKey(stripEdition(n))]));
  const text = ` ${matchKey(note.note)} `;
  const stated = new Set(integersOf(promptView));
  const failures: NoteCheckFailure[] = [];
  if (note.names.some((n) => !known.has(matchKey(n)))) failures.push('name-unknown');
  if (note.names.some((n) => !text.includes(` ${matchKey(n)} `))) failures.push('name-absent');
  if (integersOf(note.note).some((n) => !stated.has(n))) failures.push('number');
  return failures;
}
