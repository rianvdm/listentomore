// Album page handler tests

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { handleAlbumSearch } from '../../pages/album/search';

// Define minimal types for test context
type TestVariables = {
  spotify: unknown;
  db: unknown;
};

describe('Album Handlers', () => {
  let app: Hono<{ Variables: TestVariables }>;

  beforeEach(() => {
    app = new Hono<{ Variables: TestVariables }>();

    // Set up middleware to inject mock services
    app.use('*', async (c, next) => {
      c.set('spotify', null);
      c.set('db', null);
      await next();
    });

    app.get('/album', handleAlbumSearch);
  });

  describe('handleAlbumSearch', () => {
    it('returns search page without query', async () => {
      const res = await app.request('/album');

      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Album');
    });

    it('returns search page with query param preserved', async () => {
      const res = await app.request('/album?q=radiohead');

      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('radiohead');
    });

    it('includes search form', async () => {
      const res = await app.request('/album');
      const html = await res.text();

      expect(html).toContain('<form');
      expect(html).toContain('<input');
    });

    it('includes proper page structure', async () => {
      const res = await app.request('/album');
      const html = await res.text();

      // Check for essential layout elements
      expect(html).toContain('<html');
      expect(html).toContain('<nav');
      expect(html).toContain('<footer');
    });
  });
});
