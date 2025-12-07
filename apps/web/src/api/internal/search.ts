// Internal search API routes for progressive loading

import { Hono } from 'hono';
import type { Bindings, Variables } from '../../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.get('/search', async (c) => {
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
app.get('/search-album-by-artist', async (c) => {
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

export const searchInternalRoutes = app;
