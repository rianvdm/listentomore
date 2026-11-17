// Internal insights API routes for progressive loading

import { Hono, Context } from 'hono';
import { CACHE_CONFIG, getTtlSeconds } from '@listentomore/config';
import { LastfmService } from '@listentomore/lastfm';
import type { Database, User } from '@listentomore/db';
import type { AIService } from '@listentomore/ai';
import type { SpotifyService } from '@listentomore/spotify';
import type { InternalAppContext } from '../../types';
import { requireSessionAuth } from '../../middleware/require-session-auth';
import { getCurrentUser } from '../../middleware/session';
import { getWeekInsights } from './insights-week';

const app = new Hono<InternalAppContext>();

// Minimum plays threshold for generating recommendations
const MIN_PLAYS_THRESHOLD = 5;

// Look up a profile by lastfm_username first (canonical), then fall back to username
async function findInsightsUser(db: Database, username: string): Promise<User | null> {
  return (await db.getUserByLastfmUsername(username)) ?? (await db.getUserByUsername(username));
}

const PRIVATE_PROFILE = 'This profile is private';

// Private profiles show insights, and anything about their refresh state, only to their owner
const isHiddenFrom = (user: User, viewer: User | null): boolean =>
  user.profile_visibility === 'private' && viewer?.id !== user.id;

// Helper to get user with privacy check - insights only visible to owner for private profiles
async function getUserWithInsightsAccess(
  c: Context<InternalAppContext>,
  username: string
): Promise<{ user: User; lastfm: LastfmService; isOwner: boolean } | { error: string; status: number }> {
  const db = c.get('db');
  const currentUser = await getCurrentUser(c);

  const user = await findInsightsUser(db, username);

  if (!user || !user.lastfm_username) {
    return { error: 'User not found', status: 404 };
  }

  const isOwner = currentUser?.id === user.id;

  if (isHiddenFrom(user, currentUser)) {
    return { error: PRIVATE_PROFILE, status: 403 };
  }

  const lastfm = new LastfmService({
    apiKey: c.env.LASTFM_API_KEY,
    username: user.lastfm_username,
    cache: c.env.CACHE,
  });

  return { user, lastfm, isOwner };
}

// The refresh cooldown is keyed on the resolved Last.fm username, so a profile's site
// username and Last.fm name share one cooldown
const refreshKey = (lastfmUsername: string): string => `insights-refresh:${lastfmUsername.toLowerCase()}`;

// Check and enforce refresh rate limit. A failed read allows the refresh rather than failing the request
async function checkRefreshRateLimit(
  c: Context<InternalAppContext>,
  lastfmUsername: string
): Promise<{ allowed: boolean; cooldownSeconds?: number }> {
  const cacheKey = refreshKey(lastfmUsername);
  let lastRefresh: string | null;
  try {
    lastRefresh = await c.env.CACHE.get(cacheKey);
  } catch (error) {
    console.error('[Insights] Refresh cooldown read failed:', error instanceof Error ? error.message : String(error));
    return { allowed: true };
  }

  if (lastRefresh) {
    const elapsed = Date.now() - parseInt(lastRefresh);
    const cooldownMs = getTtlSeconds(CACHE_CONFIG.userInsights.refreshCooldown) * 1000;

    if (elapsed < cooldownMs) {
      return {
        allowed: false,
        cooldownSeconds: Math.ceil((cooldownMs - elapsed) / 1000),
      };
    }
  }

  return { allowed: true };
}

// Set refresh timestamp. A failed write is logged and the refresh goes ahead without a cooldown
async function setRefreshTimestamp(
  c: Context<InternalAppContext>,
  lastfmUsername: string
): Promise<void> {
  const cacheKey = refreshKey(lastfmUsername);
  const ttl = getTtlSeconds(CACHE_CONFIG.userInsights.refreshCooldown);
  try {
    await c.env.CACHE.put(cacheKey, Date.now().toString(), { expirationTtl: ttl });
  } catch (error) {
    console.error('[Insights] Refresh cooldown write failed:', error instanceof Error ? error.message : String(error));
  }
}

app.get('/user-insights-summary', requireSessionAuth, async (c) => {
  const username = c.req.query('username');
  const refresh = c.req.query('refresh') === 'true';

  if (!username) {
    return c.json({ error: 'Missing username parameter' }, 400);
  }

  // Check access before any cache read, on every request
  const accessResult = await getUserWithInsightsAccess(c, username);
  if ('error' in accessResult) {
    return c.json({ error: accessResult.error }, accessResult.status as 403 | 404);
  }

  const { user, lastfm, isOwner } = accessResult;

  // Check refresh rate limit (only owner can refresh)
  if (refresh) {
    if (!isOwner) {
      return c.json({ error: 'Only the profile owner can refresh insights' }, 403);
    }

    const lastfmUsername = user.lastfm_username!;
    const rateLimit = await checkRefreshRateLimit(c, lastfmUsername);
    if (!rateLimit.allowed) {
      return c.json(
        {
          error: 'Please wait before refreshing again',
          cooldown: rateLimit.cooldownSeconds,
        },
        429
      );
    }

    await setRefreshTimestamp(c, lastfmUsername);
  }

  try {
    const week = await getWeekInsights(c, { user, isOwner, refresh, history: lastfm.history });
    if (!week) {
      return c.json({
        data: null,
        sparse: true,
        message:
          "Looks like you've been taking a break from music lately! 🎧 Get back to listening and check back soon for personalized insights.",
      });
    }
    return c.json({ data: week });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Internal user-insights-summary error:', errorMessage, error);
    return c.json({ error: 'Failed to generate insights' }, 500);
  }
});

app.get('/user-insights-recommendations', requireSessionAuth, async (c) => {
  const username = c.req.query('username');
  const refresh = c.req.query('refresh') === 'true';

  console.log(`[Insights Recs] Starting for user: ${username}, refresh: ${refresh}`);

  if (!username) {
    return c.json({ error: 'Missing username parameter' }, 400);
  }

  // Check access
  const accessResult = await getUserWithInsightsAccess(c, username);
  if ('error' in accessResult) {
    return c.json({ error: accessResult.error }, accessResult.status as 403 | 404);
  }

  const { user, lastfm, isOwner } = accessResult;

  // If refresh, clear recommendations cache (rate limit already checked by summary endpoint)
  if (refresh && isOwner) {
    const ai = c.get('ai') as AIService;
    await ai.cache.delete('userInsightsRecommendations', username.toLowerCase());
    console.log(`[Insights Recs] Cache cleared for ${username}`);
  }

  try {
    // Fetch listening data
    console.log(`[Insights Recs] Fetching Last.fm data...`);
    const [topArtists, topAlbums, recentTracks, historicalArtists] = await Promise.all([
      lastfm.getTopArtists('7day', 5).catch((e) => {
        console.error(`[Insights Recs] Failed to fetch top artists:`, e);
        return [];
      }),
      lastfm.getTopAlbums('7day', 5).catch((e) => {
        console.error(`[Insights Recs] Failed to fetch top albums:`, e);
        return [];
      }),
      lastfm.recentTracks.getRecentTracks(30).catch((e) => {
        console.error(`[Insights Recs] Failed to fetch recent tracks:`, e);
        return [];
      }),
      lastfm.getTopArtists('6month', 20).catch((e) => {
        console.error(`[Insights Recs] Failed to fetch historical artists:`, e);
        return [];
      }),
    ]);
    console.log(`[Insights Recs] Got ${topArtists.length} artists, ${topAlbums.length} albums, ${recentTracks.length} recent tracks, ${historicalArtists.length} historical`);

    // Check for sparse listening data
    const totalPlays = topArtists.reduce((sum, a) => sum + a.playcount, 0);
    if (totalPlays < MIN_PLAYS_THRESHOLD) {
      console.log(`[Insights Recs] Sparse data (${totalPlays} plays), returning empty`);
      return c.json({
        data: [],
        sparse: true,
      });
    }

    // Generate recommendations
    console.log(`[Insights Recs] Calling AI for recommendations...`);
    const startTime = Date.now();
    const ai = c.get('ai') as AIService;
    const result = await ai.getUserInsightsRecommendations(user.lastfm_username!, {
      topArtists: topArtists.map((a) => ({ name: a.name, playcount: a.playcount })),
      topAlbums: topAlbums.map((a) => ({
        name: a.name,
        artist: a.artist,
        playcount: a.playcount,
      })),
      recentTracks: recentTracks.map((t) => ({ name: t.name, artist: t.artist })),
      historicalArtists: historicalArtists.map((a) => ({ name: a.name })),
    });
    console.log(`[Insights Recs] AI returned ${result.recommendations.length} recommendations in ${Date.now() - startTime}ms`);

    // Enrich recommendations with Spotify data (album art, IDs)
    console.log(`[Insights Recs] Enriching with Spotify data...`);
    const spotify = c.get('spotify') as SpotifyService;
    const enrichedRecommendations = await Promise.all(
      result.recommendations.map(async (rec) => {
        let spotifyId: string | null = null;
        let albumArt: string | null = null;
        let artistSpotifyId: string | null = null;

        try {
          // Search for album on Spotify — artist ID is available from the album result
          const albumResults = await spotify.search.search(
            `${rec.artistName} ${rec.albumName}`,
            'album',
            1
          );

          if (albumResults.length > 0) {
            const album = albumResults[0];
            spotifyId = album.id;
            albumArt = album.image;
            artistSpotifyId = album.artistIds[0] ?? null;
            console.log(`[Insights Recs] Found Spotify album: ${rec.albumName} -> ${album.id}`);
          } else {
            console.log(`[Insights Recs] No Spotify album match for: ${rec.artistName} - ${rec.albumName}`);
          }
        } catch (error) {
          console.error(`[Insights Recs] Error enriching album ${rec.albumName}:`, error);
        }

        return {
          albumName: rec.albumName,
          artistName: rec.artistName,
          reason: rec.reason,
          spotifyId,
          albumArt,
          artistSpotifyId,
        };
      })
    );

    console.log(`[Insights Recs] Returning ${enrichedRecommendations.length} enriched recommendations`);
    return c.json({ data: enrichedRecommendations });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Insights Recs] ERROR for ${username}:`, errorMessage, error);
    return c.json({ error: 'Failed to generate recommendations' }, 500);
  }
});

// Check refresh cooldown status
// No requireSessionAuth — read-only rate limit check, no AI calls
app.get('/user-insights-cooldown', async (c) => {
  const username = c.req.query('username');

  if (!username) {
    return c.json({ error: 'Missing username parameter' }, 400);
  }

  // Read the same key the summary route writes: the resolved Last.fm username
  const user = await findInsightsUser(c.get('db'), username);
  if (!user || !user.lastfm_username) {
    return c.json({ canRefresh: true, cooldownSeconds: 0 });
  }

  // Visibility before any cache read. Only a private profile needs the session, so public ones skip the lookup
  if (user.profile_visibility === 'private' && isHiddenFrom(user, await getCurrentUser(c))) {
    return c.json({ error: PRIVATE_PROFILE }, 403);
  }

  const rateLimit = await checkRefreshRateLimit(c, user.lastfm_username);

  return c.json({
    canRefresh: rateLimit.allowed,
    cooldownSeconds: rateLimit.cooldownSeconds || 0,
  });
});

export const insightsInternalRoutes = app;
