// ABOUTME: Tests for title and name matching across Last.fm and Spotify - matchKey folding, edition markers
// ABOUTME: and stripEdition, which the release-week fact and its lookup read (spec section 2, "Release-week fact").

import { hasEditionMarker, matchKey, stripEdition } from '../src';

describe('matchKey', () => {
  it('folds hyphens, accents, ampersands, case and punctuation', () => {
    expect(matchKey('Justin Meldal‐Johnsen')).toBe(matchKey('Justin Meldal-Johnsen'));
    expect(matchKey('Sigur Rós')).toBe('sigur ros');
    expect(matchKey('Tom Petty & The Heartbreakers')).toBe(matchKey('Tom Petty and the Heartbreakers'));
    expect(matchKey('  i,  i ')).toBe('i i');
  });
});

describe('hasEditionMarker', () => {
  it('finds the markers as whole words, in any case', () => {
    for (const title of ['In Rainbows (Remastered)', 'Inferno - 2023 Remaster', 'X (Deluxe Edition)', 'OK Computer OKNOTOK Reissue',
      'Pablo Honey (Expanded)', '10th Anniversary', 'Loveless (Alternative Master)']) {
      expect(hasEditionMarker(title), title).toBe(true);
    }
    for (const title of ['Eternal Embers', 'Remasters of the Universe', 'Editions of You', "(What's the Story) Morning Glory?"]) {
      expect(hasEditionMarker(title), title).toBe(false);
    }
  });
});

describe('stripEdition', () => {
  it('drops trailing segments that carry a marker, repeatedly', () => {
    expect(stripEdition('In Rainbows (Remastered)')).toBe('In Rainbows');
    expect(stripEdition('Inferno - 2023 Remaster')).toBe('Inferno');
    expect(stripEdition('Loveless [Deluxe Edition] (2021 Remaster)')).toBe('Loveless');
    expect(stripEdition("(What's the Story) Morning Glory?")).toBe("(What's the Story) Morning Glory?");
    expect(stripEdition('Live at Leeds (Live)')).toBe('Live at Leeds (Live)');
  });
});
