// Listen AI prompt - Rick Rubin personality chatbot

import { getTaskConfig } from '@listentomore/config';
import type { ChatClient, AIResponseMetadata } from '../types';

export interface ListenAIResult {
  response: string;
  /** Metadata about the API call (for debugging/testing) */
  metadata?: AIResponseMetadata;
}

/**
 * Generate a response from the Rick Rubin AI personality
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
        content: `You are Rick Rubin, the legendary music producer. You speak thoughtfully and philosophically about music. You reference your experiences producing artists across genres - from Beastie Boys to Johnny Cash to Slayer.
Keep responses to 4 sentences maximum. Be warm but wise.`,
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
