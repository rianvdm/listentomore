// ABOUTME: Tests for the budgeted, globally cached MusicBrainz credits client.
// ABOUTME: Mocks fetch and the limiter; covers cache keys and TTLs, the call cap, errors and log hygiene.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { MusicBrainzCredits, CreditsCapReached, MusicBrainzRateLimitError } from '../src/index';
import { retryAfterMs } from '../src/fetch';

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
  const mockFetch = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
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

const DAY = 86400;

/** Runs every pending timer (the retry wait) while the assertion settles. Needs vi.useFakeTimers(). */
async function settle(assertion: Promise<unknown>): Promise<void> {
  await vi.runAllTimersAsync();
  await assertion;
}

/** One mocked response; `retryAfter` sets the Retry-After header. */
function mockResponse(status: number, body: unknown, retryAfter?: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
    headers: new Headers(retryAfter === undefined ? {} : { 'Retry-After': retryAfter }),
  } as unknown as Response;
}
const BECK = { id: 'beck', name: 'Beck' };

const SEA_CHANGE_SEARCH = {
  'release-groups': [{ id: 'rg-sea-change', score: 100, title: 'Sea Change', 'primary-type': 'Album' }],
};
const SEA_CHANGE_GROUP = {
  id: 'rg-sea-change',
  releases: [
    { id: 'r-later', status: 'Official', date: '2002-10-01' },
    { id: 'r-first', status: 'Official', date: '2002-09-24' },
  ],
};
const SEA_CHANGE_RELEASE = {
  id: 'r-first',
  'artist-credit': [{ name: 'Beck', joinphrase: '', artist: BECK }],
  relations: [
    {
      type: 'producer',
      'target-type': 'artist',
      direction: 'backward',
      attributes: [],
      artist: { id: 'godrich', name: 'Nigel Godrich' },
    },
  ],
  media: [],
};
const BECK_ARTIST = { id: 'beck', name: 'Beck', type: 'Person', relations: [] };

const SEARCH = /musicbrainz\.org\/ws\/2\/release-group\/\?query=/;
const GROUP = /musicbrainz\.org\/ws\/2\/release-group\/rg-sea-change\?inc=releases/;
const RELEASE = /musicbrainz\.org\/ws\/2\/release\/r-first\?inc=artist-credits\+recordings\+artist-rels\+recording-level-rels/;
const ARTIST = /musicbrainz\.org\/ws\/2\/artist\/beck\?inc=artist-rels/;

describe('MusicBrainzCredits', () => {
  let kv: KVNamespace;
  let limiter: { reserve: Mock<(maxWaitMs: number) => Promise<number | null>> };

  beforeEach(() => {
    vi.clearAllMocks();
    kv = createMockKV();
    limiter = { reserve: vi.fn<(maxWaitMs: number) => Promise<number | null>>(async () => 0) };
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('caches a search with no release group as a miss and spends no call on the next lookup', async () => { // Review Focus 4
    setupFetchMock([{ pattern: /\/release-group\/\?query=/, response: { 'release-groups': [] } }]);
    const first = new MusicBrainzCredits(kv, limiter, { maxCalls: 10 });
    expect(await first.findRelease('DJ Nobody', 'Mixtape Vol. 3')).toBeNull();
    expect(first.calls).toBe(1);
    expect(kv.put).toHaveBeenCalledWith(expect.stringMatching(/^musicbrainz:credits:rg:/), JSON.stringify({ miss: true }), { expirationTtl: 7 * 86400 });
    const second = new MusicBrainzCredits(kv, limiter, { maxCalls: 10 });
    expect(await second.findRelease('DJ Nobody', 'Mixtape Vol. 3')).toBeNull();
    expect(second.calls).toBe(0);
  });

  it('caches a release group with no official release as a miss', async () => {
    setupFetchMock([
      { pattern: SEARCH, response: SEA_CHANGE_SEARCH },
      { pattern: GROUP, response: { id: 'rg-sea-change', releases: [{ id: 'r-boot', status: 'Bootleg', date: '2002' }] } },
    ]);
    const credits = new MusicBrainzCredits(kv, limiter, { maxCalls: 10 });

    expect(await credits.findRelease('Beck', 'Sea Change')).toBeNull();
    expect(credits.calls).toBe(2);
    expect(kv.put).toHaveBeenCalledWith('musicbrainz:credits:rg:beck:sea%20change', JSON.stringify({ miss: true }), {
      expirationTtl: 7 * DAY,
    });
  });

  it('resolves a release in two calls and caches it for 30 days', async () => {
    const mockFetch = setupFetchMock([
      { pattern: SEARCH, response: SEA_CHANGE_SEARCH },
      { pattern: GROUP, response: SEA_CHANGE_GROUP },
    ]);
    const credits = new MusicBrainzCredits(kv, limiter, { maxCalls: 10 });

    const ref = await credits.findRelease('Beck', ' Sea Change ');

    expect(ref).toEqual({ releaseGroupId: 'rg-sea-change', releaseId: 'r-first' });
    expect(credits.calls).toBe(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(kv.put).toHaveBeenCalledTimes(1);
    expect(kv.put).toHaveBeenCalledWith('musicbrainz:credits:rg:beck:sea%20change', JSON.stringify(ref), {
      expirationTtl: 30 * DAY,
    });
  });

  it('searches by quoted, Lucene-escaped release group and artist', async () => {
    const mockFetch = setupFetchMock([{ pattern: SEARCH, response: { 'release-groups': [] } }]);
    const credits = new MusicBrainzCredits(kv, limiter, { maxCalls: 10 });

    await credits.findRelease('AC/DC', 'High "Voltage"');

    const url = new URL(String(mockFetch.mock.calls[0][0]));
    expect(url.pathname).toBe('/ws/2/release-group/');
    expect(url.searchParams.get('query')).toBe('releasegroup:"High \\"Voltage\\"" AND artist:"AC\\/DC"');
    expect(url.searchParams.get('fmt')).toBe('json');
    expect(url.searchParams.get('limit')).toBe('5');
  });

  it('reads release credits and artist bands, caching each for 30 days', async () => {
    setupFetchMock([
      { pattern: RELEASE, response: SEA_CHANGE_RELEASE },
      { pattern: ARTIST, response: BECK_ARTIST },
    ]);
    const credits = new MusicBrainzCredits(kv, limiter, { maxCalls: 10 });

    const release = await credits.releaseCredits('r-first');
    const bands = await credits.artistBands('beck');

    expect(release).toEqual({
      releaseId: 'r-first',
      artists: [BECK],
      credits: [{ artist: { id: 'godrich', name: 'Nigel Godrich' }, type: 'producer', attributes: [], level: 'release' }],
    });
    expect(bands).toEqual({ artist: BECK, type: 'Person', memberOf: [], members: [] });
    expect(credits.calls).toBe(2);
    expect(kv.put).toHaveBeenCalledWith('musicbrainz:credits:release:r-first', JSON.stringify(release), {
      expirationTtl: 30 * DAY,
    });
    expect(kv.put).toHaveBeenCalledWith('musicbrainz:credits:artist:beck', JSON.stringify(bands), {
      expirationTtl: 30 * DAY,
    });
  });

  it('serves cached releases and artists with calls === 0', async () => {
    setupFetchMock([
      { pattern: SEARCH, response: SEA_CHANGE_SEARCH },
      { pattern: GROUP, response: SEA_CHANGE_GROUP },
      { pattern: RELEASE, response: SEA_CHANGE_RELEASE },
      { pattern: ARTIST, response: BECK_ARTIST },
    ]);
    const warm = new MusicBrainzCredits(kv, limiter, { maxCalls: 10 });
    const ref = await warm.findRelease('Beck', 'Sea Change');
    const release = await warm.releaseCredits('r-first');
    const bands = await warm.artistBands('beck');
    expect(warm.calls).toBe(4);

    const mockFetch = setupFetchMock([]);
    limiter.reserve.mockClear();
    const cached = new MusicBrainzCredits(kv, limiter, { maxCalls: 0 });

    expect(await cached.findRelease('beck', 'SEA CHANGE')).toEqual(ref);
    expect(await cached.releaseCredits('r-first')).toEqual(release);
    expect(await cached.artistBands('beck')).toEqual(bands);
    expect(cached.calls).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(limiter.reserve).not.toHaveBeenCalled();
  });

  it('throws CreditsCapReached before the call that would pass maxCalls', async () => {
    const mockFetch = setupFetchMock([
      { pattern: RELEASE, response: SEA_CHANGE_RELEASE },
      { pattern: ARTIST, response: BECK_ARTIST },
      { pattern: /\/artist\/other\?/, response: { id: 'other', name: 'Other' } },
    ]);
    const credits = new MusicBrainzCredits(kv, limiter, { maxCalls: 2 });

    await credits.releaseCredits('r-first');
    await credits.artistBands('beck');
    await expect(credits.artistBands('other')).rejects.toBeInstanceOf(CreditsCapReached);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(credits.calls).toBe(2);
    expect(await kv.get('musicbrainz:credits:release:r-first')).not.toBeNull();
    expect(await kv.get('musicbrainz:credits:artist:beck')).not.toBeNull();
    expect(await kv.get('musicbrainz:credits:artist:other')).toBeNull();
  });

  it('stops between the search and the release-group lookup and caches nothing for that album', async () => {
    const mockFetch = setupFetchMock([{ pattern: SEARCH, response: SEA_CHANGE_SEARCH }]);
    const credits = new MusicBrainzCredits(kv, limiter, { maxCalls: 1 });

    await expect(credits.findRelease('Beck', 'Sea Change')).rejects.toBeInstanceOf(CreditsCapReached);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('lifts the cap with maxCalls: Infinity', async () => {
    setupFetchMock([{ pattern: ARTIST, response: BECK_ARTIST }]);
    const credits = new MusicBrainzCredits(kv, limiter, { maxCalls: Infinity });

    for (let i = 0; i < 12; i += 1) {
      await kv.delete('musicbrainz:credits:artist:beck');
      await credits.artistBands('beck');
    }
    expect(credits.calls).toBe(12);
  });

  it('passes MusicBrainzRateLimitError through and caches nothing for that lookup', async () => {
    vi.useFakeTimers();
    setupFetchMock([{ pattern: /musicbrainz\.org/, response: { error: 'unavailable' }, options: { status: 503, ok: false } }]);
    const credits = new MusicBrainzCredits(kv, limiter, { maxCalls: 10 });

    // A 503, then the one retry's 503.
    await settle(expect(credits.releaseCredits('r-first')).rejects.toBeInstanceOf(MusicBrainzRateLimitError));
    // A declined slot is not retried.
    limiter.reserve.mockResolvedValueOnce(null);
    await expect(credits.artistBands('beck')).rejects.toBeInstanceOf(MusicBrainzRateLimitError);

    expect(kv.put).not.toHaveBeenCalled();
    expect(credits.calls).toBe(3);
  });

  it('caches nothing when a lookup fails with a 500 or a 429', async () => {
    setupFetchMock([
      { pattern: SEARCH, response: SEA_CHANGE_SEARCH },
      { pattern: GROUP, response: {}, options: { status: 500, ok: false } },
      { pattern: ARTIST, response: {}, options: { status: 429, ok: false } },
    ]);
    const credits = new MusicBrainzCredits(kv, limiter, { maxCalls: 10 });
    vi.useFakeTimers();

    await expect(credits.findRelease('Beck', 'Sea Change')).rejects.toThrow('MusicBrainz API error: 500');
    await settle(expect(credits.artistBands('beck')).rejects.toThrow('MusicBrainz API error: 429'));
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('caches a 404 release or artist as a miss and spends no call on the next lookup', async () => {
    setupFetchMock([]);
    const first = new MusicBrainzCredits(kv, limiter, { maxCalls: 10 });

    expect(await first.releaseCredits('r-gone')).toBeNull();
    expect(await first.artistBands('a-gone')).toBeNull();
    expect(first.calls).toBe(2);
    expect(kv.put).toHaveBeenCalledWith('musicbrainz:credits:release:r-gone', JSON.stringify({ miss: true }), {
      expirationTtl: 7 * DAY,
    });
    expect(kv.put).toHaveBeenCalledWith('musicbrainz:credits:artist:a-gone', JSON.stringify({ miss: true }), {
      expirationTtl: 7 * DAY,
    });

    const second = new MusicBrainzCredits(kv, limiter, { maxCalls: 10 });
    expect(await second.releaseCredits('r-gone')).toBeNull();
    expect(await second.artistBands('a-gone')).toBeNull();
    expect(second.calls).toBe(0);
  });

  it('caches a 404 on the release-group lookup as a miss for that album', async () => {
    setupFetchMock([{ pattern: SEARCH, response: SEA_CHANGE_SEARCH }]);
    const first = new MusicBrainzCredits(kv, limiter, { maxCalls: 10 });

    expect(await first.findRelease('Beck', 'Sea Change')).toBeNull();
    expect(first.calls).toBe(2);
    expect(kv.put).toHaveBeenCalledWith('musicbrainz:credits:rg:beck:sea%20change', JSON.stringify({ miss: true }), {
      expirationTtl: 7 * DAY,
    });

    const second = new MusicBrainzCredits(kv, limiter, { maxCalls: 10 });
    expect(await second.findRelease('Beck', 'Sea Change')).toBeNull();
    expect(second.calls).toBe(0);
  });

  it('never follows a redirect, so every network request is budgeted and takes a limiter slot', async () => {
    const mockFetch = setupFetchMock([
      { pattern: ARTIST, response: {}, options: { status: 301, ok: false } },
      { pattern: /\/artist\/other\?/, response: { id: 'other', name: 'Other' } },
    ]);
    const credits = new MusicBrainzCredits(kv, limiter, { maxCalls: 1 });

    await expect(credits.artistBands('beck')).rejects.toThrow('MusicBrainz API error: 301');
    await expect(credits.artistBands('other')).rejects.toBeInstanceOf(CreditsCapReached);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
    expect(credits.calls).toBe(1);
    expect(limiter.reserve).toHaveBeenCalledTimes(1);
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('reserves a limiter slot for every network call', async () => {
    setupFetchMock([
      { pattern: SEARCH, response: SEA_CHANGE_SEARCH },
      { pattern: GROUP, response: SEA_CHANGE_GROUP },
      { pattern: RELEASE, response: SEA_CHANGE_RELEASE },
      { pattern: ARTIST, response: BECK_ARTIST },
    ]);
    const credits = new MusicBrainzCredits(kv, limiter, { maxCalls: 10 });

    await credits.findRelease('Beck', 'Sea Change');
    await credits.releaseCredits('r-first');
    await credits.artistBands('beck');

    expect(credits.calls).toBe(4);
    expect(limiter.reserve).toHaveBeenCalledTimes(4);
    expect(limiter.reserve).toHaveBeenCalledWith(5000);
  });

  it('skips the cache for keys over 512 bytes', async () => {
    setupFetchMock([{ pattern: SEARCH, response: { 'release-groups': [] } }]);
    const credits = new MusicBrainzCredits(kv, limiter, { maxCalls: 10 });

    expect(await credits.findRelease('Beck', 'é'.repeat(200))).toBeNull();
    expect(credits.calls).toBe(1);
    expect(kv.get).not.toHaveBeenCalled();
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('logs no artist or album name and no request URL', async () => {
    const searchHit = { 'release-groups': [{ ...SEA_CHANGE_SEARCH['release-groups'][0], title: 'Mixtape Vol. 1' }] };
    setupFetchMock([
      { pattern: /Vol\.%201/, response: searchHit },
      { pattern: /Vol\.%202/, response: { error: 'unavailable' }, options: { status: 503, ok: false } },
      { pattern: /Vol\.%203/, response: { 'release-groups': [] } },
      { pattern: GROUP, response: SEA_CHANGE_GROUP },
    ]);
    const credits = new MusicBrainzCredits(kv, limiter, { maxCalls: 10 });
    vi.useFakeTimers();

    expect(await credits.findRelease('DJ Nobody', 'Mixtape Vol. 1')).not.toBeNull();
    expect(await credits.findRelease('DJ Nobody', 'Mixtape Vol. 3')).toBeNull();
    await settle(expect(credits.findRelease('DJ Nobody', 'Mixtape Vol. 2')).rejects.toBeInstanceOf(MusicBrainzRateLimitError));

    const logged = (['log', 'info', 'warn', 'error', 'debug'] as const).flatMap((level) =>
      vi.mocked(console[level]).mock.calls.flat(),
    );
    expect(logged.length).toBeGreaterThan(0);
    for (const arg of logged) {
      const text = arg instanceof Error ? `${arg.message} ${arg.stack}` : String(arg);
      for (const forbidden of ['DJ Nobody', 'Mixtape', 'musicbrainz.org']) {
        expect(text).not.toContain(forbidden);
      }
    }
  });
});

describe('MusicBrainzCredits retry on 503 and 429', () => {
  const BANDS = { id: 'beck', name: 'Beck', type: 'Person', relations: [] };
  let kv: KVNamespace;
  let limiter: { reserve: Mock<(maxWaitMs: number) => Promise<number | null>> };
  let fetchMock: Mock;

  beforeEach(() => {
    vi.useFakeTimers();
    kv = createMockKV();
    limiter = { reserve: vi.fn<(maxWaitMs: number) => Promise<number | null>>(async () => 0) };
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    for (const level of ['log', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Milliseconds between the first response and the retry's request. */
  async function retryGap(lookup: Promise<unknown>): Promise<number> {
    const started = Date.now();
    await vi.runAllTimersAsync();
    await lookup.catch(() => undefined);
    return Date.now() - started;
  }

  it('succeeds after a 503 then a 200, with both requests counted and each taking a limiter slot', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(503, {})).mockResolvedValueOnce(mockResponse(200, BANDS));
    const credits = new MusicBrainzCredits(kv, limiter, { maxCalls: 10 });

    const lookup = credits.artistBands('beck');
    await vi.runAllTimersAsync();
    expect(await lookup).not.toBeNull();
    expect(credits.calls).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(limiter.reserve).toHaveBeenCalledTimes(2);
    expect(kv.put).toHaveBeenCalledTimes(1);
  });

  it('still cuts after a 503 twice: throws and caches nothing', async () => {
    fetchMock.mockResolvedValue(mockResponse(503, {}));
    const credits = new MusicBrainzCredits(kv, limiter, { maxCalls: 10 });

    await settle(expect(credits.artistBands('beck')).rejects.toBeInstanceOf(MusicBrainzRateLimitError));
    expect(credits.calls).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('retries a 429 once as well', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(429, {})).mockResolvedValueOnce(mockResponse(200, BANDS));
    const credits = new MusicBrainzCredits(kv, limiter, { maxCalls: 10 });

    const lookup = credits.artistBands('beck');
    await vi.runAllTimersAsync();
    expect(await lookup).not.toBeNull();
    expect(credits.calls).toBe(2);
  });

  it('waits for Retry-After up to 5 s, and 2 s when it is longer or absent', async () => {
    const gapFor = async (retryAfter?: string): Promise<number> => {
      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce(mockResponse(503, {}, retryAfter)).mockResolvedValueOnce(mockResponse(200, BANDS));
      return retryGap(new MusicBrainzCredits(createMockKV(), limiter, { maxCalls: 10 }).artistBands('beck'));
    };
    expect(await gapFor('4')).toBe(4000);
    expect(await gapFor('5')).toBe(5000);
    expect(await gapFor('6')).toBe(2000);
    expect(await gapFor(undefined)).toBe(2000);
    expect(await gapFor('soon')).toBe(2000);
  });

  it('counts the retry against the cap, so a 503 on the last allowed call stops with CreditsCapReached', async () => {
    fetchMock.mockResolvedValue(mockResponse(503, {}));
    const credits = new MusicBrainzCredits(kv, limiter, { maxCalls: 1 });

    await settle(expect(credits.artistBands('beck')).rejects.toBeInstanceOf(CreditsCapReached));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(credits.calls).toBe(1);
  });

  it('does not retry a 500 or a declined limiter slot', async () => {
    fetchMock.mockResolvedValue(mockResponse(500, {}));
    const credits = new MusicBrainzCredits(kv, limiter, { maxCalls: 10 });
    await expect(credits.artistBands('beck')).rejects.toThrow('MusicBrainz API error: 500');
    limiter.reserve.mockResolvedValueOnce(null);
    await expect(credits.artistBands('beck')).rejects.toBeInstanceOf(MusicBrainzRateLimitError);
    expect(credits.calls).toBe(2);
  });
});

describe('retryAfterMs', () => {
  it('reads delay-seconds and HTTP dates, and null for anything else', () => {
    const now = Date.parse('2026-11-10T12:00:00Z');
    expect(retryAfterMs('3', now)).toBe(3000);
    expect(retryAfterMs(' 0 ', now)).toBe(0);
    expect(retryAfterMs('Tue, 10 Nov 2026 12:00:04 GMT', now)).toBe(4000);
    expect(retryAfterMs('Tue, 10 Nov 2026 11:59:00 GMT', now)).toBe(0);
    expect(retryAfterMs(null, now)).toBeNull();
    expect(retryAfterMs('soon', now)).toBeNull();
  });
});
