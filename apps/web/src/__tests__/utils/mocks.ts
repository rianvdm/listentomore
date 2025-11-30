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
    list: vi.fn(async () => ({ keys: [], list_complete: true, cacheStatus: null })),
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
  const mockFetch = vi.fn(async (url: string | URL | Request) => {
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

  global.fetch = mockFetch;
  return mockFetch;
}

/**
 * Creates a mock SpotifyAuth that returns a fixed token
 */
export function createMockSpotifyAuth() {
  return {
    getAccessToken: vi.fn().mockResolvedValue('mock-access-token'),
  };
}
