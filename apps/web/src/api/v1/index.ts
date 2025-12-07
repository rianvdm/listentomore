// Public API v1 Routes
// All routes require API key auth (via X-API-Key header)
// Auth and rate limiting applied globally via /api/* middleware in main app

import { Hono } from 'hono';
import type { Bindings, Variables } from '../../types';
import { albumRoutes } from './album';
import { artistRoutes } from './artist';
import { genreRoutes } from './genre';
import { linksRoutes } from './links';
import { askRoutes } from './ask';
import { randomFactRoutes } from './random-fact';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Mount route handlers
app.route('/album', albumRoutes);
app.route('/artist', artistRoutes);
app.route('/genre', genreRoutes);
app.route('/links', linksRoutes);
app.route('/ask', askRoutes);
app.route('/random-fact', randomFactRoutes);

export const v1Routes = app;
