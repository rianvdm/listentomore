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
    defaultModel: 'claude-opus-5-5',
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
  /** Enable web search for grounded responses (OpenAI Responses API or Claude) */
  webSearch?: boolean;
  /** Reasoning effort: GPT-5 (Responses API) or Claude (mapped to output_config.effort) */
  reasoning?: ReasoningEffort;
  /** Output verbosity for GPT-5 models (Responses API only; ignored by Claude) */
  verbosity?: Verbosity;
}

/**
 * AI task configurations. Seven tasks run on Anthropic Claude; two stay on
 * OpenAI after the migration eval (see their entries). The OpenAI client stays
 * wired up as a switch-back path: flip a task's `provider` and `model` to the
 * GPT-5.6 row below and it works without code changes.
 *
 * Five tasks run on claude-opus-5-5 (artistSummary, albumDetail, genreSummary,
 * userInsightsSummary, userInsightsRecommendations). Two run on
 * claude-sonnet-5-5 (artistSentence, listenAi): short output, latency-sensitive,
 * where the cheaper tier earns its keep. albumRecommendations runs on
 * gpt-5.6-terra and randomFact on gpt-5.6-luna.
 *
 * ┌──────────────────┬───────────────┬────────────────┬──────────────────┐
 * │ Model            │ $/1M in/out   │ Provider       │ Role             │
 * ├──────────────────┼───────────────┼────────────────┼──────────────────┤
 * │ claude-opus-5-5  │ $4.00 / $20.00│ anthropic      │ long-form tasks  │
 * ├──────────────────┼───────────────┼────────────────┼──────────────────┤
 * │ claude-sonnet-5-5│ $2.00 / $10.00│ anthropic      │ short / uncached │
 * ├──────────────────┼───────────────┼────────────────┼──────────────────┤
 * │ gpt-5.6-terra    │ $2.00 / $12.00│ openai         │ switch-back      │
 * ├──────────────────┼───────────────┼────────────────┼──────────────────┤
 * │ gpt-5.6-luna     │ $0.20 / $1.20 │ openai         │ switch-back (low)│
 * └──────────────────┴───────────────┴────────────────┴──────────────────┘
 * Claude web search costs $10 per 1,000 searches; search results are billed
 * as input tokens on top of that.
 *
 * IMPORTANT CONSTRAINTS:
 * - Claude ignores `temperature` and `verbosity`. `temperature` stays in every
 *   entry because AITaskConfig requires it and it still applies if a task is
 *   flipped back to OpenAI. `verbosity` is left where it was set.
 * - Opus 5.5 defaults to 'medium' effort, which is why every Claude task sets
 *   `reasoning` explicitly ('low', except userInsightsRecommendations). AnthropicClient maps `reasoning` to
 *   output_config.effort; 'none', 'minimal', and unset all map to 'low'.
 * - On OpenAI, temperature is ignored when reasoning is set, and GPT-5.x only
 *   supports temperature=1.
 *
 * maxTokens IS A BUDGET FOR REASONING OR THINKING + PROSE, NOT FOR PROSE.
 * Reasoning or thinking tokens are invisible in the response body and are
 * billed against max_output_tokens (OpenAI) or max_tokens (Claude), so a task
 * whose prose comfortably fits can still be cut off mid-sentence. Measured
 * 2026-08-23 on the real albumDetail prompt under GPT-5.6, six albums, no web
 * search:
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
 *  1. Set `reasoning` explicitly on every task. The default effort is
 *     'medium' on both Opus 5.5 and GPT-5.6, which is what produced the
 *     2025-token outlier. 'low' held reasoning under ~560 tokens on the same
 *     prompts and ran faster.
 *  2. Give long-form tasks 3-4x headroom over worst-observed total spend.
 *     Only tokens actually generated are billed, so the ceiling is free.
 *
 * Web search makes both worse: each search hop emits its own reasoning, and
 * albumRecommendations (search always on) burned 831 reasoning tokens against
 * a 1000 cap on one of four test albums.
 */
export const AI_TASKS = {
  artistSummary: {
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    // Worst observed at medium: 782 total (516 reasoning + 266 prose).
    maxTokens: 2500,
    temperature: 1,
    cacheTtlDays: 180,
    webSearch: false,
    reasoning: 'low',
  },

  albumDetail: {
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    // The task that truncated in production. Longest prose of any task here
    // (~600-700 tokens) plus web search on recent releases.
    maxTokens: 4000,
    temperature: 1,
    cacheTtlDays: 120,
    webSearch: true,
    reasoning: 'low',
  },

  genreSummary: {
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    maxTokens: 2500,
    temperature: 1,
    cacheTtlDays: 180,
    webSearch: false,
    reasoning: 'low',
  },

  artistSentence: {
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
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
    // Stays on OpenAI after eval round 3: Sonnet 5.5 at low effort shipped its
    // self-corrections as the fact ("Hmm, I'm not certain of that, so here's a
    // safer one..."), 461-521 chars against the 300-char limit, on 2 of 4 runs.
    provider: 'openai',
    // luna, not terra: this task is uncached, so every call hits the API, and
    // Terra's rate is ~8x input / 6x output for one line of music trivia.
    model: 'gpt-5.6-luna',
    maxTokens: 10000,
    temperature: 1,
    cacheTtlDays: 0, // No caching - always fresh
  },

  listenAi: {
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
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
    // Stays on OpenAI after eval round 3: the prompt asks Claude to verify the
    // seed and each pick by search, which takes 4 searches against the
    // web search tool's max_uses of 3. Claude returned "Not enough
    // information" (round 1) or only 2 picks (round 3) instead of guessing.
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
    model: 'claude-opus-5-5',
    // 5000 gives headroom for adaptive thinking (thinking tokens count against
    // max_tokens, display-omitted so invisible) plus the 2-3 paragraph output.
    // Only tokens actually generated are billed.
    maxTokens: 5000,
    // temperature is inert on Claude (the AnthropicClient omits it) — kept only
    // to satisfy the AITaskConfig shape. Warmth comes from the persona +
    // few-shot examples.
    temperature: 0.8,
    cacheTtlDays: 1,
    reasoning: 'low',
  },

  userInsightsRecommendations: {
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    maxTokens: 4000, // Increased from 1500 to avoid timeout
    temperature: 1,
    cacheTtlDays: 1,
    // Medium, not low: at low effort Opus 5.5 sometimes skipped thinking and
    // filtered against the exclusion list in visible text ("Wait — excluded
    // artist, skip."), producing 16 bold entries instead of 4 (eval round 2).
    reasoning: 'medium',
    verbosity: 'low',
  },
} as const satisfies Record<string, AITaskConfig>;

export type AITask = keyof typeof AI_TASKS;

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
