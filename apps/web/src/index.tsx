// Main entry point for the Listen To More web application
// Built with Hono on Cloudflare Workers

import { Hono, Context } from 'hono';
import { SITE_CONFIG, CACHE_CONFIG, getTtlSeconds } from '@listentomore/config';
import { Database, ParsedApiKey } from '@listentomore/db';
import { SpotifyService } from '@listentomore/spotify';
import { LastfmService } from '@listentomore/lastfm';
import { SonglinkService } from '@listentomore/songlink';
import { StreamingLinksService } from '@listentomore/streaming-links';
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
import { internalAuthMiddleware } from './middleware/internal-auth';
import { generateInternalToken } from './utils/internal-token';
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
import { enrichLinksScript } from './utils/client-scripts';

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
  // Secondary Spotify app for streaming-links (rate limit isolation)
  SPOTIFY_STREAMING_CLIENT_ID?: string;
  SPOTIFY_STREAMING_CLIENT_SECRET?: string;
  SPOTIFY_STREAMING_REFRESH_TOKEN?: string;
  LASTFM_API_KEY: string;
  LASTFM_USERNAME: string;
  OPENAI_API_KEY: string;
  PERPLEXITY_API_KEY: string;
  YOUTUBE_API_KEY?: string;
  APPLE_TEAM_ID?: string;
  APPLE_KEY_ID?: string;
  APPLE_PRIVATE_KEY?: string;
  INTERNAL_API_SECRET: string;
  ENVIRONMENT?: string;
  ADMIN_SECRET?: string;
};

// Context with services attached
type Variables = {
  db: Database;
  spotify: SpotifyService;
  spotifyStreaming: SpotifyService; // Secondary app for streaming-links (rate limit isolation)
  lastfm: LastfmService;
  songlink: SonglinkService;
  streamingLinks: StreamingLinksService;
  ai: AIService;
  // Auth context
  apiKey: ParsedApiKey | null;
  authTier: 'public' | 'standard' | 'premium';
  // Internal API token (for progressive loading)
  internalToken: string;
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

  // Primary Spotify service (album/artist pages, search)
  const spotify = new SpotifyService({
    clientId: c.env.SPOTIFY_CLIENT_ID,
    clientSecret: c.env.SPOTIFY_CLIENT_SECRET,
    refreshToken: c.env.SPOTIFY_REFRESH_TOKEN,
    cache: c.env.CACHE,
  });
  c.set('spotify', spotify);

  // Secondary Spotify service for streaming-links (rate limit isolation)
  // Falls back to primary if secondary credentials not configured
  const spotifyStreaming = c.env.SPOTIFY_STREAMING_CLIENT_ID
    ? new SpotifyService({
        clientId: c.env.SPOTIFY_STREAMING_CLIENT_ID!,
        clientSecret: c.env.SPOTIFY_STREAMING_CLIENT_SECRET!,
        refreshToken: c.env.SPOTIFY_STREAMING_REFRESH_TOKEN!,
        cache: c.env.CACHE,
      })
    : spotify;
  c.set('spotifyStreaming', spotifyStreaming);

  c.set(
    'lastfm',
    new LastfmService({
      apiKey: c.env.LASTFM_API_KEY,
      username: c.env.LASTFM_USERNAME,
      cache: c.env.CACHE,
    })
  );

  c.set('songlink', new SonglinkService(c.env.CACHE));

  c.set(
    'streamingLinks',
    new StreamingLinksService(c.env.CACHE, {
      youtubeApiKey: c.env.YOUTUBE_API_KEY,
      appleMusic:
        c.env.APPLE_TEAM_ID && c.env.APPLE_KEY_ID && c.env.APPLE_PRIVATE_KEY
          ? {
              teamId: c.env.APPLE_TEAM_ID,
              keyId: c.env.APPLE_KEY_ID,
              privateKey: c.env.APPLE_PRIVATE_KEY,
            }
          : undefined,
    })
  );

  c.set(
    'ai',
    new AIService({
      openaiApiKey: c.env.OPENAI_API_KEY,
      perplexityApiKey: c.env.PERPLEXITY_API_KEY,
      cache: c.env.CACHE,
    })
  );

  // Generate internal API token for this request (used by progressive loading)
  const internalToken = await generateInternalToken(c.env.INTERNAL_API_SECRET);
  c.set('internalToken', internalToken);

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
  // Skip auth for internal endpoints (they use signed token auth instead)
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

// robots.txt - throttle crawlers to prevent Spotify API rate limits
app.get('/robots.txt', (c) => {
  const robotsTxt = `# ListenToMore robots.txt
User-agent: *
Allow: /
Disallow: /api/
Disallow: /api/internal/

# Crawl delay to prevent overwhelming external APIs
Crawl-delay: 10

# Specific bot configurations
User-agent: Googlebot
Crawl-delay: 5

User-agent: Bingbot
Crawl-delay: 5

User-agent: GPTBot
Disallow: /

User-agent: ChatGPT-User
Disallow: /

User-agent: CCBot
Disallow: /

User-agent: anthropic-ai
Disallow: /

User-agent: Claude-Web
Disallow: /

# Sitemap
Sitemap: https://listentomore.com/sitemap.xml
`;
  return c.text(robotsTxt, 200, {
    'Content-Type': 'text/plain',
    'Cache-Control': 'public, max-age=86400',
  });
});

// Home page - matches original my-music-next structure
app.get('/', async (c) => {
  const ai = c.get('ai');
  const internalToken = c.get('internalToken');

  // Get day greeting (e.g., "Happy Friday, friend!") using user's timezone
  const userTimezone = (c.req.raw.cf as { timezone?: string } | undefined)?.timezone || 'UTC';
  const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: userTimezone }).format(new Date());

  // Fetch random fact (cached hourly)
  const randomFact = await ai.getRandomFact().catch(() => null);

  return c.html(
    <Layout title="Home" description="Discover music, explore albums, and track your listening habits" internalToken={internalToken}>
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
        <p id="user-listens-updated" class="text-muted text-center" style={{ marginTop: '-0.5em', marginBottom: '1em' }}>Loading...</p>
        <div id="user-listens-container">
          <div class="loading-container">
            <span class="spinner">↻</span>
            <span class="loading-text">Loading...</span>
          </div>
        </div>

        {/* Progressive loading script */}
        <script dangerouslySetInnerHTML={{
          __html: `
            ${enrichLinksScript}

            (function() {
              var MAX_ITEMS = 8;

              internalFetch('/api/internal/user-listens')
                .then(function(res) { return res.json(); })
                .then(function(result) {
                  var container = document.getElementById('user-listens-container');
                  if (!container) return;

                  if (result.error || !result.data || result.data.length === 0) {
                    container.innerHTML = '<p class="text-center text-muted">No recent listens available.</p>';
                    document.getElementById('user-listens-updated').textContent = '';
                    return;
                  }

                  // Update "last updated" text in user's local timezone
                  var updatedEl = document.getElementById('user-listens-updated');
                  if (updatedEl && result.lastUpdated) {
                    var date = new Date(result.lastUpdated);
                    var timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                    updatedEl.textContent = 'Last updated ' + timeStr;
                  } else if (updatedEl) {
                    updatedEl.textContent = '';
                  }

                  // Limit to MAX_ITEMS
                  var listens = result.data.slice(0, MAX_ITEMS);

                  // Build list HTML
                  var html = '<div class="track-list" id="user-listens-list">';
                  listens.forEach(function(listen, index) {
                    var albumName = listen.album || listen.track;
                    var nowPlayingBadge = listen.nowPlaying ? ' <span style="color: var(--accent-color);">▶ Now</span>' : '';

                    html += '<div class="track-item" data-index="' + index + '">';
                    html += '<div class="track-item-image" id="listen-image-' + index + '">';
                    html += '<a href="/album?q=' + encodeURIComponent(listen.artist + ' ' + albumName) + '">';
                    if (listen.image) {
                      html += '<img src="' + listen.image + '" alt="' + albumName + ' by ' + listen.artist + '" loading="lazy" onerror="this.onerror=null;this.src=\\'https://file.elezea.com/noun-no-image.png\\'"/>';
                    } else {
                      html += '<div class="placeholder-image"><span class="spinner">↻</span></div>';
                    }
                    html += '</a></div>';
                    html += '<div class="track-item-content">';
                    html += '<p><strong><a href="/album?q=' + encodeURIComponent(listen.artist + ' ' + albumName) + '">' + albumName + '</a></strong>' + nowPlayingBadge + '</p>';
                    html += '<p><a href="/artist?q=' + encodeURIComponent(listen.artist) + '">' + listen.artist + '</a></p>';
                    html += '<p id="listen-sentence-' + index + '" class="text-muted"><span class="loading-inline">Loading...</span></p>';
                    html += '<p id="listen-links-' + index + '"><a href="/u/' + listen.username + '">' + listen.username + "'s page →</a></p>";
                    html += '</div></div>';
                  });
                  html += '</div>';
                  container.innerHTML = html;

                  // Enrich album and artist links with Spotify IDs
                  enrichLinks('user-listens-list');

                  // Progressive loading: fetch artist sentences and streaming links
                  listens.forEach(function(listen, index) {
                    // Fetch artist sentence
                    internalFetch('/api/internal/artist-sentence?name=' + encodeURIComponent(listen.artist))
                      .then(function(r) { return r.json(); })
                      .then(function(data) {
                        var el = document.getElementById('listen-sentence-' + index);
                        if (el && data.data && data.data.sentence) {
                          el.innerHTML = data.data.sentence;
                          el.className = 'text-muted';
                        } else if (el) {
                          el.innerHTML = '';
                        }
                      })
                      .catch(function() {
                        var el = document.getElementById('listen-sentence-' + index);
                        if (el) el.innerHTML = '';
                      });

                    // Fetch streaming links (using precise field-filter search)
                    if (listen.album && listen.artist) {
                      internalFetch('/api/internal/search-album-by-artist?artist=' + encodeURIComponent(listen.artist) + '&album=' + encodeURIComponent(listen.album))
                        .then(function(r) { return r.json(); })
                        .then(function(data) {
                          if (data.data && data.data[0] && data.data[0].id) {
                            var albumId = data.data[0].id;
                            var spotifyUrl = data.data[0].url;
                            internalFetch('/api/internal/streaming-links?spotifyId=' + encodeURIComponent(albumId) + '&type=album')
                              .then(function(r) { return r.json(); })
                              .then(function(linkData) {
                                var linksEl = document.getElementById('listen-links-' + index);
                                if (linksEl) {
                                  var existingContent = linksEl.innerHTML;
                                  // Build separate Spotify and Apple Music links
                                  var links = '<a href="' + spotifyUrl + '" target="_blank" rel="noopener noreferrer">Spotify ↗</a>';
                                  if (linkData.data && linkData.data.appleUrl) {
                                    links += ' • <a href="' + linkData.data.appleUrl + '" target="_blank" rel="noopener noreferrer">Apple Music ↗</a>';
                                  }
                                  linksEl.innerHTML = links + ' • ' + existingContent;
                                }
                              })
                              .catch(function() {
                                // Fall back to Spotify URL only
                                var linksEl = document.getElementById('listen-links-' + index);
                                if (linksEl) {
                                  var existingContent = linksEl.innerHTML;
                                  linksEl.innerHTML = '<a href="' + spotifyUrl + '" target="_blank" rel="noopener noreferrer">Spotify ↗</a> • ' + existingContent;
                                }
                              });
                          }
                        })
                        .catch(function(err) {
                          console.error('Error fetching Spotify data:', err);
                        });
                    }
                  });
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

// Widget endpoint for external sites (public, no auth required)
// Replicates the api-lastfm-recenttracks worker functionality for elezea.com
app.get('/widget/recent', async (c) => {
  const format = c.req.query('format');
  const username = c.req.query('username') || 'bordesak';

  try {
    const lastfm = new LastfmService({
      apiKey: c.env.LASTFM_API_KEY,
      username,
    });

    const track = await lastfm.getMostRecentTrack();

    if (!track) {
      if (format === 'html') {
        return new Response('🎵 No recent tracks found.', {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      return c.json({ error: 'No recent tracks found' }, 404);
    }

    if (format === 'html') {
      const html = `🎵 Most recently I listened to <strong>${track.album || track.name}</strong> by <strong>${track.artist}</strong>. <a href="https://listentomore.com/u/${username}" target="_blank">See more ↗</a>`;
      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    return c.json({
      last_artist: track.artist,
      last_album: track.album,
    });
  } catch (error) {
    console.error('Widget recent error:', error);
    if (format === 'html') {
      return new Response('🎵 Unable to load music info.', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    return c.json({ error: 'Failed to fetch recent track' }, 500);
  }
});

// Internal API routes for progressive loading
// These are called by client-side JS on page load with signed tokens

// Apply internal auth middleware (validates signed token)
app.use('/api/internal/*', internalAuthMiddleware());

// Prevent browser/edge caching of internal API responses
app.use('/api/internal/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate');
});

// Streaming links endpoint using our own providers (Apple Music + YouTube)
app.get('/api/internal/streaming-links', async (c) => {
  const spotifyId = c.req.query('spotifyId');
  const type = c.req.query('type') as 'track' | 'album' | undefined;

  if (!spotifyId) {
    return c.json({ error: 'Missing spotifyId parameter' }, 400);
  }
  if (!type || (type !== 'track' && type !== 'album')) {
    return c.json({ error: 'Invalid type parameter, must be "track" or "album"' }, 400);
  }

  try {
    // Use secondary Spotify app for streaming-links (rate limit isolation)
    const spotify = c.get('spotifyStreaming');
    const streamingLinks = c.get('streamingLinks');

    if (type === 'album') {
      const album = await spotify.getAlbum(spotifyId);
      const metadata = StreamingLinksService.albumMetadataFromSpotify({
        id: album.id,
        name: album.name,
        artists: album.artistIds.map((_, i) => ({ name: album.artist.split(', ')[i] || album.artist })),
        total_tracks: album.tracks,
        release_date: album.releaseDate,
        external_ids: album.upc ? { upc: album.upc } : undefined,
      });

      const links = await streamingLinks.getAlbumLinks(metadata);

      // Return in legacy songlink format for backward compatibility
      return c.json({
        data: {
          pageUrl: '',
          appleUrl: links.appleMusic?.url || null,
          youtubeUrl: links.youtube?.url || null,
          deezerUrl: null,
          spotifyUrl: album.url,
          tidalUrl: null,
          artistName: album.artist,
          title: album.name,
          thumbnailUrl: album.image,
          type: 'album',
        },
      });
    } else {
      // For tracks, we'd need to fetch track data from Spotify
      // For now, return an error - tracks can be added later
      return c.json({ error: 'Track streaming links not yet implemented' }, 501);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Internal streaming-links error:', errorMessage, error);
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

app.get('/api/internal/album-recommendations', async (c) => {
  const artist = c.req.query('artist');
  const album = c.req.query('album');

  if (!artist || !album) {
    return c.json({ error: 'Missing artist or album parameter' }, 400);
  }

  try {
    const ai = c.get('ai');
    const result = await ai.getAlbumRecommendations(artist, album);
    return c.json({ data: result });
  } catch (error) {
    console.error('Internal album recommendations error:', error);
    return c.json({ error: 'Failed to generate album recommendations' }, 500);
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
  const type = c.req.query('type') as 'album' | 'artist' | 'track';

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

// Search for album using field filters (more precise than plain query)
app.get('/api/internal/search-album-by-artist', async (c) => {
  const artist = c.req.query('artist');
  const album = c.req.query('album');

  if (!artist || !album) {
    return c.json({ error: 'Missing artist or album parameter' }, 400);
  }

  try {
    const spotify = c.get('spotify');
    const result = await spotify.searchAlbumByArtist(artist, album);
    return c.json({ data: result ? [result] : [] });
  } catch (error) {
    console.error('Internal search-album-by-artist error:', error);
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
  const CACHE_KEY = 'user-listens:v2:recent';
  const MAX_RESULTS = 8;

  try {
    // Read-only from cache - cron is responsible for writing
    // This prevents race conditions where API and cron both write
    const cached = await c.env.CACHE.get(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      // Handle both old format (array) and new format (object with tracks/lastUpdated)
      const tracks = Array.isArray(parsed) ? parsed : parsed.tracks;
      const lastUpdated = Array.isArray(parsed) ? null : parsed.lastUpdated;
      
      // Detect and log stale format (helps diagnose old worker instances)
      if (Array.isArray(parsed)) {
        console.log(`[API] WARNING: Cache has old format (bare array with ${parsed.length} items). Possible stale worker writing v1 format.`);
      } else if (!parsed.version || parsed.version < 2) {
        console.log(`[API] WARNING: Cache has outdated version (v${parsed.version || 1}). Expected v2.`);
      }
      
      console.log(`[API] Cache hit, returning ${tracks.length} tracks`);
      return c.json({ data: tracks.slice(0, MAX_RESULTS), lastUpdated, cached: true });
    }

    // Cache miss - cron should have pre-warmed, but if not, return empty
    // The UI will show "Loading..." and cron will populate within 5 minutes
    console.log('[API] Cache MISS - cron has not pre-warmed yet, returning empty');
    return c.json({ 
      data: [], 
      lastUpdated: null, 
      cached: false,
      message: 'Cache warming in progress. Data will appear shortly.'
    });
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

// Admin endpoint to clear cache entries (requires premium API key)
// Supports: albumDetail, artistSummary, artistSentence, genreSummary, spotify:album, spotify:artist
app.delete('/api/cache', requireAuth({ minTier: 'premium' }), async (c) => {

  const type = c.req.query('type');
  const cache = c.env.CACHE;

  if (!type) {
    return c.json({
      error: 'Missing type parameter',
      supportedTypes: ['albumDetail', 'artistSummary', 'artistSentence', 'genreSummary', 'spotify:album', 'spotify:artist'],
      examples: [
        '/api/cache?type=albumDetail&artist=radiohead&album=ok%20computer',
        '/api/cache?type=artistSummary&artist=radiohead',
        '/api/cache?type=artistSentence&artist=beck',
        '/api/cache?type=genreSummary&genre=shoegaze',
        '/api/cache?type=spotify:album&id=abc123',
      ],
    }, 400);
  }

  try {
    let key: string;
    let deleted = false;

    switch (type) {
      case 'albumDetail': {
        const artist = c.req.query('artist');
        const album = c.req.query('album');
        if (!artist || !album) {
          return c.json({ error: 'Missing artist or album parameter' }, 400);
        }
        key = `ai:albumDetail:${artist.toLowerCase().trim()}:${album.toLowerCase().trim()}`;
        break;
      }
      case 'artistSummary': {
        const artist = c.req.query('artist');
        if (!artist) {
          return c.json({ error: 'Missing artist parameter' }, 400);
        }
        key = `ai:artistSummary:${artist.toLowerCase().trim()}`;
        break;
      }
      case 'artistSentence': {
        const artist = c.req.query('artist');
        if (!artist) {
          return c.json({ error: 'Missing artist parameter' }, 400);
        }
        key = `ai:artistSentence:${artist.toLowerCase().trim()}`;
        break;
      }
      case 'genreSummary': {
        const genre = c.req.query('genre');
        if (!genre) {
          return c.json({ error: 'Missing genre parameter' }, 400);
        }
        key = `ai:genreSummary:${genre.toLowerCase().trim()}`;
        break;
      }
      case 'spotify:album': {
        const id = c.req.query('id');
        if (!id) {
          return c.json({ error: 'Missing id parameter' }, 400);
        }
        // Delete both v1 and v2 cache keys
        await cache.delete(`spotify:album:${id}`);
        await cache.delete(`spotify:album:v2:${id}`);
        return c.json({
          message: 'Cache entries deleted',
          keys: [`spotify:album:${id}`, `spotify:album:v2:${id}`],
        });
      }
      case 'spotify:artist': {
        const id = c.req.query('id');
        if (!id) {
          return c.json({ error: 'Missing id parameter' }, 400);
        }
        key = `spotify:artist:${id}`;
        break;
      }
      default:
        return c.json({
          error: 'Unknown cache type',
          supportedTypes: ['albumDetail', 'artistSummary', 'artistSentence', 'genreSummary', 'spotify:album', 'spotify:artist'],
        }, 400);
    }

    // Check if key exists before deleting
    const existing = await cache.get(key);
    if (existing) {
      await cache.delete(key);
      deleted = true;
    }

    return c.json({
      message: deleted ? 'Cache entry deleted' : 'Cache entry not found',
      key,
      deleted,
    });
  } catch (error) {
    console.error('Cache delete error:', error);
    return c.json({ error: 'Failed to delete cache entry' }, 500);
  }
});

// Admin endpoint to list cache keys by prefix (requires premium API key)
app.get('/api/cache', requireAuth({ minTier: 'premium' }), async (c) => {
  const prefix = c.req.query('prefix') || 'ai:';
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 100);
  const cache = c.env.CACHE;

  try {
    const list = await cache.list({ prefix, limit });
    return c.json({
      keys: list.keys.map((k) => ({
        name: k.name,
        expiration: k.expiration ? new Date(k.expiration * 1000).toISOString() : null,
      })),
      count: list.keys.length,
      complete: list.list_complete,
    });
  } catch (error) {
    console.error('Cache list error:', error);
    return c.json({ error: 'Failed to list cache entries' }, 500);
  }
});

// =============================================================================
// Public API v1 Routes
// All routes require API key auth (via X-API-Key header)
// Auth and rate limiting applied globally via /api/* middleware
// =============================================================================

// GET /api/v1/album - Get album details with AI summary and streaming links
app.get('/api/v1/album', async (c) => {
  const artist = c.req.query('artist');
  const album = c.req.query('album');
  const include = c.req.query('include')?.split(',') || ['summary', 'links', 'tracks'];

  if (!artist || !album) {
    return c.json({ error: 'Missing required parameters: artist and album' }, 400);
  }

  try {
    const spotify = c.get('spotify');
    const spotifyStreaming = c.get('spotifyStreaming');
    const ai = c.get('ai');
    const streamingLinks = c.get('streamingLinks');

    // Step 1: Search for the album using precise search
    const searchResult = await spotify.searchAlbumByArtist(artist, album);
    if (!searchResult) {
      return c.json({ error: 'Album not found', artist, album }, 404);
    }

    // Step 2: Fetch full album details
    const albumData = await spotify.getAlbum(searchResult.id);

    // Step 3: Fetch AI summary and streaming links in parallel (if requested)
    const [summaryResult, linksResult] = await Promise.all([
      include.includes('summary')
        ? ai.getAlbumDetail(albumData.artist, albumData.name).catch((err) => {
            console.error('AI album summary error:', err);
            return null;
          })
        : Promise.resolve(null),
      include.includes('links')
        ? (async () => {
            try {
              const albumForLinks = await spotifyStreaming.getAlbum(searchResult.id);
              const metadata = StreamingLinksService.albumMetadataFromSpotify({
                id: albumForLinks.id,
                name: albumForLinks.name,
                artists: albumForLinks.artistIds.map((_, i) => ({
                  name: albumForLinks.artist.split(', ')[i] || albumForLinks.artist,
                })),
                total_tracks: albumForLinks.tracks,
                release_date: albumForLinks.releaseDate,
                external_ids: albumForLinks.upc ? { upc: albumForLinks.upc } : undefined,
              });
              return await streamingLinks.getAlbumLinks(metadata);
            } catch (err) {
              console.error('Streaming links error:', err);
              return null;
            }
          })()
        : Promise.resolve(null),
    ]);

    // Build response
    const response: Record<string, unknown> = {
      id: albumData.id,
      name: albumData.name,
      artist: albumData.artist,
      artistId: albumData.artistIds[0] || null,
      releaseDate: albumData.releaseDate,
      genres: albumData.genres,
      image: albumData.image,
      url: albumData.url,
    };

    if (include.includes('tracks')) {
      response.tracks = albumData.trackList;
    }

    if (summaryResult) {
      response.summary = {
        content: summaryResult.content,
        citations: summaryResult.citations,
        metadata: summaryResult.metadata,
      };
    }

    if (linksResult) {
      response.links = {
        listentomore: `https://listentomore.com/album/${albumData.id}`,
        spotify: albumData.url,
        appleMusic: linksResult.appleMusic?.url || null,
        youtube: linksResult.youtube?.url || null,
      };
      response.confidence = {
        appleMusic: linksResult.appleMusic?.confidence || null,
        youtube: linksResult.youtube?.confidence || null,
      };
    } else {
      // Always include listentomore link even if streaming links not requested
      response.links = {
        listentomore: `https://listentomore.com/album/${albumData.id}`,
        spotify: albumData.url,
      };
    }

    return c.json({ data: response });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('v1 album error:', errorMessage, error);
    return c.json({ error: 'Failed to fetch album', details: errorMessage }, 500);
  }
});

// GET /api/v1/genre - Get AI-generated genre summary
app.get('/api/v1/genre', async (c) => {
  const query = c.req.query('q');

  if (!query) {
    return c.json({ error: 'Missing required parameter: q' }, 400);
  }

  try {
    const ai = c.get('ai');

    // Normalize genre name to slug format
    const slug = query.toLowerCase().trim().replace(/\s+/g, '-');

    const result = await ai.getGenreSummary(query);

    return c.json({
      data: {
        name: query,
        slug,
        url: `https://listentomore.com/genre/${slug}`,
        summary: {
          content: result.content,
          citations: result.citations,
          metadata: result.metadata,
        },
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('v1 genre error:', errorMessage, error);
    return c.json({ error: 'Failed to fetch genre summary', details: errorMessage }, 500);
  }
});

// POST /api/v1/ask - Chat with the music AI
app.post('/api/v1/ask', async (c) => {
  try {
    const body = await c.req.json();
    const question = body.question;

    if (!question || typeof question !== 'string') {
      return c.json({ error: 'Missing required field: question' }, 400);
    }

    const ai = c.get('ai');
    const result = await ai.askListenAI(question);

    return c.json({
      data: {
        question,
        answer: result.response,
        // Include metadata for debugging (shows actual model, API used, features, etc.)
        metadata: result.metadata,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('v1 ask error:', errorMessage, error);
    return c.json({ error: 'Failed to generate response', details: errorMessage }, 500);
  }
});

// GET /api/v1/artist - Get artist details with AI summary
app.get('/api/v1/artist', async (c) => {
  const query = c.req.query('q');
  const include = c.req.query('include')?.split(',') || ['summary', 'sentence', 'albums'];

  if (!query) {
    return c.json({ error: 'Missing required parameter: q' }, 400);
  }

  try {
    const spotify = c.get('spotify');
    const ai = c.get('ai');
    const lastfm = c.get('lastfm');

    // Step 1: Search for artist
    const searchResults = await spotify.search.search(query, 'artist', 1);
    if (!searchResults || searchResults.length === 0) {
      return c.json({ error: 'Artist not found', query }, 404);
    }

    const artistResult = searchResults[0];

    // Step 2: Get full artist details
    const artistData = await spotify.getArtist(artistResult.id);

    // Step 3: Fetch AI summary, sentence, and top albums in parallel
    const [summaryResult, sentenceResult, topAlbumsResult] = await Promise.all([
      include.includes('summary')
        ? ai.getArtistSummary(artistData.name).catch((err) => {
            console.error('AI artist summary error:', err);
            return null;
          })
        : Promise.resolve(null),
      include.includes('sentence')
        ? ai.getArtistSentence(artistData.name).catch((err) => {
            console.error('AI artist sentence error:', err);
            return null;
          })
        : Promise.resolve(null),
      include.includes('albums')
        ? lastfm.getArtistTopAlbums(artistData.name, 5).catch((err) => {
            console.error('Last.fm top albums error:', err);
            return [];
          })
        : Promise.resolve([]),
    ]);

    // Build response
    const response: Record<string, unknown> = {
      id: artistData.id,
      name: artistData.name,
      genres: artistData.genres,
      image: artistData.image,
      url: `https://listentomore.com/artist/${artistData.id}`,
      spotifyUrl: artistData.url,
    };

    if (summaryResult && summaryResult.summary) {
      response.summary = {
        content: summaryResult.summary,
        citations: summaryResult.citations,
        metadata: summaryResult.metadata,
      };
    }

    if (sentenceResult && sentenceResult.sentence) {
      response.sentence = sentenceResult.sentence;
    }

    if (topAlbumsResult && topAlbumsResult.length > 0) {
      response.topAlbums = topAlbumsResult.map((album) => ({
        name: album.name,
        playcount: album.playcount,
      }));
    }

    return c.json({ data: response });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('v1 artist error:', errorMessage, error);
    return c.json({ error: 'Failed to fetch artist', details: errorMessage }, 500);
  }
});

// GET /api/v1/links - Get cross-platform streaming links for an album
app.get('/api/v1/links', async (c) => {
  const artist = c.req.query('artist');
  const album = c.req.query('album');

  if (!artist || !album) {
    return c.json({ error: 'Missing required parameters: artist and album' }, 400);
  }

  try {
    const spotify = c.get('spotify');
    const spotifyStreaming = c.get('spotifyStreaming');
    const streamingLinks = c.get('streamingLinks');

    // Step 1: Search for the album
    const searchResult = await spotify.searchAlbumByArtist(artist, album);
    if (!searchResult) {
      return c.json({ error: 'Album not found', artist, album }, 404);
    }

    // Step 2: Get full album details for UPC
    const albumData = await spotifyStreaming.getAlbum(searchResult.id);
    const metadata = StreamingLinksService.albumMetadataFromSpotify({
      id: albumData.id,
      name: albumData.name,
      artists: albumData.artistIds.map((_, i) => ({
        name: albumData.artist.split(', ')[i] || albumData.artist,
      })),
      total_tracks: albumData.tracks,
      release_date: albumData.releaseDate,
      external_ids: albumData.upc ? { upc: albumData.upc } : undefined,
    });

    // Step 3: Get streaming links
    const links = await streamingLinks.getAlbumLinks(metadata);

    return c.json({
      data: {
        source: {
          id: albumData.id,
          name: albumData.name,
          artist: albumData.artist,
        },
        links: {
          listentomore: `https://listentomore.com/album/${albumData.id}`,
          spotify: albumData.url,
          appleMusic: links.appleMusic?.url || null,
          youtube: links.youtube?.url || null,
        },
        confidence: {
          appleMusic: links.appleMusic?.confidence || null,
          youtube: links.youtube?.confidence || null,
        },
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('v1 links error:', errorMessage, error);
    return c.json({ error: 'Failed to fetch streaming links', details: errorMessage }, 500);
  }
});

// GET /api/v1/random-fact - Get a random music fact from the cached pool
app.get('/api/v1/random-fact', async (c) => {
  const exclude = c.req.query('exclude')?.split(',').filter(Boolean) || [];

  try {
    const cache = c.env.CACHE;
    const KV_KEY = 'random-facts:pool';

    // Get facts from pool
    const stored = await cache.get<{ facts: Array<{ fact: string; timestamp: string }>; lastUpdated: string }>(KV_KEY, 'json');

    if (!stored || stored.facts.length === 0) {
      return c.json({ error: 'No facts available', message: 'Fact pool is empty. Please try again later.' }, 503);
    }

    // Filter out excluded facts (by simple hash of fact text)
    const hashFact = (fact: string) => {
      // Simple hash using Web Crypto-compatible approach
      // Convert to bytes, sum them with position weighting, return hex
      let hash = 0;
      for (let i = 0; i < fact.length; i++) {
        const char = fact.charCodeAt(i);
        hash = ((hash << 5) - hash + char) | 0; // Convert to 32-bit integer
      }
      // Convert to unsigned and then to hex (8 chars)
      return (hash >>> 0).toString(16).padStart(8, '0');
    };

    const availableFacts = stored.facts.filter((f) => !exclude.includes(hashFact(f.fact)));

    if (availableFacts.length === 0) {
      // All facts excluded - return the newest one anyway (better than nothing)
      const newestFact = stored.facts[0];
      return c.json({
        data: {
          fact: newestFact.fact,
          hash: hashFact(newestFact.fact),
          timestamp: newestFact.timestamp,
        },
        warning: 'All facts in pool were excluded. Returning newest fact.',
      });
    }

    // Pick a random fact from available pool
    const randomIndex = Math.floor(Math.random() * availableFacts.length);
    const selectedFact = availableFacts[randomIndex];

    return c.json({
      data: {
        fact: selectedFact.fact,
        hash: hashFact(selectedFact.fact),
        timestamp: selectedFact.timestamp,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('v1 random-fact error:', errorMessage, error);
    return c.json({ error: 'Failed to fetch random fact', details: errorMessage }, 500);
  }
});

// GET /api/v1/album/recommendations - Get AI-generated album recommendations
app.get('/api/v1/album/recommendations', async (c) => {
  const artist = c.req.query('artist');
  const album = c.req.query('album');

  if (!artist || !album) {
    return c.json({ error: 'Missing required parameters: artist and album' }, 400);
  }

  try {
    const spotify = c.get('spotify');
    const ai = c.get('ai');

    // Step 1: Search for the album to validate it exists and get correct names
    const searchResult = await spotify.searchAlbumByArtist(artist, album);
    if (!searchResult) {
      return c.json({ error: 'Album not found', artist, album }, 404);
    }

    // Step 2: Get AI recommendations
    const recommendations = await ai.getAlbumRecommendations(searchResult.artist, searchResult.name);

    return c.json({
      data: {
        source: {
          id: searchResult.id,
          name: searchResult.name,
          artist: searchResult.artist,
          url: `https://listentomore.com/album/${searchResult.id}`,
        },
        recommendations: {
          content: recommendations.content,
          citations: recommendations.citations,
          metadata: recommendations.metadata,
        },
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('v1 album recommendations error:', errorMessage, error);
    return c.json({ error: 'Failed to generate recommendations', details: errorMessage }, 500);
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

// Scheduled handler for CRON jobs (runs every 5 minutes)
async function scheduled(
  _event: ScheduledEvent,
  env: Bindings,
  _ctx: ExecutionContext
): Promise<void> {
  const now = new Date();
  const minute = now.getMinutes();
  console.log(`[CRON] Running scheduled task at ${now.toISOString()}`);

  // Generate random fact only at the top of the hour (minute 0-4)
  // This avoids expensive OpenAI calls every 5 minutes
  if (minute < 5) {
    const ai = new AIService({
      openaiApiKey: env.OPENAI_API_KEY,
      perplexityApiKey: env.PERPLEXITY_API_KEY,
      cache: env.CACHE,
    });

    try {
      const result = await ai.generateAndStoreRandomFact();
      console.log(`[CRON] Generated new fact: ${result.fact.substring(0, 50)}...`);
    } catch (error) {
      console.error('[CRON] Failed to generate random fact:', error);
    }
  }

  // Pre-warm user listens cache (runs every 5 minutes)
  try {
    const db = new Database(env.DB);
    const users = await db.getAllUsersWithLastfm();
    console.log(`[CRON] Found ${users.length} users with Last.fm usernames`);

    // Create Spotify service for image lookups
    const spotify = new SpotifyService({
      clientId: env.SPOTIFY_CLIENT_ID,
      clientSecret: env.SPOTIFY_CLIENT_SECRET,
      refreshToken: env.SPOTIFY_REFRESH_TOKEN,
      cache: env.CACHE,
    });

    // ===== PHASE 1: Fetch Last.fm data (batched, rate-limited) =====
    const BATCH_SIZE = 4;
    const BATCH_DELAY_MS = 1000;
    const startTime = Date.now();
    let lastfmSuccessCount = 0;
    let lastfmErrorCount = 0;

    type TrackData = { username: string; artist: string; album: string; track: string; image: string | null; playedAt: string | null; nowPlaying: boolean };
    const userTracks: (TrackData | null)[] = [];
    const totalBatches = Math.ceil(users.length / BATCH_SIZE);

    console.log(`[CRON] Phase 1: Fetching Last.fm data for ${users.length} users in ${totalBatches} batches`);

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const batchStart = batchIndex * BATCH_SIZE;
      const batch = users.slice(batchStart, batchStart + BATCH_SIZE);
      const batchStartTime = Date.now();

      const batchResults = await Promise.all(
        batch.map(async (user) => {
          if (!user.lastfm_username) return null;
          try {
            const userLastfm = new LastfmService({
              apiKey: env.LASTFM_API_KEY,
              username: user.lastfm_username,
            });
            const track = await userLastfm.getMostRecentTrack();
            if (track) {
              lastfmSuccessCount++;
              return {
                username: user.username || user.lastfm_username,
                artist: track.artist,
                album: track.album,
                track: track.name,
                image: track.image, // Last.fm image as fallback
                playedAt: track.playedAt,
                nowPlaying: track.nowPlaying,
              };
            }
          } catch (error) {
            lastfmErrorCount++;
            console.error(`[CRON] Failed to fetch recent track for ${user.lastfm_username}:`, error);
          }
          return null;
        })
      );

      userTracks.push(...batchResults);

      const batchDuration = Date.now() - batchStartTime;
      console.log(`[CRON] Last.fm batch ${batchIndex + 1}/${totalBatches} complete (${batchDuration}ms)`);

      // Delay before next batch (except for the last one)
      if (batchIndex < totalBatches - 1) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    const phase1Duration = Date.now() - startTime;
    console.log(`[CRON] Phase 1 complete: ${lastfmSuccessCount} tracks, ${lastfmErrorCount} errors in ${phase1Duration}ms`);

    // ===== PHASE 2: Enrich with Spotify images (parallel) =====
    const phase2Start = Date.now();
    const tracksNeedingImages = userTracks.filter((t): t is TrackData => t !== null && !!t.artist && !!t.album);
    let spotifySuccessCount = 0;
    let spotifySkipCount = 0;

    console.log(`[CRON] Phase 2: Fetching Spotify images for ${tracksNeedingImages.length} tracks (parallel)`);

    await Promise.all(
      tracksNeedingImages.map(async (track) => {
        try {
          const spotifyAlbum = await spotify.searchAlbumByArtist(track.artist, track.album);
          if (spotifyAlbum?.image) {
            track.image = spotifyAlbum.image;
            spotifySuccessCount++;
          } else {
            spotifySkipCount++;
          }
        } catch (err) {
          // Keep Last.fm image as fallback
          spotifySkipCount++;
        }
      })
    );

    const phase2Duration = Date.now() - phase2Start;
    const totalDuration = Date.now() - startTime;
    console.log(`[CRON] Phase 2 complete: ${spotifySuccessCount} enriched, ${spotifySkipCount} kept Last.fm image in ${phase2Duration}ms`);
    console.log(`[CRON] Total processing time: ${totalDuration}ms`);

    // Filter and sort
    const nullCount = userTracks.filter(t => t === null).length;
    console.log(`[CRON] API results: ${userTracks.length - nullCount} tracks, ${nullCount} failures`);
    const validTracks = userTracks.filter((t): t is NonNullable<typeof t> => t !== null);
    validTracks.sort((a, b) => {
      if (a.nowPlaying && !b.nowPlaying) return -1;
      if (!a.nowPlaying && b.nowPlaying) return 1;
      if (!a.playedAt && !b.playedAt) return 0;
      if (!a.playedAt) return 1;
      if (!b.playedAt) return -1;
      return new Date(b.playedAt).getTime() - new Date(a.playedAt).getTime();
    });

    // Cache with 7-minute TTL (cron runs every 5 min, gives 2 min overlap)
    const CACHE_KEY = 'user-listens:v2:recent';
    const CACHE_TTL_SECONDS = getTtlSeconds(CACHE_CONFIG.lastfm.userListens);
    const cacheData = {
      tracks: validTracks,
      lastUpdated: new Date().toISOString(),
      version: 2, // Version marker to detect stale workers (v1 wrote bare array, v2 writes object)
    };
    console.log(`[CRON] Caching ${validTracks.length} tracks to key "${CACHE_KEY}" with TTL ${CACHE_TTL_SECONDS}s`);
    await env.CACHE.put(CACHE_KEY, JSON.stringify(cacheData), {
      expirationTtl: CACHE_TTL_SECONDS,
    });

    // Verify write succeeded by reading back
    const verification = await env.CACHE.get(CACHE_KEY);
    if (verification) {
      const parsed = JSON.parse(verification);
      if (parsed.version === 2 && parsed.tracks?.length === validTracks.length) {
        console.log(`[CRON] Pre-warmed user listens cache with ${validTracks.length} tracks (verified)`);
      } else {
        console.log(`[CRON] WARNING: Cache verification mismatch! Expected v2 with ${validTracks.length} tracks, got v${parsed.version || 1} with ${parsed.tracks?.length ?? parsed.length} tracks`);
      }
    } else {
      console.log(`[CRON] WARNING: Cache write verification failed - key not found after write`);
    }
  } catch (error) {
    console.error('[CRON] Failed to pre-warm user listens cache:', error);
  }
}

export default {
  fetch: app.fetch,
  scheduled,
};
