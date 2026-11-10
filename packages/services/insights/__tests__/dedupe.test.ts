// ABOUTME: Tests for scrobble dedupe - same-second pairs, short-gap repeats and real replays.
// ABOUTME: Follows spec section 2; same-track copies at one second do not count as near another track.

import { dedupe } from '../src';

const s = (track: string, ts: number, artist = 'A') => ({ artist, album: 'X', track, ts });

it('drops a same-second pair from two scrobblers', () => {
  expect(dedupe([s('Oceans', 1000), s('Oceans', 1000)]).kept).toHaveLength(1);
});

it('drops a repeat under 150 seconds', () => {
  expect(dedupe([s('Numb', 1000), s('Numb', 1100)]).dropped).toHaveLength(1);
});

it('keeps a real replay of a normal-length track', () => {
  expect(dedupe([s('Invincible', 1000), s('Invincible', 1420)]).kept).toHaveLength(2);
});

it('keeps repeats more than 10 minutes apart even when timestamps collide with other tracks', () => {
  expect(dedupe([s('Briefly', 1000), s('Other', 1000), s('Briefly', 2380)]).kept).toHaveLength(3);
});

it('drops a repeat within 10 minutes when either scrobble shares its second with another track', () => {
  expect(dedupe([s('Let There Be', 1000), s('Oceans', 1300), s('Let There Be', 1300)]).dropped.map((d) => d.track)).toEqual(['Let There Be']);
});

it('keeps a real replay when two scrobblers each sent both plays', () => {
  expect(dedupe([s('A', 1000), s('A', 1000), s('A', 1240), s('A', 1240)]).kept).toHaveLength(2);
});

it('drops a repeat whose timestamp is within 2 seconds of another track', () => {
  expect(dedupe([s('Same', 1000), s('Same', 1300), s('Other', 1302)]).dropped.map((d) => d.ts)).toEqual([1300]);
});

it('drops a repeat when the earlier scrobble is within 2 seconds of another track', () => {
  expect(dedupe([s('Other', 999), s('Same', 1000), s('Same', 1300)]).dropped.map((d) => d.ts)).toEqual([1300]);
});

it('keeps a repeat exactly 150 seconds later when no other track is near', () => {
  expect(dedupe([s('Same', 1000), s('Same', 1150)]).kept).toHaveLength(2);
});

it('keeps a repeat exactly 600 seconds later even when another track shares its second', () => {
  expect(dedupe([s('Same', 1000), s('Other', 1600), s('Same', 1600)]).kept).toHaveLength(3);
});
