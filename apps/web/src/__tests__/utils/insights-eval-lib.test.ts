// ABOUTME: Tests for scripts/insights-eval-lib.ts: the output directory, the names the rubric masks, the known tie-back
// ABOUTME: report, the shared MusicBrainz limiter and the making-of fact-check list.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { join } from 'node:path';
import type { TieBack, WeekFacts } from '@listentomore/insights';
import { MusicBrainzCredits } from '@listentomore/musicbrainz';
import {
  cardFailure,
  createLocalLimiter,
  createSerialQueue,
  evalOutputDir,
  factCheckLines,
  knownTieBackReport,
  missingDevVarsError,
  noteNames,
  requiredDevVars,
} from '../../../scripts/insights-eval-lib';
import type { CardVerdict } from '../../../scripts/insights-eval-lib';
import { createMemoryKV } from '../../../scripts/script-env';
import type { CheckedAlbum, TriviaCard } from '../../api/internal/insights-card';

const WEB_ROOT = '/repo/apps/web';

describe('evalOutputDir', () => {
  it('puts a run under eval-output/<label>/insights', () => {
    expect(evalOutputDir(WEB_ROOT, 'week-facts-r2')).toBe(join(WEB_ROOT, 'eval-output', 'week-facts-r2', 'insights'));
    expect(evalOutputDir(WEB_ROOT, 'r2.1_b')).toBe(join(WEB_ROOT, 'eval-output', 'r2.1_b', 'insights'));
  });

  it('rejects labels that could leave eval-output', () => {
    for (const label of ['..', '.', '../insights', 'a/../..', 'a/b', 'a\\b', '/tmp/x', 'x..y', '', ' ']) {
      expect(() => evalOutputDir(WEB_ROOT, label), label).toThrow(/label/);
    }
  });
});

describe('noteNames', () => {
  it('returns the week names and every fact entity, once each', () => {
    const fact = (entities: string[]) => ({ entities }) as unknown as WeekFacts['facts'][number];
    const wf = {
      names: ['Great White', 'Inferno'],
      windowFact: fact([]),
      facts: [fact(['Great White', 'Gurriers']), fact(['Boards of Canada'])],
    } as unknown as WeekFacts;
    expect(noteNames(wf).sort()).toEqual(['Boards of Canada', 'Great White', 'Gurriers', 'Inferno']);
  });
});

describe('knownTieBackReport', () => {
  it('reports each known tie-back as checked (found or missing), unchecked (cut) or not a candidate, matching names loosely', () => {
    const tieBack = { band: 'the black keys' } as unknown as TieBack;
    const losOjos = { artist: 'Hermanos Gutierrez', album: 'Los Ojos del Condor', plays: 22 };
    const seaChange = { artist: 'Beck', album: 'Sea Change', plays: 12 };
    const earthling = { artist: 'Eddie Vedder', album: 'Earthling', plays: 14 };
    const checked: CheckedAlbum[] = [
      { album: losOjos, tieBacks: [tieBack] },
      { album: seaChange, tieBacks: null },
    ];
    expect(knownTieBackReport([losOjos, seaChange, earthling], checked)).toEqual([
      { album: 'Los Ojos Del Cóndor', band: 'The Black Keys', status: 'checked: found' },
      { album: 'Earthling', band: 'Red Hot Chili Peppers', status: 'unchecked (cut)' },
      { album: 'Earthling', band: 'Tom Petty and the Heartbreakers', status: 'unchecked (cut)' },
      { album: 'Sea Change', band: 'Nine Inch Nails', status: 'checked: missing' },
      { album: 'In Rainbows', band: 'The Smile', status: 'not a candidate' },
    ]);
  });
});

describe('knownTieBackReport after a cut', () => {
  // Regression: the report once read only the checked albums, so a candidate the run never reached read as
  // 'not a candidate'. Candidates come in separately from the completed checks.
  it('reports a candidate the cut run never reached as unchecked (cut), never as not a candidate', () => {
    const candidates = [
      { artist: 'Hermanos Gutiérrez', album: 'Los Ojos Del Cóndor', plays: 22 },
      { artist: 'Radiohead', album: 'In Rainbows', plays: 12 },
    ];
    const report = knownTieBackReport(candidates, []);
    expect(report.filter((r) => r.album === 'Los Ojos Del Cóndor' || r.album === 'In Rainbows').map((r) => r.status))
      .toEqual(['unchecked (cut)', 'unchecked (cut)']);
    expect(report.filter((r) => r.album === 'Earthling' || r.album === 'Sea Change').map((r) => r.status))
      .toEqual(['not a candidate', 'not a candidate', 'not a candidate']);
  });
});

describe('createLocalLimiter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('spaces reservations 1.1 s apart for every MusicBrainzCredits client sharing one limiter', async () => {
    vi.useFakeTimers();
    vi.mocked(globalThis.fetch).mockImplementation(async () => new Response(JSON.stringify({ 'release-groups': [] })));
    const t = 0;
    const limiter = createLocalLimiter(() => t);
    const [a, b] = [
      new MusicBrainzCredits(createMemoryKV().kv, limiter, { maxCalls: 5 }),
      new MusicBrainzCredits(createMemoryKV().kv, limiter, { maxCalls: 5 }),
    ];
    const reserve = vi.spyOn(limiter, 'reserve');
    const both = Promise.all([a.findRelease('A', 'X'), b.findRelease('B', 'Y')]);
    await vi.runAllTimersAsync();
    expect(await both).toEqual([null, null]);
    expect(await Promise.all(reserve.mock.results.map((r) => r.value))).toEqual([0, 1100]);
  });
});

describe('factCheckLines', () => {
  it('lists each making-of card with its source URL', () => {
    const text = 'Boards of Canada recorded Inferno in a farmhouse.';
    const sourceUrl = 'https://example.com/inferno';
    const makingOf: TriviaCard = { kind: 'making_of', album: 'Inferno', artist: 'Boards of Canada', text, sourceUrl };
    const tieBack: TriviaCard = { kind: 'tieback', album: 'Sea Change', artist: 'Beck', text: 'Someone plays on it.' };
    expect(factCheckLines([
      { fixture: 'a', card: makingOf },
      { fixture: 'b', card: tieBack },
      { fixture: 'c', card: null },
    ])).toEqual([`- a: Inferno (Boards of Canada): ${text} ${sourceUrl}`]);
  });
});

describe('createSerialQueue', () => {
  it('runs tasks one at a time in call order, and keeps going after a failure', async () => {
    const serial = createSerialQueue();
    const events: string[] = [];
    const task = (name: string, fail = false) => async () => {
      events.push(`start ${name}`);
      await Promise.resolve();
      events.push(`end ${name}`);
      if (fail) throw new Error(name);
      return name;
    };
    const results = await Promise.allSettled([serial(task('a')), serial(task('b', true)), serial(task('c'))]);
    expect(events).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  });
});

describe('cardFailure', () => {
  const card = (status: CardVerdict['status'], extra: Partial<CardVerdict> = {}): CardVerdict => ({
    skipped: null,
    status,
    cutReason: null,
    rubric: [],
    ...extra,
  });

  it('passes a card with no rubric hits', () => {
    expect(cardFailure(card('card'))).toBeNull();
  });

  it('fails a card that trips the copy rubric', () => {
    expect(cardFailure(card('card', { rubric: ['overused:delve'] }))).toBe('card rubric: overused:delve');
  });

  it('passes a week with no card', () => {
    expect(cardFailure(card('none'))).toBeNull();
  });

  it('passes a week the card route would skip', () => {
    expect(cardFailure(card(null, { skipped: 'no candidate albums' }))).toBeNull();
  });

  it('fails a cut card, naming the reason', () => {
    expect(cardFailure(card('cut', { cutReason: 'rate_limit' }))).toBe('card cut: rate_limit');
    expect(cardFailure(card('cut', { cutReason: 'making_of' }))).toBe('card cut: making_of');
  });

  it('fails a card run that threw', () => {
    expect(cardFailure(card('error'))).toBe('card error');
  });

  it('passes a run without --trivia', () => {
    expect(cardFailure(null)).toBeNull();
  });
});

describe('requiredDevVars and missingDevVarsError', () => {
  it('needs the key of each provider the run uses, and the Spotify credentials with --trivia', () => {
    expect(requiredDevVars(['anthropic'], false)).toEqual(['ANTHROPIC_API_KEY']);
    expect(requiredDevVars(['anthropic', 'anthropic'], true))
      .toEqual(['ANTHROPIC_API_KEY', 'SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET']);
    expect(requiredDevVars(['openai', 'anthropic'], false)).toEqual(['OPENAI_API_KEY', 'ANTHROPIC_API_KEY']);
  });

  it('names each missing or empty key, and never a value', () => {
    const devVars = { ANTHROPIC_API_KEY: 'SENTINEL-ANTHROPIC-VALUE', SPOTIFY_CLIENT_ID: '' };
    const message = missingDevVarsError(devVars, ['ANTHROPIC_API_KEY', 'SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET']);
    expect(message).toBe('apps/web/.dev.vars is missing SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET');
    expect(message).not.toContain('SENTINEL');
  });

  it('returns null when every required key is set', () => {
    expect(missingDevVarsError({ ANTHROPIC_API_KEY: 'x' }, ['ANTHROPIC_API_KEY'])).toBeNull();
  });

  it('reads .dev.vars only: a key set in process.env does not count', () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'SENTINEL-ENV-VALUE';
    try {
      expect(missingDevVarsError({}, ['ANTHROPIC_API_KEY'])).toBe('apps/web/.dev.vars is missing ANTHROPIC_API_KEY');
    } finally {
      if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previous;
    }
  });
});
