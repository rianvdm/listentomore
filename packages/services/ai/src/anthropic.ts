// ABOUTME: Anthropic (Claude) API client mirroring the OpenAIClient shape.
// ABOUTME: Calls POST /v1/messages via raw fetch; no SDK dependency.
// ABOUTME: Never sends temperature (400s on current models); maps reasoning to output_config.effort.

import { AI_PROVIDERS } from '@listentomore/config';
import { fetchWithTimeout } from '@listentomore/shared';
import type { TimeoutPreset } from '@listentomore/shared';
import type {
  ChatClient,
  ChatCompletionOptions,
  ChatCompletionResponse,
  AIResponseMetadata,
  ReasoningEffort,
  WebCitation,
} from './types';
import type { AIRateLimiter } from './rate-limit';

const ANTHROPIC_VERSION = '2023-06-01';

export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

// Opus 5.5 defaults to medium effort, so the client always sends one
// explicitly. OpenAI-only levels below 'low' collapse to 'low'.
const EFFORT_BY_REASONING: Record<ReasoningEffort, ClaudeEffort> = {
  none: 'low',
  minimal: 'low',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
};

export function mapReasoningToEffort(
  reasoning: ReasoningEffort | undefined
): ClaudeEffort {
  return reasoning ? EFFORT_BY_REASONING[reasoning] : 'low';
}

// Basic web search, not the dynamic-filtering web_search_20260209. The 2026
// variant runs each search from model-written code inside code execution; in
// the eval its first script crashed on every traced call and still spent
// searches, so max_uses ran out before recommendations could be verified and
// the model fell back to "Not enough information". With the basic variant each
// search is a direct tool call, so the ceiling counts real searches.
// max_uses is 5, not 3 (raised in eval round 4): albumRecommendations verifies
// the seed plus 3 picks, which needs 4 searches; at 3 Claude returned 2 picks.
// A task that needs fewer sets webSearchMaxUses in its config.
export const WEB_SEARCH_TOOL = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 5,
} as const;

// Server-side web search runs inside the request, so it needs the 60s preset.
export function timeoutPresetFor(webSearch: boolean | undefined): TimeoutPreset {
  return webSearch ? 'verySlow' : 'slow';
}

// A citation on a text block. Only web_search_result_location citations are
// read; other types (document locations, caller-supplied search results) are
// skipped.
interface AnthropicCitation {
  type: string;
  url?: string;
  title?: string | null;
}

type AnthropicContentBlock = {
  type: string;
  text?: string;
  name?: string;
  citations?: AnthropicCitation[] | null;
  // A web_search_tool_result holds an array of results, or one error object.
  content?: unknown;
};

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  server_tool_use?: { web_search_requests?: number };
}

interface AnthropicMessagesPayload {
  model: string;
  content: AnthropicContentBlock[];
  stop_reason?: string | null;
  usage?: AnthropicUsage;
}

// Only text blocks are prose; server_tool_use and web_search_tool_result
// blocks are ignored. Join with '' so [[Artist]] placeholders split across
// blocks stay intact. When the model searched, it can narrate before the
// search ("I'll search for ..."), so only text after the last search result
// counts as the answer, and only its citations are the answer's.
function extractAnswerText(content: AnthropicContentBlock[]): {
  text: string;
  citations: WebCitation[];
  droppedBlocks: number;
  droppedChars: number;
} {
  const isText = (b: AnthropicContentBlock) =>
    b.type === 'text' && typeof b.text === 'string';
  let lastResult = -1;
  content.forEach((b, i) => {
    if (b.type === 'web_search_tool_result') lastResult = i;
  });
  const join = (blocks: AnthropicContentBlock[]) =>
    blocks.filter(isText).map((b) => b.text).join('');
  const answer = content.slice(lastResult + 1);
  const dropped = content.slice(0, lastResult + 1);
  return {
    text: join(answer),
    citations: collectCitations(answer.filter(isText)),
    droppedBlocks: dropped.filter(isText).length,
    droppedChars: join(dropped).length,
  };
}

// Web search citations of the given text blocks, once per URL, in order of
// first citation; the first title seen for a URL is kept.
function collectCitations(blocks: AnthropicContentBlock[]): WebCitation[] {
  const byUrl = new Map<string, WebCitation>();
  for (const block of blocks) {
    for (const citation of block.citations ?? []) {
      if (citation.type !== 'web_search_result_location') continue;
      if (typeof citation.url !== 'string' || byUrl.has(citation.url)) continue;
      byUrl.set(citation.url, {
        url: citation.url,
        title: typeof citation.title === 'string' ? citation.title : null,
      });
    }
  }
  return [...byUrl.values()];
}

function sumOptional(a: number | undefined, b: number | undefined): number | undefined {
  return a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
}

// A resumed turn is billed as two requests, so usage covers both.
function mergeUsage(
  a: AnthropicUsage | undefined,
  b: AnthropicUsage | undefined
): AnthropicUsage | undefined {
  if (!a || !b) return a ?? b;
  const webSearchRequests = sumOptional(
    a.server_tool_use?.web_search_requests,
    b.server_tool_use?.web_search_requests
  );
  return {
    input_tokens: sumOptional(a.input_tokens, b.input_tokens),
    output_tokens: sumOptional(a.output_tokens, b.output_tokens),
    ...(webSearchRequests !== undefined
      ? { server_tool_use: { web_search_requests: webSearchRequests } }
      : {}),
  };
}

// The error codes of searches that failed inside a 200 response: a
// web_search_tool_result whose content is a web_search_tool_result_error
// (too_many_requests, unavailable, max_uses_exceeded, invalid_input,
// query_too_long). The model still answers after one, often with NONE or
// "not enough information", so the caller needs to know the search broke.
function webSearchErrorCodes(payload: AnthropicMessagesPayload): string[] {
  const codes: string[] = [];
  for (const block of payload.content) {
    if (block.type !== 'web_search_tool_result') continue;
    const result = block.content as { type?: unknown; error_code?: unknown } | null | undefined;
    if (result && !Array.isArray(result) && result.type === 'web_search_tool_result_error') {
      codes.push(typeof result.error_code === 'string' ? result.error_code : 'unknown');
    }
  }
  return codes;
}

function calledWebSearch(payload: AnthropicMessagesPayload): boolean {
  return payload.content.some(
    (b) => b.type === 'server_tool_use' && b.name === 'web_search'
  );
}

export class AnthropicClient implements ChatClient {
  private apiKey: string;
  private baseUrl: string;
  private rateLimiter: AIRateLimiter | null;

  constructor(apiKey: string, rateLimiter?: AIRateLimiter) {
    this.apiKey = apiKey;
    this.baseUrl = AI_PROVIDERS.anthropic.baseUrl;
    this.rateLimiter = rateLimiter ?? null;
  }

  async chatCompletion(
    options: ChatCompletionOptions
  ): Promise<ChatCompletionResponse> {
    if (this.rateLimiter) {
      await this.rateLimiter.acquire();
    }

    // Anthropic takes the system prompt as a top-level param, not a message.
    const systemMessage = options.messages.find((m) => m.role === 'system');
    const conversation = options.messages.filter((m) => m.role !== 'system');

    const body: Record<string, unknown> = {
      model: options.model,
      max_tokens: options.maxTokens ?? 1500,
      messages: conversation.map((m) => ({ role: m.role, content: m.content })),
    };
    if (systemMessage) {
      body.system = systemMessage.content;
    }
    // Current Claude models 400 on temperature, so it is never sent.
    // Claude has no verbosity control; options.verbosity is ignored.
    const effort = mapReasoningToEffort(options.reasoning);
    body.output_config = { effort };
    if (options.webSearch === true) {
      body.tools = [
        { ...WEB_SEARCH_TOOL, max_uses: options.webSearchMaxUses ?? WEB_SEARCH_TOOL.max_uses },
      ];
    }

    let data = await this.post(body, options);
    let usage = data.usage;
    let webSearchUsed = calledWebSearch(data);
    // The resumed turn returns only its new blocks, so errors from both
    // requests are kept.
    const webSearchErrors = webSearchErrorCodes(data);

    // Server-side web search hit its iteration limit: re-send the same request
    // with the partial assistant turn appended. One resume only; a second
    // pause_turn is returned as truncated so the partial is never cached.
    if (data.stop_reason === 'pause_turn') {
      data = await this.post(
        {
          ...body,
          messages: [
            ...(body.messages as unknown[]),
            { role: 'assistant', content: data.content },
          ],
        },
        options
      );
      usage = mergeUsage(usage, data.usage);
      webSearchUsed = webSearchUsed || calledWebSearch(data);
      webSearchErrors.push(...webSearchErrorCodes(data));
    }

    if (webSearchErrors.length > 0) {
      console.warn(`[Anthropic] Web search tool errors: ${webSearchErrors.join(', ')}`);
    }

    const { text: content, citations, droppedBlocks, droppedChars } = extractAnswerText(data.content);
    if (droppedBlocks > 0) {
      console.log(
        `[Anthropic] Dropped ${droppedBlocks} text block${droppedBlocks === 1 ? '' : 's'} ` +
        `(${droppedChars} chars) of pre-search text`
      );
    }

    // Same trap as the OpenAI Responses API: a budget exhaustion arrives as a
    // 200 with a fragment. Sonnet 5's adaptive thinking spends max_tokens too,
    // so the visible prose can be well under the limit and still be cut off.
    const maxTokensHit = data.stop_reason === 'max_tokens';
    // A safety-classifier refusal carries no usable content; reuse the
    // truncated flag so isCacheableResponse() keeps it out of the cache.
    const refused = data.stop_reason === 'refusal';
    const stillPaused = data.stop_reason === 'pause_turn';
    const truncated = maxTokensHit || refused || stillPaused;

    if (maxTokensHit) {
      console.warn(
        `[Anthropic] Truncated on max_tokens: model=${data.model} ` +
        `limit=${options.maxTokens ?? 1500} ` +
        `output=${data.usage?.output_tokens ?? '?'} ` +
        `visibleChars=${content.length}.`
      );
    }
    if (refused) {
      console.warn(`[Anthropic] Response refused (stop_reason=refusal): model=${data.model}.`);
    }
    if (stillPaused) {
      console.warn(`[Anthropic] Still paused after one resume (stop_reason=pause_turn): model=${data.model}.`);
    }

    const webSearchRequests =
      usage?.server_tool_use?.web_search_requests ?? null;

    const metadata: AIResponseMetadata = {
      provider: 'anthropic',
      model: data.model,
      api: 'messages',
      usage: usage
        ? {
            inputTokens: usage.input_tokens ?? null,
            outputTokens: usage.output_tokens ?? null,
            totalTokens:
              (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) || null,
          }
        : undefined,
      truncated,
      features: {
        webSearchUsed,
        webSearchRequests,
        ...(webSearchErrors.length > 0 ? { webSearchErrors } : {}),
        reasoning: effort as ReasoningEffort,
      },
    };

    return citations.length > 0 ? { content, metadata, citations } : { content, metadata };
  }

  private async post(
    body: Record<string, unknown>,
    options: Pick<ChatCompletionOptions, 'webSearch' | 'quietErrors'>
  ): Promise<AnthropicMessagesPayload> {
    const response = await fetchWithTimeout(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      timeout: timeoutPresetFor(options.webSearch),
    });

    // The error body can quote the request, so a quiet call discards it unread.
    if (!response.ok && options.quietErrors) {
      await response.body?.cancel().catch(() => undefined);
      console.error(`[Anthropic] API error: ${response.status}`);
      throw new Error(`Anthropic API error: ${response.status}`);
    }
    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[Anthropic] API error: ${response.status} - ${errorBody}`);
      throw new Error(`Anthropic API error: ${response.statusText}`);
    }

    return (await response.json()) as AnthropicMessagesPayload;
  }
}
