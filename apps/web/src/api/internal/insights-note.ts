// ABOUTME: writeWeekNote - asks the model for the owner's week note up to NOTE_ATTEMPTS times and keeps the first that
// ABOUTME: passes checkNote. Node-safe (the eval imports it) and silent: it records each attempt and its caller logs.

import type { AIService, UserInsightsNoteResult, WeekNote } from '@listentomore/ai';
import { checkNote, renderPromptView } from '@listentomore/insights';
import type { NoteCheckFailure, WeekFacts } from '@listentomore/insights';
import { errorKind } from '../../utils/error-kind';

/** One regeneration after a failed attempt, then the caller falls back to the code line (spec, "The check"). */
export const NOTE_ATTEMPTS = 2;

/**
 * What one model call came to. `raw` is the model's reply, kept for the eval; the route never logs it. `kind` is the
 * thrown error's class from errorKind, and `failures` are checkNote's codes, so both are safe to log.
 */
export type NoteAttempt =
  | { outcome: 'ok'; raw: string }
  | { outcome: 'call-failed'; kind: string }
  | { outcome: 'unparseable'; raw: string }
  | { outcome: 'check-failed'; failures: NoteCheckFailure[]; raw: string };

/** The note that passed and the model result it came from (both null when none passed), and every attempt in order. */
export interface NoteRun {
  note: WeekNote | null;
  result: UserInsightsNoteResult | null;
  attempts: NoteAttempt[];
}

/**
 * Writes the week note: renders the prompt view once, then calls the model up to NOTE_ATTEMPTS times and stops at the
 * first note that passes checkNote. A thrown call, an unparseable reply and a failed check each use one attempt.
 */
export async function writeWeekNote(ai: Pick<AIService, 'getUserInsightsNote'>, wf: WeekFacts): Promise<NoteRun> {
  const promptView = renderPromptView(wf);
  const attempts: NoteAttempt[] = [];
  for (let attempt = 1; attempt <= NOTE_ATTEMPTS; attempt++) {
    let result: UserInsightsNoteResult;
    try {
      result = await ai.getUserInsightsNote(promptView);
    } catch (error) {
      attempts.push({ outcome: 'call-failed', kind: errorKind(error) });
      continue;
    }
    if (result.note === null) {
      attempts.push({ outcome: 'unparseable', raw: result.raw });
      continue;
    }
    const failures = checkNote(result.note, wf, promptView);
    if (failures.length === 0) {
      attempts.push({ outcome: 'ok', raw: result.raw });
      return { note: result.note, result, attempts };
    }
    attempts.push({ outcome: 'check-failed', failures, raw: result.raw });
  }
  return { note: null, result: null, attempts };
}
