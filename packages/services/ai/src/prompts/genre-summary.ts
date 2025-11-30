// Genre summary prompt - generates genre descriptions with citations using Perplexity

import { AI_TASKS } from '@listentomore/config';
import type { PerplexityClient } from '../perplexity';
import type { AICache } from '../cache';

export interface GenreSummaryResult {
  content: string;
  citations: string[];
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

  const prompt = `Give me a two-paragraph summary of the music genre ${genreName}. Describe the history, the musical elements that characterize the genre, the artists who pioneered it, and any other notable events.

Follow this with one paragraph of seminal albums that provide a good overview of the genre. Format each bullet point as shown in the examples below.

If you cannot find any verifiable information about the specific music genre being asked about, you must not make something up and you must not provide information about a different genre. Simply say: I don't have any information about this genre.

Use Markdown for formatting. Do NOT start with a preamble (like "Here is a summary...") or end with follow-up suggestions (like "I can also...").

Link every artist name that is mentioned in the summary to the URL \`https://listentomore.com/artist/artist-name\`

For artist links in the summary text:
- Format: [Artist Name](https://listentomore.com/artist/artist-name)
- Example: [Pink Floyd](https://listentomore.com/artist/pink-floyd)

For album links in the bullet points:
- Format: **[Album Name by Artist Name](https://listentomore.com/album/artist-name_album-name)**: Description of why the album is considered significant.
- IMPORTANT: Always use exactly ONE underscore (_) to separate artist name from album name in the URL

URL formatting rules:
- Convert spaces to hyphens (-)
- Remove any ', ", (), [], {} characters
- Replace / with -
- Remove any text inside parentheses

Examples of correct album links:
- **[The Dark Side of the Moon by Pink Floyd](https://listentomore.com/album/pink-floyd_the-dark-side-of-the-moon)**
- **[OK Computer by Radiohead](https://listentomore.com/album/radiohead_ok-computer)**
- **[Sgt. Pepper's Lonely Hearts Club Band by The Beatles](https://listentomore.com/album/the-beatles_sgt-peppers-lonely-hearts-club-band)**`;

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

  const result: GenreSummaryResult = {
    content: response.content,
    citations: response.citations,
  };

  // Cache the result
  await cache.set('genreSummary', [normalizedGenre], result);

  return result;
}
