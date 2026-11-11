// ABOUTME: Pure helpers for scripts/insights-eval.ts: the output directory kept inside eval-output/, the names the
// ABOUTME: rubric masks, the shared MusicBrainz limiter, the known tie-back report and the making-of fact-check list.

import { isAbsolute, join, relative, resolve } from 'node:path';
import { matchKey } from '@listentomore/insights';
import type { CardAlbum, WeekFacts } from '@listentomore/insights';
import { MUSICBRAINZ_INTERVAL_MS, reserveSlot } from '@listentomore/musicbrainz';
import type { MusicBrainzRateLimiter } from '@listentomore/musicbrainz';
import type { CheckedAlbum, TriviaCard } from '../src/api/internal/insights-card';

/**
 * `<webRoot>/eval-output/<label>/insights`. Throws for a label that is empty, holds anything but letters, digits, dot,
 * dash and underscore, contains '..' or is '.', and checks the resolved path is inside eval-output/ besides: the
 * output holds prompt views and notes, and only eval-output/ is gitignored.
 */
export function evalOutputDir(webRoot: string, label: string): string {
  if (!/^[\w.-]+$/.test(label) || label === '.' || label.includes('..')) {
    throw new Error('--label must be letters, digits, dot, dash or underscore, and not "." or contain ".."');
  }
  const base = resolve(webRoot, 'eval-output');
  const dir = resolve(join(base, label, 'insights'));
  const rel = relative(base, dir);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('--label resolves outside eval-output/');
  }
  return dir;
}

/** Every artist and album name of the week the note may name: the scrobbles' names and every fact's entities. */
export function noteNames(wf: WeekFacts): string[] {
  return [...new Set([...wf.names, ...[wf.windowFact, ...wf.facts].flatMap((f) => f.entities)])];
}

/** A tie-back the recon found by hand, which the eval looks for whenever its album is a card candidate. */
export interface KnownTieBack { album: string; bands: string[] }

/** The known tie-backs from the recon (spec "Tests and eval"). */
export const KNOWN_TIEBACKS: KnownTieBack[] = [
  { album: 'Los Ojos Del Cóndor', bands: ['The Black Keys'] },
  { album: 'Earthling', bands: ['Red Hot Chili Peppers', 'Tom Petty and the Heartbreakers'] },
  { album: 'Sea Change', bands: ['Nine Inch Nails'] },
  { album: 'In Rainbows', bands: ['The Smile'] },
];

/** Where a known tie-back's album got to in a week's card run, and for a checked album whether the tie-back appeared. */
export type KnownTieBackStatus = 'checked: found' | 'checked: missing' | 'unchecked (cut)' | 'not a candidate';

/**
 * One row per known album and band, in list order, matching titles by matchKey. An album among the week's candidates
 * (`wf.cardAlbums`) is checked when the card run reached it, found when it has a tie-back to that band and missing
 * when not, and unchecked (cut) when the run stopped first (a cut request, or an exhaustive run that stopped at an
 * error past its tie-back). A week with no tie-back is an acceptable result; this only says which known ones appeared.
 */
export function knownTieBackReport(
  candidates: CardAlbum[],
  checked: CheckedAlbum[],
  known: KnownTieBack[] = KNOWN_TIEBACKS,
): Array<{ album: string; band: string; status: KnownTieBackStatus }> {
  return known.flatMap(({ album, bands }) => {
    const key = matchKey(album);
    const matches = checked.filter((c) => matchKey(c.album.album) === key);
    const found = new Set(matches.flatMap((c) => (c.tieBacks ?? []).map((t) => matchKey(t.band))));
    const candidate = candidates.some((c) => matchKey(c.album) === key);
    return bands.map((band): { album: string; band: string; status: KnownTieBackStatus } => {
      if (matches.length > 0) return { album, band, status: found.has(matchKey(band)) ? 'checked: found' : 'checked: missing' };
      return { album, band, status: candidate ? 'unchecked (cut)' : 'not a candidate' };
    });
  });
}

/**
 * The production slot reservation over in-memory state, for scripts: one instance shared by every MusicBrainzCredits
 * client in a process keeps all their requests MUSICBRAINZ_INTERVAL_MS apart, as the Durable Object does in the Worker.
 */
export function createLocalLimiter(now: () => number = Date.now): MusicBrainzRateLimiter {
  let nextSlotAt = 0;
  return {
    async reserve(maxWaitMs: number): Promise<number | null> {
      const result = reserveSlot(nextSlotAt, now(), maxWaitMs, MUSICBRAINZ_INTERVAL_MS);
      nextSlotAt = result.nextSlotAt;
      return result.waitMs;
    },
  };
}

/**
 * Runs tasks one at a time in call order. The eval runs fixtures concurrently, and MusicBrainz callers decline a slot
 * more than a few seconds away, so each fixture's MusicBrainz work goes through one of these.
 */
export function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}

/** The .dev.vars key holding each provider's API key. */
const PROVIDER_KEYS: Record<'openai' | 'anthropic', string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

/** The .dev.vars keys a live run needs: the key of each provider its tasks use, plus Spotify's credentials with --trivia. */
export function requiredDevVars(providers: Array<'openai' | 'anthropic'>, trivia: boolean): string[] {
  const keys = [...new Set(providers.map((p) => PROVIDER_KEYS[p]))];
  return trivia ? [...keys, 'SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET'] : keys;
}

/**
 * A message naming every required key that apps/web/.dev.vars lacks or leaves empty, or null when all are set. Keys
 * come from .dev.vars only, never process.env, and the message carries key names, never a value.
 */
export function missingDevVarsError(devVars: Record<string, string>, required: string[]): string | null {
  const missing = required.filter((key) => !devVars[key]);
  return missing.length > 0 ? `apps/web/.dev.vars is missing ${missing.join(', ')}` : null;
}

/** What the eval's verdict reads from one week's card record. */
export interface CardVerdict {
  /** Why the card route would not generate for this week, or null. */
  skipped: string | null;
  /** 'error' when the card run threw; null when it never ran. */
  status: 'card' | 'none' | 'cut' | 'error' | null;
  cutReason: string | null;
  /** Copy rubric hits on the card text. */
  rubric: string[];
}

/**
 * Why a week's card fails the eval, or null. A cut or an error means the card is unknown, so an outage on
 * MusicBrainz or the making-of call fails the run instead of passing as a week without a card. A card that trips
 * the copy rubric fails too. No card ('none'), a week the route would skip, and a run without --trivia pass.
 */
export function cardFailure(card: CardVerdict | null): string | null {
  if (card === null || card.skipped !== null) return null;
  if (card.status === 'cut') return `card cut: ${card.cutReason ?? 'unknown'}`;
  if (card.status === 'error') return 'card error';
  if (card.rubric.length > 0) return `card rubric: ${card.rubric.join(', ')}`;
  return null;
}

/** The making-of facts to spot-check, one line each with the source URL: '- <fixture>: <album> (<artist>): <text> <url>'. */
export function factCheckLines(cards: Array<{ fixture: string; card: TriviaCard | null }>): string[] {
  return cards.flatMap(({ fixture, card }) =>
    card?.kind === 'making_of' ? [`- ${fixture}: ${card.album} (${card.artist}): ${card.text} ${card.sourceUrl ?? ''}`] : [],
  );
}
