// Genre summary prompt - generates genre descriptions with citations

import { getTaskConfig } from '@listentomore/config';
import type { ChatClient, AIResponseMetadata } from '../types';
import type { AICache } from '../cache';

export interface GenreSummaryResult {
  content: string;
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
 * Client-side enrichLinks() will then upgrade these to direct Spotify links.
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

  // Fix missing spaces before placeholder markers (capital letters handled in perplexity.ts)
  result = result.replace(/\.(\[{1,2}|\{{1,2})/g, '. $1');

  return result;
}

/**
 * Generate a genre summary
 * Provider determined by AI_TASKS config (currently Perplexity)
 */
export async function generateGenreSummary(
  genreName: string,
  client: ChatClient,
  cache: AICache
): Promise<GenreSummaryResult> {
  const normalizedGenre = genreName.toLowerCase().trim();

  // Check cache first (fail gracefully if KV has issues)
  try {
    const cached = await cache.get<GenreSummaryResult>(
      'genreSummary',
      normalizedGenre
    );
    if (cached) {
      return cached;
    }
  } catch (cacheError) {
    console.error(`[Genre Summary] Cache read failed for "${genreName}":`, cacheError);
    // Continue to API call
  }

  const config = getTaskConfig('genreSummary');

  const prompt = `Write a 2-3 paragraph summary of the music genre "${genreName}" (be sure to add line breaks between paragraphs). Describe the history, musical elements that characterize the genre, the artists who pioneered it, and notable events. Follow this with a bullet list of 4-6 seminal albums that provide a good overview of the genre, with a one-sentence description of each album's significance. Format each album entry as: **{{Album Name by Artist Name}}**: Description.

Enclose artist names in double square brackets like [[Artist Name]] and album names in double curly braces like {{Album Name by Artist Name}}.

Use Markdown formatting for the summary. Include inline citation numbers like [1], [2], etc. to reference your sources. Do NOT start with a preamble or end with follow-up suggestions. Do NOT include a "References" or "Sources" section at the end - citations are extracted separately.

IMPORTANT: If you cannot find sufficient verifiable information about this music genre, respond with ONLY the text "Not enough information available for this genre." and nothing else. Do not explain what you couldn't find or apologize.`;



  // Retry logic for intermittent API failures
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
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
      const formattedContent = replacePlaceholders(response.content);

      const result: GenreSummaryResult = {
        content: formattedContent,
        citations: response.citations,
        metadata: response.metadata,
      };

      // Cache the result (without metadata - it's only for fresh responses)
      try {
        await cache.set('genreSummary', [normalizedGenre], {
          content: result.content,
          citations: result.citations,
        });
      } catch (err) {
        console.error(`[Genre Summary] Cache write failed for "${genreName}":`, err);
      }

      return result;
    } catch (error) {
      lastError = error as Error;
      console.log(`[Genre Summary] Attempt ${attempt + 1} failed for "${genreName}":`, error);
      if (attempt < 2) {
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }

  throw lastError || new Error('Failed to generate genre summary');
}
