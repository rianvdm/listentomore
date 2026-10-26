// ABOUTME: Spotify-bound defer helper that moves non-critical KV writes off the response path.
// ABOUTME: Wraps the shared helper so deferred-write failures log with the [Spotify] prefix.

import { createServiceDefer } from '@listentomore/shared';
import type { Defer, WaitUntil } from '@listentomore/shared';

export type { Defer, WaitUntil };

/** Create a defer helper bound to the request's waitUntil (see createServiceDefer). */
export function createDefer(waitUntil?: WaitUntil): Defer {
  return createServiceDefer('[Spotify]', waitUntil);
}
