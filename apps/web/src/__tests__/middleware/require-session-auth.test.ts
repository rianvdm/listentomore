// ABOUTME: Tests for requireSessionAuth, the session guard on AI-powered internal routes.
// ABOUTME: The guard loads the session itself, because /api/internal/* skips the eager lookup.

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import type { Database, Session, User } from '@listentomore/db';
import { requireSessionAuth } from '../../middleware/require-session-auth';
import type { InternalAppContext } from '../../types';

const USER = { id: 'user-1', username: 'test' } as User;
const SESSION = { id: 'session-1', user_id: USER.id, expires_at: '2999-01-01T00:00:00Z' } as Session;

function buildApp(db: Partial<Database>) {
  const app = new Hono<InternalAppContext>();
  app.use('*', async (c, next) => {
    c.set('db', db as Database);
    await next();
  });
  app.get('/api/internal/album-summary', requireSessionAuth, (c) => c.json({ data: 'summary' }));
  return app;
}

function createDb(session: Session | null) {
  return {
    getSessionByToken: vi.fn().mockResolvedValue(session),
    getUser: vi.fn().mockResolvedValue(USER),
    updateSessionActivity: vi.fn().mockResolvedValue(undefined),
  };
}

describe('requireSessionAuth', () => {
  it('passes a request with a valid session through to the handler', async () => {
    const db = createDb(SESSION);

    const res = await buildApp(db).request('/api/internal/album-summary', {
      headers: { Cookie: 'ltm_session=token' },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: 'summary' });
    expect(db.getSessionByToken).toHaveBeenCalledTimes(1);
  });

  it('returns 401 when there is no session cookie, without querying D1', async () => {
    const db = createDb(SESSION);

    const res = await buildApp(db).request('/api/internal/album-summary');

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Authentication required' });
    expect(db.getSessionByToken).not.toHaveBeenCalled();
  });

  it('returns 401 when the session cookie matches no session', async () => {
    const db = createDb(null);

    const res = await buildApp(db).request('/api/internal/album-summary', {
      headers: { Cookie: 'ltm_session=stale' },
    });

    expect(res.status).toBe(401);
    expect(db.getUser).not.toHaveBeenCalled();
  });

  it('reuses a session lookup that already ran for this request', async () => {
    const db = createDb(SESSION);
    const app = new Hono<InternalAppContext>();
    app.use('*', async (c, next) => {
      c.set('db', db as unknown as Database);
      c.set('sessionLookup', Promise.resolve(USER));
      await next();
    });
    app.get('/api/internal/album-summary', requireSessionAuth, (c) => c.json({ data: 'summary' }));

    const res = await app.request('/api/internal/album-summary', {
      headers: { Cookie: 'ltm_session=token' },
    });

    expect(res.status).toBe(200);
    expect(db.getSessionByToken).not.toHaveBeenCalled();
  });
});
