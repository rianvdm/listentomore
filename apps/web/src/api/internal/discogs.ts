// Internal API routes for Discogs collection data
// Used for progressive loading of collection stats and releases

import { Hono } from 'hono';
import type { Bindings, Variables } from '../../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// GET /api/internal/discogs-collection - Get full collection for a user
app.get('/discogs-collection', async (c) => {
  const username = c.req.query('username');
  if (!username) {
    return c.json({ error: 'Username required' }, 400);
  }

  const db = c.get('db');
  const user = await db.getUserByUsername(username);

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  if (!user.discogs_username) {
    return c.json({ error: 'User has not connected Discogs' }, 404);
  }

  // Get cached collection
  const discogs = c.get('discogs');
  const cached = await discogs.getCachedCollection(user.id);

  if (!cached) {
    return c.json({ error: 'Collection not synced yet. Please sync your collection first.' }, 404);
  }

  return c.json({ data: cached });
});

// GET /api/internal/discogs-stats - Get collection statistics only
app.get('/discogs-stats', async (c) => {
  const username = c.req.query('username');
  if (!username) {
    return c.json({ error: 'Username required' }, 400);
  }

  const db = c.get('db');
  const user = await db.getUserByUsername(username);

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  if (!user.discogs_username) {
    return c.json({ error: 'User has not connected Discogs' }, 404);
  }

  const discogs = c.get('discogs');
  const stats = await discogs.getCollectionStats(user.id);

  if (!stats) {
    return c.json({ error: 'Collection not synced yet' }, 404);
  }

  return c.json({ data: stats });
});

// POST /api/internal/discogs-sync - Trigger collection sync
app.post('/discogs-sync', async (c) => {
  const username = c.req.query('username');
  if (!username) {
    return c.json({ error: 'Username required' }, 400);
  }

  const db = c.get('db');
  const user = await db.getUserByUsername(username);

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  if (!user.discogs_username) {
    return c.json({ error: 'User has not connected Discogs' }, 400);
  }

  // Check sync cooldown (4 hours)
  const lastSyncKey = `discogs:last-sync:${user.id}`;
  const lastSync = await c.env.CACHE.get(lastSyncKey);

  if (lastSync) {
    const lastSyncTime = parseInt(lastSync, 10);
    const cooldownMs = 4 * 60 * 60 * 1000; // 4 hours
    const elapsed = Date.now() - lastSyncTime;

    if (elapsed < cooldownMs) {
      const remainingHours = Math.ceil((cooldownMs - elapsed) / (60 * 60 * 1000));
      return c.json(
        { error: `Please wait ${remainingHours} hour(s) before syncing again` },
        429
      );
    }
  }

  try {
    const discogs = c.get('discogs');
    const result = await discogs.syncCollection(user.id, user.discogs_username);

    // Set last sync timestamp
    await c.env.CACHE.put(lastSyncKey, Date.now().toString(), {
      expirationTtl: 86400, // 24 hours
    });

    return c.json({
      data: {
        success: true,
        releaseCount: result.releaseCount,
        lastSynced: result.lastSynced,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Discogs sync failed:', errorMessage, error);
    return c.json({ error: 'Failed to sync collection' }, 500);
  }
});

// GET /api/internal/discogs-releases - Get filtered releases
app.get('/discogs-releases', async (c) => {
  const username = c.req.query('username');
  if (!username) {
    return c.json({ error: 'Username required' }, 400);
  }

  const db = c.get('db');
  const user = await db.getUserByUsername(username);

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  if (!user.discogs_username) {
    return c.json({ error: 'User has not connected Discogs' }, 404);
  }

  // Parse filter params
  const filters = {
    genre: c.req.query('genre') || undefined,
    format: c.req.query('format') || undefined,
    decade: c.req.query('decade') || undefined,
    style: c.req.query('style') || undefined,
    search: c.req.query('search') || undefined,
  };

  const discogs = c.get('discogs');
  const releases = await discogs.getFilteredReleases(user.id, filters);

  return c.json({
    data: {
      releases,
      count: releases.length,
    },
  });
});

export const discogsInternalRoutes = app;
