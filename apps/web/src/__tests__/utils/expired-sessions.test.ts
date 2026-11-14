// ABOUTME: Tests Database.deleteExpiredSessions against a real SQLite table through a minimal D1 adapter.
// ABOUTME: Covers the ISO-timestamp comparison, so sessions that expired earlier today are deleted too.

import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { describe, it, expect } from 'vitest';
import { Database } from '@listentomore/db';

// Vite's import analysis can't resolve node:sqlite, so load it through Node's own require
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = DatabaseSyncType;

/** The slice of D1's prepare → bind → run API that deleteExpiredSessions uses, backed by node:sqlite. */
function d1Over(sqlite: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      let args: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          args = values;
          return statement;
        },
        async run() {
          const result = sqlite.prepare(sql).run(...(args as string[]));
          return { meta: { changes: Number(result.changes) } };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}

function sessionsTable(expiries: Record<string, string>): DatabaseSync {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, expires_at TEXT NOT NULL)');
  const insert = sqlite.prepare('INSERT INTO sessions (id, expires_at) VALUES (?, ?)');
  for (const [id, expiresAt] of Object.entries(expiries)) insert.run(id, expiresAt);
  return sqlite;
}

describe('Database.deleteExpiredSessions', () => {
  it('deletes sessions whose expiry has passed, including earlier today, and keeps the rest', async () => {
    // createSession stores expires_at as an ISO 8601 string
    const sqlite = sessionsTable({
      'expired-yesterday': '2026-11-13T22:00:00.000Z',
      'expired-this-morning': '2026-11-14T09:00:00.000Z',
      'expires-tonight': '2026-11-14T20:00:00.000Z',
      'expires-next-month': '2026-12-14T09:00:00.000Z',
    });
    const db = new Database(d1Over(sqlite));

    const deleted = await db.deleteExpiredSessions(new Date('2026-11-14T17:00:00.000Z'));

    expect(deleted).toBe(2);
    const remaining = sqlite.prepare('SELECT id FROM sessions ORDER BY id').all().map((row) => row.id);
    expect(remaining).toEqual(['expires-next-month', 'expires-tonight']);
  });

  it('returns 0 when nothing has expired', async () => {
    const sqlite = sessionsTable({ 'expires-next-month': '2026-12-14T09:00:00.000Z' });
    const db = new Database(d1Over(sqlite));

    expect(await db.deleteExpiredSessions(new Date('2026-11-14T17:00:00.000Z'))).toBe(0);
  });
});
