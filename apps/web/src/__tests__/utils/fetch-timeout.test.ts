// ABOUTME: Tests for TimeoutError URL redaction.
// ABOUTME: Query strings can carry API keys, so they must never reach error messages or logs.

import { describe, it, expect } from 'vitest';
import { TimeoutError } from '@listentomore/shared';

describe('TimeoutError', () => {
  it('strips the query string from the message and url', () => {
    const error = new TimeoutError(
      'https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=calisza&api_key=secret123&limit=1&format=json',
      10000,
    );

    expect(error.message).toBe('Request to https://ws.audioscrobbler.com/2.0/ timed out after 10000ms');
    expect(error.url).toBe('https://ws.audioscrobbler.com/2.0/');
    expect(error.message).not.toContain('secret123');
    expect(error.url).not.toContain('?');
  });

  it('strips fragments', () => {
    const error = new TimeoutError('https://example.com/callback#token=abc', 5000);

    expect(error.url).toBe('https://example.com/callback');
    expect(error.message).not.toContain('token=abc');
  });

  it('strips the query string from URLs that cannot be parsed', () => {
    const error = new TimeoutError('/relative/path?api_key=secret123', 5000);

    expect(error.url).toBe('/relative/path');
    expect(error.message).toBe('Request to /relative/path timed out after 5000ms');
  });

  it('leaves a URL without a query string unchanged', () => {
    const error = new TimeoutError('https://api.spotify.com/v1/albums/abc', 10000);

    expect(error.url).toBe('https://api.spotify.com/v1/albums/abc');
    expect(error.name).toBe('TimeoutError');
    expect(error.timeoutMs).toBe(10000);
  });
});
