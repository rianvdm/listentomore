// Internal genre API routes for progressive loading

import { Hono } from 'hono';
import type { Bindings, Variables } from '../../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.get('/genre-summary', async (c) => {
  const name = c.req.query('name');

  if (!name) {
    return c.json({ error: 'Missing name parameter' }, 400);
  }

  try {
    const ai = c.get('ai');
    const result = await ai.getGenreSummary(name);
    return c.json({ data: result });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Internal genre summary error for "${name}":`, errorMessage);
    return c.json({ error: `Failed to generate genre summary: ${errorMessage}` }, 500);
  }
});

export const genreInternalRoutes = app;
