// ABOUTME: Pure helpers for scripts/insights-eval.ts: the output directory kept inside eval-output/, the names the
// ABOUTME: rubric masks, and the .dev.vars keys a live run needs.

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
