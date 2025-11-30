// OpenAI API client for text and image generation

import { AI_PROVIDERS, RATE_LIMITS } from '@listentomore/config';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionOptions {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface ChatCompletionResponse {
  content: string;
  /** URL citations from web search-enabled models */
  citations?: string[];
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

export class OpenAIClient {
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
   * Send a chat completion request
   */
  async chatCompletion(
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

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[OpenAI] API error: ${response.status} - ${errorBody}`);
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      choices: Array<{
        message: {
          content: string;
          annotations?: Array<{
            type: string;
            url_citation?: { url: string };
          }>;
        };
      }>;
    };

    const message = data.choices[0].message;
    let content = message.content;
    let citations: string[] | undefined;

    // Handle annotations/citations from web search models
    if (message.annotations) {
      const urlAnnotations = message.annotations.filter(
        (a) => a.type === 'url_citation' && a.url_citation
      );

      if (urlAnnotations.length > 0) {
        const citationMap = new Map<string, number>();
        const citationsArray: string[] = [];
        let counter = 1;

        // Build citation map
        for (const annotation of urlAnnotations) {
          const url = annotation.url_citation!.url;
          if (!citationMap.has(url)) {
            citationMap.set(url, counter++);
            citationsArray.push(url);
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

        citations = citationsArray;
      }
    }

    return { content, citations };
  }

  /**
   * Generate an image using DALL-E
   */
  async generateImage(
    options: ImageGenerationOptions
  ): Promise<ImageGenerationResponse> {
    await this.checkRateLimit();

    const response = await fetch(`${this.baseUrl}/images/generations`, {
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
