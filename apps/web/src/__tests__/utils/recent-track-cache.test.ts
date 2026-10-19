// ABOUTME: Tests for the per-user recent track cache used by the cron and /widget/recent.
// ABOUTME: Covers the Last.fm-failure fallback: saved track returned with nowPlaying cleared.

import { describe, it, expect, vi } from 'vitest';
import { createMockKV } from './mocks';
import { loadCachedRecentTrack, recentTrackKey } from '../../utils/recent-track-cache';
import type { RecentTrackData } from '../../utils/recent-track-cache';

const savedTrack: RecentTrackData = {
  username: 'rian',
  artist: 'Radiohead',
  album: 'In Rainbows',
  track: 'Reckoner',
  image: 'https://example.com/cover.jpg',
  playedAt: '2026-10-19T20:00:00.000Z',
  nowPlaying: true,
};

describe('loadCachedRecentTrack', () => {
  it('returns the last saved track with nowPlaying cleared', async () => {
    const kv = createMockKV();
    await kv.put(recentTrackKey('bordesak'), JSON.stringify(savedTrack));

    const result = await loadCachedRecentTrack(kv, 'bordesak');

    expect(result).toEqual({ ...savedTrack, nowPlaying: false });
  });

  it('returns null when no track has been saved for the user', async () => {
    const kv = createMockKV();

    const result = await loadCachedRecentTrack(kv, 'bordesak');

    expect(result).toBeNull();
  });

  it('returns null when the KV read fails', async () => {
    const kv = createMockKV();
    vi.mocked(kv.get).mockRejectedValueOnce(new Error('KV unavailable'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await loadCachedRecentTrack(kv, 'bordesak');

    expect(result).toBeNull();
    errorSpy.mockRestore();
  });
});
