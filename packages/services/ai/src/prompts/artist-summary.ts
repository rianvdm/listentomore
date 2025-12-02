// Artist summary prompt - generates detailed artist summaries with linked references

import { AI_TASKS } from '@listentomore/config';
import type { PerplexityClient } from '../perplexity';
import type { AICache } from '../cache';

export interface ArtistSummaryResult {
  summary: string;
  citations: string[];
}

/**
 * Replace [[Artist Name]] and {{Album Name}} placeholders with search links.
 * Since we don't have Spotify IDs for referenced artists/albums, we link to
 * search pages where users can find them.
 */
function replacePlaceholders(summary: string, artistName: string): string {
  // Replace artist names: [[Artist Name]] -> search link
  let result = summary.replace(/\[\[([^\]]+)\]\]/g, (_match, artist) => {
    const query = encodeURIComponent(artist);
    return `[${artist}](/artist?q=${query})`;
  });

  // Replace album names: {{Album Name}} -> search link (include artist for better results)
  result = result.replace(/\{\{([^}]+)\}\}/g, (_match, album) => {
    const query = encodeURIComponent(`${album} ${artistName}`);
    return `[${album}](/album?q=${query})`;
  });

  // Fix missing spaces before placeholder markers (capital letters handled in perplexity.ts)
  result = result.replace(/\.(\[{1,2}|\{{1,2})/g, '. $1');

  return result;
}

/**
 * Generate an artist summary using Perplexity
 */
export async function generateArtistSummary(
  artistName: string,
  client: PerplexityClient,
  cache: AICache
): Promise<ArtistSummaryResult> {
  const normalizedName = artistName.toLowerCase().trim();

  // Check cache first
  const cached = await cache.get<ArtistSummaryResult>(
    'artistSummary',
    normalizedName
  );
  if (cached) {
    return cached;
  }

  const config = AI_TASKS.artistSummary;

  const prompt = `Write a summary of the music artist/band ${artistName}. Include verifiable facts about the artist's history, genres, styles, and most popular albums. Include one or two interesting facts about them (without stating that it's an interesting fact). Also recommend similar artists to check out if one likes their music. Write no more than three paragraphs. Enclose artist names in double square brackets like [[Artist Name]] and album names in double curly braces like {{Album Name}}.

Use Markdown formatting for the summary. Do NOT use bullet points. Include inline citation numbers like [1], [2], etc. to reference your sources.

IMPORTANT: If you cannot find sufficient verifiable information about this artist, respond with ONLY the text "Not enough information available for this artist." and nothing else. Do not explain what you couldn't find or apologize.`;

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
  const formattedSummary = replacePlaceholders(response.content, artistName);

  const result: ArtistSummaryResult = {
    summary: formattedSummary,
    citations: response.citations,
  };

  // Cache the result
  await cache.set('artistSummary', [normalizedName], result);

  return result;
}
