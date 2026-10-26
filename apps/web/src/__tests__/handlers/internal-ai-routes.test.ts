// ABOUTME: Tests for the internal AI routes that resolve a Spotify ID server-side.
// ABOUTME: Names like "I'm Like a Virgin..." used to travel in the URL and get challenged by the zone WAF.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Database, Session, User } from '@listentomore/db';
import { albumInternalRoutes } from '../../api/internal/album';
import { artistInternalRoutes } from '../../api/internal/artist';
import { handleAlbumDetail } from '../../pages/album/detail';
import { handleArtistDetail } from '../../pages/artist/detail';
import type { InternalAppContext } from '../../types';

const ALBUM_ID = '6MxGJsAzHR2ekEmelJ7Poy';
const ARTIST_ID = '4Z8W4fKeB5YxbusRsdQVPb';
const USER = { id: 'user-1', username: 'test' } as User;
const SESSION = { id: 'session-1', user_id: USER.id, expires_at: '2999-01-01T00:00:00Z' } as Session;
const SIGNED_IN = { headers: { Cookie: 'ltm_session=token' } };

const album = {
  id: ALBUM_ID,
  name: "I'm Like a Virgin Losing a Child (20th Anniversary Edition)",
  artist: 'Manchester Orchestra',
  artistIds: [ARTIST_ID],
  releaseDate: '2026-07-25',
  url: `https://open.spotify.com/album/${ALBUM_ID}`,
  genres: [],
  tracks: 11,
};
const artist = { id: ARTIST_ID, name: 'Manchester Orchestra', genres: [], url: '', image: null };

function createServices() {
  return {
    db: {
      getSessionByToken: vi.fn().mockResolvedValue(SESSION),
      getUser: vi.fn().mockResolvedValue(USER),
      updateSessionActivity: vi.fn().mockResolvedValue(undefined),
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

describe('internal AI routes resolve Spotify IDs server-side', () => {
  let services: Services;
  let app: Hono<InternalAppContext>;

  beforeEach(() => {
    services = createServices();
    app = buildApp(services);
  });

  describe('/album-summary', () => {
    it('resolves artist, album and release year from the Spotify album', async () => {
      const res = await app.request(`/api/internal/album-summary?spotifyId=${ALBUM_ID}`, SIGNED_IN);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ data: { content: 'summary' } });
      expect(services.spotify.getAlbum).toHaveBeenCalledWith(ALBUM_ID);
      expect(services.ai.getAlbumDetail).toHaveBeenCalledWith(album.artist, album.name, 2026);
    });

    it('omits the release year when Spotify has no release date', async () => {
      services.spotify.getAlbum.mockResolvedValue({ ...album, releaseDate: undefined });

      const res = await app.request(`/api/internal/album-summary?spotifyId=${ALBUM_ID}`, SIGNED_IN);

      expect(res.status).toBe(200);
      expect(services.ai.getAlbumDetail).toHaveBeenCalledWith(album.artist, album.name, undefined);
    });

    it('returns 400 without calling Spotify when spotifyId is missing', async () => {
      const res = await app.request('/api/internal/album-summary', SIGNED_IN);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Missing spotifyId parameter' });
      expect(services.spotify.getAlbum).not.toHaveBeenCalled();
    });

    it('rejects the old artist/album parameters as a missing spotifyId', async () => {
      const res = await app.request(
        '/api/internal/album-summary?artist=Manchester%20Orchestra&album=Mean%20Everything',
        SIGNED_IN
      );

      expect(res.status).toBe(400);
      expect(services.ai.getAlbumDetail).not.toHaveBeenCalled();
    });

    it('returns 400 for a value that is not shaped like a Spotify ID', async () => {
      const res = await app.request('/api/internal/album-summary?spotifyId=radiohead_ok-computer', SIGNED_IN);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid spotifyId parameter' });
      expect(services.spotify.getAlbum).not.toHaveBeenCalled();
    });

    it('returns 404 when Spotify does not know the album', async () => {
      services.spotify.getAlbum.mockRejectedValue(new Error(`Album not found: ${ALBUM_ID}`));

      const res = await app.request(`/api/internal/album-summary?spotifyId=${ALBUM_ID}`, SIGNED_IN);

      expect(res.status).toBe(404);
      expect(services.ai.getAlbumDetail).not.toHaveBeenCalled();
    });

    it('returns 502 when the Spotify lookup fails for another reason', async () => {
      services.spotify.getAlbum.mockRejectedValue(new Error('Spotify API error: 429'));

      const res = await app.request(`/api/internal/album-summary?spotifyId=${ALBUM_ID}`, SIGNED_IN);

      expect(res.status).toBe(502);
      expect(services.ai.getAlbumDetail).not.toHaveBeenCalled();
    });

    it('still requires a session before touching Spotify', async () => {
      const res = await app.request(`/api/internal/album-summary?spotifyId=${ALBUM_ID}`);

      expect(res.status).toBe(401);
      expect(services.spotify.getAlbum).not.toHaveBeenCalled();
    });
  });

  describe('/album-recommendations', () => {
    it('resolves artist and album from the Spotify album', async () => {
      const res = await app.request(`/api/internal/album-recommendations?spotifyId=${ALBUM_ID}`, SIGNED_IN);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ data: { content: 'recs' } });
      expect(services.ai.getAlbumRecommendations).toHaveBeenCalledWith(album.artist, album.name);
    });

    it('returns 400 when spotifyId is missing', async () => {
      const res = await app.request('/api/internal/album-recommendations', SIGNED_IN);

      expect(res.status).toBe(400);
      expect(services.ai.getAlbumRecommendations).not.toHaveBeenCalled();
    });
  });

  describe('/artist-summary', () => {
    it('resolves the artist name from the Spotify artist', async () => {
      const res = await app.request(`/api/internal/artist-summary?spotifyId=${ARTIST_ID}`, SIGNED_IN);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ data: { text: 'artist summary' } });
      expect(services.spotify.getArtist).toHaveBeenCalledWith(ARTIST_ID);
      expect(services.ai.getArtistSummary).toHaveBeenCalledWith(artist.name);
    });

    it('returns 400 without calling Spotify when spotifyId is missing', async () => {
      const res = await app.request('/api/internal/artist-summary?name=Manchester%20Orchestra', SIGNED_IN);

      expect(res.status).toBe(400);
      expect(services.spotify.getArtist).not.toHaveBeenCalled();
    });

    it('returns 404 when Spotify does not know the artist', async () => {
      services.spotify.getArtist.mockRejectedValue(new Error(`Artist not found: ${ARTIST_ID}`));

      const res = await app.request(`/api/internal/artist-summary?spotifyId=${ARTIST_ID}`, SIGNED_IN);

      expect(res.status).toBe(404);
      expect(services.ai.getArtistSummary).not.toHaveBeenCalled();
    });
  });
});

describe('detail pages call the AI routes by Spotify ID', () => {
  type PageVariables = { spotify: unknown; currentUser: unknown; internalToken: string };

  function buildPageApp(services: Services) {
    const app = new Hono<{ Variables: PageVariables }>();
    app.use('*', async (c, next) => {
      c.set('spotify', services.spotify);
      c.set('currentUser', USER);
      c.set('internalToken', 'test-token');
      await next();
    });
    app.get('/album/:id', handleAlbumDetail);
    app.get('/artist/:id', handleArtistDetail);
    return app;
  }

  it('album page requests summary and recommendations with the album ID, not the names', async () => {
    const res = await buildPageApp(createServices()).request(`/album/${ALBUM_ID}`);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain("'/api/internal/album-summary' + aiQuery");
    expect(html).toContain("'/api/internal/album-recommendations' + aiQuery");
    expect(html).not.toContain('album-summary?artist=');
    expect(html).not.toContain('album-recommendations?artist=');
  });

  it('artist page requests the summary with the artist ID, not the name', async () => {
    const res = await buildPageApp(createServices()).request(`/artist/${ARTIST_ID}`);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain("'/api/internal/artist-summary?spotifyId=' + encodeURIComponent(artistId)");
    expect(html).not.toContain('artist-summary?name=');
  });
});
