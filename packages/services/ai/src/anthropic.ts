// ABOUTME: Anthropic (Claude) API client mirroring the OpenAIClient shape.
// ABOUTME: Calls POST /v1/messages via raw fetch; no SDK dependency.

import { AI_PROVIDERS } from '@listentomore/config';
import { fetchWithTimeout } from '@listentomore/shared';
import type {
  ChatClient,
  ChatCompletionOptions,
  ChatCompletionResponse,
  AIResponseMetadata,
} from './types';
import type { AIRateLimiter } from './rate-limit';

const ANTHROPIC_VERSION = '2023-06-01';

// Newer-generation models reject sampling params (temperature/top_p/top_k)
// with a 400: opus-tier (4.7+), Fable 5, and Sonnet 5. Verified live for
// claude-sonnet-5 on 2026-07-01 ("`temperature` is deprecated for this model").
const MODELS_WITHOUT_TEMPERATURE = [
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-fable-5',
  'claude-sonnet-5',
];

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
    // Only send temperature where the model supports it.
    if (
      options.temperature !== undefined &&
      !MODELS_WITHOUT_TEMPERATURE.some((m) => options.model.startsWith(m))
    ) {
      body.temperature = options.temperature;
    }

    const response = await fetchWithTimeout(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      timeout: 'slow', // 30 seconds for AI
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[Anthropic] API error: ${response.status} - ${errorBody}`);
      throw new Error(`Anthropic API error: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      model: string;
      content: Array<{ type: string; text?: string }>;
      stop_reason?: string | null;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

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
    };

    return { content, metadata };
  }
}
