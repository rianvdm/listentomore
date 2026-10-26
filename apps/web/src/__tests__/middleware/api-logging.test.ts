// ABOUTME: Tests for apiLoggingMiddleware, the deferred api_usage_log INSERT on /api/* routes.
// ABOUTME: Internal progressive-loading routes are skipped; everything else is logged through waitUntil.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Database } from '@listentomore/db';
import { apiLoggingMiddleware } from '../../middleware/auth';
import type { AppContext } from '../../types';

function buildApp(logApiUsage: ReturnType<typeof vi.fn>) {
  const app = new Hono<AppContext>();
  app.use('*', async (c, next) => {
    c.set('db', { logApiUsage } as unknown as Database);
    c.set('apiKey', null);
    await next();
  });
  app.use('/api/*', apiLoggingMiddleware());
  app.get('/api/v1/ping', (c) => c.json({ ok: true }));
  app.get('/api/internal/ping', (c) => c.json({ ok: true }));
  return app;
}

function createExecutionCtx() {
  return { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {} } as unknown as ExecutionContext;
}

describe('apiLoggingMiddleware', () => {
  let logApiUsage: ReturnType<typeof vi.fn>;
  let app: Hono<AppContext>;

  beforeEach(() => {
    logApiUsage = vi.fn().mockResolvedValue(undefined);
    app = buildApp(logApiUsage);
  });

  it('hands the INSERT for a public API route to waitUntil', async () => {
    const ctx = createExecutionCtx();

    const res = await app.fetch(new Request('https://listentomore.com/api/v1/ping'), {}, ctx);

    expect(res.status).toBe(200);
    expect(logApiUsage).toHaveBeenCalledTimes(1);
    expect(logApiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: '/api/v1/ping', method: 'GET', statusCode: 200 })
    );
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ctx.waitUntil).mock.calls[0][0]).toBeInstanceOf(Promise);
  });

  it('does not log internal progressive-loading routes', async () => {
    const ctx = createExecutionCtx();

    const res = await app.fetch(new Request('https://listentomore.com/api/internal/ping'), {}, ctx);

    expect(res.status).toBe(200);
    expect(logApiUsage).not.toHaveBeenCalled();
    expect(ctx.waitUntil).not.toHaveBeenCalled();
  });

  it('does not fail the request when the INSERT rejects', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logApiUsage.mockRejectedValue(new Error('D1_ERROR: database is locked'));
    const ctx = createExecutionCtx();

    const res = await app.fetch(new Request('https://listentomore.com/api/v1/ping'), {}, ctx);
    await Promise.all(vi.mocked(ctx.waitUntil).mock.calls.map(([promise]) => promise));

    expect(res.status).toBe(200);
    expect(errorSpy).toHaveBeenCalledWith(
      '[API] Deferred API usage log failed:',
      'D1_ERROR: database is locked',
      expect.any(Error)
    );
  });
});
