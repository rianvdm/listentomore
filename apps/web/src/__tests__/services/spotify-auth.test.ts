// Client Credentials token-request tests for SpotifyAuth
import { describe, it, expect, beforeEach } from 'vitest';
import { SpotifyAuth } from '@listentomore/spotify';
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
