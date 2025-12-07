// ABOUTME: OpenAI API client for text and image generation.
// ABOUTME: Supports both Chat Completions API and Responses API (for GPT-5.x).
// ABOUTME: Includes rate limiting and citation handling for web search models.

import { AI_PROVIDERS, RATE_LIMITS } from '@listentomore/config';
import { fetchWithTimeout } from '@listentomore/shared';
import type {
  ChatClient,
  ChatMessage,
  ReasoningEffort,
  Verbosity,
  AIResponseMetadata,
} from './types';

// Re-export for backwards compatibility
export type { ChatMessage } from './types';

export interface ChatCompletionOptions {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  // GPT-5.1 specific options (Responses API)
  reasoning?: ReasoningEffort;
  verbosity?: Verbosity;
  webSearch?: boolean;
}

export interface ChatCompletionResponse {
  content: string;
  /** URL citations from web search-enabled models - empty array if none */
  citations: string[];
  /** Metadata about the API call (for debugging/testing) */
  metadata?: AIResponseMetadata;
}

/**
 * Options for the Responses API (GPT-5.x models)
 */
export interface ResponsesOptions {
  model: string;
  /** User input - can be string or messages array */
  input: string | Array<{ role: string; content: string }>;
  /** System-level instructions (replaces system message) */
  instructions?: string;
  reasoning?: { effort: ReasoningEffort };
  text?: { verbosity: Verbosity };
  tools?: Array<{ type: 'web_search' }>;
  maxOutputTokens?: number;
  temperature?: number;
  /** Disable storage for ZDR compliance - defaults to false for privacy */
  store?: boolean;
}

/**
 * Result from the Responses API
 */
export interface ResponsesResult {
  content: string;
  citations: string[];
  metadata?: AIResponseMetadata;
}

export interface ImageGenerationOptions {
  prompt: string;
  model?: string;
  size?: '1024x1024' | '1792x1024' | '1024x1792';
  quality?: 'standard' | 'high';
}

export interface ImageGenerationResponse {
  /** Base64-encoded image data or URL */
  data: string;
  /** True if data is a data URL, false if it's a regular URL */
  isDataUrl: boolean;
}

/** Rate limit window tracking */
interface RateLimitWindow {
  requestCount: number;
  windowStart: number;
}

export class OpenAIClient implements ChatClient {
  private apiKey: string;
  private baseUrl: string;
  private rateLimitWindow: RateLimitWindow = {
    requestCount: 0,
    windowStart: Date.now(),
  };

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.baseUrl = AI_PROVIDERS.openai.baseUrl;
  }

  /**
   * Determine if the Responses API should be used for this request.
   * Use Responses API for:
   * 1. GPT-5.x models (better performance, CoT support)
   * 2. Requests with Responses-specific features (webSearch, reasoning, verbosity)
   */
  private shouldUseResponsesApi(
    model: string,
    options: ChatCompletionOptions
  ): boolean {
    const isGpt5 = model.startsWith('gpt-5');
    const hasResponsesFeatures = Boolean(
      options.webSearch || options.reasoning || options.verbosity
    );

    return isGpt5 || hasResponsesFeatures;
  }

  /**
   * Convert messages array to Responses API format.
   * Separates system prompt (instructions) from other messages (input).
   */
  private convertMessagesToResponsesFormat(messages: ChatMessage[]): {
    instructions?: string;
    input: string | Array<{ role: string; content: string }>;
  } {
    const systemMsg = messages.find((m) => m.role === 'system');
    const otherMessages = messages.filter((m) => m.role !== 'system');

    // If only one user message, use simple string input for cleaner API
    if (otherMessages.length === 1 && otherMessages[0].role === 'user') {
      return {
        instructions: systemMsg?.content,
        input: otherMessages[0].content,
      };
    }

    // For multi-turn, pass messages array (Responses API accepts both)
    return {
      instructions: systemMsg?.content,
      input: otherMessages,
    };
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
      this.rateLimitWindow.requestCount >= RATE_LIMITS.openai.requestsPerMinute
    ) {
      const waitMs = windowMs - (now - this.rateLimitWindow.windowStart);
      console.log(`[OpenAI] Rate limited, waiting ${waitMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      this.rateLimitWindow = { requestCount: 0, windowStart: Date.now() };
    }

    this.rateLimitWindow.requestCount++;
  }

  /**
   * Send a chat completion request.
   * Automatically routes to Responses API for GPT-5.x models or when
   * Responses-specific features (webSearch, reasoning, verbosity) are requested.
   */
  async chatCompletion(
    options: ChatCompletionOptions
  ): Promise<ChatCompletionResponse> {
    // Route to appropriate API based on model and options
    if (this.shouldUseResponsesApi(options.model, options)) {
      return this.chatCompletionViaResponses(options);
    }
    return this.chatCompletionViaChatCompletions(options);
  }

  /**
   * Send a request via the Responses API (GPT-5.x)
   * Provides better performance, CoT support, and web search capabilities.
   */
  private async chatCompletionViaResponses(
    options: ChatCompletionOptions
  ): Promise<ChatCompletionResponse> {
    const { instructions, input } = this.convertMessagesToResponsesFormat(
      options.messages
    );

    const result = await this.responses({
      model: options.model,
      input,
      instructions,
      reasoning: options.reasoning ? { effort: options.reasoning } : undefined,
      text: options.verbosity ? { verbosity: options.verbosity } : undefined,
      tools: options.webSearch ? [{ type: 'web_search' }] : undefined,
      maxOutputTokens: options.maxTokens,
      temperature: options.temperature,
    });

    return {
      content: result.content,
      citations: result.citations,
      metadata: result.metadata,
    };
  }

  /**
   * Send a request via the Chat Completions API (legacy)
   * Used for non-GPT-5.x models or when Responses features aren't needed.
   */
  private async chatCompletionViaChatCompletions(
    options: ChatCompletionOptions
  ): Promise<ChatCompletionResponse> {
    await this.checkRateLimit();

    // Build request body - only include temperature if explicitly set and != 1
    // (gpt-5-mini and some models only support temperature=1)
    const requestBody: Record<string, unknown> = {
      model: options.model,
      messages: options.messages,
      max_completion_tokens: options.maxTokens ?? 10000,
    };

    // Only add temperature if explicitly provided and not the default
    if (options.temperature !== undefined && options.temperature !== 1) {
      requestBody.temperature = options.temperature;
    }

    const response = await fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      timeout: 'slow', // 30 seconds for AI
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[OpenAI] API error: ${response.status} - ${errorBody}`);
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      model: string;
      choices: Array<{
        message: {
          content: string;
          annotations?: Array<{
            type: string;
            url_citation?: { url: string };
          }>;
        };
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    const message = data.choices[0].message;
    let content = message.content;
    const citations: string[] = [];

    // Handle annotations/citations from web search models
    if (message.annotations) {
      const urlAnnotations = message.annotations.filter(
        (a) => a.type === 'url_citation' && a.url_citation
      );

      if (urlAnnotations.length > 0) {
        const citationMap = new Map<string, number>();
        let counter = 1;

        // Build citation map
        for (const annotation of urlAnnotations) {
          const url = annotation.url_citation!.url;
          if (!citationMap.has(url)) {
            citationMap.set(url, counter++);
            citations.push(url);
          }
        }

        // Replace markdown links with numbered citations
        content = content.replace(
          /\(?\[([^\]]+)\]\(([^)]+)\)\)?/g,
          (match, _text, url) => {
            const num = citationMap.get(url);
            return num ? `[${num}]` : match;
          }
        );
      }
    }

    // Build metadata from actual API response
    const metadata: AIResponseMetadata = {
      provider: 'openai',
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

    return { content, citations, metadata };
  }

  /**
   * Send a request to the Responses API (POST /v1/responses)
   * The newer API recommended for GPT-5.x models with:
   * - Web search support
   * - Reasoning effort control
   * - Verbosity control
   * - Better caching and performance
   */
  async responses(options: ResponsesOptions): Promise<ResponsesResult> {
    await this.checkRateLimit();

    const body: Record<string, unknown> = {
      model: options.model,
      input: options.input,
      store: options.store ?? false, // Default to not storing for privacy
    };

    // System instructions (cleaner than system message in array)
    if (options.instructions) {
      body.instructions = options.instructions;
    }

    // Add reasoning if specified (GPT-5.1 feature)
    if (options.reasoning) {
      body.reasoning = options.reasoning;
    }

    // Add verbosity if specified (GPT-5.1 feature)
    if (options.text) {
      body.text = options.text;
    }

    // Add tools (web_search, etc.)
    if (options.tools?.length) {
      body.tools = options.tools;
    }

    // Temperature only works with reasoning.effort: 'none'
    // For other reasoning levels, the model controls temperature internally
    if (
      options.temperature !== undefined &&
      (!options.reasoning || options.reasoning.effort === 'none')
    ) {
      body.temperature = options.temperature;
    }

    if (options.maxOutputTokens) {
      body.max_output_tokens = options.maxOutputTokens;
    }

    const response = await fetchWithTimeout(`${this.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      timeout: 'slow', // 30 seconds for AI
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(
        `[OpenAI Responses] API error: ${response.status} - ${errorBody}`
      );
      throw new Error(`OpenAI Responses API error: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      model: string;
      output_text?: string;
      output?: Array<{
        type: string;
        content?: Array<{
          type: string;
          text?: string;
          annotations?: Array<{
            type: string;
            url?: string;
            title?: string;
          }>;
        }>;
      }>;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
      };
    };

    return this.parseResponsesResult(data, options);
  }

  /**
   * Parse the Responses API result into our common format.
   * Extracts content from output_text helper or output[].content[].text,
   * and citations from annotations. Also extracts metadata from the response.
   */
  private parseResponsesResult(
    data: {
      model: string;
      output_text?: string | null;
      output?: Array<{
        type: string;
        content?: Array<{
          type: string;
          text?: string;
          annotations?: Array<{
            type: string;
            url?: string;
            title?: string;
          }>;
        }>;
      }>;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
      };
    },
    options: ResponsesOptions
  ): ResponsesResult {
    const result: ResponsesResult = {
      content: '',
      citations: [],
    };

    // Try to get content from output_text helper first
    if (data.output_text) {
      result.content = data.output_text;
    }

    // Track if web search was actually performed
    let webSearchUsed = false;

    // Extract content and citations from output array
    if (data.output) {
      const seenUrls = new Set<string>();

      for (const item of data.output) {
        // Check if web search tool was called
        if (item.type === 'web_search_call') {
          webSearchUsed = true;
        }

        if (item.type === 'message' && item.content) {
          for (const block of item.content) {
            // Extract text content if output_text wasn't available
            if (!result.content && block.type === 'output_text' && block.text) {
              result.content = block.text;
            }

            // Extract citations from annotations
            if (block.annotations) {
              for (const annotation of block.annotations) {
                if (annotation.type === 'url_citation' && annotation.url) {
                  // Deduplicate citations
                  if (!seenUrls.has(annotation.url)) {
                    seenUrls.add(annotation.url);
                    result.citations.push(annotation.url);
                  }
                }
              }
            }
          }
        }
      }
    }

    // Build metadata from actual API response
    result.metadata = {
      provider: 'openai',
      model: data.model,
      api: 'responses',
      usage: data.usage
        ? {
            inputTokens: data.usage.input_tokens ?? null,
            outputTokens: data.usage.output_tokens ?? null,
            totalTokens: data.usage.total_tokens ?? null,
          }
        : undefined,
      features: {
        webSearchUsed,
        reasoning: options.reasoning?.effort,
        verbosity: options.text?.verbosity,
        citationsReturned: result.citations.length > 0,
      },
    };

    return result;
  }

  /**
   * Generate an image using DALL-E
   */
  async generateImage(
    options: ImageGenerationOptions
  ): Promise<ImageGenerationResponse> {
    await this.checkRateLimit();

    const response = await fetchWithTimeout(`${this.baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model ?? 'gpt-image-1',
        prompt: options.prompt,
        n: 1,
        size: options.size ?? '1024x1024',
        quality: options.quality ?? 'high',
        moderation: 'auto',
        output_format: 'png',
      }),
      timeout: 'verySlow', // 60 seconds for image generation
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[OpenAI] Image API error: ${response.status} - ${errorBody}`);
      throw new Error(`OpenAI Image API error: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      data: Array<{ b64_json?: string; url?: string }>;
    };

    const imageData = data.data[0];

    if (imageData.b64_json) {
      return {
        data: `data:image/png;base64,${imageData.b64_json}`,
        isDataUrl: true,
      };
    } else if (imageData.url) {
      return {
        data: imageData.url,
        isDataUrl: false,
      };
    }

    throw new Error('Unexpected response format from OpenAI Image API');
  }
}
