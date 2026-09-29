// ABOUTME: Tests for reserveSlot, the pure slot arithmetic behind the MusicBrainz Durable Object.
// ABOUTME: Guarantees 1100ms spacing and bounded waits for concurrent callers.

import { describe, it, expect } from 'vitest';
import { reserveSlot } from '../src/rate-limit';

const INTERVAL = 1100;
const MAX_WAIT = 5000;

describe('reserveSlot', () => {
  it('grants an idle limiter immediately', () => {
    expect(reserveSlot(0, 10_000, MAX_WAIT, INTERVAL)).toEqual({ waitMs: 0, nextSlotAt: 11_100 });
  });

  it('spaces back-to-back reservations by the interval', () => {
    const now = 10_000;
    const first = reserveSlot(0, now, MAX_WAIT, INTERVAL);
    const second = reserveSlot(first.nextSlotAt, now, MAX_WAIT, INTERVAL);
    const third = reserveSlot(second.nextSlotAt, now, MAX_WAIT, INTERVAL);

    expect([first.waitMs, second.waitMs, third.waitMs]).toEqual([0, 1100, 2200]);
    expect(third.nextSlotAt).toBe(now + 3300);
  });

  it('declines without changing state when the wait would exceed maxWaitMs', () => {
    const now = 10_000;
    const nextSlotAt = now + 5001;

    expect(reserveSlot(nextSlotAt, now, MAX_WAIT, INTERVAL)).toEqual({ waitMs: null, nextSlotAt });
  });

  it('accepts a wait exactly equal to maxWaitMs', () => {
    const now = 10_000;

    expect(reserveSlot(now + 5000, now, MAX_WAIT, INTERVAL)).toEqual({ waitMs: 5000, nextSlotAt: now + 6100 });
  });

  it('grants immediately once the reserved slot has passed', () => {
    expect(reserveSlot(9_000, 10_000, MAX_WAIT, INTERVAL)).toEqual({ waitMs: 0, nextSlotAt: 11_100 });
  });

  it('admits exactly five queued callers at 1100ms spacing before declining (burst of 7)', () => {
    const now = 10_000;
    let nextSlotAt = 0;
    const waits: Array<number | null> = [];
    for (let i = 0; i < 7; i++) {
      const result = reserveSlot(nextSlotAt, now, MAX_WAIT, INTERVAL);
      nextSlotAt = result.nextSlotAt;
      waits.push(result.waitMs);
    }

    expect(waits).toEqual([0, 1100, 2200, 3300, 4400, null, null]);
  });
});
