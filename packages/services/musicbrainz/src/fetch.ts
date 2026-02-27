// ABOUTME: Rate-limited fetch wrapper for MusicBrainz API.
// ABOUTME: Enforces 1 req/sec rate limit using KV-backed distributed state.

import { fetchWithTimeout } from '@listentomore/shared';

const MUSICBRAINZ_API_BASE = 'https://musicbrainz.org/ws/2';
const USER_AGENT = 'ListenToMore/1.0 (https://listentomore.com)';
const RATE_LIMIT_WINDOW_MS = 1100; // Slightly over 1 second for safety margin

export interface MusicBrainzRateLimitState {
  lastRequestTime: number;
}

/**
 * Rate-limited fetch for MusicBrainz API.
 *
 * MusicBrainz enforces max 1 request per second. Exceeding this results in
 * IP-level blocking. This wrapper uses KV to coordinate across Worker instances.
 */
export async function musicbrainzFetch(
  endpoint: string,
  cache: KVNamespace
): Promise<Response> {
  const cacheKey = 'musicbrainz:ratelimit:state';

  // Acquire rate limit slot
  const state = await cache.get<MusicBrainzRateLimitState>(cacheKey, 'json');
  const now = Date.now();

  if (state?.lastRequestTime) {
    const elapsed = now - state.lastRequestTime;
    if (elapsed < RATE_LIMIT_WINDOW_MS) {
      const waitMs = RATE_LIMIT_WINDOW_MS - elapsed;
      console.log(`[MusicBrainz] Rate limit: waiting ${waitMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  // Record this request time
  await cache.put(
    cacheKey,
    JSON.stringify({ lastRequestTime: Date.now() }),
    { expirationTtl: 10 } // Short TTL - only need to coordinate recent requests
  );

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
    throw new Error('MusicBrainz API rate limited (503)');
  }

  if (!response.ok) {
    console.error(`[MusicBrainz] API error: ${response.status} ${response.statusText}`);
    throw new Error(`MusicBrainz API error: ${response.status} ${response.statusText}`);
  }

  return response;
}
