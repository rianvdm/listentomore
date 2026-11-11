// ABOUTME: The card for /api/internal/user-insights-trivia: serves the profile's cached card from the cached week facts,
// ABOUTME: and only on the owner's view generates one through MusicBrainz, Spotify art and the making-of fact.

import type { Context } from 'hono';
import { CACHE_CONFIG, getTtlSeconds } from '@listentomore/config';
import type { AIService } from '@listentomore/ai';
import type { User } from '@listentomore/db';
import { cardSignature, eligibilityKey, keys, libraryFrom } from '@listentomore/insights';
import type { CountList, Viewer, WeekFacts } from '@listentomore/insights';
import { MusicBrainzCredits } from '@listentomore/musicbrainz';
import type { SpotifyService } from '@listentomore/spotify';
import type { InternalAppContext } from '../../types';
import { getMusicBrainzLimiter } from '../../utils/musicbrainz-limiter';
import { CARD_MB_CALLS, generateCard, isCachedCard, isCardValid, renderCard } from './insights-card';
import type { CachedCard, TriviaCard } from './insights-card';
import { makingOfFact } from './insights-making-of';
import { MIN_WEEK_PLAYS, isCurrentFacts, readJson, writeJson } from './insights-week';

export interface TriviaCardArgs {
  /** The profile's user; the caller has checked visibility. */
  user: User;
  isOwner: boolean;
}

const hasCounts = (value: unknown): value is Pick<CountList, 'counts'> => {
  const counts = (value as { counts?: unknown } | null)?.counts;
  return typeof counts === 'object' && counts !== null;
};

/**
 * The profile's card for this viewer, or null. Makes no Last.fm call: it needs the cached week facts and the cached
 * overall top-artist list, and returns null without either. A cached card that still holds for the facts signature
 * and the library is rendered for the viewer. Otherwise a visitor gets null, and the owner generates: a cut request
 * (MusicBrainz cap or error, making-of error) returns null and caches nothing, so the next view continues; any other
 * result is cached, a week with no card as null. Logs the outcome and the MusicBrainz call count only: no username
 * or name.
 */
export async function getTriviaCard(
  c: Context<InternalAppContext>,
  { user, isOwner }: TriviaCardArgs,
): Promise<TriviaCard | null> {
  const kv = c.env.CACHE;
  const lastfmUser = user.lastfm_username;
  if (!lastfmUser) throw new Error('getTriviaCard needs a user with a Last.fm username');

  const wf = await readJson<WeekFacts>(kv, keys.facts(lastfmUser));
  if (!isCurrentFacts(wf) || wf.plays.deduped < MIN_WEEK_PLAYS || !Array.isArray(wf.cardAlbums) || wf.cardAlbums.length === 0) {
    return null;
  }
  const overall = await readJson<unknown>(kv, keys.topList(lastfmUser, 'overall'));
  if (!hasCounts(overall)) return null;
  const library = libraryFrom(overall);

  const viewer: Viewer = isOwner ? { person: 'second' } : { person: 'third', name: user.username || lastfmUser };
  const signature = await cardSignature(wf);
  const cached = await readJson<unknown>(kv, keys.card(lastfmUser));
  if (isCachedCard(cached) && isCardValid(cached, signature, library)) {
    return cached.card ? renderCard(cached.card, viewer, library) : null;
  }

  // Only the owner's view starts MusicBrainz, Spotify or web-search work.
  if (!isOwner) return null;

  const ai = c.get('ai') as AIService;
  const spotify = c.get('spotify') as SpotifyService;
  const credits = new MusicBrainzCredits(kv, getMusicBrainzLimiter(c.env.MUSICBRAINZ_RATE_LIMITER), {
    maxCalls: CARD_MB_CALLS,
  });
  const outcome = await generateCard(
    {
      credits,
      makingOf: (artist, album) => makingOfFact(ai, kv, artist, album),
      albumArt: async (artist, album) =>
        (await spotify.search.searchAlbumByArtist(artist, album, { quiet: true }))?.image ?? null,
    },
    wf,
    library,
  );

  const label = outcome.status === 'card' ? outcome.card.kind : outcome.status;
  const reason = outcome.status === 'cut' ? ` reason=${outcome.reason}` : '';
  console.log(`[Insights] card: ${label} mb_calls=${credits.calls}${reason}`);

  if (outcome.status === 'cut') return null;
  const card = outcome.status === 'card' ? outcome.card : null;
  const entry: CachedCard = {
    signature,
    considered: outcome.considered,
    eligible: eligibilityKey(outcome.considered, library),
    card,
  };
  await writeJson(kv, keys.card(lastfmUser), entry, getTtlSeconds(CACHE_CONFIG.userInsights.card));
  return card ? renderCard(card, viewer, library) : null;
}
