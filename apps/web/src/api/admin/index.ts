// Admin API Routes
// These routes are under /api/auth (keys) and /api/cache (cache management)

import { Hono } from 'hono';
import type { Bindings, Variables } from '../../types';
import { keysAdminRoutes } from './keys';
import { cacheAdminRoutes } from './cache';

// Auth routes (/api/auth/*)
const authApp = new Hono<{ Bindings: Bindings; Variables: Variables }>();
authApp.route('/', keysAdminRoutes);

// Cache routes (/api/cache)
const cacheApp = new Hono<{ Bindings: Bindings; Variables: Variables }>();
cacheApp.route('/', cacheAdminRoutes);

export const authRoutes = authApp;
export const cacheRoutes = cacheApp;
