// ABOUTME: Spotify-specific fetch with rate limiting and retry logic.
// ABOUTME: Wraps fetchWithTimeout with 429 handling and distributed rate limiting.

import { fetchWithTimeout, FetchWithTimeoutOptions } from '@listentomore/shared';
import { RATE_LIMITS } from '@listentomore/config';
import type { SpotifyRateLimiter } from './rate-limit';

/**
 * Make a rate-limited request to the Spotify API with automatic retry on 429.
 * 
 * @param url - The Spotify API URL to fetch
 * @param options - Fetch options including timeout
 * @param rateLimiter - The shared rate limiter instance
 * @returns The fetch Response
 */
export async function spotifyFetch(
  url: string,
  options: FetchWithTimeoutOptions,
  rateLimiter: SpotifyRateLimiter
): Promise<Response> {
  const maxRetries = RATE_LIMITS.spotify.maxRetries;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Acquire rate limit token before request
    await rateLimiter.acquire();

    const response = await fetchWithTimeout(url, options);

    if (response.status !== 429) {
      return response;
    }

    // Handle 429 response
    const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
    await rateLimiter.recordRateLimitResponse(retryAfter);

    if (attempt === maxRetries) {
      console.error(`[Spotify] Max retries (${maxRetries}) exceeded for ${url}`);
      return response; // Return 429 to caller
    }

    // Wait before retry (capped at 10 seconds to avoid blocking too long)
    const waitMs = Math.min(retryAfter * 1000, 10000);
    console.log(`[Spotify] Retry ${attempt + 1}/${maxRetries} after ${waitMs}ms for ${url}`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  // This should never be reached due to the return in the loop
  throw new Error('Unreachable: spotifyFetch retry loop exited unexpectedly');
}
