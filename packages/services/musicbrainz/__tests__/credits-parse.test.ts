// ABOUTME: Tests for the pure MusicBrainz credits parsers: release-group and release picking,
// ABOUTME: release credits at release, recording and track level, and artist band links.

import { describe, it, expect } from 'vitest';
import {
  pickReleaseGroup,
  pickEarliestOfficial,
  parseReleaseCredits,
  parseArtistBands,
} from '../src/credits-parse';

const BECK = { id: 'beck', name: 'Beck' };

function artistCredit(...artists: Array<{ id: string; name: string }>) {
  return artists.map((artist) => ({ name: artist.name, joinphrase: '', artist }));
}

function artistRel(type: string, artist: { id: string; name: string }, extra: Record<string, unknown> = {}) {
  return { type, 'target-type': 'artist', direction: 'backward', attributes: [], artist, ...extra };
}

function bandRel(direction: 'forward' | 'backward', id: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'member of band',
    'target-type': 'artist',
    direction,
    attributes: [],
    artist: { id, name: id },
    ...extra,
  };
}

function searchOf(...groups: Array<{ id: string; score: number; title: string; 'primary-type'?: string }>) {
  return { created: '2026-11-10T00:00:00.000Z', count: groups.length, offset: 0, 'release-groups': groups };
}

describe('pickReleaseGroup', () => {
  it('picks the best-scoring release group whose folded title matches, preferring albums', () => {
    const search = searchOf(
      { id: 'rg-single', score: 100, title: 'Sea Change', 'primary-type': 'Single' },
      { id: 'rg-album', score: 95, title: 'Sea Change', 'primary-type': 'Album' },
    );
    expect(pickReleaseGroup(search, 'Sea Change')).toBe('rg-album');

    const lowScores = searchOf({ id: 'rg-low', score: 89, title: 'Sea Change', 'primary-type': 'Album' });
    expect(pickReleaseGroup(lowScores, 'Sea Change')).toBeNull();

    const otherTitle = searchOf({ id: 'rg-other', score: 100, title: 'Sea Change Live', 'primary-type': 'Album' });
    expect(pickReleaseGroup(otherTitle, 'Sea Change')).toBeNull();
  });

  it('prefers the higher score among matching albums', () => {
    const search = searchOf(
      { id: 'rg-a', score: 92, title: 'Sea Change', 'primary-type': 'Album' },
      { id: 'rg-b', score: 98, title: 'Sea Change', 'primary-type': 'Album' },
    );
    expect(pickReleaseGroup(search, 'Sea Change')).toBe('rg-b');
  });

  it('matches titles across case, accents, punctuation and compatibility forms', () => {
    const search = searchOf(
      { id: 'rg-condor', score: 100, title: 'Los Ojos Del Cóndor', 'primary-type': 'Album' },
      { id: 'rg-ok', score: 100, title: 'OK Computer', 'primary-type': 'Album' },
    );
    expect(pickReleaseGroup(search, 'los ojos del condor')).toBe('rg-condor');
    expect(pickReleaseGroup(search, 'Ｏｋ  computer!')).toBe('rg-ok');
  });

  it('keeps non-Latin titles distinct', () => {
    const search = searchOf({ id: 'rg-jp', score: 100, title: '風街ろまん', 'primary-type': 'Album' });
    expect(pickReleaseGroup(search, '風街ろまん')).toBe('rg-jp');
    expect(pickReleaseGroup(search, 'ほかの題')).toBeNull();
  });

  it('returns null for an empty or malformed search', () => {
    expect(pickReleaseGroup(searchOf(), 'Sea Change')).toBeNull();
    expect(pickReleaseGroup({}, 'Sea Change')).toBeNull();
    expect(pickReleaseGroup(null, 'Sea Change')).toBeNull();
  });
});

describe('pickEarliestOfficial', () => {
  it('picks the earliest dated official release', () => {
    const group = {
      id: 'rg',
      releases: [
        { id: 'r-oct', status: 'Official', date: '2002-10-01' },
        { id: 'r-bootleg', status: 'Bootleg', date: '2002-01-01' },
        { id: 'r-sep', status: 'Official', date: '2002-09-24' },
        { id: 'r-promo', status: 'Promotion', date: '2002-09-01' },
      ],
    };
    expect(pickEarliestOfficial(group)).toBe('r-sep');
  });

  it('takes an undated official release only when none has a date', () => {
    const mixed = {
      releases: [
        { id: 'r-undated', status: 'Official' },
        { id: 'r-dated', status: 'Official', date: '2010' },
      ],
    };
    expect(pickEarliestOfficial(mixed)).toBe('r-dated');

    const undated = { releases: [{ id: 'r-undated', status: 'Official', date: '' }] };
    expect(pickEarliestOfficial(undated)).toBe('r-undated');
  });

  it('returns null with no official release', () => {
    expect(pickEarliestOfficial({ releases: [{ id: 'r', status: 'Bootleg', date: '2001' }] })).toBeNull();
    expect(pickEarliestOfficial({ releases: [] })).toBeNull();
    expect(pickEarliestOfficial({})).toBeNull();
  });
});

describe('parseReleaseCredits', () => {
  it('reads a release with no relations as no credits', () => {
    expect(parseReleaseCredits({ id: 'r1', 'artist-credit': artistCredit(BECK), media: [] })).toEqual({
      releaseId: 'r1',
      artists: [BECK],
      credits: [],
    });
  });

  it('reads release-level, recording-level and track credits once each', () => {
    const godrich = { id: 'godrich', name: 'Nigel Godrich' };
    const jmj = { id: 'jmj', name: 'Justin Meldal‐Johnsen' };
    const guest = { id: 'guest', name: 'Guest Singer' };
    const bass = artistRel('instrument', jmj, { attributes: ['bass guitar'] });
    const release = {
      id: 'r1',
      'artist-credit': artistCredit(BECK),
      relations: [artistRel('producer', godrich)],
      media: [
        {
          tracks: [
            { id: 't1', 'artist-credit': artistCredit(BECK), recording: { id: 'rec1', relations: [bass] } },
            {
              id: 't2',
              'artist-credit': artistCredit(BECK, guest),
              recording: { id: 'rec2', relations: [{ ...bass }] },
            },
            { id: 't3', 'artist-credit': artistCredit(BECK, guest), recording: { id: 'rec3' } },
          ],
        },
      ],
    };

    const parsed = parseReleaseCredits(release);

    expect(parsed.artists).toEqual([BECK]);
    expect(parsed.credits).toEqual([
      { artist: godrich, type: 'producer', attributes: [], level: 'release' },
      { artist: jmj, type: 'instrument', attributes: ['bass guitar'], level: 'recording' },
      { artist: guest, type: 'performer', attributes: [], level: 'track' },
    ]);
  });

  it('keeps one person under different roles and attribute sets', () => {
    const person = { id: 'p', name: 'Multi' };
    const release = {
      id: 'r1',
      'artist-credit': artistCredit(BECK),
      relations: [
        artistRel('instrument', person, { attributes: ['guitar', 'bass guitar'] }),
        artistRel('instrument', person, { attributes: ['bass guitar', 'guitar'] }),
        artistRel('instrument', person, { attributes: ['drums'] }),
        artistRel('producer', person),
      ],
    };

    expect(parseReleaseCredits(release).credits.map((c) => [c.type, c.attributes])).toEqual([
      ['instrument', ['guitar', 'bass guitar']],
      ['instrument', ['drums']],
      ['producer', []],
    ]);
  });

  it('skips relations whose target is not an artist', () => {
    const release = {
      id: 'r1',
      'artist-credit': artistCredit(BECK),
      relations: [{ type: 'mastered in', 'target-type': 'place', place: { id: 'pl', name: 'Studio' } }],
    };
    expect(parseReleaseCredits(release).credits).toEqual([]);
  });
});

describe('parseArtistBands', () => {
  it('keeps member-of-band links forward as memberOf and backward as members', () => {
    const artist = {
      id: 'a1',
      name: 'Thom Yorke',
      type: 'Person',
      relations: [
        bandRel('forward', 'radiohead'),
        bandRel('forward', 'the-smile', { ended: false }),
        bandRel('forward', 'old-band', { ended: true }),
        bandRel('backward', 'member-1', { ended: true }),
      ],
    };

    expect(parseArtistBands(artist)).toEqual({
      artist: { id: 'a1', name: 'Thom Yorke' },
      type: 'Person',
      memberOf: [
        { band: { id: 'radiohead', name: 'radiohead' }, ended: false },
        { band: { id: 'the-smile', name: 'the-smile' }, ended: false },
        { band: { id: 'old-band', name: 'old-band' }, ended: true },
      ],
      members: [{ person: { id: 'member-1', name: 'member-1' }, ended: true }],
    });
  });

  it('drops supporting-musician links and any link with a touring attribute', () => {
    const artist = {
      id: 'a1',
      name: 'Drummer',
      relations: [
        bandRel('forward', 'b1'),
        bandRel('forward', 'b2', { attributes: ['touring'] }),
        { ...bandRel('forward', 'b3'), type: 'supporting musician' },
        bandRel('backward', 'b4', { attributes: ['Touring'] }),
      ],
    };

    const bands = parseArtistBands(artist);

    expect(bands.memberOf).toEqual([{ band: { id: 'b1', name: 'b1' }, ended: false }]);
    expect(bands.members).toEqual([]);
  });

  it('merges repeat stints in one band, current if any stint is current', () => {
    const artist = {
      id: 'a1',
      name: 'Josh Klinghoffer',
      relations: [bandRel('forward', 'rhcp', { ended: true }), bandRel('forward', 'rhcp', { ended: false })],
    };
    expect(parseArtistBands(artist).memberOf).toEqual([{ band: { id: 'rhcp', name: 'rhcp' }, ended: false }]);
  });

  it('reads an artist with no relations as empty lists', () => {
    expect(parseArtistBands({ id: 'a1', name: 'Celer' })).toEqual({
      artist: { id: 'a1', name: 'Celer' },
      type: null,
      memberOf: [],
      members: [],
    });
  });
});
