// ABOUTME: Tests that the album page server-renders cached AI summaries and recommendations behind the flag.
// ABOUTME: Covers logged-out and signed-in visitors, cache misses, fallback replies, KV failures and the flag off.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { FALLBACK_RESPONSE_PATTERN } from '@listentomore/ai';
import { handleAlbumDetail } from '../../pages/album/detail';

type TestVariables = {
  spotify: unknown;
  ai: unknown;
  currentUser: unknown;
  internalToken: string;
};

const ALBUM_ID = '6dVIqQ8qmQ5GBnJ9shOYGE';
const FLAG_ON = { PUBLIC_CACHED_SUMMARIES: 'true' };
const SIGNED_IN_USER = { id: 'user-1', lastfm_username: 'rian', display_name: 'Rian', avatar_url: null };

const CACHED_SUMMARY = 'OK Computer is **a landmark** of late-90s rock.';
const CACHED_RECOMMENDATIONS = 'Try <a href="/album?q=kid-a" data-artist="Radiohead" data-album="Kid A">Kid A</a>.';
const UNLOCK_PROMPT = 'AI-powered album and artist summaries';
const PERSONAL_PROMPT = 'Recommendations based on what you play';

describe('Album page public cached summaries', () => {
  let app: Hono<{ Variables: TestVariables }>;
  let currentUser: unknown;

  const spotify = { getAlbum: vi.fn() };
  const ai = {
    getCachedAlbumDetail: vi.fn(),
    getCachedAlbumRecommendations: vi.fn(),
    getAlbumDetail: vi.fn(),
    getAlbumRecommendations: vi.fn(),
  };

  function requestAlbum(env?: Record<string, string>) {
    return app.request(`/album/${ALBUM_ID}`, undefined, env);
  }

  function expectNoModelCalls() {
    expect(ai.getAlbumDetail).not.toHaveBeenCalled();
    expect(ai.getAlbumRecommendations).not.toHaveBeenCalled();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = null;
    spotify.getAlbum.mockResolvedValue({
      id: ALBUM_ID,
      name: 'OK Computer',
      artist: 'Radiohead',
      artistIds: ['4Z8W4fKeB5YxbusRsdQVPb'],
      image: null,
      releaseDate: '1997-05-21',
      genres: [],
      url: `https://open.spotify.com/album/${ALBUM_ID}`,
    });
    ai.getCachedAlbumDetail.mockResolvedValue(CACHED_SUMMARY);
    ai.getCachedAlbumRecommendations.mockResolvedValue(CACHED_RECOMMENDATIONS);

    app = new Hono<{ Variables: TestVariables }>();
    app.use('*', async (c, next) => {
      c.set('spotify', spotify);
      c.set('ai', ai);
      c.set('currentUser', currentUser);
      c.set('internalToken', 'test-token');
      await next();
    });
    app.get('/album/:id', handleAlbumDetail);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a cached summary to a logged-out visitor with the label and personal prompt', async () => {
    const res = await requestAlbum(FLAG_ON);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('<strong>a landmark</strong> of late-90s rock.');
    expect(html).toContain('AI-written summary');
    expect(html).toContain(PERSONAL_PROMPT);
    expect(html).not.toContain(UNLOCK_PROMPT);
    expect(ai.getCachedAlbumDetail).toHaveBeenCalledWith('Radiohead', 'OK Computer');
    expectNoModelCalls();
  });

  it('shows cached recommendations under their heading', async () => {
    const res = await requestAlbum(FLAG_ON);
    const html = await res.text();

    expect(ai.getCachedAlbumRecommendations).toHaveBeenCalledWith('Radiohead', 'OK Computer');
    expect(html).toMatch(
      /<h3>Album Recommendations<\/h3>[\s\S]*<a href="\/album\?q=kid-a" data-artist="Radiohead" data-album="Kid A">Kid A<\/a>/
    );
    expect(html).toContain('window.__AI_RECS_RENDERED__ = true;');
    expectNoModelCalls();
  });

  it('shows today\'s sign-in prompt and makes no model call on a cache miss', async () => {
    ai.getCachedAlbumDetail.mockResolvedValue(null);
    ai.getCachedAlbumRecommendations.mockResolvedValue(null);

    const res = await requestAlbum(FLAG_ON);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain(UNLOCK_PROMPT);
    expect(html).not.toContain(PERSONAL_PROMPT);
    expect(html).not.toContain('id="ai-summary"');
    expectNoModelCalls();
  });

  it('shows only the section that was cached, followed by the personal prompt', async () => {
    ai.getCachedAlbumDetail.mockResolvedValue(null);

    const html = await (await requestAlbum(FLAG_ON)).text();

    expect(html).not.toContain('id="ai-summary"');
    expect(html).toContain('id="album-recommendations"');
    expect(html.indexOf('Kid A')).toBeLessThan(html.indexOf(PERSONAL_PROMPT));
    expect(html).not.toContain('Loading recommendations...');
    expectNoModelCalls();
  });

  it('does not publish a cached "Not enough information" reply', async () => {
    ai.getCachedAlbumDetail.mockResolvedValue('Not enough information available about this album.');
    ai.getCachedAlbumRecommendations.mockResolvedValue('not enough information available.');

    const html = await (await requestAlbum(FLAG_ON)).text();

    expect(html).not.toContain('Not enough information available about this album.');
    expect(html).not.toContain('AI-written summary');
    expect(html).toContain(UNLOCK_PROMPT);
    expectNoModelCalls();
  });

  it('renders the normal page with status 200 when the cache read fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    ai.getCachedAlbumDetail.mockRejectedValue(new Error('KV unavailable'));

    const res = await requestAlbum(FLAG_ON);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('OK Computer by');
    expect(html).not.toContain('late-90s rock');
    expect(html).toContain('Kid A');
    expect(consoleError).toHaveBeenCalled();
    expectNoModelCalls();
  });

  it('ignores the cache when the flag is off', async () => {
    const html = await (await requestAlbum({})).text();

    expect(html).not.toContain('late-90s rock');
    expect(html).not.toContain('AI-written summary');
    expect(html).toContain(UNLOCK_PROMPT);
    expect(ai.getCachedAlbumDetail).not.toHaveBeenCalled();
    expect(ai.getCachedAlbumRecommendations).not.toHaveBeenCalled();
  });

  it('treats a missing env as the flag being off', async () => {
    const res = await requestAlbum();
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).not.toContain('late-90s rock');
    expect(ai.getCachedAlbumDetail).not.toHaveBeenCalled();
  });

  it('server-renders a cached summary for a signed-in user and tells the client script not to fetch it', async () => {
    currentUser = SIGNED_IN_USER;
    ai.getCachedAlbumRecommendations.mockResolvedValue(null);

    const html = await (await requestAlbum(FLAG_ON)).text();

    expect(html).toContain('late-90s rock');
    expect(html).toContain('window.__AI_SUMMARY_RENDERED__ = true;');
    expect(html).toContain('window.__AI_RECS_RENDERED__ = false;');
    expect(html).toContain('Loading recommendations...');
    expect(html).not.toContain(PERSONAL_PROMPT);
    expect(html).not.toContain(UNLOCK_PROMPT);
    expectNoModelCalls();
  });

  it('checks fetched recommendations against the shared fallback pattern, ignoring case', async () => {
    currentUser = SIGNED_IN_USER;

    const html = await (await requestAlbum({})).text();

    expect(html).toContain(`new RegExp(${JSON.stringify(FALLBACK_RESPONSE_PATTERN.source)}, 'i')`);
    expect(html).not.toContain("includes('Not enough information available')");
  });
});
