// AI service - consolidated AI functionality for text and image generation

import type { AITask } from '@listentomore/config';
import { OpenAIClient } from './openai';
import { AICache } from './cache';
import { AIRateLimiter } from './rate-limit';
import type { ChatClient } from './types';

// Re-export common types from types.ts
export type {
  ChatClient,
  ChatMessage,
  ChatCompletionOptions as CommonChatOptions,
  ChatCompletionResponse as CommonChatResponse,
  ReasoningEffort,
  Verbosity,
} from './types';

// Re-export clients and cache for direct use
export { OpenAIClient } from './openai';
export type {
  ChatCompletionOptions,
  ChatCompletionResponse,
  ImageGenerationOptions,
  ImageGenerationResponse,
  ResponsesOptions,
  ResponsesResult,
} from './openai';

export { AICache } from './cache';
export type { CacheOptions } from './cache';

export { AIRateLimiter } from './rate-limit';
export type { AIRateLimitState, AIProvider } from './rate-limit';

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
  generateUserInsightsSummary,
  generateUserInsightsRecommendations,
  type ArtistSummaryResult,
  type AlbumDetailResult,
  type GenreSummaryResult,
  type ArtistSentenceResult,
  type RandomFactResult,
  type PlaylistCoverPromptResult,
  type PlaylistCoverImageResult,
  type ListenAIResult,
  type AlbumRecommendationsResult,
  type UserInsightsSummaryResult,
  type UserInsightsRecommendationsResult,
  type AlbumRecommendation,
  type InsightsListeningData,
} from './prompts';

export interface AIServiceConfig {
  openaiApiKey: string;
  cache: KVNamespace;
}

/**
 * Consolidated AI service that provides all AI functionality
 */
export class AIService {
  public readonly openai: OpenAIClient;
  public readonly cache: AICache;
  public readonly kv: KVNamespace;
  public readonly openaiRateLimiter: AIRateLimiter;

  constructor(config: AIServiceConfig) {
    // Create distributed rate limiter for OpenAI
    this.openaiRateLimiter = new AIRateLimiter(config.cache, 'openai');

    // Create client with rate limiter
    this.openai = new OpenAIClient(config.openaiApiKey, this.openaiRateLimiter);
    this.cache = new AICache(config.cache);
    this.kv = config.cache;
  }

  /**
   * Get the appropriate client for a task based on config.
   */
  getClientForTask(_task: AITask): ChatClient {
    return this.openai;
  }

  // Convenience methods that use the appropriate client based on config

  /**
   * Generate an artist summary (provider determined by config)
   */
  async getArtistSummary(artistName: string) {
    const { generateArtistSummary } = await import('./prompts/artist-summary');
    const client = this.getClientForTask('artistSummary');
    return generateArtistSummary(artistName, client, this.cache);
  }

  /**
   * Generate album details with citations (provider determined by config)
   */
  async getAlbumDetail(artistName: string, albumName: string) {
    const { generateAlbumDetail } = await import('./prompts/album-detail');
    const client = this.getClientForTask('albumDetail');
    return generateAlbumDetail(artistName, albumName, client, this.cache);
  }

  /**
   * Generate genre summary with citations (provider determined by config)
   */
  async getGenreSummary(genreName: string) {
    const { generateGenreSummary } = await import('./prompts/genre-summary');
    const client = this.getClientForTask('genreSummary');
    return generateGenreSummary(genreName, client, this.cache);
  }

  /**
   * Generate a short artist sentence (provider determined by config)
   */
  async getArtistSentence(artistName: string) {
    const { generateArtistSentence } = await import('./prompts/artist-sentence');
    const client = this.getClientForTask('artistSentence');
    return generateArtistSentence(artistName, client, this.cache);
  }

  /**
   * Get a random music fact from the cached pool (fast - just KV read)
   * Note: Always uses OpenAI as it needs KV storage for fact rotation
   */
  async getRandomFact() {
    const { generateRandomFact } = await import('./prompts/random-fact');
    return generateRandomFact(this.openai, this.kv);
  }

  /**
   * Generate and store a new random fact (called by CRON job)
   * Note: Always uses OpenAI as it needs KV storage for fact rotation
   */
  async generateAndStoreRandomFact() {
    const { generateAndStoreFact } = await import('./prompts/random-fact');
    return generateAndStoreFact(this.openai, this.kv);
  }

  /**
   * Generate a DALL-E prompt for a playlist cover
   * Note: Always uses OpenAI for image generation
   */
  async getPlaylistCoverPrompt(playlistName: string, description: string) {
    const { generatePlaylistCoverPrompt } = await import('./prompts/playlist-cover');
    return generatePlaylistCoverPrompt(playlistName, description, this.openai);
  }

  /**
   * Generate a playlist cover image (uses OpenAI DALL-E)
   * Note: Always uses OpenAI for image generation
   */
  async getPlaylistCoverImage(dallePrompt: string) {
    const { generatePlaylistCoverImage } = await import('./prompts/playlist-cover');
    return generatePlaylistCoverImage(dallePrompt, this.openai);
  }

  /**
   * Get a response from the Rick Rubin AI (provider determined by config)
   */
  async askListenAI(question: string) {
    const { generateListenAIResponse } = await import('./prompts/listen-ai');
    const client = this.getClientForTask('listenAi');
    return generateListenAIResponse(question, client);
  }

  /**
   * Generate album recommendations (provider determined by config)
   */
  async getAlbumRecommendations(artistName: string, albumName: string) {
    const { generateAlbumRecommendations } = await import(
      './prompts/album-recommendations'
    );
    const client = this.getClientForTask('albumRecommendations');
    return generateAlbumRecommendations(artistName, albumName, client, this.cache);
  }

  /**
   * Generate user insights summary (provider determined by config)
   */
  async getUserInsightsSummary(
    username: string,
    listeningData: {
      topArtists: Array<{ name: string; playcount: number }>;
      topAlbums: Array<{ name: string; artist: string; playcount: number }>;
      recentTracks: Array<{ name: string; artist: string }>;
    }
  ) {
    const { generateUserInsightsSummary } = await import(
      './prompts/user-insights-summary'
    );
    const client = this.getClientForTask('userInsightsSummary');
    return generateUserInsightsSummary(username, listeningData, client, this.cache);
  }

  /**
   * Generate user insights recommendations (provider determined by config)
   */
  async getUserInsightsRecommendations(
    username: string,
    listeningData: {
      topArtists: Array<{ name: string; playcount: number }>;
      topAlbums: Array<{ name: string; artist: string; playcount: number }>;
    }
  ) {
    const { generateUserInsightsRecommendations } = await import(
      './prompts/user-insights-recommendations'
    );
    const client = this.getClientForTask('userInsightsRecommendations');
    return generateUserInsightsRecommendations(username, listeningData, client, this.cache);
  }
}
