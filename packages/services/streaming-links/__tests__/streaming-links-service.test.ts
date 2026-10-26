// ABOUTME: Tests for StreamingLinksService - Spotify UPC/ISRC pass-through, MusicBrainz fallback,
// ABOUTME: and deferred KV cache writes via waitUntil.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MusicBrainzService } from '@listentomore/musicbrainz';
import { StreamingLinksService, AppleMusicProvider } from '../src/index';
import type { AlbumMetadata, TrackMetadata } from '../src/types';

function createMockKV() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string, type?: string) => {
      const value = store.get(key);
      if (value === undefined) return null;
      return type === 'json' ? JSON.parse(value) : value;
    }),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
}

function createMockMusicBrainz() {
  return {
    getAlbumUpc: vi.fn().mockResolvedValue('999999999999'),
    getTrackIsrc: vi.fn().mockResolvedValue('USMB00000001'),
  };
}

const spotifyAlbum = {
  id: '4LH4d3cOWNNsVw41Gqt2kv',
  name: 'In Rainbows',
  artists: [{ name: 'Radiohead' }],
  total_tracks: 10,
  release_date: '2007-10-10',
  external_ids: { upc: '634904032463' },
};

const spotifyTrack = {
  id: '2nMeu6UenVvwUktBCpLMK9',
  name: 'Reckoner',
  artists: [{ name: 'Radiohead' }],
  album: { name: 'In Rainbows' },
  duration_ms: 290213,
  external_ids: { isrc: 'GBSTK0700063' },
  release_date: '2007-10-10',
};

function albumMetadata(overrides: Partial<AlbumMetadata> = {}): AlbumMetadata {
  return { ...StreamingLinksService.albumMetadataFromSpotify(spotifyAlbum), ...overrides };
}

function trackMetadata(overrides: Partial<TrackMetadata> = {}): TrackMetadata {
  return { ...StreamingLinksService.trackMetadataFromSpotify(spotifyTrack), ...overrides };
}

describe('StreamingLinksService', () => {
  let kv: ReturnType<typeof createMockKV>;
  let musicbrainz: ReturnType<typeof createMockMusicBrainz>;

  function createService(waitUntil?: (promise: Promise<unknown>) => void) {
    return new StreamingLinksService(kv as unknown as KVNamespace, {
      musicbrainz: musicbrainz as unknown as MusicBrainzService,
      waitUntil,
    });
  }

  beforeEach(() => {
    kv = createMockKV();
    musicbrainz = createMockMusicBrainz();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('metadata builders', () => {
    it('passes the Spotify UPC through to album metadata', () => {
      const metadata = StreamingLinksService.albumMetadataFromSpotify(spotifyAlbum);

      expect(metadata.upc).toBe('634904032463');
    });

    it('leaves the album UPC undefined when Spotify omits external_ids', () => {
      const { external_ids: _omit, ...withoutIds } = spotifyAlbum;
      const metadata = StreamingLinksService.albumMetadataFromSpotify(withoutIds);

      expect(metadata.upc).toBeUndefined();
    });

    it('passes the Spotify ISRC through to track metadata', () => {
      const metadata = StreamingLinksService.trackMetadataFromSpotify(spotifyTrack);

      expect(metadata.isrc).toBe('GBSTK0700063');
    });

    it('uses an empty ISRC when Spotify omits external_ids', () => {
      const { external_ids: _omit, ...withoutIds } = spotifyTrack;
      const metadata = StreamingLinksService.trackMetadataFromSpotify(withoutIds);

      expect(metadata.isrc).toBe('');
    });
  });

  describe('MusicBrainz fallback', () => {
    it('does not call MusicBrainz when Spotify supplied a UPC', async () => {
      const searchAlbum = vi.spyOn(AppleMusicProvider.prototype, 'searchAlbum');

      const result = await createService().getAlbumLinks(albumMetadata());

      expect(musicbrainz.getAlbumUpc).not.toHaveBeenCalled();
      expect(searchAlbum).toHaveBeenCalledWith(expect.objectContaining({ upc: '634904032463' }));
      expect((result.source as AlbumMetadata).upc).toBe('634904032463');
    });

    it('calls MusicBrainz when the UPC is absent', async () => {
      const result = await createService().getAlbumLinks(albumMetadata({ upc: undefined }));

      expect(musicbrainz.getAlbumUpc).toHaveBeenCalledWith('Radiohead', 'In Rainbows');
      expect((result.source as AlbumMetadata).upc).toBe('999999999999');
    });

    it('does not call MusicBrainz when Spotify supplied an ISRC', async () => {
      const result = await createService().getTrackLinks(trackMetadata());

      expect(musicbrainz.getTrackIsrc).not.toHaveBeenCalled();
      expect((result.source as TrackMetadata).isrc).toBe('GBSTK0700063');
    });

    it('calls MusicBrainz when the ISRC is absent', async () => {
      const result = await createService().getTrackLinks(trackMetadata({ isrc: '' }));

      expect(musicbrainz.getTrackIsrc).toHaveBeenCalledWith('Radiohead', 'Reckoner');
      expect((result.source as TrackMetadata).isrc).toBe('USMB00000001');
    });
  });

  describe('deferred cache writes', () => {
    it('returns album links without waiting for the KV write and hands it to waitUntil', async () => {
      kv.put.mockReturnValueOnce(new Promise(() => {}));
      const waitUntil = vi.fn();

      const result = await createService(waitUntil).getAlbumLinks(albumMetadata());

      expect(result.cached).toBe(false);
      expect(kv.put).toHaveBeenCalledWith(
        'streaming-links:album:4LH4d3cOWNNsVw41Gqt2kv',
        expect.any(String),
        { expirationTtl: 30 * 24 * 60 * 60 }
      );
      expect(waitUntil).toHaveBeenCalledTimes(1);
      expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
    });

    it('hands the track KV write to waitUntil', async () => {
      const waitUntil = vi.fn();

      await createService(waitUntil).getTrackLinks(trackMetadata());

      expect(kv.put).toHaveBeenCalledWith(
        'streaming-links:track:2nMeu6UenVvwUktBCpLMK9',
        expect.any(String),
        expect.any(Object)
      );
      expect(waitUntil).toHaveBeenCalledTimes(1);
    });

    it('still writes the cache when no waitUntil is provided', async () => {
      const service = createService();

      await service.getAlbumLinks(albumMetadata());
      const second = await service.getAlbumLinks(albumMetadata());

      expect(kv.put).toHaveBeenCalledTimes(1);
      expect(second.cached).toBe(true);
    });

    it('does not write the cache on a hit', async () => {
      const waitUntil = vi.fn();
      const service = createService(waitUntil);
      await service.getAlbumLinks(albumMetadata());
      kv.put.mockClear();
      waitUntil.mockClear();

      await service.getAlbumLinks(albumMetadata());

      expect(kv.put).not.toHaveBeenCalled();
      expect(waitUntil).not.toHaveBeenCalled();
    });

    it('logs a failed KV write instead of failing the request', async () => {
      kv.put.mockRejectedValueOnce(new Error('KV PUT failed: 429'));
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const waitUntil = vi.fn();

      const result = await createService(waitUntil).getAlbumLinks(albumMetadata());
      // The promise handed to waitUntil must settle cleanly so the runtime doesn't report it
      await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();

      expect(result.songlink).toBe('https://song.link/https://open.spotify.com/album/4LH4d3cOWNNsVw41Gqt2kv');
      expect(consoleError).toHaveBeenCalledWith(
        '[StreamingLinks] Deferred cache write streaming-links:album:4LH4d3cOWNNsVw41Gqt2kv failed:',
        'KV PUT failed: 429',
        expect.any(Error)
      );
    });

    it('logs a failed KV write when no waitUntil is provided', async () => {
      kv.put.mockRejectedValueOnce(new Error('KV PUT failed: 429'));
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await createService().getTrackLinks(trackMetadata());
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(result.cached).toBe(false);
      expect(consoleError).toHaveBeenCalledWith(
        '[StreamingLinks] Deferred cache write streaming-links:track:2nMeu6UenVvwUktBCpLMK9 failed:',
        'KV PUT failed: 429',
        expect.any(Error)
      );
    });
  });
});
