// Main entry point for the Listen To More web application
// Built with Hono on Cloudflare Workers

import { Hono } from 'hono';
import { SITE_CONFIG, CACHE_CONFIG, getTtlSeconds } from '@listentomore/config';
import { Database } from '@listentomore/db';
import { SpotifyService } from '@listentomore/spotify';
import { LastfmService } from '@listentomore/lastfm';
import { SonglinkService } from '@listentomore/songlink';
import { StreamingLinksService } from '@listentomore/streaming-links';
import { AIService } from '@listentomore/ai';
import { DiscogsService } from '@listentomore/discogs';
// Note: CACHE_CONFIG and getTtlSeconds used in scheduled() for cron jobs
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
import { handleAccountDiscogs } from './pages/account/discogs';
import { handleStatsEntry, handleStatsLookup } from './pages/stats/entry';
import { PrivacyPage } from './pages/legal/privacy';
import { TermsPage } from './pages/legal/terms';
import { AboutPage } from './pages/about';
import { DiscordPage } from './pages/discord';
import { enrichLinksScript } from './utils/client-scripts';
import { apiRoutes } from './api';
import type { Bindings, Variables } from './types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Apply security headers to all responses
app.use('*', securityHeadersMiddleware());

// Apply CORS middleware (needs to run before other middleware)
app.use('*', async (c, next) => {
  const middleware = corsMiddleware({ ENVIRONMENT: c.env.ENVIRONMENT });
  return middleware(c, next);
});

// Apply origin validation to API routes (in production)
// Skip for OAuth routes since they're browser-based redirects
// Skip for internal routes since they use token auth instead
app.use('/api/*', async (c, next) => {
  if (c.req.path.startsWith('/api/auth/discogs/')) {
    return next();
  }
  if (c.req.path.startsWith('/api/internal/')) {
    return next();
  }
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

  // Discogs service - uses personal token for now (OAuth coming later)
  // Generate a personal token at https://www.discogs.com/settings/developers
  c.set(
    'discogs',
    new DiscogsService({
      accessToken: c.env.DISCOGS_PERSONAL_TOKEN || '',
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
  // Skip auth for OAuth endpoints (they use browser redirects, not API keys)
  if (c.req.path.startsWith('/api/auth/discogs/')) {
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
app.get('/u/:username/discogs', handleAccountDiscogs);

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

// =============================================================================
// API Routes
// =============================================================================

// Apply internal auth middleware for progressive loading endpoints
app.use('/api/internal/*', internalAuthMiddleware());

// Prevent browser/edge caching of internal API responses
app.use('/api/internal/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate');
});

// Mount all API routes (v1, internal, admin)
app.route('/api', apiRoutes);

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

  // ===== Discogs Collection Sync & Enrichment (runs every 6 hours) =====
  // Only run at specific hours to avoid running too frequently
  const hour = now.getHours();
  const shouldRunDiscogsSync = minute < 5 && (hour === 0 || hour === 6 || hour === 12 || hour === 18);

  if (shouldRunDiscogsSync) {
    try {
      await syncDiscogsCollections(env);
    } catch (error) {
      console.error('[CRON] Discogs sync failed:', error);
    }
  }
}

/**
 * Sync Discogs collections for all active users with connected accounts
 * Runs every 6 hours via cron
 */
async function syncDiscogsCollections(env: Bindings): Promise<void> {
  const db = new Database(env.DB);

  // Get users with Discogs connected who were active in last 7 days
  const usersWithDiscogs = await db.getUsersWithDiscogs();
  console.log(`[CRON Discogs] Found ${usersWithDiscogs.length} users with Discogs connected`);

  if (usersWithDiscogs.length === 0) return;

  for (const user of usersWithDiscogs) {
    if (!user.discogs_username) continue;

    try {
      // Check if sync is needed (skip if synced recently)
      const lastSyncKey = `discogs:last-sync:${user.id}`;
      const lastSync = await env.CACHE.get(lastSyncKey);
      if (lastSync) {
        const lastSyncTime = parseInt(lastSync, 10);
        const hoursSinceSync = (Date.now() - lastSyncTime) / (1000 * 60 * 60);
        if (hoursSinceSync < 5) {
          console.log(`[CRON Discogs] Skipping ${user.username} - synced ${hoursSinceSync.toFixed(1)}h ago`);
          continue;
        }
      }

      // Get OAuth tokens
      const oauthToken = await db.getOAuthToken(user.id, 'discogs');
      if (!oauthToken) {
        console.log(`[CRON Discogs] Skipping ${user.username} - no OAuth token`);
        continue;
      }

      // Decrypt tokens
      const { decryptToken } = await import('@listentomore/discogs');
      if (!env.OAUTH_ENCRYPTION_KEY) {
        console.log(`[CRON Discogs] Skipping ${user.username} - no encryption key configured`);
        continue;
      }
      const accessToken = await decryptToken(oauthToken.access_token_encrypted, env.OAUTH_ENCRYPTION_KEY);
      const accessSecret = oauthToken.refresh_token_encrypted
        ? await decryptToken(oauthToken.refresh_token_encrypted, env.OAUTH_ENCRYPTION_KEY)
        : '';

      // Create Discogs service
      const discogs = new DiscogsService({
        accessToken,
        accessTokenSecret: accessSecret,
        consumerKey: env.DISCOGS_OAUTH_CONSUMER_KEY,
        consumerSecret: env.DISCOGS_OAUTH_CONSUMER_SECRET,
        cache: env.CACHE,
      });

      console.log(`[CRON Discogs] Syncing collection for ${user.username}`);

      // Sync collection
      const result = await discogs.syncCollection(user.id, user.discogs_username);
      console.log(`[CRON Discogs] Synced ${result.releaseCount} releases for ${user.username}`);

      // Update last sync timestamp
      await env.CACHE.put(lastSyncKey, Date.now().toString(), { expirationTtl: 86400 });

      // Run enrichment for any unenriched releases
      const enrichmentNeeded = await discogs.getEnrichmentNeeded(user.id);
      if (enrichmentNeeded && enrichmentNeeded.needsEnrichment > 0) {
        console.log(`[CRON Discogs] Enriching ${enrichmentNeeded.needsEnrichment} releases for ${user.username}`);

        // Process enrichment batches (limit to avoid timeout)
        const MAX_CRON_BATCHES = 5; // ~5 minutes max per user
        for (let i = 0; i < MAX_CRON_BATCHES; i++) {
          const enrichResult = await discogs.enrichBatch(user.id);
          if (!enrichResult || enrichResult.remaining === 0) break;
          console.log(`[CRON Discogs] Enrichment batch ${i + 1}: ${enrichResult.processed} processed, ${enrichResult.remaining} remaining`);
        }
      }

      // Small delay between users to avoid rate limits
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`[CRON Discogs] Failed to sync for ${user.username}:`, error);
    }
  }

  console.log('[CRON Discogs] Sync complete');
}

// Queue handler for background Discogs enrichment
async function queue(
  batch: MessageBatch<import('./types').DiscogsQueueMessage>,
  env: Bindings
): Promise<void> {
  for (const message of batch.messages) {
    const { type, userId, discogsUsername } = message.body;

    if (type !== 'enrich-collection') {
      console.log(`[Queue] Unknown message type: ${type}`);
      message.ack();
      continue;
    }

    console.log(`[Queue] Processing enrichment for user ${userId} (${discogsUsername})`);

    try {
      const db = new Database(env.DB);

      // Get OAuth tokens for this user
      const oauthToken = await db.getOAuthToken(userId, 'discogs');
      if (!oauthToken) {
        console.log(`[Queue] No OAuth token for user ${userId}, skipping`);
        message.ack();
        continue;
      }

      // Decrypt tokens
      const { decryptToken } = await import('@listentomore/discogs');
      if (!env.OAUTH_ENCRYPTION_KEY) {
        console.error(`[Queue] No encryption key configured`);
        message.ack();
        continue;
      }

      const accessToken = await decryptToken(oauthToken.access_token_encrypted, env.OAUTH_ENCRYPTION_KEY);
      const accessSecret = oauthToken.refresh_token_encrypted
        ? await decryptToken(oauthToken.refresh_token_encrypted, env.OAUTH_ENCRYPTION_KEY)
        : '';

      // Create Discogs service
      const discogs = new DiscogsService({
        accessToken,
        accessTokenSecret: accessSecret,
        consumerKey: env.DISCOGS_OAUTH_CONSUMER_KEY,
        consumerSecret: env.DISCOGS_OAUTH_CONSUMER_SECRET,
        cache: env.CACHE,
      });

      // Run full enrichment - no time limit in queue handler!
      const MAX_BATCHES = 100; // Safety limit (~5000 releases max)
      let batchCount = 0;
      let totalProcessed = 0;

      while (batchCount < MAX_BATCHES) {
        const result = await discogs.enrichBatch(userId);

        if (!result) {
          console.log(`[Queue] No enrichment service available`);
          break;
        }

        totalProcessed += result.processed;
        console.log(
          `[Queue] Batch ${batchCount + 1}: processed ${result.processed}, remaining ${result.remaining}, errors ${result.errors}`
        );

        if (result.remaining === 0) {
          console.log(`[Queue] Enrichment complete for user ${userId}: ${totalProcessed} total processed`);
          break;
        }

        batchCount++;

        // Small delay between batches
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      if (batchCount >= MAX_BATCHES) {
        console.warn(`[Queue] Hit max batch limit for user ${userId}`);
      }

      message.ack();
    } catch (error) {
      console.error(`[Queue] Enrichment failed for user ${userId}:`, error);
      // Don't ack - let it retry
      message.retry();
    }
  }
}

export default {
  fetch: app.fetch,
  scheduled,
  queue,
};
