// Album recommendations prompt - generates similar album suggestions

import { getTaskConfig } from '@listentomore/config';
import type { ChatClient } from '../types';
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
 * Generate album recommendations
 * Provider determined by AI_TASKS config (currently Perplexity)
 */
export async function generateAlbumRecommendations(
  artistName: string,
  albumName: string,
  client: ChatClient,
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

  const config = getTaskConfig('albumRecommendations');

  const prompt = `I enjoyed the album "${albumName}" by ${artistName}. Recommend 3 albums by other artists that are similar in genre and style.

Use Markdown for formatting.

Use bullets for the album recommendations. Format each recommendation as: **{{Album Name by Artist Name}}**: Brief description of why the album is recommended.

Enclose artist names in double square brackets like [[Artist Name]] and album names in double curly braces like {{Album Name by Artist Name}}.

Include inline citation numbers like [1], [2], etc. to reference your sources when making factual claims.

Do NOT start with a preamble (like "Here are some recommendations..." or "Great choice!"). Do NOT end with follow-up suggestions, summary statements (like "All these albums are available on Spotify..."), or any concluding remarks. Do NOT include a "References" or "Sources" section - citations are extracted separately. Just provide the bullet-point recommendations and nothing else.

IMPORTANT:
* You MUST provide ALBUM recommendations, not songs.
* ONLY recommend albums that are available on Spotify. If you cannot confirm an album is on Spotify, do not recommend it.
* ONLY recommend albums you can find reviews or articles about via web search. Do not recommend obscure albums that lack online documentation.
* If you cannot find sufficient verifiable information about the album "${albumName}" by ${artistName} to provide meaningful recommendations, respond with ONLY the text "Not enough information available for this album." and nothing else. Do not explain what you couldn't find or apologize.`;

  const response = await client.chatCompletion({
    model: config.model,
    messages: [
      {
        role: 'system',
        content:
          'You are a music expert who recommends albums. You prioritize accuracy over obscurity - only recommend albums you can verify exist and are available on streaming platforms. You use succinct, plain language.',
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
  const formattedContent = replacePlaceholders(response.content);

  const result: AlbumRecommendationsResult = {
    content: formattedContent,
    citations: response.citations,
  };

  // Cache the result
  await cache.set('albumRecommendations', [normalizedArtist, normalizedAlbum], result);

  return result;
}
