// ABOUTME: Perplexity API client for web-grounded AI responses.
// ABOUTME: Includes rate limiting and citation extraction from web search.

import { AI_PROVIDERS, RATE_LIMITS } from '@listentomore/config';
import { fetchWithTimeout } from '@listentomore/shared';
import type { ChatClient, ChatMessage } from './types';

// Re-export for backwards compatibility
export type { ChatMessage } from './types';

export interface ChatCompletionOptions {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Request citations from Perplexity */
  returnCitations?: boolean;
}

export interface ChatCompletionResponse {
  content: string;
  /** Source URLs from Perplexity's web search */
  citations: string[];
}

/** Rate limit window tracking */
interface RateLimitWindow {
  requestCount: number;
  windowStart: number;
}

export class PerplexityClient implements ChatClient {
  private apiKey: string;
  private baseUrl: string;
  private rateLimitWindow: RateLimitWindow = {
    requestCount: 0,
    windowStart: Date.now(),
  };

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.baseUrl = AI_PROVIDERS.perplexity.baseUrl;
  }

  /**
   * Check and update rate limiting
   */
  private async checkRateLimit(): Promise<void> {
    const now = Date.now();
    const windowMs = 60000; // 1 minute window

    // Reset window if expired
    if (now - this.rateLimitWindow.windowStart >= windowMs) {
      this.rateLimitWindow = { requestCount: 0, windowStart: now };
    }

    // Check if we're over the limit
    if (
      this.rateLimitWindow.requestCount >=
      RATE_LIMITS.perplexity.requestsPerMinute
    ) {
      const waitMs = windowMs - (now - this.rateLimitWindow.windowStart);
      console.log(`[Perplexity] Rate limited, waiting ${waitMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      this.rateLimitWindow = { requestCount: 0, windowStart: Date.now() };
    }

    this.rateLimitWindow.requestCount++;
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
      choices: Array<{ message: { content: string } }>;
      citations?: string[];
    };

    let content = data.choices[0].message.content;

    // When citations are requested, keep markers like [1], [2] in the content
    // They will be transformed to superscript links client-side
    // The citations array provides the source URLs
    //
    // When citations are NOT requested, strip any citation markers
    // since they would be orphaned without corresponding URLs
    if (options.returnCitations === false) {
      content = content.replace(/\s*\[\d+\]/g, '');
    }

    return {
      content,
      citations: options.returnCitations === false ? [] : (data.citations ?? []),
    };
  }
}
