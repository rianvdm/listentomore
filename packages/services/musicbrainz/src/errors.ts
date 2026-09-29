// ABOUTME: MusicBrainz rate-limit error and lookup failure logging.
// ABOUTME: Queue-full rejections are expected backpressure and log at warn; everything else is an error.

export type MusicBrainzRateLimitReason = 'queue_full' | 'upstream_503';

export class MusicBrainzRateLimitError extends Error {
  constructor(public reason: MusicBrainzRateLimitReason) {
    super(
      reason === 'queue_full'
        ? 'MusicBrainz rate limit queue full'
        : 'MusicBrainz API rate limited (503)'
    );
    this.name = 'MusicBrainzRateLimitError';
  }
}

/**
 * Log a failed lookup at the right level.
 */
export function logLookupFailure(context: string, error: unknown): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  if (error instanceof MusicBrainzRateLimitError && error.reason === 'queue_full') {
    console.warn(`[MusicBrainz] ${context}:`, errorMessage);
    return;
  }
  console.error(`[MusicBrainz] ${context}:`, errorMessage);
}
