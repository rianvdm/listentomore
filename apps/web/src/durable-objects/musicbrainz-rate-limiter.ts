// ABOUTME: Durable Object that spaces MusicBrainz requests across every Worker instance.
// ABOUTME: reserve() has no awaits, so each reservation is atomic; state is in memory only.

import { DurableObject } from 'cloudflare:workers';
import { reserveSlot, MUSICBRAINZ_INTERVAL_MS } from '@listentomore/musicbrainz';
import type { MusicBrainzRateLimiter } from '@listentomore/musicbrainz';

export class MusicBrainzRateLimiterDO extends DurableObject {
  // Resets to 0 on eviction. Callers already holding reservations (up to ~5,
  // bounded by maxWaitMs) can then overlap with new callers granted immediately.
  // The 1100ms spacing is between slot grants; callers with different RPC
  // round-trip times can reach MusicBrainz slightly closer together (the 100ms
  // margin absorbs typical skew).
  private nextSlotAt = 0;

  reserve(maxWaitMs: number): number | null {
    const result = reserveSlot(this.nextSlotAt, Date.now(), maxWaitMs, MUSICBRAINZ_INTERVAL_MS);
    this.nextSlotAt = result.nextSlotAt;
    return result.waitMs;
  }
}

/**
 * Adapt the global limiter instance to the musicbrainz package's interface.
 */
export function getMusicBrainzLimiter(
  namespace: DurableObjectNamespace<MusicBrainzRateLimiterDO>
): MusicBrainzRateLimiter {
  const stub = namespace.get(namespace.idFromName('global'));
  return {
    reserve: async (maxWaitMs: number) => stub.reserve(maxWaitMs),
  };
}
