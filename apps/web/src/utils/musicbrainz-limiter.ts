// ABOUTME: Adapts the MusicBrainz rate limiter Durable Object to the musicbrainz package's limiter interface.
// ABOUTME: Imports the Durable Object as a type only, so route modules that use it still load in Node.

import type { MusicBrainzRateLimiter } from '@listentomore/musicbrainz';
import type { MusicBrainzRateLimiterDO } from '../durable-objects/musicbrainz-rate-limiter';

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
