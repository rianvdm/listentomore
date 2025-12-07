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
  /** Request citations from Perplexity or web search models */
  returnCitations?: boolean;
  /** Reasoning effort for GPT-5.1 (Responses API) */
  reasoning?: ReasoningEffort;
  /** Output verbosity for GPT-5.1 (Responses API) */
  verbosity?: Verbosity;
  /** Enable web search tool (Responses API) */
  webSearch?: boolean;
}

/**
 * Common response format
 */
export interface ChatCompletionResponse {
  content: string;
  /** Source URLs from web search - empty array if none */
  citations: string[];
}

/**
 * Common interface that both OpenAI and Perplexity clients implement
 */
export interface ChatClient {
  chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResponse>;
}
