// Listen AI prompt - Rick Rubin personality chatbot

import { AI_TASKS } from '@listentomore/config';
import type { OpenAIClient } from '../openai';

export interface ListenAIResult {
  response: string;
}

/**
 * Generate a response from the Rick Rubin AI personality
 * Note: Not cached since each conversation should be unique
 */
export async function generateListenAIResponse(
  question: string,
  client: OpenAIClient
): Promise<ListenAIResult> {
  const config = AI_TASKS.listenAi;

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
  });

  return {
    response: response.content.trim(),
  };
}
