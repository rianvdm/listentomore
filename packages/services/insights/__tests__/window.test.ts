// ABOUTME: Tests for week windows, UTC day partitions, owner-timezone labels and name normalisation.
// ABOUTME: Fixed timestamps around the Nov 1 2026 US DST change keep the cases deterministic.

import { weekWindow, utcDays, dayLabel, timeLabel, localDate, tsOnLocalDate, norm } from '../src';

const T = Date.UTC(2026, 10, 8, 21, 17, 0) / 1000; // Sun Nov 8 2026 13:17 PST

it('weeks are half-open 168-hour intervals', () => {
  expect(weekWindow(T)).toEqual({ from: T - 604800, to: T });
  expect(weekWindow(T, 1)).toEqual({ from: T - 1209600, to: T - 604800 });
});

it('lists every UTC day the interval touches', () => {
  expect(utcDays(T - 604800, T)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
});

it('labels in the owner timezone', () => {
  expect(dayLabel(T, 'America/Los_Angeles')).toBe('Sun Nov 8');
  expect(timeLabel(T, 'America/Los_Angeles')).toBe('1:17 PM');
});

it('labels fall back to UTC dates when timezone is null', () => {
  expect(dayLabel(T, null)).toBe('Sun Nov 8');
  expect(timeLabel(T, null)).toBeNull();
});

it('a week spanning a DST change is still 168 hours', () => {
  const afterDst = Date.UTC(2026, 10, 3, 12, 0, 0) / 1000; // US DST ended Nov 1 2026
  const w = weekWindow(afterDst);
  expect(w.to - w.from).toBe(604800);
  expect(dayLabel(w.from, 'America/Los_Angeles')).toBe('Tue Oct 27');
});

it('norm folds case, width and hyphens', () => {
  expect(norm('  A‐HA  ')).toBe('a-ha');
  expect(norm('Sigur  Rós')).toBe('sigur rós');
});

it('local dates follow the owner timezone, and UTC when it is null', () => {
  expect(localDate(T, null)).toBe('2026-11-08');
  expect(localDate(Date.UTC(2026, 10, 9, 3, 0, 0) / 1000, 'America/Los_Angeles')).toBe('2026-11-08');
  expect(localDate(Date.UTC(2026, 10, 9, 3, 0, 0) / 1000, null)).toBe('2026-11-09');
});

it('finds the first whole hour of a date inside [from, to)', () => {
  const from = T - 604800; // Sun Nov 1 21:17 UTC
  expect(tsOnLocalDate('2026-11-01', null, from, T)).toBe(Date.UTC(2026, 10, 1, 22, 0, 0) / 1000);
  expect(tsOnLocalDate('2026-11-03', null, from, T)).toBe(Date.UTC(2026, 10, 3, 0, 0, 0) / 1000);
  // Midnight in Los Angeles on Nov 3 is 08:00 UTC.
  expect(tsOnLocalDate('2026-11-03', 'America/Los_Angeles', from, T)).toBe(Date.UTC(2026, 10, 3, 8, 0, 0) / 1000);
  // Outside the range, or no whole hour of the date left in it.
  expect(tsOnLocalDate('2026-10-30', null, from, T)).toBeNull();
  expect(tsOnLocalDate('2026-11-08', null, from, Date.UTC(2026, 10, 8, 0, 0, 0) / 1000)).toBeNull();
});
