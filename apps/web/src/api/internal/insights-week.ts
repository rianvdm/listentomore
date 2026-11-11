// ABOUTME: The week note for /api/internal/user-insights-summary: computes or reuses a user's WeekFacts, then serves
// ABOUTME: the owner a guarded Claude note (or the code line) and a visitor the third-person line (spec sections 3-5).

import type { Context } from 'hono';
import { CACHE_CONFIG, getTtlSeconds } from '@listentomore/config';
import { USER_INSIGHTS_PROMPT_VERSION, aiCacheKey, isCacheableResponse } from '@listentomore/ai';
import type { AIService, UserInsightsNoteResult } from '@listentomore/ai';
import type { User } from '@listentomore/db';
import {
  RULE_VERSION,
  buildWeekFacts,
  chooseQuestion,
  collectWeekInputs,
  guardNote,
  keys,
  noteSignature,
  renderLine,
  renderPromptView,
} from '@listentomore/insights';
import type { LastfmHistoryClient, NoteSentence, QuestionKind, ReleaseLookup, WeekFacts } from '@listentomore/insights';
import { createServiceDefer } from '@listentomore/shared';
import type { SpotifyService } from '@listentomore/spotify';
import type { InternalAppContext } from '../../types';
import { errorKind } from '../../utils/error-kind';
import { getWaitUntil } from '../../utils/wait-until';

/** Under this many deduplicated plays this week, the route keeps its sparse message (spec section 2, "Quiet week"). */
export const MIN_WEEK_PLAYS = 5;
/** One regeneration after a failed guard, then the code line (spec section 3). */
const NOTE_ATTEMPTS = 2;
/** The facts named in the generation log line: the six the prompt view shows. */
const LOGGED_FACTS = 6;

export interface WeekInsightsResponse {
  note: string;                 // sentences joined by a space, or the code line
  question: string | null;      // owner only
  header: string;               // 'Your week' | "<username>'s week"
  pulledAt: string;             // ISO
  mode: 'note' | 'line' | 'quiet';
  refreshing?: boolean;
}

export interface WeekInsightsArgs {
  /** The profile's user; the caller has checked visibility and that it has a Last.fm username. */
  user: User;
  isOwner: boolean;
  /** Owner only; the caller has checked the owner and the cooldown. Discards the cached facts. */
  refresh: boolean;
  /** The profile user's Last.fm history client (`LastfmService.history`). */
  history: LastfmHistoryClient;
}

/** The note cache entry, under `ai:userInsightsSummary:<user>:<signature>`. */
interface CachedNote { note: string }
/** The pointer to the note last served to the owner, read while another request is generating. */
interface LastNote { signature: string; pulledAt: string }
/**
 * The owner's last question, for rotation, with the note signature it was served with. Older entries may lack the
 * signature; they rotate as usual.
 */
interface StoredQuestion { kind: QuestionKind; subject: string; signature?: string }


/** Guard failure types that end in a fixed word, kept for the log ('shape:lead', 's2:banned:never'). */
const NAMED_FAILURES: ReadonlySet<string> = new Set(['shape', 'banned', 'punctuation']);
/** Guard failure types whose payload is a value, unit, date or fact id, logged as the type alone. */
const VALUED_FAILURES: ReadonlySet<string> = new Set(['quantity', 'quantity-unit', 'quantity-entity', 'name', 'date', 'day', 'month']);

/**
 * Guard failure codes reduced to what a log line may carry: the sentence position and the failure type, with every
 * value, unit, date and fact id dropped ('s2:quantity-entity:41:plays' -> 's2:quantity-entity'). A type the guard
 * adds later reads as 'other' until it is listed here. The guard's own result is not changed.
 */
export function logSafeFailures(failures: readonly string[]): string[] {
  return failures.map((failure) => {
    const parts = failure.split(':');
    const position = /^s\d+$/.test(parts[0]) ? `${parts.shift()}:` : '';
    const [type, word] = parts;
    if (NAMED_FAILURES.has(type)) return `${position}${type}${word && /^[a-z-]+$/.test(word) ? `:${word}` : ''}`;
    return `${position}${VALUED_FAILURES.has(type) ? type : 'other'}`;
  });
}

/**
 * A key's family, its first two segments ('insights:card', 'lastfm:toplist'), for log lines: the rest of a key holds
 * a username or a name.
 */
const keyFamily = (key: string): string => key.split(':').slice(0, 2).join(':');

/**
 * A KV JSON read where a failed read is a miss: every cache here is an optimisation. Logs a fixed code and the key
 * family only: a JSON parse error quotes the stored value, and a KV error can quote the key.
 */
export async function readJson<T>(kv: KVNamespace, key: string): Promise<T | null> {
  try {
    return (await kv.get(key, 'json')) as T | null;
  } catch (error) {
    const code = error instanceof SyntaxError ? 'cache-read:parse' : 'cache-read:error';
    console.error(`[Insights] ${code} ${keyFamily(key)}`);
    return null;
  }
}

/** An awaited KV write that logs a fixed code and the key family instead of failing the request. */
export async function writeJson(kv: KVNamespace, key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    await kv.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds });
  } catch {
    console.error(`[Insights] cache-write:error ${keyFamily(key)}`);
  }
}

/**
 * The note cache key, `ai:userInsightsSummary:<user>:<signature>`. The note is read and written through readJson and
 * writeJson, not AICache, whose log lines carry the key and so the username.
 */
const noteKey = (user: string, signature: string): string => aiCacheKey('userInsightsSummary', user, signature);

/** The cached note for a signature, where a failed or malformed read is a miss. */
async function readNote(kv: KVNamespace, user: string, signature: string): Promise<CachedNote | null> {
  const cached = await readJson<CachedNote>(kv, noteKey(user, signature));
  return cached && typeof cached.note === 'string' ? cached : null;
}

/** A best-effort KV delete that logs a fixed code and the key family. */
async function deleteKey(kv: KVNamespace, key: string): Promise<void> {
  try {
    await kv.delete(key);
  } catch {
    console.error(`[Insights] cache-delete:error ${keyFamily(key)}`);
  }
}

/** Wraps the history client to count its calls by method, for the generation log line. */
function countingClient(client: LastfmHistoryClient): { client: LastfmHistoryClient; calls: Record<string, number> } {
  const calls: Record<string, number> = {};
  const counted = <A extends unknown[], R>(method: keyof LastfmHistoryClient, fn: (...args: A) => R) =>
    (...args: A): R => {
      calls[method] = (calls[method] ?? 0) + 1;
      return fn(...args);
    };
  return {
    calls,
    client: {
      getRecentTracksPage: counted('getRecentTracksPage', client.getRecentTracksPage.bind(client)),
      getWeeklyChartList: counted('getWeeklyChartList', client.getWeeklyChartList.bind(client)),
      getWeeklyArtistChart: counted('getWeeklyArtistChart', client.getWeeklyArtistChart.bind(client)),
      getTopArtistsPage: counted('getTopArtistsPage', client.getTopArtistsPage.bind(client)),
      getUserArtistPlaycount: counted('getUserArtistPlaycount', client.getUserArtistPlaycount.bind(client)),
      getAlbumInfo: counted('getAlbumInfo', client.getAlbumInfo.bind(client)),
      getArtistTopTags: counted('getArtistTopTags', client.getArtistTopTags.bind(client)),
    },
  };
}

/**
 * While another request generates, the note last served to the owner, if it is still cached. Best effort: any
 * failure reads as "no previous note" and this request generates too.
 */
async function previousNote(kv: KVNamespace, user: string): Promise<(CachedNote & LastNote) | null> {
  let generating: string | null;
  try {
    generating = await kv.get(keys.generating(user));
  } catch {
    console.error(`[Insights] cache-read:error ${keyFamily(keys.generating(user))}`);
    return null;
  }
  if (generating === null) return null;
  const last = await readJson<LastNote>(kv, keys.last(user));
  if (!last || typeof last.signature !== 'string') return null;
  const cached = await readNote(kv, user, last.signature);
  return cached ? { note: cached.note, ...last } : null;
}

/**
 * The owner's question. Under the same note signature the stored question is served again, so reloads of the same
 * facts never flip it; otherwise it rotates against the stored one (chooseQuestion). Chosen at serve time, so facts a
 * visitor computed (without the question state) still rotate correctly for the owner.
 */
function ownerQuestion(wf: WeekFacts, stored: StoredQuestion | null, signature: string): WeekFacts['question'] {
  if (stored && stored.signature === signature) {
    for (const fact of wf.facts) {
      if ((fact.subject ?? '') !== stored.subject) continue;
      const edge = fact.edges.find((e) => e.kind === stored.kind);
      if (edge) return { ...edge, subject: stored.subject };
    }
  }
  return chooseQuestion(wf.facts, stored);
}

/** Cached facts are reused only when this code computed them: a rule change recomputes instead of serving old facts. */
export const isCurrentFacts = (wf: WeekFacts | null): wf is WeekFacts =>
  wf !== null && wf.schema === 'week-facts/v1' && wf.ruleVersion === RULE_VERSION;

/**
 * Whether this viewer can serve the cached facts. The owner also needs facts computed with release lookups: facts a
 * visitor computed have none, so the owner's next load recomputes them once, mostly from cached Last.fm data.
 */
const isUsableFacts = (wf: WeekFacts | null, isOwner: boolean): wf is WeekFacts =>
  isCurrentFacts(wf) && (!isOwner || wf.releasesChecked === true);

/**
 * The release_week lookup: Spotify's album search, quiet so no log line carries the names, mapped to the title,
 * artists and release date as Spotify gives them. Only the owner's view passes it to the collector.
 */
export function spotifyReleaseLookup(spotify: SpotifyService): ReleaseLookup {
  return async (artist, album) => {
    const result = await spotify.searchAlbumByArtist(artist, album, { quiet: true });
    return result ? { title: result.name, artist: result.artist, date: result.releaseDate } : null;
  };
}

/**
 * Calls the model up to twice and returns the first note that passes the guard, or null. A thrown call, an
 * unparseable reply and a guard failure each use one attempt. Logs failure types only, never the text or a value.
 */
async function guardedNote(
  ai: AIService,
  wf: WeekFacts,
): Promise<{ sentences: NoteSentence[]; result: UserInsightsNoteResult } | null> {
  const promptView = renderPromptView(wf);
  for (let attempt = 1; attempt <= NOTE_ATTEMPTS; attempt++) {
    let result: UserInsightsNoteResult;
    try {
      result = await ai.getUserInsightsNote(promptView);
    } catch (error) {
      console.error(`[Insights] note-attempt:${attempt} call-failed kind=${errorKind(error)}`);
      continue;
    }
    if (result.sentences === null) {
      console.log(`[Insights] note-attempt:${attempt} unparseable`);
      continue;
    }
    const verdict = guardNote(result.sentences, wf);
    if (verdict.ok) return { sentences: result.sentences, result };
    console.log(`[Insights] note-attempt:${attempt} guard-failed ${logSafeFailures(verdict.failures).join(', ')}`);
  }
  return null;
}

/**
 * The week for one profile. Returns null when the week has under MIN_WEEK_PLAYS deduplicated plays (the route's
 * sparse message). Throws InsightsFetchError when the current week cannot be read; nothing is cached then.
 *
 * Visitors get the code-rendered third-person line and never touch the note, the last-note pointer or the question
 * state. Only the owner gets a model call, and only on a week that is not quiet and whose note is not cached.
 */
export async function getWeekInsights(
  c: Context<InternalAppContext>,
  { user, isOwner, refresh, history }: WeekInsightsArgs,
): Promise<WeekInsightsResponse | null> {
  const kv = c.env.CACHE;
  const ai = c.get('ai') as AIService;
  const lastfmUser = user.lastfm_username;
  if (!lastfmUser) throw new Error('getWeekInsights needs a user with a Last.fm username');
  // The profile's display name, the one the insights page shows.
  const displayName = user.username || lastfmUser;
  const header = isOwner ? 'Your week' : `${displayName}'s week`;

  // The owner's last question: read once, only for the owner; visitors never touch question state.
  let storedQuestion: StoredQuestion | null | undefined;
  const lastQuestion = async (): Promise<StoredQuestion | null> => {
    if (!isOwner) return null;
    if (storedQuestion === undefined) storedQuestion = await readJson<StoredQuestion>(kv, keys.question(lastfmUser));
    return storedQuestion;
  };

  // Refresh discards the cached facts. The delete is best effort: this request skips them whether or not it worked,
  // and the recomputed facts overwrite them below.
  if (refresh) await deleteKey(kv, keys.facts(lastfmUser));

  let markerSet = false;
  try {
    let wf = refresh ? null : await readJson<WeekFacts>(kv, keys.facts(lastfmUser));

    if (!isUsableFacts(wf, isOwner)) {
      // Another request is generating: the owner gets the note last served, flagged, instead of a duplicate run.
      // Visitors never get the note, so they carry on.
      const previous = isOwner ? await previousNote(kv, lastfmUser) : null;
      if (previous) {
        return { note: previous.note, question: null, header, pulledAt: previous.pulledAt, mode: 'note', refreshing: true };
      }

      // Best effort: correctness never depends on the marker (spec section 5, "Concurrency").
      try {
        await kv.put(keys.generating(lastfmUser), '1', {
          expirationTtl: getTtlSeconds(CACHE_CONFIG.userInsights.generatingMarker),
        });
        markerSet = true;
      } catch {
        console.error(`[Insights] cache-write:error ${keyFamily(keys.generating(lastfmUser))}`);
      }

      const waitUntil = getWaitUntil(c);
      const deferWrite = createServiceDefer('[Insights]', waitUntil);
      const counted = countingClient(history);
      const inputs = await collectWeekInputs({
        client: counted.client,
        kv,
        username: lastfmUser,
        timezone: user.timezone ?? null,
        now: Math.floor(Date.now() / 1000),
        // Without an ExecutionContext the collector awaits its own writes instead.
        defer: waitUntil ? (write) => deferWrite(write, 'insights cache write') : undefined,
        // Only the owner's view starts Spotify lookups; a visitor's facts carry no release dates.
        releases: isOwner ? spotifyReleaseLookup(c.get('spotify') as SpotifyService) : undefined,
      });
      wf = buildWeekFacts(inputs, { lastQuestion: await lastQuestion() });
      await writeJson(kv, keys.facts(lastfmUser), wf, getTtlSeconds(CACHE_CONFIG.userInsights.weekFacts));

      // Kinds, saliences and call counts only: never statements, the prompt view, names or listening counts.
      const facts = wf.facts.slice(0, LOGGED_FACTS).map((f) => `${f.kind}:${f.salience}`).join(' ');
      const calls = Object.entries(counted.calls).map(([method, n]) => `${method}=${n}`).join(' ');
      console.log(`[Insights] facts: quiet=${wf.quiet} [${facts}] lastfm calls: ${calls || 'none'}`);
    }

    if (wf.plays.deduped < MIN_WEEK_PLAYS) return null;

    const pulledAt = new Date(wf.pulledAt * 1000).toISOString();

    if (!isOwner) {
      // The visitor line names the profile as the header does.
      const note = renderLine({ ...wf, username: displayName }, 'third');
      return { note, question: null, header, pulledAt, mode: wf.quiet ? 'quiet' : 'line' };
    }

    if (wf.quiet) {
      return { note: renderLine(wf, 'second'), question: null, header, pulledAt, mode: 'quiet' };
    }

    const signature = await noteSignature(wf, USER_INSIGHTS_PROMPT_VERSION);
    const cached = await readNote(kv, lastfmUser, signature);

    let note: string;
    let mode: 'note' | 'line';
    if (cached) {
      note = cached.note;
      mode = 'note';
    } else {
      const generated = await guardedNote(ai, wf);
      if (generated) {
        note = generated.sentences.map((s) => s.text.trim()).join(' ');
        mode = 'note';
        const { raw, metadata } = generated.result;
        // No key params: isCacheableResponse puts them in its log line, and they hold the username.
        if (isCacheableResponse(raw, metadata, 'userInsightsSummary')) {
          await writeJson(kv, noteKey(lastfmUser, signature), { note } satisfies CachedNote, getTtlSeconds(CACHE_CONFIG.userInsights.note));
        }
      } else {
        note = renderLine(wf, 'second');
        mode = 'line';
      }
    }

    const stored = await lastQuestion();
    const question = ownerQuestion(wf, stored, signature);

    // Write the pointer and the question state only when they change: a warm reload writes nothing.
    const last = await readJson<LastNote>(kv, keys.last(lastfmUser));
    if (last?.signature !== signature || last.pulledAt !== pulledAt) {
      await writeJson(
        kv,
        keys.last(lastfmUser),
        { signature, pulledAt } satisfies LastNote,
        getTtlSeconds(CACHE_CONFIG.userInsights.note),
      );
    }
    if (question && (stored?.kind !== question.kind || stored.subject !== question.subject || stored.signature !== signature)) {
      await writeJson(
        kv,
        keys.question(lastfmUser),
        { kind: question.kind, subject: question.subject, signature } satisfies StoredQuestion,
        getTtlSeconds(CACHE_CONFIG.userInsights.questionState),
      );
    }

    return { note, question: question?.text ?? null, header, pulledAt, mode };
  } finally {
    if (markerSet) await deleteKey(kv, keys.generating(lastfmUser));
  }
}
