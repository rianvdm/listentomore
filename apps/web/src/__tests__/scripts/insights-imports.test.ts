// ABOUTME: Import smoke test: the insights route, the card core, the making-of fact and the eval lib load in Node.
// ABOUTME: A value import of a Worker-only module (cloudflare:workers, through the Durable Object) fails it.

import { describe, it, expect } from 'vitest';

describe('insights modules in Node', () => {
  it('the route, card core, making-of and eval lib import in Node', async () => {
    const modules = await Promise.all([
      import('../../api/internal/insights'),
      import('../../api/internal/insights-card'),
      import('../../api/internal/insights-making-of'),
      import('../../../scripts/insights-eval-lib'),
    ]);
    const [route, card, makingOf, evalLib] = modules;

    expect(route.insightsInternalRoutes).toBeDefined();
    expect(typeof card.generateCard).toBe('function');
    expect(typeof card.renderCard).toBe('function');
    expect(typeof card.isCardValid).toBe('function');
    expect(typeof makingOf.makingOfFact).toBe('function');
    expect(typeof evalLib.evalOutputDir).toBe('function');
  });
});
