// SonglinkService integration tests

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SonglinkService } from '@listentomore/songlink';
import { createMockKV, setupFetchMock } from '../utils/mocks';

describe('SonglinkService', () => {
  let mockKV: KVNamespace;
  let songlink: SonglinkService;

  beforeEach(() => {
    mockKV = createMockKV();
    songlink = new SonglinkService(mockKV);
  });

  describe('getLinks', () => {
    it('fetches streaming links from Songlink API and caches', async () => {
      const response = {
        entityUniqueId: 'SPOTIFY_SONG::abc123',
        pageUrl: 'https://song.link/s/abc123',
        entitiesByUniqueId: {
          'SPOTIFY_SONG::abc123': {
            artistName: 'Radiohead',
            title: 'Reckoner',
            thumbnailUrl: 'https://example.com/thumb.jpg',
            type: 'song',
          },
        },
        linksByPlatform: {
          spotify: { url: 'https://open.spotify.com/track/abc123' },
          appleMusic: { url: 'https://music.apple.com/track/123' },
          youtube: { url: 'https://youtube.com/watch?v=xyz' },
          youtubeMusic: { url: 'https://music.youtube.com/watch?v=xyz' },
          deezer: { url: 'https://deezer.com/track/456' },
          tidal: { url: 'https://tidal.com/track/789' },
        },
      };
      setupFetchMock([{ pattern: /api\.song\.link/, response }]);

      const result = await songlink.getLinks('https://open.spotify.com/track/abc123');

      expect(result).toEqual({
        pageUrl: 'https://song.link/s/abc123',
        appleUrl: 'https://music.apple.com/track/123',
        youtubeUrl: 'https://youtube.com/watch?v=xyz', // Prefers youtube over youtubeMusic
        deezerUrl: 'https://deezer.com/track/456',
        spotifyUrl: 'https://open.spotify.com/track/abc123',
        tidalUrl: 'https://tidal.com/track/789',
        artistName: 'Radiohead',
        title: 'Reckoner',
        thumbnailUrl: 'https://example.com/thumb.jpg',
        type: 'song',
      });

      expect(mockKV.put).toHaveBeenCalledWith(
        'songlink:https://open.spotify.com/track/abc123',
        expect.any(String),
        expect.objectContaining({ expirationTtl: expect.any(Number) })
      );
    });

    it('returns cached results', async () => {
      const cachedLinks = {
        pageUrl: 'https://song.link/cached',
        artistName: 'Cached Artist',
      };
      (mockKV.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(cachedLinks);

      const result = await songlink.getLinks('https://open.spotify.com/track/abc123');

      expect(result.pageUrl).toBe('https://song.link/cached');
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('falls back to youtube when youtubeMusic not available', async () => {
      const response = {
        entityUniqueId: 'test',
        pageUrl: 'https://song.link/test',
        entitiesByUniqueId: { test: {} },
        linksByPlatform: {
          youtube: { url: 'https://youtube.com/watch?v=abc' },
        },
      };
      setupFetchMock([{ pattern: /api\.song\.link/, response }]);

      const result = await songlink.getLinks('https://spotify.com/track/test');

      expect(result.youtubeUrl).toBe('https://youtube.com/watch?v=abc');
    });

    it('returns partial data on rate limit (429)', async () => {
      setupFetchMock([
        {
          pattern: /api\.song\.link/,
          response: { error: 'Rate limited' },
          options: { status: 429, ok: false },
        },
      ]);

      const result = await songlink.getLinks('https://open.spotify.com/track/abc123');

      expect(result).toEqual({
        pageUrl: '',
        appleUrl: null,
        youtubeUrl: null,
        deezerUrl: null,
        spotifyUrl: 'https://open.spotify.com/track/abc123',
        tidalUrl: null,
        artistName: 'Unknown Artist',
        title: 'Unknown Title',
        thumbnailUrl: null,
        type: 'unknown',
      });
    });

    it('returns partial data on server error (5xx)', async () => {
      setupFetchMock([
        {
          pattern: /api\.song\.link/,
          response: { error: 'Server error' },
          options: { status: 500, ok: false },
        },
      ]);

      const result = await songlink.getLinks('https://open.spotify.com/track/test');

      expect(result.artistName).toBe('Unknown Artist');
      expect(result.spotifyUrl).toBe('https://open.spotify.com/track/test');
    });

    it('throws error on client error (4xx except 429)', async () => {
      setupFetchMock([
        {
          pattern: /api\.song\.link/,
          response: { error: 'Bad request' },
          options: { status: 400, ok: false },
        },
      ]);

      await expect(songlink.getLinks('invalid-url')).rejects.toThrow('Songlink API error: 400');
    });

    it('handles missing entity data gracefully', async () => {
      const response = {
        entityUniqueId: 'test',
        pageUrl: 'https://song.link/test',
        entitiesByUniqueId: {},
        linksByPlatform: {},
      };
      setupFetchMock([{ pattern: /api\.song\.link/, response }]);

      const result = await songlink.getLinks('https://spotify.com/track/test');

      expect(result.artistName).toBe('Unknown Artist');
      expect(result.title).toBe('Unknown Title');
      expect(result.type).toBe('unknown');
    });
  });

  describe('getLinksFromSpotify', () => {
    it('accepts spotify.com URLs', async () => {
      setupFetchMock([
        {
          pattern: /api\.song\.link/,
          response: { entityUniqueId: 'test', pageUrl: 'url', entitiesByUniqueId: {} },
        },
      ]);

      await expect(songlink.getLinksFromSpotify('https://open.spotify.com/track/abc')).resolves.toBeDefined();
    });

    it('accepts spotify: URIs', async () => {
      setupFetchMock([
        {
          pattern: /api\.song\.link/,
          response: { entityUniqueId: 'test', pageUrl: 'url', entitiesByUniqueId: {} },
        },
      ]);

      await expect(songlink.getLinksFromSpotify('spotify:track:abc123')).resolves.toBeDefined();
    });

    it('throws error for non-Spotify URLs', async () => {
      await expect(songlink.getLinksFromSpotify('https://youtube.com/watch?v=abc')).rejects.toThrow('Invalid Spotify URL');
    });
  });
});
