// ABOUTME: Integration tests for where the full app loads the user session.
// ABOUTME: Pages and public API routes load it eagerly; /api/internal/* only when a route needs the user.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
import { Database } from '@listentomore/db';
import type { Session, User } from '@listentomore/db';
import { generateInternalToken } from '../../utils/internal-token';
import { createMockKV } from '../utils/mocks';

// index.tsx re-exports a Durable Object class built on the Workers runtime module
vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));

const { default: worker } = await import('../../index');

const INTERNAL_SECRET = 'test-internal-secret';
const SESSION_COOKIE = 'ltm_session=session-token';

const SIGNED_IN_USER: User = {
  id: 'user-1',
  username: 'viewer',
  email: null,
  lastfm_username: 'viewer',
  lastfm_session_key: null,
  discogs_username: null,
  spotify_connected: 0,
  display_name: 'Viewer',
  avatar_url: null,
  bio: null,
  profile_visibility: 'public',
  last_login_at: null,
  login_count: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const ACTIVE_SESSION: Session = {
  id: 'session-1',
  user_id: SIGNED_IN_USER.id,
  token_hash: 'hash',
  user_agent: null,
  ip_address: null,
  created_at: '2026-01-01T00:00:00Z',
  expires_at: '2999-01-01T00:00:00Z',
  last_active_at: '2026-01-01T00:00:00Z',
};

function createEnv(cache: KVNamespace = createMockKV()) {
  return {
    DB: {} as D1Database,
    CACHE: cache,
    MUSICBRAINZ_RATE_LIMITER: {
      idFromName: vi.fn(() => ({})),
      get: vi.fn(() => ({ reserve: vi.fn() })),
    },
    SPOTIFY_CLIENT_ID: 'id',
    SPOTIFY_CLIENT_SECRET: 'secret',
    LASTFM_API_KEY: 'lastfm',
    LASTFM_USERNAME: 'owner',
    OPENAI_API_KEY: 'openai',
    ANTHROPIC_API_KEY: 'anthropic',
    INTERNAL_API_SECRET: INTERNAL_SECRET,
  };
}

function createExecutionCtx() {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext & { waitUntil: ReturnType<typeof vi.fn> };
}

async function request(
  path: string,
  options: { signedIn?: boolean; internal?: boolean; cache?: KVNamespace; ctx?: ExecutionContext } = {}
) {
  const headers: Record<string, string> = {};
  if (options.signedIn) headers.Cookie = SESSION_COOKIE;
  if (options.internal) headers['X-Internal-Token'] = await generateInternalToken(INTERNAL_SECRET);

  return worker.fetch(
    new Request(`https://listentomore.com${path}`, { headers }),
    createEnv(options.cache) as never,
    options.ctx ?? createExecutionCtx()
  );
}

describe('session loading scope', () => {
  let getSessionByToken: MockInstance<Database['getSessionByToken']>;
  let getUser: MockInstance<Database['getUser']>;
  let updateSessionActivity: MockInstance<Database['updateSessionActivity']>;
  let logApiUsage: MockInstance<Database['logApiUsage']>;
  let getUserByLastfmUsername: MockInstance<Database['getUserByLastfmUsername']>;

  beforeEach(() => {
    getSessionByToken = vi.spyOn(Database.prototype, 'getSessionByToken').mockResolvedValue(ACTIVE_SESSION);
    getUser = vi.spyOn(Database.prototype, 'getUser').mockResolvedValue(SIGNED_IN_USER);
    updateSessionActivity = vi.spyOn(Database.prototype, 'updateSessionActivity').mockResolvedValue();
    logApiUsage = vi.spyOn(Database.prototype, 'logApiUsage').mockResolvedValue();
    getUserByLastfmUsername = vi.spyOn(Database.prototype, 'getUserByLastfmUsername').mockResolvedValue(null);
    vi.spyOn(Database.prototype, 'getUserByUsername').mockResolvedValue(null);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('internal routes that do not read the user', () => {
    it.each([
      ['/api/internal/search'],
      ['/api/internal/streaming-links'],
      ['/api/internal/user-listens'],
      ['/api/internal/user-insights-cooldown?username=viewer'],
    ])('skips the session lookup for a signed-in request to %s', async (path) => {
      const res = await request(path, { signedIn: true, internal: true });

      expect(res.status).toBeLessThan(500);
      expect(getSessionByToken).not.toHaveBeenCalled();
      expect(getUser).not.toHaveBeenCalled();
      expect(updateSessionActivity).not.toHaveBeenCalled();
    });

    it('skips the session lookup for an anonymous request', async () => {
      const res = await request('/api/internal/search', { internal: true });

      expect(res.status).toBe(400);
      expect(getSessionByToken).not.toHaveBeenCalled();
      expect(getUser).not.toHaveBeenCalled();
    });

    it('skips the lookup for a public profile on a user route', async () => {
      getUserByLastfmUsername.mockResolvedValue({ ...SIGNED_IN_USER, id: 'user-2', lastfm_username: 'other' });
      const cache = createMockKV();
      await cache.put('user-recommendations:other', JSON.stringify([{ name: 'Cached Artist' }]));

      const res = await request('/api/internal/user-recommendations?username=other', {
        signedIn: true,
        internal: true,
        cache,
      });

      expect(res.status).toBe(200);
      expect(getSessionByToken).not.toHaveBeenCalled();
    });
  });

  describe('internal routes that read the user', () => {
    it('loads the session to check access to a private profile', async () => {
      getUserByLastfmUsername.mockResolvedValue({
        ...SIGNED_IN_USER,
        id: 'user-2',
        lastfm_username: 'other',
        profile_visibility: 'private',
      });

      const res = await request('/api/internal/user-recommendations?username=other', {
        signedIn: true,
        internal: true,
      });

      expect(res.status).toBe(403);
      expect(getSessionByToken).toHaveBeenCalledTimes(1);
      expect(getUser).toHaveBeenCalledTimes(1);
    });

    it('lets the owner see their own private profile', async () => {
      getUserByLastfmUsername.mockResolvedValue({ ...SIGNED_IN_USER, profile_visibility: 'private' });
      const cache = createMockKV();
      await cache.put('user-recommendations:viewer', JSON.stringify([{ name: 'Cached Artist' }]));

      const res = await request('/api/internal/user-recommendations?username=viewer', {
        signedIn: true,
        internal: true,
        cache,
      });

      expect(res.status).toBe(200);
      expect(getSessionByToken).toHaveBeenCalledTimes(1);
    });

    it('loads the session once for insights (auth guard and owner check share the lookup)', async () => {
      const res = await request('/api/internal/user-insights-summary?username=nobody', {
        signedIn: true,
        internal: true,
      });

      // Passed requireSessionAuth, reached the handler, and found no such user
      expect(res.status).toBe(404);
      expect(getSessionByToken).toHaveBeenCalledTimes(1);
      expect(getUser).toHaveBeenCalledTimes(1);
    });

    it('rejects an anonymous request to an AI route', async () => {
      const res = await request('/api/internal/album-summary?spotifyId=6MxGJsAzHR2ekEmelJ7Poy', { internal: true });

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Authentication required' });
    });

    it('rejects an AI route request whose session cookie is unknown', async () => {
      getSessionByToken.mockResolvedValue(null);

      const res = await request('/api/internal/genre-summary?genre=jazz', { signedIn: true, internal: true });

      expect(res.status).toBe(401);
      expect(getSessionByToken).toHaveBeenCalledTimes(1);
      expect(getUser).not.toHaveBeenCalled();
    });

    it('admits a signed-in request to an AI route', async () => {
      const res = await request('/api/internal/album-summary', { signedIn: true, internal: true });

      // Past the auth guard: the handler rejects the missing parameters
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Missing spotifyId parameter' });
      expect(getSessionByToken).toHaveBeenCalledTimes(1);
    });
  });

  describe('routes outside /api/internal/', () => {
    it('loads the session for a page and renders signed-in state', async () => {
      const res = await request('/about', { signedIn: true });

      expect(res.status).toBe(200);
      expect(getSessionByToken).toHaveBeenCalledTimes(1);
      expect(getUser).toHaveBeenCalledTimes(1);
      expect(await res.text()).toContain('/account');
    });

    it('renders an anonymous page without signed-in state', async () => {
      const res = await request('/about');

      expect(res.status).toBe(200);
      expect(getSessionByToken).not.toHaveBeenCalled();
      expect(await res.text()).not.toContain('/account');
    });

    it('still loads the session for public API routes', async () => {
      const res = await request('/api/v1/album?artist=a&album=b', { signedIn: true });

      // No API key, so requireAuth rejects as before; the session middleware ran first
      expect(res.status).toBe(401);
      expect(getSessionByToken).toHaveBeenCalledTimes(1);
    });
  });

  describe('background D1 writes', () => {
    it('hands the session activity UPDATE to waitUntil and skips the usage log on internal routes', async () => {
      const ctx = createExecutionCtx();

      const res = await request('/api/internal/album-summary', { signedIn: true, internal: true, ctx });

      expect(res.status).toBe(400);
      expect(updateSessionActivity).toHaveBeenCalledWith(ACTIVE_SESSION.id);
      expect(logApiUsage).not.toHaveBeenCalled();
      expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
      expect(ctx.waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise);
    });

  });
});
