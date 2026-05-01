// Internal album API routes for progressive loading

import { Hono } from 'hono';
import type { Bindings, Variables } from '../../types';
import { requireSessionAuth } from '../../middleware/require-session-auth';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.get('/album-summary', requireSessionAuth, async (c) => {
  const artist = c.req.query('artist');
  const album = c.req.query('album');
  const releaseYearParam = c.req.query('releaseYear');

  if (!artist || !album) {
    return c.json({ error: 'Missing artist or album parameter' }, 400);
  }

  const releaseYear = releaseYearParam
    ? parseInt(releaseYearParam, 10)
    : undefined;

  try {
    const ai = c.get('ai');
    const result = await ai.getAlbumDetail(
      artist,
      album,
      Number.isFinite(releaseYear) ? releaseYear : undefined
    );
    return c.json({ data: result });
  } catch (error) {
    console.error('Internal album summary error:', error);
    return c.json({ error: 'Failed to generate album summary' }, 500);
  }
});

app.get('/album-recommendations', requireSessionAuth, async (c) => {
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

export const albumInternalRoutes = app;
