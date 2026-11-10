// ABOUTME: Tests for the name-based /lookup route: strict matches redirect to album or artist pages, misses to search.
// ABOUTME: Covers the KV lookup cache, ref forwarding and click counting, Spotify and KV failures, and response headers.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { LookupAlbumCandidate } from '@listentomore/spotify';
import { handleLookup } from '../../pages/lookup';
import { createMockKV } from '../utils/mocks';

type TestVariables = {
  spotify: unknown;
  db: unknown;
  currentUser: unknown;
};

const OK_COMPUTER_ID = '6dVIqQ8qmQ5GBnJ9shOYGE';
const RADIOHEAD_ID = '4Z8W4fKeB5YxbusRsdQVPb';
const RUMOURS_ID = '1bt6q2SruMsBtcerNVtpZB';
const RUMOURS_DELUXE_ID = '0BwWUstDMUbgq2NYONRqlu';
const HEROES_ID = '4HTWvR1TcOVaSb0ULs1Dno';
const SAKAMOTO_ID = '5ADjuB4CCJnXIQXXxgJ4ow';

const SIGNED_IN_USER = { id: 'user-1', lastfm_username: 'rian', display_name: 'Rian', avatar_url: null };
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

function album(id: string, name: string, artists: string[]): LookupAlbumCandidate {
  return { id, name, artists };
}

/** Builds a query string with every value percent-encoded. */
function params(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
}

describe('/lookup', () => {
  let app: Hono<{ Variables: TestVariables }>;
  let kv: KVNamespace;
  let currentUser: unknown;
  let consoleError: ReturnType<typeof vi.spyOn>;

  const spotify = { searchAlbumCandidates: vi.fn(), searchArtistCandidates: vi.fn() };
  const db = { recordReferralClick: vi.fn() };

  function lookup(query: string, init?: RequestInit, executionCtx?: ExecutionContext) {
    return app.request(`/lookup?${query}`, init, { CACHE: kv }, executionCtx);
  }

  function expectLookupHeaders(res: Response) {
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  }

  function expectNoSpotifyCalls() {
    expect(spotify.searchAlbumCandidates).not.toHaveBeenCalled();
    expect(spotify.searchArtistCandidates).not.toHaveBeenCalled();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    currentUser = null;
    kv = createMockKV();
    spotify.searchAlbumCandidates.mockResolvedValue([]);
    spotify.searchArtistCandidates.mockResolvedValue([]);
    db.recordReferralClick.mockResolvedValue(undefined);

    app = new Hono<{ Variables: TestVariables }>();
    app.use('*', async (c, next) => {
      c.set('spotify', spotify);
      c.set('db', db);
      c.set('currentUser', currentUser);
      await next();
    });
    app.get('/lookup', handleLookup);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redirects a matched album to its page with ref', async () => {
    spotify.searchAlbumCandidates.mockResolvedValue([album(OK_COMPUTER_ID, 'OK Computer', ['Radiohead'])]);

    const res = await lookup(params({ artist: 'Radiohead', album: 'OK Computer', ref: 'lastfm-mcp' }));

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`/album/${OK_COMPUTER_ID}?ref=lastfm-mcp`);
    expect(spotify.searchAlbumCandidates).toHaveBeenCalledTimes(1);
    expect(spotify.searchAlbumCandidates).toHaveBeenCalledWith('artist:"Radiohead" album:"OK Computer"', 10);
  });

  it('redirects a matched artist to its page', async () => {
    spotify.searchArtistCandidates.mockResolvedValue([{ id: RADIOHEAD_ID, name: 'Radiohead' }]);

    const res = await lookup(params({ artist: 'Radiohead', ref: 'lastfm-mcp' }));

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`/artist/${RADIOHEAD_ID}?ref=lastfm-mcp`);
    expect(spotify.searchArtistCandidates).toHaveBeenCalledWith('Radiohead', 10);
    expect(spotify.searchAlbumCandidates).not.toHaveBeenCalled();
  });

  it('drops an unknown ref and records no click', async () => {
    spotify.searchArtistCandidates.mockResolvedValue([{ id: RADIOHEAD_ID, name: 'Radiohead' }]);

    const res = await lookup(params({ artist: 'Radiohead', ref: 'evil' }));

    expect(res.headers.get('Location')).toBe(`/artist/${RADIOHEAD_ID}`);
    expect(db.recordReferralClick).not.toHaveBeenCalled();
  });

  it.each(['ref=lastfm-mcp&ref=evil', 'ref=evil&ref=lastfm-mcp'])('drops a repeated ref (%s)', async (refs) => {
    spotify.searchArtistCandidates.mockResolvedValue([{ id: RADIOHEAD_ID, name: 'Radiohead' }]);

    const res = await lookup(`artist=Radiohead&${refs}`);

    expect(res.headers.get('Location')).toBe(`/artist/${RADIOHEAD_ID}`);
    expect(db.recordReferralClick).not.toHaveBeenCalled();
  });

  it('keeps base and deluxe titles apart in the cache, in either order', async () => {
    spotify.searchAlbumCandidates.mockImplementation(async (query: string) =>
      query.includes('Super Deluxe')
        ? [album(RUMOURS_DELUXE_ID, 'Rumours (Super Deluxe)', ['Fleetwood Mac'])]
        : [album(RUMOURS_ID, 'Rumours', ['Fleetwood Mac'])],
    );
    const base = params({ artist: 'Fleetwood Mac', album: 'Rumours' });
    const deluxe = params({ artist: 'Fleetwood Mac', album: 'Rumours (Super Deluxe)' });

    for (const order of [[base, deluxe], [deluxe, base]]) {
      kv = createMockKV();
      for (const query of [...order, ...order]) {
        const res = await lookup(query);
        const expectedId = query === deluxe ? RUMOURS_DELUXE_ID : RUMOURS_ID;
        expect(res.headers.get('Location'), query).toBe(`/album/${expectedId}`);
      }
    }

    // A cached miss for one title does not answer the other.
    for (const [missKey, query, expectedId] of [
      ['lookup:v1:album:fleetwood mac|rumours', deluxe, RUMOURS_DELUXE_ID],
      ['lookup:v1:album:fleetwood mac|rumours super deluxe', base, RUMOURS_ID],
    ]) {
      kv = createMockKV();
      await kv.put(missKey, JSON.stringify({ miss: true }));
      const res = await lookup(query);
      expect(res.headers.get('Location'), query).toBe(`/album/${expectedId}`);
    }
  });

  it('treats a cached ID that is not a Spotify ID as a miss', async () => {
    await kv.put('lookup:v1:artist:radiohead', JSON.stringify({ id: '/\\evil.example' }));
    spotify.searchArtistCandidates.mockResolvedValue([{ id: RADIOHEAD_ID, name: 'Radiohead' }]);

    const res = await lookup(params({ artist: 'Radiohead', ref: 'lastfm-mcp' }));

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/artist?q=Radiohead');
    expect(res.headers.get('Location')).not.toContain('evil');
    expectNoSpotifyCalls();
  });

  it('treats a Spotify candidate ID that is not a Spotify ID as no match', async () => {
    spotify.searchArtistCandidates.mockResolvedValue([{ id: '//evil.example', name: 'Radiohead' }]);

    const res = await lookup(params({ artist: 'Radiohead' }));

    expect(res.headers.get('Location')).toBe('/artist?q=Radiohead');
  });

  it('resolves from Spotify when the lookup-cache read throws', async () => {
    const storeGet = vi.mocked(kv.get).getMockImplementation() as unknown as (
      key: string,
      options?: unknown,
    ) => Promise<unknown>;
    vi.mocked(kv.get).mockImplementation(((key: string, options?: unknown) => {
      if (key.startsWith('lookup:v1:')) throw new Error('KV read failed');
      return storeGet(key, options);
    }) as typeof kv.get);
    spotify.searchArtistCandidates.mockResolvedValue([{ id: RADIOHEAD_ID, name: 'Radiohead' }]);

    const res = await lookup(params({ artist: 'Radiohead' }));

    expect(res.headers.get('Location')).toBe(`/artist/${RADIOHEAD_ID}`);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('[Lookup]'), 'KV read failed', expect.any(Error));
  });

  it('redirects a miss to the search page and caches the miss', async () => {
    const query = params({ artist: 'Jon Hopkins', album: 'Nonexistent', ref: 'lastfm-mcp' });

    const res = await lookup(query);

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/album?q=Jon%20Hopkins%20Nonexistent');
    expect(spotify.searchAlbumCandidates.mock.calls.map((call) => call[0])).toEqual([
      'artist:"Jon Hopkins" album:"Nonexistent"',
      'Jon Hopkins Nonexistent',
    ]);
    expect(kv.put).toHaveBeenCalledWith('lookup:v1:album:jon hopkins|nonexistent', '{"miss":true}', {
      expirationTtl: 24 * 60 * 60,
    });

    spotify.searchAlbumCandidates.mockClear();
    const second = await lookup(query);

    expect(second.headers.get('Location')).toBe('/album?q=Jon%20Hopkins%20Nonexistent');
    expect(spotify.searchAlbumCandidates).not.toHaveBeenCalled();
  });

  it('caches a hit for 30 days', async () => {
    spotify.searchArtistCandidates.mockResolvedValue([{ id: RADIOHEAD_ID, name: 'Radiohead' }]);

    await lookup(params({ artist: 'Radiohead' }));

    expect(kv.put).toHaveBeenCalledWith('lookup:v1:artist:radiohead', JSON.stringify({ id: RADIOHEAD_ID }), {
      expirationTtl: 30 * 24 * 60 * 60,
    });
  });

  it('serves a cached hit without calling Spotify', async () => {
    await kv.put('lookup:v1:album:radiohead|ok computer', JSON.stringify({ id: OK_COMPUTER_ID }));

    const res = await lookup(params({ artist: 'Radiohead', album: 'OK Computer', ref: 'lastfm-mcp' }));

    expect(res.headers.get('Location')).toBe(`/album/${OK_COMPUTER_ID}?ref=lastfm-mcp`);
    expectNoSpotifyCalls();
  });

  it('retries with the edition stripped before the natural query', async () => {
    spotify.searchAlbumCandidates
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([album(OK_COMPUTER_ID, 'OK Computer', ['Radiohead'])]);

    const res = await lookup(params({ artist: 'Radiohead', album: 'OK Computer (Remastered 2009)' }));

    expect(res.headers.get('Location')).toBe(`/album/${OK_COMPUTER_ID}`);
    expect(spotify.searchAlbumCandidates.mock.calls).toEqual([
      ['artist:"Radiohead" album:"OK Computer (Remastered 2009)"', 10],
      ['artist:"Radiohead" album:"OK Computer"', 10],
    ]);
  });

  it('removes double quotes from field filters', async () => {
    spotify.searchAlbumCandidates.mockResolvedValue([album(HEROES_ID, '"Heroes"', ['David Bowie'])]);

    const res = await lookup(params({ artist: 'David Bowie', album: '"Heroes"' }));

    expect(spotify.searchAlbumCandidates).toHaveBeenCalledWith('artist:"David Bowie" album:"Heroes"', 10);
    expect(res.headers.get('Location')).toBe(`/album/${HEROES_ID}`);
  });

  it('resolves a non-Latin artist name', async () => {
    spotify.searchArtistCandidates.mockResolvedValue([{ id: SAKAMOTO_ID, name: '坂本龍一' }]);

    const res = await lookup(params({ artist: '坂本龍一' }));

    expect(res.headers.get('Location')).toBe(`/artist/${SAKAMOTO_ID}`);
    expect(spotify.searchArtistCandidates).toHaveBeenCalledWith('坂本龍一', 10);
  });

  it('sends a name that normalizes to nothing straight to search without Spotify or the cache', async () => {
    const res = await lookup(params({ artist: '!!!', ref: 'lastfm-mcp' }));

    expect(res.headers.get('Location')).toBe(`/artist?q=${encodeURIComponent('!!!')}`);
    expectNoSpotifyCalls();
    expect(kv.get).not.toHaveBeenCalled();
    expect(kv.put).not.toHaveBeenCalled();
    expect(db.recordReferralClick).toHaveBeenCalledWith(expect.objectContaining({ type: 'artist', matched: false }));
  });

  it('returns 400 when artist is missing or blank', async () => {
    for (const query of ['', 'artist=', 'artist=%20%20', 'album=OK%20Computer&ref=lastfm-mcp']) {
      const res = await lookup(query);

      expect(res.status, query).toBe(400);
      expect(res.headers.get('Content-Type'), query).toContain('text/plain');
      expectLookupHeaders(res);
    }
    expectNoSpotifyCalls();
    expect(db.recordReferralClick).not.toHaveBeenCalled();
  });

  it('returns 400 when a name is over 300 characters', async () => {
    for (const query of [
      params({ artist: 'a'.repeat(301) }),
      params({ artist: 'Radiohead', album: 'b'.repeat(301) }),
    ]) {
      const res = await lookup(query);

      expect(res.status).toBe(400);
      expectLookupHeaders(res);
    }
    expectNoSpotifyCalls();

    const atLimit = await lookup(params({ artist: 'a'.repeat(300) }));
    expect(atLimit.status).toBe(302);
  });

  it('skips the lookup cache when the key would exceed the KV key limit', async () => {
    const res = await lookup(params({ artist: 'a'.repeat(300), album: 'b'.repeat(300) }));

    expect(res.status).toBe(302);
    expect(spotify.searchAlbumCandidates).toHaveBeenCalled();
    expect(kv.get).not.toHaveBeenCalled();
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('redirects to search and caches nothing when Spotify throws a 429', async () => {
    spotify.searchAlbumCandidates.mockRejectedValue(new Error('Spotify search failed: 429 Too Many Requests'));

    const res = await lookup(params({ artist: 'Radiohead', album: 'OK Computer', ref: 'lastfm-mcp' }));

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/album?q=Radiohead%20OK%20Computer');
    expect(kv.put).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('[Lookup]'),
      'Spotify search failed: 429 Too Many Requests',
      expect.any(Error),
    );
  });

  it('still redirects when the click write rejects', async () => {
    db.recordReferralClick.mockRejectedValue(new Error('D1 unavailable'));
    spotify.searchArtistCandidates.mockResolvedValue([{ id: RADIOHEAD_ID, name: 'Radiohead' }]);

    const res = await lookup(params({ artist: 'Radiohead', ref: 'lastfm-mcp' }));

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`/artist/${RADIOHEAD_ID}?ref=lastfm-mcp`);
    await vi.waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith(
        '[Lookup] Deferred referral click failed:',
        'D1 unavailable',
        expect.any(Error),
      ),
    );
  });

  it('does not wait for the click write', async () => {
    db.recordReferralClick.mockReturnValue(new Promise(() => {}));
    spotify.searchArtistCandidates.mockResolvedValue([{ id: RADIOHEAD_ID, name: 'Radiohead' }]);
    const waitUntil = vi.fn();
    const executionCtx = { waitUntil, passThroughOnException: vi.fn(), props: {} } as unknown as ExecutionContext;

    const res = await lookup(params({ artist: 'Radiohead', ref: 'lastfm-mcp' }), undefined, executionCtx);

    expect(res.status).toBe(302);
    expect(db.recordReferralClick).toHaveBeenCalledTimes(1);
    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
  });

  it('records one click per request for a cache hit, a miss and a Spotify error', async () => {
    await kv.put('lookup:v1:artist:radiohead', JSON.stringify({ id: RADIOHEAD_ID }));
    await lookup(params({ artist: 'Radiohead', ref: 'lastfm-mcp' }));
    await lookup(params({ artist: 'Jon Hopkins', album: 'Nonexistent', ref: 'lastfm-mcp' }));
    spotify.searchAlbumCandidates.mockRejectedValue(new Error('Spotify search failed: 500 Error'));
    await lookup(params({ artist: 'Radiohead', album: 'OK Computer', ref: 'lastfm-mcp' }));

    expect(db.recordReferralClick.mock.calls.map((call) => call[0])).toEqual([
      expect.objectContaining({ ref: 'lastfm-mcp', type: 'artist', matched: true }),
      expect.objectContaining({ ref: 'lastfm-mcp', type: 'album', matched: false }),
      expect.objectContaining({ ref: 'lastfm-mcp', type: 'album', matched: false }),
    ]);
  });

  it.each([
    ['rejects', () => Promise.reject(new Error('KV write failed'))],
    ['throws', () => {
      throw new Error('KV write failed');
    }],
  ])('still redirects when the KV write %s', async (_label, put) => {
    vi.mocked(kv.put).mockImplementation(put as typeof kv.put);
    spotify.searchArtistCandidates.mockResolvedValue([{ id: RADIOHEAD_ID, name: 'Radiohead' }]);

    const res = await lookup(params({ artist: 'Radiohead', ref: 'lastfm-mcp' }));

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`/artist/${RADIOHEAD_ID}?ref=lastfm-mcp`);
    await vi.waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('[Lookup]'),
        'KV write failed',
        expect.any(Error),
      ),
    );
  });

  it('records matched, signed-in and bot flags', async () => {
    spotify.searchArtistCandidates.mockResolvedValue([{ id: RADIOHEAD_ID, name: 'Radiohead' }]);
    currentUser = SIGNED_IN_USER;

    await lookup(params({ artist: 'Radiohead', ref: 'lastfm-mcp' }), { headers: { 'User-Agent': 'Claude-User' } });

    currentUser = null;
    await lookup(params({ artist: 'Jon Hopkins', ref: 'lastfm-mcp' }), { headers: { 'User-Agent': BROWSER_UA } });

    expect(db.recordReferralClick.mock.calls.map((call) => call[0])).toEqual([
      { ref: 'lastfm-mcp', type: 'artist', matched: true, signedIn: true, isBot: true },
      { ref: 'lastfm-mcp', type: 'artist', matched: false, signedIn: false, isBot: false },
    ]);
  });

  it('sets noindex and no-store headers', async () => {
    await kv.put('lookup:v1:artist:radiohead', JSON.stringify({ id: RADIOHEAD_ID }));
    const hit = await lookup(params({ artist: 'Radiohead' }));
    const miss = await lookup(params({ artist: 'Jon Hopkins', album: 'Nonexistent' }));
    spotify.searchArtistCandidates.mockRejectedValue(new Error('Spotify search failed: 503 Error'));
    const error = await lookup(params({ artist: 'Four Tet' }));
    const invalid = await lookup('artist=');

    for (const res of [hit, miss, error, invalid]) {
      expectLookupHeaders(res);
    }
    expect([hit.status, miss.status, error.status, invalid.status]).toEqual([302, 302, 302, 400]);
  });
});
