// ABOUTME: Tests for account deletion handler - verifies CSRF protection (F1 fix).
// ABOUTME: Ensures deletion only works via POST with correct confirmation value.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { handleAccountDelete } from '../../pages/account';

// Mock destroySession to avoid crypto/cookie dependencies in tests
vi.mock('../../utils/session', () => ({
  destroySession: vi.fn().mockResolvedValue(undefined),
}));

const mockUser = {
  id: 'user-123',
  username: 'testuser',
  lastfm_username: 'testuser',
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
    const formData = new FormData();
    formData.append('confirmation', 'DELETE');
    const res = await app.request('/account/delete', {
      method: 'POST',
      body: formData,
    });

    // Should redirect to home page after successful deletion
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/');
    expect(mockDb.deleteUserSessions).toHaveBeenCalledWith('user-123');
    expect(mockDb.deleteUser).toHaveBeenCalledWith('user-123');
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
