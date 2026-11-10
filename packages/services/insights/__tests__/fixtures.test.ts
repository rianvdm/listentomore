// ABOUTME: Sanity checks on the committed owner-week fixtures: the annotated weeks the ranking tests run on, and the
// ABOUTME: held-out and live weeks only the eval reads. Guards the window shape, chart weeks, period lists and owner-only rule.

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadFixture } from './helpers';
import { weekWindow } from '../src';

const ANNOTATED = ['bordesak-2026-05-24', 'bordesak-2026-05-31', 'bordesak-2026-06-12'];
// Shape checks only: no ranking test reads these, so the eval's held-out weeks stay out of tuning.
const EVAL_ONLY = ['bordesak-heldout-2026-08-02', 'bordesak-heldout-2026-09-20', 'bordesak-live-2026-11-09'];

describe.each([...ANNOTATED, ...EVAL_ONLY])('%s', (name) => {
  const f = loadFixture(name);
  it('has 35 days of ascending scrobbles inside the window', () => {
    expect(f.scrobbles.length).toBeGreaterThan(1000);
    expect(f.scrobbles[0].ts).toBeGreaterThanOrEqual(f.now - 35 * 86400);
    expect(f.scrobbles.at(-1)!.ts).toBeLessThan(f.now);
    expect([...f.scrobbles].sort((a, b) => a.ts - b.ts)).toEqual(f.scrobbles);
  });
  it('has 8 chart weeks older than the scrobbles and complete period lists', () => {
    expect(f.chartWeeks).toHaveLength(8);
    expect(Math.max(...f.chartWeeks.map((w) => w.to))).toBeLessThanOrEqual(f.now - 35 * 86400 + 7 * 86400);
    expect(f.period.m3.complete && f.period.m6.complete && f.period.m12.complete).toBe(true);
  });
  it('contains no other listener', () => expect(f.username).toBe('bordesak'));
});

it('the May 24 week has the raw play count the worksheet saw', () => {
  const f = loadFixture('bordesak-2026-05-24');
  const w = weekWindow(f.now);
  expect(f.scrobbles.filter((s) => s.ts >= w.from).length).toBe(488);
});

it('holds no fixture besides the listed owner weeks and the gold summaries', () => {
  // Another listener's weeks live in the private vault, never here.
  const dir = fileURLToPath(new URL('../__fixtures__/', import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  expect(files).toEqual([...ANNOTATED, ...EVAL_ONLY, 'gold'].map((n) => `${n}.json`).sort());
});
