// ABOUTME: Tests that artist/album detail routes 404 legacy slug URLs.
// ABOUTME: Slugs must never reach Spotify (it returns 400, which we used to render as a 200 error page).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { handleArtistDetail } from '../../pages/artist/detail';
import { handleAlbumDetail } from '../../pages/album/detail';

type TestVariables = {
  spotify: unknown;
  currentUser: unknown;
  internalToken: string;
};

describe('Detail routes with non-Spotify IDs', () => {
  let app: Hono<{ Variables: TestVariables }>;
  const spotify = {
    getArtist: vi.fn(),
    getAlbum: vi.fn(),
  };

  beforeEach(() => {
    app = new Hono<{ Variables: TestVariables }>();
    app.use('*', async (c, next) => {
      c.set('spotify', spotify);
      c.set('currentUser', null);
      c.set('internalToken', 'test-token');
      await next();
    });
    app.get('/artist/:id', handleArtistDetail);
    app.get('/album/:id', handleAlbumDetail);
  });

  it('returns 404 for a slug artist URL without calling Spotify', async () => {
    const res = await app.request('/artist/the-grateful-dead');

    expect(res.status).toBe(404);
    expect(await res.text()).toContain('404');
    expect(spotify.getArtist).not.toHaveBeenCalled();
  });

  it('returns 404 for a slug album URL with encoded characters without calling Spotify', async () => {
    const res = await app.request('/album/colter-wall_western-swing-%26-waltzes-and-other-punchy-songs');

    expect(res.status).toBe(404);
    expect(await res.text()).toContain('404');
    expect(spotify.getAlbum).not.toHaveBeenCalled();
  });

  it('passes a valid artist ID to Spotify', async () => {
    spotify.getArtist.mockResolvedValue(null);

    const res = await app.request('/artist/4Z8W4fKeB5YxbusRsdQVPb');

    expect(res.status).toBe(200);
    expect(spotify.getArtist).toHaveBeenCalledWith('4Z8W4fKeB5YxbusRsdQVPb');
  });

  it('passes a valid album ID to Spotify', async () => {
    spotify.getAlbum.mockResolvedValue(null);

    const res = await app.request('/album/0k17h0D3J5VfsdmQ1iZtE9');

    expect(res.status).toBe(200);
    expect(spotify.getAlbum).toHaveBeenCalledWith('0k17h0D3J5VfsdmQ1iZtE9');
  });
});
