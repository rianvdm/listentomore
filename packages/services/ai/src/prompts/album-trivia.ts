// ABOUTME: The albumTrivia task for the insights making-of card: one verifiable fact about an album, from web search,
// ABOUTME: with the first https citation as its source. Uncached; the insights route checks the copy and caches it.

import { getTaskConfig } from '@listentomore/config';
import type { ChatClient, ChatMessage, AIResponseMetadata, WebCitation } from '../types';

export interface AlbumTriviaResult {
  /** The fact, or null when the model found none it could verify (or replied with nothing). */
  text: string | null;
  /** The first https page the answer cites, or null when it cites none. */
  sourceUrl: string | null;
  /** The reply as the client returned it, for `isCacheableResponse()`. */
  raw: string;
  metadata?: AIResponseMetadata;
}

/** The model's reply when it cannot verify a fact. */
export const ALBUM_TRIVIA_NONE = 'NONE';

const SYSTEM_PROMPT = 'You are a music reference researcher who reports documented facts about recordings.';

/** The chat messages for one album. Pure: no cache, no client. */
export function buildAlbumTriviaMessages(artistName: string, albumName: string): ChatMessage[] {
  const userPrompt = `Find one specific, verifiable fact about the album "${albumName}" by ${artistName}: how or where it was made, when it came out, who played on it, or something notable that happened around it. Write it in one or two plain sentences. No opinions about the music, no adjectives describing how it sounds, no em dashes, no hedging. If you can't find a fact you can verify, reply with exactly ${ALBUM_TRIVIA_NONE}.`;
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];
}

/**
 * The fact in a reply, trimmed, or null for an empty reply or one that opens with NONE. The model may add a reason
 * after NONE ("NONE. I could not find..."), so only the opening word is read; it is upper case, so a fact that
 * begins "None of the songs..." is kept.
 */
export function parseAlbumTrivia(content: string): string | null {
  const text = content.trim();
  if (text === '' || new RegExp(`^${ALBUM_TRIVIA_NONE}\\b`).test(text)) return null;
  return text;
}

/** The first cited URL served over https, so the card never links a plain-http page. */
function firstHttpsUrl(citations: WebCitation[] | undefined): string | null {
  for (const { url } of citations ?? []) {
    try {
      if (new URL(url).protocol === 'https:') return url;
    } catch {
      // An unparseable URL is skipped like an http one.
    }
  }
  return null;
}

/**
 * One fact about an album: one model call with web search, never cached here. The prompt names the album, so the
 * call asks the client for quiet errors, and the only log line names the model. The caller decides with
 * `isCacheableResponse(raw, metadata, 'albumTrivia')` whether the reply is complete enough to keep.
 */
export async function generateAlbumTrivia(
  artistName: string,
  albumName: string,
  client: ChatClient
): Promise<AlbumTriviaResult> {
  const config = getTaskConfig('albumTrivia');
  const response = await client.chatCompletion({
    model: config.model,
    messages: buildAlbumTriviaMessages(artistName, albumName),
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    reasoning: config.reasoning,
    verbosity: config.verbosity,
    webSearch: config.webSearch,
    webSearchMaxUses: config.webSearchMaxUses,
    quietErrors: true,
  });

  console.log(
    `[Album Trivia] Model: ${response.metadata?.provider ?? 'unknown'}/${response.metadata?.model ?? config.model}`
  );

  return {
    text: parseAlbumTrivia(response.content),
    sourceUrl: firstHttpsUrl(response.citations),
    raw: response.content,
    metadata: response.metadata,
  };
}
