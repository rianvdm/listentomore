// ABOUTME: KV keys for the insights pipeline: per-user history partitions and lookups, global tracklists and
// ABOUTME: tags and making-of facts, the per-user facts, question, marker, last-note and card keys, and delete lists.

import { stripEdition } from './match';
import { norm } from './text';

/** Last.fm usernames are case-insensitive, so every per-user key uses the lower-cased name. */
const u = (user: string): string => user.toLowerCase();
/**
 * A normalised name as one key segment. Percent-encoding escapes ':' (and '%'), so in a key with two names
 * ('A:B' + 'C' against 'A' + 'B:C') each segment's boundary is unambiguous.
 */
const segment = (name: string): string => encodeURIComponent(norm(name));

export const keys = {
  /** One UTC day ('YYYY-MM-DD') of a user's scrobbles. */
  scrobbleDay: (user: string, day: string): string => `lastfm:scrobbles:${u(user)}:${day}`,
  /** One weekly artist chart of a user, by its Last.fm boundaries. */
  chart: (user: string, from: number, to: number): string => `lastfm:chart:${u(user)}:${from}-${to}`,
  /** A user's top artists for a Last.fm period ('3month', '6month', '12month', 'overall'). */
  topList: (user: string, period: string): string => `lastfm:toplist:${u(user)}:${period}`,
  /** A user's lifetime plays of one artist. */
  userArtist: (user: string, artist: string): string => `lastfm:userartist:${u(user)}:${norm(artist)}`,
  /** An album's tracklist; global, so it never holds a user's count. Artist and album are encoded segments. */
  tracklist: (artist: string, album: string): string => `lastfm:tracklist:${segment(artist)}:${segment(album)}`,
  /** A user's plays of one album, kept apart from the global tracklist. The user segment stays plain for the delete prefix. */
  userAlbum: (user: string, artist: string, album: string): string =>
    `lastfm:useralbum:${u(user)}:${segment(artist)}:${segment(album)}`,
  /** An artist's top tags; global. */
  topTags: (artist: string): string => `lastfm:toptags:${norm(artist)}`,
  /** The user's computed WeekFacts. */
  facts: (user: string): string => `insights:facts:${u(user)}`,
  /** The owner's last question, for rotation. */
  question: (user: string): string => `insights:question:${u(user)}`,
  /** Set while a generation runs. */
  generating: (user: string): string => `insights:generating:${u(user)}`,
  /** `{ signature }` of the note last served to the owner. */
  last: (user: string): string => `insights:last:${u(user)}`,
  /** The profile's card result for its facts signature: the card, or null when the week has none. */
  card: (user: string): string => `insights:card:${u(user)}`,
  /**
   * An album's making-of fact, or `{ none: true }`; global, with no user data. Artist and album are encoded segments,
   * the album without an edition suffix, so every edition of a record reads, writes and deletes one entry.
   */
  trivia: (artist: string, album: string): string => `insights:trivia:${segment(artist)}:${segment(stripEdition(album))}`,
};

/**
 * Prefixes of the multi-key families that hold one user's data. Each ends in ':' so that one user's
 * prefix never matches another's ('lastfm:scrobbles:alice:' cannot match 'alice2').
 */
export function userKeyPrefixes(user: string): string[] {
  return [
    `lastfm:scrobbles:${u(user)}:`,
    `lastfm:chart:${u(user)}:`,
    `lastfm:toplist:${u(user)}:`,
    `lastfm:userartist:${u(user)}:`,
    `lastfm:useralbum:${u(user)}:`,
    `ai:userInsightsSummary:${u(user)}:`,
  ];
}

/**
 * The single-key families of one user. Delete these by exact key, never by prefix:
 * 'insights:facts:alice' is a prefix of 'insights:facts:alice2'.
 */
export function userExactKeys(user: string): string[] {
  return [keys.facts(user), keys.question(user), keys.generating(user), keys.last(user), keys.card(user)];
}
