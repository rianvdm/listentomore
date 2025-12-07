// Admin endpoints for cache management (requires premium API key)
// Supports: albumDetail, artistSummary, artistSentence, genreSummary, spotify:album, spotify:artist

import { Hono } from 'hono';
import { requireAuth } from '../../middleware/auth';
import type { Bindings, Variables } from '../../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Delete cache entries
app.delete('/', requireAuth({ minTier: 'premium' }), async (c) => {
  const type = c.req.query('type');
  const cache = c.env.CACHE;

  if (!type) {
    return c.json({
      error: 'Missing type parameter',
      supportedTypes: ['albumDetail', 'artistSummary', 'artistSentence', 'genreSummary', 'spotify:album', 'spotify:artist'],
      examples: [
        '/api/cache?type=albumDetail&artist=radiohead&album=ok%20computer',
        '/api/cache?type=artistSummary&artist=radiohead',
        '/api/cache?type=artistSentence&artist=beck',
        '/api/cache?type=genreSummary&genre=shoegaze',
        '/api/cache?type=spotify:album&id=abc123',
      ],
    }, 400);
  }

  try {
    let key: string;
    let deleted = false;

    switch (type) {
      case 'albumDetail': {
        const artist = c.req.query('artist');
        const album = c.req.query('album');
        if (!artist || !album) {
          return c.json({ error: 'Missing artist or album parameter' }, 400);
        }
        key = `ai:albumDetail:${artist.toLowerCase().trim()}:${album.toLowerCase().trim()}`;
        break;
      }
      case 'artistSummary': {
        const artist = c.req.query('artist');
        if (!artist) {
          return c.json({ error: 'Missing artist parameter' }, 400);
        }
        key = `ai:artistSummary:${artist.toLowerCase().trim()}`;
        break;
      }
      case 'artistSentence': {
        const artist = c.req.query('artist');
        if (!artist) {
          return c.json({ error: 'Missing artist parameter' }, 400);
        }
        key = `ai:artistSentence:${artist.toLowerCase().trim()}`;
        break;
      }
      case 'genreSummary': {
        const genre = c.req.query('genre');
        if (!genre) {
          return c.json({ error: 'Missing genre parameter' }, 400);
        }
        key = `ai:genreSummary:${genre.toLowerCase().trim()}`;
        break;
      }
      case 'spotify:album': {
        const id = c.req.query('id');
        if (!id) {
          return c.json({ error: 'Missing id parameter' }, 400);
        }
        // Delete both v1 and v2 cache keys
        await cache.delete(`spotify:album:${id}`);
        await cache.delete(`spotify:album:v2:${id}`);
        return c.json({
          message: 'Cache entries deleted',
          keys: [`spotify:album:${id}`, `spotify:album:v2:${id}`],
        });
      }
      case 'spotify:artist': {
        const id = c.req.query('id');
        if (!id) {
          return c.json({ error: 'Missing id parameter' }, 400);
        }
        key = `spotify:artist:${id}`;
        break;
      }
      default:
        return c.json({
          error: 'Unknown cache type',
          supportedTypes: ['albumDetail', 'artistSummary', 'artistSentence', 'genreSummary', 'spotify:album', 'spotify:artist'],
        }, 400);
    }

    // Check if key exists before deleting
    const existing = await cache.get(key);
    if (existing) {
      await cache.delete(key);
      deleted = true;
    }

    return c.json({
      message: deleted ? 'Cache entry deleted' : 'Cache entry not found',
      key,
      deleted,
    });
  } catch (error) {
    console.error('Cache delete error:', error);
    return c.json({ error: 'Failed to delete cache entry' }, 500);
  }
});

// List cache keys by prefix
app.get('/', requireAuth({ minTier: 'premium' }), async (c) => {
  const prefix = c.req.query('prefix') || 'ai:';
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 100);
  const cache = c.env.CACHE;

  try {
    const list = await cache.list({ prefix, limit });
    return c.json({
      keys: list.keys.map((k) => ({
        name: k.name,
        expiration: k.expiration ? new Date(k.expiration * 1000).toISOString() : null,
      })),
      count: list.keys.length,
      complete: list.list_complete,
    });
  } catch (error) {
    console.error('Cache list error:', error);
    return c.json({ error: 'Failed to list cache entries' }, 500);
  }
});

export const cacheAdminRoutes = app;
