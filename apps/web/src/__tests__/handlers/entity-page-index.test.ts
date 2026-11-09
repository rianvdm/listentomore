// ABOUTME: Tests that the album and artist summary routes record which page each AI cache key belongs to.
// ABOUTME: The row is written off the response path, only after a successful summary, and never fails the request.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { Database, Session, User } from '@listentomore/db';
import { albumInternalRoutes } from '../../api/internal/album';
import { artistInternalRoutes } from '../../api/internal/artist';
import type { InternalAppContext } from '../../types';

const ALBUM_ID = '6dVIqQ8qmQ5GBnJ9shOYGE';
const ARTIST_ID = '4Z8W4fKeB5YxbusRsdQVPb';
const USER = { id: 'user-1', username: 'test' } as User;
const SESSION = { id: 'session-1', user_id: USER.id, expires_at: '2999-01-01T00:00:00Z' } as Session;
const SIGNED_IN = { headers: { Cookie: 'ltm_session=token' } };

// Spotify casing; the cache key must come out lowercased like the generator writes it.
const album = {
  id: ALBUM_ID,
  name: 'OK Computer',
  artist: 'Radiohead',
  artistIds: [ARTIST_ID],
  releaseDate: '1997-05-21',
  url: `https://open.spotify.com/album/${ALBUM_ID}`,
  genres: [],
  tracks: 12,
};
const artist = { id: ARTIST_ID, name: 'Radiohead', genres: [], url: '', image: null };

function createServices() {
  return {
    db: {
      getSessionByToken: vi.fn().mockResolvedValue(SESSION),
      getUser: vi.fn().mockResolvedValue(USER),
      updateSessionActivity: vi.fn().mockResolvedValue(undefined),
      upsertEntityPage: vi.fn().mockResolvedValue(undefined),
    },
    spotify: {
      getAlbum: vi.fn().mockResolvedValue(album),
      getArtist: vi.fn().mockResolvedValue(artist),
    },
    ai: {
      getAlbumDetail: vi.fn().mockResolvedValue({ content: 'summary' }),
      getAlbumRecommendations: vi.fn().mockResolvedValue({ content: 'recs' }),
      getArtistSummary: vi.fn().mockResolvedValue({ text: 'artist summary' }),
    },
  };
}

type Services = ReturnType<typeof createServices>;

function buildApp(services: Services) {
  const app = new Hono<InternalAppContext>();
  app.use('*', async (c, next) => {
    c.set('db', services.db as unknown as Database);
    c.set('spotify', services.spotify as never);
    c.set('ai', services.ai as never);
    await next();
  });
  app.route('/api/internal', albumInternalRoutes);
  app.route('/api/internal', artistInternalRoutes);
  return app;
}

function createExecutionContext() {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext & { waitUntil: ReturnType<typeof vi.fn> };
}

// Session auth also hands its activity UPDATE to waitUntil, so compare against a route that records nothing.
async function countWaitUntilCalls(app: Hono<InternalAppContext>, path: string): Promise<number> {
  const ctx = createExecutionContext();
  const res = await app.request(path, SIGNED_IN, {}, ctx);
  expect(res.status).toBe(200);
  return ctx.waitUntil.mock.calls.length;
}

const BASELINE_PATH = `/api/internal/album-recommendations?spotifyId=${ALBUM_ID}`;

describe('entity page index', () => {
  let services: Services;
  let app: Hono<InternalAppContext>;

  beforeEach(() => {
    services = createServices();
    app = buildApp(services);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('/album-summary', () => {
    it('records the album page under the normalised albumDetail cache key', async () => {
      const res = await app.request(`/api/internal/album-summary?spotifyId=${ALBUM_ID}`, SIGNED_IN);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ data: { content: 'summary' } });
      expect(services.db.upsertEntityPage).toHaveBeenCalledTimes(1);
      expect(services.db.upsertEntityPage).toHaveBeenCalledWith({
        cacheKey: 'ai:albumDetail:radiohead:ok computer',
        type: 'album',
        path: `/album/${ALBUM_ID}`,
      });
    });

    it('hands the upsert to waitUntil when an execution context exists', async () => {
      const baseline = await countWaitUntilCalls(app, BASELINE_PATH);

      const calls = await countWaitUntilCalls(app, `/api/internal/album-summary?spotifyId=${ALBUM_ID}`);

      expect(calls).toBe(baseline + 1);
    });

    it('does not record a page when the AI call fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      services.ai.getAlbumDetail.mockRejectedValue(new Error('model unavailable'));

      const res = await app.request(`/api/internal/album-summary?spotifyId=${ALBUM_ID}`, SIGNED_IN);

      expect(res.status).toBe(500);
      expect(services.db.upsertEntityPage).not.toHaveBeenCalled();
    });

    it('does not record a page when the Spotify lookup fails', async () => {
      services.spotify.getAlbum.mockResolvedValue(null);

      const res = await app.request(`/api/internal/album-summary?spotifyId=${ALBUM_ID}`, SIGNED_IN);

      expect(res.status).toBe(404);
      expect(services.db.upsertEntityPage).not.toHaveBeenCalled();
    });

    it('still returns the summary and logs when the upsert rejects', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      services.db.upsertEntityPage.mockRejectedValue(new Error('D1_ERROR: no such table: entity_pages'));

      const res = await app.request(`/api/internal/album-summary?spotifyId=${ALBUM_ID}`, SIGNED_IN);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ data: { content: 'summary' } });
      await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
      expect(errorSpy).toHaveBeenCalledWith(
        '[Entity pages] Deferred album page upsert failed:',
        'D1_ERROR: no such table: entity_pages',
        expect.any(Error)
      );
    });
    it('still returns the summary when the upsert throws synchronously', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      services.db.upsertEntityPage.mockImplementation(() => {
        throw new Error('D1 binding missing');
      });

      const res = await app.request(`/api/internal/album-summary?spotifyId=${ALBUM_ID}`, SIGNED_IN);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ data: { content: 'summary' } });
      await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
      expect(errorSpy).toHaveBeenCalledWith(
        '[Entity pages] Deferred album page upsert failed:',
        'D1 binding missing',
        expect.any(Error)
      );
    });
  });

  describe('/album-recommendations', () => {
    it('does not record a page', async () => {
      const res = await app.request(`/api/internal/album-recommendations?spotifyId=${ALBUM_ID}`, SIGNED_IN);

      expect(res.status).toBe(200);
      expect(services.db.upsertEntityPage).not.toHaveBeenCalled();
    });
  });

  describe('/artist-summary', () => {
    it('records the artist page under the normalised artistSummary cache key', async () => {
      const res = await app.request(`/api/internal/artist-summary?spotifyId=${ARTIST_ID}`, SIGNED_IN);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ data: { text: 'artist summary' } });
      expect(services.db.upsertEntityPage).toHaveBeenCalledTimes(1);
      expect(services.db.upsertEntityPage).toHaveBeenCalledWith({
        cacheKey: 'ai:artistSummary:radiohead',
        type: 'artist',
        path: `/artist/${ARTIST_ID}`,
      });
    });

    it('hands the upsert to waitUntil when an execution context exists', async () => {
      const baseline = await countWaitUntilCalls(app, BASELINE_PATH);

      const calls = await countWaitUntilCalls(app, `/api/internal/artist-summary?spotifyId=${ARTIST_ID}`);

      expect(calls).toBe(baseline + 1);
    });

    it('does not record a page when the AI call fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      services.ai.getArtistSummary.mockRejectedValue(new Error('model unavailable'));

      const res = await app.request(`/api/internal/artist-summary?spotifyId=${ARTIST_ID}`, SIGNED_IN);

      expect(res.status).toBe(500);
      expect(services.db.upsertEntityPage).not.toHaveBeenCalled();
    });

    it('still returns the summary and logs when the upsert rejects', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      services.db.upsertEntityPage.mockRejectedValue(new Error('D1_ERROR: timeout'));

      const res = await app.request(`/api/internal/artist-summary?spotifyId=${ARTIST_ID}`, SIGNED_IN);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ data: { text: 'artist summary' } });
      await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
      expect(errorSpy).toHaveBeenCalledWith(
        '[Entity pages] Deferred artist page upsert failed:',
        'D1_ERROR: timeout',
        expect.any(Error)
      );
    });
  });
});
