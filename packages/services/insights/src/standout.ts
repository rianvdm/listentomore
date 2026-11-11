// ABOUTME: Picks the week's standout album - the album of the highest-ranked album fact among the top three - for
// ABOUTME: the card's making-of fallback and its signature. Reads each fact kind's album the way its builder records it.

import type { Fact, WeekFacts } from './types';

/** How many of the ranked facts can supply the standout album. */
const STANDOUT_RANKS = 3;

export interface StandoutAlbum { artist: string; album: string }

/**
 * The album of the highest-ranked fact among the top three that is about one, or null when none is. Album facts
 * are repeat albums, single listens, album chains, release-week facts, and volume facts that absorbed a single
 * listen. It never orders the card's candidates (card-albums.ts): those go by plays this week.
 */
export function standoutAlbum(wf: Pick<WeekFacts, 'facts'>): StandoutAlbum | null {
  for (const f of wf.facts.slice(0, STANDOUT_RANKS)) {
    const found = albumOf(f);
    if (found) return found;
  }
  return null;
}

function albumOf(f: Fact): StandoutAlbum | null {
  switch (f.kind) {
    case 'repeat_album':
    case 'single_listen':
    case 'volume_vs_normal':
      return f.subject === null ? null : listenedAlbum(f, f.subject);
    case 'album_chain':
      return firstChainAlbum(f);
    case 'release_week':
      return f.albums.length > 0 ? { ...f.albums[0] } : null;
    default:
      return null;
  }
}

/**
 * A repeat album writes "<album> by <artist>" and a single listen "<artist> on <day>: <run>", so their entity
 * order differs, and a self-titled album is recorded once. Both always type the listen's count against the album
 * ("2 times", "in one run"), and a volume fact carries that quantity only when it absorbed a single listen; its
 * own statement names just the artist. So the album is the entity of the first count of times, whatever the order.
 */
function listenedAlbum(f: Fact, artist: string): StandoutAlbum | null {
  const album = f.quantities.find((q) => q.unit === 'times' && q.entity !== undefined)?.entity;
  return album === undefined ? null : { artist, album };
}

/**
 * A chain writes "<day>: N albums back to back, start to finish: <album> (<artist>), ...". Its first entity is the
 * first album; the artist is the entity written in brackets straight after it, which is the album itself when
 * the album is self-titled (the builder records the repeated name once).
 */
function firstChainAlbum(f: Fact): StandoutAlbum | null {
  const album = f.entities[0];
  if (album === undefined) return null;
  const artist = f.entities.find((e) => f.statement.includes(`${album} (${e})`));
  return artist === undefined ? null : { artist, album };
}
