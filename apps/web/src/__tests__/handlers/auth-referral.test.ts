// ABOUTME: Tests for carrying a referral `ref` and a safe `next` through /login, /auth/lastfm and its callback.
// ABOUTME: Covers signup_ref on new users only, the Discord sign-up and claim messages, and open-redirect rejection.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { handleLogin } from '../../pages/auth/login';
import { handleLastfmAuth, handleLastfmCallback, isSafeRedirect } from '../../pages/auth/lastfm';
import { setupFetchMock } from '../utils/mocks';

type TestVariables = {
  db: unknown;
  currentUser: unknown;
};

const ENV = {
  LASTFM_API_KEY: 'test-api-key',
  LASTFM_SHARED_SECRET: 'test-shared-secret',
  DISCORD_WEBHOOK_URL: 'https://discord.test/webhook',
};
const CALLBACK_URL = 'http://localhost/auth/lastfm/callback';
const NEW_LASTFM_NAME = 'NewListener';
const NEW_PROFILE = `/u/${NEW_LASTFM_NAME}`;

const UNSAFE_NEXTS = ['/\\evil.example', '//evil.example', 'https://evil.example', '/\tevil'];
const SAFE_NEXTS = ['/album/6dVIqQ8qmQ5GBnJ9shOYGE', '/artist/4Z8W4fKeB5YxbusRsdQVPb?ref=lastfm-mcp'];
const REPEATED_REFS = ['ref=lastfm-mcp&ref=evil', 'ref=evil&ref=lastfm-mcp'];

interface StoredUser {
  id: string;
  username: string;
  lastfm_username: string;
  display_name: string | null;
  avatar_url: string | null;
  login_count: number;
}

describe('referral through Last.fm sign-in', () => {
  let app: Hono<{ Variables: TestVariables }>;
  let fetchMock: ReturnType<typeof setupFetchMock>;
  let executionCtx: ExecutionContext;
  let waitUntil: ReturnType<typeof vi.fn>;

  const db = {
    getUserByLastfmUsername: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    createSession: vi.fn(),
  };

  function loginPage(query: string) {
    return app.request(`/login?${query}`, undefined, ENV);
  }

  function authStart(query: string) {
    return app.request(`/auth/lastfm?${query}`, undefined, ENV);
  }

  function callback(query: string) {
    return app.request(`/auth/lastfm/callback?token=test-token&${query}`, undefined, ENV, executionCtx);
  }

  /** The sign-in button's href, with HTML attribute escaping undone. */
  async function authHref(res: Response): Promise<string> {
    expect(res.status).toBe(200);
    const match = (await res.text()).match(/href="(\/auth\/lastfm[^"]*)"/);
    expect(match).not.toBeNull();
    return match![1].replace(/&amp;/g, '&');
  }

  /** The `cb` Last.fm will call back to, decoded from the auth start redirect. */
  function callbackParam(res: Response): string {
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('Location')!);
    expect(location.origin + location.pathname).toBe('https://www.last.fm/api/auth/');
    expect(location.searchParams.get('api_key')).toBe(ENV.LASTFM_API_KEY);
    return location.searchParams.get('cb')!;
  }

  /** Every callback test checks it finished: a session was created and the redirect went where expected. */
  function expectSignedIn(res: Response, location: string) {
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(location);
    expect(db.createSession).toHaveBeenCalledTimes(1);
  }

  function discordMessages(): string[] {
    return fetchMock.mock.calls
      .filter(([url]) => String(url) === ENV.DISCORD_WEBHOOK_URL)
      .map(([, init]) => (JSON.parse(String(init?.body)) as { content: string }).content);
  }

  function existingUser(overrides: Partial<StoredUser>): StoredUser {
    return {
      id: 'user-1',
      username: 'returning',
      lastfm_username: 'Returning',
      display_name: 'Returning',
      avatar_url: 'https://img.example/a.png',
      login_count: 3,
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    fetchMock = setupFetchMock([
      { pattern: 'method=auth.getSession', response: { session: { name: NEW_LASTFM_NAME, key: 'session-key' } } },
      { pattern: 'method=user.getinfo', response: { user: { image: [] } } },
      { pattern: ENV.DISCORD_WEBHOOK_URL, response: {} },
    ]);

    waitUntil = vi.fn();
    executionCtx = { waitUntil, passThroughOnException: vi.fn(), props: {} } as unknown as ExecutionContext;

    db.getUserByLastfmUsername.mockResolvedValue(null);
    db.createUser.mockImplementation(async (data: Record<string, unknown>) => ({ ...data, login_count: 1 }));
    db.updateUser.mockResolvedValue(undefined);
    db.createSession.mockResolvedValue(undefined);

    app = new Hono<{ Variables: TestVariables }>();
    app.use('*', async (c, next) => {
      c.set('db', db);
      c.set('currentUser', null);
      await next();
    });
    app.get('/login', handleLogin);
    app.get('/auth/lastfm', handleLastfmAuth);
    app.get('/auth/lastfm/callback', handleLastfmCallback);
  });

  describe('login page', () => {
    it('login page forwards a known ref to /auth/lastfm', async () => {
      const href = await authHref(await loginPage('next=%2Falbum%2Fx&ref=lastfm-mcp'));

      expect(href).toContain('&ref=lastfm-mcp');
      expect(href).toBe('/auth/lastfm?next=%2Falbum%2Fx&ref=lastfm-mcp');
    });

    it('login page drops an unknown ref', async () => {
      const href = await authHref(await loginPage('next=%2Falbum%2Fx&ref=evil'));

      expect(href).toBe('/auth/lastfm?next=%2Falbum%2Fx');
    });

    it('login page forwards a known ref with no next', async () => {
      expect(await authHref(await loginPage('ref=lastfm-mcp'))).toBe('/auth/lastfm?ref=lastfm-mcp');
    });

    it('login page links to /auth/lastfm with no parameters when given none', async () => {
      expect(await authHref(await loginPage(''))).toBe('/auth/lastfm');
    });

    it.each(UNSAFE_NEXTS)('login page drops next=%s', async (next) => {
      const href = await authHref(await loginPage(`next=${encodeURIComponent(next)}&ref=lastfm-mcp`));

      expect(href).toBe('/auth/lastfm?ref=lastfm-mcp');
    });
  });

  describe('auth start', () => {
    it('auth start puts ref on the callback URL', async () => {
      const cb = callbackParam(await authStart('next=%2Falbum%2Fx&ref=lastfm-mcp'));

      expect(cb).toBe(`${CALLBACK_URL}?next=%2Falbum%2Fx&ref=lastfm-mcp`);
    });

    it('auth start forwards ref with no next', async () => {
      expect(callbackParam(await authStart('ref=lastfm-mcp'))).toBe(`${CALLBACK_URL}?ref=lastfm-mcp`);
    });

    it('auth start drops an unknown ref', async () => {
      expect(callbackParam(await authStart('next=%2Falbum%2Fx&ref=evil'))).toBe(`${CALLBACK_URL}?next=%2Falbum%2Fx`);
    });

    it('auth start uses the bare callback URL when given no parameters', async () => {
      expect(callbackParam(await authStart(''))).toBe(CALLBACK_URL);
    });
  });

  describe('callback', () => {
    it('callback stores signup_ref on a new user', async () => {
      const res = await callback('next=%2Falbum%2Fx&ref=lastfm-mcp');

      expectSignedIn(res, '/album/x');
      expect(db.createUser).toHaveBeenCalledTimes(1);
      expect(db.createUser.mock.calls[0][0]).toMatchObject({
        username: 'newlistener',
        lastfm_username: NEW_LASTFM_NAME,
        signup_ref: 'lastfm-mcp',
      });
    });

    it('callback stores no signup_ref for an unknown ref', async () => {
      const res = await callback('ref=evil');

      expectSignedIn(res, NEW_PROFILE);
      expect(db.createUser).toHaveBeenCalledTimes(1);
      expect(db.createUser.mock.calls[0][0].signup_ref).toBeUndefined();
      expect(discordMessages()).toEqual([
        '🎉 New signup: **newlistener** — https://listentomore.com/u/newlistener',
      ]);
    });

    it('callback does not write signup_ref for a returning user', async () => {
      db.getUserByLastfmUsername.mockResolvedValue(existingUser({}));

      const res = await callback('ref=lastfm-mcp');

      expectSignedIn(res, '/u/Returning');
      expect(db.createUser).not.toHaveBeenCalled();
      expect(db.updateUser).toHaveBeenCalledTimes(1);
      expect(db.updateUser.mock.calls[0][1]).not.toHaveProperty('signup_ref');
      expect(discordMessages()).toEqual([]);
      expect(waitUntil).not.toHaveBeenCalled();
    });

    it('callback keeps the claim notification for an existing account with login_count 0', async () => {
      db.getUserByLastfmUsername.mockResolvedValue(
        existingUser({ username: 'claimed', lastfm_username: 'Claimed', login_count: 0 }),
      );

      const res = await callback('ref=lastfm-mcp');

      expectSignedIn(res, '/u/Claimed');
      expect(db.createUser).not.toHaveBeenCalled();
      expect(db.updateUser.mock.calls[0][1]).not.toHaveProperty('signup_ref');
      const messages = discordMessages();
      expect(messages).toEqual(['🔗 Account claimed: **claimed** — https://listentomore.com/u/claimed']);
      expect(messages[0]).not.toContain('(via');
      expect(waitUntil).toHaveBeenCalledTimes(1);
    });

    it('Discord message names the referrer for a new user', async () => {
      const res = await callback('ref=lastfm-mcp');

      expectSignedIn(res, NEW_PROFILE);
      expect(waitUntil).toHaveBeenCalledTimes(1);
      const messages = discordMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain('(via lastfm-mcp)');
      expect(messages[0]).toBe('🎉 New signup: **newlistener** (via lastfm-mcp) — https://listentomore.com/u/newlistener');
    });
  });

  it.each(REPEATED_REFS)('drops a repeated ref at login, auth start and callback (%s)', async (refs) => {
    expect(await authHref(await loginPage(`next=%2Falbum%2Fx&${refs}`))).toBe('/auth/lastfm?next=%2Falbum%2Fx');
    expect(callbackParam(await authStart(`next=%2Falbum%2Fx&${refs}`))).toBe(`${CALLBACK_URL}?next=%2Falbum%2Fx`);

    const res = await callback(`next=%2Falbum%2Fx&${refs}`);

    expectSignedIn(res, '/album/x');
    expect(db.createUser.mock.calls[0][0].signup_ref).toBeUndefined();
    expect(discordMessages()[0]).not.toContain('(via');
  });

  it.each(UNSAFE_NEXTS)('rejects next=%s at auth start and callback', async (next) => {
    const query = `next=${encodeURIComponent(next)}&ref=lastfm-mcp`;

    expect(callbackParam(await authStart(query))).toBe(`${CALLBACK_URL}?ref=lastfm-mcp`);

    const res = await callback(query);

    expectSignedIn(res, NEW_PROFILE);
    expect(db.createUser.mock.calls[0][0].signup_ref).toBe('lastfm-mcp');
  });

  it('rejects the raw query next=%2F%5Cevil.example', async () => {
    expect(callbackParam(await authStart('next=%2F%5Cevil.example'))).toBe(CALLBACK_URL);

    const res = await callback('next=%2F%5Cevil.example');

    expectSignedIn(res, NEW_PROFILE);
  });

  it.each(SAFE_NEXTS)('accepts next=%s', async (next) => {
    const query = `next=${encodeURIComponent(next)}`;

    expect(await authHref(await loginPage(query))).toBe(`/auth/lastfm?${new URLSearchParams({ next })}`);
    expect(callbackParam(await authStart(query))).toBe(`${CALLBACK_URL}?${new URLSearchParams({ next })}`);

    const res = await callback(query);

    expectSignedIn(res, next);
    expect(db.createUser.mock.calls[0][0].signup_ref).toBeUndefined();
  });
});

describe('isSafeRedirect', () => {
  it.each([
    '/',
    '/album/6dVIqQ8qmQ5GBnJ9shOYGE',
    '/artist/4Z8W4fKeB5YxbusRsdQVPb?ref=lastfm-mcp',
    '/u/rian#top',
  ])('accepts %s', (url) => {
    expect(isSafeRedirect(url)).toBe(true);
  });

  it.each([
    '',
    'album/x',
    '//evil.example',
    '/\\evil.example',
    '\\/evil.example',
    '/\\/evil.example',
    'https://evil.example',
    '/\tevil',
    '/\t/evil.example',
    '/\n/evil.example',
    '/\u0000evil',
    '/\u007fevil',
    'javascript:alert(1)',
  ])('rejects %j', (url) => {
    expect(isSafeRedirect(url)).toBe(false);
  });
});
