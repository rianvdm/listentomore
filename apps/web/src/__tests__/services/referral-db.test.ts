// ABOUTME: Database tests for referral click recording and the signup_ref column on createUser.
// ABOUTME: Uses a fake D1 that records the last prepared SQL and bound arguments.

import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from '@listentomore/db';
import type { User } from '@listentomore/db';

interface FakeD1 {
  db: D1Database;
  lastSql: () => string;
  lastBind: () => unknown[];
}

function createFakeD1(firstRow: unknown = null): FakeD1 {
  const calls: { sql: string; args: unknown[] }[] = [];

  const db = {
    prepare: (sql: string) => {
      const call = { sql, args: [] as unknown[] };
      calls.push(call);
      const statement = {
        bind: (...args: unknown[]) => {
          call.args = args;
          return statement;
        },
        run: async () => ({ success: true }),
        first: async () => firstRow,
      };
      return statement;
    },
  };

  return {
    db: db as unknown as D1Database,
    lastSql: () => calls[calls.length - 1]?.sql ?? '',
    lastBind: () => calls[calls.length - 1]?.args ?? [],
  };
}

const CREATED_USER_ROW: User = {
  id: 'u1',
  username: 'x',
  email: null,
  lastfm_username: 'X',
  lastfm_session_key: null,
  discogs_username: null,
  spotify_connected: 0,
  display_name: 'X',
  avatar_url: null,
  bio: null,
  profile_visibility: 'public',
  signup_ref: null,
  last_login_at: null,
  login_count: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('Database referral tracking', () => {
  let fake: FakeD1;
  let db: Database;

  beforeEach(() => {
    fake = createFakeD1(CREATED_USER_ROW);
    db = new Database(fake.db);
  });

  describe('recordReferralClick', () => {
    it('inserts a referral click with booleans as 0/1 and no identifying fields', async () => {
      await db.recordReferralClick({ ref: 'lastfm-mcp', type: 'album', matched: true, signedIn: false, isBot: true });

      expect(fake.lastSql()).toMatch(/INSERT INTO referral_clicks \(ref, type, matched, signed_in, is_bot\)/);
      expect(fake.lastBind()).toEqual(['lastfm-mcp', 'album', 1, 0, 1]);
    });
  });

  describe('createUser', () => {
    it('stores signup_ref when creating a user', async () => {
      await db.createUser({ id: 'u1', username: 'x', lastfm_username: 'X', signup_ref: 'lastfm-mcp' });

      expect(fake.lastSql()).toMatch(/signup_ref/);
      expect(fake.lastBind()).toContain('lastfm-mcp');
    });

    it('stores null signup_ref when none is given', async () => {
      await db.createUser({ id: 'u1', username: 'x', lastfm_username: 'X' });

      expect(fake.lastSql()).toMatch(/INSERT INTO users \(id, username, lastfm_username, lastfm_session_key, display_name, avatar_url, profile_visibility, signup_ref, login_count\)/);
      expect(fake.lastBind()).toEqual(['u1', 'x', 'X', null, 'X', null, 'public', null]);
    });
  });
});
