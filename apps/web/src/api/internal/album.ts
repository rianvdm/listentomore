// ABOUTME: Internal album AI routes for progressive loading (summary and recommendations).
// ABOUTME: Both take a Spotify album ID and resolve the names server-side, so free text never travels in the URL.

import { Hono } from 'hono';
import type { InternalAppContext } from '../../types';
import { requireSessionAuth } from '../../middleware/require-session-auth';
import { resolveSpotifyAlbum } from './spotify-lookup';

const app = new Hono<InternalAppContext>();

app.get('/album-summary', requireSessionAuth, async (c) => {
  const resolved = await resolveSpotifyAlbum(c);
  if (!resolved.ok) {
    return resolved.response;
  }
  const { artist, name, releaseYear } = resolved.value;

  try {
    const ai = c.get('ai');
    const result = await ai.getAlbumDetail(artist, name, releaseYear);
    return c.json({ data: result });
  } catch (error) {
    console.error('Internal album summary error:', error);
    return c.json({ error: 'Failed to generate album summary' }, 500);
  }
});

app.get('/album-recommendations', requireSessionAuth, async (c) => {
  const resolved = await resolveSpotifyAlbum(c);
  if (!resolved.ok) {
    return resolved.response;
  }
  const { artist, name } = resolved.value;

  try {
    const ai = c.get('ai');
    const result = await ai.getAlbumRecommendations(artist, name);
    return c.json({ data: result });
  } catch (error) {
    console.error('Internal album recommendations error:', error);
    return c.json({ error: 'Failed to generate album recommendations' }, 500);
  }
});

export const albumInternalRoutes = app;
