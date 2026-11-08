// ABOUTME: Tests that the artist page server-renders a cached AI summary behind the public summaries flag.
// ABOUTME: Covers logged-out and signed-in visitors, cache misses, fallback replies, KV failures and the flag off.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { handleArtistDetail } from '../../pages/artist/detail';

type TestVariables = {
  spotify: unknown;
  ai: unknown;
  currentUser: unknown;
  internalToken: string;
};

const ARTIST_ID = '4Z8W4fKeB5YxbusRsdQVPb';
const FLAG_ON = { PUBLIC_CACHED_SUMMARIES: 'true' };
const SIGNED_IN_USER = { id: 'user-1', lastfm_username: 'rian', display_name: 'Rian', avatar_url: null };

const ALBUM_LINK = '<a href="/album?q=radiohead-kid-a" data-artist="Radiohead" data-album="Kid A">Kid A</a>';
const CACHED_SUMMARY = `Radiohead are **an English rock band**. Start with ${ALBUM_LINK}.`;
const LABEL_HTML = '<p class="ai-summary-label text-muted"><a href="/about#how-its-built">AI-written summary</a></p>';
const UNLOCK_PROMPT = 'AI-powered album and artist summaries';
const PERSONAL_PROMPT = 'Recommendations based on what you play';

describe('Artist page public cached summary', () => {
  let app: Hono<{ Variables: TestVariables }>;
  let currentUser: unknown;

  const spotify = { getArtist: vi.fn() };
  const ai = {
    getCachedArtistSummary: vi.fn(),
    getArtistSummary: vi.fn(),
  };

  function requestArtist(env?: Record<string, string>) {
    return app.request(`/artist/${ARTIST_ID}`, undefined, env);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = null;
    spotify.getArtist.mockResolvedValue({
      id: ARTIST_ID,
      name: 'Radiohead',
      image: null,
      genres: [],
      url: `https://open.spotify.com/artist/${ARTIST_ID}`,
    });
    ai.getCachedArtistSummary.mockResolvedValue(CACHED_SUMMARY);

    app = new Hono<{ Variables: TestVariables }>();
    app.use('*', async (c, next) => {
      c.set('spotify', spotify);
      c.set('ai', ai);
      c.set('currentUser', currentUser);
      c.set('internalToken', 'test-token');
      await next();
    });
    app.get('/artist/:id', handleArtistDetail);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a cached summary to a logged-out visitor under the Overview heading, with the label and personal prompt', async () => {
    const res = await requestArtist(FLAG_ON);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(ai.getCachedArtistSummary).toHaveBeenCalledWith('Radiohead');
    expect(html).toContain('<strong>an English rock band</strong>');
    expect(html).toContain(LABEL_HTML);
    expect(html).toContain(PERSONAL_PROMPT);
    expect(html).not.toContain(UNLOCK_PROMPT);
    expect(html.indexOf('<strong>Overview:</strong>')).toBeGreaterThan(-1);
    expect(html.indexOf('<strong>Overview:</strong>')).toBeLessThan(html.indexOf('an English rock band'));
    expect(html.indexOf('an English rock band')).toBeLessThan(html.indexOf(PERSONAL_PROMPT));
    expect(ai.getArtistSummary).not.toHaveBeenCalled();
  });

  it('keeps the cached album link as a working link', async () => {
    const html = await (await requestArtist(FLAG_ON)).text();

    expect(html).toContain(ALBUM_LINK);
    expect(html).not.toContain('&lt;a href=&quot;/album?q=');
  });

  it('tells the client script the summary is rendered and enriches its links', async () => {
    const html = await (await requestArtist(FLAG_ON)).text();

    expect(html).toContain('window.__AI_SUMMARY_RENDERED__ = true;');
    expect(html).toMatch(/if \(window\.__AI_SUMMARY_RENDERED__\) \{\s*enrichLinks\('ai-summary'\);/);
    expect(html).toContain('if (window.__IS_AUTHENTICATED__ && !window.__AI_SUMMARY_RENDERED__)');
  });

  it('shows today\'s sign-in prompt and makes no model call on a cache miss', async () => {
    ai.getCachedArtistSummary.mockResolvedValue(null);

    const res = await requestArtist(FLAG_ON);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain(UNLOCK_PROMPT);
    expect(html).not.toContain(PERSONAL_PROMPT);
    expect(html).not.toContain('id="ai-summary"');
    expect(html).toContain('window.__AI_SUMMARY_RENDERED__ = false;');
    expect(ai.getArtistSummary).not.toHaveBeenCalled();
  });

  it('does not publish a cached "Not enough information" reply', async () => {
    ai.getCachedArtistSummary.mockResolvedValue('Not enough information available about this artist.');

    const html = await (await requestArtist(FLAG_ON)).text();

    expect(html).not.toContain('Not enough information available about this artist.');
    expect(html).not.toContain(LABEL_HTML);
    expect(html).toContain(UNLOCK_PROMPT);
    expect(ai.getArtistSummary).not.toHaveBeenCalled();
  });

  it('renders the normal page with status 200 when the cache read fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    ai.getCachedArtistSummary.mockRejectedValue(new Error('KV unavailable'));

    const res = await requestArtist(FLAG_ON);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('<h1>Radiohead</h1>');
    expect(html).not.toContain('an English rock band');
    expect(html).toContain(UNLOCK_PROMPT);
    expect(consoleError).toHaveBeenCalled();
    expect(ai.getArtistSummary).not.toHaveBeenCalled();
  });

  it('ignores the cache when the flag is off', async () => {
    const html = await (await requestArtist({})).text();

    expect(html).not.toContain('an English rock band');
    expect(html).not.toContain(LABEL_HTML);
    expect(html).toContain(UNLOCK_PROMPT);
    expect(html).toContain('window.__AI_SUMMARY_RENDERED__ = false;');
    expect(ai.getCachedArtistSummary).not.toHaveBeenCalled();
  });

  it('treats a missing env as the flag being off', async () => {
    const res = await requestArtist();
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).not.toContain('an English rock band');
    expect(ai.getCachedArtistSummary).not.toHaveBeenCalled();
  });

  it('server-renders a cached summary for a signed-in user without the sign-in prompts', async () => {
    currentUser = SIGNED_IN_USER;

    const html = await (await requestArtist(FLAG_ON)).text();

    expect(html).toContain('an English rock band');
    expect(html).toContain(LABEL_HTML);
    expect(html).toContain('window.__AI_SUMMARY_RENDERED__ = true;');
    expect(html).not.toContain('Loading AI summary...');
    expect(html).not.toContain(PERSONAL_PROMPT);
    expect(html).not.toContain(UNLOCK_PROMPT);
    expect(ai.getArtistSummary).not.toHaveBeenCalled();
  });

  it('labels a summary the client script fetches for a signed-in user', async () => {
    currentUser = SIGNED_IN_USER;

    const html = await (await requestArtist({})).text();

    expect(html).toContain('Loading AI summary...');
    expect(html).toContain(`var aiSummaryLabel = ${JSON.stringify(LABEL_HTML)};`);
    expect(html).toContain('html += aiSummaryLabel;');
  });
});
