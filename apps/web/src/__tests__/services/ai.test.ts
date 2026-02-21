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

  describe('Chat Completions API with web search (gpt-5-search-api)', () => {
    it('extracts citations from nested url_citation format', async () => {
      const response = {
        model: 'gpt-5-search-api',
        choices: [{
          message: {
            content: 'Radiohead is a band [1] from Oxford [2].',
            annotations: [
              { type: 'url_citation', url_citation: { url: 'https://example.com/1' } },
              { type: 'url_citation', url_citation: { url: 'https://example.com/2' } },
            ],
          },
        }],
      };
      setupFetchMock([{ pattern: /api\.openai\.com/, response }]);

      const result = await client.chatCompletion({
        model: 'gpt-5-search-api',
        messages: [{ role: 'user', content: 'test' }],
        webSearch: true,
      });

      expect(result.citations).toEqual(['https://example.com/1', 'https://example.com/2']);
      expect(result.content).toContain('[1]');
    });

    it('extracts citations from flat annotation format (url on annotation)', async () => {
      const response = {
        model: 'gpt-5-search-api',
        choices: [{
          message: {
            content: 'Radiohead is a band [1] from Oxford [2].',
            annotations: [
              { type: 'url_citation', url: 'https://example.com/1', title: 'Source 1' },
              { type: 'url_citation', url: 'https://example.com/2', title: 'Source 2' },
            ],
          },
        }],
      };
      setupFetchMock([{ pattern: /api\.openai\.com/, response }]);

      const result = await client.chatCompletion({
        model: 'gpt-5-search-api',
        messages: [{ role: 'user', content: 'test' }],
        webSearch: true,
      });

      expect(result.citations).toEqual(['https://example.com/1', 'https://example.com/2']);
      expect(result.content).toContain('[1]');
    });

    it('replaces markdown citation links with numbered markers', async () => {
      const response = {
        model: 'gpt-5-search-api',
        choices: [{
          message: {
            content: 'Radiohead is a band ([Wikipedia](https://en.wikipedia.org/wiki/Radiohead)) from Oxford.',
            annotations: [
              { type: 'url_citation', url: 'https://en.wikipedia.org/wiki/Radiohead', title: 'Radiohead' },
            ],
          },
        }],
      };
      setupFetchMock([{ pattern: /api\.openai\.com/, response }]);

      const result = await client.chatCompletion({
        model: 'gpt-5-search-api',
        messages: [{ role: 'user', content: 'test' }],
        webSearch: true,
      });

      expect(result.content).toBe('Radiohead is a band [1] from Oxford.');
      expect(result.citations).toEqual(['https://en.wikipedia.org/wiki/Radiohead']);
    });

    it('extracts citations from content when annotations are missing', async () => {
      const response = {
        model: 'gpt-5-search-api',
        choices: [{
          message: {
            content: 'Mercury Rev is a band ([reference.org](https://reference.org/facts/Mercury_Rev?utm_source=openai)). Their album was popular ([AllMusic](https://www.allmusic.com/artist/mercury-rev?utm_source=openai)).',
          },
        }],
      };
      setupFetchMock([{ pattern: /api\.openai\.com/, response }]);

      const result = await client.chatCompletion({
        model: 'gpt-5-search-api',
        messages: [{ role: 'user', content: 'test' }],
        webSearch: true,
      });

      expect(result.content).toBe('Mercury Rev is a band [1]. Their album was popular [2].');
      expect(result.citations).toEqual([
        'https://reference.org/facts/Mercury_Rev?utm_source=openai',
        'https://www.allmusic.com/artist/mercury-rev?utm_source=openai',
      ]);
    });

    it('extracts citations from annotations when content has [N] markers (no markdown links)', async () => {
      // This is the primary gpt-5-search-api format: [N] markers in text, URLs in annotations only
      const response = {
        model: 'gpt-5-search-api',
        choices: [{
          message: {
            content: 'Midtown is an American pop-punk band [1] formed in 1998 [2]. They released three studio albums [3].',
            annotations: [
              { type: 'url_citation', url_citation: { url: 'https://en.wikipedia.org/wiki/Midtown_(band)', title: 'Midtown (band)' } },
              { type: 'url_citation', url_citation: { url: 'https://www.allmusic.com/artist/midtown', title: 'Midtown' } },
              { type: 'url_citation', url_citation: { url: 'https://www.discogs.com/artist/midtown', title: 'Midtown Discography' } },
            ],
          },
        }],
      };
      setupFetchMock([{ pattern: /api\.openai\.com/, response }]);

      const result = await client.chatCompletion({
        model: 'gpt-5-search-api',
        messages: [{ role: 'user', content: 'test' }],
        webSearch: true,
      });

      // Content should be preserved with [N] markers
      expect(result.content).toContain('[1]');
      expect(result.content).toContain('[2]');
      expect(result.content).toContain('[3]');
      // Citations should be extracted from annotations
      expect(result.citations).toEqual([
        'https://en.wikipedia.org/wiki/Midtown_(band)',
        'https://www.allmusic.com/artist/midtown',
        'https://www.discogs.com/artist/midtown',
      ]);
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

  it('handles flat annotation format (url directly on annotation)', async () => {
    const response = {
      model: 'gpt-5-search-api',
      choices: [
        {
          message: {
            content: 'Radiohead is an English rock band [1]. Their album {{OK Computer}} [2] is considered a masterpiece.',
            annotations: [
              {
                type: 'url_citation',
                url: 'https://en.wikipedia.org/wiki/Radiohead',
                title: 'Radiohead - Wikipedia',
              },
              {
                type: 'url_citation',
                url: 'https://en.wikipedia.org/wiki/OK_Computer',
                title: 'OK Computer - Wikipedia',
              },
            ],
          },
        },
      ],
    };
    setupFetchMock([{ pattern: /api\.openai\.com/, response }]);

    const result = await generateArtistSummary('Radiohead', mockClient, cache);

    expect(result.citations).toEqual([
      'https://en.wikipedia.org/wiki/Radiohead',
      'https://en.wikipedia.org/wiki/OK_Computer',
    ]);
    expect(result.summary).toContain('[1]');
    expect(result.summary).toContain('[2]');
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
    // gpt-5-search-api uses Chat Completions API format
    const response = {
      model: 'gpt-5-search-api',
      choices: [
        {
          message: {
            content: 'They are an English alternative rock band [1] known for experimental sounds [2]. Similar artists include Muse and Portishead.',
            annotations: [
              { type: 'url_citation', url_citation: { url: 'https://example.com/1' } },
              { type: 'url_citation', url_citation: { url: 'https://example.com/2' } },
            ],
          },
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
    // Chinese brackets typically appear with a space before them, like Western citations
    const response = {
      model: 'gpt-5-search-api',
      choices: [
        {
          message: {
            content: 'They are a rock band 【1】 from Oxford 【2】.',
          },
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
