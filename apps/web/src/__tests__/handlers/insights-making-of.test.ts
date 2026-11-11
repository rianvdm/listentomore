// ABOUTME: Tests for the insights making-of fact - the global per-album cache, the rubric regeneration, NONE and
// ABOUTME: missing citations cached as none, errors and failed searches that write nothing, and name-free log lines.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import type { AIService, AlbumTriviaResult } from '@listentomore/ai';
import { keys } from '@listentomore/insights';
import { makingOfFact } from '../../api/internal/insights-making-of';
import { createMockKV } from '../utils/mocks';

const FACT = {
  text: 'Inferno was recorded in two weeks in 2023.',
  sourceUrl: 'https://a.example/x',
  raw: 'x',
  metadata: { truncated: false },
} as unknown as AlbumTriviaResult;
const FAILS_RUBRIC = {
  ...FACT,
  text: 'Fun fact: Inferno showcased a pivotal shift.',
} as AlbumTriviaResult;
const NONE = { text: null, sourceUrl: null, raw: 'NONE', metadata: { truncated: false } } as unknown as AlbumTriviaResult;

const DAY = 86400;
const CONSOLE_METHODS = ['log', 'info', 'debug', 'warn', 'error'] as const;
const ARTIST = 'Boards of Canada';
const ALBUM = 'Inferno';

describe('makingOfFact', () => {
  let kv: KVNamespace;
  let getAlbumTrivia: Mock<(artist: string, album: string) => Promise<AlbumTriviaResult>>;
  let ai: AIService;

  beforeEach(() => {
    kv = createMockKV();
    getAlbumTrivia = vi.fn();
    ai = { getAlbumTrivia } as unknown as AIService;
    for (const method of CONSOLE_METHODS) vi.spyOn(console, method).mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('caches a cited fact that passes the rubric for 120 days under insights:trivia', async () => {
    getAlbumTrivia.mockResolvedValue(FACT);
    expect(await makingOfFact(ai, kv, ARTIST, ALBUM)).toMatchObject({ status: 'found', text: FACT.text, sourceUrl: FACT.sourceUrl });
    expect(kv.put).toHaveBeenCalledWith(keys.trivia(ARTIST, ALBUM),
      JSON.stringify({ text: FACT.text, sourceUrl: FACT.sourceUrl }), { expirationTtl: 120 * DAY });
    expect(getAlbumTrivia).toHaveBeenCalledTimes(1);
    expect(getAlbumTrivia).toHaveBeenCalledWith(ARTIST, ALBUM);
  });

  it('asks about the original record: the query and the cache key drop an edition suffix', async () => {
    getAlbumTrivia.mockResolvedValue(FACT);
    expect((await makingOfFact(ai, kv, ARTIST, `${ALBUM} (Remastered 2026)`)).status).toBe('found');
    expect(getAlbumTrivia).toHaveBeenCalledWith(ARTIST, ALBUM);
    expect(kv.put).toHaveBeenCalledWith(keys.trivia(ARTIST, ALBUM),
      JSON.stringify({ text: FACT.text, sourceUrl: FACT.sourceUrl }), { expirationTtl: 120 * DAY });
    // The deluxe edition reads the same cached fact, with no second call.
    expect(await makingOfFact(ai, kv, ARTIST, `${ALBUM} (Deluxe Edition)`)).toMatchObject({ status: 'found', text: FACT.text });
    expect(getAlbumTrivia).toHaveBeenCalledTimes(1);
  });

  it('a delete through any edition of the title removes the entry written for the original', async () => {
    getAlbumTrivia.mockResolvedValue(FACT);
    await makingOfFact(ai, kv, ARTIST, ALBUM);
    expect(await kv.get(keys.trivia(ARTIST, ALBUM))).not.toBeNull();
    await kv.delete(keys.trivia(ARTIST, `${ALBUM} (Deluxe Edition)`));
    expect(await kv.get(keys.trivia(ARTIST, ALBUM))).toBeNull();
  });

  it('a call that throws with a made-up error name logs kind other, never the name or message', async () => {
    const error = new Error(`no luck with ${ALBUM} by ${ARTIST}`);
    error.name = 'QuillonVarga';
    getAlbumTrivia.mockRejectedValue(error);
    expect((await makingOfFact(ai, kv, ARTIST, ALBUM)).status).toBe('error');
    const logged = CONSOLE_METHODS.flatMap((method) =>
      vi.mocked(console[method]).mock.calls.map((args) => args.map(String).join(' ')));
    expect(logged).toContain('[Insights making-of] error on attempt 1: call failed (other)');
    for (const line of logged) {
      for (const text of ['QuillonVarga', ARTIST, ALBUM]) expect(line).not.toContain(text);
    }
  });

  it('a call that throws an error whose name changes between reads never logs the changed name', async () => {
    const error = new Error(`no luck with ${ALBUM}`);
    let reads = 0;
    Object.defineProperty(error, 'name', { get: () => (++reads === 1 ? 'Error' : 'QuillonVarga') });
    getAlbumTrivia.mockRejectedValue(error);
    expect((await makingOfFact(ai, kv, ARTIST, ALBUM)).status).toBe('error');
    const logged = CONSOLE_METHODS.flatMap((method) =>
      vi.mocked(console[method]).mock.calls.map((args) => args.map(String).join(' ')));
    expect(logged).toContain('[Insights making-of] error on attempt 1: call failed (Error)');
    for (const line of logged) expect(line).not.toContain('QuillonVarga');
  });

  it('regenerates once after a rubric failure, then caches the second', async () => {
    getAlbumTrivia.mockResolvedValueOnce(FAILS_RUBRIC).mockResolvedValueOnce(FACT);
    const result = await makingOfFact(ai, kv, ARTIST, ALBUM);
    expect(result).toMatchObject({ status: 'found', text: FACT.text, sourceUrl: FACT.sourceUrl });
    expect(result.calls).toHaveLength(2);
    expect(kv.put).toHaveBeenCalledTimes(1);
    expect(kv.put).toHaveBeenCalledWith(keys.trivia(ARTIST, ALBUM),
      JSON.stringify({ text: FACT.text, sourceUrl: FACT.sourceUrl }), { expirationTtl: 120 * DAY });
  });

  it('a second rubric failure caches { none: true } for 30 days', async () => {
    getAlbumTrivia.mockResolvedValue(FAILS_RUBRIC);
    const result = await makingOfFact(ai, kv, ARTIST, ALBUM);
    expect(result.status).toBe('none');
    expect(result.calls).toHaveLength(2);
    expect(getAlbumTrivia).toHaveBeenCalledTimes(2);
    expect(kv.put).toHaveBeenCalledWith(keys.trivia(ARTIST, ALBUM), JSON.stringify({ none: true }), { expirationTtl: 30 * DAY });
  });

  it('NONE caches none with no second call', async () => {
    getAlbumTrivia.mockResolvedValue(NONE);
    const result = await makingOfFact(ai, kv, ARTIST, ALBUM);
    expect(result).toEqual({ status: 'none', calls: [NONE.metadata] });
    expect(getAlbumTrivia).toHaveBeenCalledTimes(1);
    expect(kv.put).toHaveBeenCalledWith(keys.trivia(ARTIST, ALBUM), JSON.stringify({ none: true }), { expirationTtl: 30 * DAY });
  });

  it('an answer with no citation caches none', async () => {
    getAlbumTrivia.mockResolvedValue({ ...FACT, sourceUrl: null });
    expect((await makingOfFact(ai, kv, ARTIST, ALBUM)).status).toBe('none');
    expect(getAlbumTrivia).toHaveBeenCalledTimes(1);
    expect(kv.put).toHaveBeenCalledWith(keys.trivia(ARTIST, ALBUM), JSON.stringify({ none: true }), { expirationTtl: 30 * DAY });
  });

  it('a cached fact or none makes no model call', async () => {
    await kv.put(keys.trivia(ARTIST, ALBUM), JSON.stringify({ text: FACT.text, sourceUrl: FACT.sourceUrl }));
    expect(await makingOfFact(ai, kv, ARTIST, ALBUM)).toEqual({ status: 'found', text: FACT.text, sourceUrl: FACT.sourceUrl, calls: [] });

    await kv.put(keys.trivia('Low', 'Secret Name'), JSON.stringify({ none: true }));
    expect(await makingOfFact(ai, kv, 'Low', 'Secret Name')).toEqual({ status: 'none', calls: [] });
    expect(getAlbumTrivia).not.toHaveBeenCalled();
  });

  it('treats a failed or malformed cache read as a miss', async () => {
    vi.mocked(kv.get).mockRejectedValueOnce(new Error('KV down'));
    getAlbumTrivia.mockResolvedValue(FACT);
    expect((await makingOfFact(ai, kv, ARTIST, ALBUM)).status).toBe('found');

    await kv.put(keys.trivia('Low', 'Secret Name'), JSON.stringify({ text: 42 }));
    expect((await makingOfFact(ai, kv, 'Low', 'Secret Name')).status).toBe('found');
    expect(getAlbumTrivia).toHaveBeenCalledTimes(2);
  });

  it('a thrown or truncated call returns error and writes nothing', async () => {
    getAlbumTrivia.mockRejectedValueOnce(new Error('Anthropic API error: 529'));
    expect(await makingOfFact(ai, kv, ARTIST, ALBUM)).toEqual({ status: 'error', calls: [] });

    const truncated = { ...FACT, metadata: { truncated: true } } as unknown as AlbumTriviaResult;
    getAlbumTrivia.mockResolvedValueOnce(truncated);
    expect(await makingOfFact(ai, kv, ARTIST, ALBUM)).toEqual({ status: 'error', calls: [truncated.metadata] });

    // A throw on the regeneration discards the first, failed attempt too.
    getAlbumTrivia.mockResolvedValueOnce(FAILS_RUBRIC).mockRejectedValueOnce(new Error('timeout'));
    expect((await makingOfFact(ai, kv, ARTIST, ALBUM)).status).toBe('error');

    // An empty reply is not cacheable, so it is an error rather than a none.
    getAlbumTrivia.mockResolvedValueOnce({ ...NONE, raw: '' });
    expect((await makingOfFact(ai, kv, ARTIST, ALBUM)).status).toBe('error');
    expect(kv.put).not.toHaveBeenCalled();
  });

  /** The result with web search errors on its metadata, as the Anthropic client reports them. */
  const withSearchErrors = (result: AlbumTriviaResult, ...codes: string[]): AlbumTriviaResult =>
    ({ ...result, metadata: { truncated: false, features: { webSearchErrors: codes } } }) as unknown as AlbumTriviaResult;

  it.each(['too_many_requests', 'unavailable', 'overloaded', 'unknown'])(
    'a transient %s web search error is an error even when the model then says NONE, and writes nothing',
    async (code) => {
      const failed = withSearchErrors(NONE, code);
      getAlbumTrivia.mockResolvedValue(failed);
      expect(await makingOfFact(ai, kv, ARTIST, ALBUM)).toEqual({ status: 'error', calls: [failed.metadata] });
      expect(getAlbumTrivia).toHaveBeenCalledTimes(1);
      expect(kv.put).not.toHaveBeenCalled();
    },
  );

  it.each(['max_uses_exceeded', 'invalid_input', 'query_too_long'])(
    'NONE after a %s web search error is a genuine none, cached for 30 days',
    async (code) => {
      getAlbumTrivia.mockResolvedValue(withSearchErrors(NONE, code));
      expect((await makingOfFact(ai, kv, ARTIST, ALBUM)).status).toBe('none');
      expect(kv.put).toHaveBeenCalledWith(keys.trivia(ARTIST, ALBUM), JSON.stringify({ none: true }), { expirationTtl: 30 * DAY });
    },
  );

  it('a cited fact that passes the rubric is cached as found despite a transient web search error', async () => {
    getAlbumTrivia.mockResolvedValue(withSearchErrors(FACT, 'too_many_requests', 'max_uses_exceeded'));
    expect(await makingOfFact(ai, kv, ARTIST, ALBUM)).toMatchObject({ status: 'found', text: FACT.text, sourceUrl: FACT.sourceUrl });
    expect(kv.put).toHaveBeenCalledWith(keys.trivia(ARTIST, ALBUM),
      JSON.stringify({ text: FACT.text, sourceUrl: FACT.sourceUrl }), { expirationTtl: 120 * DAY });
  });

  it('a transient error on the first attempt still lets a good regeneration be cached', async () => {
    getAlbumTrivia.mockResolvedValueOnce(withSearchErrors(FAILS_RUBRIC, 'unavailable')).mockResolvedValueOnce(FACT);
    expect((await makingOfFact(ai, kv, ARTIST, ALBUM)).status).toBe('found');
    expect(kv.put).toHaveBeenCalledTimes(1);
  });

  it('a transient error turns every no-fact outcome into an error that writes nothing', async () => {
    // No citation.
    getAlbumTrivia.mockResolvedValueOnce(withSearchErrors({ ...FACT, sourceUrl: null }, 'unavailable'));
    expect((await makingOfFact(ai, kv, ARTIST, ALBUM)).status).toBe('error');
    // NONE on the regeneration after a clean rubric failure.
    getAlbumTrivia.mockResolvedValueOnce(FAILS_RUBRIC).mockResolvedValueOnce(withSearchErrors(NONE, 'too_many_requests'));
    let result = await makingOfFact(ai, kv, ARTIST, ALBUM);
    expect(result.status).toBe('error');
    expect(result.calls).toHaveLength(2);
    // Rubric failures on both attempts, with a transient error on either.
    getAlbumTrivia.mockResolvedValueOnce(withSearchErrors(FAILS_RUBRIC, 'unavailable')).mockResolvedValueOnce(FAILS_RUBRIC);
    result = await makingOfFact(ai, kv, ARTIST, ALBUM);
    expect(result.status).toBe('error');
    expect(result.calls).toHaveLength(2);
    getAlbumTrivia.mockResolvedValueOnce(FAILS_RUBRIC).mockResolvedValueOnce(withSearchErrors(FAILS_RUBRIC, 'too_many_requests'));
    expect((await makingOfFact(ai, kv, ARTIST, ALBUM)).status).toBe('error');
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('still returns the fact when the cache write fails', async () => {
    vi.mocked(kv.put).mockRejectedValueOnce(new Error('KV down'));
    getAlbumTrivia.mockResolvedValue(FACT);
    expect((await makingOfFact(ai, kv, ARTIST, ALBUM)).status).toBe('found');
  });

  it('logs no artist, album, fact text or source URL', async () => {
    const artist = 'Sentinel Artist';
    const album = 'Sentinel Album';
    const found = {
      text: 'Sentinel Album was recorded in Sentinelville in 1999.',
      sourceUrl: 'https://sentinel.example/sentinel-album',
      raw: 'Sentinel Album was recorded in Sentinelville in 1999.',
      metadata: { truncated: false },
    } as unknown as AlbumTriviaResult;
    const failing = { ...found, text: 'Fun fact: Sentinel Album showcased a pivotal shift.' } as AlbumTriviaResult;
    const runs: Array<() => void> = [
      () => getAlbumTrivia.mockResolvedValueOnce(found),
      () => getAlbumTrivia.mockResolvedValueOnce(failing).mockResolvedValueOnce(failing),
      () => getAlbumTrivia.mockResolvedValueOnce({ ...NONE, raw: 'NONE. Nothing on Sentinel Album.' }),
      () => getAlbumTrivia.mockResolvedValueOnce({ ...found, sourceUrl: null }),
      () => getAlbumTrivia.mockRejectedValueOnce(new Error('Anthropic API error: Sentinel Album by Sentinel Artist')),
      () => getAlbumTrivia.mockResolvedValueOnce({ ...found, metadata: { truncated: true } } as unknown as AlbumTriviaResult),
      () => getAlbumTrivia.mockResolvedValueOnce(
        { ...NONE, metadata: { truncated: false, features: { webSearchErrors: ['too_many_requests'] } } } as unknown as AlbumTriviaResult,
      ),
    ];
    const statuses: string[] = [];
    for (const arrange of runs) {
      await kv.delete(keys.trivia(artist, album));
      arrange();
      statuses.push((await makingOfFact(ai, kv, artist, album)).status);
    }
    expect(statuses).toEqual(['found', 'none', 'none', 'none', 'error', 'error', 'error']);

    const logged = CONSOLE_METHODS
      .flatMap((method) => vi.mocked(console[method]).mock.calls.flat())
      .map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack}` : typeof arg === 'string' ? arg : JSON.stringify(arg)));
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.filter((line) => /sentinel/i.test(line))).toEqual([]);
  });
});
