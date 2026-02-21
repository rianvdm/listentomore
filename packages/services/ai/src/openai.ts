// ABOUTME: OpenAI API client for text and image generation.
// ABOUTME: Supports both Chat Completions API and Responses API (for GPT-5.x).
// ABOUTME: Includes distributed rate limiting and citation handling for web search models.

import { AI_PROVIDERS } from '@listentomore/config';
import { fetchWithTimeout } from '@listentomore/shared';
import type {
  ChatClient,
  ChatMessage,
  ReasoningEffort,
  Verbosity,
  AIResponseMetadata,
} from './types';
import type { AIRateLimiter } from './rate-limit';

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

export class OpenAIClient implements ChatClient {
  private apiKey: string;
  private baseUrl: string;
  private rateLimiter: AIRateLimiter | null = null;

  constructor(apiKey: string, rateLimiter?: AIRateLimiter) {
    this.apiKey = apiKey;
    this.baseUrl = AI_PROVIDERS.openai.baseUrl;
    this.rateLimiter = rateLimiter ?? null;
  }

  /**
   * Set the rate limiter (for dependency injection after construction)
   */
  setRateLimiter(rateLimiter: AIRateLimiter): void {
    this.rateLimiter = rateLimiter;
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
    // gpt-5-search-api uses Chat Completions with web_search_options
    if (model === 'gpt-5-search-api') return false;

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

    // Add web_search_options for search models (gpt-5-search-api, etc.)
    if (options.webSearch) {
      requestBody.web_search_options = {};
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
            // Chat Completions format (nested)
            url_citation?: { url: string; title?: string; start_index?: number; end_index?: number };
            // Some models return url directly (flat format)
            url?: string;
            title?: string;
            start_index?: number;
            end_index?: number;
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

    // Step 1: Extract citation URLs from annotations (most reliable for gpt-5-search-api).
    // gpt-5-search-api puts [N] markers in content with URLs only in annotations.
    if (message.annotations) {
      const urlAnnotations = message.annotations.filter(
        (a) => a.type === 'url_citation'
      );
      const seenUrls = new Set<string>();
      for (const annotation of urlAnnotations) {
        // Handle both nested (url_citation.url) and flat (annotation.url) formats
        const url = annotation.url_citation?.url || annotation.url;
        if (url && !seenUrls.has(url)) {
          seenUrls.add(url);
          citations.push(url);
        }
      }

      // Debug: log when annotations exist but yield no citations
      if (citations.length === 0 && urlAnnotations.length > 0) {
        console.error('[OpenAI] url_citation annotations found but no URLs extracted. Raw annotations:', JSON.stringify(urlAnnotations.slice(0, 3)));
      }
    }

    // Step 2: If annotations yielded citations, ensure content has [N] markers
    // (gpt-5-search-api already includes them, but normalize just in case)
    if (citations.length > 0 && content) {
      // Replace any markdown citation links with [N] markers
      const citationMap = new Map<string, number>();
      citations.forEach((url, i) => citationMap.set(url, i + 1));

      content = content.replace(
        /\(?\[([^\]]+)\]\((https?:\/\/[^)]+)\)\)?/g,
        (_match, _text, url) => {
          const num = citationMap.get(url);
          return num ? `[${num}]` : _match;
        }
      );

      // Deduplicate adjacent identical [N] markers (e.g., "text [1][1]" → "text [1]")
      content = content.replace(/\[(\d+)\]\s*\[\1\]/g, '[$1]');
    }

    // Step 3: Fallback — if no annotations, extract from markdown links in content.
    // Older models may embed citations as [source](url) directly in text.
    if (citations.length === 0 && content) {
      const linkRegex = /\(?\[([^\]]+)\]\((https?:\/\/[^)]+)\)\)?/g;
      const seenUrls = new Set<string>();
      let linkMatch;

      while ((linkMatch = linkRegex.exec(content)) !== null) {
        const url = linkMatch[2];
        if (!seenUrls.has(url)) {
          seenUrls.add(url);
          citations.push(url);
        }
      }

      if (citations.length > 0) {
        const citationMap = new Map<string, number>();
        citations.forEach((url, i) => citationMap.set(url, i + 1));

        content = content.replace(
          /\(?\[([^\]]+)\]\((https?:\/\/[^)]+)\)\)?/g,
          (_match, _text, url) => {
            const num = citationMap.get(url);
            return num ? `[${num}]` : _match;
          }
        );

        // Strip pre-existing [N] markers that the model added alongside markdown links
        content = content.replace(/\[(\d+)\](?!\()/g, (_match, num) => {
          const n = parseInt(num, 10);
          return n >= 1 && n <= citations.length ? `[${n}]` : '';
        });
        content = content.replace(/\[(\d+)\]\s*\[\1\]/g, '[$1]');
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

    // Temperature only works when reasoning is not enabled
    // When reasoning is set to any level, the model controls temperature internally
    if (options.temperature !== undefined && !options.reasoning) {
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
    // Collect annotation URLs as fallback
    const annotationUrls: string[] = [];

    // Extract content and annotation URLs from output array
    if (data.output) {
      const seenUrls = new Set<string>();

      for (const item of data.output) {
        if (item.type === 'web_search_call') {
          webSearchUsed = true;
        }

        if (item.type === 'message' && item.content) {
          for (const block of item.content) {
            if (!result.content && block.type === 'output_text' && block.text) {
              result.content = block.text;
            }

            if (block.annotations) {
              for (const annotation of block.annotations) {
                if (annotation.type === 'url_citation' && annotation.url) {
                  if (!seenUrls.has(annotation.url)) {
                    seenUrls.add(annotation.url);
                    annotationUrls.push(annotation.url);
                  }
                }
              }
            }
          }
        }
      }
    }

    // Step 1: Use annotation URLs as primary citation source
    // Annotations are the most reliable source for both Responses API and search models
    if (annotationUrls.length > 0) {
      result.citations = annotationUrls;
    }

    // Step 2: If annotations yielded citations, normalize content markers
    if (result.citations.length > 0 && result.content) {
      const citationMap = new Map<string, number>();
      result.citations.forEach((url, i) => citationMap.set(url, i + 1));

      result.content = result.content.replace(
        /\(?\[([^\]]+)\]\((https?:\/\/[^)]+)\)\)?/g,
        (_match, _text, url) => {
          const num = citationMap.get(url);
          return num ? `[${num}]` : _match;
        }
      );

      result.content = result.content.replace(/\[(\d+)\]\s*\[\1\]/g, '[$1]');
    }

    // Step 3: Fallback — if no annotation URLs, extract from markdown links in content
    if (result.citations.length === 0 && result.content) {
      const linkRegex = /\(?\[([^\]]+)\]\((https?:\/\/[^)]+)\)\)?/g;
      const seenUrls = new Set<string>();
      let linkMatch;

      while ((linkMatch = linkRegex.exec(result.content)) !== null) {
        const url = linkMatch[2];
        if (!seenUrls.has(url)) {
          seenUrls.add(url);
          result.citations.push(url);
        }
      }

      if (result.citations.length > 0) {
        const citationMap = new Map<string, number>();
        result.citations.forEach((url, i) => citationMap.set(url, i + 1));

        result.content = result.content.replace(
          /\(?\[([^\]]+)\]\((https?:\/\/[^)]+)\)\)?/g,
          (_match, _text, url) => {
            const num = citationMap.get(url);
            return num ? `[${num}]` : _match;
          }
        );

        // Strip pre-existing [N] markers that conflict with our numbering
        result.content = result.content.replace(/\[(\d+)\](?!\()/g, (_match, num) => {
          const n = parseInt(num, 10);
          return n >= 1 && n <= result.citations.length ? `[${n}]` : '';
        });
        result.content = result.content.replace(/\[(\d+)\]\s*\[\1\]/g, '[$1]');
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
