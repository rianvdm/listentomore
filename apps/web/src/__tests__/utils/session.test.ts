// ABOUTME: Tests for validateSession's background last_active_at UPDATE.
// ABOUTME: The UPDATE goes to waitUntil when available and never fails the request.

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import type { Database, Session, User } from '@listentomore/db';
import type { WaitUntil } from '@listentomore/shared';
import { validateSession } from '../../utils/session';

const USER = { id: 'user-1', username: 'test' } as User;
const SESSION = { id: 'session-1', user_id: USER.id, expires_at: '2999-01-01T00:00:00Z' } as Session;

function createDb(updateSessionActivity: ReturnType<typeof vi.fn>) {
  return {
    getSessionByToken: vi.fn().mockResolvedValue(SESSION),
    getUser: vi.fn().mockResolvedValue(USER),
    updateSessionActivity,
  } as unknown as Database;
}

async function runValidateSession(db: Database, waitUntil?: WaitUntil) {
  const app = new Hono();
  app.get('/', async (c) => c.json({ user: await validateSession(c, db, waitUntil) }));
  const res = await app.request('/', { headers: { Cookie: 'ltm_session=token' } });
  return res.json() as Promise<{ user: User | null }>;
}

describe('validateSession', () => {
  it('hands the activity UPDATE to waitUntil', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const waitUntil = vi.fn();

    const body = await runValidateSession(createDb(update), waitUntil);

    expect(body.user).toEqual(USER);
    expect(update).toHaveBeenCalledWith(SESSION.id);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise);
  });

  it('works without waitUntil and logs a failed UPDATE instead of throwing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const update = vi.fn().mockRejectedValue(new Error('D1_ERROR: timeout'));

    const body = await runValidateSession(createDb(update));
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());

    expect(body.user).toEqual(USER);
    expect(errorSpy).toHaveBeenCalledWith(
      '[Session] Deferred session activity update failed:',
      'D1_ERROR: timeout',
      expect.any(Error)
    );
    errorSpy.mockRestore();
  });
});
