// Test utilities - Mock implementations for KV and fetch

import { vi } from 'vitest';

/**
 * Creates a mock KVNamespace for testing
 * Simulates Cloudflare Workers KV with in-memory storage
 */
export function createMockKV(): KVNamespace {
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
    put: vi.fn(async (key: string, value: string, options?: { expirationTtl?: number; metadata?: unknown }) => {
      store.set(key, { value, metadata: options?.metadata });
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    // Like KV: keys in name order, filtered by `prefix`, at most `limit` (default 1000) per page. The cursor
    // is the last name returned, so deleting keys between pages never skips any.
    list: vi.fn(async (options?: { prefix?: string; cursor?: string; limit?: number }) => {
      const prefix = options?.prefix ?? '';
      const limit = options?.limit ?? 1000;
      const after = options?.cursor;
      const names = [...store.keys()]
        .filter((name) => name.startsWith(prefix) && (after === undefined || name > after))
        .sort();
      const page = names.slice(0, limit);
      const complete = names.length <= limit;
      return {
        keys: page.map((name) => ({ name })),
        list_complete: complete,
        ...(complete ? {} : { cursor: page[page.length - 1] }),
        cacheStatus: null,
      };
    }),
    getWithMetadata: vi.fn(async (key: string) => {
      const entry = store.get(key);
      if (!entry) return { value: null, metadata: null };
      return { value: entry.value, metadata: entry.metadata || null };
    }),
  } as unknown as KVNamespace;
}

/**
 * Creates a mock fetch response
 */
export function mockFetchResponse(data: unknown, options: { status?: number; ok?: boolean } = {}) {
  const { status = 200, ok = true } = options;
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
    headers: new Headers(),
  } as unknown as Response;
}

/**
 * Sets up fetch mock to return specific responses based on URL patterns
 */
export function setupFetchMock(handlers: Array<{ pattern: RegExp | string; response: unknown; options?: { status?: number; ok?: boolean } }>) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const mockFetch = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    const urlString = url instanceof Request ? url.url : url.toString();

    for (const handler of handlers) {
      const matches = typeof handler.pattern === 'string' ? urlString.includes(handler.pattern) : handler.pattern.test(urlString);

      if (matches) {
        return mockFetchResponse(handler.response, handler.options);
      }
    }

    // Default: return 404
    return mockFetchResponse({ error: 'Not found' }, { status: 404, ok: false });
  });

  globalThis.fetch = mockFetch as typeof fetch;
  return mockFetch;
}

/**
 * Creates a mock SpotifyAuth that returns a fixed token
 */
export function createMockSpotifyAuth() {
  const getAccessToken = vi.fn().mockResolvedValue('mock-access-token');
  return {
    getAccessToken,
    prefetchAccessToken: vi.fn(() => getAccessToken),
  };
}

/**
 * Creates a mock SpotifyRateLimiter for testing
 * The mock immediately resolves acquire() without any rate limiting
 */
export function createMockSpotifyRateLimiter() {
  return {
    acquire: vi.fn().mockResolvedValue(undefined),
    recordRateLimitResponse: vi.fn().mockResolvedValue(undefined),
    getStats: vi.fn().mockResolvedValue({
      requestCount: 0,
      maxRequests: 120,
      windowRemainingMs: 60000,
      inCooldown: false,
    }),
  };
}
