// ABOUTME: Tests for strict artist/album name matching used by the name-based /lookup route.
// ABOUTME: A wrong match is worse than a miss, so near-misses (fragments, substrings, other artists) must return null.

import { describe, it, expect } from 'vitest';
import type { LookupAlbumCandidate } from '@listentomore/spotify';
import { normalizeName, stripEdition, pickAlbumMatch, pickArtistMatch } from '../../utils/lookup-match';

function album(name: string, artists: string | string[], id: string): LookupAlbumCandidate {
  return { id, name, artists: typeof artists === 'string' ? [artists] : artists };
}

describe('normalizeName', () => {
  it('normalizes case, accents, punctuation, ampersands and a leading "The"', () => {
    expect(normalizeName('The Cure')).toBe(normalizeName('cure'));
    expect(normalizeName('Sigur Rós')).toBe('sigur ros');
    expect(normalizeName('Guns N’ Roses')).toBe(normalizeName("Guns N' Roses"));
    expect(normalizeName('Simon & Garfunkel')).toBe(normalizeName('Simon and Garfunkel'));
    expect(normalizeName('AC/DC')).toBe(normalizeName('ACDC'));
    expect(normalizeName('坂本龍一')).toBe('坂本龍一');
  });

  it('drops a leading "The" even when the name is wrapped in punctuation', () => {
    expect(normalizeName('"The Cure"')).toBe(normalizeName('The Cure'));
  });

  it('keeps combining marks that distinguish words in non-Latin scripts', () => {
    expect(normalizeName('दिल')).not.toBe(normalizeName('दल'));
    expect(normalizeName('ポップ')).not.toBe(normalizeName('ホッフ'));
  });

  it('ignores emoji variation selectors and keycap marks', () => {
    expect(normalizeName('Love ❤️')).toBe(normalizeName('Love ❤'));
    expect(normalizeName('1️⃣ One')).toBe(normalizeName('1 One'));
    expect(normalizeName('❤️')).toBe('');
  });
});

describe('stripEdition', () => {
  it('strips edition suffixes', () => {
    expect(stripEdition('OK Computer (Remastered 2009)')).toBe('OK Computer');
    expect(stripEdition('Rumours [Super Deluxe Edition]')).toBe('Rumours');
    expect(stripEdition('Hunky Dory - 2015 Remaster')).toBe('Hunky Dory');
    expect(stripEdition('Unplugged - Live')).toBe('Unplugged');
    expect(stripEdition('Abbey Road')).toBe('Abbey Road');
    expect(stripEdition('Songs: Ohia')).toBe('Songs: Ohia');
    expect(stripEdition('Damnation (Deliverance)')).toBe('Damnation (Deliverance)');
    expect(stripEdition('Alive at Wembley - Live at Wembley Stadium')).toBe('Alive at Wembley - Live at Wembley Stadium');
  });

  it('only treats " - " as a suffix separator outside parentheses and brackets', () => {
    expect(stripEdition('Live (London - 1991)')).toBe('Live (London - 1991)');
    expect(stripEdition('Live (London - 1992)')).toBe('Live (London - 1992)');
    expect(stripEdition('Live [London - 1991]')).toBe('Live [London - 1991]');
  });
});

describe('pickAlbumMatch / pickArtistMatch', () => {
  it('never matches names that normalize to nothing', () => {
    expect(normalizeName('!!!')).toBe('');
    expect(pickArtistMatch([{ name: '???', id: 'q' }], '!!!')).toBeNull();
    expect(pickAlbumMatch([album('...', '!!!', 'x')], '!!!', '...')).toBeNull();
  });

  it('rejects a request that names only part of a comma-containing artist', () => {
    expect(pickAlbumMatch([album('Déjà Vu', ['Crosby, Stills, Nash & Young'], 'dv')], 'Stills', 'Deja Vu')).toBeNull();
  });

  it('rejects a lone result by a different artist', () => {
    expect(pickAlbumMatch([album('Ritual', 'Some Other Band', 'x')], 'Jon Hopkins', 'Ritual')).toBeNull();
  });

  it('rejects a non-Latin title that differs only by a combining mark', () => {
    expect(pickAlbumMatch([album('दल', 'Artist X', 'x')], 'Artist X', 'दिल')).toBeNull();
  });

  it('rejects a title that only contains the requested title', () => {
    expect(pickAlbumMatch([album('Voices 2', 'Max Richter', 'x')], 'Max Richter', 'Voices')).toBeNull();
  });

  it('does not match albums whose protected parentheticals differ', () => {
    expect(pickAlbumMatch([album('Live (London - 1992)', 'Some Band', 'x')], 'Some Band', 'Live (London - 1991)')).toBeNull();
  });

  it('prefers an exact title over an edition variant', () => {
    const r = pickAlbumMatch(
      [album('Rumours (Super Deluxe)', 'Fleetwood Mac', 'deluxe'), album('Rumours', 'Fleetwood Mac', 'base')],
      'Fleetwood Mac',
      'Rumours',
    );
    expect(r?.id).toBe('base');
  });

  it('matches an edition-suffixed request to the base album by the same artist', () => {
    expect(pickAlbumMatch([album('OK Computer', 'Radiohead', 'ok')], 'Radiohead', 'OK Computer (Remastered 2009)')?.id).toBe('ok');
  });

  it('matches when the requested artist is one of several credited artists', () => {
    expect(pickAlbumMatch([album('Watch the Throne', ['JAY-Z', 'Kanye West'], 'wtt')], 'Kanye West', 'Watch the Throne')?.id).toBe('wtt');
  });

  it('matches an artist name containing a comma as a whole', () => {
    expect(
      pickAlbumMatch([album('Déjà Vu', ['Crosby, Stills, Nash & Young'], 'dv')], 'Crosby, Stills, Nash & Young', 'Deja Vu')?.id,
    ).toBe('dv');
  });

  it('picks the artist whose normalized name matches, not the top hit', () => {
    const r = pickArtistMatch([{ name: 'Cure for Pain', id: 'a' }, { name: 'The Cure', id: 'b' }], 'The Cure');
    expect(r?.id).toBe('b');
  });

  it('returns null when no artist matches', () => {
    expect(pickArtistMatch([{ name: 'Cure for Pain', id: 'a' }], 'The Cure')).toBeNull();
  });
});
