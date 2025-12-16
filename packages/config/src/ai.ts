// AI configuration for model settings and cache TTLs
//
// NOTE: Actual prompts are defined in packages/services/ai/src/prompts/
// This file only contains model configuration (provider, model, tokens, temperature, cache TTL)

export const AI_PROVIDERS = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5-mini',
  },
  perplexity: {
    baseUrl: 'https://api.perplexity.ai',
    defaultModel: 'sonar',
  },
} as const;

export type AIProvider = keyof typeof AI_PROVIDERS;

/**
 * Reasoning effort levels for GPT-5 models (Responses API only)
 * - GPT-5.1: 'none' (default) | 'low' | 'medium' | 'high'
 * - GPT-5/gpt-5-mini: 'minimal' | 'low' | 'medium' (default) | 'high'
 */
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high';

/** Verbosity levels for GPT-5 models (Responses API only) */
export type Verbosity = 'low' | 'medium' | 'high';

/** Search context size for Perplexity web search (Perplexity only) */
export type SearchContextSize = 'low' | 'medium' | 'high';

export interface AITaskConfig {
  provider: AIProvider;
  model: string;
  maxTokens: number;
  temperature: number;
  cacheTtlDays: number;
  /** Enable web search for grounded responses (OpenAI Responses API only) */
  webSearch?: boolean;
  /** Reasoning effort for GPT-5.1 models (Responses API only) */
  reasoning?: ReasoningEffort;
  /** Output verbosity for GPT-5.1 models (Responses API only) */
  verbosity?: Verbosity;
  /** Search context size for web search (Perplexity only, default: 'low') */
  searchContextSize?: SearchContextSize;
}

/**
 * AI task configurations. To switch a task from Perplexity to OpenAI:
 *
 * 1. Change `provider` to 'openai'
 * 2. Change `model` to 'gpt-5-mini' or 'gpt-5.1' (or 'gpt-5-nano' for simple tasks)
 * 3. Optionally add GPT-5.1 features (OpenAI only, ignored by Perplexity):
 *    - `webSearch: true` - Enable web search for grounded responses with citations
 *    - `reasoning: 'low' | 'medium' | 'high'` - Enable chain-of-thought reasoning
 *    - `verbosity: 'low' | 'medium' | 'high'` - Control output length
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ MODEL CAPABILITIES & CONSTRAINTS                                            │
 * ├─────────────────┬───────────────────────────────────────────────────────────┤
 * │ Model           │ gpt-5.1              │ gpt-5-mini/nano      │ Perplexity  │
 * ├─────────────────┼──────────────────────┼──────────────────────┼─────────────┤
 * │ reasoning       │ none*, low,          │ minimal, low,        │ N/A         │
 * │                 │ medium, high         │ medium*, high        │             │
 * ├─────────────────┼──────────────────────┼──────────────────────┼─────────────┤
 * │ verbosity       │ low, medium, high    │ low, medium, high    │ N/A         │
 * ├─────────────────┼──────────────────────┼──────────────────────┼─────────────┤
 * │ webSearch       │ Yes                  │ Yes                  │ Always on   │
 * ├─────────────────┼──────────────────────┼──────────────────────┼─────────────┤
 * │ temperature     │ Only without         │ Only without         │ Yes         │
 * │                 │ reasoning            │ reasoning            │             │
 * └─────────────────┴──────────────────────┴──────────────────────┴─────────────┘
 * (* = default when not set)
 *
 * IMPORTANT CONSTRAINTS:
 * - webSearch requires reasoning: 'low' or higher (minimal/none don't support it)
 * - temperature is ignored when reasoning is set to any level
 * - GPT-5.x models only support temperature=1 regardless of what you set
 *
 * PERPLEXITY OPTIONS:
 * - searchContextSize: 'low' (default) | 'medium' | 'high'
 *   Controls how much search context is retrieved. Higher = more comprehensive but slower/costlier.
 *   Only applies to Perplexity tasks (ignored by OpenAI).
 *
 * Example switching artistSummary to OpenAI with web search:
 * ```
 * artistSummary: {
 *   provider: 'openai',
 *   model: 'gpt-5-mini',
 *   maxTokens: 1000,
 *   temperature: 0.5,
 *   cacheTtlDays: 180,
 *   webSearch: true,
 *   reasoning: 'low',  // Required for webSearch (minimal doesn't work)
 * },
 * ```
 */
export const AI_TASKS = {
  artistSummary: {
    provider: 'perplexity',
    model: 'sonar',
    maxTokens: 1500,
    temperature: 0.5,
    cacheTtlDays: 180,
  },

  albumDetail: {
    provider: 'perplexity',
    model: 'sonar',
    maxTokens: 1500,
    temperature: 0.5,
    cacheTtlDays: 120,
  },

  genreSummary: {
    provider: 'perplexity',
    model: 'sonar',
    maxTokens: 1500,
    temperature: 0.5,
    cacheTtlDays: 180,
  },

  //   genreSummary: {
  //   provider: 'openai',
  //   model: 'gpt-5-nano',
  //   maxTokens: 2000,
  //   temperature: 1,
  //   webSearch: true,
  //   reasoning: 'low',
  //   verbosity: 'low',
  //   cacheTtlDays: 180,
  // },

  artistSentence: {
    provider: 'perplexity',
    model: 'sonar',
    maxTokens: 150,
    temperature: 0.5,
    cacheTtlDays: 180,
  },

  randomFact: {
    provider: 'openai',
    model: 'gpt-5-mini',
    maxTokens: 10000,
    temperature: 1,
    cacheTtlDays: 0, // No caching - always fresh
  },

  playlistCoverPrompt: {
    provider: 'openai',
    model: 'gpt-5-nano',
    maxTokens: 10000,
    temperature: 1,
    cacheTtlDays: 0,
  },

  listenAi: {
    provider: 'openai',
    model: 'gpt-5.1',
    maxTokens: 500,
    temperature: 1,
    cacheTtlDays: 0,
    webSearch: false,
    verbosity: 'low',
  },

  albumRecommendations: {
    provider: 'perplexity',
    model: 'sonar',
    maxTokens: 1000,
    temperature: 0.5,
    cacheTtlDays: 30,
  },

  userInsightsSummary: {
    provider: 'openai',
    model: 'gpt-5.2',
    maxTokens: 1000,
    temperature: 1,
    cacheTtlDays: 1,
    reasoning: 'low',
    verbosity: 'low',
  },

  userInsightsRecommendations: {
    provider: 'openai',
    model: 'gpt-5.2',
    maxTokens: 4000, // Increased from 1500 to avoid timeout
    temperature: 1,
    cacheTtlDays: 1,
    reasoning: 'none',
    verbosity: 'low', // Changed from medium to low for faster response
  },
} as const satisfies Record<string, AITaskConfig>;

export type AITask = keyof typeof AI_TASKS;

export const IMAGE_GENERATION = {
  playlistCover: {
    provider: 'openai',
    model: 'gpt-image-1',
    size: '1024x1024' as const,
    quality: 'standard' as const,
  },
} as const;

export const RATE_LIMITS = {
  openai: {
    requestsPerMinute: 60,
    tokensPerMinute: 90000,
  },
  perplexity: {
    requestsPerMinute: 30,
  },
  spotify: {
    requestsPerMinute: 150, // (Spotify allows ~180)
    maxRetries: 2,
    retryDelayMs: 1000,
  },
} as const;

/**
 * Get task configuration by name
 */
export function getTaskConfig(task: AITask): AITaskConfig {
  return AI_TASKS[task];
}

/**
 * Calculate cache TTL in seconds from days
 */
export function getCacheTtlSeconds(task: AITask): number {
  return AI_TASKS[task].cacheTtlDays * 24 * 60 * 60;
}
