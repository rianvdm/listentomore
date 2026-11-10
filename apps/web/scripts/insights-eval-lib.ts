// ABOUTME: Pure helpers for scripts/insights-eval.ts: the run's output directory, kept inside eval-output/, and the
// ABOUTME: artist and album names of a week that the rubric masks.

import { isAbsolute, join, relative, resolve } from 'node:path';
import type { WeekFacts } from '@listentomore/insights';

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

/** Every artist and album name of the week the note may name: the scrobbles' names and every fact's entities. */
export function noteNames(wf: WeekFacts): string[] {
  return [...new Set([...wf.names, ...[wf.windowFact, ...wf.facts].flatMap((f) => f.entities)])];
}
