// Listen AI prompt - friendly assistant chatbot

import { getTaskConfig } from '@listentomore/config';
import type { ChatClient, AIResponseMetadata } from '../types';

export interface ListenAIResult {
  response: string;
  /** Metadata about the API call (for debugging/testing) */
  metadata?: AIResponseMetadata;
}

/**
 * Generate a response from the Listen AI assistant
 * Note: Not cached since each conversation should be unique
 * Provider determined by AI_TASKS config (currently OpenAI)
 */
export async function generateListenAIResponse(
  question: string,
  client: ChatClient
): Promise<ListenAIResult> {
  const config = getTaskConfig('listenAi');

  const response = await client.chatCompletion({
    model: config.model,
    messages: [
      {
        role: 'system',
        content: `You are a friendly, helpful assistant for a music discovery app called Listen To More. You can answer questions about music, artists, genres, and anything else the user asks about.
Keep responses to 4 sentences maximum. Be succinct and conversational.`,
      },
      { role: 'user', content: question },
    ],
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    reasoning: config.reasoning,
    verbosity: config.verbosity,
    webSearch: config.webSearch,
  });

  return {
    response: response.content.trim(),
    metadata: response.metadata,
  };
}
