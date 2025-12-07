// Internal album API routes for progressive loading

import { Hono } from 'hono';
import type { Bindings, Variables } from '../../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.get('/album-summary', async (c) => {
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

app.get('/album-recommendations', async (c) => {
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
