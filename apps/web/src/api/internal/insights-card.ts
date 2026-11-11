// ABOUTME: The "Did you know" card core (spec section 1): checks the week's candidate albums for a credits tie-back
// ABOUTME: under the MusicBrainz budget, falls back to the making-of fact, and renders the card per viewer. Node-safe.

import { eligibilityKey, peopleToCheck, renderTieBack, selectTieBacks, standoutAlbum, stripEdition } from '@listentomore/insights';
import type { CardAlbum, CreditedPerson, Library, TieBack, Viewer, WeekFacts } from '@listentomore/insights';
import type { ArtistBands, CreditsClient, ReleaseCredits } from '@listentomore/musicbrainz';
import type { MakingOfResult } from './insights-making-of';

/**
 * MusicBrainz network calls one card request may make (spec section 1, "Cap"). The card loads on its own after the
 * note, so a long lookup only delays the card. 30 calls (about a minute) usually finish a week's uncached albums in
 * one load; 10 left weeks with fresh albums needing several reloads (raised 2026-11-11).
 */
export const CARD_MB_CALLS = 30;

/** The card as cached: album and artist in Last.fm spelling, the cover if found, and a tie-back or a making-of fact. */
export type StoredCard = { album: string; artist: string; imageUrl: string | null }
  & ({ kind: 'tieback'; tieBack: TieBack } | { kind: 'making_of'; text: string; sourceUrl: string });

/**
 * The cache entry under `keys.card`: the card (null when the week has none), the facts signature it was made for,
 * and every library key its tie-back check looked up with their eligible counts at the time.
 */
export interface CachedCard { signature: string; considered: string[]; eligible: string; card: StoredCard | null }

/** The route's response: only these fields leave the server. */
export interface TriviaCard {
  kind: 'tieback' | 'making_of';
  album: string;
  artist: string;
  text: string;
  sourceUrl?: string;
  imageUrl?: string;
}

/** One candidate that was checked: its tie-backs, best first, or null when it has no release group or credits. */
export interface CheckedAlbum { album: CardAlbum; tieBacks: TieBack[] | null }

/**
 * Why a request was cut: the MusicBrainz cap, MusicBrainz rate limiting or a 503, another credits error, or a
 * making-of error. Categorical, so it can go in a log line.
 */
export type CutReason = 'cap' | 'rate_limit' | 'error' | 'making_of';

/** 'cut' means the card is unknown for now: the caller caches nothing and the next owner view continues. */
export type CardOutcome = ({ status: 'card'; card: StoredCard } | { status: 'none' } | { status: 'cut'; reason: CutReason })
  & { checked: CheckedAlbum[]; considered: string[] };

export interface CardDeps {
  credits: CreditsClient;
  makingOf(artist: string, album: string): Promise<MakingOfResult>;
  /** The album's cover URL, or null. A throw reads as null. */
  albumArt(artist: string, album: string): Promise<string | null>;
}

/** The cut reason for an error, from its class name: errors from the credits client can carry a host and path. */
function cutReason(error: unknown): CutReason {
  const name = error instanceof Error ? error.name : '';
  if (name === 'CreditsCapReached') return 'cap';
  if (name === 'MusicBrainzRateLimitError') return 'rate_limit';
  return 'error';
}

async function coverOf(deps: CardDeps, artist: string, album: string): Promise<string | null> {
  try {
    return await deps.albumArt(artist, album);
  } catch {
    return null;
  }
}

/**
 * One candidate's tie-backs, in the order the budget depends on: the release (search, then release group), its
 * credits, the band links of each album artist, then of each guest, and of each credited member only when no
 * guest ties back. Calls run one at a time, so a cap hit stops at a known point and the next request's cached
 * reads pick up from there. Throws whatever the credits client throws.
 */
async function checkAlbum(
  credits: CreditsClient,
  album: CardAlbum,
  library: Library,
): Promise<{ tieBacks: TieBack[] | null; considered: string[] }> {
  const ref = await credits.findRelease(album.artist, stripEdition(album.album));
  if (!ref) return { tieBacks: null, considered: [] };
  const release: ReleaseCredits | null = await credits.releaseCredits(ref.releaseId);
  if (!release) return { tieBacks: null, considered: [] };

  const albumArtists: ArtistBands[] = [];
  for (const artist of release.artists) {
    const bands = await credits.artistBands(artist.id);
    if (bands) albumArtists.push(bands);
  }

  const { guests, members } = peopleToCheck(release, albumArtists);
  const bands = new Map<string, ArtistBands | null>();
  const lookUp = async (people: CreditedPerson[]): Promise<void> => {
    for (const person of people) bands.set(person.artist.id, await credits.artistBands(person.artist.id));
  };
  const select = () => selectTieBacks({ album, credits: release, albumArtists, bands }, library);

  await lookUp(guests);
  let result = select();
  if (result.tieBacks.length === 0 && members.length > 0) {
    await lookUp(members);
    result = select();
  }
  return result;
}

/**
 * The week's card. Checks the candidates in order and stops at the first tie-back, unless `exhaustive` (the eval),
 * which checks them all and still features the first. Any credits error before a tie-back cuts the request, with
 * no making-of fallback: the fallback runs only once every candidate has been checked and none had a tie-back,
 * for the week's standout album. The cover comes from `albumArt`. Logs nothing.
 */
export async function generateCard(
  deps: CardDeps,
  wf: WeekFacts,
  library: Library,
  opts: { exhaustive?: boolean } = {},
): Promise<CardOutcome> {
  const checked: CheckedAlbum[] = [];
  const considered = new Set<string>();
  const result = () => ({ checked, considered: [...considered] });
  let found: { album: CardAlbum; tieBack: TieBack } | null = null;

  for (const album of wf.cardAlbums) {
    let check: Awaited<ReturnType<typeof checkAlbum>>;
    try {
      check = await checkAlbum(deps.credits, album, library);
    } catch (error) {
      // Past a tie-back an exhaustive run keeps what it has; before one, the card is unknown.
      if (found) break;
      return { status: 'cut', reason: cutReason(error), ...result() };
    }
    checked.push({ album, tieBacks: check.tieBacks });
    for (const key of check.considered) considered.add(key);
    if (!found && check.tieBacks && check.tieBacks.length > 0) {
      found = { album, tieBack: check.tieBacks[0] };
      if (!opts.exhaustive) break;
    }
  }

  if (found) {
    const { album, tieBack } = found;
    const imageUrl = await coverOf(deps, album.artist, album.album);
    return { status: 'card', card: { kind: 'tieback', album: album.album, artist: album.artist, imageUrl, tieBack }, ...result() };
  }

  const standout = standoutAlbum(wf);
  if (!standout) return { status: 'none', ...result() };

  let fact: MakingOfResult;
  try {
    fact = await deps.makingOf(standout.artist, standout.album);
  } catch {
    return { status: 'cut', reason: 'making_of', ...result() };
  }
  if (fact.status !== 'found') {
    return fact.status === 'none' ? { status: 'none', ...result() } : { status: 'cut', reason: 'making_of', ...result() };
  }

  const imageUrl = await coverOf(deps, standout.artist, standout.album);
  const card: StoredCard = {
    kind: 'making_of',
    album: standout.album,
    artist: standout.artist,
    imageUrl,
    text: fact.text,
    sourceUrl: fact.sourceUrl,
  };
  return { status: 'card', card, ...result() };
}

/**
 * The card for one viewer. A tie-back is rendered from its template with the library's current count; a making-of
 * card carries its stored text and source. The album is shown without an edition suffix, as the tie-back text names
 * it. `sourceUrl` and `imageUrl` appear only when present.
 */
export function renderCard(card: StoredCard, viewer: Viewer, library?: Library): TriviaCard {
  const text = card.kind === 'tieback' ? renderTieBack(card.tieBack, viewer, library) : card.text;
  return {
    kind: card.kind,
    album: stripEdition(card.album),
    artist: card.artist,
    text,
    ...(card.kind === 'making_of' ? { sourceUrl: card.sourceUrl } : {}),
    ...(card.imageUrl ? { imageUrl: card.imageUrl } : {}),
  };
}

/**
 * A cached card still holds when the facts signature is the same and every considered band and person has the same
 * eligible count: one crossing 10 plays, or an eligible count moving, rechecks the card.
 */
export function isCardValid(cached: CachedCard, signature: string, library: Library): boolean {
  return cached.signature === signature && eligibilityKey(cached.considered, library) === cached.eligible;
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** Every CreditedPerson field renderTieBack reads. */
function isCreditedPerson(value: unknown): value is CreditedPerson {
  const person = asRecord(value);
  const artist = asRecord(person?.artist);
  return person !== null && artist !== null
    && isString(artist.id) && isString(artist.name)
    && (person.role === null || isString(person.role))
    && isBoolean(person.performs) && isBoolean(person.producer) && isBoolean(person.coProducer) && isBoolean(person.member);
}

/** Every TieBack field renderTieBack reads, with the one or two people selectTieBacks names. */
function isTieBack(value: unknown): value is TieBack {
  const tieBack = asRecord(value);
  return tieBack !== null
    && isString(tieBack.album) && isString(tieBack.albumArtist) && isString(tieBack.band)
    && typeof tieBack.plays === 'number' && Number.isFinite(tieBack.plays) && isBoolean(tieBack.direct)
    && Array.isArray(tieBack.people) && tieBack.people.length >= 1 && tieBack.people.length <= 2
    && tieBack.people.every(isCreditedPerson);
}

/** Every StoredCard field renderCard reads, and the tie-back it renders. */
function isStoredCard(value: unknown): value is StoredCard {
  const card = asRecord(value);
  if (!card || !isString(card.album) || !isString(card.artist) || !(card.imageUrl === null || isString(card.imageUrl))) {
    return false;
  }
  if (card.kind === 'making_of') return isString(card.text) && isString(card.sourceUrl);
  return card.kind === 'tieback' && isTieBack(card.tieBack);
}

/** Whether a KV value has the CachedCard shape; anything else reads as a miss. */
export function isCachedCard(value: unknown): value is CachedCard {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return isString(entry.signature)
    && isString(entry.eligible)
    && Array.isArray(entry.considered) && entry.considered.every(isString)
    && (entry.card === null || isStoredCard(entry.card));
}
