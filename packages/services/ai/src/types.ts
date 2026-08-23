// ABOUTME: Common types and interfaces for AI clients.
// ABOUTME: Enables switching between providers with a common ChatClient interface.

import type { ReasoningEffort, Verbosity } from '@listentomore/config';

// Re-export types from config for consistency
export type { ReasoningEffort, Verbosity } from '@listentomore/config';

/**
 * Common message format for both providers
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Common options for chat completion
 */
export interface ChatCompletionOptions {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;

  // Provider-specific options (ignored if not supported)
  /** Reasoning effort for GPT-5 models (Responses API) */
  reasoning?: ReasoningEffort;
  /** Output verbosity for GPT-5 models (Responses API) */
  verbosity?: Verbosity;
  /** Enable web search tool (Responses API) */
  webSearch?: boolean;
}

/**
 * Metadata about the AI API response (from actual API response, not config).
 * Useful for debugging and verifying config changes actually take effect.
 */
export interface AIResponseMetadata {
  /** Provider that handled the request */
  provider: 'openai' | 'anthropic';
  /** Actual model used (from API response) */
  model: string;
  /** Which API was used */
  api: 'responses' | 'chat_completions' | 'messages';
  /** Token usage from API response */
  usage?: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    /**
     * Reasoning tokens included in outputTokens (GPT-5.x Responses API).
     * These are invisible in the response body but spend the same budget as
     * prose, so they are the usual explanation for an unexpected truncation.
     */
    reasoningTokens?: number | null;
  };
  /**
   * True when the model stopped because it ran out of output budget rather
   * than because it finished. The content is a fragment: do NOT cache it.
   *
   * Every provider signals this with a 200 OK and a field most callers never
   * read — OpenAI Responses `status: "incomplete"`, Chat Completions
   * `finish_reason: "length"`, Anthropic `stop_reason: "max_tokens"` — which
   * is why a truncated summary used to sit in KV for the full TTL.
   */
  truncated?: boolean;
  /** Features that were actually used in this request */
  features?: {
    /** Whether web search was performed (OpenAI Responses API) */
    webSearchUsed?: boolean;
    /** Reasoning effort level if reasoning was used */
    reasoning?: ReasoningEffort;
    /** Verbosity level if set */
    verbosity?: Verbosity;
  };
}

/**
 * Common response format
 */
export interface ChatCompletionResponse {
  content: string;
  /** Metadata about the API call (for debugging/testing) */
  metadata?: AIResponseMetadata;
}

/**
 * Common interface for AI clients
 */
export interface ChatClient {
  chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResponse>;
}
