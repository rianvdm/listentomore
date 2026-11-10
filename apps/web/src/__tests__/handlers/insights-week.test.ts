// ABOUTME: Endpoint tests for /api/internal/user-insights-summary - visibility before any cache read, owner note
// ABOUTME: versus visitor line, guard regeneration and fallback, the note reuse rule, refresh, the marker and logs.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { Hono } from 'hono';
import { AICache } from '@listentomore/ai';
import type { Database, Session, User } from '@listentomore/db';
import * as insights from '@listentomore/insights';
import type { NoteSentence, WeekFacts, WeekInputs } from '@listentomore/insights';
import may24Json from '../../../../../packages/services/insights/__fixtures__/bordesak-2026-05-24.json';
import jun12Json from '../../../../../packages/services/insights/__fixtures__/bordesak-2026-06-12.json';
import { insightsInternalRoutes } from '../../api/internal/insights';
import { logSafeFailures } from '../../api/internal/insights-week';
import type { InternalAppContext } from '../../types';
import { createMockKV } from '../utils/mocks';

vi.mock('@listentomore/insights', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@listentomore/insights')>();
  return {
    ...actual,
    collectWeekInputs: vi.fn(),
    buildWeekFacts: vi.fn(actual.buildWeekFacts),
  };
});

const collectWeekInputs = vi.mocked(insights.collectWeekInputs);
const MAY24 = may24Json as unknown as WeekInputs;
const JUN12 = jun12Json as unknown as WeekInputs;

const OWNER = {
  id: 'user-1',
  username: 'rian',
  lastfm_username: 'bordesak',
  profile_visibility: 'public',
  timezone: 'America/Los_Angeles',
} as User;
const VISITOR = { id: 'user-2', username: 'guest', lastfm_username: 'guest', profile_visibility: 'public' } as User;
const SESSION = { id: 'session-1', user_id: 'x', expires_at: '2999-01-01T00:00:00Z' } as Session;
const SIGNED_IN = { headers: { Cookie: 'ltm_session=token' } };
const URL_SUMMARY = '/api/internal/user-insights-summary?username=bordesak';
const URL_REFRESH = `${URL_SUMMARY}&refresh=true`;

// The May 24 facts: fact 1 is the jazz cluster, fact 2 Boards of Canada (the guard's round 2 acceptance note).
const S1: NoteSentence = {
  text: 'Four jazz names came back to you this week: Wes Montgomery with 8 plays, Wayne Shorter and Joe Henderson with 6 each, and Grant Green with 5, and Joe Henderson had been gone for 12+ months.',
  facts: [1],
};
const S2: NoteSentence = { text: 'Boards of Canada took over Friday with 41 plays, including Inferno start to finish.', facts: [2] };
const GOOD = { sentences: [S1, S2], raw: JSON.stringify([S1, S2]), metadata: { truncated: false } };
// Names a count the cited fact does not hold.
const BAD = {
  sentences: [S1, { text: 'Grant Green had 41 plays.', facts: [1, 2] }],
  raw: '[...]',
  metadata: { truncated: false },
};
const UNPARSEABLE = { sentences: null, raw: 'not json', metadata: { truncated: false } };
const NOTE = `${S1.text} ${S2.text}`;

/**
 * The inputs with only this week's first `n` scrobbles and no earlier ones, like a new account: no baseline, so no
 * baseline facts, and too few plays for a discovery. Six plays make a quiet week; under five, a sparse one.
 */
function onlyWeekPlays(inputs: WeekInputs, n: number): WeekInputs {
  const weekFrom = insights.weekWindow(inputs.now).from;
  return { ...inputs, scrobbles: inputs.scrobbles.filter((s) => s.ts >= weekFrom).slice(0, n) };
}

function createServices(sessionUser: User | null, profile: User) {
  const kv = createMockKV();
  return {
    kv,
    db: {
      getSessionByToken: vi.fn().mockResolvedValue(sessionUser ? { ...SESSION, user_id: sessionUser.id } : null),
      getUser: vi.fn().mockResolvedValue(sessionUser),
      updateSessionActivity: vi.fn().mockResolvedValue(undefined),
      getUserByLastfmUsername: vi.fn().mockResolvedValue(profile),
      getUserByUsername: vi.fn().mockResolvedValue(null),
    },
    ai: {
      getUserInsightsNote: vi.fn().mockResolvedValue(GOOD),
      cache: new AICache(kv),
    },
  };
}

type Services = ReturnType<typeof createServices>;

function buildApp(services: Services) {
  const app = new Hono<InternalAppContext>();
  app.use('*', async (c, next) => {
    c.set('db', services.db as unknown as Database);
    c.set('ai', services.ai as never);
    await next();
  });
  app.route('/api/internal', insightsInternalRoutes);
  return (path: string) => app.request(path, SIGNED_IN, { CACHE: services.kv, LASTFM_API_KEY: 'key' });
}

/** Every key the KV mock was asked to read or write. */
const readKeys = (kv: KVNamespace): string[] => vi.mocked(kv.get).mock.calls.map(([key]) => String(key));
const writtenKeys = (kv: KVNamespace): string[] => vi.mocked(kv.put).mock.calls.map(([key]) => key);

async function factsOf(inputs: WeekInputs): Promise<WeekFacts> {
  const actual = await vi.importActual<typeof import('@listentomore/insights')>('@listentomore/insights');
  return actual.buildWeekFacts(inputs);
}

describe('/user-insights-summary', () => {
  beforeEach(() => {
    collectWeekInputs.mockResolvedValue(MAY24);
  });

  describe('visibility', () => {
    it('refuses a visitor on a private profile before touching KV', async () => {
      const services = createServices(VISITOR, { ...OWNER, profile_visibility: 'private' });
      const res = await buildApp(services)(URL_SUMMARY);

      expect(res.status).toBe(403);
      expect(services.kv.get).not.toHaveBeenCalled();
      expect(services.kv.put).not.toHaveBeenCalled();
      expect(collectWeekInputs).not.toHaveBeenCalled();
    });

    it('refuses a visitor on a private profile even with warm facts and note caches', async () => {
      const owner = createServices(OWNER, OWNER);
      expect((await buildApp(owner)(URL_SUMMARY)).status).toBe(200);
      expect(writtenKeys(owner.kv)).toContain('insights:facts:bordesak');

      const visitor = createServices(VISITOR, { ...OWNER, profile_visibility: 'private' });
      visitor.kv = owner.kv;
      vi.mocked(owner.kv.get).mockClear();
      const request = buildApp(visitor);

      for (const path of [URL_SUMMARY, URL_REFRESH]) {
        const res = await request(path);
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: 'This profile is private' });
      }
      expect(owner.kv.get).not.toHaveBeenCalled();
    });
  });

  describe('owner', () => {
    it('owner gets the guarded note, the code question and "Your week"', async () => {
      const services = createServices(OWNER, OWNER);
      const res = await buildApp(services)(URL_SUMMARY);

      expect(res.status).toBe(200);
      const { data } = await res.json() as { data: Record<string, unknown> };
      expect(data).toEqual({
        note: NOTE,
        question: 'What got you back into jazz this week?',
        header: 'Your week',
        pulledAt: new Date(MAY24.now * 1000).toISOString(),
        mode: 'note',
      });
      expect(services.ai.getUserInsightsNote).toHaveBeenCalledTimes(1);
      expect(services.ai.getUserInsightsNote).toHaveBeenCalledWith(insights.renderPromptView(await factsOf(MAY24)));

      const signature = await insights.noteSignature(await factsOf(MAY24), (await import('@listentomore/ai')).USER_INSIGHTS_PROMPT_VERSION);
      expect(await services.kv.get(`ai:userInsightsSummary:bordesak:${signature}`, 'json')).toEqual({ note: NOTE });
      expect(await services.kv.get('insights:last:bordesak', 'json')).toEqual({
        signature,
        pulledAt: new Date(MAY24.now * 1000).toISOString(),
      });
      expect(await services.kv.get('insights:question:bordesak', 'json')).toEqual({ kind: 'started', subject: 'jazz', signature });
      expect(await services.kv.get('insights:generating:bordesak')).toBeNull();
    });

    it('caches the note, facts, last pointer and question with the configured TTLs', async () => {
      const services = createServices(OWNER, OWNER);
      await buildApp(services)(URL_SUMMARY);

      const ttlOf = (key: string) =>
        vi.mocked(services.kv.put).mock.calls.find(([k]) => k === key || k.startsWith(key))?.[2]?.expirationTtl;
      expect(ttlOf('insights:facts:bordesak')).toBe(24 * 3600);
      expect(ttlOf('ai:userInsightsSummary:bordesak:')).toBe(8 * 86400);
      expect(ttlOf('insights:last:bordesak')).toBe(8 * 86400);
      expect(ttlOf('insights:question:bordesak')).toBe(60 * 86400);
      expect(ttlOf('insights:generating:bordesak')).toBe(60);
    });

    it('regenerates once when the guard fails, then serves the second note', async () => {
      const services = createServices(OWNER, OWNER);
      services.ai.getUserInsightsNote.mockResolvedValueOnce(BAD).mockResolvedValueOnce(GOOD);
      const res = await buildApp(services)(URL_SUMMARY);

      const { data } = await res.json() as { data: { note: string; mode: string } };
      expect(services.ai.getUserInsightsNote).toHaveBeenCalledTimes(2);
      expect(data.mode).toBe('note');
      expect(data.note).toBe(NOTE);
      expect(writtenKeys(services.kv).some((k) => k.startsWith('ai:userInsightsSummary:bordesak:'))).toBe(true);
    });

    it('falls back to the code line when the guard fails twice', async () => {
      const services = createServices(OWNER, OWNER);
      services.ai.getUserInsightsNote.mockResolvedValue(BAD);
      const res = await buildApp(services)(URL_SUMMARY);

      const { data } = await res.json() as { data: { note: string; mode: string; question: string | null } };
      expect(services.ai.getUserInsightsNote).toHaveBeenCalledTimes(2);
      expect(data.mode).toBe('line');
      expect(data.note).toBe(insights.renderLine(await factsOf(MAY24), 'second'));
      expect(data.question).toBe('What got you back into jazz this week?');
      expect(writtenKeys(services.kv).filter((k) => k.startsWith('ai:userInsightsSummary'))).toEqual([]);
      expect(await services.kv.get('insights:last:bordesak', 'json')).toMatchObject({ signature: expect.any(String) });
    });

    it('falls back to the code line when the model returns no parseable sentences', async () => {
      const services = createServices(OWNER, OWNER);
      services.ai.getUserInsightsNote.mockResolvedValue(UNPARSEABLE);
      const res = await buildApp(services)(URL_SUMMARY);

      const { data } = await res.json() as { data: { note: string; mode: string } };
      expect(services.ai.getUserInsightsNote).toHaveBeenCalledTimes(2);
      expect(data.mode).toBe('line');
      expect(writtenKeys(services.kv).filter((k) => k.startsWith('ai:userInsightsSummary'))).toEqual([]);
    });

    it('falls back to the code line when the model call throws twice', async () => {
      const services = createServices(OWNER, OWNER);
      services.ai.getUserInsightsNote.mockRejectedValue(new Error('Anthropic API error: 529'));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const res = await buildApp(services)(URL_SUMMARY);

      expect(res.status).toBe(200);
      const { data } = await res.json() as { data: { mode: string } };
      expect(services.ai.getUserInsightsNote).toHaveBeenCalledTimes(2);
      expect(data.mode).toBe('line');
    });

    it('never caches a truncated note', async () => {
      const services = createServices(OWNER, OWNER);
      services.ai.getUserInsightsNote.mockResolvedValue({ ...GOOD, metadata: { truncated: true } });
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const res = await buildApp(services)(URL_SUMMARY);

      const { data } = await res.json() as { data: { note: string; mode: string } };
      expect(data.mode).toBe('note');
      expect(writtenKeys(services.kv).filter((k) => k.startsWith('ai:userInsightsSummary'))).toEqual([]);
    });

    it('a second load with unchanged facts makes no Last.fm and no model call', async () => {
      const services = createServices(OWNER, OWNER);
      const request = buildApp(services);
      const first = await (await request(URL_SUMMARY)).json() as { data: unknown };
      const second = await (await request(URL_SUMMARY)).json() as { data: unknown };

      expect(second).toEqual(first);
      expect(collectWeekInputs).toHaveBeenCalledTimes(1);
      expect(services.ai.getUserInsightsNote).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('a warm reload writes nothing: the pointer and the question state are unchanged', async () => {
      const services = createServices(OWNER, OWNER);
      const request = buildApp(services);
      await request(URL_SUMMARY);
      vi.mocked(services.kv.put).mockClear();

      expect((await request(URL_SUMMARY)).status).toBe(200);
      expect(services.kv.put).not.toHaveBeenCalled();
    });

    it('two loads of the same facts return the same question, even when rotation moved off the lead', async () => {
      // Stored: a "started" question about another subject. The lead's only edge is "started", so the first load
      // rotates to a later fact; rotating again from that would flip back to the lead on the reload.
      // No committed week has edges on both of its top two facts, so fact 2 gets one here.
      const real = await factsOf(MAY24);
      const [lead, second, ...rest] = real.facts;
      const wf = { ...real, facts: [lead, { ...second, edges: [{ kind: 'after' as const, text: 'What came after?' }] }, ...rest] };
      vi.mocked(insights.buildWeekFacts).mockReturnValueOnce(wf);
      const services = createServices(OWNER, OWNER);
      await services.kv.put('insights:question:bordesak', JSON.stringify({ kind: 'started', subject: 'Some Other Artist' }));
      const first = insights.chooseQuestion(wf.facts, { kind: 'started', subject: 'Some Other Artist' });
      expect(first).not.toBeNull();
      expect(insights.chooseQuestion(wf.facts, first)?.text).not.toBe(first?.text);

      const request = buildApp(services);
      const one = await (await request(URL_SUMMARY)).json() as { data: { question: string | null } };
      const two = await (await request(URL_SUMMARY)).json() as { data: { question: string | null } };
      expect(one.data.question).toBe(first?.text);
      expect(two.data.question).toBe(first?.text);
    });

    it('recomputes cached facts from another rule version instead of serving them', async () => {
      const services = createServices(OWNER, OWNER);
      const stale = { ...(await factsOf(MAY24)), ruleVersion: 'r0' };
      await services.kv.put('insights:facts:bordesak', JSON.stringify(stale));
      await buildApp(services)(URL_SUMMARY);

      expect(collectWeekInputs).toHaveBeenCalledTimes(1);
      expect(await services.kv.get('insights:facts:bordesak', 'json')).toMatchObject({ ruleVersion: insights.RULE_VERSION });
    });

    it('refresh with an unchanged signature reuses the note; a changed signature regenerates', async () => {
      const services = createServices(OWNER, OWNER);
      const request = buildApp(services);
      await request(URL_SUMMARY);

      const reused = await request(URL_REFRESH);
      expect(reused.status).toBe(200);
      expect(collectWeekInputs).toHaveBeenCalledTimes(2);
      expect(services.ai.getUserInsightsNote).toHaveBeenCalledTimes(1);
      expect((await reused.json() as { data: { note: string } }).data.note).toBe(NOTE);

      // Past the cooldown, the week has moved on: new facts, new signature, a new model call.
      await services.kv.delete('insights-refresh:bordesak');
      collectWeekInputs.mockResolvedValue(JUN12);
      const regenerated = await request(URL_REFRESH);
      expect(regenerated.status).toBe(200);
      expect(collectWeekInputs).toHaveBeenCalledTimes(3);
      // The stub still replies with the May 24 note, which fails the guard on Jun 12's facts: two new calls.
      expect(services.ai.getUserInsightsNote).toHaveBeenCalledTimes(3);
      expect(services.ai.getUserInsightsNote).toHaveBeenLastCalledWith(insights.renderPromptView(await factsOf(JUN12)));
    });

    it('refresh is owner-only and respects the cooldown', async () => {
      const visitor = createServices(VISITOR, OWNER);
      const visitorRes = await buildApp(visitor)(URL_REFRESH);
      expect(visitorRes.status).toBe(403);
      expect(writtenKeys(visitor.kv)).toEqual([]);

      const owner = createServices(OWNER, OWNER);
      const request = buildApp(owner);
      expect((await request(URL_REFRESH)).status).toBe(200);
      const again = await request(URL_REFRESH);
      expect(again.status).toBe(429);
      expect(await again.json()).toMatchObject({ error: 'Please wait before refreshing again' });
      expect(collectWeekInputs).toHaveBeenCalledTimes(1);
    });

    it('the site username and the Last.fm name share one refresh cooldown', async () => {
      const services = createServices(OWNER, OWNER);
      services.db.getUserByLastfmUsername.mockImplementation(async (name: string) => (name === 'bordesak' ? OWNER : null));
      services.db.getUserByUsername.mockImplementation(async (name: string) => (name === 'rian' ? OWNER : null));
      const request = buildApp(services);

      expect((await request(URL_REFRESH)).status).toBe(200);
      expect((await request('/api/internal/user-insights-summary?username=rian&refresh=true')).status).toBe(429);
      expect(collectWeekInputs).toHaveBeenCalledTimes(1);

      // The cooldown route, which the page calls with the site username, reads the same key.
      const cooldown = await (await request('/api/internal/user-insights-cooldown?username=rian')).json();
      expect(cooldown).toMatchObject({ canRefresh: false });
      expect(writtenKeys(services.kv).filter((k) => k.startsWith('insights-refresh:'))).toEqual(['insights-refresh:bordesak']);
    });

    it('a quiet week makes no model call', async () => {
      const services = createServices(OWNER, OWNER);
      const quiet = onlyWeekPlays(MAY24, 6);
      const wf = await factsOf(quiet);
      expect(wf.quiet).toBe(true);
      collectWeekInputs.mockResolvedValue(quiet);

      const res = await buildApp(services)(URL_SUMMARY);
      const { data } = await res.json() as { data: Record<string, unknown> };
      expect(data).toMatchObject({ note: insights.renderLine(wf, 'second'), question: null, mode: 'quiet', header: 'Your week' });
      expect(services.ai.getUserInsightsNote).not.toHaveBeenCalled();
      expect(writtenKeys(services.kv).filter((k) => k.startsWith('ai:'))).toEqual([]);
    });

    it('under 5 plays returns the sparse message', async () => {
      const services = createServices(OWNER, OWNER);
      collectWeekInputs.mockResolvedValue(onlyWeekPlays(MAY24, 4));

      const res = await buildApp(services)(URL_SUMMARY);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        data: null,
        sparse: true,
        message:
          "Looks like you've been taking a break from music lately! 🎧 Get back to listening and check back soon for personalized insights.",
      });
      expect(services.ai.getUserInsightsNote).not.toHaveBeenCalled();
    });

    it('InsightsFetchError returns 500 and writes nothing', async () => {
      const services = createServices(OWNER, OWNER);
      collectWeekInputs.mockRejectedValue(new insights.InsightsFetchError('Could not read the current week: 500'));
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const res = await buildApp(services)(URL_SUMMARY);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'Failed to generate insights' });
      // Only the best-effort marker was written, and it is gone again.
      expect(writtenKeys(services.kv)).toEqual(['insights:generating:bordesak']);
      expect(services.kv.delete).toHaveBeenCalledWith('insights:generating:bordesak');
      expect(await services.kv.get('insights:generating:bordesak')).toBeNull();
      expect(services.ai.getUserInsightsNote).not.toHaveBeenCalled();
    });

    it('a second request while the generating marker is set returns the previous note with refreshing: true', async () => {
      const services = createServices(OWNER, OWNER);
      const request = buildApp(services);
      const first = await (await request(URL_SUMMARY)).json() as { data: { pulledAt: string } };

      // The facts expired and another request is generating.
      await services.kv.delete('insights:facts:bordesak');
      await services.kv.put('insights:generating:bordesak', '1');
      const res = await request(URL_SUMMARY);

      expect(await res.json()).toEqual({
        data: { note: NOTE, question: null, header: 'Your week', pulledAt: first.data.pulledAt, mode: 'note', refreshing: true },
      });
      expect(collectWeekInputs).toHaveBeenCalledTimes(1);
      expect(services.ai.getUserInsightsNote).toHaveBeenCalledTimes(1);
      // The other request owns the marker.
      expect(await services.kv.get('insights:generating:bordesak')).toBe('1');
    });

    it('generates anyway when the marker is set but there is no previous note', async () => {
      const services = createServices(OWNER, OWNER);
      await services.kv.put('insights:generating:bordesak', '1');
      const res = await buildApp(services)(URL_SUMMARY);

      const { data } = await res.json() as { data: { mode: string; refreshing?: boolean } };
      expect(data.mode).toBe('note');
      expect(data.refreshing).toBeUndefined();
      expect(collectWeekInputs).toHaveBeenCalledTimes(1);
    });

    it('uses the stored owner timezone and null when unset', async () => {
      const zoned = createServices(OWNER, OWNER);
      await buildApp(zoned)(URL_SUMMARY);
      expect(collectWeekInputs).toHaveBeenLastCalledWith(expect.objectContaining({
        username: 'bordesak',
        timezone: 'America/Los_Angeles',
      }));

      const unset = { ...OWNER, timezone: null };
      const services = createServices(unset, unset);
      await buildApp(services)(URL_SUMMARY);
      expect(collectWeekInputs).toHaveBeenLastCalledWith(expect.objectContaining({ username: 'bordesak', timezone: null }));
    });
  });

  describe('KV failures', () => {
    const failing = () => Promise.reject(new Error('KV unavailable'));
    const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {});
    /** Makes `method` reject for keys under `prefix`; other keys keep the in-memory behaviour. */
    const failUnder = (kv: KVNamespace, method: 'get' | 'put', prefix: string): void => {
      const mock = vi.mocked(kv[method]) as unknown as Mock<(key: string, ...rest: unknown[]) => Promise<unknown>>;
      const real = mock.getMockImplementation();
      mock.mockImplementation((key, ...rest) => (key.startsWith(prefix) || !real ? failing() : real(key, ...rest)));
    };

    it('a refresh whose facts delete fails still recomputes instead of serving the cached facts', async () => {
      const services = createServices(OWNER, OWNER);
      const request = buildApp(services);
      await request(URL_SUMMARY);
      quiet();
      vi.mocked(services.kv.delete).mockImplementation(failing);
      collectWeekInputs.mockResolvedValue(JUN12);

      const res = await request(URL_REFRESH);
      expect(res.status).toBe(200);
      expect(collectWeekInputs).toHaveBeenCalledTimes(2);
      expect((await res.json() as { data: { mode: string } }).data.mode).toBe('line');
      expect(services.ai.getUserInsightsNote).toHaveBeenLastCalledWith(insights.renderPromptView(await factsOf(JUN12)));
    });

    it('a note cache read that throws is a miss', async () => {
      const services = createServices(OWNER, OWNER);
      failUnder(services.kv, 'get', 'ai:userInsightsSummary:');
      quiet();

      const res = await buildApp(services)(URL_SUMMARY);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ data: { note: NOTE, mode: 'note' } });
    });

    it('a cooldown write that fails still serves the refresh', async () => {
      const services = createServices(OWNER, OWNER);
      failUnder(services.kv, 'put', 'insights-refresh:');
      quiet();

      const res = await buildApp(services)(URL_REFRESH);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ data: { note: NOTE, mode: 'note' } });
    });

    it('the owner still gets a note when every KV read, write and delete rejects', async () => {
      for (const path of [URL_SUMMARY, URL_REFRESH]) {
        const services = createServices(OWNER, OWNER);
        for (const method of ['get', 'put', 'delete'] as const) vi.mocked(services.kv[method]).mockImplementation(failing);
        quiet();

        const res = await buildApp(services)(path);
        expect(res.status, path).toBe(200);
        expect(await res.json(), path).toMatchObject({ data: { note: NOTE, mode: 'note' } });
      }
    });
  });

  describe('visitor', () => {
    it('visitor gets the third-person line, no question, "<username>\'s week", and no model call', async () => {
      const services = createServices(VISITOR, OWNER);
      const res = await buildApp(services)(URL_SUMMARY);

      expect(res.status).toBe(200);
      const { data } = await res.json() as { data: Record<string, unknown> };
      const wf = await factsOf(MAY24);
      expect(data).toEqual({
        note: insights.renderLine({ ...wf, username: 'rian' }, 'third'),
        question: null,
        header: "rian's week",
        pulledAt: new Date(MAY24.now * 1000).toISOString(),
        mode: 'line',
      });
      expect(data.note).toMatch(/^rian played /);
      expect(services.ai.getUserInsightsNote).not.toHaveBeenCalled();
      expect(writtenKeys(services.kv).filter((k) => k.startsWith('ai:') || k.startsWith('insights:last'))).toEqual([]);
    });

    it('a visitor on a quiet week gets the quiet line', async () => {
      const services = createServices(VISITOR, OWNER);
      collectWeekInputs.mockResolvedValue(onlyWeekPlays(MAY24, 6));
      const { data } = await (await buildApp(services)(URL_SUMMARY)).json() as { data: { mode: string } };
      expect(data.mode).toBe('quiet');
    });

    it('a visitor request never reads or writes the question state', async () => {
      const services = createServices(VISITOR, OWNER);
      await services.kv.put('insights:question:bordesak', JSON.stringify({ kind: 'after', subject: 'jazz' }));
      vi.mocked(services.kv.put).mockClear();
      await buildApp(services)(URL_SUMMARY);

      expect(readKeys(services.kv)).not.toContain('insights:question:bordesak');
      expect(writtenKeys(services.kv)).not.toContain('insights:question:bordesak');
      expect(insights.buildWeekFacts).toHaveBeenCalledWith(MAY24, { lastQuestion: null });
    });

    it('the owner\'s question still follows the stored state when a visitor computed the facts', async () => {
      // The owner was last asked a "started" question about another subject, so this week rotates away from it.
      const stored = { kind: 'started' as const, subject: 'Some Other Artist' };
      const wf = await factsOf(MAY24);
      const rotated = insights.chooseQuestion(wf.facts, stored);
      expect(rotated?.text ?? null).not.toBe(wf.question?.text ?? null);

      const visitor = createServices(VISITOR, OWNER);
      await buildApp(visitor)(URL_SUMMARY);
      const owner = createServices(OWNER, OWNER);
      owner.kv = visitor.kv;
      owner.ai.cache = new AICache(visitor.kv);
      await owner.kv.put('insights:question:bordesak', JSON.stringify(stored));

      const { data } = await (await buildApp(owner)(URL_SUMMARY)).json() as { data: { question: string | null } };
      expect(collectWeekInputs).toHaveBeenCalledTimes(1);
      expect(data.question).toBe(rotated?.text ?? null);
    });

    it('a visitor never gets the owner\'s previous note while the marker is set', async () => {
      const owner = createServices(OWNER, OWNER);
      await buildApp(owner)(URL_SUMMARY);
      await owner.kv.delete('insights:facts:bordesak');
      await owner.kv.put('insights:generating:bordesak', '1');

      // The visitor shares the owner's KV for both the plain keys and the note cache, so only the owner gate stops it.
      const visitor = createServices(VISITOR, OWNER);
      visitor.kv = owner.kv;
      visitor.ai.cache = new AICache(owner.kv);
      vi.mocked(owner.kv.get).mockClear();
      const { data } = await (await buildApp(visitor)(URL_SUMMARY)).json() as { data: { note: string; mode: string } };
      expect(data.mode).toBe('line');
      expect(data.note).not.toBe(NOTE);
      expect(readKeys(owner.kv).filter((k) => k.startsWith('insights:last:'))).toEqual([]);
    });
  });

  describe('privacy of facts', () => {
    it('the response never contains statements, entities or the prompt view', async () => {
      for (const user of [OWNER, VISITOR]) {
        const services = createServices(user, OWNER);
        const res = await buildApp(services)(URL_SUMMARY);
        const body = JSON.stringify(await res.json());
        const wf = await factsOf(MAY24);

        for (const word of ['statement', 'entities', 'salience', 'quantities']) expect(body).not.toContain(word);
        for (const f of [wf.windowFact, ...wf.facts]) expect(body).not.toContain(JSON.stringify(f.statement).slice(1, -1));
        expect(body).not.toContain('Ranked facts');
      }
    });

    it('logs no statement, prompt-view line, note sentence, name, value or date over a full owner generation', async () => {
      const services = createServices(OWNER, OWNER);
      // Fails on a count, then on a name and a day outside the cited fact (Fri May 29 is the Boards of Canada fact's).
      const badName = { ...BAD, sentences: [S1, { text: 'Boards of Canada came up too, on Fri May 29.', facts: [1] }] };
      services.ai.getUserInsightsNote.mockResolvedValueOnce(BAD).mockResolvedValueOnce(badName);
      const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
        vi.spyOn(console, level).mockImplementation(() => {}));

      const res = await buildApp(services)(URL_SUMMARY);
      expect(res.status).toBe(200);

      const logged = spies.flatMap((spy) => spy.mock.calls.map((args) => args.map((a) =>
        typeof a === 'string' ? a : a instanceof Error ? `${a.message} ${a.stack}` : JSON.stringify(a)).join(' ')));
      expect(logged.length).toBeGreaterThan(0);
      // The log carries the fact kinds and the guard failure codes.
      expect(logged.join('\n')).toContain('genre_cluster');
      expect(logged.join('\n')).toContain('quantity-entity');
      expect(logged.join('\n')).toMatch(/\bs2:name\b/);

      const wf = await factsOf(MAY24);
      const forbidden = [
        ...[wf.windowFact, ...wf.facts].map((f) => f.statement),
        ...insights.renderPromptView(wf).split('\n').filter((line) => line.trim() !== ''),
        S1.text, S2.text, BAD.sentences[1].text, badName.sentences[1].text, NOTE,
        // Names of four or more characters: shorter ones collide with ordinary words in log prefixes.
        ...wf.names.filter((name) => name.length >= 4),
      ];
      for (const line of logged) {
        for (const text of forbidden) expect(line).not.toContain(text);
      }
      // Names again without case, so a normalised (lower-cased) name is caught too. Six or more characters:
      // shorter names ("Quiet") collide with the log's own words.
      const longNames = wf.names.filter((name) => name.length >= 6).map((name) => name.toLowerCase());
      for (const line of logged.map((l) => l.toLowerCase())) {
        for (const name of longNames) expect(line).not.toContain(name);
      }

      // No value, unit or date from the facts: guard codes are logged by type only, and the week's play count is not
      // logged. Small values collide with saliences and call counts, so they are checked as guard payloads.
      expect(logged.join('\n')).toContain('s2:date');
      const all = [wf.windowFact, ...wf.facts];
      const labels = all.flatMap((f) => f.dates.map((t) => insights.dayLabel(t, wf.timezone)));
      for (const line of logged) {
        expect(line).not.toMatch(/\b(?:quantity(?:-unit|-entity)?|date|day|month|name):[^\s,]/);
        for (const count of [wf.plays.deduped, wf.plays.raw]) expect(line).not.toMatch(new RegExp(`\\b${count}\\b`));
        for (const q of all.flatMap((f) => f.quantities)) {
          expect(line).not.toContain(`${q.value}:${q.unit}`);
          if (q.value > 100) expect(line).not.toMatch(new RegExp(`\\b${q.value}\\b`));
        }
        for (const label of labels) {
          expect(line).not.toContain(label);
          expect(line.toLowerCase()).not.toContain(label.toLowerCase().split(' ').join('-'));
          expect(line.toLowerCase()).not.toContain(label.toLowerCase().split(' ').slice(1).join('-'));
        }
      }
    });
  });

  describe('logSafeFailures', () => {
    it('keeps the sentence and the failure type, and drops every value, unit, date and fact id', () => {
      expect(logSafeFailures([
        's2:quantity-entity:41:plays', 's2:quantity:9', 's3:quantity-unit:6:months', 's2:quantity:word:twenty',
        's2:quantity:fraction:half', 's2:date:fri-may-30', 's2:day:tue', 's2:month:jun', 's2:name:fact4', 's4:name:week',
        'shape:count:5', 's1:shape:lead', 's2:shape:unknown-fact:99', 's2:shape:multiple-sentences', 's2:shape:uncited',
        's2:banned:first-time', 's1:punctuation:em-dash', 's2:something-new:41', 'odd:41:plays',
      ])).toEqual([
        's2:quantity-entity', 's2:quantity', 's3:quantity-unit', 's2:quantity',
        's2:quantity', 's2:date', 's2:day', 's2:month', 's2:name', 's4:name',
        'shape:count', 's1:shape:lead', 's2:shape:unknown-fact', 's2:shape:multiple-sentences', 's2:shape:uncited',
        's2:banned:first-time', 's1:punctuation:em-dash', 's2:other', 'other',
      ]);
    });

    it('leaves the guard result itself untouched', () => {
      const failures = ['s2:quantity-entity:41:plays'];
      logSafeFailures(failures);
      expect(failures).toEqual(['s2:quantity-entity:41:plays']);
    });
  });
});

describe('/user-insights-cooldown', () => {
  const URL_COOLDOWN = '/api/internal/user-insights-cooldown?username=bordesak';

  it('refuses a non-owner on a private profile before any KV read', async () => {
    for (const viewer of [VISITOR, null]) {
      const services = createServices(viewer, { ...OWNER, profile_visibility: 'private' });
      const res = await buildApp(services)(URL_COOLDOWN);

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'This profile is private' });
      expect(services.kv.get).not.toHaveBeenCalled();
    }
  });

  it('serves the owner of a private profile and anyone on a public one', async () => {
    const owner = createServices(OWNER, { ...OWNER, profile_visibility: 'private' });
    await owner.kv.put('insights-refresh:bordesak', String(Date.now()));
    expect(await (await buildApp(owner)(URL_COOLDOWN)).json()).toMatchObject({ canRefresh: false });

    const visitor = createServices(VISITOR, OWNER);
    expect(await (await buildApp(visitor)(URL_COOLDOWN)).json()).toEqual({ canRefresh: true, cooldownSeconds: 0 });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
