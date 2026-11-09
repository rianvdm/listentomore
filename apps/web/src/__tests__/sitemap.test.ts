// ABOUTME: Tests for /sitemap.xml: which cached summaries become URLs, their lastmod dates, and XML escaping.
// ABOUTME: Also covers the route's KV pagination, feature flag, and fallback to static pages when a read fails.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { Database, EntityPage } from '@listentomore/db';
import { buildSitemap, handleSitemap, STATIC_PAGES } from '../sitemap';
import type { AppContext } from '../types';

const ORIGIN = 'https://listentomore.com';
const ALBUM_KEY = 'ai:albumDetail:radiohead:ok computer';
const ARTIST_KEY = 'ai:artistSummary:radiohead';

function entityPage(cacheKey: string, type: EntityPage['type'], path: string): EntityPage {
  return { cache_key: cacheKey, type, path, updated_at: '2026-11-01 00:00:00' };
}

function locs(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
}

const STATIC_LOCS = STATIC_PAGES.map((path) => `${ORIGIN}${path}`);

describe('buildSitemap', () => {
  it('lists a cached album only when its page is known', () => {
    const xml = buildSitemap({
      origin: ORIGIN,
      cachedKeys: [{ name: ALBUM_KEY }, { name: 'ai:albumDetail:unknown:album' }],
      entityPages: [
        entityPage(ALBUM_KEY, 'album', '/album/6dVIqQ8qmQ5GBnJ9shOYGE'),
        // A row whose key is no longer in KV must not appear.
        entityPage('ai:albumDetail:expired:album', 'album', '/album/expired123'),
      ],
    });

    const dynamic = locs(xml).slice(STATIC_PAGES.length);
    expect(dynamic).toEqual([`${ORIGIN}/album/6dVIqQ8qmQ5GBnJ9shOYGE`]);
  });

  it('lists a cached artist only when its page is known', () => {
    const xml = buildSitemap({
      origin: ORIGIN,
      cachedKeys: [{ name: ARTIST_KEY }, { name: 'ai:artistSummary:nobody' }],
      entityPages: [entityPage(ARTIST_KEY, 'artist', '/artist/4Z8W4fKeB5YxbusRsdQVPb')],
    });

    expect(locs(xml).slice(STATIC_PAGES.length)).toEqual([`${ORIGIN}/artist/4Z8W4fKeB5YxbusRsdQVPb`]);
  });

  it('lists curated genres and skips others', () => {
    const xml = buildSitemap({
      origin: ORIGIN,
      cachedKeys: [
        { name: 'ai:genreSummary:shoegaze' },
        { name: 'ai:genreSummary:yvl' },
        { name: 'ai:genreSummary:drum and bass' },
      ],
      entityPages: [],
    });

    expect(locs(xml).slice(STATIC_PAGES.length)).toEqual([
      `${ORIGIN}/genre/drum-and-bass`,
      `${ORIGIN}/genre/shoegaze`,
    ]);
  });

  it('sets lastmod to the write date', () => {
    const xml = buildSitemap({
      origin: ORIGIN,
      cachedKeys: [{ name: ALBUM_KEY, expiration: Date.UTC(2027, 2, 1) / 1000 }],
      entityPages: [entityPage(ALBUM_KEY, 'album', '/album/abc')],
    });

    expect(xml).toContain(`<loc>${ORIGIN}/album/abc</loc><lastmod>2026-11-01</lastmod>`);
  });

  it('uses each task TTL for lastmod', () => {
    // genreSummary caches for 180 days: 2027-03-01 minus 180 days is 2026-09-02.
    const xml = buildSitemap({
      origin: ORIGIN,
      cachedKeys: [{ name: 'ai:genreSummary:shoegaze', expiration: Date.UTC(2027, 2, 1) / 1000 }],
      entityPages: [],
    });

    expect(xml).toContain(`<loc>${ORIGIN}/genre/shoegaze</loc><lastmod>2026-09-02</lastmod>`);
  });

  it('omits lastmod when the key has no expiration', () => {
    const xml = buildSitemap({
      origin: ORIGIN,
      cachedKeys: [{ name: ALBUM_KEY }],
      entityPages: [entityPage(ALBUM_KEY, 'album', '/album/abc')],
    });

    expect(xml).toContain(`<url><loc>${ORIGIN}/album/abc</loc></url>`);
  });

  it('always lists the static pages', () => {
    const xml = buildSitemap({ origin: ORIGIN, cachedKeys: [], entityPages: [] });

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(locs(xml)).toEqual(STATIC_LOCS);
    expect(STATIC_PAGES).toEqual(['/', '/about', '/tools', '/genre', '/discord', '/privacy', '/terms']);
    expect(xml).not.toContain('<lastmod>');
  });

  it('escapes XML', () => {
    const key = 'ai:albumDetail:a&b:c';
    const xml = buildSitemap({
      origin: ORIGIN,
      cachedKeys: [{ name: key }],
      entityPages: [entityPage(key, 'album', `/album/x?a=1&b=<2>"'`)],
    });

    expect(xml).toContain(`<loc>${ORIGIN}/album/x?a=1&amp;b=&lt;2&gt;&quot;&apos;</loc>`);
    expect(xml).not.toContain('&b=<2>');
  });

  it('removes duplicates and sorts dynamic entries by path', () => {
    const otherKey = 'ai:albumDetail:radiohead:ok computer (remastered)';
    const xml = buildSitemap({
      origin: ORIGIN,
      cachedKeys: [
        { name: 'ai:genreSummary:shoegaze' },
        { name: 'ai:genreSummary:shoegaze' },
        { name: ARTIST_KEY },
        { name: ALBUM_KEY, expiration: Date.UTC(2027, 2, 1) / 1000 },
        { name: otherKey, expiration: Date.UTC(2027, 2, 11) / 1000 },
      ],
      entityPages: [
        entityPage(ARTIST_KEY, 'artist', '/artist/zzz'),
        entityPage(ALBUM_KEY, 'album', '/album/same'),
        entityPage(otherKey, 'album', '/album/same'),
      ],
    });

    expect(locs(xml)).toEqual([
      ...STATIC_LOCS,
      `${ORIGIN}/album/same`,
      `${ORIGIN}/artist/zzz`,
      `${ORIGIN}/genre/shoegaze`,
    ]);
    // Two keys for one page keep the most recent write date.
    expect(xml).toContain(`<loc>${ORIGIN}/album/same</loc><lastmod>2026-11-11</lastmod>`);
  });

  it('ignores keys for other tasks', () => {
    const key = 'ai:albumRecommendations:radiohead:ok computer';
    const xml = buildSitemap({
      origin: ORIGIN,
      cachedKeys: [{ name: key }],
      entityPages: [entityPage(key, 'album', '/album/abc')],
    });

    expect(locs(xml)).toEqual(STATIC_LOCS);
  });
});

type KvKey = { name: string; expiration?: number };

// Fake KV list that serves each prefix's keys two per page, so the route must follow the cursor.
function createKv(keys: KvKey[]) {
  const list = vi.fn(async ({ prefix, cursor }: { prefix: string; cursor?: string }) => {
    const matching = keys.filter((k) => k.name.startsWith(prefix));
    const start = cursor ? Number(cursor) : 0;
    const page = matching.slice(start, start + 2);
    const end = start + page.length;
    return end < matching.length
      ? { keys: page, list_complete: false, cursor: String(end) }
      : { keys: page, list_complete: true, cacheStatus: null };
  });
  return { list };
}

function buildApp(db: { getEntityPages: ReturnType<typeof vi.fn> }) {
  const app = new Hono<AppContext>();
  app.use('*', async (c, next) => {
    c.set('db', db as unknown as Database);
    await next();
  });
  app.get('/sitemap.xml', handleSitemap);
  return app;
}

describe('GET /sitemap.xml', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists every cached page across KV pages, with XML and cache headers', async () => {
    const albumKeys = ['a', 'b', 'c'].map((n) => ({ name: `ai:albumDetail:artist:${n}` }));
    const kv = createKv([...albumKeys, { name: ARTIST_KEY }, { name: 'ai:genreSummary:shoegaze' }]);
    const db = {
      getEntityPages: vi.fn().mockResolvedValue([
        ...albumKeys.map((k, i) => entityPage(k.name, 'album', `/album/id${i}`)),
        entityPage(ARTIST_KEY, 'artist', '/artist/rh'),
      ]),
    };

    const res = await buildApp(db).request('/sitemap.xml', {}, { CACHE: kv, PUBLIC_CACHED_SUMMARIES: 'true' });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/xml');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600');
    expect(locs(await res.text())).toEqual([
      ...STATIC_LOCS,
      `${ORIGIN}/album/id0`,
      `${ORIGIN}/album/id1`,
      `${ORIGIN}/album/id2`,
      `${ORIGIN}/artist/rh`,
      `${ORIGIN}/genre/shoegaze`,
    ]);
    const prefixes = kv.list.mock.calls.map(([options]) => options.prefix);
    expect(new Set(prefixes)).toEqual(new Set(['ai:albumDetail:', 'ai:artistSummary:', 'ai:genreSummary:']));
    expect(kv.list).toHaveBeenCalledWith({ prefix: 'ai:albumDetail:', cursor: '2' });
    expect(db.getEntityPages).toHaveBeenCalledTimes(1);
  });

  it('lists only static pages when the flag is off', async () => {
    const kv = createKv([{ name: 'ai:genreSummary:shoegaze' }]);
    const db = { getEntityPages: vi.fn().mockResolvedValue([]) };

    const res = await buildApp(db).request('/sitemap.xml', {}, { CACHE: kv });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/xml');
    expect(locs(await res.text())).toEqual(STATIC_LOCS);
    expect(kv.list).not.toHaveBeenCalled();
    expect(db.getEntityPages).not.toHaveBeenCalled();
  });

  it('falls back to static pages when the KV listing fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const kv = { list: vi.fn().mockRejectedValue(new Error('KV down')) };
    const db = { getEntityPages: vi.fn().mockResolvedValue([]) };

    const res = await buildApp(db).request('/sitemap.xml', {}, { CACHE: kv, PUBLIC_CACHED_SUMMARIES: 'true' });

    expect(res.status).toBe(200);
    expect(locs(await res.text())).toEqual(STATIC_LOCS);
    expect(consoleError).toHaveBeenCalled();
  });

  it('does not let caches keep the static-only fallback', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const kv = { list: vi.fn().mockRejectedValue(new Error('KV down')) };
    const db = { getEntityPages: vi.fn().mockResolvedValue([]) };

    const res = await buildApp(db).request('/sitemap.xml', {}, { CACHE: kv, PUBLIC_CACHED_SUMMARIES: 'true' });

    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('stops listing a prefix when KV returns no cursor, even if list_complete is false', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Without a cursor the next call would restart the listing; give up after a few calls so a regression fails fast.
    const list = vi.fn(async ({ prefix }: { prefix: string }) => {
      if (list.mock.calls.length > 10) throw new Error('listing never ended');
      return { keys: prefix === 'ai:genreSummary:' ? [{ name: 'ai:genreSummary:shoegaze' }] : [], list_complete: false, cursor: '' };
    });
    const db = { getEntityPages: vi.fn().mockResolvedValue([]) };

    const res = await buildApp(db).request('/sitemap.xml', {}, { CACHE: { list }, PUBLIC_CACHED_SUMMARIES: 'true' });

    expect(locs(await res.text())).toEqual([...STATIC_LOCS, `${ORIGIN}/genre/shoegaze`]);
    expect(list).toHaveBeenCalledTimes(3);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('falls back to static pages when the entity page read fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const kv = createKv([{ name: 'ai:genreSummary:shoegaze' }]);
    const db = {
      getEntityPages: vi.fn().mockImplementation(() => {
        throw new Error('D1 down');
      }),
    };

    const res = await buildApp(db).request('/sitemap.xml', {}, { CACHE: kv, PUBLIC_CACHED_SUMMARIES: 'true' });

    expect(res.status).toBe(200);
    expect(locs(await res.text())).toEqual(STATIC_LOCS);
    expect(consoleError).toHaveBeenCalled();
  });
});
