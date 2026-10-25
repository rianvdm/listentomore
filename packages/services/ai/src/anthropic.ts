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

// Server-side web search runs inside the request, so it needs the 60s preset.
export function timeoutPresetFor(webSearch: boolean | undefined): TimeoutPreset {
  return webSearch ? 'verySlow' : 'slow';
}

interface AnthropicMessagesPayload {
  model: string;
  content: Array<{ type: string; text?: string; name?: string }>;
  stop_reason?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    server_tool_use?: { web_search_requests?: number };
  };
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
      body.tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }];
    }

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

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[Anthropic] API error: ${response.status} - ${errorBody}`);
      throw new Error(`Anthropic API error: ${response.statusText}`);
    }

    const data = (await response.json()) as AnthropicMessagesPayload;

    // Only text blocks are prose; server_tool_use and web_search_tool_result
    // blocks are ignored. Join with '' so [[Artist]] placeholders split across
    // blocks stay intact.
    const content = data.content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');

    // Same trap as the OpenAI Responses API: a budget exhaustion arrives as a
    // 200 with a fragment. Sonnet 5's adaptive thinking spends max_tokens too,
    // so the visible prose can be well under the limit and still be cut off.
    const truncated = data.stop_reason === 'max_tokens';

    if (truncated) {
      console.warn(
        `[Anthropic] Truncated on max_tokens: model=${data.model} ` +
        `limit=${options.maxTokens ?? 1500} ` +
        `output=${data.usage?.output_tokens ?? '?'} ` +
        `visibleChars=${content.length}.`
      );
    }

    const webSearchUsed = data.content.some(
      (b) => b.type === 'server_tool_use' && b.name === 'web_search'
    );
    const webSearchRequests =
      data.usage?.server_tool_use?.web_search_requests ?? null;

    const metadata: AIResponseMetadata = {
      provider: 'anthropic',
      model: data.model,
      api: 'messages',
      usage: data.usage
        ? {
            inputTokens: data.usage.input_tokens ?? null,
            outputTokens: data.usage.output_tokens ?? null,
            totalTokens:
              (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0) ||
              null,
          }
        : undefined,
      truncated,
      features: {
        webSearchUsed,
        webSearchRequests,
        reasoning: effort as ReasoningEffort,
      },
    };

    return { content, metadata };
  }
}
