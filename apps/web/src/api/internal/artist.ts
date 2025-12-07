// Internal artist API routes for progressive loading

import { Hono } from 'hono';
import type { Bindings, Variables } from '../../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.get('/artist-summary', async (c) => {
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

app.get('/artist-lastfm', async (c) => {
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
    console.error('Internal artist sentence error:', error);
    return c.json({ error: 'Failed to generate artist sentence' }, 500);
  }
});

export const artistInternalRoutes = app;
