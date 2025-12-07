// Artist summary prompt - generates detailed artist summaries with linked references

import { getTaskConfig } from '@listentomore/config';
import type { ChatClient, AIResponseMetadata } from '../types';
import type { AICache } from '../cache';

export interface ArtistSummaryResult {
  summary: string;
  citations: string[];
  metadata?: AIResponseMetadata;
}

/**
 * Escape HTML special characters to prevent XSS in data attributes
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Replace [[Artist Name]] and {{Album Name}} placeholders with search links.
 * Since we don't have Spotify IDs for referenced artists/albums, we link to
 * search pages where users can find them.
 * Albums include data-artist and data-album attributes for precise field-filter search.
 */
function replacePlaceholders(summary: string, artistName: string): string {
  // Replace artist names: [[Artist Name]] -> search link
  let result = summary.replace(/\[\[([^\]]+)\]\]/g, (_match, artist) => {
    const query = encodeURIComponent(artist);
    return `[${artist}](/artist?q=${query})`;
  });

  // Replace album names: {{Album Name}} -> search link with data attributes for precise search
  result = result.replace(/\{\{([^}]+)\}\}/g, (_match, album) => {
    const query = encodeURIComponent(`${artistName} ${album}`);
    return `<a href="/album?q=${query}" data-artist="${escapeHtml(artistName)}" data-album="${escapeHtml(album)}">${album}</a>`;
  });

  // Fix missing spaces before placeholder markers (capital letters handled in perplexity.ts)
  result = result.replace(/\.(\[{1,2}|\{{1,2})/g, '. $1');

  return result;
}

/**
 * Generate an artist summary
 * Provider determined by AI_TASKS config (currently Perplexity)
 */
export async function generateArtistSummary(
  artistName: string,
  client: ChatClient,
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

  const config = getTaskConfig('artistSummary');

  const prompt = `Write a summary of the music artist/band ${artistName}. Include verifiable facts about the artist's history, genres, styles, and most popular albums. Include one or two interesting facts about them (without stating that it's an interesting fact). Also recommend similar artists to check out if one likes their music. Write no more than three paragraphs. Enclose artist names in double square brackets like [[Artist Name]] and album names in double curly braces like {{Album Name}}.

Use Markdown formatting for the summary. Do NOT use bullet points. Include inline citation numbers like [1], [2], etc. to reference your sources. Do NOT include a "References" or "Sources" section at the end - citations are extracted separately.

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
    // Pass through GPT-5.1 options if configured
    reasoning: config.reasoning,
    verbosity: config.verbosity,
    webSearch: config.webSearch,
  });

  // Process the response to replace placeholders with links
  const formattedSummary = replacePlaceholders(response.content, artistName);

  const result: ArtistSummaryResult = {
    summary: formattedSummary,
    citations: response.citations,
    metadata: response.metadata,
  };

  // Cache the result (without metadata - it's only for fresh responses)
  await cache.set('artistSummary', [normalizedName], {
    summary: result.summary,
    citations: result.citations,
  });

  return result;
}
