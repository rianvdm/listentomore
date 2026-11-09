// ABOUTME: Tests for AIService's read-only cached summary lookups and the shared aiCacheKey builder.
// ABOUTME: Covers name normalization, cache misses, KV failures, and that no model call is ever made.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AICache, AIService, aiCacheKey } from '@listentomore/ai';
import { createMockKV } from '../utils/mocks';

function makeService(kv: KVNamespace): AIService {
  return new AIService({ openaiApiKey: 'x', anthropicApiKey: 'x', cache: kv });
}

describe('AIService cached reads', () => {
  let kv: KVNamespace;
  let ai: AIService;

  beforeEach(() => {
    kv = createMockKV();
    ai = makeService(kv);
    globalThis.fetch = vi.fn() as typeof fetch;
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads what the generator wrote, regardless of case and whitespace', async () => {
    await new AICache(kv).set('albumDetail', ['radiohead', 'ok computer'], { content: '### Hi' });

    expect(await ai.getCachedAlbumDetail(' Radiohead', 'OK Computer ')).toBe('### Hi');
  });

  it('returns cached album recommendations', async () => {
    await new AICache(kv).set('albumRecommendations', ['radiohead', 'ok computer'], {
      content: '- Try Kid A',
    });

    expect(await ai.getCachedAlbumRecommendations('Radiohead', 'OK Computer')).toBe('- Try Kid A');
  });

  it('returns the artist summary field', async () => {
    await new AICache(kv).set('artistSummary', ['radiohead'], { summary: 'x' });

    expect(await ai.getCachedArtistSummary('Radiohead')).toBe('x');
  });

  it('returns the genre summary content', async () => {
    await new AICache(kv).set('genreSummary', ['shoegaze'], { content: 'Loud and dreamy.' });

    expect(await ai.getCachedGenreSummary('Shoegaze ')).toBe('Loud and dreamy.');
  });

  it('returns null on a miss and never calls fetch', async () => {
    expect(await ai.getCachedAlbumDetail('radiohead', 'ok computer')).toBeNull();
    expect(await ai.getCachedAlbumRecommendations('radiohead', 'ok computer')).toBeNull();
    expect(await ai.getCachedArtistSummary('radiohead')).toBeNull();
    expect(await ai.getCachedGenreSummary('shoegaze')).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('returns null when KV throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(kv.get).mockRejectedValue(new Error('KV unavailable'));

    expect(await ai.getCachedAlbumDetail('radiohead', 'ok computer')).toBeNull();
    expect(await ai.getCachedAlbumRecommendations('radiohead', 'ok computer')).toBeNull();
    expect(await ai.getCachedArtistSummary('radiohead')).toBeNull();
    expect(await ai.getCachedGenreSummary('shoegaze')).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(4);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('aiCacheKey', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('aiCacheKey matches the stored key', () => {
    expect(aiCacheKey('albumDetail', 'Radiohead ', 'OK Computer')).toBe('ai:albumDetail:radiohead:ok computer');
  });

  it('builds the key AICache writes under', async () => {
    const kv = createMockKV();

    await new AICache(kv).set('artistSummary', [' Radiohead'], { summary: 'x' });

    expect(kv.put).toHaveBeenCalledWith(aiCacheKey('artistSummary', 'radiohead'), expect.any(String), expect.any(Object));
  });
});
