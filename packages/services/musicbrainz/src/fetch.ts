// ABOUTME: Rate-limited fetch wrapper for MusicBrainz API.
// ABOUTME: Takes a slot from a shared limiter (Durable Object in production) before each request.

import { fetchWithTimeout } from '@listentomore/shared';
import { MusicBrainzRateLimitError } from './errors';
import { MUSICBRAINZ_MAX_WAIT_MS } from './rate-limit';
import type { MusicBrainzRateLimiter } from './rate-limit';

const MUSICBRAINZ_API_BASE = 'https://musicbrainz.org/ws/2';
const USER_AGENT = 'ListenToMore/1.0 (https://listentomore.com)';

/**
 * Rate-limited fetch for MusicBrainz API.
 *
 * MusicBrainz enforces max 1 request per second. Exceeding this results in
 * IP-level blocking. The limiter serialises requests across Worker instances
 * and declines callers who would wait longer than MUSICBRAINZ_MAX_WAIT_MS.
 */
export async function musicbrainzFetch(
  endpoint: string,
  limiter: MusicBrainzRateLimiter
): Promise<Response> {
  const waitMs = await limiter.reserve(MUSICBRAINZ_MAX_WAIT_MS);

  if (waitMs === null) {
    throw new MusicBrainzRateLimitError('queue_full');
  }

  if (waitMs > 0) {
    console.log(`[MusicBrainz] Rate limit: waiting ${waitMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const url = `${MUSICBRAINZ_API_BASE}${endpoint}`;
  console.log(`[MusicBrainz] Fetching: ${url}`);

  const response = await fetchWithTimeout(url, {
    timeout: 'fast',
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json',
    },
  });

  if (response.status === 503) {
    console.error('[MusicBrainz] 503 Service Unavailable - rate limited or down');
    throw new MusicBrainzRateLimitError('upstream_503');
  }

  if (!response.ok) {
    console.error(`[MusicBrainz] API error: ${response.status} ${response.statusText}`);
    throw new Error(`MusicBrainz API error: ${response.status} ${response.statusText}`);
  }

  return response;
}
