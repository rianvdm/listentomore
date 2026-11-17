// ABOUTME: Tests for scripts/insights-eval-lib.ts: the output directory, fixture tags and gold keys, phrases copied
// ABOUTME: from the voice examples, word counts, and the .dev.vars keys a live run needs.

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { USER_INSIGHTS_VOICE_EXAMPLES } from '@listentomore/ai';
import {
  copiedPhrases,
  evalOutputDir,
  fixtureTag,
  goldKey,
  missingDevVarsError,
  requiredDevVars,
  wordCount,
} from '../../../scripts/insights-eval-lib';

const WEB_ROOT = '/repo/apps/web';

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
