// ABOUTME: Drops likely duplicate scrobbles (two scrobblers, or a client resubmitting) before counting.
// ABOUTME: Follows spec section 2, "Dedupe"; deliberately differs from build.py on same-track copies.

import type { Scrobble } from './types';
import { norm } from './text';

const REPEAT_WINDOW_SECONDS = 600;
const SHORT_GAP_SECONDS = 150;
const NEAR_OFFSETS = [-2, -1, 0, 1, 2];

const trackKey = (s: Scrobble): string => `${norm(s.artist)}\u0000${norm(s.track)}`;

/**
 * Walking in time order, drops a scrobble when the last kept scrobble of the same artist and track
 * is under 10 minutes earlier and either the gap is under 150 s or either of the pair is "near" a
 * different track: one with another artist+track key scrobbled within 2 s (inclusive) of it.
 *
 * build.py also counts copies of the same track at the same second as "near", which drops real
 * replays when two scrobblers send every play (A, A at 1000 and A, A at 1240 became one play).
 * The spec says "another track", so same-track copies only fall to the under-150 s rule.
 */
export function dedupe(scrobbles: Scrobble[]): { kept: Scrobble[]; dropped: Scrobble[] } {
  const keysPerSecond = new Map<number, Set<string>>();
  for (const scrobble of scrobbles) {
    const keys = keysPerSecond.get(scrobble.ts) ?? new Set<string>();
    keys.add(trackKey(scrobble));
    keysPerSecond.set(scrobble.ts, keys);
  }
  const near = (ts: number, key: string): boolean =>
    NEAR_OFFSETS.some((d) => {
      const keys = keysPerSecond.get(ts + d);
      return keys !== undefined && (keys.size > 1 || !keys.has(key));
    });

  const kept: Scrobble[] = [];
  const dropped: Scrobble[] = [];
  const lastKept = new Map<string, Scrobble>();
  // Array.prototype.sort is stable, so equal timestamps keep their input order.
  for (const scrobble of [...scrobbles].sort((a, b) => a.ts - b.ts)) {
    const key = trackKey(scrobble);
    const previous = lastKept.get(key);
    if (previous) {
      const gap = scrobble.ts - previous.ts;
      if (gap < REPEAT_WINDOW_SECONDS && (gap < SHORT_GAP_SECONDS || near(scrobble.ts, key) || near(previous.ts, key))) {
        dropped.push(scrobble);
        continue;
      }
    }
    lastKept.set(key, scrobble);
    kept.push(scrobble);
  }
  return { kept, dropped };
}
