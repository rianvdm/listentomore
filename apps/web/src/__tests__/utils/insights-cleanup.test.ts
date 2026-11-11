// ABOUTME: Tests for deleteUserInsightsData: one user's insights and per-user Last.fm cache keys go, and
// ABOUTME: nobody else's do, including users whose names start with this one's and global keys.

import { describe, it, expect, vi } from 'vitest';
import { deleteUserInsightsData } from '../../utils/insights-cleanup';
import { createMockKV } from './mocks';

async function seed(kv: KVNamespace, names: string[]): Promise<void> {
  for (const name of names) await kv.put(name, '{}');
}

async function remaining(kv: KVNamespace): Promise<string[]> {
  const names: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await kv.list({ cursor });
    names.push(...page.keys.map((k) => k.name));
    if (page.list_complete) return names.sort();
    cursor = page.cursor;
  }
}

describe('deleteUserInsightsData', () => {
  const ALICE = [
    'lastfm:scrobbles:alice:2026-11-01',
    'lastfm:toplist:alice:6month',
    'insights:facts:alice',
    'insights:question:alice',
    'ai:userInsightsSummary:alice:abcd',
  ];
  const ALICE2 = ['lastfm:scrobbles:alice2:2026-11-01', 'insights:facts:alice2'];
  const GLOBAL = ['lastfm:tracklist:meltt:eternal%20embers', 'lastfm:toptags:meltt'];

  it('deletes every per-user key and nothing else', async () => {
    const kv = createMockKV();
    await seed(kv, [...ALICE, ...ALICE2, ...GLOBAL]);

    const deleted = await deleteUserInsightsData(kv, 'alice');

    expect(deleted).toBe(5);
    expect(await remaining(kv)).toEqual([...ALICE2, ...GLOBAL].sort());
  });

  it('deletes insights:card:<lower> by exact key', async () => {
    const kv = createMockKV();
    await seed(kv, ['insights:card:alice', 'insights:card:alice2']);

    const deleted = await deleteUserInsightsData(kv, 'Alice');

    expect(deleted).toBe(1);
    expect(await remaining(kv)).toEqual(['insights:card:alice2']);
    expect(kv.delete).toHaveBeenCalledWith('insights:card:alice');
  });

  it("never deletes a user whose name starts with this user's name", async () => {
    const kv = createMockKV();
    await seed(kv, [...ALICE, ...ALICE2]);

    await deleteUserInsightsData(kv, 'alice');

    expect(await kv.get('lastfm:scrobbles:alice2:2026-11-01')).not.toBeNull();
    expect(await kv.get('insights:facts:alice2')).not.toBeNull();
  });

  it('follows list cursors', async () => {
    const kv = createMockKV();
    // More than one 1000-key list page under a single prefix.
    const days = Array.from({ length: 2500 }, (_, i) => `lastfm:scrobbles:alice:d${String(i).padStart(4, '0')}`);
    await seed(kv, [...days, ...ALICE2]);

    const deleted = await deleteUserInsightsData(kv, 'alice');

    expect(deleted).toBe(2500);
    expect(await remaining(kv)).toEqual([...ALICE2].sort());
    const cursors = (kv.list as ReturnType<typeof vi.fn>).mock.calls
      .map(([options]) => (options as { cursor?: string } | undefined)?.cursor)
      .filter((cursor) => cursor !== undefined);
    expect(cursors.length).toBeGreaterThanOrEqual(2);
  });

  it('clears the existing per-user Last.fm cache under both the lower-cased and the stored-case name', async () => {
    const kv = createMockKV();
    const alice = [
      'lastfm:userInfo:alice',
      'lastfm:topartists:Alice:7day:5',
      'lastfm:topartists:alice:7day:5',
      'lastfm:topalbums:Alice:1month:10',
      'lastfm:topalbums:alice:1month:10',
      'lastfm:lovedtracks:Alice:10',
      'lastfm:lovedtracks:alice:10',
      'lastfm:userArtistDetail:alice:sigur rós',
      'lastfm:userArtistDetail:alice:low',
    ];
    const others = [
      'lastfm:userInfo:alice2',
      'lastfm:topartists:Alice2:7day:5',
      'lastfm:topalbums:alice2:1month:10',
      'lastfm:lovedtracks:ALICE2:10',
      'lastfm:userArtistDetail:alice2:sigur rós',
      'lastfm:userArtistDetail:malice:sigur rós',
      // The global artist entry, shared by every user.
      'lastfm:artistDetail:sigur rós',
    ];
    await seed(kv, [...alice, ...others]);

    const deleted = await deleteUserInsightsData(kv, 'Alice');

    expect(deleted).toBe(alice.length);
    expect(await remaining(kv)).toEqual([...others].sort());
  });

  it("keeps global artist detail keys whose artist name ends in this user's old per-user suffix", async () => {
    const kv = createMockKV();
    await seed(kv, [
      'lastfm:artistDetail:example:user:alice',
      'lastfm:userArtistDetail:alice:example',
      'lastfm:userArtistDetail:alice2:example',
    ]);

    const deleted = await deleteUserInsightsData(kv, 'alice');

    expect(deleted).toBe(1);
    expect(await kv.get('lastfm:artistDetail:example:user:alice')).not.toBeNull();
    expect(await kv.get('lastfm:userArtistDetail:alice:example')).toBeNull();
    expect(await kv.get('lastfm:userArtistDetail:alice2:example')).not.toBeNull();
    // No site-wide scan of the global artist detail family.
    const prefixes = (kv.list as ReturnType<typeof vi.fn>).mock.calls
      .map(([options]) => (options as { prefix?: string } | undefined)?.prefix);
    expect(prefixes).not.toContain('lastfm:artistDetail:');
  });
});
