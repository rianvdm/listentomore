// ABOUTME: Tests for /api/internal/artist-lastfm - the play count must belong to the signed-in user.
// ABOUTME: A username in the query string is ignored, so nobody can read another user's count.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Database, Session, User } from '@listentomore/db';
import { artistInternalRoutes } from '../../api/internal/artist';
import type { InternalAppContext } from '../../types';

const USER = { id: 'user-1', lastfm_username: 'signed-in-user' } as User;
const SESSION = { id: 'session-1', user_id: USER.id, expires_at: '2999-01-01T00:00:00Z' } as Session;
const SIGNED_IN = { headers: { Cookie: 'ltm_session=token' } };

function createServices(user: User = USER) {
  return {
    db: {
      getSessionByToken: vi.fn().mockResolvedValue(SESSION),
      getUser: vi.fn().mockResolvedValue(user),
      updateSessionActivity: vi.fn().mockResolvedValue(undefined),
    },
    lastfm: {
      getArtistDetail: vi.fn().mockResolvedValue({ name: 'Radiohead', tags: [] }),
      getArtistTopAlbums: vi.fn().mockResolvedValue([{ name: 'OK Computer' }]),
    },
  };
}

type Services = ReturnType<typeof createServices>;

function buildApp(services: Services) {
  const app = new Hono<InternalAppContext>();
  app.use('*', async (c, next) => {
    c.set('db', services.db as unknown as Database);
    c.set('lastfm', services.lastfm as never);
    await next();
  });
  app.route('/api/internal', artistInternalRoutes);
  return app;
}

describe('/api/internal/artist-lastfm', () => {
  let services: Services;
  let app: Hono<InternalAppContext>;

  beforeEach(() => {
    services = createServices();
    app = buildApp(services);
  });

  it('uses the signed-in user for the play count and ignores a username in the query', async () => {
    const res = await app.request('/api/internal/artist-lastfm?name=Radiohead&username=someone-else', SIGNED_IN);

    expect(res.status).toBe(200);
    expect(services.lastfm.getArtistDetail).toHaveBeenCalledWith('Radiohead', 'signed-in-user');
  });

  it('asks for no play count when signed out, even if a username is supplied', async () => {
    const res = await app.request('/api/internal/artist-lastfm?name=Radiohead&username=someone-else');

    expect(res.status).toBe(200);
    expect(services.lastfm.getArtistDetail).toHaveBeenCalledWith('Radiohead', undefined);
    expect(services.db.getSessionByToken).not.toHaveBeenCalled();
  });

  it('asks for no play count when the signed-in user has no Last.fm username', async () => {
    services = createServices({ ...USER, lastfm_username: null });
    app = buildApp(services);

    const res = await app.request('/api/internal/artist-lastfm?name=Radiohead&username=someone-else', SIGNED_IN);

    expect(res.status).toBe(200);
    expect(services.lastfm.getArtistDetail).toHaveBeenCalledWith('Radiohead', undefined);
  });

  it('still returns public artist data with top albums', async () => {
    const res = await app.request('/api/internal/artist-lastfm?name=Radiohead');

    expect(await res.json()).toEqual({
      data: { name: 'Radiohead', tags: [], topAlbums: ['OK Computer'] },
    });
  });

  it('rejects a missing artist name', async () => {
    const res = await app.request('/api/internal/artist-lastfm');

    expect(res.status).toBe(400);
  });
});
