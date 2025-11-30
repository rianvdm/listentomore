// AIService integration tests

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PerplexityClient, AICache, generateArtistSummary } from '@listentomore/ai';
import { createMockKV, setupFetchMock } from '../utils/mocks';

describe('PerplexityClient', () => {
  let client: PerplexityClient;

  beforeEach(() => {
    client = new PerplexityClient('test-api-key');
  });

  describe('chatCompletion', () => {
    it('sends chat completion request and returns response', async () => {
      const response = {
        choices: [{ message: { content: 'This is a response about Radiohead.' } }],
        citations: ['https://en.wikipedia.org/wiki/Radiohead'],
      };
      setupFetchMock([{ pattern: /api\.perplexity\.ai/, response }]);

      const result = await client.chatCompletion({
        model: 'sonar',
        messages: [{ role: 'user', content: 'Tell me about Radiohead' }],
      });

      expect(result.content).toBe('This is a response about Radiohead.');
      expect(result.citations).toEqual(['https://en.wikipedia.org/wiki/Radiohead']);
    });

    it('cleans citation markers from response', async () => {
      const response = {
        choices: [{ message: { content: 'Radiohead [1] formed in 1985 [2] in Oxford.' } }],
        citations: ['https://example.com'],
      };
      setupFetchMock([{ pattern: /api\.perplexity\.ai/, response }]);

      const result = await client.chatCompletion({
        model: 'sonar',
        messages: [{ role: 'user', content: 'test' }],
      });

      // The regex removes [n] and following whitespace, keeping remaining text intact
      expect(result.content).toBe('Radiohead formed in 1985 in Oxford.');
    });

    it('throws error on API failure', async () => {
      setupFetchMock([
        {
          pattern: /api\.perplexity\.ai/,
          response: { error: 'Unauthorized' },
          options: { status: 401, ok: false },
        },
      ]);

      await expect(
        client.chatCompletion({
          model: 'sonar',
          messages: [{ role: 'user', content: 'test' }],
        })
      ).rejects.toThrow('Perplexity API error 401');
    });

    it('handles empty citations', async () => {
      const response = {
        choices: [{ message: { content: 'Response without citations' } }],
      };
      setupFetchMock([{ pattern: /api\.perplexity\.ai/, response }]);

      const result = await client.chatCompletion({
        model: 'sonar',
        messages: [{ role: 'user', content: 'test' }],
      });

      expect(result.citations).toEqual([]);
    });
  });
});

describe('AICache', () => {
  let mockKV: KVNamespace;
  let cache: AICache;

  beforeEach(() => {
    mockKV = createMockKV();
    cache = new AICache(mockKV);
  });

  describe('get', () => {
    it('returns cached value when available', async () => {
      const cachedData = { summary: 'Cached summary', citations: [] };
      (mockKV.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(cachedData);

      const result = await cache.get('artistSummary', 'radiohead');

      expect(result).toEqual(cachedData);
      expect(mockKV.get).toHaveBeenCalledWith('ai:artistSummary:radiohead', 'json');
    });

    it('returns null when not cached', async () => {
      const result = await cache.get('artistSummary', 'unknown-artist');

      expect(result).toBeNull();
    });

    it('normalizes params to lowercase', async () => {
      await cache.get('artistSummary', 'RADIOHEAD');

      expect(mockKV.get).toHaveBeenCalledWith('ai:artistSummary:radiohead', 'json');
    });
  });

  describe('set', () => {
    it('stores value in cache with TTL', async () => {
      const data = { summary: 'Test summary', citations: [] };

      await cache.set('artistSummary', ['radiohead'], data);

      expect(mockKV.put).toHaveBeenCalledWith(
        'ai:artistSummary:radiohead',
        JSON.stringify(data),
        expect.objectContaining({ expirationTtl: expect.any(Number) })
      );
    });

    it('supports multiple params in key', async () => {
      const data = { content: 'Album content' };

      await cache.set('albumDetail', ['radiohead', 'in rainbows'], data);

      expect(mockKV.put).toHaveBeenCalledWith(
        'ai:albumDetail:radiohead:in rainbows',
        expect.any(String),
        expect.any(Object)
      );
    });
  });

  describe('delete', () => {
    it('removes entry from cache', async () => {
      await cache.delete('artistSummary', 'radiohead');

      expect(mockKV.delete).toHaveBeenCalledWith('ai:artistSummary:radiohead');
    });
  });
});

describe('generateArtistSummary', () => {
  let mockKV: KVNamespace;
  let mockClient: PerplexityClient;
  let cache: AICache;

  beforeEach(() => {
    mockKV = createMockKV();
    cache = new AICache(mockKV);
    mockClient = new PerplexityClient('test-key');
  });

  it('generates artist summary and caches result', async () => {
    const response = {
      choices: [
        {
          message: {
            content:
              'Radiohead is an English rock band. Their album {{OK Computer}} is considered a masterpiece. Similar artists include [[Portishead]].',
          },
        },
      ],
      citations: ['https://en.wikipedia.org/wiki/Radiohead'],
    };
    setupFetchMock([{ pattern: /api\.perplexity\.ai/, response }]);

    const result = await generateArtistSummary('Radiohead', mockClient, cache);

    expect(result.summary).toContain('Radiohead is an English rock band');
    expect(result.summary).toContain('[OK Computer](/album?q=OK%20Computer%20Radiohead)');
    expect(result.summary).toContain('[Portishead](/artist?q=Portishead)');
    expect(result.citations).toContain('https://en.wikipedia.org/wiki/Radiohead');

    expect(mockKV.put).toHaveBeenCalledWith(
      'ai:artistSummary:radiohead',
      expect.any(String),
      expect.any(Object)
    );
  });

  it('returns cached result without API call', async () => {
    const cachedResult = {
      summary: 'Cached artist summary',
      citations: ['https://cached.com'],
    };
    (mockKV.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(cachedResult);

    const result = await generateArtistSummary('Radiohead', mockClient, cache);

    expect(result).toEqual(cachedResult);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
