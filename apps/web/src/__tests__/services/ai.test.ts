// AIService integration tests

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReasoningEffort } from '@listentomore/ai';
import { OpenAIClient, AICache, AIRateLimiter, AnthropicClient, AIService, buildUserInsightsMessages, generateUserInsightsSummary, containsForbiddenConstruction, USER_INSIGHTS_PROMPT_VERSION, generateArtistSummary, generateArtistSentence, generateAlbumDetail, isCacheableResponse, timeoutPresetFor, RegionUnsupportedError, withAgentTracing } from '@listentomore/ai';
import { getTaskConfig, AI_TASKS, type AITask } from '@listentomore/config';
import { createMockKV, setupFetchMock, mockFetchResponse } from '../utils/mocks';

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
    expect(body.temperature).toBeUndefined();
  });

  it('never sends temperature for any Claude model', async () => {
    for (const model of ['claude-sonnet-4-6', 'claude-sonnet-5-5', 'claude-opus-5-5']) {
      const mockFetch = setupFetchMock([
        { pattern: /api\.anthropic\.com/, response: { model, content: [{ type: 'text', text: 'x' }] } },
      ]);
      await new AnthropicClient('key').chatCompletion({
        model, messages: [{ role: 'user', content: 'hi' }], temperature: 0.8,
      });
      expect(lastBody(mockFetch).temperature).toBeUndefined();
    }
  });

  it('maps reasoning to output_config.effort, defaulting to low', async () => {
    const cases: Array<[ReasoningEffort | undefined, string]> = [
      [undefined, 'low'], ['none', 'low'], ['minimal', 'low'], ['low', 'low'],
      ['medium', 'medium'], ['high', 'high'], ['xhigh', 'xhigh'], ['max', 'max'],
    ];
    for (const [reasoning, effort] of cases) {
      const mockFetch = setupFetchMock([
        { pattern: /api\.anthropic\.com/, response: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'x' }] } },
      ]);
      await new AnthropicClient('key').chatCompletion({
        model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }], reasoning,
      });
      expect(lastBody(mockFetch).output_config).toEqual({ effort });
    }
  });

  it('ignores verbosity', async () => {
    const mockFetch = setupFetchMock([
      { pattern: /api\.anthropic\.com/, response: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'x' }] } },
    ]);
    await new AnthropicClient('key').chatCompletion({
      model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }], verbosity: 'low',
    });
    const body = lastBody(mockFetch);
    expect(body.text).toBeUndefined();
    expect(body.verbosity).toBeUndefined();
  });

  it('adds the web search tool only when webSearch is true', async () => {
    let mockFetch = setupFetchMock([
      { pattern: /api\.anthropic\.com/, response: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'x' }] } },
    ]);
    await new AnthropicClient('key').chatCompletion({
      model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }], webSearch: true,
    });
    // Basic search, not dynamic filtering: see WEB_SEARCH_TOOL in anthropic.ts.
    expect(lastBody(mockFetch).tools).toEqual([{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }]);

    mockFetch = setupFetchMock([
      { pattern: /api\.anthropic\.com/, response: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'x' }] } },
    ]);
    await new AnthropicClient('key').chatCompletion({
      model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }], webSearch: false,
    });
    expect('tools' in lastBody(mockFetch)).toBe(false);
  });

  it('uses the 60s timeout preset for web search tasks', () => {
    expect(timeoutPresetFor(true)).toBe('verySlow');
    expect(timeoutPresetFor(false)).toBe('slow');
    expect(timeoutPresetFor(undefined)).toBe('slow');
  });

  it('joins only text blocks, preserving a placeholder split across blocks', async () => {
    setupFetchMock([{
      pattern: /api\.anthropic\.com/,
      response: {
        model: 'claude-opus-5-5',
        content: [
          { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'Radiohead' } },
          { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [{ type: 'web_search_result', url: 'https://x', title: 't' }] },
          { type: 'text', text: 'Formed in 1985, [[Radio', citations: [{ type: 'web_search_result_location', url: 'https://x' }] },
          { type: 'text', text: 'head]] released {{OK Computer}}.' },
        ],
        stop_reason: 'end_turn',
        usage: { input_tokens: 900, output_tokens: 120, server_tool_use: { web_search_requests: 1 } },
      },
    }]);
    const res = await new AnthropicClient('key').chatCompletion({
      model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }], webSearch: true,
    });
    expect(res.content).toBe('Formed in 1985, [[Radiohead]] released {{OK Computer}}.');
    expect(res.metadata?.features?.webSearchUsed).toBe(true);
    expect(res.metadata?.features?.webSearchRequests).toBe(1);
  });

  it('drops narration before the search and keeps only the answer', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    setupFetchMock([{
      pattern: /api\.anthropic\.com/,
      response: {
        model: 'claude-sonnet-5-5',
        content: [
          { type: 'text', text: "I'll search for Jordan Rakei." },
          { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'Jordan Rakei' } },
          { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [{ type: 'web_search_result', url: 'https://x', title: 't' }] },
          { type: 'text', text: 'Jordan Rakei is a soul singer.' },
        ],
        stop_reason: 'end_turn',
      },
    }]);
    const res = await new AnthropicClient('key').chatCompletion({
      model: 'claude-sonnet-5-5', messages: [{ role: 'user', content: 'hi' }], webSearch: true,
    });
    expect(res.content).toBe('Jordan Rakei is a soul singer.');
    const dropped = log.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('pre-search'));
    expect(dropped).toEqual(['[Anthropic] Dropped 29 chars of pre-search text']);
    log.mockRestore();
  });

  it('keeps only text after the last search result when several searches ran', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    setupFetchMock([{
      pattern: /api\.anthropic\.com/,
      response: {
        model: 'claude-sonnet-5-5',
        content: [
          { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'a' } },
          { type: 'web_search_tool_result', tool_use_id: 's1', content: [] },
          { type: 'text', text: 'Let me search once more.' },
          { type: 'server_tool_use', id: 's2', name: 'web_search', input: { query: 'b' } },
          { type: 'web_search_tool_result', tool_use_id: 's2', content: [] },
          { type: 'text', text: 'The answer.' },
        ],
        stop_reason: 'end_turn',
      },
    }]);
    const res = await new AnthropicClient('key').chatCompletion({
      model: 'claude-sonnet-5-5', messages: [{ role: 'user', content: 'hi' }], webSearch: true,
    });
    expect(res.content).toBe('The answer.');
    log.mockRestore();
  });

  it('joins every text block when no search result is present', async () => {
    setupFetchMock([{
      pattern: /api\.anthropic\.com/,
      response: {
        model: 'claude-sonnet-5-5',
        content: [{ type: 'text', text: 'First half, ' }, { type: 'text', text: 'second half.' }],
        stop_reason: 'end_turn',
      },
    }]);
    const res = await new AnthropicClient('key').chatCompletion({
      model: 'claude-sonnet-5-5', messages: [{ role: 'user', content: 'hi' }], webSearch: true,
    });
    expect(res.content).toBe('First half, second half.');
  });

  it('returns empty content when no text blocks are present', async () => {
    setupFetchMock([{
      pattern: /api\.anthropic\.com/,
      response: { model: 'claude-opus-5-5', content: [{ type: 'server_tool_use', id: 's', name: 'web_search', input: {} }], stop_reason: 'end_turn' },
    }]);
    const res = await new AnthropicClient('key').chatCompletion({
      model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }], webSearch: true,
    });
    expect(res.content).toBe('');
    expect(isCacheableResponse(res.content, res.metadata, 'artistSummary', 'x')).toBe(false);
  });

  it('resumes a pause_turn exactly once with the assistant turn appended', async () => {
    const paused = { model: 'claude-opus-5-5', stop_reason: 'pause_turn',
      content: [{ type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'q' } }],
      usage: { input_tokens: 1000, output_tokens: 100, server_tool_use: { web_search_requests: 2 } } };
    const done = { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'final' }],
      usage: { input_tokens: 3000, output_tokens: 200 } };
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(mockFetchResponse(paused) as Response);
    fetchMock.mockResolvedValueOnce(mockFetchResponse(done) as Response);

    const res = await new AnthropicClient('key').chatCompletion({
      model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }], webSearch: true,
    });
    expect(res.content).toBe('final');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    const second = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(second.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: paused.content },
    ]);
    expect({ ...second, messages: undefined }).toEqual({ ...first, messages: undefined });
    // Usage and search flags cover both requests, not just the resumed one.
    expect(res.metadata?.usage).toEqual({ inputTokens: 4000, outputTokens: 300, totalTokens: 4300 });
    expect(res.metadata?.features?.webSearchRequests).toBe(2);
    expect(res.metadata?.features?.webSearchUsed).toBe(true);
  });

  it('does not loop on a second pause_turn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const paused = { model: 'claude-opus-5-5', stop_reason: 'pause_turn', content: [{ type: 'text', text: 'partial' }] };
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(mockFetchResponse(paused) as Response);
    fetchMock.mockResolvedValueOnce(mockFetchResponse(paused) as Response);
    const res = await new AnthropicClient('key').chatCompletion({
      model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }], webSearch: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.content).toBe('partial');
    expect(res.metadata?.truncated).toBe(true);
    expect(isCacheableResponse(res.content, res.metadata, 'artistSentence', 'x')).toBe(false);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('pause_turn'))).toBe(true);
    warn.mockRestore();
  });

  it('marks a refusal as not cacheable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setupFetchMock([{ pattern: /api\.anthropic\.com/,
      response: { model: 'claude-opus-5-5', stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'general_harms' }, content: [] } }]);
    const res = await new AnthropicClient('key').chatCompletion({
      model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.metadata?.truncated).toBe(true);
    expect(isCacheableResponse(res.content, res.metadata, 'artistSummary', 'x')).toBe(false);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('refusal'))).toBe(true);
    warn.mockRestore();
  });

  it('reports webSearchUsed false when the tool was offered but not called', async () => {
    setupFetchMock([{
      pattern: /api\.anthropic\.com/,
      response: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'plain' }], usage: { input_tokens: 10, output_tokens: 5 } },
    }]);
    const res = await new AnthropicClient('key').chatCompletion({
      model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }], webSearch: true,
    });
    expect(res.metadata?.features?.webSearchUsed).toBe(false);
    expect(res.metadata?.features?.webSearchRequests).toBeNull();
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

  it('returns the Anthropic client for an anthropic-provider task', () => {
    const ai = makeService();
    expect(ai.getClientForTask('artistSummary')).toBe(ai.anthropic);
    expect(ai.getClientForTask('listenAi')).toBe(ai.anthropic);
  });

  it('exposes a constructed anthropic client', () => {
    const ai = makeService();
    expect(ai.anthropic).toBeInstanceOf(AnthropicClient);
  });

  it('routes random facts through getClientForTask', async () => {
    const ai = makeService();
    const spy = vi.spyOn(ai, 'getClientForTask');
    setupFetchMock([
      { pattern: /api\.openai\.com/, response: { model: 'm', output_text: 'Did you know...', output: [], usage: {} } },
      { pattern: /api\.anthropic\.com/, response: { model: 'm', content: [{ type: 'text', text: 'Did you know...' }] } },
    ]);
    await ai.generateAndStoreRandomFact();
    expect(spy).toHaveBeenCalledWith('randomFact');
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
    expect(USER_INSIGHTS_PROMPT_VERSION).toBe('v3');
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
    expect(mockKV.get).toHaveBeenCalledWith('ai:userInsightsSummary:bordesak:v3', 'json');
    expect(mockKV.put).toHaveBeenCalledWith(
      'ai:userInsightsSummary:bordesak:v3',
      expect.any(String),
      expect.any(Object)
    );
  });
});

describe('containsForbiddenConstruction', () => {
  it('catches the comma "that\'s not X, that\'s Y" variant', () => {
    expect(
      containsForbiddenConstruction(
        "That's not a stray discovery, that's a whole new wing of the house getting furnished."
      )
    ).toBe(true);
  });

  it('catches "it\'s not X, it\'s Y" and "you\'re not X, you\'re Y"', () => {
    expect(containsForbiddenConstruction("It's not a phase, it's a full pivot.")).toBe(true);
    expect(containsForbiddenConstruction("You're not dabbling, you're all in.")).toBe(true);
  });

  it('catches "not X but Y" and the em-dash dismissal', () => {
    expect(containsForbiddenConstruction('not a detour but a destination')).toBe(true);
    expect(containsForbiddenConstruction('not background music — the main event')).toBe(true);
  });

  it('catches "less like X, more like Y"', () => {
    expect(containsForbiddenConstruction('It reads less like a week, more like a manifesto.')).toBe(true);
  });

  it('does not fire on legitimate negations', () => {
    expect(containsForbiddenConstruction("You didn't settle on one record, you bounced around all week.")).toBe(false);
    expect(containsForbiddenConstruction('Every Breath You Take live still does the job.')).toBe(false);
    expect(containsForbiddenConstruction('Still the one, no argument.')).toBe(false);
    expect(containsForbiddenConstruction('The jazz dig is the story.')).toBe(false);
  });
});

describe('generateUserInsightsSummary — scrub pass', () => {
  it('rewrites output that contains the banned construction', async () => {
    const mockKV = createMockKV();
    const cache = new AICache(mockKV);
    let call = 0;
    const client = {
      chatCompletion: vi.fn(async () => {
        call += 1;
        return call === 1
          ? { content: "That's not a discovery, that's a whole new direction." }
          : { content: "That's a whole new direction." };
      }),
    } as unknown as AnthropicClient;

    const result = await generateUserInsightsSummary('bordesak', insightsSample, client, cache);

    expect(client.chatCompletion).toHaveBeenCalledTimes(2); // generate + scrub
    expect(result.content).toBe("That's a whole new direction.");
    expect(containsForbiddenConstruction(result.content)).toBe(false);
  });

  it('does not run a scrub pass when the output is clean', async () => {
    const mockKV = createMockKV();
    const cache = new AICache(mockKV);
    const client = {
      chatCompletion: vi.fn(async () => ({ content: 'The jazz dig is the story.' })),
    } as unknown as AnthropicClient;

    await generateUserInsightsSummary('bordesak', insightsSample, client, cache);

    expect(client.chatCompletion).toHaveBeenCalledTimes(1);
  });
});

describe('userInsightsSummary provider flip', () => {
  it('is configured for anthropic opus', () => {
    const cfg = getTaskConfig('userInsightsSummary');
    expect(cfg.provider).toBe('anthropic');
    expect(cfg.model).toBe('claude-opus-5-5');
  });

  it('routes the task to the anthropic client', () => {
    const ai = new AIService({ openaiApiKey: 'o', anthropicApiKey: 'a', cache: createMockKV() });
    expect(ai.getClientForTask('userInsightsSummary')).toBe(ai.anthropic);
  });
});

// Regression coverage for the 2026-08-23 truncation bug.
//
// GPT-5.6 defaults to medium reasoning effort, and reasoning tokens are billed
// against max_output_tokens. When they exhaust the budget the API returns
// HTTP 200 with status "incomplete" and a fragment (sometimes an empty
// string). Nothing read those fields, so the fragment was cached for the full
// TTL — an albumDetail page sat truncated in KV for a day before anyone saw it.
describe('truncation detection', () => {
  it('flags a Responses API result that ran out of output budget', async () => {
    const client = new OpenAIClient('test-api-key');
    setupFetchMock([{
      pattern: /api\.openai\.com/,
      response: {
        model: 'gpt-5.6-terra',
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: 'For fans, those qualities were often a virtue—the set' }],
        }],
        usage: {
          input_tokens: 180,
          output_tokens: 1500,
          total_tokens: 1680,
          output_tokens_details: { reasoning_tokens: 1024 },
        },
      },
    }]);

    const result = await client.chatCompletion({
      model: 'gpt-5.6-terra',
      messages: [{ role: 'user', content: 'summarize an album' }],
      maxTokens: 1500,
    });

    expect(result.metadata?.truncated).toBe(true);
    expect(result.metadata?.usage?.reasoningTokens).toBe(1024);
  });

  it('does not flag a completed Responses API result', async () => {
    const client = new OpenAIClient('test-api-key');
    setupFetchMock([{
      pattern: /api\.openai\.com/,
      response: {
        model: 'gpt-5.6-terra',
        status: 'completed',
        incomplete_details: null,
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'A complete summary.' }] }],
        usage: {
          input_tokens: 180,
          output_tokens: 500,
          total_tokens: 680,
          output_tokens_details: { reasoning_tokens: 294 },
        },
      },
    }]);

    const result = await client.chatCompletion({
      model: 'gpt-5.6-terra',
      messages: [{ role: 'user', content: 'summarize an album' }],
      maxTokens: 4000,
    });

    expect(result.metadata?.truncated).toBe(false);
    expect(result.metadata?.usage?.reasoningTokens).toBe(294);
  });

  it('flags a Chat Completions result with finish_reason "length"', async () => {
    const client = new OpenAIClient('test-api-key');
    setupFetchMock([{
      pattern: /api\.openai\.com/,
      response: {
        model: 'gpt-4o-mini',
        choices: [{ message: { content: 'half a sentence' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 10, completion_tokens: 100, total_tokens: 110 },
      },
    }]);

    // A non-gpt-5 model with no Responses-only features stays on Chat Completions.
    const result = await client.chatCompletion({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
    });

    expect(result.metadata?.api).toBe('chat_completions');
    expect(result.metadata?.truncated).toBe(true);
  });

  it('flags an Anthropic result with stop_reason "max_tokens"', async () => {
    const client = new AnthropicClient('test-api-key');
    setupFetchMock([{
      pattern: /api\.anthropic\.com/,
      response: {
        model: 'claude-sonnet-5',
        content: [{ type: 'text', text: 'a partial insight' }],
        stop_reason: 'max_tokens',
        usage: { input_tokens: 500, output_tokens: 5000 },
      },
    }]);

    const result = await client.chatCompletion({
      model: 'claude-sonnet-5',
      messages: [{ role: 'user', content: 'insights please' }],
      maxTokens: 5000,
    });

    expect(result.metadata?.truncated).toBe(true);
  });
});

describe('isCacheableResponse', () => {
  it('rejects a truncated response', () => {
    const metadata = {
      provider: 'openai' as const,
      model: 'gpt-5.6-terra',
      api: 'responses' as const,
      truncated: true,
      usage: { inputTokens: 180, outputTokens: 1500, totalTokens: 1680, reasoningTokens: 1024 },
    };
    expect(isCacheableResponse('a fragment', metadata, 'albumDetail', 'artist', 'album')).toBe(false);
  });

  it('rejects an empty response even when the API says it completed', () => {
    const metadata = {
      provider: 'openai' as const,
      model: 'gpt-5.6-terra',
      api: 'responses' as const,
      truncated: false,
    };
    expect(isCacheableResponse('   ', metadata, 'albumDetail', 'artist', 'album')).toBe(false);
  });

  it('accepts a complete, non-empty response', () => {
    const metadata = {
      provider: 'openai' as const,
      model: 'gpt-5.6-terra',
      api: 'responses' as const,
      truncated: false,
    };
    expect(isCacheableResponse('A complete summary.', metadata, 'albumDetail', 'artist', 'album')).toBe(true);
  });

  it('accepts a response from a client that reports no metadata', () => {
    expect(isCacheableResponse('A complete summary.', undefined, 'albumDetail', 'artist', 'album')).toBe(true);
  });
});

describe('truncated responses are not cached', () => {
  const truncatedResponse = {
    content: 'For fans, those qualities were often a virtue—the set',
    metadata: {
      provider: 'openai' as const,
      model: 'gpt-5.6-terra',
      api: 'responses' as const,
      truncated: true,
      usage: { inputTokens: 180, outputTokens: 1500, totalTokens: 1680, reasoningTokens: 1024 },
    },
  };

  it('returns the fragment to the caller but leaves KV empty (albumDetail)', async () => {
    const mockKV = createMockKV();
    const cache = new AICache(mockKV);
    const client = { chatCompletion: vi.fn(async () => truncatedResponse) } as unknown as OpenAIClient;

    const result = await generateAlbumDetail(
      'Counting Crows', 'Across a Wire', client, cache, 1998
    );

    expect(result.content).toBe(truncatedResponse.content);
    expect(mockKV.put).not.toHaveBeenCalled();

    // And the next request regenerates rather than serving the fragment.
    await generateAlbumDetail('Counting Crows', 'Across a Wire', client, cache, 1998);
    expect(client.chatCompletion).toHaveBeenCalledTimes(2);
  });

  it('caches a complete albumDetail response (control)', async () => {
    const mockKV = createMockKV();
    const cache = new AICache(mockKV);
    const client = {
      chatCompletion: vi.fn(async () => ({
        content: 'A complete album summary.',
        metadata: { ...truncatedResponse.metadata, truncated: false },
      })),
    } as unknown as OpenAIClient;

    await generateAlbumDetail('Counting Crows', 'Across a Wire', client, cache, 1998);
    expect(mockKV.put).toHaveBeenCalledTimes(1);

    // Second call is served from cache.
    await generateAlbumDetail('Counting Crows', 'Across a Wire', client, cache, 1998);
    expect(client.chatCompletion).toHaveBeenCalledTimes(1);
  });

  it('leaves KV empty for a truncated artistSummary', async () => {
    const mockKV = createMockKV();
    const cache = new AICache(mockKV);
    const client = { chatCompletion: vi.fn(async () => truncatedResponse) } as unknown as OpenAIClient;

    await generateArtistSummary('Counting Crows', client, cache);
    expect(mockKV.put).not.toHaveBeenCalled();
  });

  it('leaves KV empty for a truncated artistSentence', async () => {
    const mockKV = createMockKV();
    const cache = new AICache(mockKV);
    const client = { chatCompletion: vi.fn(async () => truncatedResponse) } as unknown as OpenAIClient;

    await generateArtistSentence('Counting Crows', client, cache);
    expect(mockKV.put).not.toHaveBeenCalled();
  });

  it('keeps the original summary when the insights scrub pass truncates', async () => {
    const mockKV = createMockKV();
    const cache = new AICache(mockKV);
    let call = 0;
    const client = {
      chatCompletion: vi.fn(async () => {
        call += 1;
        return call === 1
          ? { content: "That's not a discovery, that's a whole new direction." }
          : { content: "That's a whole new", metadata: { ...truncatedResponse.metadata } };
      }),
    } as unknown as AnthropicClient;

    const result = await generateUserInsightsSummary('bordesak', insightsSample, client, cache);

    expect(client.chatCompletion).toHaveBeenCalledTimes(2);
    expect(result.content).toBe("That's not a discovery, that's a whole new direction.");
  });
});

describe('AI task token budgets', () => {
  // randomFact stays on OpenAI after eval round 3, and
  // userInsightsRecommendations runs at medium effort (eval round 2). See
  // their notes in packages/config/src/ai.ts.
  const OPENAI_TASKS: AITask[] = ['randomFact'];

  it('every Claude task runs with explicit effort, low unless noted', () => {
    const MEDIUM_EFFORT_TASKS: AITask[] = ['userInsightsRecommendations'];
    for (const task of Object.keys(AI_TASKS) as AITask[]) {
      if (OPENAI_TASKS.includes(task)) continue;
      expect(getTaskConfig(task).provider).toBe('anthropic');
      expect(getTaskConfig(task).reasoning).toBe(
        MEDIUM_EFFORT_TASKS.includes(task) ? 'medium' : 'low'
      );
    }
  });

  it('splits models as designed', () => {
    for (const t of ['artistSentence', 'listenAi'] as const) {
      expect(getTaskConfig(t).model).toBe('claude-sonnet-5-5');
    }
    for (const t of ['artistSummary', 'albumDetail', 'genreSummary', 'albumRecommendations', 'userInsightsSummary', 'userInsightsRecommendations'] as const) {
      expect(getTaskConfig(t).model).toBe('claude-opus-5-5');
    }
    expect(getTaskConfig('randomFact')).toMatchObject({ provider: 'openai', model: 'gpt-5.6-luna' });
  });

  // Reasoning effort must be explicit: the 5.6 tiers default to 'medium',
  // which is what produced the 2025-token reasoning outlier that truncated
  // albumDetail. See the maxTokens note in packages/config/src/ai.ts.
  it.each([
    'artistSummary', 'albumDetail', 'genreSummary', 'artistSentence',
    'listenAi', 'albumRecommendations',
  ] as const)('%s pins an explicit reasoning effort', (task) => {
    expect(getTaskConfig(task).reasoning).toBeDefined();
  });

  it('gives the long-form web-search tasks room for reasoning plus prose', () => {
    // Worst observed real spend was ~2450 total on albumDetail and ~1000 on
    // albumRecommendations, against prose of only ~500-700 tokens.
    expect(getTaskConfig('albumDetail').maxTokens).toBeGreaterThanOrEqual(4000);
    expect(getTaskConfig('albumRecommendations').maxTokens).toBeGreaterThanOrEqual(3000);
  });
});

describe('OpenAIClient region blocks', () => {
  const regionBody = {
    error: {
      code: 'unsupported_country_region_territory',
      message: 'Country, region, or territory not supported',
      param: null,
      type: 'request_forbidden',
    },
  };
  let client: OpenAIClient;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    client = new OpenAIClient('test-api-key');
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('responses() throws RegionUnsupportedError and warns on a region 403', async () => {
    setupFetchMock([{ pattern: /api\.openai\.com/, response: regionBody, options: { status: 403, ok: false } }]);

    await expect(client.responses({ model: 'gpt-5.6-terra', input: 'hi' })).rejects.toBeInstanceOf(RegionUnsupportedError);
    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('chat completions path throws RegionUnsupportedError on a region 403', async () => {
    setupFetchMock([{ pattern: /api\.openai\.com/, response: regionBody, options: { status: 403, ok: false } }]);

    await expect(
      client.chatCompletion({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toBeInstanceOf(RegionUnsupportedError);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('keeps the generic error for other 403s', async () => {
    setupFetchMock([{
      pattern: /api\.openai\.com/,
      response: { error: { code: 'insufficient_quota', message: 'quota' } },
      options: { status: 403, ok: false },
    }]);

    const promise = client.responses({ model: 'gpt-5.6-terra', input: 'hi' });
    await expect(promise).rejects.toThrow('OpenAI Responses API error');
    await expect(promise).rejects.not.toBeInstanceOf(RegionUnsupportedError);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('keeps the generic error for a 500', async () => {
    setupFetchMock([{ pattern: /api\.openai\.com/, response: { error: 'boom' }, options: { status: 500, ok: false } }]);

    await expect(client.responses({ model: 'gpt-5.6-terra', input: 'hi' })).rejects.not.toBeInstanceOf(RegionUnsupportedError);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('falls through to the generic error when a 403 body is not JSON', async () => {
    const htmlResponse = {
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token <')),
      text: vi.fn().mockResolvedValue('<html><body>Forbidden</body></html>'),
      headers: new Headers(),
    } as unknown as Response;
    globalThis.fetch = vi.fn().mockResolvedValue(htmlResponse) as typeof fetch;

    const promise = client.responses({ model: 'gpt-5.6-terra', input: 'hi' });
    await expect(promise).rejects.toThrow('OpenAI Responses API error: Forbidden');
    await expect(promise).rejects.not.toBeInstanceOf(RegionUnsupportedError);
  });
});

describe('withAgentTracing', () => {
  interface RecordedSpan {
    name: string;
    parent: string | null;
    attributes: Record<string, boolean | number | string | undefined>;
    exceptions: unknown[];
    status?: { code: string; message?: string };
  }

  // Minimal stand-in for the Workers custom spans API: records each span,
  // its parent, and its attributes.
  function createFakeTracing() {
    const spans: RecordedSpan[] = [];
    const stack: RecordedSpan[] = [];
    const tracing = {
      enterSpan(name: string, callback: (span: unknown) => unknown) {
        const record: RecordedSpan = {
          name,
          parent: stack.at(-1)?.name ?? null,
          attributes: {},
          exceptions: [],
        };
        spans.push(record);
        const span = {
          setAttribute(key: string, value: boolean | number | string) {
            record.attributes[key] = value;
            return span;
          },
          setAttributes(attrs: Record<string, boolean | number | string | undefined>) {
            Object.assign(record.attributes, attrs);
            return span;
          },
          recordException(exception: unknown) {
            record.exceptions.push(exception);
          },
          setStatus(status: { code: string; message?: string }) {
            record.status = status;
            return span;
          },
        };
        stack.push(record);
        try {
          const result = callback(span);
          return result instanceof Promise ? result.finally(() => stack.pop()) : (stack.pop(), result);
        } catch (error) {
          stack.pop();
          throw error;
        }
      },
    };
    return { tracing: tracing as unknown as Tracing, spans };
  }

  const okClient = {
    chatCompletion: vi.fn(async () => ({
      content: 'They are an English rock band.',
      metadata: {
        provider: 'openai' as const,
        model: 'gpt-5.6-terra-2026-09-01',
        api: 'responses' as const,
        usage: { inputTokens: 120, outputTokens: 45, totalTokens: 165 },
        features: { webSearchUsed: true },
      },
    })),
  };

  const options = {
    model: 'gpt-5.6-terra',
    maxTokens: 400,
    messages: [
      { role: 'system' as const, content: 'Be succinct.' },
      { role: 'user' as const, content: 'Write about Radiohead.' },
    ],
  };

  beforeEach(() => okClient.chatCompletion.mockClear());

  it('emits invoke_agent with a nested chat span and agent identity on both', async () => {
    const { tracing, spans } = createFakeTracing();
    const client = withAgentTracing(okClient, 'artistSentence', tracing);

    const response = await client.chatCompletion(options);

    expect(response.content).toBe('They are an English rock band.');
    expect(okClient.chatCompletion).toHaveBeenCalledWith(options);
    expect(spans.map((s) => [s.name, s.parent])).toEqual([
      ['invoke_agent artistSentence', null],
      ['chat gpt-5.6-terra', 'invoke_agent artistSentence'],
    ]);
    const [agent, chat] = spans;
    for (const span of [agent, chat]) {
      expect(span.attributes['gen_ai.agent.name']).toBe('artistSentence');
      expect(span.attributes['gen_ai.agent.id']).toBe('listentomore-artistSentence');
      expect(span.attributes['gen_ai.conversation.id']).toEqual(expect.any(String));
    }
    expect(agent.attributes['gen_ai.conversation.id']).toBe(chat.attributes['gen_ai.conversation.id']);
    expect(agent.attributes['gen_ai.operation.name']).toBe('invoke_agent');
    expect(chat.attributes).toMatchObject({
      'gen_ai.operation.name': 'chat',
      'gen_ai.request.model': 'gpt-5.6-terra',
      'gen_ai.response.model': 'gpt-5.6-terra-2026-09-01',
      'gen_ai.provider.name': 'openai',
      'gen_ai.usage.input_tokens': 120,
      'gen_ai.usage.output_tokens': 45,
      'listentomore.web_search_used': true,
    });
  });

  it('records prompt and answer for public-input tasks', async () => {
    const { tracing, spans } = createFakeTracing();
    await withAgentTracing(okClient, 'artistSentence', tracing).chatCompletion(options);

    const chat = spans[1];
    expect(JSON.parse(chat.attributes['gen_ai.system_instructions'] as string)).toEqual([
      { type: 'text', content: 'Be succinct.' },
    ]);
    expect(JSON.parse(chat.attributes['gen_ai.input.messages'] as string)).toEqual([
      { role: 'user', parts: [{ type: 'text', content: 'Write about Radiohead.' }] },
    ]);
    expect(JSON.parse(chat.attributes['gen_ai.output.messages'] as string)).toEqual([
      { role: 'assistant', parts: [{ type: 'text', content: 'They are an English rock band.' }] },
    ]);
  });

  it.each(['listenAi', 'userInsightsSummary', 'userInsightsRecommendations'] as const)(
    'never records prompt or answer text for %s',
    async (task) => {
      const { tracing, spans } = createFakeTracing();
      await withAgentTracing(okClient, task, tracing).chatCompletion(options);

      const keys = spans.flatMap((s) => Object.keys(s.attributes));
      expect(keys).not.toContain('gen_ai.input.messages');
      expect(keys).not.toContain('gen_ai.output.messages');
      expect(keys).not.toContain('gen_ai.system_instructions');
      expect(spans[1].attributes['gen_ai.usage.input_tokens']).toBe(120);
    }
  );

  it('records the error on the chat span and rethrows', async () => {
    const { tracing, spans } = createFakeTracing();
    const failing = { chatCompletion: vi.fn(async () => { throw new Error('OpenAI API error: 500'); }) };

    await expect(
      withAgentTracing(failing, 'artistSentence', tracing).chatCompletion(options)
    ).rejects.toThrow('OpenAI API error: 500');

    const chat = spans[1];
    expect(chat.exceptions).toEqual([{ name: 'Error', message: 'OpenAI API error: 500' }]);
    expect(chat.status).toEqual({ code: 'error', message: 'OpenAI API error: 500' });
  });

  it('AIService wraps task clients only when tracing is provided', async () => {
    const { tracing, spans } = createFakeTracing();
    const untraced = new AIService({ openaiApiKey: 'o', anthropicApiKey: 'a', cache: createMockKV() });
    expect(untraced.getClientForTask('artistSentence')).toBe(untraced.anthropic);

    const traced = new AIService({ openaiApiKey: 'o', anthropicApiKey: 'a', cache: createMockKV(), tracing });
    const client = traced.getClientForTask('artistSentence');
    expect(client).not.toBe(traced.anthropic);

    const spy = vi.spyOn(traced.anthropic, 'chatCompletion').mockResolvedValue({ content: 'ok' });
    await client.chatCompletion(options);
    expect(spy).toHaveBeenCalledWith(options);
    expect(spans.map((s) => s.name)).toEqual(['invoke_agent artistSentence', 'chat gpt-5.6-terra']);
  });
});

describe('playlist cover removal', () => {
  it('has no playlist cover task or image generation', () => {
    expect('playlistCoverPrompt' in AI_TASKS).toBe(false);
    expect((new OpenAIClient('k') as unknown as Record<string, unknown>).generateImage).toBeUndefined();
  });
});
