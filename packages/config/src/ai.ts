// AI configuration for model settings and cache TTLs
//
// NOTE: Actual prompts are defined in packages/services/ai/src/prompts/
// This file only contains model configuration (provider, model, tokens, temperature, cache TTL)

export const AI_PROVIDERS = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5-mini',
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-5',
  },
} as const;

export type AIProvider = keyof typeof AI_PROVIDERS;

/**
 * Reasoning effort levels for GPT-5 models (Responses API only)
 * - GPT-5.6 (sol/terra/luna): 'none' | 'low' | 'medium' (default) | 'high' | 'xhigh' | 'max'
 * - GPT-5.4: 'none' (default) | 'low' | 'medium' | 'high' | 'xhigh'
 * - GPT-5/gpt-5-mini: 'minimal' | 'low' | 'medium' (default) | 'high'
 */
export type ReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';

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
 * AI task configurations. OpenAI for everything except userInsightsSummary,
 * which runs on Anthropic.
 *
 * OpenAI tasks run on gpt-5.6-terra, except randomFact (gpt-5.6-luna — uncached,
 * so the cheap tier earns its keep) and playlistCoverPrompt (still on the older
 * gpt-5-nano). GPT-5.6 ships as three fixed tiers rather than one model with
 * capability dials; luna is a drop-in swap for any task here if cost bites:
 *
 * ┌─────────────────┬──────────────────────┬──────────────────────┐
 * │ Tier            │ gpt-5.6-terra        │ gpt-5.6-luna         │
 * ├─────────────────┼──────────────────────┼──────────────────────┤
 * │ Positioning     │ balanced default     │ fast / high-volume   │
 * ├─────────────────┼──────────────────────┼──────────────────────┤
 * │ $/1M in/out     │ $2.00 / $12.00       │ $0.20 / $1.20        │
 * ├─────────────────┼──────────────────────┼──────────────────────┤
 * │ reasoning       │ none, low, medium*,  │ none, low, medium*,  │
 * │                 │ high, xhigh, max     │ high, xhigh, max     │
 * ├─────────────────┼──────────────────────┼──────────────────────┤
 * │ verbosity       │ low, medium, high    │ low, medium, high    │
 * ├─────────────────┼──────────────────────┼──────────────────────┤
 * │ webSearch       │ Yes                  │ Yes                  │
 * ├─────────────────┼──────────────────────┼──────────────────────┤
 * │ temperature     │ Only without         │ Only without         │
 * │                 │ reasoning            │ reasoning            │
 * └─────────────────┴──────────────────────┴──────────────────────┘
 * (* = default when not set. gpt-5.6-sol is the flagship tier at $5/$30 —
 *  nothing here needs it.)
 *
 * IMPORTANT CONSTRAINTS:
 * - temperature is ignored when reasoning is set to any level
 * - GPT-5.x models only support temperature=1 regardless of what you set
 * - Both 5.6 tiers default to medium reasoning effort, so even a short
 *   generation spends ~75-100 reasoning tokens. Set reasoning: 'none' on a
 *   task if you want to buy that latency back.
 */
export const AI_TASKS = {
  artistSummary: {
    provider: 'openai',
    model: 'gpt-5.6-terra',
    maxTokens: 1500,
    temperature: 1,
    cacheTtlDays: 180,
    webSearch: false,
  },

  albumDetail: {
    provider: 'openai',
    model: 'gpt-5.6-terra',
    maxTokens: 1500,
    temperature: 1,
    cacheTtlDays: 120,
    webSearch: true,
  },

  genreSummary: {
    provider: 'openai',
    model: 'gpt-5.6-terra',
    maxTokens: 1500,
    temperature: 1,
    cacheTtlDays: 180,
    webSearch: false,
  },

  artistSentence: {
    provider: 'openai',
    model: 'gpt-5.6-terra',
    maxTokens: 150,
    temperature: 1,
    cacheTtlDays: 180,
    webSearch: true,
  },

  randomFact: {
    provider: 'openai',
    // luna, not terra: this task is uncached, so every call hits the API, and
    // Terra's rate is ~8x input / 6x output for one line of music trivia.
    model: 'gpt-5.6-luna',
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
    model: 'gpt-5.6-terra',
    maxTokens: 500,
    temperature: 1,
    cacheTtlDays: 0,
    webSearch: false,
    verbosity: 'low',
  },

  albumRecommendations: {
    provider: 'openai',
    model: 'gpt-5.6-terra',
    maxTokens: 1000,
    temperature: 1,
    cacheTtlDays: 30,
    webSearch: true,
  },

  userInsightsSummary: {
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    // 5000 gives headroom for Sonnet 5's on-demand adaptive thinking (thinking
    // tokens count against max_tokens, display-omitted so invisible) plus the
    // 2-3 paragraph output. Only tokens actually generated are billed.
    maxTokens: 5000,
    // temperature is inert on claude-sonnet-5 (rejected with a 400; the
    // AnthropicClient omits it for this model) — kept only to satisfy the
    // AITaskConfig shape. Warmth comes from the persona + few-shot examples.
    temperature: 0.8,
    cacheTtlDays: 1,
  },

  userInsightsRecommendations: {
    provider: 'openai',
    model: 'gpt-5.6-terra',
    maxTokens: 4000, // Increased from 1500 to avoid timeout
    temperature: 1,
    cacheTtlDays: 1,
    reasoning: 'low',
    verbosity: 'low',
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
  anthropic: {
    requestsPerMinute: 50,
    tokensPerMinute: 40000,
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
