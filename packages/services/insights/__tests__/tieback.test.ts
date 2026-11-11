// ABOUTME: Tests for credit tie-backs: who on a record counts, which library bands they tie back to at 10+ plays,
// ABOUTME: the order and grouping of tie-backs, the eligibility key and the rendered templates (spec section 1).

import type { ArtistBands, Credit, CreditArtist, ReleaseCredits } from '@listentomore/musicbrainz';
import { checkCopyRubric, eligibilityKey, libraryFrom, peopleToCheck, renderTieBack, selectTieBacks } from '../src';
import type { CardAlbum, CreditedPerson, TieBack, TieBackInput, Viewer } from '../src';

const guest = (id: string, name: string, type: string, attributes: string[] = []): Credit => ({
  artist: { id, name },
  type,
  attributes,
  level: 'release',
});

const BECK: CreditArtist = { id: 'beck', name: 'Beck' };

const release = (credits: Credit[], artists: CreditArtist[] = [BECK]): ReleaseCredits => ({
  releaseId: 'r1',
  artists,
  credits,
});

const person = (id: string, name: string, bands: CreditArtist[]): ArtistBands => ({
  artist: { id, name },
  type: 'Person',
  memberOf: bands.map((band) => ({ band, ended: false })),
  members: [],
});

const group = (id: string, name: string, members: CreditArtist[]): ArtistBands => ({
  artist: { id, name },
  type: 'Group',
  memberOf: [],
  members: members.map((p) => ({ person: p, ended: false })),
});

const SEA_CHANGE: CardAlbum = { artist: 'Beck', album: 'Sea Change', plays: 12 };
const EARTHLING: CardAlbum = { artist: 'Eddie Vedder', album: 'Earthling', plays: 9 };
const IN_RAINBOWS: CardAlbum = { artist: 'Radiohead', album: 'In Rainbows', plays: 10 };

const one = (id: string, credit: Credit, bands: CreditArtist[]): TieBackInput => ({
  album: SEA_CHANGE,
  credits: release([credit]),
  albumArtists: [person('beck', 'Beck', [])],
  bands: new Map([[id, person(id, credit.artist.name, bands)]]),
});

const RHCP: CreditArtist = { id: 'rhcp', name: 'Red Hot Chili Peppers' };
const SMILE: CreditArtist = { id: 'smile', name: 'The Smile' };
const THOM: CreditArtist = { id: 'thom', name: 'Thom Yorke' };
const JONNY: CreditArtist = { id: 'jonny', name: 'Jonny Greenwood' };
const RADIOHEAD = group('radiohead', 'Radiohead', [THOM, JONNY]);
const PEARL_JAM: CreditArtist = { id: 'pj', name: 'Pearl Jam' };
const VEDDER: CreditArtist = { id: 'eddie', name: 'Eddie Vedder' };

const credited = (
  id: string,
  name: string,
  role: string | null,
  flags: { producer?: boolean; member?: boolean; performs?: boolean; co?: boolean } = {},
): CreditedPerson => ({
  artist: { id, name },
  role,
  // A person with a role plays; a producer with none only produced, unless the flags say otherwise.
  performs: flags.performs ?? (role !== null || !flags.producer),
  producer: flags.producer ?? false,
  coProducer: flags.co ?? false,
  member: flags.member ?? false,
});

/** Fictional members of a fictional band, for the producer-only member cases. */
const PAT = credited('pat', 'Pat Reyes', null, { producer: true, member: true });
const PAT_CO = credited('pat', 'Pat Reyes', null, { producer: true, co: true, member: true });
const LEE = credited('lee', 'Lee Moss', null, { producer: true, member: true });

const tie = (album: string, albumArtist: string, people: CreditedPerson[], band: string, plays: number, direct = false): TieBack => ({
  album,
  albumArtist,
  people,
  band,
  plays,
  direct,
});

const CHAD = credited('chad', 'Chad Smith', 'drums');
const JOSH = credited('josh', 'Josh Klinghoffer', 'guitar');

/** One tie-back for each template. */
const CASES: Record<string, TieBack> = {
  guest: tie('Earthling', 'Eddie Vedder', [CHAD], 'Red Hot Chili Peppers', 19),
  vocals: tie('Sea Change', 'Beck', [credited('jonsi', 'Jónsi', 'vocals')], 'Sigur Rós', 40),
  'no role': tie('Sea Change', 'Beck', [credited('mike', 'Mike Campbell', null)], 'Tom Petty and the Heartbreakers', 25),
  'two guests': tie('Earthling', 'Eddie Vedder', [CHAD, JOSH], 'Red Hot Chili Peppers', 19),
  producer: tie(
    'Los Ojos Del Cóndor',
    'Hermanos Gutiérrez',
    [credited('dan', 'Dan Auerbach', null, { producer: true })],
    'The Black Keys',
    531,
  ),
  'one member': tie('In Rainbows', 'Radiohead', [credited('thom', 'Thom Yorke', null, { member: true })], 'The Smile', 40),
  'two members': tie(
    'In Rainbows',
    'Radiohead',
    [credited('thom', 'Thom Yorke', null, { member: true }), credited('jonny', 'Jonny Greenwood', null, { member: true })],
    'The Smile',
    40,
  ),
  direct: tie('Earthling', 'Eddie Vedder', [JOSH], 'Josh Klinghoffer', 12, true),
  'direct producer': tie(
    'Sea Change',
    'Beck',
    [credited('nigel', 'Nigel Godrich', null, { producer: true })],
    'Nigel Godrich',
    11,
    true,
  ),
  'co-producer': tie(
    'Los Ojos Del Cóndor',
    'Hermanos Gutiérrez',
    [credited('dan', 'Dan Auerbach', null, { producer: true, co: true })],
    'The Black Keys',
    531,
  ),
  'two producers': tie(
    'Night Ferry',
    'The Lanterns',
    [credited('ivy', 'Ivy Chen', null, { producer: true }), credited('max', 'Max Ortiz', null, { producer: true })],
    'Glass Harbor',
    22,
  ),
  'producing member': tie('Night Ferry', 'The Lanterns', [PAT], 'Glass Harbor', 22),
  'co-producing member': tie('Night Ferry', 'The Lanterns', [PAT_CO], 'Glass Harbor', 22),
  'two producing members': tie('Night Ferry', 'The Lanterns', [PAT, LEE], 'Glass Harbor', 22),
  'direct producing member': tie('Night Ferry', 'The Lanterns', [PAT], 'Pat Reyes', 15, true),
  'direct co-producing member': tie('Night Ferry', 'The Lanterns', [PAT_CO], 'Pat Reyes', 15, true),
};

describe('libraryFrom', () => {
  it('re-keys by matchKey and keeps the larger count on a collision', () => {
    const library = libraryFrom({ counts: { 'tom petty & the heartbreakers': 25, 'tom petty and the heartbreakers': 30 } });
    expect([...library]).toEqual([['tom petty and the heartbreakers', 30]]);
  });
});

describe('peopleToCheck', () => {
  it('keeps instrument, vocal, performer and producer credits and drops engineering, mixing, mastering, design and executive producers', () => {
    const credits = release([
      guest('a', 'A', 'instrument', ['guitar']),
      guest('b', 'B', 'vocal'),
      guest('c', 'C', 'performer'),
      guest('d', 'D', 'producer'),
      guest('e', 'E', 'engineer'),
      guest('f', 'F', 'mix'),
      guest('g', 'G', 'mastering'),
      guest('h', 'H', 'design'),
      guest('i', 'I', 'producer', ['executive']),
    ]);
    const { guests, members } = peopleToCheck(credits, [person('beck', 'Beck', [])]);
    expect(guests.map((p) => p.artist.name)).toEqual(['A', 'B', 'C', 'D']);
    expect(members).toEqual([]);
  });

  it('reads the role from the first plain instrument attribute, vocals for a vocal, and keeps the playing role of a producer who plays', () => {
    const credits = release([
      guest('chad', 'Chad Smith', 'instrument', ['guest', 'drums (drum set)']),
      guest('jonsi', 'Jónsi', 'vocal', ['lead vocals']),
      guest('dan', 'Dan Auerbach', 'producer'),
      guest('dan', 'Dan Auerbach', 'instrument', ['additional', 'electric guitar']),
      guest('beck', 'Beck', 'performer'),
    ]);
    const { guests } = peopleToCheck(credits, [person('beck', 'Beck', [])]);
    expect(guests).toEqual([
      credited('chad', 'Chad Smith', 'drums'),
      credited('jonsi', 'Jónsi', 'vocals'),
      credited('dan', 'Dan Auerbach', 'electric guitar', { producer: true }),
    ]);
  });

  it('names an instrument category in plain words, and leaves no role for a generic or unknown one', () => {
    const credits = release([
      guest('a', 'A', 'instrument', ['membranophone']),
      guest('b', 'B', 'instrument', ['chordophone']),
      guest('c', 'C', 'instrument', ['aerophone']),
      guest('d', 'D', 'instrument', ['idiophone']),
      guest('e', 'E', 'instrument', ['electrophone']),
      guest('f', 'F', 'instrument', ['other instruments']),
      guest('g', 'G', 'instrument', ['guest', 'membranophone']),
      guest('h', 'H', 'instrument', ['bass guitar']),
      guest('i', 'I', 'instrument', ['membranophone', 'drums (drum set)']),
      guest('j', 'J', 'instrument', ['drums']),
    ]);
    const { guests } = peopleToCheck(credits, [person('beck', 'Beck', [])]);
    expect(guests.map((p) => [p.artist.name, p.role])).toEqual([
      ['A', 'percussion'], ['B', 'strings'], ['C', 'wind instruments'], ['D', 'percussion'], ['E', null], ['F', null],
      ['G', 'percussion'], ['H', 'bass guitar'], ['I', 'drums'], ['J', 'drums'],
    ]);
  });

  it('a later credit that names an instrument fills a role a generic one left empty', () => {
    const credits = release([
      guest('a', 'A', 'instrument', ['other instruments']),
      guest('a', 'A', 'instrument', ['cello']),
    ]);
    expect(peopleToCheck(credits, [person('beck', 'Beck', [])]).guests.map((p) => p.role)).toEqual(['cello']);
  });

  it('lists a credited album band member as a member, once, and drops a member the release does not credit', () => {
    const credits = release(
      [guest('thom', 'Thom Yorke', 'vocal'), guest('thom', 'Thom Yorke', 'performer'), guest('jonny', 'Jonny Greenwood', 'engineer')],
      [{ id: 'radiohead', name: 'Radiohead' }],
    );
    const { guests, members } = peopleToCheck(credits, [RADIOHEAD, RADIOHEAD]);
    expect(guests).toEqual([]);
    expect(members).toEqual([credited('thom', 'Thom Yorke', 'vocals', { member: true })]);
  });
});

describe('selectTieBacks', () => {
  it('matches library names across U+2010 hyphens, accents and "&"', () => {
    const library = libraryFrom({ counts: { 'justin meldal-johnsen': 12, 'sigur ros': 40, 'tom petty & the heartbreakers': 25 } });
    const credits = release([
      guest('jmj', 'Justin Meldal‐Johnsen', 'instrument', ['bass guitar']),
      guest('jonsi', 'Jónsi', 'vocal'),
      guest('mike', 'Mike Campbell', 'instrument', ['guitar']),
    ]);
    const bands = new Map([
      ['jmj', person('jmj', 'Justin Meldal‐Johnsen', [])],
      ['jonsi', person('jonsi', 'Jónsi', [{ id: 'sr', name: 'Sigur Rós' }])],
      ['mike', person('mike', 'Mike Campbell', [{ id: 'tp', name: 'Tom Petty and the Heartbreakers' }])],
    ]);
    const { tieBacks } = selectTieBacks({ album: SEA_CHANGE, credits, albumArtists: [person('beck', 'Beck', [])], bands }, library);
    expect(tieBacks.map((t) => [t.band, t.plays, t.direct])).toEqual([
      ['Sigur Rós', 40, false],
      ['Tom Petty and the Heartbreakers', 25, false],
      ['Justin Meldal‐Johnsen', 12, true],
    ]);
  });

  it('a band at 9 plays is no tie-back, and eligibilityKey changes when it reaches 10', () => {
    const input = one('g', guest('g', 'Mike Campbell', 'instrument', ['guitar']), [{ id: 'hb', name: 'Heartbreakers' }]);
    const at9 = libraryFrom({ counts: { heartbreakers: 9 } });
    const at10 = libraryFrom({ counts: { heartbreakers: 10 } });
    const below = selectTieBacks(input, at9);
    const above = selectTieBacks(input, at10);
    expect(below.tieBacks).toEqual([]);
    expect(above.tieBacks).toHaveLength(1);
    expect(below.considered).toEqual(above.considered);
    expect(eligibilityKey(below.considered, at9)).not.toBe(eligibilityKey(above.considered, at10));
  });

  it('eligibilityKey changes when two eligible bands swap order by count', () => {
    const considered = ['a', 'b', 'nobody'];
    const first = libraryFrom({ counts: { a: 20, b: 30 } });
    const second = libraryFrom({ counts: { a: 30, b: 20 } });
    expect(eligibilityKey(considered, first)).not.toBe(eligibilityKey(considered, second));
    expect(eligibilityKey(['b', 'a'], first)).toBe(eligibilityKey(considered, first));
  });

  it('allows a band member\'s other band', () => {
    const input: TieBackInput = {
      album: IN_RAINBOWS,
      credits: release(
        [guest('thom', 'Thom Yorke', 'performer'), guest('jonny', 'Jonny Greenwood', 'performer')],
        [{ id: 'radiohead', name: 'Radiohead' }],
      ),
      albumArtists: [RADIOHEAD],
      bands: new Map([
        ['thom', person('thom', 'Thom Yorke', [{ id: 'radiohead', name: 'Radiohead' }, SMILE])],
        ['jonny', person('jonny', 'Jonny Greenwood', [{ id: 'radiohead', name: 'Radiohead' }, SMILE])],
      ]),
    };
    const { tieBacks } = selectTieBacks(input, libraryFrom({ counts: { radiohead: 900, 'the smile': 40 } }));
    expect(tieBacks).toEqual([CASES['two members']]);
  });

  it('a past member the release does not credit gives no tie-back', () => {
    const josh: CreditArtist = { id: 'josh', name: 'Josh Klinghoffer' };
    const input: TieBackInput = {
      album: { artist: 'Red Hot Chili Peppers', album: 'Californication', plays: 13 },
      credits: release([guest('chad', 'Chad Smith', 'performer')], [RHCP]),
      albumArtists: [group('rhcp', 'Red Hot Chili Peppers', [{ id: 'chad', name: 'Chad Smith' }, josh])],
      bands: new Map([
        ['chad', person('chad', 'Chad Smith', [RHCP])],
        ['josh', person('josh', 'Josh Klinghoffer', [RHCP, { id: 'dot', name: 'Dot Hacker' }])],
      ]),
    };
    const result = selectTieBacks(input, libraryFrom({ counts: { 'dot hacker': 30, 'josh klinghoffer': 12 } }));
    expect(result.tieBacks).toEqual([]);
    expect(result.considered).not.toContain('dot hacker');
  });

  it('a person with no band relations gives no tie-back and does not throw', () => {
    const drummer = guest('x', 'Joey Waronker', 'instrument', ['drums']);
    expect(selectTieBacks(one('x', drummer, []), libraryFrom({ counts: {} })).tieBacks).toEqual([]);
  });

  it('keeps a co-producer and ties back through their band', () => {
    const input = one('dan', guest('dan', 'Dan Auerbach', 'producer', ['co']), [{ id: 'tbk', name: 'The Black Keys' }]);
    const { tieBacks } = selectTieBacks(input, libraryFrom({ counts: { 'the black keys': 531 } }));
    expect(tieBacks).toHaveLength(1);
    expect(tieBacks[0].people[0].producer).toBe(true);
    expect(tieBacks[0].people[0].coProducer).toBe(true);
    expect(tieBacks[0].band).toBe('The Black Keys');
  });

  describe('a member credited only as a producer', () => {
    const LANTERNS = group('lanterns', 'The Lanterns', [{ id: 'ana', name: 'Ana Ruiz' }, { id: 'pat', name: 'Pat Reyes' }]);
    const HARBOR: CreditArtist = { id: 'harbor', name: 'Glass Harbor' };
    const input = (credits: Credit[]): TieBackInput => ({
      album: { artist: 'The Lanterns', album: 'Night Ferry', plays: 10 },
      credits: release(credits, [{ id: 'lanterns', name: 'The Lanterns' }]),
      albumArtists: [LANTERNS],
      bands: new Map([
        ['ana', person('ana', 'Ana Ruiz', [{ id: 'lanterns', name: 'The Lanterns' }, HARBOR])],
        ['pat', person('pat', 'Pat Reyes', [{ id: 'lanterns', name: 'The Lanterns' }, HARBOR])],
      ]),
    });
    const library = libraryFrom({ counts: { 'glass harbor': 22, 'pat reyes': 15 } });

    it('is marked as producing, not performing, and co-producing only when every producer credit says co', () => {
      const credits = release([
        guest('pat', 'Pat Reyes', 'producer', ['co']),
        guest('lee', 'Lee Moss', 'producer', ['co']),
        guest('lee', 'Lee Moss', 'producer'),
      ]);
      const { guests } = peopleToCheck(credits, []);
      expect(guests).toEqual([
        credited('pat', 'Pat Reyes', null, { producer: true, co: true }),
        credited('lee', 'Lee Moss', null, { producer: true }),
      ]);
    });

    it('gives producing tie-backs for a direct match and a band match', () => {
      const { tieBacks } = selectTieBacks(input([guest('pat', 'Pat Reyes', 'producer', ['co'])]), library);
      expect(tieBacks.map((t) => renderTieBack(t, { person: 'second' }))).toEqual([
        "Pat Reyes from The Lanterns co-produced Night Ferry and has also played in Glass Harbor, a band you've played 22 times.",
        "Pat Reyes from The Lanterns co-produced Night Ferry. You've played Pat Reyes 15 times.",
      ]);
    });

    it('is left out of a pair with a member who plays, whatever the credit order', () => {
      const producer = guest('pat', 'Pat Reyes', 'producer');
      const bassist = guest('ana', 'Ana Ruiz', 'instrument', ['bass guitar']);
      const rendered: Array<[Viewer, string]> = [
        [{ person: 'second' }, "Ana Ruiz from The Lanterns plays on Night Ferry and has also played in Glass Harbor, a band you've played 22 times."],
        [{ person: 'third', name: 'rian' }, 'Ana Ruiz from The Lanterns plays on Night Ferry and has also played in Glass Harbor, a band rian has played 22 times.'],
      ];
      for (const credits of [[producer, bassist], [bassist, producer]]) {
        const [bandTie] = selectTieBacks(input(credits), library).tieBacks;
        expect(bandTie.people.map((p) => p.artist.name)).toEqual(['Ana Ruiz']);
        for (const [viewer, text] of rendered) {
          const out = renderTieBack(bandTie, viewer);
          expect(out).toBe(text);
          expect(checkCopyRubric(out, ['Ana Ruiz', 'The Lanterns', 'Night Ferry', 'Glass Harbor'])).toEqual([]);
        }
      }
    });
  });

  it('ranks guests before members of the album band, then by lifetime plays', () => {
    const input: TieBackInput = {
      album: IN_RAINBOWS,
      credits: release(
        [guest('chad', 'Chad Smith', 'instrument', ['drums']), guest('thom', 'Thom Yorke', 'performer')],
        [{ id: 'radiohead', name: 'Radiohead' }],
      ),
      albumArtists: [group('radiohead', 'Radiohead', [THOM])],
      bands: new Map([
        ['chad', person('chad', 'Chad Smith', [RHCP])],
        ['thom', person('thom', 'Thom Yorke', [SMILE])],
      ]),
    };
    const { tieBacks } = selectTieBacks(input, libraryFrom({ counts: { 'red hot chili peppers': 19, 'the smile': 40 } }));
    expect(tieBacks.map((t) => [t.people.map((p) => p.artist.name), t.band])).toEqual([
      [['Chad Smith'], 'Red Hot Chili Peppers'],
      [['Thom Yorke'], 'The Smile'],
    ]);
  });

  it('excludes the album artist and a solo artist\'s own other bands', () => {
    const input: TieBackInput = {
      album: EARTHLING,
      credits: release([guest('eddie', 'Eddie Vedder', 'vocal'), guest('mike', 'Mike McCready', 'instrument', ['guitar'])], [VEDDER]),
      albumArtists: [person('eddie', 'Eddie Vedder', [PEARL_JAM])],
      bands: new Map([['mike', person('mike', 'Mike McCready', [PEARL_JAM])]]),
    };
    const library = libraryFrom({ counts: { 'pearl jam': 500, 'eddie vedder': 80 } });
    expect(selectTieBacks(input, library).tieBacks).toEqual([]);
  });

  it('names at most two people, both tied to the same band', () => {
    const input: TieBackInput = {
      album: EARTHLING,
      credits: release(
        [
          guest('chad', 'Chad Smith', 'instrument', ['drums (drum set)']),
          guest('josh', 'Josh Klinghoffer', 'instrument', ['guitar']),
          guest('flea', 'Flea', 'instrument', ['bass guitar']),
        ],
        [VEDDER],
      ),
      albumArtists: [person('eddie', 'Eddie Vedder', [PEARL_JAM])],
      bands: new Map([
        ['chad', person('chad', 'Chad Smith', [RHCP])],
        ['josh', person('josh', 'Josh Klinghoffer', [RHCP])],
        ['flea', person('flea', 'Flea', [RHCP])],
      ]),
    };
    const { tieBacks } = selectTieBacks(input, libraryFrom({ counts: { 'red hot chili peppers': 19 } }));
    expect(tieBacks).toEqual([CASES['two guests']]);
    expect(tieBacks[0].people).toHaveLength(2);
  });

  it('skips people whose bands lookup is missing or null', () => {
    const input: TieBackInput = {
      album: EARTHLING,
      credits: release(
        [guest('chad', 'Chad Smith', 'instrument', ['drums']), guest('josh', 'Josh Klinghoffer', 'instrument', ['guitar'])],
        [VEDDER],
      ),
      albumArtists: [person('eddie', 'Eddie Vedder', [])],
      bands: new Map<string, ArtistBands | null>([['josh', null]]),
    };
    const library = libraryFrom({ counts: { 'chad smith': 50, 'josh klinghoffer': 50 } });
    expect(selectTieBacks(input, library)).toEqual({ tieBacks: [], considered: [] });
  });

  it('lists every key it looked up, excluded bands left out', () => {
    const input = one('mike', guest('mike', 'Mike Campbell', 'instrument', ['guitar']), [
      { id: 'tp', name: 'Tom Petty & the Heartbreakers' },
      { id: 'beck', name: 'Beck' },
    ]);
    expect(selectTieBacks(input, libraryFrom({ counts: {} })).considered).toEqual([
      'tom petty and the heartbreakers',
      'mike campbell',
    ]);
  });
});

describe('renderTieBack', () => {
  it.each([
    ['guest', "Chad Smith plays drums on Earthling and has played in Red Hot Chili Peppers, a band you've played 19 times."],
    ['vocals', "Jónsi sings on Sea Change and has played in Sigur Rós, a band you've played 40 times."],
    ['no role', "Mike Campbell plays on Sea Change and has played in Tom Petty and the Heartbreakers, a band you've played 25 times."],
    ['two guests', "Earthling has Chad Smith and Josh Klinghoffer on it. Both have played in Red Hot Chili Peppers, a band you've played 19 times."],
    ['producer', "Los Ojos Del Cóndor was produced by Dan Auerbach, who has played in The Black Keys, a band you've played 531 times."],
    ['one member', "Thom Yorke from Radiohead plays on In Rainbows and has also played in The Smile, a band you've played 40 times."],
    ['two members', "Thom Yorke and Jonny Greenwood from Radiohead play on In Rainbows and have also played in The Smile, a band you've played 40 times."],
    ['direct', "Josh Klinghoffer plays guitar on Earthling. You've played Josh Klinghoffer 12 times."],
    ['direct producer', "Sea Change was produced by Nigel Godrich. You've played Nigel Godrich 11 times."],
  ])('%s, second person', (name, text) => expect(renderTieBack(CASES[name], { person: 'second' })).toBe(text));

  it.each([
    ['co-producer',
      "Los Ojos Del Cóndor was co-produced by Dan Auerbach, who has played in The Black Keys, a band you've played 531 times.",
      'Los Ojos Del Cóndor was co-produced by Dan Auerbach, who has played in The Black Keys, a band rian has played 531 times.'],
    ['two producers',
      "Night Ferry was produced by Ivy Chen and Max Ortiz, who have both played in Glass Harbor, a band you've played 22 times.",
      'Night Ferry was produced by Ivy Chen and Max Ortiz, who have both played in Glass Harbor, a band rian has played 22 times.'],
    ['producing member',
      "Pat Reyes from The Lanterns produced Night Ferry and has also played in Glass Harbor, a band you've played 22 times.",
      'Pat Reyes from The Lanterns produced Night Ferry and has also played in Glass Harbor, a band rian has played 22 times.'],
    ['co-producing member',
      "Pat Reyes from The Lanterns co-produced Night Ferry and has also played in Glass Harbor, a band you've played 22 times.",
      'Pat Reyes from The Lanterns co-produced Night Ferry and has also played in Glass Harbor, a band rian has played 22 times.'],
    ['two producing members',
      "Pat Reyes and Lee Moss from The Lanterns produced Night Ferry and have also played in Glass Harbor, a band you've played 22 times.",
      'Pat Reyes and Lee Moss from The Lanterns produced Night Ferry and have also played in Glass Harbor, a band rian has played 22 times.'],
    ['direct producing member',
      "Pat Reyes from The Lanterns produced Night Ferry. You've played Pat Reyes 15 times.",
      'Pat Reyes from The Lanterns produced Night Ferry. rian has played Pat Reyes 15 times.'],
    ['direct co-producing member',
      "Pat Reyes from The Lanterns co-produced Night Ferry. You've played Pat Reyes 15 times.",
      'Pat Reyes from The Lanterns co-produced Night Ferry. rian has played Pat Reyes 15 times.'],
  ])('%s, both persons', (name, second, third) => {
    expect(renderTieBack(CASES[name], { person: 'second' })).toBe(second);
    expect(renderTieBack(CASES[name], { person: 'third', name: 'rian' })).toBe(third);
  });

  it('reads a category credit in plain words, and "plays on" for a generic one', () => {
    const drummer = (attributes: string[]) => peopleToCheck(
      release([guest('jeremy', 'Jeremy Lutito', 'instrument', attributes)]), [person('beck', 'Beck', [])],
    ).guests;
    const render = (attributes: string[], viewer: Viewer) =>
      renderTieBack(tie('Sea Change', 'Beck', drummer(attributes), 'Leagues', 20), viewer);
    expect(render(['membranophone'], { person: 'second' }))
      .toBe("Jeremy Lutito plays percussion on Sea Change and has played in Leagues, a band you've played 20 times.");
    expect(render(['drums (drum set)'], { person: 'second' }))
      .toBe("Jeremy Lutito plays drums on Sea Change and has played in Leagues, a band you've played 20 times.");
    expect(render(['other instruments'], { person: 'second' }))
      .toBe("Jeremy Lutito plays on Sea Change and has played in Leagues, a band you've played 20 times.");
    for (const attributes of [['membranophone'], ['chordophone'], ['aerophone'], ['idiophone'], ['electrophone'], ['other instruments']]) {
      for (const viewer of [{ person: 'second' }, { person: 'third', name: 'rian' }] as Viewer[]) {
        expect(checkCopyRubric(render(attributes, viewer), ['Sea Change', 'Beck', 'Leagues', 'Jeremy Lutito'])).toEqual([]);
      }
    }
  });

  it('drops an edition suffix from the album it names', () => {
    const lutito = credited('jeremy', 'Jeremy Lutito', 'drums');
    const deluxe = tie('The Long Fall Back to Earth (Deluxe Edition)', 'Jars of Clay', [lutito], 'Leagues', 20);
    expect(renderTieBack(deluxe, { person: 'second' }))
      .toBe("Jeremy Lutito plays drums on The Long Fall Back to Earth and has played in Leagues, a band you've played 20 times.");
    const members = tie('In Rainbows (Remastered 2026)', 'Radiohead', [credited('thom', 'Thom Yorke', null, { member: true })], 'The Smile', 40);
    expect(renderTieBack(members, { person: 'third', name: 'rian' }))
      .toBe('Thom Yorke from Radiohead plays on In Rainbows and has also played in The Smile, a band rian has played 40 times.');
  });

  it('third person names the profile', () => {
    const rian: Viewer = { person: 'third', name: 'rian' };
    expect(renderTieBack(CASES['two members'], rian)).toBe(
      'Thom Yorke and Jonny Greenwood from Radiohead play on In Rainbows and have also played in The Smile, a band rian has played 40 times.',
    );
    expect(renderTieBack(CASES.direct, rian)).toBe('Josh Klinghoffer plays guitar on Earthling. rian has played Josh Klinghoffer 12 times.');
  });

  it('states the library\'s current count, with a comma from 1,000', () => {
    const text = renderTieBack(CASES.producer, { person: 'second' }, libraryFrom({ counts: { 'the black keys': 1204 } }));
    expect(text.endsWith('1,204 times.')).toBe(true);
  });

  it('every template in both persons passes checkCopyRubric', () => {
    for (const t of Object.values(CASES)) {
      for (const viewer of [{ person: 'second' }, { person: 'third', name: 'rian' }] as Viewer[]) {
        expect(checkCopyRubric(renderTieBack(t, viewer), [t.album, t.albumArtist, t.band, ...t.people.map((p) => p.artist.name)])).toEqual([]);
      }
    }
  });
});
