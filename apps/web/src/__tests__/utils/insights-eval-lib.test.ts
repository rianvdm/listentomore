// ABOUTME: Tests for scripts/insights-eval-lib.ts: the arguments, the output directory, fixture tags and gold keys, phrases copied
// ABOUTME: from the voice examples, counts, phrases and openings repeated across notes, word counts, and the .dev.vars keys.

import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { USER_INSIGHTS_VOICE_EXAMPLES } from '@listentomore/ai';
import { buildWeekFacts, renderPromptView } from '@listentomore/insights';
import type { WeekInputs } from '@listentomore/insights';
import may24Json from '../../../../../packages/services/insights/__fixtures__/bordesak-2026-05-24.json';
import {
  copiedPhrases,
  countIntegers,
  evalOutputDir,
  fixtureTag,
  goldKey,
  missingDevVarsError,
  openingFrame,
  parseEvalArgs,
  preflightFixtures,
  repeatedOpenings,
  repeatedPhrases,
  requiredDevVars,
  wordCount,
} from '../../../scripts/insights-eval-lib';

const WEB_ROOT = '/repo/apps/web';

describe('parseEvalArgs', () => {
  it('parses --label and an optional --extra', () => {
    expect(parseEvalArgs(['--label', 'x'])).toEqual({ label: 'x', extra: null });
    expect(parseEvalArgs(['--label', 'x', '--extra', 'd'])).toEqual({ label: 'x', extra: 'd' });
    expect(parseEvalArgs(['--extra', 'd', '--label', 'x'])).toEqual({ label: 'x', extra: 'd' });
  });

  it('rejects the removed and unknown options by name', () => {
    expect(() => parseEvalArgs(['--label', 'x', '--dry-run'])).toThrow(/--dry-run/);
    expect(() => parseEvalArgs(['--label', 'x', '--trivia'])).toThrow(/--trivia/);
    expect(() => parseEvalArgs(['--foo', '--label', 'x'])).toThrow(/--foo/);
    expect(() => parseEvalArgs(['--label', 'x', 'stray'])).toThrow(/stray/);
  });

  it('needs --label, a value after each flag, and each flag once', () => {
    expect(() => parseEvalArgs([])).toThrow(/--label <name> is required/);
    expect(() => parseEvalArgs(['--extra', 'd'])).toThrow(/--label <name> is required/);
    expect(() => parseEvalArgs(['--label'])).toThrow(/--label needs a value/);
    expect(() => parseEvalArgs(['--label', '--extra', 'd'])).toThrow(/--label needs a value/);
    expect(() => parseEvalArgs(['--label', 'x', '--label', 'y'])).toThrow(/--label given twice/);
  });
});

describe('evalOutputDir', () => {
  it('puts a run under eval-output/<label>/insights', () => {
    expect(evalOutputDir(WEB_ROOT, 'week-facts-r2')).toBe(join(WEB_ROOT, 'eval-output', 'week-facts-r2', 'insights'));
    expect(evalOutputDir(WEB_ROOT, 'r2.1_b')).toBe(join(WEB_ROOT, 'eval-output', 'r2.1_b', 'insights'));
  });

  it('rejects labels that could leave eval-output', () => {
    for (const label of ['..', '.', '../insights', 'a/../..', 'a/b', 'a\\b', '/tmp/x', 'x..y', '', ' ']) {
      expect(() => evalOutputDir(WEB_ROOT, label), label).toThrow(/label/);
    }
  });
});

describe('fixtureTag and goldKey', () => {
  it('tags each committed fixture and an extra one, and finds the gold key of a gold week only', () => {
    const cases: Array<[string, ReturnType<typeof fixtureTag>, string | null]> = [
      ['bordesak-2026-05-24', 'gold', '2026-05-24'],
      ['bordesak-2026-05-31', 'gold', '2026-05-31'],
      ['bordesak-2026-06-12', 'gold, example in prompt', '2026-06-12'],
      ['bordesak-heldout-2026-08-02', 'held-out', null],
      ['bordesak-heldout-2026-09-20', 'held-out', null],
      ['bordesak-live-2026-11-09', 'live', null],
      ['extra-1', 'extra', null],
    ];
    for (const [name, tag, key] of cases) {
      expect(fixtureTag(name), name).toBe(tag);
      expect(goldKey(name), name).toBe(key);
    }
  });

  it('refuses a fixture name it cannot tag', () => {
    expect(() => fixtureTag('week-of-plays')).toThrow(/fixture name/);
    expect(goldKey('week-of-plays')).toBeNull();
  });
});

describe('preflightFixtures', () => {
  const MAY24 = may24Json as unknown as WeekInputs;
  const valid = { name: 'bordesak-2026-05-24', inputs: MAY24 };
  // Passes the loader's shape check (username, now, scrobbles) but has no history lists, so buildWeekFacts throws.
  const invalid = {
    name: 'extra-2',
    inputs: { username: 'someone-else', now: MAY24.now, scrobbles: MAY24.scrobbles } as unknown as WeekInputs,
  };

  it("builds every fixture's week facts and prompt view", () => {
    const [prepared] = preflightFixtures([valid]);
    const wf = buildWeekFacts(MAY24);
    expect(prepared.name).toBe(valid.name);
    expect(prepared.wf).toEqual(wf);
    expect(prepared.promptView).toBe(renderPromptView(wf));
  });

  it('stops on a fixture whose facts cannot be built, naming its label and nothing from it', () => {
    let message = '';
    try {
      preflightFixtures([valid, invalid]);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/extra-2/);
    expect(message).not.toContain('someone-else');
    expect(message).not.toMatch(/\.json/);
  });

  it('a run that preflights first makes no model call when one fixture is invalid, even after valid ones', () => {
    const callModel = vi.fn();
    const run = (fixtures: Array<{ name: string; inputs: WeekInputs }>): void => {
      for (const f of preflightFixtures(fixtures)) callModel(f.promptView);
    };

    expect(() => run([valid, valid, invalid])).toThrow(/extra-2/);
    expect(callModel).not.toHaveBeenCalled();
  });
});

describe('copiedPhrases', () => {
  it('finds a six-word span copied from an example, whatever its case and punctuation', () => {
    expect(USER_INSIGHTS_VOICE_EXAMPLES[0]).toContain('You went back to In Rainbows');
    expect(copiedPhrases('On Tuesday you went back to In Rainbows, twice.', USER_INSIGHTS_VOICE_EXAMPLES)).toEqual([
      'you went back to in rainbows',
    ]);
  });

  it('returns nothing for a five-word overlap', () => {
    expect(copiedPhrases('Then you went back to In Utero.', USER_INSIGHTS_VOICE_EXAMPLES)).toEqual([]);
  });

  it('joins overlapping n-grams into one span and takes a shorter n', () => {
    expect(copiedPhrases('a b c d e f g', ['x a b c d e f g y'])).toEqual(['a b c d e f g']);
    expect(copiedPhrases('one two three', ['zero one two three four'], 3)).toEqual(['one two three']);
  });
});

describe('countIntegers', () => {
  it('counts digit runs, reading a thousands comma between digits as part of the number', () => {
    expect(countIntegers('39 plays, 1,204 scrobbles and 3 days.')).toBe(3);
    expect(countIntegers('Three plays, no digits.')).toBe(0);
    expect(countIntegers('Track 2, 4 plays')).toBe(2);
  });
});

describe('repeatedPhrases', () => {
  const note = (label: string, text: string, names: string[] = []): { label: string; note: string; names: string[] } => ({
    label,
    note: text,
    names,
  });

  it('reports a phrase found in three of four notes, with those labels', () => {
    const notes = [
      note('a', 'Mezzanine ran start to finish, no argument.'),
      note('b', 'Kid A held the top spot, no argument.'),
      note('c', 'A quiet week for drone. No argument.'),
      note('d', 'Nothing much happened on Friday.'),
    ];
    expect(repeatedPhrases(notes)).toContainEqual({ phrase: 'no argument', labels: ['a', 'b', 'c'] });
  });

  it('reports the longest phrase and not the shorter ones inside it with the same labels', () => {
    const notes = ['a', 'b', 'c', 'd'].map((label, i) =>
      note(label, `This was a week of ${['drone', 'jazz', 'metal', 'folk'][i]} records.`),
    );
    const phrases = repeatedPhrases(notes);
    const all = ['a', 'b', 'c', 'd'];
    const long = phrases.filter((p) => p.phrase === 'this was a week' || p.phrase === 'was a week of');
    expect(long.length).toBeGreaterThan(0);
    for (const p of long) expect(p.labels).toEqual(all);
    for (const shorter of ['this was', 'was a', 'a week', 'week of', 'this was a', 'was a week', 'a week of']) {
      expect(phrases.map((p) => p.phrase)).not.toContain(shorter);
    }
  });

  it('skips an artist name each note lists among its own names', () => {
    // The name is the only phrase the notes share, so no longer phrase can hide it.
    const notes = [
      note('a', 'Monday belonged to Nils Frahm.', ['Nils Frahm']),
      note('b', 'Tuesday went Nils Frahm.', ['Nils Frahm']),
      note('c', 'Sunday ended with Nils Frahm.', ['Nils Frahm']),
    ];
    expect(repeatedPhrases(notes)).toEqual([]);
  });

  it('skips a phrase made only of stopwords', () => {
    const notes = [note('a', 'Most of the ambient.'), note('b', 'Some of the jazz.'), note('c', 'Plenty of the rock.')];
    expect(repeatedPhrases(notes)).toEqual([]);
  });

  it('reports nothing found in fewer than minNotes notes', () => {
    const notes = [note('a', 'Still the one, no argument.'), note('b', 'Kid A again, no argument.'), note('c', 'Quiet.')];
    expect(repeatedPhrases(notes)).toEqual([]);
    expect(repeatedPhrases(notes, 2)).toContainEqual({ phrase: 'no argument', labels: ['a', 'b'] });
  });
});

describe('openingFrame and repeatedOpenings', () => {
  const owned = [
    { label: 'a', note: 'Boards of Canada owned this week. Geogaddi twice.', names: ['Boards of Canada', 'Geogaddi'] },
    { label: 'b', note: 'Siiga owned this week.\n\nNostalgia Burns again.', names: ['Siiga', 'Nostalgia Burns'] },
  ];
  const distinct = [
    { label: 'c', note: 'Friday Aug 7 belonged to U2.', names: ['U2'] },
    { label: 'd', note: 'Los Ojos Del Cóndor was the record of the week.', names: ['Los Ojos Del Cóndor'] },
  ];

  it("reads the first four words with the note's own names masked, lower-cased and without punctuation", () => {
    expect(openingFrame(owned[0].note, owned[0].names)).toBe('name owned this week');
    expect(openingFrame(owned[1].note, owned[1].names)).toBe('name owned this week');
    expect(openingFrame(distinct[0].note, distinct[0].names)).toBe('friday aug 7 belonged');
    expect(openingFrame(distinct[1].note, distinct[1].names)).toBe('name was the record');
  });

  it('reports a frame two notes share, with their labels', () => {
    expect(repeatedOpenings([...owned, ...distinct])).toEqual([{ frame: 'name owned this week', labels: ['a', 'b'] }]);
  });

  it('reports nothing for openings that differ, or for a single note', () => {
    expect(repeatedOpenings(distinct)).toEqual([]);
    expect(repeatedOpenings([owned[0]])).toEqual([]);
  });

  it('honours minNotes and sorts by the number of notes, most first, then by frame', () => {
    const notes = [
      ...owned,
      { label: 'e', note: 'Kid A owned this week, again.', names: ['Kid A'] },
      { label: 'f', note: 'A quiet week for drone.', names: [] },
      { label: 'g', note: 'A quiet week for jazz.', names: [] },
    ];
    expect(repeatedOpenings(notes)).toEqual([
      { frame: 'name owned this week', labels: ['a', 'b', 'e'] },
      { frame: 'a quiet week for', labels: ['f', 'g'] },
    ]);
    expect(repeatedOpenings(notes, 3)).toEqual([{ frame: 'name owned this week', labels: ['a', 'b', 'e'] }]);
  });
});

describe('wordCount', () => {
  it('counts words across lines and paragraphs', () => {
    expect(wordCount('a b\n\nc')).toBe(3);
    expect(wordCount('  ')).toBe(0);
  });
});

describe('requiredDevVars and missingDevVarsError', () => {
  it('needs the key of each provider the run uses, once each', () => {
    expect(requiredDevVars(['anthropic'])).toEqual(['ANTHROPIC_API_KEY']);
    expect(requiredDevVars(['anthropic', 'anthropic'])).toEqual(['ANTHROPIC_API_KEY']);
    expect(requiredDevVars(['openai', 'anthropic'])).toEqual(['OPENAI_API_KEY', 'ANTHROPIC_API_KEY']);
  });

  it('names each missing or empty key, and never a value', () => {
    const devVars = { ANTHROPIC_API_KEY: 'SENTINEL-ANTHROPIC-VALUE', SPOTIFY_CLIENT_ID: '' };
    const message = missingDevVarsError(devVars, ['ANTHROPIC_API_KEY', 'SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET']);
    expect(message).toBe('apps/web/.dev.vars is missing SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET');
    expect(message).not.toContain('SENTINEL');
  });

  it('returns null when every required key is set', () => {
    expect(missingDevVarsError({ ANTHROPIC_API_KEY: 'x' }, ['ANTHROPIC_API_KEY'])).toBeNull();
  });

  it('reads .dev.vars only: a key set in process.env does not count', () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'SENTINEL-ENV-VALUE';
    try {
      expect(missingDevVarsError({}, ['ANTHROPIC_API_KEY'])).toBe('apps/web/.dev.vars is missing ANTHROPIC_API_KEY');
    } finally {
      if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previous;
    }
  });
});
