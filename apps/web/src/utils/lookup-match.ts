// ABOUTME: Strict artist and album name matching for the name-based /lookup route.
// ABOUTME: Whole normalized names only, never substrings or fragments: a miss is better than a wrong match.

import type { LookupAlbumCandidate, LookupArtistCandidate } from '@listentomore/spotify';

const EDITION_WORDS = new Set(
  [
    'remaster',
    'remastered',
    'deluxe',
    'super',
    'special',
    'expanded',
    'edition',
    'version',
    'anniversary',
    'bonus',
    'track',
    'tracks',
    'reissue',
    'mono',
    'stereo',
    'mix',
    'live',
    'legacy',
    "collector's",
    'collectors',
    'the',
  ].map(cleanWord),
);

/** A year, a plain number, or an ordinal such as 25th. */
const NUMBER_OR_ORDINAL = /^\d+(st|nd|rd|th)?$/;

const TRAILING_PAREN = /\s*\(([^()]*)\)\s*$/;
const TRAILING_BRACKET = /\s*\[([^[\]]*)\]\s*$/;
const DASH_SEPARATOR = ' - ';

/** Lowercases a word and drops everything that is not a letter or number. */
function cleanWord(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/** True when the segment has at least one word and every word is edition boilerplate. */
function isEditionSegment(segment: string): boolean {
  const words = segment.split(/\s+/).map(cleanWord).filter((word) => word.length > 0);
  return words.length > 0 && words.every((word) => NUMBER_OR_ORDINAL.test(word) || EDITION_WORDS.has(word));
}

/**
 * Index of the last " - " that sits outside any (...) or [...] group, or -1. A dash inside
 * a group, as in "Live (London - 1991)", is part of protected title text, not a suffix.
 */
function lastTopLevelDash(title: string): number {
  let depth = 0;
  let found = -1;
  for (let i = 0; i < title.length; i++) {
    const char = title[i];
    if (char === '(' || char === '[') depth++;
    else if ((char === ')' || char === ']') && depth > 0) depth--;
    else if (depth === 0 && title.startsWith(DASH_SEPARATOR, i)) found = i;
  }
  return found;
}

/** Removes one trailing edition group or dash segment, or returns null if there is none. */
function stripOneEdition(title: string): string | null {
  for (const pattern of [TRAILING_PAREN, TRAILING_BRACKET]) {
    const match = pattern.exec(title);
    if (match && isEditionSegment(match[1])) {
      return title.slice(0, match.index).trimEnd();
    }
  }

  const dashIndex = lastTopLevelDash(title);
  if (dashIndex !== -1 && isEditionSegment(title.slice(dashIndex + DASH_SEPARATOR.length))) {
    return title.slice(0, dashIndex).trimEnd();
  }

  return null;
}

/**
 * Folds a name to a comparison key: Latin accents, case, curly quotes, `&`, a leading "The"
 * and punctuation are ignored. Letters, numbers and combining marks in other scripts are kept.
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    // Only Latin combining diacritics, so 'Rós' folds to 'ros'; marks that are part of other
    // scripts, such as Devanagari vowel signs or the kana handakuten, must survive.
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/&/g, ' and ')
    // Emoji variation selectors (U+FE0F) and keycap marks (U+20E3) are marks with no letter of
    // their own, so they would otherwise survive the filter below after their emoji is dropped.
    .replace(/[\p{Variation_Selector}\p{Me}]/gu, '')
    // Keeps \p{M} too: a Devanagari vowel sign such as U+093F is a mark, and dropping it
    // would fold दिल into दल.
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    // After punctuation removal, so '"The Cure"' and 'The Cure' both lose the article.
    .replace(/^the /, '');
}

/**
 * Repeatedly strips trailing "(...)", "[...]" or " - ..." segments made only of edition
 * words (remaster, deluxe, live, years, ordinals...). Anything else, such as
 * "(Deliverance)" or "- Live at Wembley Stadium", is part of the title and stays.
 */
export function stripEdition(title: string): string {
  let current = title.trim();
  let stripped = stripOneEdition(current);
  while (stripped !== null) {
    current = stripped;
    stripped = stripOneEdition(current);
  }
  return current;
}

/**
 * Picks the album whose credited artists include the requested artist (whole name) and
 * whose title matches exactly, falling back to a match with edition suffixes stripped.
 */
export function pickAlbumMatch(
  candidates: LookupAlbumCandidate[],
  artist: string,
  album: string,
): LookupAlbumCandidate | null {
  const wantedArtist = normalizeName(artist);
  const wantedAlbum = normalizeName(album);
  if (!wantedArtist || !wantedAlbum) return null;

  const byArtist = candidates.filter((candidate) =>
    candidate.artists.some((name) => normalizeName(name) === wantedArtist),
  );

  const exact = byArtist.find((candidate) => normalizeName(candidate.name) === wantedAlbum);
  if (exact) return exact;

  const wantedBase = normalizeName(stripEdition(album));
  if (!wantedBase) return null;
  return byArtist.find((candidate) => normalizeName(stripEdition(candidate.name)) === wantedBase) ?? null;
}

/** Picks the first artist whose normalized name equals the request, or null. */
export function pickArtistMatch(
  candidates: LookupArtistCandidate[],
  artist: string,
): LookupArtistCandidate | null {
  const wanted = normalizeName(artist);
  if (!wanted) return null;
  return candidates.find((candidate) => normalizeName(candidate.name) === wanted) ?? null;
}
