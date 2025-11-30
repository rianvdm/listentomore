// Main entry point for the Listen To More web application
// Built with Hono on Cloudflare Workers

import { Hono } from 'hono';
import { SITE_CONFIG } from '@listentomore/config';
import { Database, ParsedApiKey } from '@listentomore/db';
import { SpotifyService } from '@listentomore/spotify';
import { LastfmService } from '@listentomore/lastfm';
import { SonglinkService } from '@listentomore/songlink';
import { AIService } from '@listentomore/ai';
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
import { Layout } from './components/layout';
import { TrackCard } from './components/ui';
import { handleAlbumSearch } from './pages/album/search';
import { handleAlbumDetail } from './pages/album/detail';
import { handleArtistSearch } from './pages/artist/search';
import { handleArtistDetail } from './pages/artist/detail';
import { handleGenreDetail } from './pages/genre/detail';

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
  ADMIN_SECRET?: string;
};

// Context with services attached
type Variables = {
  db: Database;
  spotify: SpotifyService;
  lastfm: LastfmService;
  songlink: SonglinkService;
  ai: AIService;
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

  c.set(
    'ai',
    new AIService({
      openaiApiKey: c.env.OPENAI_API_KEY,
      perplexityApiKey: c.env.PERPLEXITY_API_KEY,
      cache: c.env.CACHE,
    })
  );

  await next();
});

// Apply auth middleware to API routes (validates API key if present)
app.use('/api/*', authMiddleware());

// Require authentication for all API routes except auth and internal endpoints
app.use('/api/*', async (c, next) => {
  // Skip auth requirement for key creation endpoint (uses admin secret instead)
  if (c.req.path === '/api/auth/keys') {
    return next();
  }
  // Skip auth for internal endpoints (used by page progressive loading)
  if (c.req.path.startsWith('/api/internal/')) {
    return next();
  }
  return requireAuth()(c, next);
});

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

// Home page - matches original my-music-next structure
app.get('/', async (c) => {
  const ai = c.get('ai');
  const db = c.get('db');

  // Get day greeting (e.g., "Happy Friday, friend!")
  const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date());

  // Random genre for exploration link
  const genres = ['rock', 'jazz', 'hip-hop', 'electronic', 'classical', 'indie', 'metal', 'soul', 'punk', 'folk'];
  const randomGenre = genres[Math.floor(Math.random() * genres.length)];
  const displayGenre = randomGenre.charAt(0).toUpperCase() + randomGenre.slice(1);

  // Fetch random fact (cached hourly) and recent searches in parallel
  const [randomFact, recentSearchesResult] = await Promise.all([
    ai.getRandomFact().catch(() => null),
    db.getRecentSearches(6).catch(() => []),
  ]);

  const recentSearches = recentSearchesResult.map(s => ({
    id: s.spotify_id,
    name: s.album_name,
    artist: s.artist_name,
    image: s.image_url || undefined,
  }));

  return c.html(
    <Layout title="Home" description="Discover music, explore albums, and track your listening habits">
      {/* Day Greeting */}
      <header>
        <h1>Happy {dayName}, friend!</h1>
      </header>

      <main>
        {/* Welcome Section */}
        <section id="lastfm-stats">
          <p>
            ✨ Welcome, music traveler. If you're looking for something new to listen to, you should{' '}
            <strong><a href="/recommendations">get rec'd</a></strong>.
            Or maybe explore the history and seminal albums of a random genre like{' '}
            <strong><a href={`/genre/${randomGenre}`}>{displayGenre}</a></strong>.
          </p>
          {randomFact?.fact && <p>🧠 {randomFact.fact}</p>}
        </section>

        {/* Album Search */}
        <h2 style={{ marginBottom: 0, marginTop: '2em' }}>💿 Learn more about an album</h2>
        <form id="search-form" action="/album" method="get">
          <input
            type="text"
            name="q"
            placeholder="Search for an album..."
            class="input"
            style={{ maxWidth: '300px' }}
          />
          <button type="submit" class="button">Search</button>
        </form>

        {/* Recent Community Searches */}
        <h2>👀 From the community</h2>
        <p style={{ textAlign: 'center' }}>
          <strong>
            Here are some albums that <a href="/about">Discord Bot</a> users recently shared with their friends.
          </strong>
        </p>

        {recentSearches.length > 0 ? (
          <div class="track-grid">
            {recentSearches.map((album) => (
              <TrackCard
                key={album.id}
                artist={album.artist}
                name={album.name}
                imageUrl={album.image}
                href={`/album/spotify:${album.id}`}
              />
            ))}
          </div>
        ) : (
          <p class="text-center text-muted">No recent searches yet.</p>
        )}
      </main>
    </Layout>
  );
});

// Album routes
app.get('/album', handleAlbumSearch);
app.get('/album/:id', handleAlbumDetail);

// Artist routes
app.get('/artist', handleArtistSearch);
app.get('/artist/:id', handleArtistDetail);

// Genre routes
app.get('/genre/:slug', handleGenreDetail);

// Internal API routes for progressive loading (no auth required)
// These are called by client-side JS on page load

app.get('/api/internal/songlink', async (c) => {
  const url = c.req.query('url');
  if (!url) {
    return c.json({ error: 'Missing url parameter' }, 400);
  }

  try {
    const songlink = c.get('songlink');
    const links = await songlink.getLinks(url);
    return c.json({ data: links });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Internal songlink error:', errorMessage, error);
    return c.json({ error: 'Failed to fetch streaming links', details: errorMessage }, 500);
  }
});

app.get('/api/internal/album-summary', async (c) => {
  const artist = c.req.query('artist');
  const album = c.req.query('album');

  if (!artist || !album) {
    return c.json({ error: 'Missing artist or album parameter' }, 400);
  }

  try {
    const ai = c.get('ai');
    const result = await ai.getAlbumDetail(artist, album);
    return c.json({ data: result });
  } catch (error) {
    console.error('Internal album summary error:', error);
    return c.json({ error: 'Failed to generate album summary' }, 500);
  }
});

app.get('/api/internal/artist-summary', async (c) => {
  const name = c.req.query('name');

  if (!name) {
    return c.json({ error: 'Missing name parameter' }, 400);
  }

  try {
    const ai = c.get('ai');
    const result = await ai.getArtistSummary(name);
    return c.json({ data: result });
  } catch (error) {
    console.error('Internal artist summary error:', error);
    return c.json({ error: 'Failed to generate artist summary' }, 500);
  }
});

app.get('/api/internal/artist-lastfm', async (c) => {
  const name = c.req.query('name');

  if (!name) {
    return c.json({ error: 'Missing name parameter' }, 400);
  }

  try {
    const lastfm = c.get('lastfm');
    const result = await lastfm.getArtistDetail(name);
    return c.json({ data: result });
  } catch (error) {
    console.error('Internal lastfm artist error:', error);
    return c.json({ error: 'Failed to fetch Last.fm data' }, 500);
  }
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
      ai: {
        artistSummary: '/api/ai/artist-summary?name=:artistName',
        albumDetail: '/api/ai/album-detail?artist=:artistName&album=:albumName',
        genreSummary: '/api/ai/genre-summary?genre=:genreName',
        artistSentence: '/api/ai/artist-sentence?name=:artistName',
        randomFact: '/api/ai/random-fact',
        listenAI: 'POST /api/ai/ask',
        playlistCover: {
          generatePrompt: 'POST /api/ai/playlist-cover/prompt',
          generateImage: 'POST /api/ai/playlist-cover/image',
        },
      },
    },
  });
});

// Admin endpoint to create API keys
// Always requires X-Admin-Secret header matching the ADMIN_SECRET env var
app.post('/api/auth/keys', async (c) => {
  const adminSecret = c.req.header('X-Admin-Secret');

  // Always require admin secret - no exceptions
  if (!c.env.ADMIN_SECRET || adminSecret !== c.env.ADMIN_SECRET) {
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

// AI API routes

// Artist summary (uses OpenAI)
app.get('/api/ai/artist-summary', async (c) => {
  const name = c.req.query('name');

  if (!name) {
    return c.json({ error: 'Missing name parameter' }, 400);
  }

  try {
    const ai = c.get('ai');
    const result = await ai.getArtistSummary(name);
    return c.json({ data: result });
  } catch (error) {
    console.error('AI artist summary error:', error);
    return c.json({ error: 'Failed to generate artist summary' }, 500);
  }
});

// Album detail (uses Perplexity with citations)
app.get('/api/ai/album-detail', async (c) => {
  const artist = c.req.query('artist');
  const album = c.req.query('album');

  if (!artist || !album) {
    return c.json({ error: 'Missing artist or album parameter' }, 400);
  }

  try {
    const ai = c.get('ai');
    const result = await ai.getAlbumDetail(artist, album);
    return c.json({ data: result });
  } catch (error) {
    console.error('AI album detail error:', error);
    return c.json({ error: 'Failed to generate album detail' }, 500);
  }
});

// Genre summary (uses Perplexity with citations)
app.get('/api/ai/genre-summary', async (c) => {
  const genre = c.req.query('genre');

  if (!genre) {
    return c.json({ error: 'Missing genre parameter' }, 400);
  }

  try {
    const ai = c.get('ai');
    const result = await ai.getGenreSummary(genre);
    return c.json({ data: result });
  } catch (error) {
    console.error('AI genre summary error:', error);
    return c.json({ error: 'Failed to generate genre summary' }, 500);
  }
});

// Artist sentence (short description, uses Perplexity)
app.get('/api/ai/artist-sentence', async (c) => {
  const name = c.req.query('name');

  if (!name) {
    return c.json({ error: 'Missing name parameter' }, 400);
  }

  try {
    const ai = c.get('ai');
    const result = await ai.getArtistSentence(name);
    return c.json({ data: result });
  } catch (error) {
    console.error('AI artist sentence error:', error);
    return c.json({ error: 'Failed to generate artist sentence' }, 500);
  }
});

// Random music fact (uses OpenAI)
app.get('/api/ai/random-fact', async (c) => {
  try {
    const ai = c.get('ai');
    const result = await ai.getRandomFact();
    return c.json({ data: result });
  } catch (error) {
    console.error('AI random fact error:', error);
    return c.json({ error: 'Failed to generate random fact' }, 500);
  }
});

// Rick Rubin AI chatbot (uses OpenAI)
app.post('/api/ai/ask', async (c) => {
  try {
    const body = await c.req.json<{ question: string }>();

    if (!body.question) {
      return c.json({ error: 'Missing question in request body' }, 400);
    }

    const ai = c.get('ai');
    const result = await ai.askListenAI(body.question);
    return c.json({ data: result });
  } catch (error) {
    console.error('AI ask error:', error);
    return c.json({ error: 'Failed to get AI response' }, 500);
  }
});

// Playlist cover prompt generator (uses OpenAI)
app.post('/api/ai/playlist-cover/prompt', async (c) => {
  try {
    const body = await c.req.json<{ name: string; description: string }>();

    if (!body.name || !body.description) {
      return c.json(
        { error: 'Missing name or description in request body' },
        400
      );
    }

    const ai = c.get('ai');
    const result = await ai.getPlaylistCoverPrompt(body.name, body.description);
    return c.json({ data: result });
  } catch (error) {
    console.error('AI playlist cover prompt error:', error);
    return c.json({ error: 'Failed to generate playlist cover prompt' }, 500);
  }
});

// Playlist cover image generator (uses DALL-E)
app.post('/api/ai/playlist-cover/image', async (c) => {
  try {
    const body = await c.req.json<{ prompt: string }>();

    if (!body.prompt) {
      return c.json({ error: 'Missing prompt in request body' }, 400);
    }

    const ai = c.get('ai');
    const result = await ai.getPlaylistCoverImage(body.prompt);
    return c.json({ data: result });
  } catch (error) {
    console.error('AI playlist cover image error:', error);
    return c.json({ error: 'Failed to generate playlist cover image' }, 500);
  }
});

// 404 handler
app.notFound((c) => {
  return c.html(
    <Layout title="Page Not Found">
      <div class="text-center" style={{ paddingTop: '4rem' }}>
        <h1 style={{ fontSize: '4rem', marginBottom: '0.5rem' }}>404</h1>
        <p>The page you're looking for doesn't exist.</p>
        <p class="mt-2">
          <a href="/" class="button">
            Go Home
          </a>
        </p>
      </div>
    </Layout>,
    404
  );
});

// Scheduled handler for CRON jobs
async function scheduled(
  event: ScheduledEvent,
  env: Bindings,
  ctx: ExecutionContext
): Promise<void> {
  console.log(`[CRON] Running scheduled task at ${new Date().toISOString()}`);

  // Initialize AI service for CRON
  const ai = new AIService({
    openaiApiKey: env.OPENAI_API_KEY,
    perplexityApiKey: env.PERPLEXITY_API_KEY,
    cache: env.CACHE,
  });

  // Generate and store a new random fact
  try {
    const result = await ai.generateAndStoreRandomFact();
    console.log(`[CRON] Generated new fact: ${result.fact.substring(0, 50)}...`);
  } catch (error) {
    console.error('[CRON] Failed to generate random fact:', error);
  }
}

export default {
  fetch: app.fetch,
  scheduled,
};
