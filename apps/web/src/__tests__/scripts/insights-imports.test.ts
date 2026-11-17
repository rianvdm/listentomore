// ABOUTME: Import smoke test: the insights route, the week-note helpers, the note writer and the eval lib load in Node.
// ABOUTME: A value import of a Worker-only module (cloudflare:workers, through the Durable Object) fails it.

import { describe, it, expect } from 'vitest';

describe('insights modules in Node', () => {
  it('the route, week-note helpers, note writer and eval lib import in Node', async () => {
    const [route, week, note, evalLib] = await Promise.all([
      import('../../api/internal/insights'),
      import('../../api/internal/insights-week'),
      import('../../api/internal/insights-note'),
      import('../../../scripts/insights-eval-lib'),
    ]);

    expect(route.insightsInternalRoutes).toBeDefined();
    expect(typeof week.getWeekInsights).toBe('function');
    expect(week.NOTE_MIN_PLAYS).toBe(30);
    expect(week.MIN_WEEK_PLAYS).toBe(5);
    expect(typeof note.writeWeekNote).toBe('function');
    expect(typeof evalLib.evalOutputDir).toBe('function');
  });
});
