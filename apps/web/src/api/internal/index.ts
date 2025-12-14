// Internal API Routes for Progressive Loading
// These endpoints are called by client-side JS with signed tokens
// Auth middleware (internalAuthMiddleware) is applied in main app

import { Hono } from 'hono';
import type { Bindings, Variables } from '../../types';
import { albumInternalRoutes } from './album';
import { artistInternalRoutes } from './artist';
import { genreInternalRoutes } from './genre';
import { searchInternalRoutes } from './search';
import { streamingInternalRoutes } from './streaming';
import { userInternalRoutes } from './user';
import { insightsInternalRoutes } from './insights';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Mount route handlers - internal routes use flat paths (e.g., /album-summary not /album/summary)
// So we mount at root and let each handler define its own paths
app.route('/', albumInternalRoutes);
app.route('/', artistInternalRoutes);
app.route('/', genreInternalRoutes);
app.route('/', searchInternalRoutes);
app.route('/', streamingInternalRoutes);
app.route('/', userInternalRoutes);
app.route('/', insightsInternalRoutes);

export const internalRoutes = app;
