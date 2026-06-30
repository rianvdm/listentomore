// AIService integration tests

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIClient, AICache, AIRateLimiter, AnthropicClient, AIService, buildUserInsightsMessages, generateUserInsightsSummary, USER_INSIGHTS_PROMPT_VERSION, generateArtistSummary, generateArtistSentence } from '@listentomore/ai';
import { getTaskConfig } from '@listentomore/config';
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

describe('AIRateLimiter — provider-aware limits', () => {
  it('uses the anthropic rate limit, not openai', async () => {
    const rl = new AIRateLimiter(createMockKV(), 'anthropic');
    const stats = await rl.getStats();
    expect(stats.provider).toBe('anthropic');
    expect(stats.maxRequests).toBe(50);
  });

  it('still reports the openai limit for the openai provider', async () => {
    const rl = new AIRateLimiter(createMockKV(), 'openai');
    expect((await rl.getStats()).maxRequests).toBe(90);
  });
});

describe('AnthropicClient.chatCompletion', () => {
  beforeEach(() => vi.clearAllMocks());

  function lastBody(mockFetch: ReturnType<typeof setupFetchMock>) {
    const init = mockFetch.mock.calls[0][1] as RequestInit;
    return JSON.parse(init.body as string);
  }

  it('extracts the system message to the top-level system param', async () => {
    const mockFetch = setupFetchMock([
      { pattern: /api\.anthropic\.com/, response: { model: 'claude-sonnet-4-6', content: [{ type: 'text', text: 'hi' }] } },
    ]);
    await new AnthropicClient('key').chatCompletion({
      model: 'claude-sonnet-4-6',
      messages: [
        { role: 'system', content: 'You are a friend.' },
        { role: 'user', content: 'My week...' },
      ],
      maxTokens: 1500,
      temperature: 0.8,
    });
    const body = lastBody(mockFetch);
    expect(body.system).toBe('You are a friend.');
    expect(body.messages).toEqual([{ role: 'user', content: 'My week...' }]);
    expect(body.max_tokens).toBe(1500);
    expect(body.temperature).toBe(0.8);
  });

  it('omits temperature for opus-tier models', async () => {
    const mockFetch = setupFetchMock([
      { pattern: /api\.anthropic\.com/, response: { model: 'claude-opus-4-8', content: [{ type: 'text', text: 'x' }] } },
    ]);
    await new AnthropicClient('key').chatCompletion({
      model: 'claude-opus-4-8',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 1500,
      temperature: 0.8,
    });
    expect(lastBody(mockFetch).temperature).toBeUndefined();
  });

  it('maps the response to content + anthropic metadata', async () => {
    setupFetchMock([
      {
        pattern: /api\.anthropic\.com/,
        response: { model: 'claude-sonnet-4-6', content: [{ type: 'text', text: 'warm summary' }], usage: { input_tokens: 100, output_tokens: 50 } },
      },
    ]);
    const res = await new AnthropicClient('key').chatCompletion({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.content).toBe('warm summary');
    expect(res.metadata?.provider).toBe('anthropic');
    expect(res.metadata?.api).toBe('messages');
    expect(res.metadata?.usage).toEqual({ inputTokens: 100, outputTokens: 50, totalTokens: 150 });
  });

  it('throws on a non-200 response', async () => {
    setupFetchMock([
      { pattern: /api\.anthropic\.com/, response: { error: 'bad' }, options: { status: 400, ok: false } },
    ]);
    await expect(
      new AnthropicClient('key').chatCompletion({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toThrow('Anthropic API error');
  });
});

describe('AIService.getClientForTask', () => {
  function makeService() {
    return new AIService({ openaiApiKey: 'o', anthropicApiKey: 'a', cache: createMockKV() });
  }

  it('returns the OpenAI client for an openai-provider task', () => {
    const ai = makeService();
    expect(ai.getClientForTask('artistSummary')).toBe(ai.openai);
  });

  it('exposes a constructed anthropic client', () => {
    const ai = makeService();
    expect(ai.anthropic).toBeInstanceOf(AnthropicClient);
  });
});

const insightsSample = {
  weeklyPlayCount: 73,
  topArtists: [
    { name: 'Siiga', playcount: 39 },
    { name: 'Celer', playcount: 39 },
  ],
  topAlbums: [{ name: 'Nostalgia Burns', artist: 'Siiga', playcount: 39 }],
  recentTracks: [{ name: 'Videotape', artist: 'Radiohead' }],
  historicalArtists: [{ name: 'Celer' }, { name: 'Nils Frahm' }],
};

describe('buildUserInsightsMessages', () => {
  it('returns a system message and a user message', () => {
    const msgs = buildUserInsightsMessages(insightsSample);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].role).toBe('user');
  });

  it('annotates familiar vs new against the 6-month rotation', () => {
    const user = buildUserInsightsMessages(insightsSample)[1].content;
    expect(user).toContain('Celer: 39 plays (familiar)');
    expect(user).toContain('Siiga: 39 plays (new for them)');
  });

  it('includes the weekly play count and a named album', () => {
    const user = buildUserInsightsMessages(insightsSample)[1].content;
    expect(user).toContain('73');
    expect(user).toContain('Nostalgia Burns by Siiga');
  });
});

describe('warmer-voice prompt', () => {
  it('persona reacts to the music, not the listener', () => {
    const system = buildUserInsightsMessages(insightsSample)[0].content;
    expect(system.toLowerCase()).toContain('opinions about');
    expect(system).not.toContain('pattern they might not have noticed');
  });

  it('bans the not-X-but-Y construction and caps em dashes', () => {
    const user = buildUserInsightsMessages(insightsSample)[1].content;
    expect(user).toContain('less like X, more like Y');
    expect(user.toLowerCase()).toContain('em dash');
  });

  it('drops the atmosphere-seeding language', () => {
    const user = buildUserInsightsMessages(insightsSample)[1].content;
    expect(user).not.toContain('clear temperature');
  });

  it('exposes a prompt version for cache busting', () => {
    expect(USER_INSIGHTS_PROMPT_VERSION).toBe('v2');
  });

  it('embeds the hand-authored gold examples', () => {
    const user = buildUserInsightsMessages(insightsSample)[1].content;
    expect(user).toContain('When you fall into something, you fall all the way in.');
    expect(user).toContain('Still the one, no argument.');
    expect(user).toContain("No notes. That's a healthy week.");
    expect(user).not.toContain('[PLACEHOLDER');
  });
});

describe('generateUserInsightsSummary cache key', () => {
  it('reads and writes the versioned cache key', async () => {
    const mockKV = createMockKV();
    const cache = new AICache(mockKV);
    setupFetchMock([
      { pattern: /api\.anthropic\.com/, response: { model: 'claude-sonnet-4-6', content: [{ type: 'text', text: 'warm' }], usage: { input_tokens: 1, output_tokens: 1 } } },
    ]);
    await generateUserInsightsSummary('Bordesak', insightsSample, new AnthropicClient('k'), cache);
    expect(mockKV.get).toHaveBeenCalledWith('ai:userInsightsSummary:bordesak:v2', 'json');
    expect(mockKV.put).toHaveBeenCalledWith(
      'ai:userInsightsSummary:bordesak:v2',
      expect.any(String),
      expect.any(Object)
    );
  });
});

describe('userInsightsSummary provider flip', () => {
  it('is configured for anthropic sonnet', () => {
    const cfg = getTaskConfig('userInsightsSummary');
    expect(cfg.provider).toBe('anthropic');
    expect(cfg.model).toBe('claude-sonnet-4-6');
    expect(cfg.temperature).toBe(0.8);
  });

  it('routes the task to the anthropic client', () => {
    const ai = new AIService({ openaiApiKey: 'o', anthropicApiKey: 'a', cache: createMockKV() });
    expect(ai.getClientForTask('userInsightsSummary')).toBe(ai.anthropic);
  });
});
