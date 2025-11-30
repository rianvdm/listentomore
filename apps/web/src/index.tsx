// Main entry point for the Listen To More web application
// Built with Hono on Cloudflare Workers

import { Hono } from 'hono';
import { SITE_CONFIG, CACHE_CONFIG, getTtlSeconds } from '@listentomore/config';
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
import { handleAlbumSearch } from './pages/album/search';
import { handleAlbumDetail } from './pages/album/detail';
import { handleArtistSearch } from './pages/artist/search';
import { handleArtistDetail } from './pages/artist/detail';
import { handleGenreDetail } from './pages/genre/detail';
import { handleGenreSearch } from './pages/genre/search';
import { handleUserStats } from './pages/user/stats';
import { handleUserRecommendations } from './pages/user/recommendations';
import { handleStatsEntry, handleStatsLookup } from './pages/stats/entry';
import { PrivacyPage } from './pages/legal/privacy';
import { TermsPage } from './pages/legal/terms';
import { AboutPage } from './pages/about';
import { DiscordPage } from './pages/discord';

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
// Skip rate limiting for internal endpoints (used by page progressive loading)
app.use('/api/*', async (c, next) => {
  if (c.req.path.startsWith('/api/internal/')) {
    return next();
  }
  return userRateLimitMiddleware()(c, next);
});

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

  // Get day greeting (e.g., "Happy Friday, friend!") using user's timezone
  const userTimezone = (c.req.raw.cf as { timezone?: string } | undefined)?.timezone || 'UTC';
  const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: userTimezone }).format(new Date());

  // Fetch random fact (cached hourly)
  const randomFact = await ai.getRandomFact().catch(() => null);

  return c.html(
    <Layout title="Home" description="Discover music, explore albums, and track your listening habits">
      <header>
        <h1>Happy {dayName}, friend!</h1>
      </header>

      <main>
        {/* Welcome Section */}
        <section id="lastfm-stats">
          <p>
            {randomFact?.fact || ''}
          </p>
        </section>

        {/* Album Search */}
        <h2 style={{ marginBottom: 0, marginTop: '2em' }}>Learn more about an album</h2>
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

        {/* Recently Listened by Users - Progressive Loading */}
        <h2>What we're listening to</h2>
        <div id="user-listens-container">
          <div class="loading-container">
            <span class="spinner">↻</span>
            <span class="loading-text">Loading...</span>
          </div>
        </div>

        {/* Progressive loading script */}
        <script dangerouslySetInnerHTML={{
          __html: `
            (function() {
              fetch('/api/internal/user-listens')
                .then(function(res) { return res.json(); })
                .then(function(result) {
                  var container = document.getElementById('user-listens-container');
                  if (!container) return;

                  if (result.error || !result.data || result.data.length === 0) {
                    container.innerHTML = '<p class="text-center text-muted">No recent listens available.</p>';
                    return;
                  }

                  var html = '<div class="track-grid">';
                  result.data.forEach(function(listen) {
                    var subtitle = listen.nowPlaying
                      ? listen.username + ' is listening now'
                      : listen.username;
                    var albumName = listen.album || listen.track;
                    html += '<a href="/u/' + listen.username + '">';
                    html += '<div class="track">';
                    if (listen.image) {
                      html += '<img src="' + listen.image + '" alt="' + albumName + ' by ' + listen.artist + '" class="track-image" loading="lazy"/>';
                    }
                    html += '<div class="track-content">';
                    html += '<p class="track-artist">' + listen.artist + '</p>';
                    html += '<p class="track-name">' + albumName + '</p>';
                    html += '<p class="track-subtitle">' + subtitle + '</p>';
                    html += '</div></div></a>';
                  });
                  html += '</div>';
                  container.innerHTML = html;
                })
                .catch(function(err) {
                  console.error('Failed to load user listens:', err);
                  var container = document.getElementById('user-listens-container');
                  if (container) {
                    container.innerHTML = '<p class="text-center text-muted">Failed to load recent listens.</p>';
                  }
                });
            })();
          `
        }} />
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
app.get('/genre', handleGenreSearch);
app.get('/genre/:slug', handleGenreDetail);

// Stats routes
app.get('/stats', handleStatsEntry);
app.get('/stats/lookup', handleStatsLookup);

// User routes
app.get('/u/:username', handleUserStats);
app.get('/u/:username/recommendations', handleUserRecommendations);

// About, Discord, and legal pages
app.get('/about', (c) => c.html(<AboutPage />));
app.get('/discord', (c) => c.html(<DiscordPage />));
app.get('/privacy', (c) => c.html(<PrivacyPage />));
app.get('/terms', (c) => c.html(<TermsPage />));

// Internal API routes for progressive loading (no auth required)
// These are called by client-side JS on page load

// Prevent browser/edge caching of internal API responses
app.use('/api/internal/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate');
});

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

app.get('/api/internal/genre-summary', async (c) => {
  const name = c.req.query('name');

  if (!name) {
    return c.json({ error: 'Missing name parameter' }, 400);
  }

  try {
    const ai = c.get('ai');
    const result = await ai.getGenreSummary(name);
    return c.json({ data: result });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Internal genre summary error for "${name}":`, errorMessage);
    return c.json({ error: `Failed to generate genre summary: ${errorMessage}` }, 500);
  }
});

app.get('/api/internal/artist-lastfm', async (c) => {
  const name = c.req.query('name');

  if (!name) {
    return c.json({ error: 'Missing name parameter' }, 400);
  }

  try {
    const lastfm = c.get('lastfm');
    // Fetch artist detail and top albums in parallel
    const [artistDetail, topAlbums] = await Promise.all([
      lastfm.getArtistDetail(name),
      lastfm.getArtistTopAlbums(name, 3),
    ]);
    return c.json({
      data: {
        ...artistDetail,
        topAlbums: topAlbums.map((a) => a.name),
      },
    });
  } catch (error) {
    console.error('Internal lastfm artist error:', error);
    return c.json({ error: 'Failed to fetch Last.fm data' }, 500);
  }
});

app.get('/api/internal/artist-sentence', async (c) => {
  const name = c.req.query('name');

  if (!name) {
    return c.json({ error: 'Missing name parameter' }, 400);
  }

  try {
    const ai = c.get('ai');
    const result = await ai.getArtistSentence(name);
    return c.json({ data: result });
  } catch (error) {
    console.error('Internal artist sentence error:', error);
    return c.json({ error: 'Failed to generate artist sentence' }, 500);
  }
});

app.get('/api/internal/search', async (c) => {
  const query = c.req.query('q');
  const type = c.req.query('type') as 'album' | 'artist';

  if (!query || !type) {
    return c.json({ error: 'Missing q or type parameter' }, 400);
  }

  try {
    const spotify = c.get('spotify');
    const results = await spotify.search.search(query, type, 6);
    return c.json({ data: results });
  } catch (error) {
    console.error('Internal search error:', error);
    return c.json({ error: 'Search failed' }, 500);
  }
});

app.get('/api/internal/user-recommendations', async (c) => {
  const username = c.req.query('username');

  if (!username) {
    return c.json({ error: 'Missing username parameter' }, 400);
  }

  const CACHE_KEY = `user-recommendations:${username}`;
  const CACHE_TTL_SECONDS = getTtlSeconds(CACHE_CONFIG.lastfm.userRecommendations);
  const MAX_RESULTS = 6;

  try {
    // Check KV cache first
    const cached = await c.env.CACHE.get(CACHE_KEY);
    if (cached) {
      const data = JSON.parse(cached);
      return c.json({ data: data.slice(0, MAX_RESULTS), cached: true });
    }

    // Cache miss - look up user and fetch recommendations
    const db = c.get('db');
    const user = await db.getUserByUsername(username);

    if (!user || !user.lastfm_username) {
      return c.json({ error: 'User not found' }, 404);
    }

    // Create LastfmService for this user
    const userLastfm = new LastfmService({
      apiKey: c.env.LASTFM_API_KEY,
      username: user.lastfm_username,
    });

    // Get user's top artists
    const topArtists = await userLastfm.getTopArtists('7day', 5);

    if (topArtists.length === 0) {
      return c.json({ data: [], message: 'No listening data available' });
    }

    // Use Last.fm similar artists (Spotify deprecated their related-artists endpoint Nov 2024)
    const spotify = c.get('spotify');
    const recommendedArtists: Array<{
      id: string | null;
      name: string;
      image: string | null;
      basedOn: string;
    }> = [];
    const seenArtistNames = new Set<string>();
    const topArtistNames = new Set(topArtists.map((a) => a.name.toLowerCase()));

    // Fetch similar artists from Last.fm for each top artist
    for (const topArtist of topArtists) {
      try {
        const artistDetail = await userLastfm.getArtistDetail(topArtist.name);

        for (const similarName of artistDetail.similar) {
          const normalizedName = similarName.toLowerCase();
          // Skip if already seen or if it's one of the user's top artists
          if (seenArtistNames.has(normalizedName)) continue;
          if (topArtistNames.has(normalizedName)) continue;

          seenArtistNames.add(normalizedName);
          recommendedArtists.push({
            id: null, // Will be enriched with Spotify data
            name: similarName,
            image: null,
            basedOn: topArtist.name,
          });
        }
      } catch (error) {
        console.error(`Error fetching similar artists for ${topArtist.name}:`, error);
      }
    }

    // Enrich with Spotify images (in parallel, limited batch)
    const enrichedArtists = await Promise.all(
      recommendedArtists.slice(0, MAX_RESULTS).map(async (artist) => {
        try {
          const searchResults = await spotify.search.search(artist.name, 'artist', 1);
          if (searchResults.length > 0) {
            return {
              ...artist,
              id: searchResults[0].id,
              image: searchResults[0].image,
            };
          }
        } catch (error) {
          console.error(`Error enriching artist ${artist.name}:`, error);
        }
        return artist;
      })
    );

    // Only cache if we have actual recommendations
    if (enrichedArtists.length > 0) {
      await c.env.CACHE.put(CACHE_KEY, JSON.stringify(enrichedArtists), {
        expirationTtl: CACHE_TTL_SECONDS,
      });
    }

    return c.json({ data: enrichedArtists, cached: false });
  } catch (error) {
    console.error('Internal user-recommendations error:', error);
    return c.json({ error: 'Failed to fetch recommendations' }, 500);
  }
});

app.get('/api/internal/user-listens', async (c) => {
  const CACHE_KEY = 'user-listens:recent';
  const CACHE_TTL_SECONDS = getTtlSeconds(CACHE_CONFIG.lastfm.userListens);
  const MAX_RESULTS = 6;

  try {
    // Check KV cache first
    const cached = await c.env.CACHE.get(CACHE_KEY);
    if (cached) {
      const data = JSON.parse(cached);
      return c.json({ data: data.slice(0, MAX_RESULTS), cached: true });
    }

    // Cache miss - fetch from all users
    const db = c.get('db');
    const users = await db.getAllUsersWithLastfm();

    // Fetch most recent track for each user in parallel
    const userTracks = await Promise.all(
      users.map(async (user) => {
        if (!user.lastfm_username) return null;
        try {
          const userLastfm = new LastfmService({
            apiKey: c.env.LASTFM_API_KEY,
            username: user.lastfm_username,
          });
          const track = await userLastfm.getMostRecentTrack();
          if (track) {
            return {
              username: user.username || user.lastfm_username,
              artist: track.artist,
              album: track.album,
              track: track.name,
              image: track.image,
              playedAt: track.playedAt,
              nowPlaying: track.nowPlaying,
            };
          }
        } catch (error) {
          console.error(`Failed to fetch recent track for ${user.lastfm_username}:`, error);
        }
        return null;
      })
    );

    // Filter out nulls and sort by recency (now playing first, then by playedAt)
    const validTracks = userTracks.filter((t): t is NonNullable<typeof t> => t !== null);
    validTracks.sort((a, b) => {
      if (a.nowPlaying && !b.nowPlaying) return -1;
      if (!a.nowPlaying && b.nowPlaying) return 1;
      if (!a.playedAt && !b.playedAt) return 0;
      if (!a.playedAt) return 1;
      if (!b.playedAt) return -1;
      return new Date(b.playedAt).getTime() - new Date(a.playedAt).getTime();
    });

    // Cache the full sorted list (we may want more than 6 later)
    await c.env.CACHE.put(CACHE_KEY, JSON.stringify(validTracks), {
      expirationTtl: CACHE_TTL_SECONDS,
    });

    return c.json({ data: validTracks.slice(0, MAX_RESULTS), cached: false });
  } catch (error) {
    console.error('Internal user-listens error:', error);
    return c.json({ error: 'Failed to fetch user listens' }, 500);
  }
});

// Helper to get LastfmService for a user
async function getUserLastfm(c: Context, username: string) {
  const db = c.get('db');
  const user = await db.getUserByUsername(username);

  if (!user || !user.lastfm_username) {
    return null;
  }

  return new LastfmService({
    apiKey: c.env.LASTFM_API_KEY,
    username: user.lastfm_username,
    cache: c.env.CACHE,
  });
}

app.get('/api/internal/user-recent-track', async (c) => {
  const username = c.req.query('username');
  if (!username) {
    return c.json({ error: 'Missing username parameter' }, 400);
  }

  try {
    const userLastfm = await getUserLastfm(c, username);
    if (!userLastfm) {
      return c.json({ error: 'User not found' }, 404);
    }

    const recentTracks = await userLastfm.recentTracks.getRecentTracks(1).catch(() => []);
    return c.json({ data: recentTracks[0] || null });
  } catch (error) {
    console.error('Internal user-recent-track error:', error);
    return c.json({ error: 'Failed to fetch recent track' }, 500);
  }
});

app.get('/api/internal/user-top-artists', async (c) => {
  const username = c.req.query('username');
  if (!username) {
    return c.json({ error: 'Missing username parameter' }, 400);
  }

  try {
    const userLastfm = await getUserLastfm(c, username);
    if (!userLastfm) {
      return c.json({ error: 'User not found' }, 404);
    }

    const topArtists = await userLastfm.getTopArtists('7day', 6).catch(() => []);
    return c.json({ data: topArtists });
  } catch (error) {
    console.error('Internal user-top-artists error:', error);
    return c.json({ error: 'Failed to fetch top artists' }, 500);
  }
});

app.get('/api/internal/user-top-albums', async (c) => {
  const username = c.req.query('username');
  if (!username) {
    return c.json({ error: 'Missing username parameter' }, 400);
  }

  try {
    const userLastfm = await getUserLastfm(c, username);
    if (!userLastfm) {
      return c.json({ error: 'User not found' }, 404);
    }

    const topAlbums = await userLastfm.getTopAlbums('1month', 6).catch(() => []);
    return c.json({ data: topAlbums });
  } catch (error) {
    console.error('Internal user-top-albums error:', error);
    return c.json({ error: 'Failed to fetch top albums' }, 500);
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

// Artist summary (uses Perplexity)
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
  _event: ScheduledEvent,
  env: Bindings,
  _ctx: ExecutionContext
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
