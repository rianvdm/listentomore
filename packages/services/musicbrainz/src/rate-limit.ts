// ABOUTME: Slot reservation for spacing MusicBrainz requests (max 1/sec per their API rules).
// ABOUTME: Pure so it tests in node; the web Worker's Durable Object holds the state.

/** Spacing between MusicBrainz requests (slightly over 1s for safety). */
export const MUSICBRAINZ_INTERVAL_MS = 1100;

/** Longest a caller will queue before giving up on MusicBrainz enrichment. */
export const MUSICBRAINZ_MAX_WAIT_MS = 5000;

export interface SlotReservation {
  /** Milliseconds to wait before requesting, or null if declined. */
  waitMs: number | null;
  /** Earliest time the next caller may request. */
  nextSlotAt: number;
}

/**
 * Something that hands out MusicBrainz request slots.
 * Implemented in production by a Durable Object so all Worker instances share one queue.
 */
export interface MusicBrainzRateLimiter {
  reserve(maxWaitMs: number): Promise<number | null>;
}

/**
 * Reserve the next request slot. Declines (state unchanged) when the wait would exceed maxWaitMs.
 */
export function reserveSlot(
  nextSlotAt: number,
  now: number,
  maxWaitMs: number,
  intervalMs: number
): SlotReservation {
  const slot = Math.max(now, nextSlotAt);
  const waitMs = slot - now;

  if (waitMs > maxWaitMs) {
    return { waitMs: null, nextSlotAt };
  }

  return { waitMs, nextSlotAt: slot + intervalMs };
}
