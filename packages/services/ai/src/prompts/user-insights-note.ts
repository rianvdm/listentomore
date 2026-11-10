// ABOUTME: Weekly insights note prompt: turns a ranked prompt view of week facts into cited sentences.
// ABOUTME: No cache here; the insights route guards the sentences and owns caching.

import { getTaskConfig } from '@listentomore/config';
import type { ChatClient, ChatMessage, AIResponseMetadata } from '../types';

/** Bump when the prompt changes so cached notes don't linger. */
export const USER_INSIGHTS_PROMPT_VERSION = 'v6';

/**
 * One sentence of the note and the ids of the facts it draws on.
 * Same shape as `NoteSentence` in @listentomore/insights (its guard checks
 * these); declared here too so the AI package takes no dependency on it.
 */
export interface NoteSentence {
  text: string;
  facts: number[];
}

export interface UserInsightsNoteResult {
  /** Parsed sentences, or null when the model's output was not a valid array. */
  sentences: NoteSentence[] | null;
  /** The model's text as returned, for `isCacheableResponse()` and debugging. */
  raw: string;
  metadata?: AIResponseMetadata;
}

const SYSTEM_PROMPT =
  "You're a friend who follows someone's scrobbles. Once a week you send them a short note about what they played.";

/**
 * Build the chat messages for the weekly note. Pure: no cache, no client.
 * The prompt view is the only listening data the model sees.
 */
export function buildUserInsightsNoteMessages(promptView: string): ChatMessage[] {
  const userPrompt = `Here is this week's listening, already measured and ranked. It is the only thing you know.

${promptView}

Write the note, in second person. Two to four sentences. Lead with the most notable item (fact 1). If two or three of the top items connect in a way the facts themselves show, say so in one sentence; if they don't connect, say only the top one or two things. Under 90 words. No greeting, no sign-off, no emoji, no question.

Rules:
- Use only what is in the facts. If something is not listed, it did not happen. Quote no number that is not there, and do no arithmetic beyond what the facts state.
- Never write "never", "first time" or "first ever". For an artist with no earlier plays, say "first plays under this name".
- Give a number only for one named artist or album. Don't attach a number to a group ("the other three", "both of those").
- Say nothing about how the music sounds. No adjectives for music, records or songs. You have not heard these records.
- Do not guess at reasons, moods, taste or personality, and do not say what a choice "says" about them.
- Do not contrast by negation ("not X, it's Y", "rather than", "less X, more Y"). No em dashes. No cliches.
- Plain words. Mix short and long sentences. Use artist and album names exactly as given.

Return only a JSON array, one object per sentence: [{"text": "...", "facts": [1]}]. "facts" lists the numbers of the facts that sentence draws on.`;

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];
}

/**
 * Validate one parsed value as a non-empty list of sentences, each with
 * non-empty text and at least one integer fact id. Extra keys are dropped.
 */
function toNoteSentences(value: unknown): NoteSentence[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  const sentences: NoteSentence[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return null;
    const { text, facts } = item as { text?: unknown; facts?: unknown };
    if (typeof text !== 'string' || text.trim() === '') return null;
    if (!Array.isArray(facts) || facts.length === 0) return null;
    if (!facts.every((id) => Number.isInteger(id))) return null;
    sentences.push({ text: text.trim(), facts: facts as number[] });
  }
  return sentences;
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Parse the model's note into sentences. Accepts a bare JSON array, a fenced
 * ```json block, or an array with prose before or after it. Returns null,
 * never throws, for anything else, including an empty array.
 */
export function parseNoteSentences(raw: string): NoteSentence[] | null {
  const whole = toNoteSentences(tryParse(raw.trim()));
  if (whole) return whole;

  // Fences and surrounding prose: try each '[' as the array's start against
  // each ']' as its end, widest first. Prose can hold brackets of its own
  // ("facts [1] and [2]"), so the first span that parses is not always the note.
  const starts: number[] = [];
  const ends: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '[') starts.push(i);
    else if (raw[i] === ']') ends.push(i);
  }
  for (const start of starts) {
    for (let e = ends.length - 1; e >= 0 && ends[e] > start; e--) {
      const sentences = toNoteSentences(tryParse(raw.slice(start, ends[e] + 1)));
      if (sentences) return sentences;
    }
  }
  return null;
}

/**
 * Generate the weekly note from a prompt view. One model call, no retry and no
 * cache: the route runs the guard, decides whether to regenerate, and caches
 * only a guarded note through `isCacheableResponse(raw, metadata, ...)`.
 */
export async function generateUserInsightsNote(
  promptView: string,
  client: ChatClient
): Promise<UserInsightsNoteResult> {
  const config = getTaskConfig('userInsightsSummary');

  const response = await client.chatCompletion({
    model: config.model,
    messages: buildUserInsightsNoteMessages(promptView),
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    reasoning: config.reasoning,
    verbosity: config.verbosity,
  });

  // The prompt view and the note stay out of logs; the model name is enough.
  console.log(
    `[Insights Note] Model: ${response.metadata?.provider ?? 'unknown'}/${response.metadata?.model ?? config.model}`
  );

  return {
    sentences: parseNoteSentences(response.content),
    raw: response.content,
    metadata: response.metadata,
  };
}
