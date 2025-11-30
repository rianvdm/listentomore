// Main entry point for the Listen To More web application
// Built with Hono on Cloudflare Workers

import { Hono } from 'hono';
import { SITE_CONFIG } from '@listentomore/config';
import { Database, ParsedApiKey } from '@listentomore/db';
import { SpotifyService } from '@listentomore/spotify';
import { LastfmService } from '@listentomore/lastfm';
import { SonglinkService } from '@listentomore/songlink';
import {
  corsMiddleware,
  originValidationMiddleware,
  securityHeadersMiddleware,
} from './middleware/security';
import {
  authMiddleware,
  requireAuth,
  userRateLimitMiddleware,
  apiLoggingMiddleware,
} from './middleware/auth';

// Define environment bindings
type Bindings = {
  // D1 Database
  DB: D1Database;
  // KV Namespaces
  CACHE: KVNamespace;
  // Environment variables
  SPOTIFY_CLIENT_ID: string;
  SPOTIFY_CLIENT_SECRET: string;
  SPOTIFY_REFRESH_TOKEN: string;
  LASTFM_API_KEY: string;
  LASTFM_USERNAME: string;
  OPENAI_API_KEY: string;
  PERPLEXITY_API_KEY: string;
  ENVIRONMENT?: string;
};

// Context with services attached
type Variables = {
  db: Database;
  spotify: SpotifyService;
  lastfm: LastfmService;
  songlink: SonglinkService;
  // Auth context
  apiKey: ParsedApiKey | null;
  authTier: 'public' | 'standard' | 'premium';
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Apply security headers to all responses
app.use('*', securityHeadersMiddleware());

// Apply CORS middleware (needs to run before other middleware)
app.use('*', async (c, next) => {
  const middleware = corsMiddleware({ ENVIRONMENT: c.env.ENVIRONMENT });
  return middleware(c, next);
});

// Apply origin validation to API routes (in production)
app.use('/api/*', async (c, next) => {
  const middleware = originValidationMiddleware({ ENVIRONMENT: c.env.ENVIRONMENT });
  return middleware(c, next);
});

// Middleware to initialize services (must run before auth middleware)
app.use('*', async (c, next) => {
  // Initialize database first (needed by auth middleware)
  c.set('db', new Database(c.env.DB));

  c.set(
    'spotify',
    new SpotifyService({
      clientId: c.env.SPOTIFY_CLIENT_ID,
      clientSecret: c.env.SPOTIFY_CLIENT_SECRET,
      refreshToken: c.env.SPOTIFY_REFRESH_TOKEN,
      cache: c.env.CACHE,
    })
  );

  c.set(
    'lastfm',
    new LastfmService({
      apiKey: c.env.LASTFM_API_KEY,
      username: c.env.LASTFM_USERNAME,
    })
  );

  c.set('songlink', new SonglinkService(c.env.CACHE));

  await next();
});

// Apply auth middleware to API routes (validates API key if present)
app.use('/api/*', authMiddleware());

// Apply user-based rate limiting to API routes (after auth, so we know the tier)
app.use('/api/*', userRateLimitMiddleware());

// Apply API usage logging (after all other middleware)
app.use('/api/*', apiLoggingMiddleware());

// Health check endpoint
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    name: SITE_CONFIG.name,
    timestamp: new Date().toISOString(),
  });
});

// Home page
app.get('/', (c) => {
  return c.html(
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{SITE_CONFIG.name}</title>
        <meta name="description" content={SITE_CONFIG.description} />
        <style>{`
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #fafafa;
            color: #1a1a1a;
            line-height: 1.6;
            padding: 2rem;
            max-width: 800px;
            margin: 0 auto;
          }
          h1 { color: #ff6c00; margin-bottom: 1rem; }
          p { margin-bottom: 1rem; }
          .status {
            background: #e8f5e9;
            padding: 1rem;
            border-radius: 8px;
            border-left: 4px solid #4caf50;
          }
          code {
            background: #f5f5f5;
            padding: 0.2rem 0.4rem;
            border-radius: 4px;
            font-size: 0.9em;
          }
        `}</style>
      </head>
      <body>
        <h1>{SITE_CONFIG.name}</h1>
        <p>{SITE_CONFIG.description}</p>

        <div class="status">
          <p><strong>Status:</strong> Phase 2 Complete</p>
          <p>Database and core services implemented. API endpoints ready for testing.</p>
        </div>

        <h2 style="margin-top: 2rem; margin-bottom: 1rem;">Services</h2>
        <ul style="margin-left: 1.5rem;">
          <li><code>@listentomore/db</code> - D1 database with migrations</li>
          <li><code>@listentomore/spotify</code> - Spotify API integration</li>
          <li><code>@listentomore/lastfm</code> - Last.fm API integration</li>
          <li><code>@listentomore/songlink</code> - Streaming link aggregation</li>
        </ul>

        <h2 style="margin-top: 2rem; margin-bottom: 1rem;">API Endpoints</h2>
        <ul style="margin-left: 1.5rem;">
          <li><a href="/api">/api</a> - API overview</li>
          <li><a href="/api/lastfm/recent">/api/lastfm/recent</a> - Recent tracks</li>
          <li><a href="/api/lastfm/top-albums">/api/lastfm/top-albums</a> - Top albums</li>
          <li><a href="/api/lastfm/top-artists">/api/lastfm/top-artists</a> - Top artists</li>
        </ul>
      </body>
    </html>
  );
});

// API routes overview
app.get('/api', (c) => {
  const apiKey = c.get('apiKey');
  return c.json({
    message: 'Listen To More API',
    version: '0.0.1',
    auth: {
      authenticated: !!apiKey,
      tier: apiKey?.tier ?? 'public',
      hint: 'Include X-API-Key header for authenticated access with higher rate limits',
    },
    rateLimits: {
      public: '10 req/min',
      standard: '60 req/min',
      premium: '300 req/min',
    },
    endpoints: {
      health: '/health',
      auth: {
        createKey: 'POST /api/auth/keys (requires admin)',
      },
      spotify: {
        search: '/api/spotify/search?q=:query&type=:type',
        album: '/api/spotify/album/:id',
        artist: '/api/spotify/artist/:id',
      },
      lastfm: {
        recentTracks: '/api/lastfm/recent',
        topAlbums: '/api/lastfm/top-albums',
        topArtists: '/api/lastfm/top-artists',
        lovedTracks: '/api/lastfm/loved',
      },
      songlink: '/api/songlink?url=:streamingUrl',
    },
  });
});

// Admin endpoint to create API keys
// In production, this should be protected by admin authentication
app.post('/api/auth/keys', async (c) => {
  // For now, only allow in development or with a special admin secret
  const adminSecret = c.req.header('X-Admin-Secret');
  const isDevEnv = c.env.ENVIRONMENT !== 'production';

  if (!isDevEnv && adminSecret !== 'your-admin-secret-here') {
    return c.json({ error: 'Unauthorized', message: 'Admin access required' }, 401);
  }

  try {
    const body = await c.req.json<{
      name?: string;
      tier?: 'standard' | 'premium';
      scopes?: ('read' | 'write' | 'ai')[];
    }>();

    const db = c.get('db');
    const result = await db.createApiKey({
      name: body.name,
      tier: body.tier || 'standard',
      scopes: body.scopes || ['read'],
    });

    return c.json({
      message: 'API key created successfully',
      key: result.key, // Only returned once!
      keyPrefix: result.record.key_prefix,
      tier: result.record.tier,
      scopes: result.record.scopes,
      warning: 'Save this key - it will not be shown again!',
    });
  } catch (error) {
    console.error('Failed to create API key:', error);
    return c.json({ error: 'Failed to create API key' }, 500);
  }
});

// Spotify API routes
app.get('/api/spotify/search', async (c) => {
  const query = c.req.query('q');
  const type = c.req.query('type') as 'track' | 'album' | 'artist';

  if (!query || !type) {
    return c.json({ error: 'Missing q or type parameter' }, 400);
  }

  try {
    const spotify = c.get('spotify');
    const results = await spotify.search.search(query, type, 5);
    return c.json({ data: results });
  } catch (error) {
    console.error('Spotify search error:', error);
    return c.json({ error: 'Search failed' }, 500);
  }
});

app.get('/api/spotify/album/:id', async (c) => {
  const id = c.req.param('id');

  try {
    const spotify = c.get('spotify');
    const album = await spotify.getAlbum(id);
    return c.json({ data: album });
  } catch (error) {
    console.error('Spotify album error:', error);
    return c.json({ error: 'Album lookup failed' }, 500);
  }
});

app.get('/api/spotify/artist/:id', async (c) => {
  const id = c.req.param('id');

  try {
    const spotify = c.get('spotify');
    const artist = await spotify.getArtist(id);
    return c.json({ data: artist });
  } catch (error) {
    console.error('Spotify artist error:', error);
    return c.json({ error: 'Artist lookup failed' }, 500);
  }
});

// Last.fm API routes
app.get('/api/lastfm/recent', async (c) => {
  try {
    const lastfm = c.get('lastfm');
    const tracks = await lastfm.recentTracks.getRecentTracks(10);
    return c.json({ data: tracks });
  } catch (error) {
    console.error('Last.fm recent tracks error:', error);
    return c.json({ error: 'Failed to fetch recent tracks' }, 500);
  }
});

app.get('/api/lastfm/top-albums', async (c) => {
  try {
    const lastfm = c.get('lastfm');
    const period = (c.req.query('period') as '7day' | '1month' | '3month' | '6month' | '12month' | 'overall') || '1month';
    const albums = await lastfm.getTopAlbums(period, 6);
    return c.json({ data: albums });
  } catch (error) {
    console.error('Last.fm top albums error:', error);
    return c.json({ error: 'Failed to fetch top albums' }, 500);
  }
});

app.get('/api/lastfm/top-artists', async (c) => {
  try {
    const lastfm = c.get('lastfm');
    const period = (c.req.query('period') as '7day' | '1month' | '3month' | '6month' | '12month' | 'overall') || '7day';
    const artists = await lastfm.getTopArtists(period, 6);
    return c.json({ data: artists });
  } catch (error) {
    console.error('Last.fm top artists error:', error);
    return c.json({ error: 'Failed to fetch top artists' }, 500);
  }
});

app.get('/api/lastfm/loved', async (c) => {
  try {
    const lastfm = c.get('lastfm');
    const tracks = await lastfm.getLovedTracks(10);
    return c.json({ data: tracks });
  } catch (error) {
    console.error('Last.fm loved tracks error:', error);
    return c.json({ error: 'Failed to fetch loved tracks' }, 500);
  }
});

// Songlink API route
app.get('/api/songlink', async (c) => {
  const url = c.req.query('url');

  if (!url) {
    return c.json({ error: 'Missing url parameter' }, 400);
  }

  try {
    const songlink = c.get('songlink');
    const links = await songlink.getLinks(url);
    return c.json({ data: links });
  } catch (error) {
    console.error('Songlink error:', error);
    return c.json({ error: 'Failed to fetch streaming links' }, 500);
  }
});

// 404 handler
app.notFound((c) => {
  return c.html(
    <html lang="en">
      <head>
        <title>404 - {SITE_CONFIG.name}</title>
        <style>{`
          body {
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            background: #fafafa;
          }
          .container { text-align: center; }
          h1 { color: #ff6c00; font-size: 4rem; margin-bottom: 0.5rem; }
          a { color: #ff6c00; }
        `}</style>
      </head>
      <body>
        <div class="container">
          <h1>404</h1>
          <p>Page not found</p>
          <p><a href="/">Go home</a></p>
        </div>
      </body>
    </html>,
    404
  );
});

export default app;
