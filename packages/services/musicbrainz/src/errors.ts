// ABOUTME: MusicBrainz rate-limit and API errors, and lookup failure logging.
// ABOUTME: Rate-limit failures log at warn (fetch.ts already logs each 503 once); everything else is an error.

export type MusicBrainzRateLimitReason = 'queue_full' | 'upstream_503';

export class MusicBrainzRateLimitError extends Error {
  /** `retryAfterMs`: the response's Retry-After in milliseconds, or null when absent or unreadable. */
  constructor(public reason: MusicBrainzRateLimitReason, public retryAfterMs: number | null = null) {
    super(
      reason === 'queue_full'
        ? 'MusicBrainz rate limit queue full'
        : 'MusicBrainz API rate limited (503)'
    );
    this.name = 'MusicBrainzRateLimitError';
  }
}

/**
 * A non-OK MusicBrainz response other than 503; `status` lets callers treat a 404 as a miss. `retryAfterMs` is the
 * response's Retry-After in milliseconds, or null when absent or unreadable.
 */
export class MusicBrainzApiError extends Error {
  constructor(public status: number, statusText: string, public retryAfterMs: number | null = null) {
    super(`MusicBrainz API error: ${status} ${statusText}`);
    this.name = 'MusicBrainzApiError';
  }
}

/**
 * Log a failed lookup at the right level.
 *
 * Queue-full rejections are expected backpressure. Upstream 503s are already
 * logged at error with a fixed message in musicbrainzFetch, so Workers
 * Observability Issues groups them into one issue. Logging the per-album
 * context at error too would open a new issue for every album.
 */
export function logLookupFailure(context: string, error: unknown): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  if (error instanceof MusicBrainzRateLimitError) {
    console.warn(`[MusicBrainz] ${context}:`, errorMessage);
    return;
  }
  console.error(`[MusicBrainz] ${context}:`, errorMessage);
}
