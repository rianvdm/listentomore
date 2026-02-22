// Internal insights API routes for progressive loading

import { Hono, Context } from 'hono';
import { CACHE_CONFIG, getTtlSeconds } from '@listentomore/config';
import { LastfmService } from '@listentomore/lastfm';
import type { User } from '@listentomore/db';
import type { AIService } from '@listentomore/ai';
import type { SpotifyService } from '@listentomore/spotify';
import type { Bindings, Variables } from '../../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Minimum plays threshold for generating insights
const MIN_PLAYS_THRESHOLD = 5;

// Helper to get user with privacy check - insights only visible to owner for private profiles
async function getUserWithInsightsAccess(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  username: string
): Promise<{ user: User; lastfm: LastfmService; isOwner: boolean } | { error: string; status: number }> {
  const db = c.get('db');
  const currentUser = c.get('currentUser');

  // Look up by lastfm_username first (canonical), then fall back to username
  let user = await db.getUserByLastfmUsername(username);
  if (!user) {
    user = await db.getUserByUsername(username);
  }

  if (!user || !user.lastfm_username) {
    return { error: 'User not found', status: 404 };
  }

  const isOwner = currentUser?.id === user.id;

  // Check privacy - private profiles only show insights to owner
  if (user.profile_visibility === 'private' && !isOwner) {
    return { error: 'This profile is private', status: 403 };
  }

  const lastfm = new LastfmService({
    apiKey: c.env.LASTFM_API_KEY,
    username: user.lastfm_username,
    cache: c.env.CACHE,
  });

  return { user, lastfm, isOwner };
}

// Check and enforce refresh rate limit
async function checkRefreshRateLimit(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  username: string
): Promise<{ allowed: boolean; cooldownSeconds?: number }> {
  const cacheKey = `insights-refresh:${username.toLowerCase()}`;
  const lastRefresh = await c.env.CACHE.get(cacheKey);

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

// Set refresh timestamp
async function setRefreshTimestamp(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  username: string
): Promise<void> {
  const cacheKey = `insights-refresh:${username.toLowerCase()}`;
  const ttl = getTtlSeconds(CACHE_CONFIG.userInsights.refreshCooldown);
  await c.env.CACHE.put(cacheKey, Date.now().toString(), { expirationTtl: ttl });
}

app.get('/user-insights-summary', async (c) => {
  const username = c.req.query('username');
  const refresh = c.req.query('refresh') === 'true';

  if (!username) {
    return c.json({ error: 'Missing username parameter' }, 400);
  }

  // Check access
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

    const rateLimit = await checkRefreshRateLimit(c, username);
    if (!rateLimit.allowed) {
      return c.json(
        {
          error: 'Please wait before refreshing again',
          cooldown: rateLimit.cooldownSeconds,
        },
        429
      );
    }

    // Clear cache for this user
    const ai = c.get('ai') as AIService;
    await ai.cache.delete('userInsightsSummary', username.toLowerCase());
    await setRefreshTimestamp(c, username);
  }

  try {
    // Fetch listening data
    const [topArtists, topAlbums, recentTracks] = await Promise.all([
      lastfm.getTopArtists('7day', 5).catch(() => []),
      lastfm.getTopAlbums('7day', 5).catch(() => []),
      lastfm.recentTracks.getRecentTracks(20).catch(() => []),
    ]);

    // Check for sparse listening data
    const totalPlays = topArtists.reduce((sum, a) => sum + a.playcount, 0);
    if (totalPlays < MIN_PLAYS_THRESHOLD) {
      return c.json({
        data: null,
        sparse: true,
        message:
          "Looks like you've been taking a break from music lately! 🎧 Get back to listening and check back soon for personalized insights.",
      });
    }

    // Generate summary (cache check happens inside getUserInsightsSummary)
    console.log(`[Insights Summary] Generating summary for ${user.lastfm_username}...`);
    const ai = c.get('ai') as AIService;
    const summary = await ai.getUserInsightsSummary(user.lastfm_username!, {
      topArtists: topArtists.map((a) => ({ name: a.name, playcount: a.playcount })),
      topAlbums: topAlbums.map((a) => ({
        name: a.name,
        artist: a.artist,
        playcount: a.playcount,
      })),
      recentTracks: recentTracks.map((t) => ({ name: t.name, artist: t.artist })),
    });

    return c.json({ data: summary });
  } catch (error) {
    console.error('Internal user-insights-summary error:', error);
    return c.json({ error: 'Failed to generate insights' }, 500);
  }
});

app.get('/user-insights-recommendations', async (c) => {
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
    const [topArtists, topAlbums] = await Promise.all([
      lastfm.getTopArtists('7day', 5).catch((e) => {
        console.error(`[Insights Recs] Failed to fetch top artists:`, e);
        return [];
      }),
      lastfm.getTopAlbums('7day', 5).catch((e) => {
        console.error(`[Insights Recs] Failed to fetch top albums:`, e);
        return [];
      }),
    ]);
    console.log(`[Insights Recs] Got ${topArtists.length} artists, ${topAlbums.length} albums`);

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
          // Search for album on Spotify
          const albumResults = await spotify.search.search(
            `${rec.artistName} ${rec.albumName}`,
            'album',
            1
          );

          if (albumResults.length > 0) {
            const album = albumResults[0];
            spotifyId = album.id;
            albumArt = album.image;
            console.log(`[Insights Recs] Found Spotify album: ${rec.albumName} -> ${album.id}`);
          } else {
            console.log(`[Insights Recs] No Spotify album match for: ${rec.artistName} - ${rec.albumName}`);
          }
        } catch (error) {
          console.error(`[Insights Recs] Error enriching album ${rec.albumName}:`, error);
        }

        try {
          // Search for artist on Spotify
          const artistResults = await spotify.search.search(rec.artistName, 'artist', 1);

          if (artistResults.length > 0) {
            artistSpotifyId = artistResults[0].id;
            console.log(`[Insights Recs] Found Spotify artist: ${rec.artistName} -> ${artistSpotifyId}`);
          }
        } catch (error) {
          console.error(`[Insights Recs] Error enriching artist ${rec.artistName}:`, error);
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
app.get('/user-insights-cooldown', async (c) => {
  const username = c.req.query('username');

  if (!username) {
    return c.json({ error: 'Missing username parameter' }, 400);
  }

  const rateLimit = await checkRefreshRateLimit(c, username);

  return c.json({
    canRefresh: rateLimit.allowed,
    cooldownSeconds: rateLimit.cooldownSeconds || 0,
  });
});

export const insightsInternalRoutes = app;
