// Artist sentence prompt - generates short one-sentence artist descriptions

import { getTaskConfig } from '@listentomore/config';
import type { ChatClient } from '../types';
import type { AICache } from '../cache';

export interface ArtistSentenceResult {
  sentence: string;
}


/**
 * Generate a short artist description
 * Provider determined by AI_TASKS config
 */
export async function generateArtistSentence(
  artistName: string,
  client: ChatClient,
  cache: AICache
): Promise<ArtistSentenceResult> {
  const normalizedName = artistName.toLowerCase().trim();

  // Check cache first
  const cached = await cache.get<ArtistSentenceResult>(
    'artistSentence',
    normalizedName
  );
  if (cached) {
    return cached;
  }

  const config = getTaskConfig('artistSentence');

  const prompt = `Write a short summary about the musical artist or band "${artistName}".

Start the summary with 'He' for a male solo artist, 'She' for a female solo artist, and 'They' for a band or group. Don't mention their name in the summary (EXCEPTION: you are allowed to reference the names of bands they are/were a member of).

Include their main genres, and name 2-3 similar artists.

CRITICAL REQUIREMENTS:
* In total the response HAS to be less than 38 words.
* If you don't have information about this musical artist, say "There is no information available about this artist."
* Use plain text ONLY - NO Markdown formatting (no **bold**, no *italic*, no ### headers, etc.).`;

  const response = await client.chatCompletion({
    model: config.model,
    messages: [
      {
        role: 'system',
        content:
          'You use succinct, plain language focused on accuracy and professionalism.',
      },
      { role: 'user', content: prompt },
    ],
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    returnCitations: false,
    reasoning: config.reasoning,
    verbosity: config.verbosity,
    webSearch: config.webSearch,
  });

  const result: ArtistSentenceResult = {
    sentence: response.content.trim(),
  };

  // Cache the result
  await cache.set('artistSentence', [normalizedName], result);

  return result;
}
