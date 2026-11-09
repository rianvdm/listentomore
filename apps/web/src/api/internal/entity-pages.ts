// ABOUTME: Records which Spotify-ID page an album or artist summary cache key belongs to.
// ABOUTME: The D1 upsert runs off the response path and only logs on failure, so it never fails a summary request.

import type { Context } from 'hono';
import type { EntityPageType } from '@listentomore/db';
import { createServiceDefer } from '@listentomore/shared';
import type { InternalAppContext } from '../../types';
import { getWaitUntil } from '../../utils/wait-until';

/**
 * Upserts the entity_pages row for a summary that was just served, so the
 * sitemap can map the name-based cache key back to its page URL.
 */
export function recordEntityPage(
  c: Context<InternalAppContext>,
  page: { cacheKey: string; type: EntityPageType; path: string }
): void {
  // The async wrapper turns a synchronous throw into a rejection, which the defer logs.
  const upsert = async (): Promise<void> => c.get('db').upsertEntityPage(page);
  createServiceDefer('[Entity pages]', getWaitUntil(c))(upsert(), `${page.type} page upsert`);
}
