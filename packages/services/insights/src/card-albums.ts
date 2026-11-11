// ABOUTME: The week card's candidate albums (spec section 1, "Candidate albums") and the card's cache signature.
// ABOUTME: Candidates come from the top facts' typed album identities and 6+-track runs, ordered by plays this week.

import { PROMPT_FACTS, hashSignature } from './render';
import type { AlbumRun } from './runs';
import { standoutAlbum } from './standout';
import { albumKey } from './types';
import type { AlbumRef, CardAlbum, Fact, Scrobble, WeekFacts } from './types';

/** How many candidate albums a card considers. */
export const CARD_CANDIDATES = 6;
/** Bump when the card's choice of album or its tie-back rules change, so cached cards are not reused. */
export const CARD_VERSION = 'c1';
/** Distinct tracks a run needs for its album to be a candidate, whatever the run's verdict. */
const RUN_MIN_TRACKS = 6;

/**
 * The card's candidate albums: every album the top six facts name, plus every run of 6 or more tracks this week,
 * whatever its verdict. Each album appears once (by albumKey, spelled as first seen, facts first), with its deduped
 * plays this week. Ordered by plays, then album name, then artist name; capped at CARD_CANDIDATES.
 * `week` is this week's deduped scrobbles.
 */
export function cardAlbums(facts: Fact[], runs: AlbumRun[], week: Scrobble[]): CardAlbum[] {
  const refs: AlbumRef[] = [
    ...facts.slice(0, PROMPT_FACTS).flatMap((f) => f.albums),
    ...runs.filter((r) => r.tracksPlayed >= RUN_MIN_TRACKS).map(({ artist, album }) => ({ artist, album })),
  ];
  const plays = new Map<string, number>();
  for (const s of week) {
    const key = albumKey(s.artist, s.album);
    plays.set(key, (plays.get(key) ?? 0) + 1);
  }
  const byKey = new Map<string, CardAlbum>();
  for (const { artist, album } of refs) {
    const key = albumKey(artist, album);
    if (!byKey.has(key)) byKey.set(key, { artist, album, plays: plays.get(key) ?? 0 });
  }
  return [...byKey.values()]
    .sort((a, b) => b.plays - a.plays || a.album.localeCompare(b.album) || a.artist.localeCompare(b.artist))
    .slice(0, CARD_CANDIDATES);
}

/**
 * The card's cache signature: the first 16 hex characters of SHA-256 over the rule version, CARD_VERSION, the top
 * six facts' ids, kinds and statements, the candidate albums and the standout album. Those decide which albums the
 * card looks at and its making-of fallback; pulledAt and the window are left out, so a moving window with the same
 * facts reuses the card. Whether its tie-backs still hold for the library is the eligibility key's job, not this one's.
 */
export async function cardSignature(wf: WeekFacts): Promise<string> {
  return hashSignature([
    wf.ruleVersion,
    CARD_VERSION,
    wf.facts.slice(0, PROMPT_FACTS).map((f) => [f.id, f.kind, f.statement]),
    wf.cardAlbums,
    standoutAlbum(wf),
  ]);
}
