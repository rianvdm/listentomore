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

export interface AITaskConfig {
  provider: AIProvider;
  model: string;
  maxTokens: number;
  temperature: number;
  cacheTtlDays: number;
}

export const AI_TASKS = {
  artistSummary: {
    provider: 'perplexity',
    model: 'sonar',
    maxTokens: 1000,
    temperature: 0.5,
    cacheTtlDays: 180,
  },

  albumDetail: {
    provider: 'perplexity',
    model: 'sonar',
    maxTokens: 1000,
    temperature: 0.5,
    cacheTtlDays: 120,
  },

  genreSummary: {
    provider: 'perplexity',
    model: 'sonar',
    maxTokens: 1000,
    temperature: 0.5,
    cacheTtlDays: 180,
  },

  artistSentence: {
    provider: 'perplexity',
    model: 'sonar',
    maxTokens: 100,
    temperature: 0.5,
    cacheTtlDays: 180,
  },

  randomFact: {
    provider: 'openai',
    model: 'gpt-5-mini',
    maxTokens: 10000,
    temperature: 1, // gpt-5-mini only supports temperature=1
    cacheTtlDays: 0, // No caching - always fresh
  },

  playlistCoverPrompt: {
    provider: 'openai',
    model: 'gpt-5-nano',
    maxTokens: 10000,
    temperature: 1, // gpt-5-nano only supports temperature=1
    cacheTtlDays: 0,
  },

  listenAi: {
    provider: 'openai',
    model: 'gpt-5-mini',
    maxTokens: 10000,
    temperature: 1, // gpt-5-mini only supports temperature=1
    cacheTtlDays: 0,
  },

  albumRecommendations: {
    provider: 'perplexity',
    model: 'sonar',
    maxTokens: 1000,
    temperature: 0.5,
    cacheTtlDays: 30,
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
