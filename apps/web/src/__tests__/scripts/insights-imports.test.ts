// ABOUTME: Import smoke test: the insights route, the week-note helpers and the eval lib load in Node.
// ABOUTME: A value import of a Worker-only module (cloudflare:workers, through the Durable Object) fails it.

import { describe, it, expect } from 'vitest';

describe('insights modules in Node', () => {
  it('the route, week-note helpers and eval lib import in Node', async () => {
    const [route, week, evalLib] = await Promise.all([
      import('../../api/internal/insights'),
      import('../../api/internal/insights-week'),
      import('../../../scripts/insights-eval-lib'),
    ]);

    expect(route.insightsInternalRoutes).toBeDefined();
    expect(typeof week.getWeekInsights).toBe('function');
    expect(typeof evalLib.evalOutputDir).toBe('function');
  });
});
