// ABOUTME: Tests that artist/album detail routes 404 legacy slugs and IDs Spotify doesn't know.
// ABOUTME: Real Spotify failures stay 200 "Failed to load" pages, since those are transient, not missing.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { SpotifyNotFoundError } from '@listentomore/spotify';
import { handleArtistDetail } from '../../pages/artist/detail';
import { handleAlbumDetail } from '../../pages/album/detail';

type TestVariables = {
  spotify: unknown;
  currentUser: unknown;
  internalToken: string;
};

describe('Detail route status codes', () => {
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

  it('returns 404 for a valid artist ID that Spotify has no result for', async () => {
    spotify.getArtist.mockRejectedValue(new SpotifyNotFoundError('artist', '4Z8W4fKeB5YxbusRsdQVPb'));

    const res = await app.request('/artist/4Z8W4fKeB5YxbusRsdQVPb');

    expect(res.status).toBe(404);
    expect(await res.text()).toContain('Artist not found');
    expect(spotify.getArtist).toHaveBeenCalledWith('4Z8W4fKeB5YxbusRsdQVPb');
  });

  it('returns 404 for a valid album ID that Spotify has no result for', async () => {
    spotify.getAlbum.mockRejectedValue(new SpotifyNotFoundError('album', '0k17h0D3J5VfsdmQ1iZtE9'));

    const res = await app.request('/album/0k17h0D3J5VfsdmQ1iZtE9');

    expect(res.status).toBe(404);
    expect(await res.text()).toContain('Album not found');
    expect(spotify.getAlbum).toHaveBeenCalledWith('0k17h0D3J5VfsdmQ1iZtE9');
  });

  it('keeps a Spotify artist failure as a 200 error page, not a 404', async () => {
    spotify.getArtist.mockRejectedValue(new Error('Spotify API error: 500'));

    const res = await app.request('/artist/4Z8W4fKeB5YxbusRsdQVPb');

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Failed to load artist');
  });

  it('keeps a Spotify album failure as a 200 error page, not a 404', async () => {
    spotify.getAlbum.mockRejectedValue(new Error('Spotify API error: 500'));

    const res = await app.request('/album/0k17h0D3J5VfsdmQ1iZtE9');

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Failed to load album');
  });

  // Error text matches what the Spotify clients throw once spotifyFetch exhausts its 429 retries.
  it('returns 503 when Spotify rate-limits an artist lookup', async () => {
    spotify.getArtist.mockRejectedValue(new Error('Failed to fetch artist: 429 Too Many Requests'));

    const res = await app.request('/artist/4Z8W4fKeB5YxbusRsdQVPb');

    expect(res.status).toBe(503);
  });

  it('returns 503 when Spotify rate-limits an album lookup', async () => {
    spotify.getAlbum.mockRejectedValue(new Error('Failed to fetch album: 429 Too Many Requests'));

    const res = await app.request('/album/0k17h0D3J5VfsdmQ1iZtE9');

    expect(res.status).toBe(503);
  });
});
