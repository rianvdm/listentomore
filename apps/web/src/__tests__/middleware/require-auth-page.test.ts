// requireAuthPage middleware tests

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requireAuthPage } from '../../middleware/require-auth-page';

type TestVariables = {
  currentUser: any;
  isAuthenticated: boolean;
};

describe('requireAuthPage', () => {
  let app: Hono<{ Variables: TestVariables }>;

  describe('when user is authenticated', () => {
    beforeEach(() => {
      app = new Hono<{ Variables: TestVariables }>();
      app.use('*', async (c, next) => {
        c.set('currentUser', { id: '1', username: 'test' });
        c.set('isAuthenticated', true);
        await next();
      });
      app.get('/protected', requireAuthPage, (c) => c.text('protected content'));
    });

    it('passes through to the handler', async () => {
      const res = await app.request('/protected');
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toBe('protected content');
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
      app.get('/protected', requireAuthPage, (c) => c.text('protected content'));
    });

    it('returns 200 with sign-in CTA instead of handler content', async () => {
      const res = await app.request('/protected');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Sign in to unlock more');
      expect(html).not.toContain('protected content');
    });

    it('includes login link with return URL', async () => {
      const res = await app.request('/protected');
      const html = await res.text();
      expect(html).toContain('/login?next=%2Fprotected');
    });
  });
});
