// Admin API Routes
// These routes are under /api/auth (keys, OAuth) and /api/cache (cache management)

import { Hono } from 'hono';
import type { Bindings, Variables } from '../../types';
import { keysAdminRoutes } from './keys';
import { cacheAdminRoutes } from './cache';
import { discogsOAuthRoutes } from './discogs-oauth';

// Auth routes (/api/auth/*)
const authApp = new Hono<{ Bindings: Bindings; Variables: Variables }>();
authApp.route('/', keysAdminRoutes);
authApp.route('/discogs', discogsOAuthRoutes);

// Cache routes (/api/cache)
const cacheApp = new Hono<{ Bindings: Bindings; Variables: Variables }>();
cacheApp.route('/', cacheAdminRoutes);

export const authRoutes = authApp;
export const cacheRoutes = cacheApp;
