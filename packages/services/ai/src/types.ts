// ABOUTME: Common types and interfaces for AI clients.
// ABOUTME: Enables switching between providers with a common ChatClient interface.

import type { ReasoningEffort, Verbosity, SearchContextSize } from '@listentomore/config';

// Re-export types from config for consistency
export type { ReasoningEffort, Verbosity, SearchContextSize } from '@listentomore/config';

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
  /** Search context size for Perplexity web search (Perplexity only) */
  searchContextSize?: SearchContextSize;
}

/**
 * Metadata about the AI API response (from actual API response, not config).
 * Useful for debugging and verifying config changes actually take effect.
 */
export interface AIResponseMetadata {
  /** Provider that handled the request */
  provider: 'openai' | 'perplexity';
  /** Actual model used (from API response) */
  model: string;
  /** Which API was used (OpenAI has multiple) */
  api: 'responses' | 'chat_completions';
  /** Token usage from API response */
  usage?: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
  /** Features that were actually used in this request */
  features?: {
    /** Whether web search was performed (OpenAI Responses API) */
    webSearchUsed?: boolean;
    /** Reasoning effort level if reasoning was used */
    reasoning?: ReasoningEffort;
    /** Verbosity level if set */
    verbosity?: Verbosity;
    /** Whether citations were returned */
    citationsReturned?: boolean;
  };
}

/**
 * Common response format
 */
export interface ChatCompletionResponse {
  content: string;
  /** Source URLs from web search - empty array if none */
  citations: string[];
  /** Metadata about the API call (for debugging/testing) */
  metadata?: AIResponseMetadata;
}

/**
 * Common interface that both OpenAI and Perplexity clients implement
 */
export interface ChatClient {
  chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResponse>;
}
