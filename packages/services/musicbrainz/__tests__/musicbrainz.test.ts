// ABOUTME: Tests for MusicBrainz service - album UPC and track ISRC lookups.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MusicBrainzService } from '../src/index';

/**
 * Creates a mock KVNamespace for testing
 */
function createMockKV(): KVNamespace {
  const store = new Map<string, { value: string; metadata?: unknown }>();

  return {
    get: vi.fn(async (key: string, options?: { type?: string } | string) => {
      const entry = store.get(key);
      if (!entry) return null;

      const type = typeof options === 'string' ? options : options?.type;
      if (type === 'json') {
        return JSON.parse(entry.value);
      }
      return entry.value;
    }),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, { value });
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(async () => ({ keys: [], list_complete: true, cacheStatus: null })),
    getWithMetadata: vi.fn(async (key: string) => {
      const entry = store.get(key);
      if (!entry) return { value: null, metadata: null };
      return { value: entry.value, metadata: entry.metadata || null };
    }),
  } as unknown as KVNamespace;
}

function setupFetchMock(handlers: Array<{ pattern: RegExp; response: unknown; options?: { status?: number; ok?: boolean } }>) {
  const mockFetch = vi.fn(async (url: string | URL | Request) => {
    const urlString = url instanceof Request ? url.url : url.toString();

    for (const handler of handlers) {
      if (handler.pattern.test(urlString)) {
        const { status = 200, ok = true } = handler.options ?? {};
        return {
          ok,
          status,
          statusText: ok ? 'OK' : 'Error',
          json: vi.fn().mockResolvedValue(handler.response),
          text: vi.fn().mockResolvedValue(JSON.stringify(handler.response)),
          headers: new Headers(),
        } as unknown as Response;
      }
    }

    return {
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: vi.fn().mockResolvedValue({ error: 'Not found' }),
      text: vi.fn().mockResolvedValue('{"error":"Not found"}'),
      headers: new Headers(),
    } as unknown as Response;
  });

  globalThis.fetch = mockFetch as typeof fetch;
  return mockFetch;
}

// MusicBrainz API fixtures
const releaseSearchResponse = {
  created: '2026-02-27T00:00:00.000Z',
  count: 1,
  offset: 0,
  releases: [
    {
      id: 'release-mbid-123',
      score: 100,
      title: 'In Rainbows',
      'artist-credit': [{ name: 'Radiohead', artist: { id: 'artist-mbid', name: 'Radiohead' } }],
      date: '2007-10-10',
      barcode: '634904078560',
      'release-group': { id: 'rg-mbid', 'primary-type': 'Album' },
    },
  ],
};

const releaseSearchNoBarcode = {
  created: '2026-02-27T00:00:00.000Z',
  count: 1,
  offset: 0,
  releases: [
    {
      id: 'release-mbid-456',
      score: 95,
      title: 'In Rainbows',
      'artist-credit': [{ name: 'Radiohead', artist: { id: 'artist-mbid', name: 'Radiohead' } }],
      date: '2007-10-10',
      'release-group': { id: 'rg-mbid', 'primary-type': 'Album' },
    },
  ],
};

const releaseLookupWithBarcode = {
  id: 'release-mbid-456',
  title: 'In Rainbows',
  barcode: '634904078560',
};

const recordingSearchResponse = {
  created: '2026-02-27T00:00:00.000Z',
  count: 1,
  offset: 0,
  recordings: [
    {
      id: 'recording-mbid-123',
      score: 100,
      title: 'Reckoner',
      'artist-credit': [{ name: 'Radiohead', artist: { id: 'artist-mbid', name: 'Radiohead' } }],
      releases: [{ id: 'release-mbid', title: 'In Rainbows', 'release-group': { 'primary-type': 'Album' } }],
    },
  ],
};

const recordingLookupWithIsrc = {
  id: 'recording-mbid-123',
  title: 'Reckoner',
  isrcs: ['GBSTK0700029'],
};

describe('MusicBrainzService', () => {
  let mockKV: KVNamespace;
  let service: MusicBrainzService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockKV = createMockKV();
    service = new MusicBrainzService(mockKV);
  });

  describe('getAlbumUpc', () => {
    it('returns UPC from MusicBrainz release search', async () => {
      setupFetchMock([
        { pattern: /musicbrainz\.org\/ws\/2\/release\/\?query=/, response: releaseSearchResponse },
      ]);

      const upc = await service.getAlbumUpc('Radiohead', 'In Rainbows');

      expect(upc).toBe('634904078560');
      // Verify cache was written
      expect(mockKV.put).toHaveBeenCalled();
    });

    it('follows up with MBID lookup when search has no barcode', async () => {
      setupFetchMock([
        { pattern: /musicbrainz\.org\/ws\/2\/release\/\?query=/, response: releaseSearchNoBarcode },
        { pattern: /musicbrainz\.org\/ws\/2\/release\/release-mbid-456/, response: releaseLookupWithBarcode },
      ]);

      const upc = await service.getAlbumUpc('Radiohead', 'In Rainbows');

      expect(upc).toBe('634904078560');
    });

    it('returns null when no releases found', async () => {
      setupFetchMock([
        { pattern: /musicbrainz\.org\/ws\/2\/release\/\?query=/, response: { releases: [] } },
      ]);

      const upc = await service.getAlbumUpc('Unknown Artist', 'Unknown Album');

      expect(upc).toBeNull();
    });

    it('returns cached UPC on subsequent calls', async () => {
      setupFetchMock([
        { pattern: /musicbrainz\.org\/ws\/2\/release\/\?query=/, response: releaseSearchResponse },
      ]);

      // First call - fetches from API
      await service.getAlbumUpc('Radiohead', 'In Rainbows');

      // Second call - should return from cache
      const upc = await service.getAlbumUpc('Radiohead', 'In Rainbows');

      expect(upc).toBe('634904078560');
    });

    it('returns null for empty artist or album', async () => {
      const upc = await service.getAlbumUpc('', 'In Rainbows');
      expect(upc).toBeNull();

      const upc2 = await service.getAlbumUpc('Radiohead', '');
      expect(upc2).toBeNull();
    });

    it('returns null when all results have low scores', async () => {
      const lowScoreResponse = {
        ...releaseSearchResponse,
        releases: [{ ...releaseSearchResponse.releases[0], score: 50 }],
      };
      setupFetchMock([
        { pattern: /musicbrainz\.org\/ws\/2\/release\/\?query=/, response: lowScoreResponse },
      ]);

      const upc = await service.getAlbumUpc('Radiohead', 'In Rainbows');

      expect(upc).toBeNull();
    });
  });

  describe('getTrackIsrc', () => {
    it('returns ISRC from MusicBrainz recording lookup', async () => {
      setupFetchMock([
        { pattern: /musicbrainz\.org\/ws\/2\/recording\/\?query=/, response: recordingSearchResponse },
        { pattern: /musicbrainz\.org\/ws\/2\/recording\/recording-mbid-123\?inc=isrcs/, response: recordingLookupWithIsrc },
      ]);

      const isrc = await service.getTrackIsrc('Radiohead', 'Reckoner');

      expect(isrc).toBe('GBSTK0700029');
    });

    it('returns null when no recordings found', async () => {
      setupFetchMock([
        { pattern: /musicbrainz\.org\/ws\/2\/recording\/\?query=/, response: { recordings: [] } },
      ]);

      const isrc = await service.getTrackIsrc('Unknown Artist', 'Unknown Track');

      expect(isrc).toBeNull();
    });

    it('returns null when recording has no ISRCs', async () => {
      const noIsrcLookup = { id: 'recording-mbid-123', title: 'Reckoner', isrcs: [] };
      setupFetchMock([
        { pattern: /musicbrainz\.org\/ws\/2\/recording\/\?query=/, response: recordingSearchResponse },
        { pattern: /musicbrainz\.org\/ws\/2\/recording\/recording-mbid-123\?inc=isrcs/, response: noIsrcLookup },
      ]);

      const isrc = await service.getTrackIsrc('Radiohead', 'Reckoner');

      expect(isrc).toBeNull();
    });

    it('tries multiple recordings when first has no ISRCs', async () => {
      // Simulates the real-world case where some MusicBrainz recordings for
      // the same song don't have ISRCs (discovered during API smoke testing)
      const multiRecordingResponse = {
        ...recordingSearchResponse,
        recordings: [
          { ...recordingSearchResponse.recordings[0], id: 'mbid-no-isrc-1' },
          { ...recordingSearchResponse.recordings[0], id: 'mbid-no-isrc-2' },
          { ...recordingSearchResponse.recordings[0], id: 'mbid-with-isrc' },
        ],
      };
      const noIsrc = { id: 'mbid-no-isrc', title: 'Reckoner', isrcs: [] };
      const withIsrc = { id: 'mbid-with-isrc', title: 'Reckoner', isrcs: ['GBAYE9200349'] };

      setupFetchMock([
        { pattern: /musicbrainz\.org\/ws\/2\/recording\/\?query=/, response: multiRecordingResponse },
        { pattern: /musicbrainz\.org\/ws\/2\/recording\/mbid-no-isrc-1\?inc=isrcs/, response: noIsrc },
        { pattern: /musicbrainz\.org\/ws\/2\/recording\/mbid-no-isrc-2\?inc=isrcs/, response: noIsrc },
        { pattern: /musicbrainz\.org\/ws\/2\/recording\/mbid-with-isrc\?inc=isrcs/, response: withIsrc },
      ]);

      const isrc = await service.getTrackIsrc('Radiohead', 'Reckoner');

      expect(isrc).toBe('GBAYE9200349');
    });

    it('returns null for empty artist or track', async () => {
      const isrc = await service.getTrackIsrc('', 'Reckoner');
      expect(isrc).toBeNull();

      const isrc2 = await service.getTrackIsrc('Radiohead', '');
      expect(isrc2).toBeNull();
    });
  });
});
