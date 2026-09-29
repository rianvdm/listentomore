// ABOUTME: Tests for isSpotifyId, which gates artist/album detail routes.
// ABOUTME: Legacy slug URLs must be rejected before they reach the Spotify API.

import { describe, it, expect } from 'vitest';
import { isSpotifyId } from '@listentomore/shared';

describe('isSpotifyId', () => {
  it('accepts a real 22-character base62 Spotify ID', () => {
    expect(isSpotifyId('4Z8W4fKeB5YxbusRsdQVPb')).toBe(true);
    expect(isSpotifyId('0k17h0D3J5VfsdmQ1iZtE9')).toBe(true);
  });

  it('rejects legacy artist slugs', () => {
    expect(isSpotifyId('the-grateful-dead')).toBe(false);
    expect(isSpotifyId('theaudience')).toBe(false);
    expect(isSpotifyId("dali's-dilemma")).toBe(false);
  });

  it('rejects legacy album slugs', () => {
    expect(isSpotifyId('radiohead_pablo-honey')).toBe(false);
    expect(isSpotifyId('colter-wall_western-swing-%26-waltzes-and-other-punchy-songs')).toBe(false);
    expect(isSpotifyId('wham!_last-christmas')).toBe(false);
  });

  it('rejects strings of the wrong length', () => {
    expect(isSpotifyId('4Z8W4fKeB5YxbusRsdQVP')).toBe(false); // 21
    expect(isSpotifyId('4Z8W4fKeB5YxbusRsdQVPbX')).toBe(false); // 23
    expect(isSpotifyId('')).toBe(false);
  });

  it('rejects 22-character strings containing non-base62 characters', () => {
    expect(isSpotifyId('4Z8W4fKeB5Yxbus-sdQVPb')).toBe(false);
    expect(isSpotifyId('4Z8W4fKeB5Yxbus_sdQVPb')).toBe(false);
  });

  it('treats any 22 alphanumeric characters as an ID (Spotify is the authority beyond shape)', () => {
    expect(isSpotifyId('radioheadpablohoneyabc')).toBe(true);
  });
});
