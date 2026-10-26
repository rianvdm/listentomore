// ABOUTME: Reads the request's waitUntil from a Hono context, for work that must outlive the response.
// ABOUTME: Returns undefined where no ExecutionContext exists (app.request() in tests).

import type { Context } from 'hono';
import type { WaitUntil } from '@listentomore/shared';

/**
 * The request's waitUntil, bound to its ExecutionContext.
 * Hono's executionCtx getter throws outside a fetch event, so callers get
 * undefined there and should fall back to unawaited, logged promises
 * (createServiceDefer from @listentomore/shared does this).
 */
export function getWaitUntil(c: Context): WaitUntil | undefined {
  try {
    const ctx = c.executionCtx;
    return ctx.waitUntil.bind(ctx);
  } catch {
    return undefined;
  }
}
