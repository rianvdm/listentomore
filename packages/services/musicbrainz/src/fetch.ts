// ABOUTME: Rate-limited fetch wrapper for MusicBrainz API.
// ABOUTME: Takes a slot from a shared limiter (Durable Object in production) before each request.

import { fetchWithTimeout } from '@listentomore/shared';
import { MusicBrainzApiError, MusicBrainzRateLimitError } from './errors';
import { MUSICBRAINZ_MAX_WAIT_MS } from './rate-limit';
import type { MusicBrainzRateLimiter } from './rate-limit';

const MUSICBRAINZ_API_BASE = 'https://musicbrainz.org/ws/2';
const USER_AGENT = 'ListenToMore/1.0 (https://listentomore.com)';

/**
 * A Retry-After header in milliseconds: delay-seconds, or an HTTP date from now. Null when absent or unreadable.
 */
export function retryAfterMs(header: string | null, now: number = Date.now()): number | null {
  if (header === null) return null;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/**
 * Rate-limited fetch for MusicBrainz API.
 *
 * MusicBrainz enforces max 1 request per second. Exceeding this results in
 * IP-level blocking. The limiter serialises requests across Worker instances
 * and declines callers who would wait longer than MUSICBRAINZ_MAX_WAIT_MS.
 *
 * Pass `logUrl: false` when the endpoint carries a name (an artist or album in a search
 * query): the fetch is then logged by path only, without host or query string.
 *
 * Pass `followRedirects: false` when every network request must take its own limiter slot
 * and budget: a 3xx then fails as a MusicBrainzApiError instead of a second, unmetered request.
 */
export async function musicbrainzFetch(
  endpoint: string,
  limiter: MusicBrainzRateLimiter,
  options: { logUrl?: boolean; followRedirects?: boolean } = {}
): Promise<Response> {
  const { logUrl = true, followRedirects = true } = options;
  const waitMs = await limiter.reserve(MUSICBRAINZ_MAX_WAIT_MS);

  if (waitMs === null) {
    throw new MusicBrainzRateLimitError('queue_full');
  }

  if (waitMs > 0) {
    console.log(`[MusicBrainz] Rate limit: waiting ${waitMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const url = `${MUSICBRAINZ_API_BASE}${endpoint}`;
  console.log(`[MusicBrainz] Fetching: ${logUrl ? url : endpoint.split('?')[0]}`);

  const response = await fetchWithTimeout(url, {
    timeout: 'fast',
    redirect: followRedirects ? 'follow' : 'manual',
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json',
    },
  });

  if (response.status === 503) {
    console.error('[MusicBrainz] 503 Service Unavailable - rate limited or down');
    throw new MusicBrainzRateLimitError('upstream_503', retryAfterMs(response.headers.get('Retry-After')));
  }

  if (!response.ok) {
    console.error(`[MusicBrainz] API error: ${response.status} ${response.statusText}`);
    throw new MusicBrainzApiError(response.status, response.statusText, retryAfterMs(response.headers.get('Retry-After')));
  }

  return response;
}
