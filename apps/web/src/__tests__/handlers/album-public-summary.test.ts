// ABOUTME: Tests that the album page server-renders cached AI summaries and recommendations behind the flag.
// ABOUTME: Covers logged-out and signed-in visitors, cache misses, fallback replies, KV failures and the flag off.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { FALLBACK_RESPONSE_PATTERN } from '@listentomore/ai';
import { handleAlbumDetail } from '../../pages/album/detail';
import { runPageScript } from '../utils/page-script';

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
const LABEL_HTML = '<p class="ai-summary-label text-muted"><a href="/about#how-its-built">AI-written summary</a></p>';
const UNLOCK_PROMPT = 'AI-powered album and artist summaries';
const PERSONAL_PROMPT = 'Recommendations based on what you play';
const LASTFM_HEADING = 'You already use Last.fm';
const LASTFM_SUMMARY_BULLET = 'The AI summary and recommendations for this album';
const DEFAULT_LOGIN_HREF = `href="/login?next=%2Falbum%2F${ALBUM_ID}"`;
const REF_LOGIN_HREF = `href="/login?next=%2Falbum%2F${ALBUM_ID}&amp;ref=lastfm-mcp"`;

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

  function requestAlbum(env?: Record<string, string>, query = '') {
    return app.request(`/album/${ALBUM_ID}${query}`, undefined, env);
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
    expect(html).toContain(LABEL_HTML);
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
    expect(html).not.toContain(LABEL_HTML);
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
    expect(html).not.toContain(LABEL_HTML);
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

  it('serialises the shared fallback pattern with its own flags', async () => {
    currentUser = SIGNED_IN_USER;

    const html = await (await requestAlbum({})).text();

    expect(html).toContain(
      `new RegExp(${JSON.stringify(FALLBACK_RESPONSE_PATTERN.source)}, ${JSON.stringify(FALLBACK_RESPONSE_PATTERN.flags)})`,
    );
    expect(html).not.toContain("includes('Not enough information available')");
  });

  describe('visitors from lastfm-mcp', () => {
    const REF_QUERY = '?ref=lastfm-mcp';

    it('shows the Last.fm prompt in the summary slot for ?ref=lastfm-mcp with no cached summary', async () => {
      ai.getCachedAlbumDetail.mockResolvedValue(null);
      ai.getCachedAlbumRecommendations.mockResolvedValue(null);

      const html = await (await requestAlbum(FLAG_ON, REF_QUERY)).text();

      expect(html).toContain(LASTFM_HEADING);
      expect(html).toContain(LASTFM_SUMMARY_BULLET);
      expect(html).toContain(REF_LOGIN_HREF);
      expect(html).not.toContain(UNLOCK_PROMPT);
      expect(html).not.toContain('Sign in to unlock more');
      expect(html).not.toContain('id="ai-summary"');
      expectNoModelCalls();
    });

    it('shows the summary and the Last.fm prompt for ?ref=lastfm-mcp with a cached summary', async () => {
      const html = await (await requestAlbum(FLAG_ON, REF_QUERY)).text();

      expect(html).toContain('<strong>a landmark</strong> of late-90s rock.');
      expect(html).toContain(LASTFM_HEADING);
      expect(html).toContain('A public profile page');
      expect(html).not.toContain(LASTFM_SUMMARY_BULLET);
      expect(html).not.toContain('Sign in with Last.fm for more');
      expect(html).toContain(REF_LOGIN_HREF);
      expect(html.indexOf('Kid A')).toBeLessThan(html.indexOf(LASTFM_HEADING));
      expectNoModelCalls();
    });

    it('shows the default prompt for an unknown ref', async () => {
      ai.getCachedAlbumDetail.mockResolvedValue(null);
      ai.getCachedAlbumRecommendations.mockResolvedValue(null);

      const html = await (await requestAlbum(FLAG_ON, '?ref=evil')).text();

      expect(html).toBe(await (await requestAlbum(FLAG_ON)).text());
      expect(html).toContain('Sign in to unlock more');
      expect(html).toContain(DEFAULT_LOGIN_HREF);
      expect(html).not.toContain(LASTFM_HEADING);
      expect(html).not.toMatch(/[?&;]ref=/);
    });

    it('shows the default prompt for a repeated ref', async () => {
      ai.getCachedAlbumDetail.mockResolvedValue(null);
      ai.getCachedAlbumRecommendations.mockResolvedValue(null);

      const html = await (await requestAlbum(FLAG_ON, '?ref=lastfm-mcp&ref=evil')).text();

      expect(html).toBe(await (await requestAlbum(FLAG_ON)).text());
      expect(html).toContain('Sign in to unlock more');
      expect(html).toContain(DEFAULT_LOGIN_HREF);
      expect(html).not.toContain(LASTFM_HEADING);
      expect(html).not.toMatch(/[?&;]ref=/);
    });

    it('shows no prompt to a signed-in visitor with ref', async () => {
      currentUser = SIGNED_IN_USER;

      const html = await (await requestAlbum(FLAG_ON, REF_QUERY)).text();

      expect(html).toContain('late-90s rock');
      expect(html).not.toContain(LASTFM_HEADING);
      expect(html).not.toContain(UNLOCK_PROMPT);
      expect(html).not.toContain(PERSONAL_PROMPT);
      expect(html).not.toContain('/login?next=');
    });

    it('keeps ref out of the canonical URL', async () => {
      const html = await (await requestAlbum(FLAG_ON, REF_QUERY)).text();

      expect(html).toContain(`<link rel="canonical" href="https://listentomore.com/album/${ALBUM_ID}"/>`);
    });

    it('shows the Last.fm prompt with the flag off', async () => {
      const html = await (await requestAlbum({}, REF_QUERY)).text();

      expect(html).toContain(LASTFM_HEADING);
      expect(html).toContain(LASTFM_SUMMARY_BULLET);
      expect(html).toContain(REF_LOGIN_HREF);
      expect(html).not.toContain('late-90s rock');
      expect(html).not.toContain(UNLOCK_PROMPT);
      expect(ai.getCachedAlbumDetail).not.toHaveBeenCalled();
    });
  });

  describe('client-fetched content for a signed-in user on a cache miss', () => {
    const SUMMARY_PATH = '/api/internal/album-summary';
    const RECS_PATH = '/api/internal/album-recommendations';
    const FETCHED = {
      [SUMMARY_PATH]: { data: { content: 'OK Computer is **a landmark**.' } },
      [RECS_PATH]: { data: { content: 'Try Kid A.' } },
    };
    const FALLBACKS = {
      [SUMMARY_PATH]: { data: { content: 'Not enough information available about this album.' } },
      [RECS_PATH]: { data: { content: 'not enough information available for recommendations.' } },
    };

    beforeEach(() => {
      currentUser = SIGNED_IN_USER;
      ai.getCachedAlbumDetail.mockResolvedValue(null);
      ai.getCachedAlbumRecommendations.mockResolvedValue(null);
    });

    async function runScript(env: Record<string, string>, responses: Record<string, unknown>) {
      const html = await (await requestAlbum(env)).text();
      return runPageScript(html, { authenticated: true, responses });
    }

    it('labels the fetched summary and recommendations when the flag is on', async () => {
      const run = await runScript(FLAG_ON, FETCHED);

      expect(run.html('ai-summary')).toContain('a landmark');
      expect(run.html('ai-summary')).toContain(LABEL_HTML);
      expect(run.html('album-recommendations')).toContain('Try Kid A.');
      expect(run.html('album-recommendations')).toContain(LABEL_HTML);
    });

    it('leaves fetched content unlabelled when the flag is off', async () => {
      const run = await runScript({}, FETCHED);

      expect(run.html('ai-summary')).toContain('a landmark');
      expect(run.html('ai-summary')).not.toContain('AI-written summary');
      expect(run.html('album-recommendations')).toContain('Try Kid A.');
      expect(run.html('album-recommendations')).not.toContain('AI-written summary');
    });

    it('neither labels nor renders fetched fallback replies, in any case', async () => {
      const run = await runScript(FLAG_ON, FALLBACKS);

      for (const id of ['ai-summary', 'album-recommendations']) {
        expect(run.html(id)).not.toContain('AI-written summary');
        expect(run.html(id).toLowerCase()).not.toContain('not enough information available');
        expect(run.html(id)).toContain('not available');
      }
    });
  });
});
