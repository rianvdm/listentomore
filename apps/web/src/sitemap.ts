// ABOUTME: Builds /sitemap.xml from the static pages plus every album, artist and genre page whose AI summary
// ABOUTME: is cached in KV. The KV listing decides what is live; entity_pages maps album and artist keys to URLs.

import type { Context } from 'hono';
import { getCacheTtlSeconds, SITE_CONFIG } from '@listentomore/config';
import type { AITask } from '@listentomore/config';
import type { EntityPage } from '@listentomore/db';
import { isCuratedGenre } from './data/genres';
import type { AppContext } from './types';
import { publicSummariesEnabled } from './utils/public-summaries';

/** Pages listed in every sitemap, in this order and without lastmod. */
export const STATIC_PAGES = ['/', '/about', '/tools', '/genre', '/discord', '/privacy', '/terms'] as const;

// Summary tasks whose cached entries are shown publicly on a page of their own.
const ENTITY_TASKS = ['albumDetail', 'artistSummary'] as const satisfies readonly AITask[];
const GENRE_TASK = 'genreSummary' satisfies AITask;
const SITEMAP_TASKS: readonly AITask[] = [...ENTITY_TASKS, GENRE_TASK];

export interface CachedKey {
  name: string;
  /** Unix seconds, as KV list() reports it. */
  expiration?: number;
}

export interface SitemapInput {
  origin: string;
  cachedKeys: CachedKey[];
  entityPages: EntityPage[];
}

interface SitemapEntry {
  path: string;
  lastmod?: string;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function taskPrefix(task: AITask): string {
  return `ai:${task}:`;
}

// KV stores only the expiry, so the write date is the expiry minus the task's TTL.
function lastmodFor(task: AITask, expiration: number | undefined): string | undefined {
  if (expiration === undefined) return undefined;
  const writtenAt = expiration - getCacheTtlSeconds(task);
  return new Date(writtenAt * 1000).toISOString().slice(0, 10);
}

// The page a cached key belongs to, or null when it should stay out of the sitemap.
function pathFor(task: AITask, name: string, pagesByKey: Map<string, string>): string | null {
  if (task === GENRE_TASK) {
    const slug = name.slice(taskPrefix(task).length).replace(/ /g, '-');
    return isCuratedGenre(slug) ? `/genre/${slug}` : null;
  }
  return pagesByKey.get(name) ?? null;
}

function renderEntry({ path, lastmod }: SitemapEntry, origin: string): string {
  const loc = `<loc>${escapeXml(origin + path)}</loc>`;
  return lastmod ? `  <url>${loc}<lastmod>${lastmod}</lastmod></url>` : `  <url>${loc}</url>`;
}

/**
 * Renders the sitemap XML. Album and artist keys appear only when an entity_pages row maps them
 * to a page; genre keys only for curated genres. Static pages come first, then the cached pages
 * sorted by path, one entry per path with the most recent lastmod.
 */
export function buildSitemap({ origin, cachedKeys, entityPages }: SitemapInput): string {
  const pagesByKey = new Map(entityPages.map((page) => [page.cache_key, page.path]));
  const dynamic = new Map<string, SitemapEntry>();

  for (const { name, expiration } of cachedKeys) {
    const task = SITEMAP_TASKS.find((t) => name.startsWith(taskPrefix(t)));
    if (!task) continue;
    const path = pathFor(task, name, pagesByKey);
    if (!path) continue;

    const lastmod = lastmodFor(task, expiration);
    const existing = dynamic.get(path);
    // ISO dates compare correctly as strings.
    if (!existing || (lastmod && (!existing.lastmod || lastmod > existing.lastmod))) {
      dynamic.set(path, { path, lastmod });
    }
  }

  const sortedDynamic = [...dynamic.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const entries: SitemapEntry[] = [...STATIC_PAGES.map((path) => ({ path })), ...sortedDynamic];

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map((entry) => renderEntry(entry, origin)),
    '</urlset>',
    '',
  ].join('\n');
}

// Lists every key under a prefix, following the cursor until KV reports the listing complete.
async function listAllKeys(kv: KVNamespace, prefix: string): Promise<CachedKey[]> {
  const keys: CachedKey[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await kv.list({ prefix, cursor });
    keys.push(...page.keys.map(({ name, expiration }) => ({ name, expiration })));
    if (page.list_complete) return keys;
    cursor = page.cursor;
  }
}

/**
 * GET /sitemap.xml. With public summaries off, or when a KV or D1 read fails, it lists the
 * static pages only, so a storage outage never turns the sitemap into an error.
 */
export async function handleSitemap(c: Context<AppContext>): Promise<Response> {
  let cachedKeys: CachedKey[] = [];
  let entityPages: EntityPage[] = [];

  if (publicSummariesEnabled(c.env)) {
    try {
      const [keyLists, pages] = await Promise.all([
        Promise.all(SITEMAP_TASKS.map((task) => listAllKeys(c.env.CACHE, taskPrefix(task)))),
        // The async wrapper turns a synchronous throw into a rejection, so Promise.all still settles the KV reads.
        (async () => c.get('db').getEntityPages())(),
      ]);
      cachedKeys = keyLists.flat();
      entityPages = pages;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Sitemap read failed, listing static pages only:', errorMessage, error);
    }
  }

  return c.body(buildSitemap({ origin: SITE_CONFIG.url, cachedKeys, entityPages }), 200, {
    'Content-Type': 'application/xml',
    'Cache-Control': 'public, max-age=3600',
  });
}
