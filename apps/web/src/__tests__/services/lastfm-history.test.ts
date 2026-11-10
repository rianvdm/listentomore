// ABOUTME: Tests for LastfmHistory, the uncached Last.fm client the insights pipeline reads history through.
// ABOUTME: Covers URL building, response shapes, error bodies, rate-limit backoff and the weekly chart's norm keys.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LastfmApiError, LastfmHistory, LastfmService } from '@listentomore/lastfm';
import type { LastfmHistoryClient } from '@listentomore/insights';
import { mockFetchResponse, setupFetchMock } from '../utils/mocks';

const config = { apiKey: 'test-api-key', username: 'testuser' };

const track = (artist: string, album: string, name: string, uts: number) => ({
  artist: { name: artist, url: '' },
  album: { '#text': album },
  name,
  date: { uts: String(uts), '#text': '' },
});

const recent = (tracks: unknown, totalPages = 1) => ({
  recenttracks: { track: tracks, '@attr': { user: 'testuser', page: '1', perPage: '200', totalPages: String(totalPages), total: '1' } },
});

const calledUrl = (mock: ReturnType<typeof vi.fn>, call = 0): string => String(mock.mock.calls[call][0]);

describe('LastfmHistory', () => {
  let client: LastfmHistory;

  beforeEach(() => {
    client = new LastfmHistory(config);
  });

  it('satisfies LastfmHistoryClient and hangs off LastfmService', () => {
    const typed: LastfmHistoryClient = new LastfmHistory(config);
    expect(typed).toBeInstanceOf(LastfmHistory);
    expect(new LastfmService(config).history).toBeInstanceOf(LastfmHistory);
  });

  describe('getRecentTracksPage', () => {
    it('requests a time range with extended=1 and limit=200', async () => {
      const mock = setupFetchMock([{ pattern: 'ws.audioscrobbler.com', response: recent([]) }]);

      await client.getRecentTracksPage(100, 200, 2);

      const url = calledUrl(mock);
      for (const part of ['method=user.getrecenttracks', 'user=testuser', 'from=100', 'to=200', 'limit=200', 'extended=1', 'page=2', 'format=json']) {
        expect(url).toContain(part);
      }
    });

    it('maps tracks to scrobbles in ascending time', async () => {
      setupFetchMock([{
        pattern: 'ws.audioscrobbler.com',
        response: recent([
          track('Sigur Rós', 'Takk...', 'Hoppípolla', 300),
          track('a-ha', 'Hunting High and Low', 'Take On Me', 100),
        ], 4),
      }]);

      const result = await client.getRecentTracksPage(0, 1000, 1);

      expect(result).toEqual({
        tracks: [
          { artist: 'a-ha', album: 'Hunting High and Low', track: 'Take On Me', ts: 100 },
          { artist: 'Sigur Rós', album: 'Takk...', track: 'Hoppípolla', ts: 300 },
        ],
        totalPages: 4,
      });
    });

    it('drops the now-playing row', async () => {
      const nowPlaying = { artist: { name: 'Low' }, album: { '#text': 'Things We Lost in the Fire' }, name: 'Sunflower', '@attr': { nowplaying: 'true' } };
      setupFetchMock([{ pattern: 'ws.audioscrobbler.com', response: recent([nowPlaying, track('Low', 'Secret Name', 'Weight of Water', 50)]) }]);

      const result = await client.getRecentTracksPage(0, 1000, 1);

      expect(result.tracks).toEqual([{ artist: 'Low', album: 'Secret Name', track: 'Weight of Water', ts: 50 }]);
    });

    it('wraps a single item as a list', async () => {
      setupFetchMock([{ pattern: 'ws.audioscrobbler.com', response: recent(track('Low', 'Secret Name', 'Weight of Water', 50)) }]);

      const result = await client.getRecentTracksPage(0, 1000, 1);

      expect(result.tracks).toEqual([{ artist: 'Low', album: 'Secret Name', track: 'Weight of Water', ts: 50 }]);
    });

    it('treats a 200 error body as failure', async () => {
      setupFetchMock([{ pattern: 'ws.audioscrobbler.com', response: { error: 6, message: 'User not found' } }]);

      const error = await client.getRecentTracksPage(0, 1000, 1).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(LastfmApiError);
      expect((error as LastfmApiError).code).toBe(6);
      expect((error as LastfmApiError).status).toBe(200);
    });

    it('rejects a non-ok response without an error body', async () => {
      setupFetchMock([{ pattern: 'ws.audioscrobbler.com', response: {}, options: { status: 503, ok: false } }]);

      const error = await client.getRecentTracksPage(0, 1000, 1).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(LastfmApiError);
      expect((error as LastfmApiError).code).toBeNull();
      expect((error as LastfmApiError).status).toBe(503);
    });

    it('never puts the API key or the request URL in an error message', async () => {
      setupFetchMock([{ pattern: 'ws.audioscrobbler.com', response: { error: 10, message: 'Invalid API key' }, options: { status: 403, ok: false } }]);

      const error = (await client.getRecentTracksPage(0, 1000, 1).catch((e: unknown) => e)) as Error;

      expect(error.message).not.toContain('test-api-key');
      expect(error.message).not.toContain('audioscrobbler');
    });
  });

  describe('rate limits', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('retries error 29 and HTTP 429 twice, then fails', async () => {
      const mock = vi.fn()
        .mockResolvedValueOnce(mockFetchResponse({}, { status: 429, ok: false }))
        .mockResolvedValueOnce(mockFetchResponse({ error: 29, message: 'Rate limit exceeded' }))
        .mockResolvedValueOnce(mockFetchResponse({}, { status: 429, ok: false }));
      globalThis.fetch = mock as typeof fetch;

      const result = client.getWeeklyChartList().catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(0);
      expect(mock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(999);
      expect(mock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(mock).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1999);
      expect(mock).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(mock).toHaveBeenCalledTimes(3);

      const error = await result;
      expect(mock).toHaveBeenCalledTimes(3);
      expect(error).toBeInstanceOf(LastfmApiError);
      expect((error as LastfmApiError).status).toBe(429);
    });

    it('returns the data when a retry succeeds', async () => {
      const mock = vi.fn()
        .mockResolvedValueOnce(mockFetchResponse({ error: 29, message: 'Rate limit exceeded' }))
        .mockResolvedValueOnce(mockFetchResponse({ weeklychartlist: { chart: [{ from: '1', to: '2' }] } }));
      globalThis.fetch = mock as typeof fetch;

      const result = client.getWeeklyChartList();
      await vi.advanceTimersByTimeAsync(1000);

      await expect(result).resolves.toEqual([{ from: 1, to: 2 }]);
      expect(mock).toHaveBeenCalledTimes(2);
    });

    it('does not retry other errors', async () => {
      const mock = setupFetchMock([{ pattern: 'ws.audioscrobbler.com', response: { error: 8, message: 'Operation failed' } }]);

      const error = await client.getWeeklyChartList().catch((e: unknown) => e);

      expect((error as LastfmApiError).code).toBe(8);
      expect(mock).toHaveBeenCalledTimes(1);
    });
  });

  describe('weekly charts', () => {
    it('weekly chart list returns from/to numbers', async () => {
      const mock = setupFetchMock([{
        pattern: 'ws.audioscrobbler.com',
        response: { weeklychartlist: { chart: [{ '#text': '', from: '1108296000', to: '1108900800' }, { '#text': '', from: '1108900800', to: '1109505600' }] } },
      }]);

      const result = await client.getWeeklyChartList();

      expect(result).toEqual([{ from: 1108296000, to: 1108900800 }, { from: 1108900800, to: 1109505600 }]);
      expect(calledUrl(mock)).toContain('method=user.getweeklychartlist');
    });

    it('weekly artist chart keys by normalised name and sums duplicate entities', async () => {
      const mock = setupFetchMock([{
        pattern: 'ws.audioscrobbler.com',
        response: {
          weeklyartistchart: {
            artist: [
              { name: '  A‐HA  ', playcount: '3' },
              { name: 'a-ha', playcount: '2' },
              { name: 'Sigur  Rós', playcount: '7' },
            ],
          },
        },
      }]);

      const result = await client.getWeeklyArtistChart(100, 200);

      expect(result).toEqual({ 'a-ha': 5, 'sigur rós': 7 });
      const url = calledUrl(mock);
      for (const part of ['method=user.getweeklyartistchart', 'from=100', 'to=200', 'limit=1000']) {
        expect(url).toContain(part);
      }
    });

    it('weekly artist chart is empty for a week with no plays', async () => {
      setupFetchMock([{ pattern: 'ws.audioscrobbler.com', response: { weeklyartistchart: { artist: [], '@attr': {} } } }]);

      await expect(client.getWeeklyArtistChart(100, 200)).resolves.toEqual({});
    });
  });

  describe('getTopArtistsPage', () => {
    it('top artists page returns totalPages and 1-based ranks', async () => {
      const mock = setupFetchMock([{
        pattern: 'ws.audioscrobbler.com',
        response: {
          topartists: {
            artist: [
              { name: 'Low', playcount: '900', '@attr': { rank: '1001' } },
              { name: 'Sigur Rós', playcount: '800', '@attr': { rank: '1002' } },
            ],
            '@attr': { page: '2', perPage: '1000', totalPages: '3', total: '2002' },
          },
        },
      }]);

      const result = await client.getTopArtistsPage('6month', 2);

      expect(result).toEqual({
        artists: [
          { name: 'Low', playcount: 900, rank: 1001 },
          { name: 'Sigur Rós', playcount: 800, rank: 1002 },
        ],
        totalPages: 3,
      });
      const url = calledUrl(mock);
      for (const part of ['method=user.gettopartists', 'period=6month', 'limit=1000', 'page=2']) {
        expect(url).toContain(part);
      }
    });

    it('falls back to position when Last.fm omits a rank', async () => {
      setupFetchMock([{
        pattern: 'ws.audioscrobbler.com',
        response: { topartists: { artist: { name: 'Low', playcount: '5' }, '@attr': { totalPages: '1' } } },
      }]);

      const result = await client.getTopArtistsPage('overall', 1);

      expect(result).toEqual({ artists: [{ name: 'Low', playcount: 5, rank: 1 }], totalPages: 1 });
    });
  });

  describe('getUserArtistPlaycount', () => {
    it('reads stats.userplaycount for the user', async () => {
      const mock = setupFetchMock([{ pattern: 'ws.audioscrobbler.com', response: { artist: { name: 'Low', stats: { listeners: '1', playcount: '2', userplaycount: '412' } } } }]);

      await expect(client.getUserArtistPlaycount('Low')).resolves.toBe(412);
      const url = calledUrl(mock);
      for (const part of ['method=artist.getinfo', 'artist=Low', 'username=testuser', 'autocorrect=0']) {
        expect(url).toContain(part);
      }
    });

    it('user artist playcount is null when stats are missing', async () => {
      setupFetchMock([{ pattern: 'ws.audioscrobbler.com', response: { artist: { name: 'Low', stats: { listeners: '1', playcount: '2' } } } }]);

      await expect(client.getUserArtistPlaycount('Low')).resolves.toBeNull();
    });

    it('user artist playcount is null for an unknown artist', async () => {
      setupFetchMock([{ pattern: 'ws.audioscrobbler.com', response: { error: 6, message: 'The artist you supplied could not be found' }, options: { status: 400, ok: false } }]);

      await expect(client.getUserArtistPlaycount('Nobody At All')).resolves.toBeNull();
    });

    it('encodes artist names in the query string', async () => {
      const mock = setupFetchMock([{ pattern: 'ws.audioscrobbler.com', response: { artist: { stats: { userplaycount: '1' } } } }]);

      await client.getUserArtistPlaycount('Simon & Garfunkel');

      expect(calledUrl(mock)).toContain('artist=Simon+%26+Garfunkel');
    });
  });

  describe('getAlbumInfo', () => {
    it('album info returns a tracklist and a user playcount, null tracklist when Last.fm has none', async () => {
      const mock = setupFetchMock([{
        pattern: 'album=Takk',
        response: {
          album: {
            name: 'Takk...',
            userplaycount: 37,
            tracks: { track: [{ name: 'Takk...', '@attr': { rank: 1 } }, { name: 'Glósóli', '@attr': { rank: 2 } }] },
          },
        },
      }, {
        pattern: 'album=Untitled',
        response: { album: { name: 'Untitled', userplaycount: '0' } },
      }]);

      await expect(client.getAlbumInfo('Sigur Rós', 'Takk...')).resolves.toEqual({ tracklist: ['Takk...', 'Glósóli'], userPlaycount: 37 });
      await expect(client.getAlbumInfo('Sigur Rós', 'Untitled')).resolves.toEqual({ tracklist: null, userPlaycount: 0 });
      const url = calledUrl(mock);
      for (const part of ['method=album.getinfo', 'username=testuser', 'autocorrect=0']) {
        expect(url).toContain(part);
      }
    });

    it('wraps a single-track album as a list', async () => {
      setupFetchMock([{ pattern: 'ws.audioscrobbler.com', response: { album: { tracks: { track: { name: 'Dopesmoker' } } } } }]);

      await expect(client.getAlbumInfo('Sleep', 'Dopesmoker')).resolves.toEqual({ tracklist: ['Dopesmoker'], userPlaycount: null });
    });

    it('album info for an unknown album returns nulls, not an error', async () => {
      setupFetchMock([{ pattern: 'ws.audioscrobbler.com', response: { error: 6, message: 'Album not found' }, options: { status: 400, ok: false } }]);

      await expect(client.getAlbumInfo('Low', 'Not An Album')).resolves.toEqual({ tracklist: null, userPlaycount: null });
    });
  });

  describe('getArtistTopTags', () => {
    it('artist top tags returns names in order', async () => {
      const mock = setupFetchMock([{
        pattern: 'ws.audioscrobbler.com',
        response: { toptags: { tag: [{ name: 'slowcore', count: 100 }, { name: 'Indie', count: 80 }, { name: 'seen live', count: 20 }] } },
      }]);

      await expect(client.getArtistTopTags('Low')).resolves.toEqual(['slowcore', 'Indie', 'seen live']);
      const url = calledUrl(mock);
      for (const part of ['method=artist.gettoptags', 'artist=Low', 'autocorrect=0']) {
        expect(url).toContain(part);
      }
    });

    it('returns no tags for an unknown artist', async () => {
      setupFetchMock([{ pattern: 'ws.audioscrobbler.com', response: { error: 6, message: 'The artist you supplied could not be found' }, options: { status: 400, ok: false } }]);

      await expect(client.getArtistTopTags('Nobody At All')).resolves.toEqual([]);
    });
  });

  // A 200 body without its root key would otherwise parse as an empty day or chart week, and the
  // insights collector caches completed days and chart weeks for 40 days.
  describe('a 200 body without its root key', () => {
    const expectMissingRoot = async (request: Promise<unknown>): Promise<void> => {
      const error = await request.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(LastfmApiError);
      expect((error as LastfmApiError).code).toBeNull();
      expect((error as LastfmApiError).status).toBe(200);
    };

    beforeEach(() => {
      setupFetchMock([{ pattern: 'ws.audioscrobbler.com', response: { unexpected: {} } }]);
    });

    it('fails getRecentTracksPage instead of returning no scrobbles', async () => {
      await expectMissingRoot(client.getRecentTracksPage(0, 1000, 1));
    });

    it('fails getWeeklyChartList instead of returning no weeks', async () => {
      await expectMissingRoot(client.getWeeklyChartList());
    });

    it('fails getWeeklyArtistChart instead of returning an empty week', async () => {
      await expectMissingRoot(client.getWeeklyArtistChart(100, 200));
    });

    it('fails getTopArtistsPage instead of returning an empty list', async () => {
      await expectMissingRoot(client.getTopArtistsPage('3month', 1));
    });

    // Tracklists and tags are cached globally for 30 days, so an empty misread would reach every user.
    it('fails getAlbumInfo instead of returning no tracklist', async () => {
      await expectMissingRoot(client.getAlbumInfo('Low', 'Secret Name'));
    });

    it('fails getArtistTopTags instead of returning no tags', async () => {
      await expectMissingRoot(client.getArtistTopTags('Low'));
    });
  });

  it('norm matches the insights examples so the two copies cannot drift', async () => {
    // Same examples as norm's test in packages/services/insights/__tests__/window.test.ts.
    setupFetchMock([{
      pattern: 'ws.audioscrobbler.com',
      response: { weeklyartistchart: { artist: [{ name: '  A‐HA  ', playcount: '1' }, { name: 'Sigur  Rós', playcount: '1' }] } },
    }]);

    const keys = Object.keys(await client.getWeeklyArtistChart(0, 1));

    expect(keys).toEqual(['a-ha', 'sigur rós']);
  });
});
