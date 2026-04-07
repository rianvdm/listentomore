// requireSessionAuth middleware tests

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requireSessionAuth } from '../../middleware/require-session-auth';

type TestVariables = {
  currentUser: any;
  isAuthenticated: boolean;
};

describe('requireSessionAuth', () => {
  let app: Hono<{ Variables: TestVariables }>;

  describe('when user is authenticated', () => {
    beforeEach(() => {
      app = new Hono<{ Variables: TestVariables }>();
      app.use('*', async (c, next) => {
        c.set('currentUser', { id: '1', username: 'test' });
        c.set('isAuthenticated', true);
        await next();
      });
      app.get('/api/internal/album-summary', requireSessionAuth, (c) =>
        c.json({ data: 'summary' })
      );
    });

    it('passes through to the handler', async () => {
      const res = await app.request('/api/internal/album-summary');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ data: 'summary' });
    });
  });

  describe('when user is not authenticated', () => {
    beforeEach(() => {
      app = new Hono<{ Variables: TestVariables }>();
      app.use('*', async (c, next) => {
        c.set('currentUser', null);
        c.set('isAuthenticated', false);
        await next();
      });
      app.get('/api/internal/album-summary', requireSessionAuth, (c) =>
        c.json({ data: 'summary' })
      );
    });

    it('returns 401 with error message', async () => {
      const res = await app.request('/api/internal/album-summary');
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json).toEqual({ error: 'Authentication required' });
    });
  });
});
