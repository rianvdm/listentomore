// Artist summary prompt - generates detailed artist summaries with linked references

import { AI_TASKS } from '@listentomore/config';
import type { OpenAIClient } from '../openai';
import type { AICache } from '../cache';

export interface ArtistSummaryResult {
  summary: string;
}

/**
 * Format artist name for URL slug
 */
function formatArtistSlug(name: string): string {
  return encodeURIComponent(
    name
      .split(',')[0] // Remove text after first comma
      .replace(/'/g, '') // Remove single quotes
      .replace(/\//g, '-') // Replace / with hyphens
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .toLowerCase()
  );
}

/**
 * Format album name for URL slug
 */
function formatAlbumSlug(name: string): string {
  return encodeURIComponent(
    name
      .replace(/\s*\(.*?\)\s*/g, '') // Remove text in parentheses
      .replace(/'/g, '') // Remove single quotes
      .replace(/\//g, '-') // Replace / with hyphens
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .toLowerCase()
  );
}

/**
 * Replace [[Artist Name]] and {{Album Name}} placeholders with links
 */
function replacePlaceholders(summary: string, artistName: string): string {
  // Replace artist names: [[Artist Name]] -> markdown link
  let result = summary.replace(/\[\[([^\]]+)\]\]/g, (_match, artist) => {
    const slug = formatArtistSlug(artist);
    return `[${artist}](https://listentomore.com/artist/${slug})`;
  });

  // Replace album names: {{Album Name}} -> markdown link
  result = result.replace(/\{\{([^}]+)\}\}/g, (_match, album) => {
    const artistSlug = formatArtistSlug(artistName);
    const albumSlug = formatAlbumSlug(album);
    return `[${album}](https://listentomore.com/album/${artistSlug}_${albumSlug})`;
  });

  return result;
}

/**
 * Generate an artist summary using OpenAI
 */
export async function generateArtistSummary(
  artistName: string,
  client: OpenAIClient,
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

Use Markdown formatting for the summary. Do NOT use bullet points.

If no verifiable facts are available for the artist, simply state "I don't have any additional information about this artist." Nothing else.`;

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
  });

  // Process the response to replace placeholders with links
  const formattedSummary = replacePlaceholders(response.content, artistName);

  const result: ArtistSummaryResult = { summary: formattedSummary };

  // Cache the result
  await cache.set('artistSummary', [normalizedName], result);

  return result;
}
