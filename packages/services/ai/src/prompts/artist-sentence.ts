// ABOUTME: Artist sentence prompt - generates short one-sentence artist descriptions.
// ABOUTME: Regenerates once, and skips the cache, when the reply runs far past the word cap.

import { getTaskConfig } from '@listentomore/config';
import type { ChatClient, AIResponseMetadata } from '../types';
import type { AICache } from '../cache';
import { isCacheableResponse } from '../cacheable';

export interface ArtistSentenceResult {
  sentence: string;
}

/**
 * Replies longer than this are treated as broken. The prompt caps the answer
 * at 38 words; across 1,473 cached sentences (2026-10-31) the median was 25
 * and p99 was 37. The failure this catches is a self-correction left in the
 * visible reply ("Wait, I need to fix that..."), seen on Opus 5.5 at low
 * effort with web search: the model writes a draft, checks it, and rewrites
 * it, so the reply roughly doubles (73 words for "Sultan + Shepard").
 */
const MAX_WORDS = 45;

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Generate a short artist description
 * Provider determined by AI_TASKS config
 */
export async function generateArtistSentence(
  artistName: string,
  client: ChatClient,
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

  const config = getTaskConfig('artistSentence');

  const prompt = `Write a short summary about the musical artist or band "${artistName}".

Start the summary with 'He' for a male solo artist, 'She' for a female solo artist, and 'They' for a band or group. Don't mention their name in the summary (EXCEPTION: you are allowed to reference the names of bands they are/were a member of).

Include their main genres, and name 2-3 similar artists.

CRITICAL REQUIREMENTS:
* In total the response HAS to be less than 38 words.
* If you don't have information about this musical artist, say "There is no information available about this artist."
* Use plain text ONLY - NO Markdown formatting (no **bold**, no *italic*, no ### headers, etc.).
* Do NOT include citation markers like [1], [2], etc. - this is a plain text summary with no citations.
* Do not describe or announce your search; output only the sentence itself.
* Your whole reply is published as-is. Check facts before you write, and don't revise or comment on the sentence in your reply.`;

  const requestSentence = async (): Promise<{
    sentence: string;
    metadata: AIResponseMetadata | undefined;
  }> => {
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
      reasoning: config.reasoning,
      verbosity: config.verbosity,
      webSearch: config.webSearch,
    });

    // Strip any citation markers that might have been included despite instructions
    // Handles [1], [2], [1][2], and Chinese brackets【1】
    const sentence = response.content
      .replace(/\s*[\[【]\d+[\]】]/g, '')      // Remove citation markers and preceding space
      .replace(/\s+([.,!?;:])/g, '$1')        // Remove space before punctuation
      .replace(/\s+/g, ' ')                    // Collapse multiple spaces
      .trim();

    return { sentence, metadata: response.metadata };
  };

  let attempt = await requestSentence();
  if (countWords(attempt.sentence) > MAX_WORDS) {
    console.warn(
      `[artistSentence] ${countWords(attempt.sentence)} words for ${normalizedName} ` +
      `(limit ${MAX_WORDS}); regenerating once.`
    );
    attempt = await requestSentence();
  }

  const result: ArtistSentenceResult = { sentence: attempt.sentence };

  // Cache the result. This one has 180-day TTL and the largest key count in
  // KV, so a bad reply stored here is the longest-lived of any task. An
  // over-length retry is still shown once, but not pinned for six months.
  const withinLimit = countWords(attempt.sentence) <= MAX_WORDS;
  if (!withinLimit) {
    console.warn(
      `[AICache] Refusing to cache over-length artistSentence:${normalizedName} ` +
      `(${countWords(attempt.sentence)} words). Will regenerate on next request.`
    );
  }
  if (
    withinLimit &&
    isCacheableResponse(
      attempt.sentence,
      attempt.metadata,
      'artistSentence',
      normalizedName
    )
  ) {
    await cache.set('artistSentence', [normalizedName], result);
  }

  return result;
}
