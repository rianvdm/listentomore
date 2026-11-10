// ABOUTME: Tests for syncUserTimezone, which stores the signed-in owner's cf.timezone on page loads.
// ABOUTME: Covers change detection, Intl validation, the waitUntil hand-off and failure logging.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Context } from 'hono';
import { Database } from '@listentomore/db';
import type { User } from '@listentomore/db';
import { syncUserTimezone } from '../../utils/timezone';

const OWNER: User = {
  id: 'user-1',
  username: 'owner',
  email: null,
  lastfm_username: 'owner',
  lastfm_session_key: null,
  discogs_username: null,
  spotify_connected: 0,
  display_name: 'Owner',
  avatar_url: null,
  bio: null,
  profile_visibility: 'public',
  signup_ref: null,
  timezone: null,
  last_login_at: null,
  login_count: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

interface FakeContextOptions {
  cf?: Record<string, unknown>;
  waitUntil?: ReturnType<typeof vi.fn>;
}

// Only the parts syncUserTimezone reads: the raw request's cf object, the db, and executionCtx.
function createContext(db: Pick<Database, 'updateUser'>, options: FakeContextOptions = {}): Context {
  const raw = new Request('https://listentomore.com/');
  if (options.cf) Object.defineProperty(raw, 'cf', { value: options.cf });

  return {
    req: { raw },
    get: (key: string) => (key === 'db' ? db : undefined),
    get executionCtx() {
      if (!options.waitUntil) throw new Error('This context does not have an ExecutionContext');
      return { waitUntil: options.waitUntil };
    },
  } as unknown as Context;
}

describe('syncUserTimezone', () => {
  let updateUser: ReturnType<typeof vi.fn>;
  let db: Pick<Database, 'updateUser'>;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    updateUser = vi.fn().mockResolvedValue(undefined);
    db = { updateUser } as unknown as Pick<Database, 'updateUser'>;
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stores a new timezone for a signed-in user', () => {
    const waitUntil = vi.fn();
    const c = createContext(db, { cf: { timezone: 'America/Los_Angeles' }, waitUntil });

    syncUserTimezone(c, OWNER);

    expect(updateUser).toHaveBeenCalledWith('user-1', { timezone: 'America/Los_Angeles' });
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise);
  });

  it('replaces a different stored timezone', () => {
    const c = createContext(db, { cf: { timezone: 'Europe/London' }, waitUntil: vi.fn() });

    syncUserTimezone(c, { ...OWNER, timezone: 'America/Los_Angeles' });

    expect(updateUser).toHaveBeenCalledWith('user-1', { timezone: 'Europe/London' });
  });

  it('does nothing when the timezone is unchanged', () => {
    const waitUntil = vi.fn();
    const c = createContext(db, { cf: { timezone: 'America/Los_Angeles' }, waitUntil });

    syncUserTimezone(c, { ...OWNER, timezone: 'America/Los_Angeles' });

    expect(updateUser).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it('does nothing for an anonymous request or a missing cf object', () => {
    syncUserTimezone(createContext(db, { cf: { timezone: 'America/Los_Angeles' } }), null);
    syncUserTimezone(createContext(db), OWNER);
    syncUserTimezone(createContext(db, { cf: {} }), OWNER);

    expect(updateUser).not.toHaveBeenCalled();
  });

  it.each([['Not/AZone'], [''], [42]])('ignores a value Intl rejects (%j)', (timezone) => {
    const c = createContext(db, { cf: { timezone }, waitUntil: vi.fn() });

    syncUserTimezone(c, OWNER);

    expect(updateUser).not.toHaveBeenCalled();
  });

  it('a failed write is logged and never throws', async () => {
    updateUser.mockRejectedValue(new Error('D1_ERROR: database is locked'));
    const waitUntil = vi.fn();
    const c = createContext(db, { cf: { timezone: 'America/Los_Angeles' }, waitUntil });

    expect(() => syncUserTimezone(c, OWNER)).not.toThrow();
    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledTimes(1);
    const logged = consoleError.mock.calls[0].map(String).join(' ');
    expect(logged).toContain('database is locked');
    expect(logged).not.toContain('America/Los_Angeles');
    expect(logged).not.toContain('user-1');
  });

  it('logs a failed write without waitUntil (no ExecutionContext)', async () => {
    updateUser.mockRejectedValue(new Error('D1_ERROR: database is locked'));
    const c = createContext(db, { cf: { timezone: 'America/Los_Angeles' } });

    expect(() => syncUserTimezone(c, OWNER)).not.toThrow();
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledTimes(1));
  });
});

describe('Database.updateUser timezone', () => {
  it('writes the timezone column', async () => {
    const calls: { sql: string; args: unknown[] }[] = [];
    const d1 = {
      prepare: (sql: string) => {
        const call = { sql, args: [] as unknown[] };
        calls.push(call);
        const statement = {
          bind: (...args: unknown[]) => {
            call.args = args;
            return statement;
          },
          run: async () => ({ success: true }),
        };
        return statement;
      },
    } as unknown as D1Database;

    await new Database(d1).updateUser('user-1', { timezone: 'Europe/London' });

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/^UPDATE users SET timezone = \?, updated_at = datetime\('now'\) WHERE id = \?$/);
    expect(calls[0].args).toEqual(['Europe/London', 'user-1']);
  });
});
