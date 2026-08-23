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
 *
 * maxTokens IS A BUDGET FOR REASONING + PROSE, NOT FOR PROSE.
 * Reasoning tokens are invisible in the response body and are billed against
 * max_output_tokens, so a task whose prose comfortably fits can still be cut
 * off mid-sentence. Measured 2026-08-23 on the real albumDetail prompt, six
 * albums, no web search:
 *
 *   visible prose    455-536 tokens   (stable — this is what the page shows)
 *   reasoning        294-2025 tokens  (variable, and invisible)
 *
 * One of the six ("Sonicpraise") spent the entire 1500-token budget on
 * reasoning and returned ZERO characters. Another ("Across a Wire") landed at
 * 1399/1500 and truncated in production. The old caps of 1500/1000 were sized
 * for the prose alone and left no room for the other half.
 *
 * Two rules follow, and both are applied below:
 *  1. Set `reasoning` explicitly on every task. Both 5.6 tiers default to
 *     'medium', which is what produced the 2025-token outlier. 'low' held
 *     reasoning under ~560 tokens on the same prompts and ran faster.
 *  2. Give long-form tasks 3-4x headroom over worst-observed total spend.
 *     Only tokens actually generated are billed, so the ceiling is free.
 *
 * Web search makes both worse: each search hop emits its own reasoning, and
 * albumRecommendations (search always on) burned 831 reasoning tokens against
 * a 1000 cap on one of four test albums.
 */
export const AI_TASKS = {
  artistSummary: {
    provider: 'openai',
    model: 'gpt-5.6-terra',
    // Worst observed at medium: 782 total (516 reasoning + 266 prose).
    maxTokens: 2500,
    temperature: 1,
    cacheTtlDays: 180,
    webSearch: false,
    reasoning: 'low',
  },

  albumDetail: {
    provider: 'openai',
    model: 'gpt-5.6-terra',
    // The task that truncated in production. Longest prose of any task here
    // (~600-700 tokens) plus web search on recent releases.
    maxTokens: 4000,
    temperature: 1,
    cacheTtlDays: 120,
    webSearch: true,
    reasoning: 'low',
  },

  genreSummary: {
    provider: 'openai',
    model: 'gpt-5.6-terra',
    maxTokens: 2500,
    temperature: 1,
    cacheTtlDays: 180,
    webSearch: false,
    reasoning: 'low',
  },

  artistSentence: {
    provider: 'openai',
    model: 'gpt-5.6-terra',
    // Output is capped at 38 words (~50 tokens), but web search adds a
    // reasoning hop: Harold Budd measured 128 of the old 150-token budget,
    // i.e. one hop away from returning nothing. 400 is still a tight cap on
    // a deliberately short answer, just not a coin flip.
    maxTokens: 400,
    temperature: 1,
    cacheTtlDays: 180,
    webSearch: true,
    reasoning: 'low',
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
    // 4-sentence answers; worst observed 99 tokens. Cap is not the risk here,
    // latency is — this one is generated while the user waits.
    maxTokens: 500,
    temperature: 1,
    cacheTtlDays: 0,
    webSearch: false,
    verbosity: 'low',
    reasoning: 'low',
  },

  albumRecommendations: {
    provider: 'openai',
    model: 'gpt-5.6-terra',
    // Search is always on here, and each hop reasons: 831 reasoning tokens
    // against the old 1000 cap on 1 of 4 test albums, and 2 of 7 entries
    // generated after the model switch were truncated in KV.
    maxTokens: 3000,
    temperature: 1,
    cacheTtlDays: 30,
    webSearch: true,
    reasoning: 'low',
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
