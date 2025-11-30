// Genre summary prompt - generates genre descriptions with citations using Perplexity

import { AI_TASKS } from '@listentomore/config';
import type { PerplexityClient } from '../perplexity';
import type { AICache } from '../cache';

export interface GenreSummaryResult {
  content: string;
  citations: string[];
}

/**
 * Replace [[Artist Name]] and {{Album Name}} placeholders with search links.
 * Client-side enrichLinks() will then upgrade these to direct Spotify links.
 */
function replacePlaceholders(content: string): string {
  // Replace album names FIRST (before artists, to avoid nested links)
  // Strip any [[...]] brackets from inside album names
  let result = content.replace(/\{\{([^}]+)\}\}/g, (_match, album) => {
    const cleanAlbum = album.replace(/\[\[([^\]]+)\]\]/g, '$1');
    const query = encodeURIComponent(cleanAlbum);
    return `[${cleanAlbum}](/album?q=${query})`;
  });

  // Replace artist names: [[Artist Name]] -> search link
  result = result.replace(/\[\[([^\]]+)\]\]/g, (_match, artist) => {
    const query = encodeURIComponent(artist);
    return `[${artist}](/artist?q=${query})`;
  });

  // Fix missing spaces after periods (Perplexity quirk)
  result = result.replace(/\.([A-Z])/g, '. $1');

  return result;
}

/**
 * Generate a genre summary using Perplexity
 */
export async function generateGenreSummary(
  genreName: string,
  client: PerplexityClient,
  cache: AICache
): Promise<GenreSummaryResult> {
  const normalizedGenre = genreName.toLowerCase().trim();

  // Check cache first
  const cached = await cache.get<GenreSummaryResult>(
    'genreSummary',
    normalizedGenre
  );
  if (cached) {
    return cached;
  }

  const config = AI_TASKS.genreSummary;

  const prompt = `Write a 2-3 paragraph summary of the music genre "${genreName}" (be sure to add line breaks between paragraphs). Describe the history, musical elements that characterize the genre, the artists who pioneered it, and notable events. Follow this with a bullet list of 4-6 seminal albums that provide a good overview of the genre, with a one-sentence description of each album's significance. Format each album entry as: **{{Album Name by Artist Name}}**: Description.

Enclose artist names in double square brackets like [[Artist Name]] and album names in double curly braces like {{Album Name by Artist Name}}.

Use Markdown formatting for the summary. Do NOT start with a preamble or end with follow-up suggestions.

If you cannot find verifiable information about this specific music genre, respond only with: "I don't have any information about this genre."`;



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
  });

  // Process the response to replace placeholders with links
  const formattedContent = replacePlaceholders(response.content);

  const result: GenreSummaryResult = {
    content: formattedContent,
    citations: response.citations,
  };

  // Cache the result
  await cache.set('genreSummary', [normalizedGenre], result);

  return result;
}
