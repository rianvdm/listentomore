// Artist sentence prompt - generates short one-sentence artist descriptions

import { AI_TASKS } from '@listentomore/config';
import type { PerplexityClient } from '../perplexity';
import type { AICache } from '../cache';

export interface ArtistSentenceResult {
  sentence: string;
}

/**
 * Clean up citation artifacts from the response
 */
function cleanResponse(text: string): string {
  // Remove citation markers like [1], [2], 【1】, etc.
  let cleaned = text.replace(/[\[【]\d+[\]】]\s*/g, '');
  // Remove markdown-style citation links
  cleaned = cleaned.replace(/\(?\[([^\]]+)\]\([^)]+\)\)?/g, '$1');
  return cleaned.trim();
}

/**
 * Generate a short artist description using Perplexity
 */
export async function generateArtistSentence(
  artistName: string,
  client: PerplexityClient,
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

  const config = AI_TASKS.artistSentence;

  const prompt = `Write a short summary about the musical artist or band "${artistName}".

Start the summary with 'He' for a male solo artist, 'She' for a female solo artist, and 'They' for a band or group. Don't mention their name in the summary (EXCEPTION: you are allowed to reference the names of bands they are/were a member of).

Include their main genres, and name 2-3 similar artists.

CRITICAL REQUIREMENTS:
* In total the response HAS to be less than 38 words.
* If you don't have information about this musical artist, say "There is no information available about this artist."
* Use plain text with no Markdown formatting.`;

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
  });

  const result: ArtistSentenceResult = {
    sentence: cleanResponse(response.content),
  };

  // Cache the result
  await cache.set('artistSentence', [normalizedName], result);

  return result;
}
