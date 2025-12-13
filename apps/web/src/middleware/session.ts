// Session middleware - injects currentUser into context for all routes

import { createMiddleware } from 'hono/factory';
import { validateSession } from '../utils/session';
import type { Bindings, Variables } from '../types';

/**
 * Session middleware that validates the session cookie and injects
 * currentUser and isAuthenticated into the context.
 * 
 * This should be applied early in the middleware chain.
 */
export const sessionMiddleware = createMiddleware<{
  Bindings: Bindings;
  Variables: Variables;
}>(async (c, next) => {
  const db = c.get('db');
  const user = await validateSession(c, db);

  c.set('currentUser', user);
  c.set('isAuthenticated', !!user);

  await next();
});

/**
 * Require authentication middleware - redirects to login if not authenticated.
 * Use this on routes that require a logged-in user.
 */
export const requireAuth = createMiddleware<{
  Bindings: Bindings;
  Variables: Variables;
}>(async (c, next) => {
  if (!c.get('isAuthenticated')) {
    const returnUrl = encodeURIComponent(c.req.path);
    return c.redirect(`/login?next=${returnUrl}`);
  }
  await next();
});
