// ABOUTME: Tests for writeWeekNote - up to two model calls, the first note that passes checkNote wins, and each
// ABOUTME: attempt's outcome is recorded for the caller to log. Uses a fake getUserInsightsNote; no live model call.

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { UserInsightsNoteResult } from '@listentomore/ai';
import { buildWeekFacts, renderPromptView } from '@listentomore/insights';
import type { WeekInputs } from '@listentomore/insights';
import may24Json from '../../../../../packages/services/insights/__fixtures__/bordesak-2026-05-24.json';
import { NOTE_ATTEMPTS, writeWeekNote } from '../../api/internal/insights-note';

const WF = buildWeekFacts(may24Json as unknown as WeekInputs);

/** A reply whose names are this week's and whose numbers (41) are in the prompt view. */
const PASSING: UserInsightsNoteResult = {
  note: {
    note: 'Boards of Canada took over Friday with 41 plays.\n\nInferno ran start to finish.',
    names: ['Boards of Canada', 'Inferno'],
  },
  raw: '{"note": "..."}',
  metadata: { provider: 'anthropic', model: 'claude-opus-5-5', api: 'messages' },
};
/** Names an artist the week never played. */
const UNKNOWN_NAME: UserInsightsNoteResult = {
  note: { note: 'Quillon Varga had a big week.', names: ['Quillon Varga'] },
  raw: '{"note": "Quillon Varga had a big week."}',
};
const UNPARSEABLE: UserInsightsNoteResult = { note: null, raw: 'not json' };

const fakeAi = () => ({ getUserInsightsNote: vi.fn<(promptView: string) => Promise<UserInsightsNoteResult>>() });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('writeWeekNote', () => {
  it('makes two attempts at most', () => {
    expect(NOTE_ATTEMPTS).toBe(2);
  });

  it('a first reply that passes: one call with the prompt view, the note set, attempts ["ok"]', async () => {
    const ai = fakeAi();
    ai.getUserInsightsNote.mockResolvedValue(PASSING);

    const run = await writeWeekNote(ai, WF);

    expect(ai.getUserInsightsNote).toHaveBeenCalledTimes(1);
    expect(ai.getUserInsightsNote).toHaveBeenCalledWith(renderPromptView(WF));
    expect(run.note).toEqual(PASSING.note);
    expect(run.result).toBe(PASSING);
    expect(run.attempts).toEqual([{ outcome: 'ok', raw: PASSING.raw }]);
  });

  it('a check failure then a pass: two calls, attempts ["check-failed", "ok"], name-unknown on the first', async () => {
    const ai = fakeAi();
    ai.getUserInsightsNote.mockResolvedValueOnce(UNKNOWN_NAME).mockResolvedValueOnce(PASSING);

    const run = await writeWeekNote(ai, WF);

    expect(ai.getUserInsightsNote).toHaveBeenCalledTimes(2);
    expect(run.attempts.map((a) => a.outcome)).toEqual(['check-failed', 'ok']);
    expect(run.attempts[0]).toEqual({ outcome: 'check-failed', failures: ['name-unknown'], raw: UNKNOWN_NAME.raw });
    expect(run.note).toEqual(PASSING.note);
    expect(run.result).toBe(PASSING);
  });

  it('two throws: no note, and each attempt is call-failed with the error kind', async () => {
    const ai = fakeAi();
    ai.getUserInsightsNote
      .mockRejectedValueOnce(new Error('Anthropic API error: 529'))
      .mockRejectedValueOnce(new TypeError('fetch failed'));

    const run = await writeWeekNote(ai, WF);

    expect(ai.getUserInsightsNote).toHaveBeenCalledTimes(2);
    expect(run.note).toBeNull();
    expect(run.result).toBeNull();
    expect(run.attempts).toEqual([
      { outcome: 'call-failed', kind: 'Error' },
      { outcome: 'call-failed', kind: 'TypeError' },
    ]);
  });

  it('unparseable then a check failure: no note and no third call', async () => {
    const ai = fakeAi();
    ai.getUserInsightsNote.mockResolvedValueOnce(UNPARSEABLE).mockResolvedValueOnce(UNKNOWN_NAME).mockResolvedValue(PASSING);

    const run = await writeWeekNote(ai, WF);

    expect(ai.getUserInsightsNote).toHaveBeenCalledTimes(2);
    expect(run.note).toBeNull();
    expect(run.result).toBeNull();
    expect(run.attempts).toEqual([
      { outcome: 'unparseable', raw: UNPARSEABLE.raw },
      { outcome: 'check-failed', failures: ['name-unknown'], raw: UNKNOWN_NAME.raw },
    ]);
  });

  it('logs nothing: the caller logs', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}));
    const ai = fakeAi();
    ai.getUserInsightsNote.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(UNKNOWN_NAME);

    await writeWeekNote(ai, WF);

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
