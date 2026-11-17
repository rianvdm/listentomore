// ABOUTME: Endpoint tests for /api/internal/user-insights-summary - visibility before any cache read, owner note
// ABOUTME: versus visitor line, check regeneration and fallback, the note reuse rule, refresh, the marker and logs.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { Hono } from 'hono';
import { AICache } from '@listentomore/ai';
import type { Database, Session, User } from '@listentomore/db';
import * as insights from '@listentomore/insights';
import type { WeekFacts, WeekInputs } from '@listentomore/insights';
import may24Json from '../../../../../packages/services/insights/__fixtures__/bordesak-2026-05-24.json';
import jun12Json from '../../../../../packages/services/insights/__fixtures__/bordesak-2026-06-12.json';
import { insightsInternalRoutes } from '../../api/internal/insights';
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

// Two paragraphs about the May 24 facts: the jazz returns and the Boards of Canada day. Every name is this week's and
// every number is in the prompt view, so the note passes the check.
const P1 = 'Four jazz names came back this week, led by Wes Montgomery with 8 plays, and Joe Henderson had been gone for 12+ months.';
const P2 = 'Boards of Canada took over Friday with 41 plays, including Inferno start to finish.';
const NOTE = `${P1}\n\n${P2}`;
const GOOD = {
  note: { note: NOTE, names: ['Wes Montgomery', 'Joe Henderson', 'Boards of Canada', 'Inferno'] },
  raw: JSON.stringify({ note: NOTE, names: ['Wes Montgomery', 'Joe Henderson', 'Boards of Canada', 'Inferno'] }),
  metadata: { truncated: false },
};
// Fails the check on a name the week never played and a count the prompt view does not hold.
const BAD_TEXT = 'Quillon Varga had 9999 plays this week.';
const BAD = {
  note: { note: BAD_TEXT, names: ['Quillon Varga'] },
  raw: JSON.stringify({ note: BAD_TEXT, names: ['Quillon Varga'] }),
  metadata: { truncated: false },
};
const UNPARSEABLE = { note: null, raw: 'not json', metadata: { truncated: false } };
/** Names nothing and states no number, so it passes the check on any week. */
const PLAIN_NOTE = 'A short week, mostly the usual names.\n\nNothing new broke through.';
const PLAIN = { note: { note: PLAIN_NOTE, names: [] }, raw: JSON.stringify({ note: PLAIN_NOTE, names: [] }), metadata: { truncated: false } };

/**
 * The inputs with only this week's first `n` scrobbles and no earlier ones, like a new account: no baseline, so no
 * baseline facts, and too few plays for a discovery. These weeks are quiet; under five plays, a sparse one.
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
    spotify: {
      searchAlbumByArtist: vi.fn().mockResolvedValue(null),
    },
  };
}

type Services = ReturnType<typeof createServices>;

function buildApp(services: Services) {
  const app = new Hono<InternalAppContext>();
  app.use('*', async (c, next) => {
    c.set('db', services.db as unknown as Database);
    c.set('ai', services.ai as never);
    c.set('spotify', services.spotify as never);
    await next();
  });
  app.route('/api/internal', insightsInternalRoutes);
  return (path: string) => app.request(path, SIGNED_IN, { CACHE: services.kv, LASTFM_API_KEY: 'key' });
}

/** Every key the KV mock was asked to read or write. */
const readKeys = (kv: KVNamespace): string[] => vi.mocked(kv.get).mock.calls.map(([key]) => String(key));
const writtenKeys = (kv: KVNamespace): string[] => vi.mocked(kv.put).mock.calls.map(([key]) => key);

/** What the real collector returns: release dates, here none found, only when it was handed a release lookup. */
const collected = (inputs: WeekInputs) =>
  async (args: Parameters<typeof insights.collectWeekInputs>[0]): Promise<WeekInputs> => (args.releases ? { ...inputs, releases: {} } : inputs);

async function factsOf(inputs: WeekInputs): Promise<WeekFacts> {
  const actual = await vi.importActual<typeof import('@listentomore/insights')>('@listentomore/insights');
  return actual.buildWeekFacts(inputs);
}

describe('/user-insights-summary', () => {
  beforeEach(() => {
    collectWeekInputs.mockImplementation(collected(MAY24));
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
    it('owner gets the checked note, in paragraphs, and "Your week"', async () => {
      const services = createServices(OWNER, OWNER);
      const res = await buildApp(services)(URL_SUMMARY);

      expect(res.status).toBe(200);
      const { data } = await res.json() as { data: Record<string, unknown> };
      expect(data).toEqual({
        note: NOTE,
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
      expect(await services.kv.get('insights:generating:bordesak')).toBeNull();
    });

    it('no response carries a question, and no question state is read or written', async () => {
      for (const user of [OWNER, VISITOR]) {
        const services = createServices(user, OWNER);
        const { data } = await (await buildApp(services)(URL_SUMMARY)).json() as { data: Record<string, unknown> };
        expect(data).not.toHaveProperty('question');
        expect(readKeys(services.kv).filter((k) => k.startsWith('insights:question:'))).toEqual([]);
        expect(writtenKeys(services.kv).filter((k) => k.startsWith('insights:question:'))).toEqual([]);
      }
      expect(insights.buildWeekFacts).toHaveBeenCalledWith(MAY24);
      expect(vi.mocked(insights.buildWeekFacts).mock.calls.every((args) => args.length === 1)).toBe(true);
    });

    it('caches the note, facts and last pointer with the configured TTLs', async () => {
      const services = createServices(OWNER, OWNER);
      await buildApp(services)(URL_SUMMARY);

      const ttlOf = (key: string) =>
        vi.mocked(services.kv.put).mock.calls.find(([k]) => k === key || k.startsWith(key))?.[2]?.expirationTtl;
      expect(ttlOf('insights:facts:bordesak')).toBe(24 * 3600);
      expect(ttlOf('ai:userInsightsSummary:bordesak:')).toBe(8 * 86400);
      expect(ttlOf('insights:last:bordesak')).toBe(8 * 86400);
      expect(ttlOf('insights:generating:bordesak')).toBe(60);
    });

    it('regenerates once when the check fails, then serves the second note', async () => {
      const services = createServices(OWNER, OWNER);
      services.ai.getUserInsightsNote.mockResolvedValueOnce(BAD).mockResolvedValueOnce(GOOD);
      const res = await buildApp(services)(URL_SUMMARY);

      const { data } = await res.json() as { data: { note: string; mode: string } };
      expect(services.ai.getUserInsightsNote).toHaveBeenCalledTimes(2);
      expect(data.mode).toBe('note');
      expect(data.note).toBe(NOTE);
      expect(writtenKeys(services.kv).some((k) => k.startsWith('ai:userInsightsSummary:bordesak:'))).toBe(true);
    });

    it('falls back to the code line when the check fails twice', async () => {
      const services = createServices(OWNER, OWNER);
      services.ai.getUserInsightsNote.mockResolvedValue(BAD);
      const res = await buildApp(services)(URL_SUMMARY);

      const { data } = await res.json() as { data: { note: string; mode: string } };
      expect(services.ai.getUserInsightsNote).toHaveBeenCalledTimes(2);
      expect(data.mode).toBe('line');
      expect(data.note).toBe(insights.renderLine(await factsOf(MAY24), 'second'));
      expect(writtenKeys(services.kv).filter((k) => k.startsWith('ai:userInsightsSummary'))).toEqual([]);
      expect(await services.kv.get('insights:last:bordesak', 'json')).toMatchObject({ signature: expect.any(String) });
    });

    it('falls back to the code line when the model returns no parseable note', async () => {
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

    it('a warm reload writes nothing: the pointer is unchanged', async () => {
      const services = createServices(OWNER, OWNER);
      const request = buildApp(services);
      await request(URL_SUMMARY);
      vi.mocked(services.kv.put).mockClear();

      expect((await request(URL_SUMMARY)).status).toBe(200);
      expect(services.kv.put).not.toHaveBeenCalled();
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
      // The stub still replies with the May 24 note, which fails the check on Jun 12's facts: two new calls.
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

    it('a week of 30 or more plays gets a note even when the facts call it quiet', async () => {
      const services = createServices(OWNER, OWNER);
      services.ai.getUserInsightsNote.mockResolvedValue(PLAIN);
      const quiet = onlyWeekPlays(MAY24, 30);
      const wf = await factsOf(quiet);
      expect(wf.plays.deduped).toBe(30);
      expect(wf.quiet).toBe(true);
      collectWeekInputs.mockResolvedValue(quiet);

      const { data } = await (await buildApp(services)(URL_SUMMARY)).json() as { data: { note: string; mode: string } };
      expect(services.ai.getUserInsightsNote).toHaveBeenCalledTimes(1);
      expect(data.mode).toBe('note');
      expect(data.note).toBe(PLAIN_NOTE);
      expect(data.note.split('\n\n')).toHaveLength(2);
    });

    it('a week of 29 plays makes no model call and gets the code line', async () => {
      const services = createServices(OWNER, OWNER);
      const short = onlyWeekPlays(MAY24, 29);
      const wf = await factsOf(short);
      expect(wf.plays.deduped).toBe(29);
      collectWeekInputs.mockResolvedValue(short);

      const res = await buildApp(services)(URL_SUMMARY);
      const { data } = await res.json() as { data: Record<string, unknown> };
      expect(data).toMatchObject({ note: insights.renderLine(wf, 'second'), mode: 'quiet', header: 'Your week' });
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
        data: { note: NOTE, header: 'Your week', pulledAt: first.data.pulledAt, mode: 'note', refreshing: true },
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
    it('visitor gets the third-person line, "<username>\'s week", and no model call', async () => {
      const services = createServices(VISITOR, OWNER);
      const res = await buildApp(services)(URL_SUMMARY);

      expect(res.status).toBe(200);
      const { data } = await res.json() as { data: Record<string, unknown> };
      const wf = await factsOf(MAY24);
      expect(data).toEqual({
        note: insights.renderLine({ ...wf, username: 'rian' }, 'third'),
        header: "rian's week",
        pulledAt: new Date(MAY24.now * 1000).toISOString(),
        mode: 'line',
      });
      expect(data.note).toMatch(/^rian played /);
      expect(services.ai.getUserInsightsNote).not.toHaveBeenCalled();
      expect(writtenKeys(services.kv).filter((k) => k.startsWith('ai:') || k.startsWith('insights:last'))).toEqual([]);
    });

    it('a visitor on a quiet week of 30 or more plays gets the third-person quiet line and no model call', async () => {
      const services = createServices(VISITOR, OWNER);
      const quiet = onlyWeekPlays(MAY24, 30);
      collectWeekInputs.mockResolvedValue(quiet);
      const { data } = await (await buildApp(services)(URL_SUMMARY)).json() as { data: { note: string; mode: string } };
      expect(data).toMatchObject({ note: insights.renderLine({ ...(await factsOf(quiet)), username: 'rian' }, 'third'), mode: 'quiet' });
      expect(services.ai.getUserInsightsNote).not.toHaveBeenCalled();
    });

    it('passes a release lookup to the collector for the owner and none for a visitor', async () => {
      const owner = createServices(OWNER, OWNER);
      await buildApp(owner)(URL_SUMMARY);
      const lookup = collectWeekInputs.mock.calls[0][0].releases;
      expect(lookup).toBeTypeOf('function');
      // The lookup reads Spotify quietly and maps a hit to the release fields.
      owner.spotify.searchAlbumByArtist.mockResolvedValueOnce({ name: 'Eternal Embers', artist: 'Meltt', releaseDate: '2026-11-02' });
      expect(await lookup?.('Meltt', 'Eternal Embers')).toEqual({ title: 'Eternal Embers', artist: 'Meltt', date: '2026-11-02' });
      expect(owner.spotify.searchAlbumByArtist).toHaveBeenCalledWith('Meltt', 'Eternal Embers', { quiet: true });
      expect(await lookup?.('Meltt', 'Nothing')).toBeNull();

      const visitor = createServices(VISITOR, OWNER);
      await buildApp(visitor)(URL_SUMMARY);
      expect(collectWeekInputs.mock.calls[1][0].releases).toBeUndefined();
    });

    it('the owner recomputes facts a visitor computed without release dates', async () => {
      const visitor = createServices(VISITOR, OWNER);
      await buildApp(visitor)(URL_SUMMARY);
      expect(await visitor.kv.get('insights:facts:bordesak', 'json')).toMatchObject({ releasesChecked: false });
      collectWeekInputs.mockClear();

      const owner = createServices(OWNER, OWNER);
      owner.kv = visitor.kv;
      owner.ai.cache = new AICache(visitor.kv);
      await buildApp(owner)(URL_SUMMARY);
      expect(collectWeekInputs).toHaveBeenCalledTimes(1);
      expect(await owner.kv.get('insights:facts:bordesak', 'json')).toMatchObject({ releasesChecked: true });

      // A visitor reads the owner's facts as they are.
      const again = createServices(VISITOR, OWNER);
      again.kv = visitor.kv;
      await buildApp(again)(URL_SUMMARY);
      expect(collectWeekInputs).toHaveBeenCalledTimes(1);
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

    it('logs no statement, prompt-view line, reply text, name, value or date over a full owner generation', async () => {
      const services = createServices(OWNER, OWNER);
      // Both replies fail the check: the second names a real artist absent from its text and states a day's count.
      const absent = {
        note: { note: 'Slow Crush came up too, 455 times.', names: ['Slow Crush', 'Spotlight Kid'] },
        raw: JSON.stringify({ note: 'Slow Crush came up too, 455 times.', names: ['Slow Crush', 'Spotlight Kid'] }),
        metadata: { truncated: false },
      };
      services.ai.getUserInsightsNote.mockResolvedValueOnce(BAD).mockResolvedValueOnce(absent);
      const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
        vi.spyOn(console, level).mockImplementation(() => {}));

      const res = await buildApp(services)(URL_SUMMARY);
      expect(res.status).toBe(200);
      expect((await res.json() as { data: { mode: string } }).data.mode).toBe('line');

      const logged = spies.flatMap((spy) => spy.mock.calls.map((args) => args.map((a) =>
        typeof a === 'string' ? a : a instanceof Error ? `${a.message} ${a.stack}` : JSON.stringify(a)).join(' ')));
      expect(logged.length).toBeGreaterThan(0);
      // The log carries the fact kinds and the check failure codes.
      expect(logged.join('\n')).toContain('genre_cluster');
      expect(logged).toContain('[Insights] note-attempt:1 check-failed name-unknown,number');
      expect(logged).toContain('[Insights] note-attempt:2 check-failed name-absent');

      const wf = await factsOf(MAY24);
      const forbidden = [
        ...[wf.windowFact, ...wf.facts].map((f) => f.statement),
        ...insights.renderPromptView(wf).split('\n').filter((line) => line.trim() !== ''),
        BAD_TEXT, BAD.raw, absent.note.note, absent.raw, 'Quillon Varga',
        // Names of four or more characters: shorter ones collide with ordinary words in log prefixes.
        ...wf.names.filter((name) => name.length >= 4),
      ];
      for (const line of logged) {
        for (const text of forbidden) expect(line).not.toContain(text);
        expect(line).not.toContain('bordesak');
      }
      // Names again without case, so a normalised (lower-cased) name is caught too. Six or more characters:
      // shorter names ("Quiet") collide with the log's own words.
      const longNames = wf.names.filter((name) => name.length >= 6).map((name) => name.toLowerCase());
      for (const line of logged.map((l) => l.toLowerCase())) {
        for (const name of longNames) expect(line).not.toContain(name);
      }

      // No value or date from the facts or the replies. Small values collide with saliences and call counts, so only
      // the week's play counts and values over 100 are checked.
      const all = [wf.windowFact, ...wf.facts];
      const labels = all.flatMap((f) => f.dates.map((t) => insights.dayLabel(t, wf.timezone)));
      for (const line of logged) {
        for (const count of [wf.plays.deduped, wf.plays.raw, 9999]) expect(line).not.toMatch(new RegExp(`\\b${count}\\b`));
        for (const q of all.flatMap((f) => f.quantities)) {
          expect(line).not.toContain(`${q.value}:${q.unit}`);
          if (q.value > 100) expect(line).not.toMatch(new RegExp(`\\b${q.value}\\b`));
        }
        for (const label of labels) expect(line).not.toContain(label);
      }
    });
  });

  describe('log hygiene on failures', () => {
    const SENTINEL = 'Quillon Varga';
    const consoleSpies = () =>
      (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
    const loggedLines = (spies: ReturnType<typeof consoleSpies>): string[] =>
      spies.flatMap((spy) => spy.mock.calls.map((args) => args.map((a) =>
        typeof a === 'string' ? a : a instanceof Error ? `${a.message} ${a.stack}` : JSON.stringify(a)).join(' ')));
    const noteKey = async (): Promise<string> => {
      const { USER_INSIGHTS_PROMPT_VERSION } = await import('@listentomore/ai');
      return `ai:userInsightsSummary:bordesak:${await insights.noteSignature(await factsOf(MAY24), USER_INSIGHTS_PROMPT_VERSION)}`;
    };
    /** Not JSON, and holds the note text and a sentinel name, as a parser error message would quote them. */
    const CORRUPT = `{"note": "${NOTE} ${SENTINEL}`;
    const expectClean = (logged: string[]): void => {
      for (const line of logged) {
        for (const text of [SENTINEL, NOTE, P1, P2, 'bordesak', 'JSON', 'KV failed']) expect(line).not.toContain(text);
      }
    };

    it('a corrupt note-cache entry is a miss and logs no note text, name, key or parser message', async () => {
      const services = createServices(OWNER, OWNER);
      await services.kv.put(await noteKey(), CORRUPT);
      const spies = consoleSpies();

      const { data } = await (await buildApp(services)(URL_SUMMARY)).json() as { data: { note: string; mode: string } };
      expect(data).toMatchObject({ note: NOTE, mode: 'note' });
      expect(services.ai.getUserInsightsNote).toHaveBeenCalledTimes(1);

      const logged = loggedLines(spies);
      expect(logged).toContain('[Insights] cache-read:parse ai:userInsightsSummary');
      expectClean(logged);
    });

    it('a corrupt previous note while another request generates is a miss and logs no note text', async () => {
      const services = createServices(OWNER, OWNER);
      const request = buildApp(services);
      await request(URL_SUMMARY);
      await services.kv.delete('insights:facts:bordesak');
      await services.kv.put('insights:generating:bordesak', '1');
      await services.kv.put(await noteKey(), CORRUPT);
      const spies = consoleSpies();

      const { data } = await (await request(URL_SUMMARY)).json() as { data: { note: string; refreshing?: boolean } };
      expect(data.refreshing).toBeUndefined();
      expect(data.note).toBe(NOTE);

      const logged = loggedLines(spies);
      // Once in the previous-note lookup, once in the note read after the facts are recomputed.
      expect(logged.filter((l) => l === '[Insights] cache-read:parse ai:userInsightsSummary')).toHaveLength(2);
      expectClean(logged);
    });

    it('a model-call rejection that names someone logs the attempt and error class only', async () => {
      const services = createServices(OWNER, OWNER);
      services.ai.getUserInsightsNote.mockRejectedValue(new Error(`Anthropic API error about ${SENTINEL}: ${NOTE}`));
      const spies = consoleSpies();

      const { data } = await (await buildApp(services)(URL_SUMMARY)).json() as { data: { mode: string } };
      expect(data.mode).toBe('line');

      const logged = loggedLines(spies);
      expect(logged).toContain('[Insights] note-attempt:1 call-failed kind=Error');
      expect(logged).toContain('[Insights] note-attempt:2 call-failed kind=Error');
      expectClean(logged);
    });

    it('a model-call rejection with a made-up error name logs kind=other', async () => {
      const services = createServices(OWNER, OWNER);
      const error = new Error(`about ${SENTINEL}`);
      error.name = 'QuillonVarga';
      services.ai.getUserInsightsNote.mockRejectedValue(error);
      const spies = consoleSpies();

      expect((await buildApp(services)(URL_SUMMARY)).status).toBe(200);
      const logged = loggedLines(spies);
      expect(logged).toContain('[Insights] note-attempt:1 call-failed kind=other');
      for (const line of logged) expect(line).not.toContain('QuillonVarga');
      expectClean(logged);
    });

    it('KV failures on the marker, the facts discard and the note write log fixed codes and key families only', async () => {
      const services = createServices(OWNER, OWNER);
      const fail = (key: string) => Promise.reject(new Error(`KV failed for ${key} (${SENTINEL})`));
      const fails = (key: string, prefixes: string[]) => prefixes.some((p) => key.startsWith(p));
      const kvGet = vi.mocked(services.kv.get) as unknown as Mock<(key: string, ...rest: unknown[]) => Promise<unknown>>;
      const kvPut = vi.mocked(services.kv.put) as unknown as Mock<(key: string, ...rest: unknown[]) => Promise<void>>;
      const kvDelete = vi.mocked(services.kv.delete) as unknown as Mock<(key: string) => Promise<void>>;
      const [realGet, realPut, realDelete] = [kvGet, kvPut, kvDelete].map((m) => m.getMockImplementation()!) as [
        (key: string, ...rest: unknown[]) => Promise<unknown>, (key: string, ...rest: unknown[]) => Promise<void>, (key: string) => Promise<void>,
      ];
      let failingGets: string[] = [];
      let failingPuts: string[] = [];
      let failingDeletes: string[] = [];
      kvGet.mockImplementation((key, ...rest) => (fails(key, failingGets) ? fail(key) : realGet(key, ...rest)));
      kvPut.mockImplementation((key, ...rest) => (fails(key, failingPuts) ? fail(key) : realPut(key, ...rest)));
      kvDelete.mockImplementation((key) => (fails(key, failingDeletes) ? fail(key) : realDelete(key)));
      const spies = consoleSpies();
      const request = buildApp(services);

      // First load: the previous-note marker read, the marker write and the note write fail.
      failingGets = ['insights:generating:'];
      failingPuts = ['insights:generating:', 'ai:userInsightsSummary:'];
      expect((await request(URL_SUMMARY)).status).toBe(200);

      // A refresh: the facts discard and the marker clear fail.
      failingGets = [];
      failingPuts = [];
      failingDeletes = ['insights:facts:', 'insights:generating:'];
      expect((await request(URL_REFRESH)).status).toBe(200);

      const logged = loggedLines(spies);
      for (const code of [
        '[Insights] cache-read:error insights:generating',
        '[Insights] cache-write:error insights:generating',
        '[Insights] cache-write:error ai:userInsightsSummary',
        '[Insights] cache-delete:error insights:facts',
        '[Insights] cache-delete:error insights:generating',
      ]) expect(logged).toContain(code);
      expectClean(logged);
    });

    it('a generation failure whose message carries a key and a name logs a fixed code and the error class only', async () => {
      const services = createServices(OWNER, OWNER);
      collectWeekInputs.mockRejectedValue(new insights.InsightsFetchError(
        `Could not read the current week: KV failed for lastfm:scrobbles:bordesak:2026-05-20 (${SENTINEL})`));
      const spies = consoleSpies();

      const res = await buildApp(services)(URL_SUMMARY);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'Failed to generate insights' });

      const logged = loggedLines(spies);
      expect(logged).toContain('[Insights] summary:error kind=InsightsFetchError');
      for (const line of logged) expect(line).not.toContain('Could not read');
      expectClean(logged);
    });

    it('refresh-cooldown read and write failures log a fixed code, the key family and the error class only', async () => {
      const services = createServices(OWNER, OWNER);
      const fail = (key: string) => Promise.reject(new Error(`KV failed for ${key} (${SENTINEL})`));
      const kvGet = vi.mocked(services.kv.get) as unknown as Mock<(key: string, ...rest: unknown[]) => Promise<unknown>>;
      const kvPut = vi.mocked(services.kv.put) as unknown as Mock<(key: string, ...rest: unknown[]) => Promise<void>>;
      const realGet = kvGet.getMockImplementation()!;
      const realPut = kvPut.getMockImplementation()!;
      kvGet.mockImplementation((key, ...rest) => (key.startsWith('insights-refresh:') ? fail(key) : realGet(key, ...rest)));
      kvPut.mockImplementation((key, ...rest) => (key.startsWith('insights-refresh:') ? fail(key) : realPut(key, ...rest)));
      const spies = consoleSpies();

      // A failed read allows the refresh, and a failed write lets it go ahead without a cooldown.
      expect((await buildApp(services)(URL_REFRESH)).status).toBe(200);

      const logged = loggedLines(spies);
      expect(logged).toContain('[Insights] cache-read:error insights-refresh kind=Error');
      expect(logged).toContain('[Insights] cache-write:error insights-refresh kind=Error');
      expectClean(logged);
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
