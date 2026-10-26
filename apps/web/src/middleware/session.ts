// ABOUTME: Session middleware - loads the signed-in user eagerly for pages and lazily for /api/internal/*.
// ABOUTME: getCurrentUser() is the memoized lookup; requireAuth redirects anonymous page visitors to login.

import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { Database, User } from '@listentomore/db';
import { validateSession } from '../utils/session';
import { getWaitUntil } from '../utils/wait-until';
import type { Bindings, Variables } from '../types';

/**
 * Internal API routes skip the eager session lookup.
 *
 * Each lookup costs two serial D1 round trips (~70 ms from most colos), and pages
 * fan out into several levels of /api/internal/* calls, most of which never read
 * the user. Rather than keep an allow-list of routes that need the session (which
 * silently breaks when a route is added or renamed), internal routes load it on
 * demand through getCurrentUser(). Two things keep that from regressing quietly:
 * requireSessionAuth calls getCurrentUser() itself, and the internal routers are
 * typed with InternalAppContext, which omits currentUser/isAuthenticated, so
 * reading the eager fields from an internal route is a type error.
 */
const LAZY_SESSION_PATH_PREFIX = '/api/internal/';

/**
 * Resolve the signed-in user for this request, querying D1 at most once.
 * Safe to call from any route or middleware; later calls reuse the first lookup.
 */
export function getCurrentUser(c: Context): Promise<User | null> {
  const existing = c.get('sessionLookup') as Promise<User | null> | undefined;
  if (existing) return existing;

  const lookup = validateSession(c, c.get('db') as Database, getWaitUntil(c));
  c.set('sessionLookup', lookup);
  return lookup;
}

/**
 * Session middleware that validates the session cookie and injects
 * currentUser and isAuthenticated into the context for page and public API
 * routes. /api/internal/* requests skip this and use getCurrentUser() instead.
 *
 * This should be applied early in the middleware chain, after the db is set.
 */
export const sessionMiddleware = createMiddleware<{
  Bindings: Bindings;
  Variables: Variables;
}>(async (c, next) => {
  if (c.req.path.startsWith(LAZY_SESSION_PATH_PREFIX)) {
    await next();
    return;
  }

  const user = await getCurrentUser(c);
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
