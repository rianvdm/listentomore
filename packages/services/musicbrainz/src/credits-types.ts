// ABOUTME: Types for MusicBrainz release credits and band membership used by the insights trivia card.
// ABOUTME: Plain data shapes, safe to cache as JSON and share across users.

/** A MusicBrainz artist (person or group) by MBID and canonical name. */
export interface CreditArtist {
  id: string;
  name: string;
}

/**
 * One person's role on a release.
 * `type` is the MusicBrainz relation type ('producer', 'instrument', 'vocal', ...), or
 * 'performer' for a track artist credit. `attributes` holds relation attributes such as
 * 'bass guitar' or 'co'.
 */
export interface Credit {
  artist: CreditArtist;
  type: string;
  attributes: string[];
  level: 'release' | 'recording' | 'track';
}

/** The credited album artists and everyone else credited on one release. */
export interface ReleaseCredits {
  releaseId: string;
  artists: CreditArtist[];
  credits: Credit[];
}

/**
 * An artist's `member of band` links, touring stints excluded.
 * `memberOf` lists the bands a person has played in; `members` lists a band's members.
 * `ended` is true when every stint in that band has ended.
 */
export interface ArtistBands {
  artist: CreditArtist;
  type: string | null;
  memberOf: Array<{ band: CreditArtist; ended: boolean }>;
  members: Array<{ person: CreditArtist; ended: boolean }>;
}

/** The release group found for an artist and album, and its earliest official release. */
export interface ReleaseRef {
  releaseGroupId: string;
  releaseId: string;
}

/** Budgeted, cached MusicBrainz credits lookups. */
export interface CreditsClient {
  findRelease(artist: string, album: string): Promise<ReleaseRef | null>;
  releaseCredits(releaseId: string): Promise<ReleaseCredits | null>;
  artistBands(artistId: string): Promise<ArtistBands | null>;
  /** Network calls this instance made; cache reads are free. */
  readonly calls: number;
}
