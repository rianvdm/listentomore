// LastfmService integration tests

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecentTracks, TopAlbums, TopArtists, LovedTracks } from '@listentomore/lastfm';
import { createMockKV, setupFetchMock } from '../utils/mocks';

const mockConfig = { apiKey: 'test-api-key', username: 'testuser' };

describe('RecentTracks', () => {
  let recentTracks: RecentTracks;

  beforeEach(() => {
    recentTracks = new RecentTracks(mockConfig);
  });

  describe('getRecentTracks', () => {
    it('fetches recent tracks from Last.fm API', async () => {
      const response = {
        recenttracks: {
          track: [
            {
              name: 'Reckoner',
              artist: { '#text': 'Radiohead' },
              album: { '#text': 'In Rainbows' },
              url: 'https://www.last.fm/music/Radiohead/_/Reckoner',
              image: [
                { '#text': '', size: 'small' },
                { '#text': '', size: 'medium' },
                { '#text': '', size: 'large' },
                { '#text': 'https://lastfm.freetls.fastly.net/i/u/300x300/album.png', size: 'extralarge' },
              ],
              date: { uts: '1700000000' },
            },
          ],
        },
      };
      setupFetchMock([{ pattern: /ws\.audioscrobbler\.com/, response }]);

      const result = await recentTracks.getRecentTracks(10);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        artist: 'Radiohead',
        album: 'In Rainbows',
        name: 'Reckoner',
        url: 'https://www.last.fm/music/Radiohead/_/Reckoner',
        image: 'https://lastfm.freetls.fastly.net/i/u/300x300/album.png',
        nowPlaying: false,
        playedAt: expect.any(String),
      });
    });

    it('handles now playing track', async () => {
      const response = {
        recenttracks: {
          track: [
            {
              name: 'Reckoner',
              artist: { '#text': 'Radiohead' },
              album: { '#text': 'In Rainbows' },
              url: 'https://www.last.fm/music/Radiohead/_/Reckoner',
              image: [],
              '@attr': { nowplaying: 'true' },
            },
          ],
        },
      };
      setupFetchMock([{ pattern: /ws\.audioscrobbler\.com/, response }]);

      const result = await recentTracks.getRecentTracks(1);

      expect(result[0].nowPlaying).toBe(true);
      expect(result[0].playedAt).toBeNull();
    });

    it('throws error on API failure', async () => {
      setupFetchMock([{ pattern: /ws\.audioscrobbler\.com/, response: { error: 'Failed' }, options: { status: 500, ok: false } }]);

      await expect(recentTracks.getRecentTracks()).rejects.toThrow('Last.fm API responded with status 500');
    });
  });

  describe('getMostRecentTrack', () => {
    it('returns the first track', async () => {
      const response = {
        recenttracks: {
          track: [
            { name: 'Track 1', artist: { '#text': 'Artist' }, album: { '#text': 'Album' }, url: 'url', image: [] },
            { name: 'Track 2', artist: { '#text': 'Artist' }, album: { '#text': 'Album' }, url: 'url', image: [] },
          ],
        },
      };
      setupFetchMock([{ pattern: /ws\.audioscrobbler\.com/, response }]);

      const result = await recentTracks.getMostRecentTrack();

      expect(result?.name).toBe('Track 1');
    });

    it('returns null when no tracks', async () => {
      setupFetchMock([{ pattern: /ws\.audioscrobbler\.com/, response: { recenttracks: { track: [] } } }]);

      const result = await recentTracks.getMostRecentTrack();

      expect(result).toBeNull();
    });
  });

  describe('getCurrentlyPlaying', () => {
    it('returns track if now playing', async () => {
      const response = {
        recenttracks: {
          track: [{ name: 'Now Playing', artist: { '#text': 'Artist' }, album: { '#text': 'Album' }, url: 'url', image: [], '@attr': { nowplaying: 'true' } }],
        },
      };
      setupFetchMock([{ pattern: /ws\.audioscrobbler\.com/, response }]);

      const result = await recentTracks.getCurrentlyPlaying();

      expect(result?.name).toBe('Now Playing');
      expect(result?.nowPlaying).toBe(true);
    });

    it('returns null if not playing', async () => {
      const response = {
        recenttracks: {
          track: [{ name: 'Last Played', artist: { '#text': 'Artist' }, album: { '#text': 'Album' }, url: 'url', image: [], date: { uts: '1700000000' } }],
        },
      };
      setupFetchMock([{ pattern: /ws\.audioscrobbler\.com/, response }]);

      const result = await recentTracks.getCurrentlyPlaying();

      expect(result).toBeNull();
    });
  });
});

describe('TopAlbums', () => {
  let mockKV: KVNamespace;
  let topAlbums: TopAlbums;

  beforeEach(() => {
    mockKV = createMockKV();
    topAlbums = new TopAlbums(mockConfig, mockKV);
  });

  describe('getTopAlbums', () => {
    it('fetches top albums from Last.fm API and caches', async () => {
      const response = {
        topalbums: {
          album: [
            {
              artist: { name: 'Radiohead', url: 'https://www.last.fm/music/Radiohead' },
              name: 'In Rainbows',
              playcount: '150',
              url: 'https://www.last.fm/music/Radiohead/In+Rainbows',
              image: [{ '#text': 'https://lastfm.freetls.fastly.net/i/u/300x300/album.png', size: 'extralarge' }],
            },
          ],
        },
      };
      setupFetchMock([{ pattern: /ws\.audioscrobbler\.com.*gettopalbums/, response }]);

      const result = await topAlbums.getTopAlbums('1month', 6);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        artist: 'Radiohead',
        artistUrl: 'https://www.last.fm/music/Radiohead',
        name: 'In Rainbows',
        playcount: 150,
        albumUrl: 'https://www.last.fm/music/Radiohead/In+Rainbows',
        image: 'https://lastfm.freetls.fastly.net/i/u/300x300/album.png',
      });

      expect(mockKV.put).toHaveBeenCalledWith('lastfm:topalbums:testuser:1month:6', expect.any(String), expect.objectContaining({ expirationTtl: expect.any(Number) }));
    });

    it('returns cached results', async () => {
      const cachedAlbums = [{ artist: 'Cached', name: 'Album' }];
      (mockKV.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(cachedAlbums);

      const result = await topAlbums.getTopAlbums();

      expect(result).toEqual(cachedAlbums);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('uses backup image when no image available', async () => {
      const response = {
        topalbums: {
          album: [
            {
              artist: { name: 'Artist', url: 'url' },
              name: 'Album',
              playcount: '100',
              url: 'url',
              image: [],
            },
          ],
        },
      };
      setupFetchMock([{ pattern: /ws\.audioscrobbler\.com/, response }]);

      const result = await topAlbums.getTopAlbums();

      expect(result[0].image).toBe('https://file.elezea.com/noun-no-image.png');
    });
  });
});

describe('TopArtists', () => {
  let mockKV: KVNamespace;
  let topArtists: TopArtists;

  beforeEach(() => {
    mockKV = createMockKV();
    topArtists = new TopArtists(mockConfig, mockKV);
  });

  describe('getTopArtists', () => {
    it('fetches top artists without details', async () => {
      const response = {
        topartists: {
          artist: [
            {
              name: 'Radiohead',
              playcount: '500',
              url: 'https://www.last.fm/music/Radiohead',
            },
          ],
        },
      };
      setupFetchMock([{ pattern: /ws\.audioscrobbler\.com/, response }]);

      // includeDetails=false to avoid artist.getinfo calls
      const result = await topArtists.getTopArtists('7day', 6, false);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        name: 'Radiohead',
        playcount: 500,
        url: 'https://www.last.fm/music/Radiohead',
        tags: [],
        bio: '',
      });
    });

    it('fetches top artists with details', async () => {
      const mockFetch = vi.fn();
      globalThis.fetch = mockFetch;

      // First call: gettopartists
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            topartists: {
              artist: [{ name: 'Radiohead', playcount: '500', url: 'https://www.last.fm/music/Radiohead' }],
            },
          }),
      });

      // Second call: artist.getinfo
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            artist: {
              name: 'Radiohead',
              url: 'https://www.last.fm/music/Radiohead',
              image: [{ '#text': 'https://lastfm.freetls.fastly.net/i/u/300x300/artist.png', size: 'extralarge' }],
              tags: { tag: [{ name: 'alternative rock' }, { name: 'seen live' }] },
              bio: { summary: 'A band from Oxford' },
            },
          }),
      });

      const result = await topArtists.getTopArtists('7day', 1, true);

      expect(result[0]).toMatchObject({
        name: 'Radiohead',
        playcount: 500,
        image: 'https://lastfm.freetls.fastly.net/i/u/300x300/artist.png',
        tags: ['Alternative rock'], // 'seen live' should be filtered out
        bio: 'A band from Oxford',
      });
    });
  });
});

describe('LovedTracks', () => {
  let lovedTracks: LovedTracks;

  beforeEach(() => {
    lovedTracks = new LovedTracks(mockConfig);
  });

  describe('getLovedTracks', () => {
    it('fetches loved tracks from Last.fm API', async () => {
      const response = {
        lovedtracks: {
          track: [
            {
              name: 'Reckoner',
              artist: { name: 'Radiohead' },
              url: 'https://www.last.fm/music/Radiohead/_/Reckoner',
              image: [{ '#text': 'https://lastfm.freetls.fastly.net/i/u/300x300/track.png', size: 'extralarge' }],
              date: { uts: '1700000000' },
            },
          ],
        },
      };
      setupFetchMock([{ pattern: /ws\.audioscrobbler\.com.*getlovedtracks/, response }]);

      const result = await lovedTracks.getLovedTracks(10);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        title: 'Reckoner',
        artist: 'Radiohead',
        songUrl: 'https://www.last.fm/music/Radiohead/_/Reckoner',
        image: 'https://lastfm.freetls.fastly.net/i/u/300x300/track.png',
      });
    });

    it('handles missing date', async () => {
      const response = {
        lovedtracks: {
          track: [
            {
              name: 'Track',
              artist: { name: 'Artist' },
              url: 'https://example.com',
              image: [],
            },
          ],
        },
      };
      setupFetchMock([{ pattern: /ws\.audioscrobbler\.com/, response }]);

      const result = await lovedTracks.getLovedTracks(10);

      expect(result[0].dateLiked).toBe('');
      expect(result[0].image).toBeNull();
    });
  });
});
