// AIService integration tests

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIClient, AICache, generateArtistSummary } from '@listentomore/ai';
import { createMockKV, setupFetchMock } from '../utils/mocks';

describe('OpenAIClient', () => {
  let client: OpenAIClient;

  beforeEach(() => {
    client = new OpenAIClient('test-api-key');
  });

  describe('Responses API with web search', () => {
    it('extracts citations from url_citation annotations', async () => {
      // Mock OpenAI Responses API format with web search results
      const response = {
        model: 'gpt-5-mini',
        output_text: 'Radiohead [1] is an English rock band formed in 1985 [2].',
        output: [
          { type: 'web_search_call', id: 'ws_123', status: 'completed' },
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: 'Radiohead [1] is an English rock band formed in 1985 [2].',
                annotations: [
                  {
                    type: 'url_citation',
                    url: 'https://en.wikipedia.org/wiki/Radiohead',
                    title: 'Radiohead - Wikipedia',
                  },
                  {
                    type: 'url_citation',
                    url: 'https://www.allmusic.com/artist/radiohead',
                    title: 'Radiohead | Biography & History',
                  },
                ],
              },
            ],
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
      };
      setupFetchMock([{ pattern: /api\.openai\.com/, response }]);

      const result = await client.chatCompletion({
        model: 'gpt-5-mini',
        messages: [{ role: 'user', content: 'Tell me about Radiohead' }],
        webSearch: true,
        reasoning: 'low',
      });

      // Content should preserve the [N] markers
      expect(result.content).toBe('Radiohead [1] is an English rock band formed in 1985 [2].');
      // Citations should be extracted and deduplicated
      expect(result.citations).toEqual([
        'https://en.wikipedia.org/wiki/Radiohead',
        'https://www.allmusic.com/artist/radiohead',
      ]);
      // Metadata should indicate web search was used
      expect(result.metadata?.features?.webSearchUsed).toBe(true);
      expect(result.metadata?.api).toBe('responses');
    });

    it('deduplicates repeated citation URLs', async () => {
      const response = {
        model: 'gpt-5-mini',
        output_text: 'The band [1] released OK Computer [1] in 1997.',
        output: [
          { type: 'web_search_call', id: 'ws_123', status: 'completed' },
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: 'The band [1] released OK Computer [1] in 1997.',
                annotations: [
                  {
                    type: 'url_citation',
                    url: 'https://en.wikipedia.org/wiki/Radiohead',
                    title: 'Radiohead',
                  },
                  {
                    type: 'url_citation',
                    url: 'https://en.wikipedia.org/wiki/Radiohead', // Same URL
                    title: 'Radiohead',
                  },
                ],
              },
            ],
          },
        ],
      };
      setupFetchMock([{ pattern: /api\.openai\.com/, response }]);

      const result = await client.chatCompletion({
        model: 'gpt-5-mini',
        messages: [{ role: 'user', content: 'test' }],
        webSearch: true,
        reasoning: 'low',
      });

      // Should deduplicate to single URL
      expect(result.citations).toEqual(['https://en.wikipedia.org/wiki/Radiohead']);
    });

    it('handles response with no web search (empty citations)', async () => {
      const response = {
        model: 'gpt-5-mini',
        output_text: 'This is a response without citations.',
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: 'This is a response without citations.',
                annotations: [],
              },
            ],
          },
        ],
      };
      setupFetchMock([{ pattern: /api\.openai\.com/, response }]);

      const result = await client.chatCompletion({
        model: 'gpt-5-mini',
        messages: [{ role: 'user', content: 'test' }],
      });

      expect(result.content).toBe('This is a response without citations.');
      expect(result.citations).toEqual([]);
      expect(result.metadata?.features?.webSearchUsed).toBe(false);
    });

    it('sends web_search tool when webSearch option is true', async () => {
      const response = {
        model: 'gpt-5-mini',
        output_text: 'Response',
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'Response' }] }],
      };
      const mockFetch = setupFetchMock([{ pattern: /api\.openai\.com/, response }]);

      await client.chatCompletion({
        model: 'gpt-5-mini',
        messages: [{ role: 'user', content: 'test' }],
        webSearch: true,
        reasoning: 'low',
      });

      // Verify the request included web_search tool
      expect(mockFetch).toHaveBeenCalled();
      const callArgs = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
      const requestBody = JSON.parse(callArgs[1]?.body as string);
      expect(requestBody.tools).toEqual([{ type: 'web_search' }]);
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
  let mockClient: OpenAIClient;
  let cache: AICache;

  beforeEach(() => {
    mockKV = createMockKV();
    cache = new AICache(mockKV);
    mockClient = new OpenAIClient('test-key');
  });

  it('generates artist summary and caches result', async () => {
    const response = {
      model: 'gpt-5-search-api',
      choices: [
        {
          message: {
            content: 'Radiohead is an English rock band. Their album {{OK Computer}} is considered a masterpiece. Similar artists include [[Portishead]].',
            annotations: [
              {
                type: 'url_citation',
                url_citation: {
                  url: 'https://en.wikipedia.org/wiki/Radiohead',
                  title: 'Radiohead - Wikipedia',
                },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    };
    setupFetchMock([{ pattern: /api\.openai\.com/, response }]);

    const result = await generateArtistSummary('Radiohead', mockClient, cache);

    expect(result.summary).toContain('Radiohead is an English rock band');
    expect(result.summary).toContain('data-album="OK Computer"');
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
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
