// ABOUTME: Tests for /api/internal/artist-sentence error handling.
// ABOUTME: An OpenAI region block should omit the sentence (200, null data), not return 500.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { RegionUnsupportedError } from '@listentomore/ai';
import type { AIService } from '@listentomore/ai';
import { artistInternalRoutes } from '../../api/internal/artist';
import type { AppContext } from '../../types';

function buildApp(getArtistSentence: ReturnType<typeof vi.fn>) {
  const app = new Hono<AppContext>();
  app.use('*', async (c, next) => {
    c.set('ai', { getArtistSentence } as unknown as AIService);
    await next();
  });
  app.route('/', artistInternalRoutes);
  return app;
}

describe('GET /artist-sentence', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('returns 200 with null data when OpenAI rejects the region', async () => {
    const app = buildApp(vi.fn().mockRejectedValue(new RegionUnsupportedError('openai')));

    const res = await app.request('/artist-sentence?name=Radiohead');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: null });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('still returns 500 for other failures', async () => {
    const app = buildApp(vi.fn().mockRejectedValue(new Error('OpenAI Responses API error: Internal Server Error')));

    const res = await app.request('/artist-sentence?name=Radiohead');

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to generate artist sentence' });
  });

  it('returns the sentence on success', async () => {
    const app = buildApp(vi.fn().mockResolvedValue({ sentence: 'An English rock band.' }));

    const res = await app.request('/artist-sentence?name=Radiohead');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { sentence: 'An English rock band.' } });
  });
});
