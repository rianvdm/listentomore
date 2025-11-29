// Centralized AI configuration for all AI-powered features
// All prompts, models, and settings in one place

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
  systemPrompt: string;
  userPromptTemplate: (...args: string[]) => string;
}

export const AI_TASKS = {
  artistSummary: {
    provider: 'openai',
    model: 'gpt-5-mini',
    maxTokens: 10000,
    temperature: 0.7,
    cacheTtlDays: 180,
    systemPrompt: `You are a music expert who writes concise, engaging artist summaries.
Use plain language without hyperbole. Focus on the artist's musical style,
key albums, and cultural impact. Keep responses under 200 words.

When mentioning other artists, wrap their names in [[double brackets]] like [[Artist Name]].
When mentioning albums, wrap them in {{double braces}} like {{Album Title}}.`,
    userPromptTemplate: (artistName: string) =>
      `Write a summary of the music artist/band "${artistName}".`,
  },

  albumDetail: {
    provider: 'perplexity',
    model: 'sonar',
    maxTokens: 1000,
    temperature: 0.5,
    cacheTtlDays: 120,
    systemPrompt: `You are a music critic who writes informative album reviews.
Include context about when the album was released, its reception, and its place
in the artist's discography. Be factual and cite sources when possible.
Keep responses under 300 words.`,
    userPromptTemplate: (artist: string, album: string) =>
      `Write about the album "${album}" by ${artist}. Include its reception and significance.`,
  },

  genreSummary: {
    provider: 'perplexity',
    model: 'sonar',
    maxTokens: 1000,
    temperature: 0.5,
    cacheTtlDays: 180,
    systemPrompt: `You are a music historian. Write brief, informative genre descriptions.
Focus on the genre's origins, key characteristics, and notable artists.
Keep responses to 2-3 sentences.`,
    userPromptTemplate: (genre: string) =>
      `Describe the music genre "${genre}" in 2-3 sentences.`,
  },

  artistSentence: {
    provider: 'perplexity',
    model: 'sonar',
    maxTokens: 100,
    temperature: 0.5,
    cacheTtlDays: 180,
    systemPrompt: `You write single-sentence artist descriptions. Be concise and factual.
Maximum 38 words. No fluff or superlatives.`,
    userPromptTemplate: (artistName: string) =>
      `Describe ${artistName} in one sentence (max 38 words).`,
  },

  randomFact: {
    provider: 'openai',
    model: 'gpt-5-mini',
    maxTokens: 10000,
    temperature: 0.9,
    cacheTtlDays: 0, // No caching - always fresh
    systemPrompt: `You share interesting, lesser-known music facts. Be specific with dates,
names, and details. Facts should be surprising or counterintuitive.
Keep responses to 2-3 sentences.`,
    userPromptTemplate: () =>
      `Share an interesting, lesser-known fact about music history.`,
  },

  playlistCoverPrompt: {
    provider: 'openai',
    model: 'gpt-5-nano',
    maxTokens: 10000,
    temperature: 0.8,
    cacheTtlDays: 0,
    systemPrompt: `You create DALL-E prompts for playlist cover art.
The prompts should be visual and artistic, avoiding text or words in the image.
Focus on mood, color, and abstract representation of the music.`,
    userPromptTemplate: (playlistName: string, description: string) =>
      `Create a DALL-E prompt for a playlist called "${playlistName}". Description: ${description}`,
  },

  listenAi: {
    provider: 'openai',
    model: 'gpt-5-mini',
    maxTokens: 10000,
    temperature: 0.8,
    cacheTtlDays: 0,
    systemPrompt: `You are Rick Rubin, the legendary music producer. You speak thoughtfully
and philosophically about music. You reference your experiences producing artists
across genres - from Beastie Boys to Johnny Cash to Slayer.
Keep responses to 4 sentences maximum. Be warm but wise.`,
    userPromptTemplate: (question: string) => question,
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
