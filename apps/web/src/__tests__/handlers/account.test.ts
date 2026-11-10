// ABOUTME: Tests for account deletion handler - verifies CSRF protection (F1 fix) and cached-data cleanup.
// ABOUTME: Ensures deletion only works via POST with DELETE, and clears the user's KV keys before the user row.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { handleAccountDelete } from '../../pages/account';
import { createMockKV } from '../utils/mocks';

// Mock destroySession to avoid crypto/cookie dependencies in tests
vi.mock('../../utils/session', () => ({
  destroySession: vi.fn().mockResolvedValue(undefined),
}));

const mockUser = {
  id: 'user-123',
  username: 'testuser',
  lastfm_username: 'TestUser',
  display_name: 'Test User',
  bio: null,
  profile_visibility: 'public' as const,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

function createMockDb() {
  return {
    deleteUserSessions: vi.fn().mockResolvedValue(undefined),
    deleteUser: vi.fn().mockResolvedValue(undefined),
  };
}

function deleteRequest(cache: KVNamespace) {
  const formData = new FormData();
  formData.append('confirmation', 'DELETE');
  return [{ method: 'POST', body: formData }, { CACHE: cache }] as const;
}

type TestVariables = {
  currentUser: typeof mockUser | null;
  db: ReturnType<typeof createMockDb>;
};

describe('Account Delete Handler', () => {
  let app: Hono<{ Variables: TestVariables }>;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockDb = createMockDb();
    app = new Hono<{ Variables: TestVariables }>();

    // Middleware to inject mock services (authenticated user)
    app.use('/account/delete', async (c, next) => {
      c.set('currentUser', mockUser);
      c.set('db', mockDb);
      await next();
    });

    app.post('/account/delete', handleAccountDelete);
  });

  it('rejects GET requests (returns 404)', async () => {
    const res = await app.request('/account/delete', { method: 'GET' });

    // GET should not match the POST route, so Hono returns 404
    expect(res.status).toBe(404);
    expect(mockDb.deleteUser).not.toHaveBeenCalled();
    expect(mockDb.deleteUserSessions).not.toHaveBeenCalled();
  });

  it('rejects POST without confirmation field', async () => {
    const formData = new FormData();
    const res = await app.request('/account/delete', {
      method: 'POST',
      body: formData,
    });

    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain('Invalid Request');
    expect(mockDb.deleteUser).not.toHaveBeenCalled();
    expect(mockDb.deleteUserSessions).not.toHaveBeenCalled();
  });

  it('rejects POST with wrong confirmation value', async () => {
    const formData = new FormData();
    formData.append('confirmation', 'yes');
    const res = await app.request('/account/delete', {
      method: 'POST',
      body: formData,
    });

    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain('Invalid Request');
    expect(mockDb.deleteUser).not.toHaveBeenCalled();
    expect(mockDb.deleteUserSessions).not.toHaveBeenCalled();
  });

  it('succeeds with POST and confirmation=DELETE', async () => {
    const res = await app.request('/account/delete', ...deleteRequest(createMockKV()));

    // Should redirect to home page after successful deletion
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/');
    expect(mockDb.deleteUserSessions).toHaveBeenCalledWith('user-123');
    expect(mockDb.deleteUser).toHaveBeenCalledWith('user-123');
  });

  it("account deletion clears the user's insights keys before deleting the user", async () => {
    const cache = createMockKV();
    await cache.put('insights:facts:testuser', '{}');
    await cache.put('lastfm:scrobbles:testuser:2026-11-01', '[]');
    await cache.put('lastfm:topartists:TestUser:7day:5', '[]');
    await cache.put('insights:facts:testuser2', '{}');
    let factsAtUserDelete: string | null = 'unread';
    mockDb.deleteUser.mockImplementation(async () => {
      factsAtUserDelete = await cache.get('insights:facts:testuser');
    });

    const res = await app.request('/account/delete', ...deleteRequest(cache));

    expect(res.status).toBe(302);
    expect(factsAtUserDelete).toBeNull();
    expect(await cache.get('lastfm:scrobbles:testuser:2026-11-01')).toBeNull();
    expect(await cache.get('lastfm:topartists:TestUser:7day:5')).toBeNull();
    expect(await cache.get('insights:facts:testuser2')).toBe('{}');
    expect(mockDb.deleteUserSessions).toHaveBeenCalledWith('user-123');
    expect(mockDb.deleteUser).toHaveBeenCalledWith('user-123');
  });

  it('account deletion still succeeds when KV cleanup throws', async () => {
    const cache = createMockKV();
    (cache.list as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('KV down'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await app.request('/account/delete', ...deleteRequest(cache));

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/');
    expect(mockDb.deleteUser).toHaveBeenCalledWith('user-123');
    expect(consoleError).toHaveBeenCalledWith(
      '[DELETE_USER] Cached data cleanup failed, continuing',
      expect.objectContaining({ user_id: 'user-123', error: 'KV down' }),
    );
    consoleError.mockRestore();
  });

  it('redirects unauthenticated users to login', async () => {
    // Create a separate app with no authenticated user
    const unauthApp = new Hono<{ Variables: TestVariables }>();
    unauthApp.use('/account/delete', async (c, next) => {
      c.set('currentUser', null);
      c.set('db', mockDb);
      await next();
    });
    unauthApp.post('/account/delete', handleAccountDelete);

    const formData = new FormData();
    formData.append('confirmation', 'DELETE');
    const res = await unauthApp.request('/account/delete', {
      method: 'POST',
      body: formData,
    });

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/login');
    expect(mockDb.deleteUser).not.toHaveBeenCalled();
  });
});
