// AIService integration tests

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIClient, AICache, generateArtistSummary, generateArtistSentence } from '@listentomore/ai';
import { createMockKV, setupFetchMock } from '../utils/mocks';

describe('OpenAIClient', () => {
  let client: OpenAIClient;

  beforeEach(() => {
    client = new OpenAIClient('test-api-key');
  });

  describe('Responses API with web search', () => {
    it('extracts content from web search response', async () => {
      // Mock OpenAI Responses API format with web search results
      const response = {
        model: 'gpt-5.4',
        output_text: 'Radiohead is an English rock band formed in 1985.',
        output: [
          { type: 'web_search_call', id: 'ws_123', status: 'completed' },
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: 'Radiohead is an English rock band formed in 1985.',
              },
            ],
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
      };
      setupFetchMock([{ pattern: /api\.openai\.com/, response }]);

      const result = await client.chatCompletion({
        model: 'gpt-5.4',
        messages: [{ role: 'user', content: 'Tell me about Radiohead' }],
        webSearch: true,
        reasoning: 'low',
      });

      expect(result.content).toBe('Radiohead is an English rock band formed in 1985.');
      // Metadata should indicate web search was used
      expect(result.metadata?.features?.webSearchUsed).toBe(true);
      expect(result.metadata?.api).toBe('responses');
    });

    it('handles response with no web search', async () => {
      const response = {
        model: 'gpt-5.4',
        output_text: 'This is a response without web search.',
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: 'This is a response without web search.',
              },
            ],
          },
        ],
      };
      setupFetchMock([{ pattern: /api\.openai\.com/, response }]);

      const result = await client.chatCompletion({
        model: 'gpt-5.4',
        messages: [{ role: 'user', content: 'test' }],
      });

      expect(result.content).toBe('This is a response without web search.');
      expect(result.metadata?.features?.webSearchUsed).toBe(false);
    });

    it('sends web_search tool when webSearch option is true', async () => {
      const response = {
        model: 'gpt-5.4',
        output_text: 'Response',
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'Response' }] }],
      };
      const mockFetch = setupFetchMock([{ pattern: /api\.openai\.com/, response }]);

      await client.chatCompletion({
        model: 'gpt-5.4',
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
      const cachedData = { summary: 'Cached summary' };
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
      const data = { summary: 'Test summary' };

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
      model: 'gpt-5.4',
      output_text: 'Radiohead is an English rock band. Their album {{OK Computer}} is considered a masterpiece. Similar artists include [[Portishead]].',
      output: [
        { type: 'web_search_call', id: 'ws_123', status: 'completed' },
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: 'Radiohead is an English rock band. Their album {{OK Computer}} is considered a masterpiece. Similar artists include [[Portishead]].',
            },
          ],
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
    };
    setupFetchMock([{ pattern: /api\.openai\.com/, response }]);

    const result = await generateArtistSummary('Radiohead', mockClient, cache);

    expect(result.summary).toContain('Radiohead is an English rock band');
    expect(result.summary).toContain('data-album="OK Computer"');
    expect(result.summary).toContain('[Portishead](/artist?q=Portishead)');

    expect(mockKV.put).toHaveBeenCalledWith(
      'ai:artistSummary:radiohead',
      expect.any(String),
      expect.any(Object)
    );
  });

  it('returns cached result without API call', async () => {
    const cachedResult = {
      summary: 'Cached artist summary',
    };
    (mockKV.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(cachedResult);

    const result = await generateArtistSummary('Radiohead', mockClient, cache);

    expect(result).toEqual(cachedResult);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('generateArtistSentence', () => {
  let mockKV: KVNamespace;
  let mockClient: OpenAIClient;
  let cache: AICache;

  beforeEach(() => {
    mockKV = createMockKV();
    cache = new AICache(mockKV);
    mockClient = new OpenAIClient('test-key');
  });

  it('strips citation markers from response', async () => {
    const response = {
      model: 'gpt-5.4',
      output_text: 'They are an English alternative rock band [1] known for experimental sounds [2]. Similar artists include Muse and Portishead.',
      output: [
        { type: 'web_search_call', id: 'ws_123', status: 'completed' },
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: 'They are an English alternative rock band [1] known for experimental sounds [2]. Similar artists include Muse and Portishead.',
            },
          ],
        },
      ],
    };
    setupFetchMock([{ pattern: /api\.openai\.com/, response }]);

    const result = await generateArtistSentence('Radiohead', mockClient, cache);

    // Citation markers should be stripped
    expect(result.sentence).not.toContain('[1]');
    expect(result.sentence).not.toContain('[2]');
    expect(result.sentence).toBe('They are an English alternative rock band known for experimental sounds. Similar artists include Muse and Portishead.');
  });

  it('handles Chinese-style citation brackets', async () => {
    const response = {
      model: 'gpt-5.4',
      output_text: 'They are a rock band 【1】 from Oxford 【2】.',
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: 'They are a rock band 【1】 from Oxford 【2】.',
            },
          ],
        },
      ],
    };
    setupFetchMock([{ pattern: /api\.openai\.com/, response }]);

    const result = await generateArtistSentence('Radiohead', mockClient, cache);

    expect(result.sentence).not.toContain('【1】');
    expect(result.sentence).not.toContain('【2】');
    expect(result.sentence).toBe('They are a rock band from Oxford.');
  });

  it('returns cached result without API call', async () => {
    const cachedResult = { sentence: 'Cached artist sentence' };
    (mockKV.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(cachedResult);

    const result = await generateArtistSentence('Radiohead', mockClient, cache);

    expect(result).toEqual(cachedResult);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
