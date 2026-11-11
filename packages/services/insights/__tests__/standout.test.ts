// ABOUTME: Tests for standoutAlbum - the album of the week's highest-ranked album fact in the top three, read from
// ABOUTME: how each fact kind records its album, never an artist name standing in for one.

import { buildWeekFacts, standoutAlbum } from '../src';
import type { AlbumRef, Fact, FactKind, Quantity, WeekFacts } from '../src';
import { loadFixture } from './helpers';

const may24 = buildWeekFacts(loadFixture('bordesak-2026-05-24'));

/** A ranked fact with only the fields standoutAlbum reads filled in. */
const fact = (
  kind: FactKind, subject: string | null, statement: string, entities: string[], quantities: Quantity[] = [], albums: AlbumRef[] = [],
): Omit<Fact, 'id'> => ({
  kind, salience: 80, subject, statement, entities, albums, quantities, dates: [], edges: [],
});
/** `may24` with its facts replaced by these, ranked in the order given. */
const week = (...facts: Array<Omit<Fact, 'id'>>): WeekFacts => ({ ...may24, facts: facts.map((f, i) => ({ ...f, id: i + 1 })) });

const cluster = fact('genre_cluster', 'jazz', 'Four jazz artists came back in one week.', ['Wes Montgomery', 'Joe Henderson']);
const faded = fact('last_week_faded', null, "Last week's top artists dropped away: ODESZA.", ['ODESZA']);
const repeat = fact(
  'repeat_album', 'Meltt', 'Eternal Embers by Meltt played start to finish 2 times (Tue Nov 3, Wed Nov 4), 31 plays of Meltt this week.',
  ['Eternal Embers', 'Meltt'],
  [{ value: 2, unit: 'times', entity: 'Eternal Embers' }, { value: 31, unit: 'plays', entity: 'Meltt' }],
);

describe('standoutAlbum', () => {
  it('reads the absorbed album of a volume fact in a real week', () => {
    // May 24's fact 1 is the jazz cluster; fact 2 is Boards of Canada's Friday, which absorbed the Inferno listen.
    expect(may24.facts[0].kind).toBe('genre_cluster');
    expect(standoutAlbum(may24)).toEqual({ artist: 'Boards of Canada', album: 'Inferno' });
  });

  it('takes the highest-ranked album fact, reading the album from a repeat album fact (album first, then artist)', () => {
    const single = fact(
      'single_listen', 'Seefeel', 'Seefeel on Tue Nov 3: Quique start to finish in one run.', ['Seefeel', 'Quique'],
      [{ value: 1, unit: 'times', entity: 'Quique' }],
    );
    expect(standoutAlbum(week(cluster, repeat, single))).toEqual({ artist: 'Meltt', album: 'Eternal Embers' });
    expect(standoutAlbum(week(cluster, single, repeat))).toEqual({ artist: 'Seefeel', album: 'Quique' });
  });

  it('reads a single listen of a part-played album (artist first, then album)', () => {
    const run = fact(
      'single_listen', 'Celer', 'Celer on Fri Jun 19: 36 tracks in a row from Capri in one run.', ['Celer', 'Capri'],
      [{ value: 36, unit: 'tracks', entity: 'Capri' }, { value: 1, unit: 'times', entity: 'Capri' }],
    );
    expect(standoutAlbum(week(run))).toEqual({ artist: 'Celer', album: 'Capri' });
  });

  it('skips a volume fact that absorbed no album: its only entity is the artist', () => {
    const volume = fact(
      'volume_vs_normal', 'U2', 'U2: 36 plays this week against an average of 2 per week over the previous 12 weeks.', ['U2'],
      [{ value: 36, unit: 'plays', entity: 'U2' }, { value: 2, unit: 'plays', entity: 'U2' }, { value: 12, unit: 'weeks' }],
    );
    expect(standoutAlbum(week(volume, cluster, faded))).toBeNull();
    expect(standoutAlbum(week(volume, repeat))).toEqual({ artist: 'Meltt', album: 'Eternal Embers' });
  });

  it('reads the first album of a chain and the artist in brackets after it', () => {
    const chain = fact(
      'album_chain', null, 'Sat Jun 6: 2 albums back to back, start to finish: Hysteria (Def Leppard), A La Sala (Khruangbin).',
      ['Hysteria', 'Def Leppard', 'A La Sala', 'Khruangbin'], [{ value: 2, unit: 'albums' }],
    );
    expect(standoutAlbum(week(cluster, chain))).toEqual({ artist: 'Def Leppard', album: 'Hysteria' });
  });

  it('keeps a self-titled album, whose name the builder records once', () => {
    const selfTitled = fact(
      'repeat_album', 'Weezer', 'Weezer by Weezer played start to finish 2 times (Mon Nov 2), 20 plays of Weezer this week.',
      ['Weezer'], [{ value: 2, unit: 'times', entity: 'Weezer' }, { value: 20, unit: 'plays', entity: 'Weezer' }],
    );
    expect(standoutAlbum(week(selfTitled))).toEqual({ artist: 'Weezer', album: 'Weezer' });
    const chain = fact(
      'album_chain', null, 'Mon Nov 2: 2 albums back to back, start to finish: Weezer (Weezer), Pinkerton (Weezer).',
      ['Weezer', 'Pinkerton'], [{ value: 2, unit: 'albums' }],
    );
    expect(standoutAlbum(week(chain))).toEqual({ artist: 'Weezer', album: 'Weezer' });
  });

  it('reads a release-week fact\'s recorded album', () => {
    const released = fact(
      'release_week', 'Seefeel', 'Quique by Seefeel came out on Mon Nov 2, and you played it start to finish that day.',
      ['Quique', 'Seefeel'], [], [{ artist: 'Seefeel', album: 'Quique' }],
    );
    expect(standoutAlbum(week(cluster, released, repeat))).toEqual({ artist: 'Seefeel', album: 'Quique' });
    expect(standoutAlbum({ facts: [{ ...released, albums: [], id: 1 }] })).toBeNull();
  });

  it('looks only at the top three facts', () => {
    expect(standoutAlbum(week(cluster, faded, cluster, repeat))).toBeNull();
    expect(standoutAlbum(week())).toBeNull();
  });
});
