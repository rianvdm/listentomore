// Album detail prompt - generates album summaries with citations

import { getTaskConfig } from '@listentomore/config';
import type { ChatClient, AIResponseMetadata } from '../types';
import type { AICache } from '../cache';

export interface AlbumDetailResult {
  content: string;
  citations: string[];
  metadata?: AIResponseMetadata;
}

/**
 * Generate an album detail summary
 * Provider determined by AI_TASKS config
 */
export async function generateAlbumDetail(
  artistName: string,
  albumName: string,
  client: ChatClient,
  cache: AICache
): Promise<AlbumDetailResult> {
  const normalizedArtist = artistName.toLowerCase().trim();
  const normalizedAlbum = albumName.toLowerCase().trim();

  // Check cache first
  const cached = await cache.get<AlbumDetailResult>(
    'albumDetail',
    normalizedArtist,
    normalizedAlbum
  );
  if (cached) {
    return cached;
  }

  const config = getTaskConfig('albumDetail');

  const prompt = `I'm listening to the album "${albumName}" by ${artistName}. Provide a 2-3 paragraph summary of the album's history and genres/styles. Then provide a 1-2 paragraph summary of the album's critical reception (if available), with examples/quotes.

Use Markdown formatting with bold and italic text where appropriate, and h3 (###) headers for each section.

You MUST attempt to find at least 5 sources from web searches. Include inline citation numbers like [1], [2], etc. in your response to reference your sources.

Do NOT start with a preamble (like "Here is a summary...") or end with follow-up suggestions (like "I can also..."). Do NOT include a "References" or "Sources" section at the end - citations are extracted separately.

IMPORTANT: If you cannot find sufficient information about this album to write a meaningful summary, respond with ONLY the text "Not enough information available for this album." and nothing else. Do not explain what you couldn't find or apologize.`;

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
    returnCitations: true,
    reasoning: config.reasoning,
    verbosity: config.verbosity,
    webSearch: config.webSearch,
  });

  const result: AlbumDetailResult = {
    content: response.content,
    citations: response.citations,
    metadata: response.metadata,
  };

  // Cache the result (without metadata - it's only for fresh responses)
  await cache.set('albumDetail', [normalizedArtist, normalizedAlbum], {
    content: result.content,
    citations: result.citations,
  });

  return result;
}
