// SpotifyService integration tests

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpotifyAlbums, SpotifyArtists, SpotifySearch } from '@listentomore/spotify';
import { createMockKV, setupFetchMock, createMockSpotifyAuth } from '../utils/mocks';
import { spotifyFixtures } from '../utils/fixtures';

describe('SpotifyAlbums', () => {
  let mockKV: KVNamespace;
  let mockAuth: ReturnType<typeof createMockSpotifyAuth>;
  let albums: SpotifyAlbums;

  beforeEach(() => {
    mockKV = createMockKV();
    mockAuth = createMockSpotifyAuth();
    albums = new SpotifyAlbums(mockAuth as any, mockKV);
  });

  describe('getAlbum', () => {
    it('fetches album from Spotify API and caches result', async () => {
      setupFetchMock([{ pattern: /api\.spotify\.com\/v1\/albums\//, response: spotifyFixtures.album }]);

      const result = await albums.getAlbum('4LH4d3cOWNNsVw41Gqt2kv');

      expect(result).toEqual({
        id: '4LH4d3cOWNNsVw41Gqt2kv',
        name: 'In Rainbows',
        artist: 'Radiohead',
        artistIds: ['4Z8W4fKeB5YxbusRsdQVPb'],
        releaseDate: '2007-10-10',
        tracks: 10,
        genres: ['alternative rock', 'art rock'],
        url: 'https://open.spotify.com/album/4LH4d3cOWNNsVw41Gqt2kv',
        image: 'https://i.scdn.co/image/ab67616d0000b273abc123',
        label: 'XL Recordings',
        popularity: 82,
        copyrights: ['2007 XL Recordings Ltd'],
        trackList: [
          { number: 1, name: '15 Step', duration: 237000, preview: null, artists: ['Radiohead'] },
          { number: 2, name: 'Bodysnatchers', duration: 242000, preview: null, artists: ['Radiohead'] },
        ],
      });

      // Verify cache was written
      expect(mockKV.put).toHaveBeenCalledWith('spotify:album:4LH4d3cOWNNsVw41Gqt2kv', expect.any(String), expect.objectContaining({ expirationTtl: expect.any(Number) }));
    });

    it('returns cached album without API call', async () => {
      const cachedAlbum = {
        id: '4LH4d3cOWNNsVw41Gqt2kv',
        name: 'In Rainbows (cached)',
        artist: 'Radiohead',
        artistIds: ['4Z8W4fKeB5YxbusRsdQVPb'],
      };

      // Pre-populate cache
      (mockKV.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(cachedAlbum);

      const result = await albums.getAlbum('4LH4d3cOWNNsVw41Gqt2kv');

      expect(result.name).toBe('In Rainbows (cached)');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('throws error for non-existent album', async () => {
      setupFetchMock([{ pattern: /api\.spotify\.com\/v1\/albums\//, response: { error: 'Not found' }, options: { status: 404, ok: false } }]);

      await expect(albums.getAlbum('nonexistent')).rejects.toThrow('Album not found: nonexistent');
    });

    it('throws error on API failure', async () => {
      setupFetchMock([{ pattern: /api\.spotify\.com\/v1\/albums\//, response: { error: 'Server error' }, options: { status: 500, ok: false } }]);

      await expect(albums.getAlbum('test')).rejects.toThrow('Failed to fetch album: 500');
    });
  });

  describe('getAlbums', () => {
    it('fetches multiple albums in parallel', async () => {
      setupFetchMock([{ pattern: /api\.spotify\.com\/v1\/albums\//, response: spotifyFixtures.album }]);

      const results = await albums.getAlbums(['id1', 'id2']);

      expect(results).toHaveLength(2);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });
});

describe('SpotifyArtists', () => {
  let mockKV: KVNamespace;
  let mockAuth: ReturnType<typeof createMockSpotifyAuth>;
  let artists: SpotifyArtists;

  beforeEach(() => {
    mockKV = createMockKV();
    mockAuth = createMockSpotifyAuth();
    artists = new SpotifyArtists(mockAuth as any, mockKV);
  });

  describe('getArtist', () => {
    it('fetches artist from Spotify API and caches result', async () => {
      setupFetchMock([{ pattern: /api\.spotify\.com\/v1\/artists\/[^/]+$/, response: spotifyFixtures.artist }]);

      const result = await artists.getArtist('4Z8W4fKeB5YxbusRsdQVPb');

      expect(result).toEqual({
        id: '4Z8W4fKeB5YxbusRsdQVPb',
        name: 'Radiohead',
        genres: ['Alternative Rock', 'Art Rock', 'Permanent Wave'], // Note: capitalized
        followers: 8500000,
        popularity: 82,
        url: 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb',
        image: 'https://i.scdn.co/image/ab67616d0000b273artist123',
      });

      expect(mockKV.put).toHaveBeenCalledWith('spotify:artist:4Z8W4fKeB5YxbusRsdQVPb', expect.any(String), expect.objectContaining({ expirationTtl: expect.any(Number) }));
    });

    it('returns cached artist without API call', async () => {
      const cachedArtist = { id: '4Z8W4fKeB5YxbusRsdQVPb', name: 'Radiohead (cached)' };
      (mockKV.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(cachedArtist);

      const result = await artists.getArtist('4Z8W4fKeB5YxbusRsdQVPb');

      expect(result.name).toBe('Radiohead (cached)');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('throws error for non-existent artist', async () => {
      setupFetchMock([{ pattern: /api\.spotify\.com\/v1\/artists\//, response: { error: 'Not found' }, options: { status: 404, ok: false } }]);

      await expect(artists.getArtist('nonexistent')).rejects.toThrow('Artist not found: nonexistent');
    });
  });

  describe('getArtistAlbums', () => {
    it('fetches artist albums from Spotify API', async () => {
      setupFetchMock([{ pattern: /api\.spotify\.com\/v1\/artists\/.*\/albums/, response: spotifyFixtures.artistAlbums }]);

      const result = await artists.getArtistAlbums('4Z8W4fKeB5YxbusRsdQVPb', 10);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('In Rainbows');
      expect(result[1].name).toBe('OK Computer');
    });
  });

  describe('getRelatedArtists', () => {
    it('fetches related artists from Spotify API', async () => {
      setupFetchMock([{ pattern: /api\.spotify\.com\/v1\/artists\/.*\/related-artists/, response: spotifyFixtures.relatedArtists }]);

      const result = await artists.getRelatedArtists('4Z8W4fKeB5YxbusRsdQVPb', 5);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Gorillaz');
    });

    it('respects limit parameter', async () => {
      const manyArtists = {
        artists: Array.from({ length: 10 }, (_, i) => ({
          id: `artist-${i}`,
          name: `Artist ${i}`,
          images: [{ url: `https://example.com/${i}.jpg` }],
        })),
      };
      setupFetchMock([{ pattern: /api\.spotify\.com\/v1\/artists\/.*\/related-artists/, response: manyArtists }]);

      const result = await artists.getRelatedArtists('test', 3);

      expect(result).toHaveLength(3);
    });
  });
});

describe('SpotifySearch', () => {
  let mockKV: KVNamespace;
  let mockAuth: ReturnType<typeof createMockSpotifyAuth>;
  let search: SpotifySearch;

  beforeEach(() => {
    mockKV = createMockKV();
    mockAuth = createMockSpotifyAuth();
    search = new SpotifySearch(mockAuth as any, mockKV);
  });

  describe('searchAlbum', () => {
    it('searches for albums and returns first result', async () => {
      setupFetchMock([{ pattern: /api\.spotify\.com\/v1\/search.*type=album/, response: spotifyFixtures.searchAlbums }]);

      const result = await search.searchAlbum('in rainbows radiohead');

      expect(result).toEqual({
        name: 'In Rainbows',
        id: '4LH4d3cOWNNsVw41Gqt2kv',
        artist: 'Radiohead',
        artistIds: ['4Z8W4fKeB5YxbusRsdQVPb'],
        releaseDate: '2007-10-10',
        tracks: 10,
        url: 'https://open.spotify.com/album/4LH4d3cOWNNsVw41Gqt2kv',
        image: 'https://i.scdn.co/image/ab67616d0000b273abc123',
      });
    });

    it('returns null when no results found', async () => {
      setupFetchMock([{ pattern: /api\.spotify\.com\/v1\/search/, response: { albums: { items: [] } } }]);

      const result = await search.searchAlbum('nonexistent album xyz');

      expect(result).toBeNull();
    });

    it('caches search results', async () => {
      setupFetchMock([{ pattern: /api\.spotify\.com\/v1\/search/, response: spotifyFixtures.searchAlbums }]);

      await search.searchAlbum('test query');

      expect(mockKV.put).toHaveBeenCalledWith('spotify:search:album:test query', expect.any(String), expect.objectContaining({ expirationTtl: expect.any(Number) }));
    });
  });

  describe('searchArtist', () => {
    it('searches for artists and returns first result', async () => {
      const artistSearchResponse = {
        artists: {
          items: [
            {
              id: '4Z8W4fKeB5YxbusRsdQVPb',
              name: 'Radiohead',
              external_urls: { spotify: 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb' },
              images: [{ url: 'https://i.scdn.co/image/artist.jpg' }],
            },
          ],
        },
      };
      setupFetchMock([{ pattern: /api\.spotify\.com\/v1\/search.*type=artist/, response: artistSearchResponse }]);

      const result = await search.searchArtist('radiohead');

      expect(result).toEqual({
        name: 'Radiohead',
        id: '4Z8W4fKeB5YxbusRsdQVPb',
        url: 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb',
        image: 'https://i.scdn.co/image/artist.jpg',
      });
    });
  });

  describe('searchTrack', () => {
    it('searches for tracks and returns first result', async () => {
      const trackSearchResponse = {
        tracks: {
          items: [
            {
              name: 'Reckoner',
              artists: [{ name: 'Radiohead', id: '4Z8W4fKeB5YxbusRsdQVPb' }],
              album: { name: 'In Rainbows', id: '4LH4d3cOWNNsVw41Gqt2kv', images: [{ url: 'https://i.scdn.co/image/album.jpg' }] },
              external_urls: { spotify: 'https://open.spotify.com/track/abc123' },
              preview_url: 'https://p.scdn.co/mp3-preview/abc123',
            },
          ],
        },
      };
      setupFetchMock([{ pattern: /api\.spotify\.com\/v1\/search.*type=track/, response: trackSearchResponse }]);

      const result = await search.searchTrack('reckoner radiohead');

      expect(result).toEqual({
        title: 'Reckoner',
        artist: 'Radiohead',
        artistIds: ['4Z8W4fKeB5YxbusRsdQVPb'],
        album: 'In Rainbows',
        albumId: '4LH4d3cOWNNsVw41Gqt2kv',
        url: 'https://open.spotify.com/track/abc123',
        image: 'https://i.scdn.co/image/album.jpg',
        preview: 'https://p.scdn.co/mp3-preview/abc123',
      });
    });
  });
});
