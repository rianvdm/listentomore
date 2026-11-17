// ABOUTME: Tests for scripts/insights-eval-lib.ts: the output directory, the names the rubric masks, and the
// ABOUTME: .dev.vars keys a live run needs.

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import type { WeekFacts } from '@listentomore/insights';
import { evalOutputDir, missingDevVarsError, noteNames, requiredDevVars } from '../../../scripts/insights-eval-lib';

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

describe('noteNames', () => {
  it('returns the week names and every fact entity, once each', () => {
    const fact = (entities: string[]) => ({ entities }) as unknown as WeekFacts['facts'][number];
    const wf = {
      names: ['Great White', 'Inferno'],
      windowFact: fact([]),
      facts: [fact(['Great White', 'Gurriers']), fact(['Boards of Canada'])],
    } as unknown as WeekFacts;
    expect(noteNames(wf).sort()).toEqual(['Boards of Canada', 'Great White', 'Gurriers', 'Inferno']);
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
