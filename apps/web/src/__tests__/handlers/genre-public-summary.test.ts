// ABOUTME: Tests that the genre page server-renders a cached AI summary behind the public summaries flag.
// ABOUTME: Covers curated and uncurated genres, cache misses, KV failures, the flag off and signed-in visitors.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { handleGenreDetail } from '../../pages/genre/detail';
import { runPageScript } from '../utils/page-script';

type TestVariables = {
  ai: unknown;
  currentUser: unknown;
  internalToken: string;
};

const FLAG_ON = { PUBLIC_CACHED_SUMMARIES: 'true' };
const SIGNED_IN_USER = { id: 'user-1', lastfm_username: 'rian', display_name: 'Rian', avatar_url: null };

const CACHED_SUMMARY = 'Shoegaze is **loud and dreamy**. Hear [Loveless](/album?q=my-bloody-valentine-loveless).';
const LABEL_HTML = '<p class="ai-summary-label text-muted"><a href="/about#how-its-built">AI-written summary</a></p>';
const NOINDEX = '<meta name="robots" content="noindex, follow"/>';
const UNLOCK_PROMPT = 'AI-powered album and artist summaries';
const PERSONAL_PROMPT = 'Recommendations based on what you play';

describe('Genre page public cached summary', () => {
  let app: Hono<{ Variables: TestVariables }>;
  let currentUser: unknown;

  const ai = {
    getCachedGenreSummary: vi.fn(),
    getGenreSummary: vi.fn(),
  };

  function requestGenre(slug: string, env?: Record<string, string>) {
    return app.request(`/genre/${slug}`, undefined, env);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = null;
    ai.getCachedGenreSummary.mockResolvedValue(CACHED_SUMMARY);

    app = new Hono<{ Variables: TestVariables }>();
    app.use('*', async (c, next) => {
      c.set('ai', ai);
      c.set('currentUser', currentUser);
      c.set('internalToken', 'test-token');
      await next();
    });
    app.get('/genre/:slug', handleGenreDetail);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a curated genre\'s cached summary to a logged-out visitor, indexable, with label and personal prompt', async () => {
    const res = await requestGenre('shoegaze', FLAG_ON);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(ai.getCachedGenreSummary).toHaveBeenCalledWith('Shoegaze');
    expect(html).toMatch(/id="genre-summary"[^>]*>[\s\S]*<strong>loud and dreamy<\/strong>/);
    expect(html).toContain('<a href="/album?q=my-bloody-valentine-loveless">Loveless</a>');
    expect(html).toContain(LABEL_HTML);
    expect(html.indexOf(LABEL_HTML)).toBeGreaterThan(html.indexOf('id="genre-summary"'));
    expect(html).toContain(PERSONAL_PROMPT);
    expect(html.indexOf('loud and dreamy')).toBeLessThan(html.indexOf(PERSONAL_PROMPT));
    expect(html).not.toContain(UNLOCK_PROMPT);
    expect(html).not.toContain(NOINDEX);
    expect(html).not.toContain('Generating summary...');
    expect(ai.getGenreSummary).not.toHaveBeenCalled();
  });

  it('shows an uncurated genre\'s cached summary but keeps it out of the index', async () => {
    const res = await requestGenre('post-punk', FLAG_ON);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(ai.getCachedGenreSummary).toHaveBeenCalledWith('Post Punk');
    expect(html).toContain('loud and dreamy');
    expect(html).toContain(NOINDEX);
    expect(ai.getGenreSummary).not.toHaveBeenCalled();
  });

  it('tells the client script the summary is rendered', async () => {
    const html = await (await requestGenre('shoegaze', FLAG_ON)).text();

    expect(html).toContain('window.__AI_SUMMARY_RENDERED__ = true;');
    expect(html).toMatch(/if \(!window\.__IS_AUTHENTICATED__\) return;/);
    expect(html).toMatch(
      /if \(window\.__AI_SUMMARY_RENDERED__\) \{\s*enrichLinks\('genre-summary'\);\s*return;\s*\}/
    );
  });

  it('shows today\'s sign-in prompt and makes no model call on a cache miss', async () => {
    ai.getCachedGenreSummary.mockResolvedValue(null);

    const res = await requestGenre('shoegaze', FLAG_ON);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain(UNLOCK_PROMPT);
    expect(html).not.toContain(PERSONAL_PROMPT);
    expect(html).not.toContain('id="genre-summary"');
    expect(html).toContain('window.__AI_SUMMARY_RENDERED__ = false;');
    expect(ai.getGenreSummary).not.toHaveBeenCalled();
  });

  it('does not publish a cached "Not enough information" reply', async () => {
    ai.getCachedGenreSummary.mockResolvedValue('Not enough information available about this genre.');

    const html = await (await requestGenre('shoegaze', FLAG_ON)).text();

    expect(html).not.toContain('Not enough information available about this genre.');
    expect(html).not.toContain(LABEL_HTML);
    expect(html).toContain(UNLOCK_PROMPT);
  });

  it('renders the normal page with status 200 when the cache read fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    ai.getCachedGenreSummary.mockRejectedValue(new Error('KV unavailable'));

    const res = await requestGenre('shoegaze', FLAG_ON);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('<h1>Shoegaze</h1>');
    expect(html).not.toContain('loud and dreamy');
    expect(html).toContain(UNLOCK_PROMPT);
    expect(consoleError).toHaveBeenCalled();
    expect(ai.getGenreSummary).not.toHaveBeenCalled();
  });

  it('ignores the cache when the flag is off', async () => {
    const html = await (await requestGenre('post-punk', {})).text();

    expect(html).not.toContain('loud and dreamy');
    expect(html).not.toContain(LABEL_HTML);
    expect(html).toContain(UNLOCK_PROMPT);
    expect(html).toContain(NOINDEX);
    expect(html).toContain('window.__AI_SUMMARY_RENDERED__ = false;');
    expect(ai.getCachedGenreSummary).not.toHaveBeenCalled();
  });

  it('treats a missing env as the flag being off', async () => {
    const res = await requestGenre('shoegaze');
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).not.toContain('loud and dreamy');
    expect(ai.getCachedGenreSummary).not.toHaveBeenCalled();
  });

  it('server-renders a cached summary for a signed-in user without the sign-in prompts', async () => {
    currentUser = SIGNED_IN_USER;

    const html = await (await requestGenre('shoegaze', FLAG_ON)).text();

    expect(html).toContain('loud and dreamy');
    expect(html).toContain(LABEL_HTML);
    expect(html).toContain('window.__AI_SUMMARY_RENDERED__ = true;');
    expect(html).not.toContain('Generating summary...');
    expect(html).not.toContain(PERSONAL_PROMPT);
    expect(html).not.toContain(UNLOCK_PROMPT);
    expect(ai.getGenreSummary).not.toHaveBeenCalled();
  });

  describe('client script', () => {
    const FETCHED = { data: { content: 'Shoegaze is **loud and dreamy**.' } };
    const FALLBACK = { data: { content: 'There is no information available about this genre.' } };

    async function runScript(env: Record<string, string>, reply?: unknown) {
      const html = await (await requestGenre('shoegaze', env)).text();
      return runPageScript(html, {
        authenticated: currentUser !== null,
        responses: reply === undefined ? {} : { '/api/internal/genre-summary': reply },
      });
    }

    it('enriches the links in a server-rendered summary for a logged-out visitor, without fetching a summary', async () => {
      const run = await runScript(FLAG_ON);

      expect(run.enriched).toEqual(['genre-summary']);
      expect(run.fetches).toEqual([]);
    });

    it('does nothing for a logged-out visitor when nothing was server-rendered', async () => {
      ai.getCachedGenreSummary.mockResolvedValue(null);

      const run = await runScript(FLAG_ON);

      expect(run.fetches).toEqual([]);
      expect(run.enriched).toEqual([]);
    });

    describe('for a signed-in user on a cache miss', () => {
      beforeEach(() => {
        currentUser = SIGNED_IN_USER;
        ai.getCachedGenreSummary.mockResolvedValue(null);
      });

      it('labels the fetched summary when the flag is on', async () => {
        const run = await runScript(FLAG_ON, FETCHED);

        expect(run.fetches).toEqual(['/api/internal/genre-summary?name=Shoegaze']);
        expect(run.html('genre-summary')).toContain('loud and dreamy');
        expect(run.html('genre-summary')).toContain(LABEL_HTML);
      });

      it('leaves the fetched summary unlabelled when the flag is off', async () => {
        const run = await runScript({}, FETCHED);

        expect(run.html('genre-summary')).toContain('loud and dreamy');
        expect(run.html('genre-summary')).not.toContain('AI-written summary');
        expect(await (await requestGenre('shoegaze', {})).text()).toContain('window.__PUBLIC_SUMMARIES__ = false;');
      });

      it('neither labels nor renders a fetched fallback reply', async () => {
        const run = await runScript(FLAG_ON, FALLBACK);

        expect(run.html('genre-summary')).not.toContain('AI-written summary');
        expect(run.html('genre-summary')).not.toContain('There is no information available');
        expect(run.html('genre-summary')).toContain('not available');
      });
    });
  });
});
