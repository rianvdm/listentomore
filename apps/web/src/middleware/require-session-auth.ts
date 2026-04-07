// ABOUTME: Session-based auth guard for internal API routes.
// ABOUTME: Returns 401 JSON for unauthenticated requests to AI-powered endpoints.

import { createMiddleware } from 'hono/factory';
import type { Bindings, Variables } from '../types';

export const requireSessionAuth = createMiddleware<{
  Bindings: Bindings;
  Variables: Variables;
}>(async (c, next) => {
  if (c.get('isAuthenticated')) {
    await next();
    return;
  }

  return c.json({ error: 'Authentication required' }, 401);
});
