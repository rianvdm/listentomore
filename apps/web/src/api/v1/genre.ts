// GET /api/v1/genre - Get AI-generated genre summary

import { Hono } from 'hono';
import type { Bindings, Variables } from '../../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.get('/', async (c) => {
  const query = c.req.query('q');

  if (!query) {
    return c.json({ error: 'Missing required parameter: q' }, 400);
  }

  try {
    const ai = c.get('ai');

    // Normalize genre name to slug format
    const slug = query.toLowerCase().trim().replace(/\s+/g, '-');

    const result = await ai.getGenreSummary(query);

    return c.json({
      data: {
        name: query,
        slug,
        url: `https://listentomore.com/genre/${slug}`,
        summary: {
          content: result.content,
          citations: result.citations,
          metadata: result.metadata,
        },
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('v1 genre error:', errorMessage, error);
    return c.json({ error: 'Failed to fetch genre summary', details: errorMessage }, 500);
  }
});

export const genreRoutes = app;
