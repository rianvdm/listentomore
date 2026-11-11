// ABOUTME: Credit tie-backs for the week card (spec section 1, "Tie-back data" and "Tie-back text"): who played on or
// ABOUTME: produced an album, which library bands they have played in at 10+ plays, and the card text from templates.

import type { ArtistBands, Credit, CreditArtist, ReleaseCredits } from '@listentomore/musicbrainz';
import { matchKey, stripEdition } from './match';
import type { CardAlbum, CountList } from './types';

/** Lifetime plays a band or person needs in the library to count as a tie-back (owner decision). */
export const TIEBACK_MIN_PLAYS = 10;

/** The listener's lifetime plays per artist, keyed by matchKey(name). */
export type Library = ReadonlyMap<string, number>;

/** Credit types that put someone on the record as a player or singer. */
const PLAYING_TYPES = new Set(['instrument', 'vocal', 'performer']);
/** Producer credit attributes that drop the credit: these producers rarely shaped the record. */
const DROPPED_PRODUCER_ATTRIBUTES = new Set(['executive', 'assistant', 'associate']);
/** Instrument attributes that qualify a credit, not name an instrument. */
const ROLE_MODIFIERS = new Set(['guest', 'additional', 'solo', 'minor', 'co']);
/** MusicBrainz instrument categories the card names in plain words ('plays percussion on'). */
const INSTRUMENT_CATEGORIES: ReadonlyMap<string, string> = new Map([
  ['membranophone', 'percussion'],
  ['chordophone', 'strings'],
  ['string instruments', 'strings'],
  ['aerophone', 'wind instruments'],
  ['idiophone', 'percussion'],
  ['percussion instruments', 'percussion'],
]);
/** MusicBrainz instrument attributes too generic to name: the card says 'plays on' instead. */
const GENERIC_INSTRUMENTS = new Set([
  'electrophone', 'electronic instruments', 'other instruments', 'instrument', 'instruments', 'unknown', 'other',
]);
/** Separates 'key=count' entries in an eligibility key; matchKey output never contains it. */
const KEY_SEPARATOR = '|';

/** `list.counts` re-keyed by matchKey, keeping the larger count when two names fold to the same key. */
export function libraryFrom(list: Pick<CountList, 'counts'>): Library {
  const library = new Map<string, number>();
  for (const [name, count] of Object.entries(list.counts)) {
    const key = matchKey(name);
    library.set(key, Math.max(library.get(key) ?? 0, count));
  }
  return library;
}

/** Someone on the record: their role as the card names it, whether they produced it, and whether they are in the band. */
export interface CreditedPerson {
  artist: CreditArtist;
  /** 'vocals', an instrument such as 'drums', or null when no playing credit names one. */
  role: string | null;
  /** Has an instrument, vocal or performer credit on the release. */
  performs: boolean;
  producer: boolean;
  /** Every producer credit they have carries the 'co' attribute. */
  coProducer: boolean;
  /** A member of the album's own artist. */
  member: boolean;
}

/** What the card says someone did on the record, strongest first: played on it, produced it or co-produced it. */
type Contribution = 'plays' | 'produced' | 'co-produced';
const CONTRIBUTION_STRENGTH: Record<Contribution, number> = { plays: 0, produced: 1, 'co-produced': 2 };

/** Playing wins over producing; a producer is a co-producer only when every producer credit says so. */
function contributionOf(p: CreditedPerson): Contribution {
  if (p.performs) return 'plays';
  return p.coProducer ? 'co-produced' : 'produced';
}

/** True for a playing credit, or a producer credit that is not executive, assistant or associate. Co-producers stay. */
function keepsCredit(credit: Credit): boolean {
  if (PLAYING_TYPES.has(credit.type)) return true;
  return credit.type === 'producer' && !credit.attributes.some((a) => DROPPED_PRODUCER_ATTRIBUTES.has(a));
}

/**
 * 'vocals' for a vocal credit. For an instrument, its first attribute that names one, parenthetical dropped; failing
 * that, its first category in plain words ('membranophone' is 'percussion'); null when it names only a generic or unknown
 * category, so the card says 'plays on'.
 */
function roleOf(credit: Credit): string | null {
  if (credit.type === 'vocal') return 'vocals';
  if (credit.type !== 'instrument') return null;
  const named = credit.attributes
    .filter((a) => !ROLE_MODIFIERS.has(a))
    .map((a) => a.replace(/\s*\([^)]*\)/g, '').trim())
    .filter((a) => a !== '' && !GENERIC_INSTRUMENTS.has(a.toLowerCase()));
  const specific = named.find((a) => !INSTRUMENT_CATEGORIES.has(a.toLowerCase()));
  if (specific !== undefined) return specific;
  const [category] = named;
  return category === undefined ? null : INSTRUMENT_CATEGORIES.get(category.toLowerCase()) ?? null;
}

/**
 * The people to look up for one release. Guests are the credited players, singers and producers other than the
 * album artists, in credit order, each once; someone who both produced and played takes the playing role. Members
 * are the album artists' members whom this release credits in one of those roles, listed only as members. A member
 * with no such credit is dropped, so the card never says someone plays on a record made before they joined or after
 * they left.
 */
export function peopleToCheck(
  credits: ReleaseCredits,
  albumArtists: ArtistBands[],
): { guests: CreditedPerson[]; members: CreditedPerson[] } {
  const albumArtistIds = new Set([...credits.artists.map((a) => a.id), ...albumArtists.map((a) => a.artist.id)]);
  const credited = new Map<string, CreditedPerson>();
  for (const credit of credits.credits) {
    if (albumArtistIds.has(credit.artist.id) || !keepsCredit(credit)) continue;
    const entry: CreditedPerson = credited.get(credit.artist.id)
      ?? { artist: credit.artist, role: null, performs: false, producer: false, coProducer: false, member: false };
    if (credit.type === 'producer') {
      const co = credit.attributes.includes('co');
      entry.coProducer = entry.producer ? entry.coProducer && co : co;
      entry.producer = true;
    } else {
      entry.performs = true;
      entry.role ??= roleOf(credit);
    }
    credited.set(credit.artist.id, entry);
  }
  const members = new Map<string, CreditedPerson>();
  for (const { members: bandMembers } of albumArtists) {
    for (const { person } of bandMembers) {
      const entry = credited.get(person.id);
      if (!entry) continue;
      credited.delete(person.id);
      members.set(person.id, { ...entry, member: true });
    }
  }
  return { guests: [...credited.values()], members: [...members.values()] };
}

/** What selectTieBacks reads for one card album: its credits, its artists' band links, and each person's. */
export interface TieBackInput {
  album: CardAlbum;
  credits: ReleaseCredits;
  albumArtists: ArtistBands[];
  /** Keyed by MusicBrainz artist id. A missing or null entry means that person has not been looked up. */
  bands: ReadonlyMap<string, ArtistBands | null>;
}

/**
 * One tie-back. `album` and `albumArtist` are in Last.fm spelling. `people` holds one or two people with the same
 * band, member flag and contribution. `band` is the MusicBrainz name of the matched band, or of the person on a direct match.
 */
export interface TieBack {
  album: string;
  albumArtist: string;
  people: CreditedPerson[];
  band: string;
  plays: number;
  direct: boolean;
}

interface Candidate {
  person: CreditedPerson;
  band: string;
  key: string;
  plays: number;
  direct: boolean;
}

/**
 * The album's tie-backs, best first, and every library key looked up. Each guest's and member's bands, and the person
 * themselves, count at TIEBACK_MIN_PLAYS or more lifetime plays. The album artists (by id, and by the card album
 * artist's matchKey) never count, nor do a solo album artist's own bands. Guests rank before members, then by plays,
 * then by band name. People with the same band and member flag share one tie-back, which names the one or two first
 * of them with the strongest contribution (playing, then producing, then co-producing), so the text never has to
 * describe two different contributions in one sentence.
 */
export function selectTieBacks(input: TieBackInput, library: Library): { tieBacks: TieBack[]; considered: string[] } {
  const { album, credits, albumArtists, bands } = input;
  const excludedIds = new Set([...credits.artists.map((a) => a.id), ...albumArtists.map((a) => a.artist.id)]);
  const excludedKeys = new Set([matchKey(album.artist), ...albumArtists.map((a) => matchKey(a.artist.name))]);
  for (const albumArtist of albumArtists) {
    if (albumArtist.type !== 'Person') continue;
    for (const { band } of albumArtist.memberOf) {
      excludedIds.add(band.id);
      excludedKeys.add(matchKey(band.name));
    }
  }

  const considered = new Set<string>();
  const candidates: Candidate[] = [];
  const consider = (person: CreditedPerson, name: string, direct: boolean): void => {
    const key = matchKey(name);
    considered.add(key);
    const plays = library.get(key) ?? 0;
    if (plays >= TIEBACK_MIN_PLAYS) candidates.push({ person, band: name, key, plays, direct });
  };

  const { guests, members } = peopleToCheck(credits, albumArtists);
  for (const person of [...guests, ...members]) {
    const entry = bands.get(person.artist.id);
    if (!entry) continue;
    const seen = new Set<string>();
    for (const { band } of entry.memberOf) {
      const key = matchKey(band.name);
      if (excludedIds.has(band.id) || excludedKeys.has(key) || seen.has(key)) continue;
      seen.add(key);
      consider(person, band.name, false);
    }
    const ownKey = matchKey(person.artist.name);
    if (!excludedKeys.has(ownKey) && !seen.has(ownKey)) consider(person, person.artist.name, true);
  }

  candidates.sort((a, b) => Number(a.person.member) - Number(b.person.member)
    || b.plays - a.plays
    || a.band.localeCompare(b.band));

  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const group = c.direct ? `direct:${c.person.artist.id}` : `${c.person.member}:${c.key}`;
    const list = groups.get(group) ?? [];
    if (!list.some((other) => other.person.artist.id === c.person.artist.id)) list.push(c);
    groups.set(group, list);
  }
  const tieBacks = [...groups.values()].map(([lead, ...rest]): TieBack => {
    const all = [lead, ...rest];
    const strongest = Math.min(...all.map((c) => CONTRIBUTION_STRENGTH[contributionOf(c.person)]));
    const people = all
      .filter((c) => CONTRIBUTION_STRENGTH[contributionOf(c.person)] === strongest)
      .slice(0, 2)
      .map((c) => c.person);
    return { album: album.album, albumArtist: album.artist, people, band: lead.band, plays: lead.plays, direct: lead.direct };
  });
  return { tieBacks, considered: [...considered] };
}

/**
 * The considered keys at TIEBACK_MIN_PLAYS or more, sorted, each with its lifetime count ('key=count'), joined. It
 * changes whenever a band crosses the threshold or any eligible count moves, so a cached card is rechecked.
 */
export function eligibilityKey(considered: string[], library: Library): string {
  return [...new Set(considered)]
    .filter((key) => (library.get(key) ?? 0) >= TIEBACK_MIN_PLAYS)
    .sort()
    .map((key) => `${key}=${library.get(key)}`)
    .join(KEY_SEPARATOR);
}

/** Who reads the card: the owner ('you') or a visitor, who sees the profile's username. */
export type Viewer = { person: 'second' } | { person: 'third'; name: string };

/** A guest's part on the album, as a sentence opening: 'Chad Smith plays drums on Earthling'. */
function guestPart(p: CreditedPerson, album: string): string {
  const name = p.artist.name;
  const contribution = contributionOf(p);
  if (contribution !== 'plays') return `${album} was ${contribution} by ${name}`;
  if (p.role === 'vocals') return `${name} sings on ${album}`;
  if (p.role !== null) return `${name} plays ${p.role} on ${album}`;
  return `${name} plays on ${album}`;
}

/** "you've played" for the owner, "{name} has played" for a visitor; `opening` capitalises the owner's form. */
function hasPlayed(viewer: Viewer, opening = false): string {
  if (viewer.person === 'third') return `${viewer.name} has played`;
  return opening ? "You've played" : "you've played";
}

/**
 * The tie-back's card text for this viewer. The count is the library's current count for the band when a library
 * is given, else the count the tie-back was selected with, written with a comma from 1,000. A direct tie-back names
 * one person; a band tie-back names one or two. The album is named without an edition suffix ('(Deluxe Edition)').
 */
export function renderTieBack(tieBack: TieBack, viewer: Viewer, library?: Library): string {
  const t = { ...tieBack, album: stripEdition(tieBack.album) };
  const count = (library?.get(matchKey(t.band)) ?? t.plays).toLocaleString('en-US');
  const names = t.people.map((p) => p.artist.name).join(' and ');
  const [first] = t.people;
  const two = t.people.length > 1;
  // selectTieBacks names only people with the same contribution, so the first person's speaks for both.
  const contribution = contributionOf(first);
  const memberVerb = contribution === 'plays' ? `${two ? 'play' : 'plays'} on` : contribution;
  const opening = first.member ? `${names} from ${t.albumArtist} ${memberVerb} ${t.album}` : guestPart(first, t.album);

  if (t.direct) return `${opening}. ${hasPlayed(viewer, true)} ${t.band} ${count} times.`;

  const band = `${t.band}, a band ${hasPlayed(viewer)} ${count} times.`;
  if (first.member) return `${opening} and ${two ? 'have' : 'has'} also played in ${band}`;
  if (contribution === 'plays') {
    return two ? `${t.album} has ${names} on it. Both have played in ${band}` : `${opening} and has played in ${band}`;
  }
  return two
    ? `${t.album} was ${contribution} by ${names}, who have both played in ${band}`
    : `${opening}, who has played in ${band}`;
}
