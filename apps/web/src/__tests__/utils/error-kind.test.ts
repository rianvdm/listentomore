// ABOUTME: Tests for errorKind: known error classes are logged by name, and any other name or throw is 'other'.
// ABOUTME: An error's name is free text, so a made-up one must never reach a log line.

import { describe, it, expect } from 'vitest';
import { CreditsCapReached, MusicBrainzApiError, MusicBrainzRateLimitError } from '@listentomore/musicbrainz';
import { InsightsFetchError } from '@listentomore/insights';
import { errorKind } from '../../utils/error-kind';

describe('errorKind', () => {
  it('names the known error classes', () => {
    expect(errorKind(new Error('x'))).toBe('Error');
    expect(errorKind(new TypeError('x'))).toBe('TypeError');
    expect(errorKind(new SyntaxError('x'))).toBe('SyntaxError');
    expect(errorKind(new CreditsCapReached())).toBe('CreditsCapReached');
    expect(errorKind(new MusicBrainzApiError(500, 'x'))).toBe('MusicBrainzApiError');
    expect(errorKind(new MusicBrainzRateLimitError('queue_full'))).toBe('MusicBrainzRateLimitError');
    expect(errorKind(new InsightsFetchError('x'))).toBe('InsightsFetchError');
  });

  it("reads a made-up name or a non-Error throw as 'other'", () => {
    const error = new Error('x');
    error.name = 'QuillonVarga';
    expect(errorKind(error)).toBe('other');
    expect(errorKind(Object.assign(new Error('x'), { name: 'error' }))).toBe('other');
    expect(errorKind('QuillonVarga')).toBe('other');
    expect(errorKind({ name: 'TypeError' })).toBe('other');
    expect(errorKind(null)).toBe('other');
  });

  /** An error whose name reads 'Error' the first time and the sentinel on every later read. */
  const SENTINEL = 'QuillonVarga';
  class ShiftingNameError extends Error {
    private reads = 0;
    override get name(): string {
      this.reads += 1;
      return this.reads === 1 ? 'Error' : SENTINEL;
    }
  }
  const shiftingOwnAccessor = (): Error => {
    const error = new Error('x');
    let reads = 0;
    Object.defineProperty(error, 'name', { get: () => (++reads === 1 ? 'Error' : SENTINEL), configurable: true });
    return error;
  };

  it('reads name once, so a getter that changes between reads never returns the sentinel', () => {
    for (const error of [new ShiftingNameError('x'), shiftingOwnAccessor()]) {
      const kind = errorKind(error);
      expect(kind).not.toBe(SENTINEL);
      expect(['Error', 'other']).toContain(kind);
    }
    // A getter that starts with the sentinel never passes the check.
    const sentinelFirst = new Error('x');
    let reads = 0;
    Object.defineProperty(sentinelFirst, 'name', { get: () => (++reads === 1 ? SENTINEL : 'Error') });
    expect(errorKind(sentinelFirst)).toBe('other');
  });

  it("reads a throwing name getter, or a name that is not a string, as 'other'", () => {
    const throwing = new Error('x');
    Object.defineProperty(throwing, 'name', { get: () => { throw new Error(SENTINEL); } });
    expect(errorKind(throwing)).toBe('other');
    expect(errorKind(Object.assign(new Error('x'), { name: 42 }))).toBe('other');
  });
});
