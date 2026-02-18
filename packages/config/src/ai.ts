// AI configuration for model settings and cache TTLs
//
// NOTE: Actual prompts are defined in packages/services/ai/src/prompts/
// This file only contains model configuration (provider, model, tokens, temperature, cache TTL)

export const AI_PROVIDERS = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5-mini',
  },
} as const;

export type AIProvider = keyof typeof AI_PROVIDERS;

/**
 * Reasoning effort levels for GPT-5 models (Responses API only)
 * - GPT-5.2: 'none' (default) | 'low' | 'medium' | 'high' | 'xhigh'
 * - GPT-5.1: 'none' (default) | 'low' | 'medium' | 'high'
 * - GPT-5/gpt-5-mini: 'minimal' | 'low' | 'medium' (default) | 'high'
 */
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

/** Verbosity levels for GPT-5 models (Responses API only) */
export type Verbosity = 'low' | 'medium' | 'high';

export interface AITaskConfig {
  provider: AIProvider;
  model: string;
  maxTokens: number;
  temperature: number;
  cacheTtlDays: number;
  /** Enable web search for grounded responses (OpenAI Responses API only) */
  webSearch?: boolean;
  /** Reasoning effort for GPT-5 models (Responses API only) */
  reasoning?: ReasoningEffort;
  /** Output verbosity for GPT-5 models (Responses API only) */
  verbosity?: Verbosity;
}

/**
 * AI task configurations. All tasks use OpenAI models.
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ MODEL CAPABILITIES & CONSTRAINTS                                            │
 * ├─────────────────┬──────────────────────┬──────────────────────┤
 * │ Model           │ gpt-5.2              │ gpt-5-mini/nano      │
 * ├─────────────────┼──────────────────────┼──────────────────────┤
 * │ reasoning       │ none*, low,          │ minimal, low,        │
 * │                 │ medium, high, xhigh  │ medium*, high        │
 * ├─────────────────┼──────────────────────┼──────────────────────┤
 * │ verbosity       │ low, medium, high    │ low, medium, high    │
 * ├─────────────────┼──────────────────────┼──────────────────────┤
 * │ webSearch       │ Yes                  │ Yes                  │
 * ├─────────────────┼──────────────────────┼──────────────────────┤
 * │ temperature     │ Only without         │ Only without         │
 * │                 │ reasoning            │ reasoning            │
 * └─────────────────┴──────────────────────┴──────────────────────┘
 * (* = default when not set)
 *
 * IMPORTANT CONSTRAINTS:
 * - temperature is ignored when reasoning is set to any level
 * - GPT-5.x models only support temperature=1 regardless of what you set
 */
export const AI_TASKS = {
  artistSummary: {
    provider: 'openai',
    model: 'gpt-5-search-api',
    maxTokens: 1500,
    temperature: 1,
    cacheTtlDays: 180,
    webSearch: true,
  },

  albumDetail: {
    provider: 'openai',
    model: 'gpt-5-search-api',
    maxTokens: 1500,
    temperature: 1,
    cacheTtlDays: 120,
    webSearch: true,
  },

  genreSummary: {
    provider: 'openai',
    model: 'gpt-5-search-api',
    maxTokens: 1500,
    temperature: 1,
    cacheTtlDays: 180,
    webSearch: true,
  },

  artistSentence: {
    provider: 'openai',
    model: 'gpt-5-search-api',
    maxTokens: 150,
    temperature: 1,
    cacheTtlDays: 180,
    webSearch: true,
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
    provider: 'openai',
    model: 'gpt-5-search-api',
    maxTokens: 1000,
    temperature: 1,
    cacheTtlDays: 30,
    webSearch: true,
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
    requestsPerMinute: 90,
    tokensPerMinute: 90000,
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
