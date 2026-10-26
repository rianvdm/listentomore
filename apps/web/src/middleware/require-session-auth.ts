// ABOUTME: Session-based auth guard for internal API routes.
// ABOUTME: Loads the session on demand and returns 401 JSON for unauthenticated requests to AI-powered endpoints.

import { createMiddleware } from 'hono/factory';
import { getCurrentUser } from './session';
import type { InternalAppContext } from '../types';

// Calls getCurrentUser() rather than reading isAuthenticated: /api/internal/*
// skips the eager session lookup, so the flag is never set on these routes.
export const requireSessionAuth = createMiddleware<InternalAppContext>(async (c, next) => {
  const user = await getCurrentUser(c);
  if (user) {
    await next();
    return;
  }

  return c.json({ error: 'Authentication required' }, 401);
});
