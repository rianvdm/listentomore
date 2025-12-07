// Internal user API routes for progressive loading

import { Hono, Context } from 'hono';
import { CACHE_CONFIG, getTtlSeconds } from '@listentomore/config';
import { LastfmService } from '@listentomore/lastfm';
import type { Bindings, Variables } from '../../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Helper to get LastfmService for a user
async function getUserLastfm(c: Context<{ Bindings: Bindings; Variables: Variables }>, username: string) {
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

app.get('/user-recommendations', async (c) => {
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

app.get('/user-listens', async (c) => {
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

app.get('/user-recent-track', async (c) => {
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

app.get('/user-top-artists', async (c) => {
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

app.get('/user-top-albums', async (c) => {
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

export const userInternalRoutes = app;
