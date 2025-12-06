// AI service - consolidated AI functionality for text and image generation

import { OpenAIClient } from './openai';
import { PerplexityClient } from './perplexity';
import { AICache } from './cache';

// Re-export clients and cache for direct use
export { OpenAIClient } from './openai';
export type {
  ChatMessage,
  ChatCompletionOptions,
  ChatCompletionResponse,
  ImageGenerationOptions,
  ImageGenerationResponse,
} from './openai';

export { PerplexityClient } from './perplexity';
export type {
  ChatCompletionOptions as PerplexityChatOptions,
  ChatCompletionResponse as PerplexityChatResponse,
} from './perplexity';

export { AICache } from './cache';
export type { CacheOptions } from './cache';

// Re-export all prompt functions and types
export {
  generateArtistSummary,
  generateAlbumDetail,
  generateGenreSummary,
  generateArtistSentence,
  generateRandomFact,
  generateAndStoreFact,
  getRandomCachedFact,
  generatePlaylistCoverPrompt,
  generatePlaylistCoverImage,
  generateListenAIResponse,
  generateAlbumRecommendations,
  type ArtistSummaryResult,
  type AlbumDetailResult,
  type GenreSummaryResult,
  type ArtistSentenceResult,
  type RandomFactResult,
  type PlaylistCoverPromptResult,
  type PlaylistCoverImageResult,
  type ListenAIResult,
  type AlbumRecommendationsResult,
} from './prompts';

export interface AIServiceConfig {
  openaiApiKey: string;
  perplexityApiKey: string;
  cache: KVNamespace;
}

/**
 * Consolidated AI service that provides all AI functionality
 */
export class AIService {
  public readonly openai: OpenAIClient;
  public readonly perplexity: PerplexityClient;
  public readonly cache: AICache;
  public readonly kv: KVNamespace;

  constructor(config: AIServiceConfig) {
    this.openai = new OpenAIClient(config.openaiApiKey);
    this.perplexity = new PerplexityClient(config.perplexityApiKey);
    this.cache = new AICache(config.cache);
    this.kv = config.cache;
  }

  // Convenience methods that use the appropriate client

  /**
   * Generate an artist summary (uses Perplexity)
   */
  async getArtistSummary(artistName: string) {
    const { generateArtistSummary } = await import('./prompts/artist-summary');
    return generateArtistSummary(artistName, this.perplexity, this.cache);
  }

  /**
   * Generate album details with citations (uses Perplexity)
   */
  async getAlbumDetail(artistName: string, albumName: string) {
    const { generateAlbumDetail } = await import('./prompts/album-detail');
    return generateAlbumDetail(artistName, albumName, this.perplexity, this.cache);
  }

  /**
   * Generate genre summary with citations (uses Perplexity)
   */
  async getGenreSummary(genreName: string) {
    const { generateGenreSummary } = await import('./prompts/genre-summary');
    return generateGenreSummary(genreName, this.perplexity, this.cache);
  }

  /**
   * Generate a short artist sentence (uses Perplexity)
   */
  async getArtistSentence(artistName: string) {
    const { generateArtistSentence } = await import('./prompts/artist-sentence');
    return generateArtistSentence(artistName, this.perplexity, this.cache);
  }

  /**
   * Get a random music fact from the cached pool (fast - just KV read)
   */
  async getRandomFact() {
    const { generateRandomFact } = await import('./prompts/random-fact');
    return generateRandomFact(this.openai, this.kv);
  }

  /**
   * Generate and store a new random fact (called by CRON job)
   */
  async generateAndStoreRandomFact() {
    const { generateAndStoreFact } = await import('./prompts/random-fact');
    return generateAndStoreFact(this.openai, this.kv);
  }

  /**
   * Generate a DALL-E prompt for a playlist cover (uses OpenAI)
   */
  async getPlaylistCoverPrompt(playlistName: string, description: string) {
    const { generatePlaylistCoverPrompt } = await import('./prompts/playlist-cover');
    return generatePlaylistCoverPrompt(playlistName, description, this.openai);
  }

  /**
   * Generate a playlist cover image (uses OpenAI DALL-E)
   */
  async getPlaylistCoverImage(dallePrompt: string) {
    const { generatePlaylistCoverImage } = await import('./prompts/playlist-cover');
    return generatePlaylistCoverImage(dallePrompt, this.openai);
  }

  /**
   * Get a response from the Rick Rubin AI (uses OpenAI, not cached)
   */
  async askListenAI(question: string) {
    const { generateListenAIResponse } = await import('./prompts/listen-ai');
    return generateListenAIResponse(question, this.openai);
  }

  /**
   * Generate album recommendations (uses Perplexity)
   */
  async getAlbumRecommendations(artistName: string, albumName: string) {
    const { generateAlbumRecommendations } = await import(
      './prompts/album-recommendations'
    );
    return generateAlbumRecommendations(
      artistName,
      albumName,
      this.perplexity,
      this.cache
    );
  }
}
