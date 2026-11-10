// ABOUTME: Tests for scripts/insights-eval-lib.ts: the eval's output directory stays inside eval-output/, and the
// ABOUTME: names the rubric masks are the week's names plus every fact entity.

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import type { WeekFacts } from '@listentomore/insights';
import { evalOutputDir, noteNames } from '../../../scripts/insights-eval-lib';

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
