// ABOUTME: Perplexity API client for web-grounded AI responses.
// ABOUTME: Includes distributed rate limiting and citation extraction from web search.

import { AI_PROVIDERS } from '@listentomore/config';
import type { SearchContextSize } from '@listentomore/config';
import { fetchWithTimeout } from '@listentomore/shared';
import type { ChatClient, ChatMessage, AIResponseMetadata } from './types';
import type { AIRateLimiter } from './rate-limit';

// Re-export for backwards compatibility
export type { ChatMessage } from './types';

export interface ChatCompletionOptions {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Request citations from Perplexity */
  returnCitations?: boolean;
  /** Search context size for web search (low, medium, high) */
  searchContextSize?: SearchContextSize;
}

export interface ChatCompletionResponse {
  content: string;
  /** Source URLs from Perplexity's web search */
  citations: string[];
  /** Metadata about the API call (for debugging/testing) */
  metadata?: AIResponseMetadata;
}

export class PerplexityClient implements ChatClient {
  private apiKey: string;
  private baseUrl: string;
  private rateLimiter: AIRateLimiter | null = null;

  constructor(apiKey: string, rateLimiter?: AIRateLimiter) {
    this.apiKey = apiKey;
    this.baseUrl = AI_PROVIDERS.perplexity.baseUrl;
    this.rateLimiter = rateLimiter ?? null;
  }

  /**
   * Set the rate limiter (for dependency injection after construction)
   */
  setRateLimiter(rateLimiter: AIRateLimiter): void {
    this.rateLimiter = rateLimiter;
  }

  /**
   * Check and update rate limiting using distributed KV-based limiter
   */
  private async checkRateLimit(): Promise<void> {
    if (this.rateLimiter) {
      await this.rateLimiter.acquire();
    }
    // If no rate limiter configured, proceed without rate limiting
    // (backwards compatibility for tests or direct usage)
  }

  /**
   * Send a chat completion request
   */
  async chatCompletion(
    options: ChatCompletionOptions
  ): Promise<ChatCompletionResponse> {
    await this.checkRateLimit();

    const response = await fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        max_tokens: options.maxTokens ?? 1000,
        temperature: options.temperature ?? 0.5,
        return_citations: options.returnCitations ?? true,
        // Only include web_search_options if searchContextSize is explicitly set
        ...(options.searchContextSize && {
          web_search_options: {
            search_context_size: options.searchContextSize,
          },
        }),
      }),
      timeout: 'slow', // 30 seconds for AI
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(
        `[Perplexity] API error: ${response.status} - ${errorBody}`
      );
      // Include status code in error for better debugging
      throw new Error(`Perplexity API error ${response.status}: ${response.statusText} - ${errorBody.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      model: string;
      choices: Array<{ message: { content: string } }>;
      citations?: string[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    let content = data.choices[0].message.content;
    const citations = options.returnCitations === false ? [] : (data.citations ?? []);

    // When citations are requested, keep markers like [1], [2] in the content
    // They will be transformed to superscript links client-side
    // The citations array provides the source URLs
    //
    // When citations are NOT requested, strip any citation markers
    // since they would be orphaned without corresponding URLs
    if (options.returnCitations === false) {
      content = content.replace(/\s*\[\d+\]/g, '');
    }

    // Build metadata from actual API response
    const metadata: AIResponseMetadata = {
      provider: 'perplexity',
      model: data.model,
      api: 'chat_completions',
      usage: data.usage
        ? {
            inputTokens: data.usage.prompt_tokens ?? null,
            outputTokens: data.usage.completion_tokens ?? null,
            totalTokens: data.usage.total_tokens ?? null,
          }
        : undefined,
      features: {
        citationsReturned: citations.length > 0,
      },
    };

    return {
      content,
      citations,
      metadata,
    };
  }
}
