// Album recommendations prompt - generates similar album suggestions using Perplexity

import { AI_TASKS } from '@listentomore/config';
import type { PerplexityClient } from '../perplexity';
import type { AICache } from '../cache';

export interface AlbumRecommendationsResult {
  content: string;
  citations: string[];
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
 * Albums include data-artist and data-album attributes for precise field-filter search.
 */
function replacePlaceholders(content: string): string {
  // Replace album names FIRST (before artists, to avoid nested links)
  // Strip any [[...]] brackets from inside album names
  let result = content.replace(/\{\{([^}]+)\}\}/g, (_match, album) => {
    const cleanAlbum = album.replace(/\[\[([^\]]+)\]\]/g, '$1');

    // Parse "Album Name by Artist Name" for more precise Spotify search
    const byMatch = cleanAlbum.match(/^(.+?)\s+by\s+(.+)$/i);
    if (byMatch) {
      const albumName = byMatch[1].trim();
      const artistName = byMatch[2].trim();
      // Include data attributes for precise field-filter search via enrichLinks
      const query = encodeURIComponent(`${artistName} ${albumName}`);
      return `<a href="/album?q=${query}" data-artist="${escapeHtml(artistName)}" data-album="${escapeHtml(albumName)}">${cleanAlbum}</a>`;
    } else {
      const query = encodeURIComponent(cleanAlbum);
      return `[${cleanAlbum}](/album?q=${query})`;
    }
  });

  // Replace artist names: [[Artist Name]] -> search link
  result = result.replace(/\[\[([^\]]+)\]\]/g, (_match, artist) => {
    const query = encodeURIComponent(artist);
    return `[${artist}](/artist?q=${query})`;
  });

  // Fix missing spaces before placeholder markers
  result = result.replace(/\.(\[{1,2}|\{{1,2})/g, '. $1');

  return result;
}

/**
 * Generate album recommendations using Perplexity
 */
export async function generateAlbumRecommendations(
  artistName: string,
  albumName: string,
  client: PerplexityClient,
  cache: AICache
): Promise<AlbumRecommendationsResult> {
  const normalizedArtist = artistName.toLowerCase().trim();
  const normalizedAlbum = albumName.toLowerCase().trim();

  // Check cache first
  const cached = await cache.get<AlbumRecommendationsResult>(
    'albumRecommendations',
    normalizedArtist,
    normalizedAlbum
  );
  if (cached) {
    return cached;
  }

  const config = AI_TASKS.albumRecommendations;

  const prompt = `I enjoyed the album "${albumName}" by ${artistName}. What are 2-3 albums by other artists I should listen to that are similar in genre and style? Avoid albums that are very popular and mainstream. Instead, recommend what could be considered "hidden gems". You MUST verify that each album actually exists (but don't mention that in your response).

Use Markdown for formatting.

Use bullets for the album recommendations. Format each recommendation as: **{{Album Name by Artist Name}}**: Brief description of why the album is recommended.

Enclose artist names in double square brackets like [[Artist Name]] and album names in double curly braces like {{Album Name by Artist Name}}.

Include inline citation numbers like [1], [2], etc. to reference your sources when making factual claims.

Do NOT start with a preamble (like "Here are some recommendations..." or "Great choice!") or end with follow-up suggestions. Do NOT include a "References" or "Sources" section at the end - citations are extracted separately.

IMPORTANT: If you cannot find sufficient verifiable information about the album "${albumName}" by ${artistName} to provide meaningful recommendations, respond with ONLY the text "Not enough information available for this album." and nothing else. Do not explain what you couldn't find or apologize.`;

  const response = await client.chatCompletion({
    model: config.model,
    messages: [
      {
        role: 'system',
        content:
          'You are a music expert who recommends lesser-known albums. You focus on hidden gems rather than mainstream choices. You use succinct, plain language focused on accuracy and professionalism.',
      },
      { role: 'user', content: prompt },
    ],
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    returnCitations: true,
  });

  // Process the response to replace placeholders with links
  const formattedContent = replacePlaceholders(response.content);

  const result: AlbumRecommendationsResult = {
    content: formattedContent,
    citations: response.citations,
  };

  // Cache the result
  await cache.set('albumRecommendations', [normalizedArtist, normalizedAlbum], result);

  return result;
}
