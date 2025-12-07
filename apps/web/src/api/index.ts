// API Routes Index
// Provides the /api overview endpoint and exports all route groups

import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { v1Routes } from './v1';
import { internalRoutes } from './internal';
import { authRoutes, cacheRoutes } from './admin';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// API routes overview
app.get('/', (c) => {
  const apiKey = c.get('apiKey');
  return c.json({
    message: 'Listen To More API',
    version: '1.0.0',
    documentation: 'https://github.com/rianvdm/listentomore/blob/main/docs/API.md',
    auth: {
      authenticated: !!apiKey,
      tier: apiKey?.tier ?? 'public',
      hint: 'Include X-API-Key header for authenticated access',
    },
    rateLimits: {
      standard: '60 req/min',
      premium: '300 req/min',
    },
    endpoints: {
      v1: {
        album: {
          description: 'Get album details with AI summary and streaming links',
          endpoint: 'GET /api/v1/album?artist=:artist&album=:album',
          optional: 'include=summary,links,tracks (default: all)',
        },
        albumRecommendations: {
          description: 'Get AI-generated album recommendations',
          endpoint: 'GET /api/v1/album/recommendations?artist=:artist&album=:album',
        },
        links: {
          description: 'Get cross-platform streaming links',
          endpoint: 'GET /api/v1/links?artist=:artist&album=:album',
        },
        artist: {
          description: 'Get artist details with AI summary',
          endpoint: 'GET /api/v1/artist?q=:artistName',
          optional: 'include=summary,sentence,albums (default: all)',
        },
        genre: {
          description: 'Get AI-generated genre summary',
          endpoint: 'GET /api/v1/genre?q=:genreName',
        },
        ask: {
          description: 'Chat with the music AI',
          endpoint: 'POST /api/v1/ask',
          body: '{ "question": "your question" }',
        },
        randomFact: {
          description: 'Get a random music fact',
          endpoint: 'GET /api/v1/random-fact',
          optional: 'exclude=hash1,hash2 (comma-separated hashes to skip)',
        },
      },
      admin: {
        createKey: 'POST /api/auth/keys (requires X-Admin-Secret header)',
        cache: 'GET/DELETE /api/cache (premium tier only)',
      },
      other: {
        health: '/health',
      },
    },
  });
});

// Mount route groups
app.route('/v1', v1Routes);
app.route('/internal', internalRoutes);
app.route('/auth', authRoutes);
app.route('/cache', cacheRoutes);

export const apiRoutes = app;
