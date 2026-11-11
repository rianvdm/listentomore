// ABOUTME: Endpoint tests for /api/internal/user-insights-trivia - visibility before any cache read, owner-only
// ABOUTME: generation, the MusicBrainz cap, the making-of fallback, the per-profile card cache and name-free logs.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { AlbumTriviaResult } from '@listentomore/ai';
import type { Database, Session, User } from '@listentomore/db';
import * as insights from '@listentomore/insights';
import type { CardAlbum, Fact, WeekFacts, WeekInputs } from '@listentomore/insights';
import may24Json from '../../../../../packages/services/insights/__fixtures__/bordesak-2026-05-24.json';
import { insightsInternalRoutes } from '../../api/internal/insights';
import { renderCard } from '../../api/internal/insights-card';
import type { InternalAppContext } from '../../types';
import { createMockKV } from '../utils/mocks';

vi.mock('@listentomore/insights', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@listentomore/insights')>();
  return { ...actual, collectWeekInputs: vi.fn(), cardSignature: vi.fn(actual.cardSignature) };
});

const collectWeekInputs = vi.mocked(insights.collectWeekInputs);
const MAY24 = may24Json as unknown as WeekInputs;
const DAY = 86400;

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
const URL_TRIVIA = '/api/internal/user-insights-trivia?username=bordesak';

const EARTHLING: CardAlbum = { artist: 'David Bowie', album: 'Earthling', plays: 30 };
const SEA_CHANGE: CardAlbum = { artist: 'Beck', album: 'Sea Change', plays: 12 };
const ART = 'https://i.scdn.co/image/cover';
const FACT = {
  text: 'Inferno was recorded in two weeks in 2023.',
  sourceUrl: 'https://a.example/x',
  raw: 'x',
  metadata: { truncated: false },
} as unknown as AlbumTriviaResult;
const NONE = { text: null, sourceUrl: null, raw: 'NONE', metadata: { truncated: false } } as unknown as AlbumTriviaResult;
const CARD_FIELDS = ['kind', 'album', 'artist', 'text', 'sourceUrl', 'imageUrl'];

// ---------------------------------------------------------------------------------------------------------------
// MusicBrainz, mocked at fetch by URL
// ---------------------------------------------------------------------------------------------------------------

interface MbGuest { id: string; name: string; bands: string[] }
interface MbAlbumSpec { guests?: MbGuest[] }

/** A guest credited on drums, with `member of band` links to each of `bands`. */
const mbGuest = (id: string, bands: string[], name = `Person ${id}`): MbGuest => ({ id, name, bands });

/**
 * Serves MusicBrainz by URL: release-group searches by the album and artist in the query, and release-group, release
 * and artist lookups by id. Ids are opaque counters, so no name reaches a request path. Any other URL rejects.
 */
function mockMusicBrainz() {
  const searches = new Map<string, unknown>();
  const entities = new Map<string, unknown>();
  let calls = 0;
  let next = 0;
  let failStatus: number | null = null;
  const bandIds = new Map<string, string>();
  const bandId = (name: string): string => {
    if (!bandIds.has(name)) bandIds.set(name, `band-${bandIds.size + 1}`);
    return bandIds.get(name)!;
  };

  const fetchMock = vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== 'musicbrainz.org') throw new Error('Unexpected fetch in the card test');
    calls += 1;
    if (failStatus !== null) return new Response('{}', { status: failStatus });
    const path = url.pathname.replace(/^\/ws\/2/, '');
    if (path === '/release-group/') {
      const match = /releasegroup:"(.*)" AND artist:"(.*)"$/.exec(url.searchParams.get('query') ?? '');
      const body = match ? searches.get(`${match[2]}|${match[1]}`) : undefined;
      return Response.json(body ?? { 'release-groups': [] });
    }
    const body = entities.get(path);
    return body === undefined ? new Response('{}', { status: 404 }) : Response.json(body);
  });
  vi.mocked(globalThis.fetch).mockImplementation(fetchMock as typeof fetch);

  return {
    /** Serves an album: null is an empty search; a spec serves its release group, release and artists. */
    album(artist: string, title: string, spec: MbAlbumSpec | null): void {
      if (spec === null) {
        searches.set(`${artist}|${title}`, { 'release-groups': [] });
        return;
      }
      next += 1;
      const rg = `rg-${next}`;
      const release = `rel-${next}`;
      const albumArtist = `art-${next}`;
      const guests = spec.guests ?? [];
      searches.set(`${artist}|${title}`, { 'release-groups': [{ id: rg, score: 100, title, 'primary-type': 'Album' }] });
      entities.set(`/release-group/${rg}`, { id: rg, releases: [{ id: release, status: 'Official', date: '1997-02-03' }] });
      entities.set(`/release/${release}`, {
        id: release,
        'artist-credit': [{ name: artist, joinphrase: '', artist: { id: albumArtist, name: artist } }],
        relations: guests.map((g) => ({
          type: 'instrument',
          'target-type': 'artist',
          attributes: ['drums'],
          artist: { id: g.id, name: g.name },
        })),
        media: [],
      });
      entities.set(`/artist/${albumArtist}`, { id: albumArtist, name: artist, type: 'Person', relations: [] });
      for (const g of guests) {
        entities.set(`/artist/${g.id}`, {
          id: g.id,
          name: g.name,
          type: 'Person',
          relations: g.bands.map((band) => ({
            type: 'member of band',
            'target-type': 'artist',
            direction: 'forward',
            attributes: [],
            ended: true,
            artist: { id: bandId(band), name: band },
          })),
        });
      }
    },
    /** Every later MusicBrainz request answers with this status. */
    fail(status: number): void {
      failStatus = status;
    },
    calls: (): number => calls,
    fetch: fetchMock,
  };
}

let mb: ReturnType<typeof mockMusicBrainz>;

// ---------------------------------------------------------------------------------------------------------------
// The app
// ---------------------------------------------------------------------------------------------------------------

function createServices(sessionUser: User | null, profile: User) {
  return {
    kv: createMockKV(),
    db: {
      getSessionByToken: vi.fn().mockResolvedValue(sessionUser ? { ...SESSION, user_id: sessionUser.id } : null),
      getUser: vi.fn().mockResolvedValue(sessionUser),
      updateSessionActivity: vi.fn().mockResolvedValue(undefined),
      getUserByLastfmUsername: vi.fn().mockResolvedValue(profile),
      getUserByUsername: vi.fn().mockResolvedValue(null),
    },
    ai: { getAlbumTrivia: vi.fn().mockResolvedValue(NONE) },
    spotify: { search: { searchAlbumByArtist: vi.fn().mockResolvedValue({ image: ART }) } },
  };
}

type Services = ReturnType<typeof createServices>;

/** The rate limiter namespace: every reservation is granted at once. */
const limiterNamespace = () => ({
  idFromName: vi.fn(() => 'global'),
  get: vi.fn(() => ({ reserve: vi.fn(async () => 0) })),
});

function buildApp(services: Services) {
  const app = new Hono<InternalAppContext>();
  app.use('*', async (c, next) => {
    c.set('db', services.db as unknown as Database);
    c.set('ai', services.ai as never);
    c.set('spotify', services.spotify as never);
    await next();
  });
  app.route('/api/internal', insightsInternalRoutes);
  const env = { CACHE: services.kv, LASTFM_API_KEY: 'key', MUSICBRAINZ_RATE_LIMITER: limiterNamespace() };
  return (path: string) => app.request(path, SIGNED_IN, env);
}

const writtenKeys = (kv: KVNamespace): string[] => vi.mocked(kv.put).mock.calls.map(([key]) => key);
const ttlOf = (kv: KVNamespace, key: string): number | undefined =>
  vi.mocked(kv.put).mock.calls.find(([k]) => k === key)?.[2]?.expirationTtl;

async function weekFacts(): Promise<WeekFacts> {
  const actual = await vi.importActual<typeof import('@listentomore/insights')>('@listentomore/insights');
  return actual.buildWeekFacts(MAY24);
}

/** The May 24 facts with these card candidates. Its standout album is Inferno by Boards of Canada. */
const wfWith = async (cardAlbums: CardAlbum[]): Promise<WeekFacts> => ({ ...(await weekFacts()), cardAlbums });

/** Seeds the cached facts without counting the write. */
async function seedFacts(kv: KVNamespace, wf: WeekFacts): Promise<void> {
  await kv.put(insights.keys.facts('bordesak'), JSON.stringify(wf));
  vi.mocked(kv.put).mockClear();
}

/** Seeds the overall top-artist list (keys are norm(artist)) without counting the write. */
async function seedOverall(kv: KVNamespace, counts: Record<string, number>): Promise<void> {
  const ranks = Object.fromEntries(Object.keys(counts).map((name, i) => [name, i + 1]));
  await kv.put(insights.keys.topList('bordesak', 'overall'), JSON.stringify({ fetchedAt: 0, complete: true, counts, ranks }));
  vi.mocked(kv.put).mockClear();
}

/** Silences and records every console method. */
const consoleSpies = () =>
  (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));

/** Every recorded console call as one line, errors with their message and stack. */
const loggedLines = (spies: ReturnType<typeof consoleSpies>): string[] =>
  spies.flatMap((spy) => spy.mock.calls.map((args) => args.map((a) =>
    typeof a === 'string' ? a : a instanceof Error ? `${a.message} ${a.stack}` : JSON.stringify(a)).join(' ')));

const json = async (res: Response) => (await res.json()) as { data: Record<string, string> | null };

describe('/user-insights-trivia', () => {
  beforeEach(() => {
    mb = mockMusicBrainz();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('visibility and missing inputs', () => {
    it('refuses a visitor on a private profile before touching KV', async () => {
      const services = createServices(VISITOR, { ...OWNER, profile_visibility: 'private' });
      const res = await buildApp(services)(URL_TRIVIA);

      expect(res.status).toBe(403);
      expect(services.kv.get).not.toHaveBeenCalled();
      expect(services.kv.put).not.toHaveBeenCalled();
      expect(mb.calls()).toBe(0);
    });

    it('requires a username', async () => {
      const services = createServices(OWNER, OWNER);
      const res = await buildApp(services)('/api/internal/user-insights-trivia');
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Missing username parameter' });
    });

    it('returns data: null when the facts are not cached or the overall list is missing', async () => {
      const noFacts = createServices(OWNER, OWNER);
      await seedOverall(noFacts.kv, { 'red hot chili peppers': 19 });
      const noOverall = createServices(OWNER, OWNER);
      await seedFacts(noOverall.kv, await wfWith([EARTHLING]));
      mb.album('David Bowie', 'Earthling', { guests: [mbGuest('chad', ['Red Hot Chili Peppers'])] });

      for (const services of [noFacts, noOverall]) {
        const res = await buildApp(services)(URL_TRIVIA);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ data: null });
        expect(writtenKeys(services.kv)).toEqual([]);
        expect(services.spotify.search.searchAlbumByArtist).not.toHaveBeenCalled();
        expect(services.ai.getAlbumTrivia).not.toHaveBeenCalled();
      }
      expect(mb.calls()).toBe(0);
      expect(collectWeekInputs).not.toHaveBeenCalled();
    });

    it('returns data: null for facts this code did not compute', async () => {
      const services = createServices(OWNER, OWNER);
      await seedFacts(services.kv, { ...(await wfWith([EARTHLING])), ruleVersion: 'old' });
      await seedOverall(services.kv, { 'red hot chili peppers': 19 });

      expect(await json(await buildApp(services)(URL_TRIVIA))).toEqual({ data: null });
      expect(mb.calls()).toBe(0);
      expect(writtenKeys(services.kv)).toEqual([]);
    });

    it('a visitor gets data: null and starts nothing when no card is cached', async () => {
      const services = createServices(VISITOR, OWNER);
      await seedFacts(services.kv, await wfWith([EARTHLING]));
      await seedOverall(services.kv, { 'red hot chili peppers': 19 });
      mb.album('David Bowie', 'Earthling', { guests: [mbGuest('chad', ['Red Hot Chili Peppers'])] });

      expect(await (await buildApp(services)(URL_TRIVIA)).json()).toEqual({ data: null });
      expect(mb.calls()).toBe(0);
      expect(writtenKeys(services.kv)).toEqual([]);
      for (const spy of [services.spotify.search.searchAlbumByArtist, services.ai.getAlbumTrivia, collectWeekInputs]) {
        expect(spy).not.toHaveBeenCalled();
      }
    });
  });

  describe('owner generation', () => {
    it('owner gets a tie-back card cached under insights:card for 8 days', async () => {
      mb.album('David Bowie', 'Earthling', { guests: [mbGuest('chad', ['Red Hot Chili Peppers'], 'Chad Smith')] });
      const services = createServices(OWNER, OWNER);
      const wf = await wfWith([EARTHLING]);
      await seedFacts(services.kv, wf);
      await seedOverall(services.kv, { 'red hot chili peppers': 19 });

      const res = await buildApp(services)(URL_TRIVIA);
      expect(res.status).toBe(200);
      expect((await json(res)).data).toEqual({
        kind: 'tieback',
        album: 'Earthling',
        artist: 'David Bowie',
        text: "Chad Smith plays drums on Earthling and has played in Red Hot Chili Peppers, a band you've played 19 times.",
        imageUrl: ART,
      });
      expect(ttlOf(services.kv, 'insights:card:bordesak')).toBe(8 * DAY);
      const cached = await services.kv.get('insights:card:bordesak', 'json') as Record<string, unknown>;
      expect(cached).toMatchObject({
        signature: await insights.cardSignature(wf),
        eligible: 'red hot chili peppers=19',
        card: { kind: 'tieback', album: 'Earthling', artist: 'David Bowie', imageUrl: ART },
      });
      expect(cached.considered).toContain('red hot chili peppers');
      expect(services.spotify.search.searchAlbumByArtist).toHaveBeenCalledWith('David Bowie', 'Earthling', { quiet: true });
      expect(services.ai.getAlbumTrivia).not.toHaveBeenCalled();
      expect(collectWeekInputs).not.toHaveBeenCalled();
    });

    it('shows the album without its edition suffix, and searches MusicBrainz and Spotify as before', async () => {
      const deluxe: CardAlbum = { artist: 'David Bowie', album: 'Earthling (Deluxe Edition)', plays: 30 };
      // MusicBrainz is searched for the stripped title, so only that title is served.
      mb.album('David Bowie', 'Earthling', { guests: [mbGuest('chad', ['Red Hot Chili Peppers'], 'Chad Smith')] });
      const services = createServices(OWNER, OWNER);
      await seedFacts(services.kv, await wfWith([deluxe]));
      await seedOverall(services.kv, { 'red hot chili peppers': 19 });

      const { data } = await json(await buildApp(services)(URL_TRIVIA));
      expect(data).toEqual({
        kind: 'tieback',
        album: 'Earthling',
        artist: 'David Bowie',
        text: "Chad Smith plays drums on Earthling and has played in Red Hot Chili Peppers, a band you've played 19 times.",
        imageUrl: ART,
      });
      // The stored card keeps the Last.fm spelling; only what is shown drops the suffix.
      const cached = await services.kv.get('insights:card:bordesak', 'json') as { card: { album: string } };
      expect(cached.card.album).toBe('Earthling (Deluxe Edition)');
      expect(services.spotify.search.searchAlbumByArtist).toHaveBeenCalledWith('David Bowie', 'Earthling (Deluxe Edition)', { quiet: true });
    });

    it('a second load serves it with no MusicBrainz, Spotify or model call', async () => {
      mb.album('David Bowie', 'Earthling', { guests: [mbGuest('chad', ['Red Hot Chili Peppers'])] });
      const services = createServices(OWNER, OWNER);
      await seedFacts(services.kv, await wfWith([EARTHLING]));
      await seedOverall(services.kv, { 'red hot chili peppers': 19 });
      const app = buildApp(services);

      const first = await json(await app(URL_TRIVIA));
      const callsAfterFirst = mb.calls();
      services.spotify.search.searchAlbumByArtist.mockClear();
      vi.mocked(services.kv.put).mockClear();

      const second = await json(await app(URL_TRIVIA));
      expect(second).toEqual(first);
      expect(mb.calls()).toBe(callsAfterFirst);
      expect(services.spotify.search.searchAlbumByArtist).not.toHaveBeenCalled();
      expect(services.ai.getAlbumTrivia).not.toHaveBeenCalled();
      expect(writtenKeys(services.kv)).toEqual([]);
    });

    it('the owner reads "you\'ve played" and a visitor "rian has played" from the same cached card', async () => {
      mb.album('David Bowie', 'Earthling', { guests: [mbGuest('chad', ['Red Hot Chili Peppers'])] });
      const owner = createServices(OWNER, OWNER);
      await seedFacts(owner.kv, await wfWith([EARTHLING]));
      await seedOverall(owner.kv, { 'red hot chili peppers': 19 });
      expect((await json(await buildApp(owner)(URL_TRIVIA))).data?.text).toContain("a band you've played 19 times.");
      const calls = mb.calls();

      const visitor = createServices(VISITOR, OWNER);
      visitor.kv = owner.kv;
      vi.mocked(owner.kv.put).mockClear();
      const { data } = await json(await buildApp(visitor)(URL_TRIVIA));
      expect(data?.text).toContain('a band rian has played 19 times.');
      expect(data).toMatchObject({ kind: 'tieback', album: 'Earthling', imageUrl: ART });
      expect(mb.calls()).toBe(calls);
      expect(writtenKeys(owner.kv)).toEqual([]);
      expect(visitor.spotify.search.searchAlbumByArtist).not.toHaveBeenCalled();
    });

    it('a cap hit mid-album returns null, caches no card and keeps the fetched credits', async () => {
      // 2 calls find the release, 1 reads its credits, 1 reads Bowie, then 12 guests: 16 calls; only the 12th is in RHCP
      mb.album('David Bowie', 'Earthling', {
        guests: [...Array.from({ length: 11 }, (_, i) => mbGuest(`g${i}`, [])), mbGuest('chad', ['Red Hot Chili Peppers'])],
      });
      const services = createServices(OWNER, OWNER);
      await seedFacts(services.kv, await wfWith([EARTHLING]));
      await seedOverall(services.kv, { 'red hot chili peppers': 19 });
      const app = buildApp(services);

      expect(await (await app(URL_TRIVIA)).json()).toEqual({ data: null });
      expect(mb.calls()).toBe(10);
      const written = writtenKeys(services.kv);
      expect(written.filter((k) => k.startsWith('musicbrainz:credits:'))).toHaveLength(9); // rg, release, Bowie, 6 guests
      expect(written.some((k) => k.startsWith('insights:card:') || k.startsWith('insights:trivia:'))).toBe(false);
      expect(services.ai.getAlbumTrivia).not.toHaveBeenCalled();

      const second = (await (await app(URL_TRIVIA)).json()) as { data: Record<string, string> };
      expect(mb.calls()).toBe(16);
      expect(collectWeekInputs).not.toHaveBeenCalled();
      expect(second.data).toMatchObject({ kind: 'tieback', album: 'Earthling' });
      expect(second.data.text).toContain("a band you've played 19 times.");
    });

    it('moves past a candidate with no release group', async () => {
      mb.album('DJ Nobody', 'Mixtape Vol. 3', null);
      mb.album('Beck', 'Sea Change', { guests: [mbGuest('jmj', ['Nine Inch Nails'])] });
      const services = createServices(OWNER, OWNER);
      await seedFacts(services.kv, await wfWith([{ artist: 'DJ Nobody', album: 'Mixtape Vol. 3', plays: 40 }, SEA_CHANGE]));
      await seedOverall(services.kv, { 'nine inch nails': 60 });

      expect((await json(await buildApp(services)(URL_TRIVIA))).data).toMatchObject({ kind: 'tieback', album: 'Sea Change' });
      expect(writtenKeys(services.kv).some((k) => k.startsWith('musicbrainz:credits:rg:dj%20nobody:'))).toBe(true);
      expect(services.ai.getAlbumTrivia).not.toHaveBeenCalled();
    });

    it('falls back to the making-of fact only after every candidate is checked', async () => {
      mb.album('David Bowie', 'Earthling', { guests: [mbGuest('g1', ['Some Band'])] });
      mb.album('Beck', 'Sea Change', { guests: [mbGuest('g2', [])] });
      const services = createServices(OWNER, OWNER);
      services.ai.getAlbumTrivia.mockResolvedValue(FACT);
      const wf = await wfWith([EARTHLING, SEA_CHANGE]);
      await seedFacts(services.kv, wf);
      await seedOverall(services.kv, { 'some band': 3 });

      const { data } = await json(await buildApp(services)(URL_TRIVIA));
      expect(data).toEqual({
        kind: 'making_of',
        album: 'Inferno',
        artist: 'Boards of Canada',
        text: FACT.text,
        sourceUrl: FACT.sourceUrl,
        imageUrl: ART,
      });
      expect(insights.standoutAlbum(wf)).toEqual({ artist: 'Boards of Canada', album: 'Inferno' });
      expect(services.ai.getAlbumTrivia).toHaveBeenCalledTimes(1);
      expect(services.ai.getAlbumTrivia).toHaveBeenCalledWith('Boards of Canada', 'Inferno');
      // Both albums: search, release group, release, the album artist and one guest each.
      expect(mb.calls()).toBe(10);
      const lastMbCall = Math.max(...mb.fetch.mock.invocationCallOrder);
      expect(services.ai.getAlbumTrivia.mock.invocationCallOrder[0]).toBeGreaterThan(lastMbCall);
      expect(services.spotify.search.searchAlbumByArtist).toHaveBeenCalledWith('Boards of Canada', 'Inferno', { quiet: true });
      expect(ttlOf(services.kv, 'insights:card:bordesak')).toBe(8 * DAY);
    });

    it('regenerates when a considered band crosses from 9 to 10 plays, with the same candidates', async () => {
      mb.album('David Bowie', 'Earthling', { guests: [mbGuest('chad', ['Red Hot Chili Peppers'])] });
      const services = createServices(OWNER, OWNER);
      await seedFacts(services.kv, await wfWith([EARTHLING]));
      await seedOverall(services.kv, { 'red hot chili peppers': 9 });
      const app = buildApp(services);

      expect(await json(await app(URL_TRIVIA))).toEqual({ data: null });
      expect(await services.kv.get('insights:card:bordesak', 'json')).toMatchObject({ card: null, eligible: '' });
      const calls = mb.calls();

      // A second load at 9 serves the cached null card.
      vi.mocked(services.kv.put).mockClear();
      expect(await json(await app(URL_TRIVIA))).toEqual({ data: null });
      expect(writtenKeys(services.kv)).toEqual([]);

      await seedOverall(services.kv, { 'red hot chili peppers': 10 });
      const { data } = await json(await app(URL_TRIVIA));
      expect(data).toMatchObject({ kind: 'tieback', album: 'Earthling' });
      expect(data?.text).toContain("a band you've played 10 times.");
      expect(mb.calls()).toBe(calls);
    });

    it('regenerates when the making-of standout changes, with the same candidates', async () => {
      mb.album('Beck', 'Sea Change', { guests: [mbGuest('g2', [])] });
      const services = createServices(OWNER, OWNER);
      services.ai.getAlbumTrivia.mockResolvedValue(NONE);
      const base = await wfWith([SEA_CHANGE]);
      const inferno = base.facts.find((f) => f.subject === 'Boards of Canada') as Fact;
      const releaseWeek: Fact = {
        ...inferno,
        kind: 'release_week',
        subject: 'Beck',
        albums: [{ artist: 'Beck', album: 'Sea Change' }],
        statement: 'Sea Change came out this week.',
      };
      const rest = base.facts.filter((f) => f !== inferno);
      const first: WeekFacts = { ...base, facts: [releaseWeek, inferno, ...rest] };
      const swapped: WeekFacts = { ...base, facts: [inferno, releaseWeek, ...rest] };
      expect(await insights.cardSignature(first)).not.toBe(await insights.cardSignature(swapped));
      await seedFacts(services.kv, first);
      await seedOverall(services.kv, {});
      const app = buildApp(services);

      expect(await json(await app(URL_TRIVIA))).toEqual({ data: null });
      expect(services.ai.getAlbumTrivia).toHaveBeenLastCalledWith('Beck', 'Sea Change');

      await seedFacts(services.kv, swapped);
      expect(await json(await app(URL_TRIVIA))).toEqual({ data: null });
      expect(services.ai.getAlbumTrivia).toHaveBeenCalledTimes(2);
      expect(services.ai.getAlbumTrivia).toHaveBeenLastCalledWith('Boards of Canada', 'Inferno');
    });

    it('a making-of error or a MusicBrainz 503 caches nothing', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(console, 'log').mockImplementation(() => {});
      mb.album('Beck', 'Sea Change', { guests: [mbGuest('g2', [])] });

      const failedTrivia = createServices(OWNER, OWNER);
      failedTrivia.ai.getAlbumTrivia.mockRejectedValue(new Error('upstream'));
      await seedFacts(failedTrivia.kv, await wfWith([SEA_CHANGE]));
      await seedOverall(failedTrivia.kv, {});
      expect(await json(await buildApp(failedTrivia)(URL_TRIVIA))).toEqual({ data: null });
      expect(failedTrivia.ai.getAlbumTrivia).toHaveBeenCalledTimes(1);
      expect(writtenKeys(failedTrivia.kv).some((k) => k.startsWith('insights:'))).toBe(false);

      mb.fail(503);
      const down = createServices(OWNER, OWNER);
      await seedFacts(down.kv, await wfWith([EARTHLING]));
      await seedOverall(down.kv, {});
      expect(await json(await buildApp(down)(URL_TRIVIA))).toEqual({ data: null });
      expect(writtenKeys(down.kv)).toEqual([]);
      expect(down.ai.getAlbumTrivia).not.toHaveBeenCalled();
    });

    it('a stored card with no image leaves imageUrl out', async () => {
      mb.album('David Bowie', 'Earthling', { guests: [mbGuest('chad', ['Red Hot Chili Peppers'])] });
      const services = createServices(OWNER, OWNER);
      services.spotify.search.searchAlbumByArtist.mockRejectedValue(new Error('spotify down'));
      await seedFacts(services.kv, await wfWith([EARTHLING]));
      await seedOverall(services.kv, { 'red hot chili peppers': 19 });

      const { data } = await json(await buildApp(services)(URL_TRIVIA));
      expect(data).toMatchObject({ kind: 'tieback' });
      expect(data).not.toHaveProperty('imageUrl');
      expect(data).not.toHaveProperty('sourceUrl');
    });

    it('the response holds only the card fields', async () => {
      mb.album('David Bowie', 'Earthling', { guests: [mbGuest('chad', ['Red Hot Chili Peppers'])] });
      mb.album('Beck', 'Sea Change', { guests: [mbGuest('g2', [])] });

      const tieback = createServices(OWNER, OWNER);
      await seedFacts(tieback.kv, await wfWith([EARTHLING]));
      await seedOverall(tieback.kv, { 'red hot chili peppers': 19 });
      const makingOf = createServices(OWNER, OWNER);
      makingOf.ai.getAlbumTrivia.mockResolvedValue(FACT);
      await seedFacts(makingOf.kv, await wfWith([SEA_CHANGE]));
      await seedOverall(makingOf.kv, {});

      for (const services of [tieback, makingOf]) {
        const body = (await (await buildApp(services)(URL_TRIVIA)).json()) as Record<string, unknown>;
        expect(Object.keys(body)).toEqual(['data']);
        const data = body.data as Record<string, unknown>;
        expect(data).not.toBeNull();
        for (const key of Object.keys(data)) expect(CARD_FIELDS).toContain(key);
        for (const value of Object.values(data)) expect(typeof value).toBe('string');
      }
    });

    it('a card-cache value that is not JSON is a miss, and the parse failure logs no name or value', async () => {
      const spies = consoleSpies();
      mb.album('David Bowie', 'Earthling', { guests: [mbGuest('chad', ['Red Hot Chili Peppers'])] });
      const services = createServices(OWNER, OWNER);
      await seedFacts(services.kv, await wfWith([EARTHLING]));
      await seedOverall(services.kv, { 'red hot chili peppers': 19 });
      await services.kv.put('insights:card:bordesak', '{"card": Hollow Meridian by Quillon Varga');
      vi.mocked(services.kv.put).mockClear();

      const res = await buildApp(services)(URL_TRIVIA);
      expect(res.status).toBe(200);
      expect((await json(res)).data).toMatchObject({ kind: 'tieback', album: 'Earthling' });

      const logged = loggedLines(spies);
      expect(logged).toContain('[Insights] cache-read:parse insights:card');
      for (const line of logged) {
        for (const text of ['Hollow Meridian', 'Quillon Varga', 'insights:card:bordesak', 'JSON']) expect(line).not.toContain(text);
      }
    });

    it('a rejected card write logs no name or value, and still serves the card', async () => {
      const spies = consoleSpies();
      mb.album('David Bowie', 'Earthling', { guests: [mbGuest('chad', ['Red Hot Chili Peppers'], 'Chad Smith')] });
      const services = createServices(OWNER, OWNER);
      await seedFacts(services.kv, await wfWith([EARTHLING]));
      await seedOverall(services.kv, { 'red hot chili peppers': 19 });
      const put = vi.mocked(services.kv.put);
      const realPut = put.getMockImplementation()!;
      put.mockImplementation(async (key, value, options) => {
        if (key === 'insights:card:bordesak') throw new Error(`KV put failed for ${key}: ${String(value).slice(0, 80)}`);
        return realPut(key, value, options);
      });

      const res = await buildApp(services)(URL_TRIVIA);
      expect(res.status).toBe(200);
      expect((await json(res)).data).toMatchObject({ kind: 'tieback', album: 'Earthling' });
      expect(await services.kv.get('insights:card:bordesak')).toBeNull();

      const logged = loggedLines(spies);
      expect(logged).toContain('[Insights] cache-write:error insights:card');
      for (const line of logged) {
        for (const text of ['Chad Smith', 'Earthling', 'David Bowie', 'Red Hot Chili Peppers', 'insights:card:bordesak', 'KV put failed']) {
          expect(line).not.toContain(text);
        }
      }
    });

    it('a malformed cached card is a miss: the owner regenerates and a visitor gets null, never a 500', async () => {
      consoleSpies();
      mb.album('David Bowie', 'Earthling', { guests: [mbGuest('chad', ['Red Hot Chili Peppers'])] });
      const wf = await wfWith([EARTHLING]);
      const signature = await insights.cardSignature(wf);
      const person = {
        artist: { id: 'chad', name: 'Chad Smith' }, role: 'drums', performs: true, producer: false, coProducer: false, member: false,
      };
      const tieBack = { album: 'Earthling', albumArtist: 'David Bowie', people: [person], band: 'Red Hot Chili Peppers', plays: 19, direct: false };
      const card = { kind: 'tieback', album: 'Earthling', artist: 'David Bowie', imageUrl: null, tieBack };
      const malformed: unknown[] = [
        { ...card, tieBack: { ...tieBack, people: [{}] } },
        { ...card, tieBack: { ...tieBack, people: [{ ...person, artist: { id: 'chad' } }] } },
        { ...card, tieBack: { ...tieBack, people: [{ ...person, performs: 'yes' }] } },
        { ...card, tieBack: { ...tieBack, people: [] } },
        { ...card, tieBack: { ...tieBack, people: [person, person, person] } },
        { ...card, tieBack: { ...tieBack, plays: '19' } },
        { ...card, tieBack: { ...tieBack, albumArtist: undefined } },
        { ...card, tieBack: { ...tieBack, direct: undefined } },
        { ...card, tieBack: null },
        { ...card, kind: 'other' },
        { kind: 'making_of', album: 'Earthling', artist: 'David Bowie', imageUrl: null, text: 'x' },
        { ...card, imageUrl: 5 },
      ];

      for (const entry of malformed) {
        for (const viewer of [OWNER, VISITOR]) {
          const services = createServices(viewer, OWNER);
          await seedFacts(services.kv, wf);
          await seedOverall(services.kv, { 'red hot chili peppers': 19 });
          await services.kv.put('insights:card:bordesak', JSON.stringify({
            signature, considered: ['red hot chili peppers'], eligible: 'red hot chili peppers=19', card: entry,
          }));
          const res = await buildApp(services)(URL_TRIVIA);
          expect(res.status).toBe(200);
          const { data } = await json(res);
          if (viewer === OWNER) expect(data).toMatchObject({ kind: 'tieback', album: 'Earthling' });
          else expect(data).toBeNull();
        }
      }

      // The well-formed entry is served as cached, with no MusicBrainz call.
      const services = createServices(VISITOR, OWNER);
      await seedFacts(services.kv, wf);
      await seedOverall(services.kv, { 'red hot chili peppers': 19 });
      await services.kv.put('insights:card:bordesak', JSON.stringify({
        signature, considered: ['red hot chili peppers'], eligible: 'red hot chili peppers=19', card,
      }));
      const calls = mb.calls();
      expect((await json(await buildApp(services)(URL_TRIVIA))).data?.text).toContain('a band rian has played 19 times.');
      expect(mb.calls()).toBe(calls);
    });

    it('an unexpected error returns 500 and logs a known error class only, never a made-up name', async () => {
      const spies = consoleSpies();
      const services = createServices(OWNER, OWNER);
      await seedFacts(services.kv, await wfWith([EARTHLING]));
      await seedOverall(services.kv, { 'red hot chili peppers': 19 });
      const error = new Error('Hollow Meridian by Quillon Varga');
      error.name = 'QuillonVarga';
      vi.mocked(insights.cardSignature).mockRejectedValueOnce(error);

      const res = await buildApp(services)(URL_TRIVIA);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'Failed to load the card' });
      const logged = loggedLines(spies);
      expect(logged).toContain('[Insights] card-route:error kind=other');
      for (const line of logged) {
        for (const text of ['QuillonVarga', 'Hollow Meridian', 'Quillon Varga']) expect(line).not.toContain(text);
      }
    });

    it('logs no album, artist, person, band, card text or source URL', async () => {
      const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
        vi.spyOn(console, level).mockImplementation(() => {}));
      const SENTINELS = {
        artist: 'Quillon Varga', album: 'Hollow Meridian', person: 'Zebulon Quartz', band: 'Marrowfield Lanterns',
        artist2: 'Ottoline Brack', album2: 'Saltmarsh Cathedral',
      };
      mb.album(SENTINELS.artist2, SENTINELS.album2, { guests: [mbGuest('p1', ['Unplayed Kestrel Union'], 'Wystan Pellucid')] });
      mb.album(SENTINELS.artist, SENTINELS.album, { guests: [mbGuest('p2', [SENTINELS.band], SENTINELS.person)] });

      // A tie-back on the second candidate.
      const tieback = createServices(OWNER, OWNER);
      await seedFacts(tieback.kv, await wfWith([
        { artist: SENTINELS.artist2, album: SENTINELS.album2, plays: 20 },
        { artist: SENTINELS.artist, album: SENTINELS.album, plays: 10 },
      ]));
      await seedOverall(tieback.kv, { [SENTINELS.band.toLowerCase()]: 25 });
      const first = await json(await buildApp(tieback)(URL_TRIVIA));
      expect(first.data?.kind).toBe('tieback');

      // A making-of card for the standout.
      const makingOf = createServices(OWNER, OWNER);
      makingOf.ai.getAlbumTrivia.mockResolvedValue(FACT);
      await seedFacts(makingOf.kv, await wfWith([{ artist: SENTINELS.artist2, album: SENTINELS.album2, plays: 20 }]));
      await seedOverall(makingOf.kv, {});
      const second = await json(await buildApp(makingOf)(URL_TRIVIA));
      expect(second.data?.kind).toBe('making_of');

      const logged = spies.flatMap((spy) => spy.mock.calls.map((args) => args.map((a) =>
        typeof a === 'string' ? a : a instanceof Error ? `${a.message} ${a.stack}` : JSON.stringify(a)).join(' ')));
      expect(logged).toContain('[Insights] card: tieback mb_calls=10');
      expect(logged).toContain('[Insights] card: making_of mb_calls=5');

      const forbidden = [
        ...Object.values(SENTINELS), 'Wystan Pellucid', 'Unplayed Kestrel Union', 'Inferno', 'Boards of Canada',
        first.data?.text as string, FACT.text as string, FACT.sourceUrl as string, ART, 'bordesak',
      ].flatMap((s) => [s, s.toLowerCase(), encodeURIComponent(s.toLowerCase())]);
      for (const line of logged) {
        for (const text of forbidden) expect(line).not.toContain(text);
      }
    });
  });
});

describe('renderCard', () => {
  it('shows a making-of card\'s album without its edition suffix', () => {
    const card = {
      kind: 'making_of' as const,
      album: 'Capri (Remastered 2026)',
      artist: 'Celer',
      imageUrl: null,
      text: 'Capri was first released in 2009.',
      sourceUrl: 'https://a.example/capri',
    };
    expect(renderCard(card, { person: 'second' })).toEqual({
      kind: 'making_of',
      album: 'Capri',
      artist: 'Celer',
      text: 'Capri was first released in 2009.',
      sourceUrl: 'https://a.example/capri',
    });
  });
});
