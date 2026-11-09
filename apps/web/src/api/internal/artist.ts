// ABOUTME: Internal artist routes for progressive loading: the AI summary (signed-in only), Last.fm data
// ABOUTME: and the one-line artist sentence. The summary route also records the artist's page for the sitemap.

import { Hono } from 'hono';
import { aiCacheKey, RegionUnsupportedError } from '@listentomore/ai';
import type { InternalAppContext } from '../../types';
import { requireSessionAuth } from '../../middleware/require-session-auth';
import { getCurrentUser } from '../../middleware/session';
import { recordEntityPage } from './entity-pages';
import { resolveSpotifyArtist } from './spotify-lookup';

const app = new Hono<InternalAppContext>();

// Takes a Spotify artist ID and resolves the name server-side; see spotify-lookup.ts.
app.get('/artist-summary', requireSessionAuth, async (c) => {
  const resolved = await resolveSpotifyArtist(c);
  if (!resolved.ok) {
    return resolved.response;
  }
  const { spotifyId, name } = resolved.value;

  try {
    const ai = c.get('ai');
    const result = await ai.getArtistSummary(name);
    recordEntityPage(c, {
      cacheKey: aiCacheKey('artistSummary', name),
      type: 'artist',
      path: `/artist/${spotifyId}`,
    });
    return c.json({ data: result });
  } catch (error) {
    console.error('Internal artist summary error:', error);
    return c.json({ error: 'Failed to generate artist summary' }, 500);
  }
});

// No requireSessionAuth — Last.fm artist data is public and does not consume AI quota.
// The play count is only ever the signed-in user's own, taken from the session rather than
// the query string, so a caller can't read another user's count.
app.get('/artist-lastfm', async (c) => {
  const name = c.req.query('name');

  if (!name) {
    return c.json({ error: 'Missing name parameter' }, 400);
  }

  try {
    const lastfm = c.get('lastfm');
    const user = await getCurrentUser(c);
    // Fetch artist detail and top albums in parallel
    const [artistDetail, topAlbums] = await Promise.all([
      lastfm.getArtistDetail(name, user?.lastfm_username || undefined),
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

// No requireSessionAuth — artist sentences are short, cheap, and used on public home page
app.get('/artist-sentence', async (c) => {
  const name = c.req.query('name');

  if (!name) {
    return c.json({ error: 'Missing name parameter' }, 400);
  }

  try {
    const ai = c.get('ai');
    const result = await ai.getArtistSentence(name);
    return c.json({ data: result });
  } catch (error) {
    // OpenAI refuses visitors' regions it doesn't serve (e.g. CN, RU); omit the sentence.
    if (error instanceof RegionUnsupportedError) {
      console.warn('Internal artist sentence skipped: provider does not serve this region');
      return c.json({ data: null });
    }
    console.error('Internal artist sentence error:', error);
    return c.json({ error: 'Failed to generate artist sentence' }, 500);
  }
});

export const artistInternalRoutes = app;
