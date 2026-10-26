// ABOUTME: Tests for SpotifyAuth - client-credentials token requests, caching,
// ABOUTME: token prefetch (KV-only until needed), and deferred token cache writes.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpotifyAuth, createDefer } from '@listentomore/spotify';
import { createMockKV, setupFetchMock } from '../utils/mocks';

describe('SpotifyAuth (Client Credentials)', () => {
  let mockKV: KVNamespace;

  beforeEach(() => {
    mockKV = createMockKV();
  });

  it('requests a token via the client_credentials grant with no refresh_token', async () => {
    const mockFetch = setupFetchMock([
      {
        pattern: 'accounts.spotify.com/api/token',
        response: { access_token: 'cc-token', expires_in: 3600 },
      },
    ]);

    const auth = new SpotifyAuth({ clientId: 'abc12345', clientSecret: 'shh' }, mockKV);
    const token = await auth.getAccessToken();

    expect(token).toBe('cc-token');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain('accounts.spotify.com/api/token');

    const body = (init as RequestInit).body as string;
    expect(body).toContain('grant_type=client_credentials');
    expect(body).not.toContain('refresh_token');

    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${btoa('abc12345:shh')}`);
  });

  it('caches the token and skips the fetch on the next call', async () => {
    const mockFetch = setupFetchMock([
      {
        pattern: 'accounts.spotify.com/api/token',
        response: { access_token: 'cc-token', expires_in: 3600 },
      },
    ]);

    const auth = new SpotifyAuth({ clientId: 'abc12345', clientSecret: 'shh' }, mockKV);
    await auth.getAccessToken();
    await auth.getAccessToken();

    expect(mockFetch).toHaveBeenCalledTimes(1); // second call served from KV cache
  });
});

describe('SpotifyAuth token prefetch and deferred writes', () => {
  let mockKV: KVNamespace;

  beforeEach(() => {
    mockKV = createMockKV();
  });

  it('prefetch only reads KV; Spotify is not called unless the token is needed', async () => {
    const mockFetch = setupFetchMock([
      {
        pattern: 'accounts.spotify.com/api/token',
        response: { access_token: 'cc-token', expires_in: 3600 },
      },
    ]);

    const auth = new SpotifyAuth({ clientId: 'abc12345', clientSecret: 'shh' }, mockKV);
    auth.prefetchAccessToken(); // cache-hit caller: never resolves the token
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockKV.get).toHaveBeenCalledTimes(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('prefetch refreshes the token when called and the cache is empty', async () => {
    const mockFetch = setupFetchMock([
      {
        pattern: 'accounts.spotify.com/api/token',
        response: { access_token: 'cc-token', expires_in: 3600 },
      },
    ]);

    const auth = new SpotifyAuth({ clientId: 'abc12345', clientSecret: 'shh' }, mockKV);
    const getAccessToken = auth.prefetchAccessToken();

    expect(await getAccessToken()).toBe('cc-token');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockKV.get).toHaveBeenCalledTimes(1);
  });

  it('surfaces a KV read error only to callers that resolve the token', async () => {
    (mockKV.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('KV down'));

    const auth = new SpotifyAuth({ clientId: 'abc12345', clientSecret: 'shh' }, mockKV);
    const getAccessToken = auth.prefetchAccessToken();

    await expect(getAccessToken()).rejects.toThrow('KV down');
  });

  it('returns the refreshed token without waiting for the KV write', async () => {
    setupFetchMock([
      {
        pattern: 'accounts.spotify.com/api/token',
        response: { access_token: 'cc-token', expires_in: 3600 },
      },
    ]);
    (mockKV.put as ReturnType<typeof vi.fn>).mockReturnValueOnce(new Promise(() => {}));
    const waitUntil = vi.fn();

    const auth = new SpotifyAuth(
      { clientId: 'abc12345', clientSecret: 'shh' },
      mockKV,
      createDefer(waitUntil)
    );

    expect(await auth.getAccessToken()).toBe('cc-token');
    expect(mockKV.put).toHaveBeenCalledWith('spotify:token:abc12345', expect.any(String), expect.any(Object));
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });
});
