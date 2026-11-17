// ABOUTME: Weekly insights note prompt: turns a ranked prompt view of week facts into a note of two or three paragraphs
// ABOUTME: and the names it uses. No cache here; the insights route checks the note and owns caching.

import { getTaskConfig } from '@listentomore/config';
import type { ChatClient, ChatMessage, AIResponseMetadata } from '../types';

/** Bump when the prompt changes so cached notes don't linger. */
export const USER_INSIGHTS_PROMPT_VERSION = 'v8';

/** The note, its paragraphs separated by one blank line, and every artist and album name the model says it used. */
export interface WeekNote {
  note: string;
  names: string[];
}

export interface UserInsightsNoteResult {
  /** The parsed note, or null when the model's output was not a valid `{ note, names }` object. */
  note: WeekNote | null;
  /** The model's text as returned, for `isCacheableResponse()` and debugging. */
  raw: string;
  metadata?: AIResponseMetadata;
}

/**
 * The voice references: the two voice-only notes from the v3 prompt's FEW_SHOT_EXAMPLES (the first is the 2026-06-12
 * gold week), with their em dashes replaced by colons. Their names and numbers are from other weeks.
 */
export const USER_INSIGHTS_VOICE_EXAMPLES: readonly string[] = [
  `Siiga came out of nowhere and took the top spot in a week: Nostalgia Burns at 39 plays, and it slots right into the ambient pocket you already live in next to Celer, Nils Frahm, and Deserta. The Capri remaster got the full front-to-back treatment too, so a lot of this week was pressing play and letting a record run.

Around the ambient stuff, the familiar names held up. You went back to In Rainbows and ran the whole thing. Still the one, no argument. I Built You A Tower stayed in heavy rotation too, and the Raveonettes binge (Pe'ahi II and Lust Lust Lust back to back) was the one loud stretch this week.

The Police live album is the curveball. Certifiable at 21 plays is a lot of stage banter and crowd noise for someone who mostly listens to drone. But Every Breath You Take live still does the job.`,
  `This was an I Built You A Tower week, full stop. You wore the whole record down to the grain: Envy the Birds, Full of Stars, Pep Talk, Stone Over Water all sitting around three plays each. When a Death Cab record clicks for you, it clicks.

Underneath it, the usual ambient names were all there: Nils Frahm at 31, plus Ólafur Arnalds, Stars of the Lid, and Sigur Rós. Seasurfer's Stay was the one new thing that stuck.

Then the weird ones, which are the fun part. Evanescence (Beautiful Lie, How Do I Heal), Michael Jackson, and Chris de Burgh all showed up the same week as Stars of the Lid. No notes. That's a healthy week.`,
];

const SYSTEM_PROMPT =
  "You're a friend who follows someone's scrobbles. Once a week you send them a short note about what they played.";

/**
 * Build the chat messages for the weekly note. Pure: no cache, no client.
 * The prompt view is the only listening data the model sees.
 */
export function buildUserInsightsNoteMessages(promptView: string): ChatMessage[] {
  const userPrompt = `Here is this week's listening, already counted and ranked. It is everything you know about the week.

${promptView}

Write them this week's note, in second person.

- Two or three short paragraphs, 120 to 200 words in all.
- Lead with what defined the week, by name, in a first sentence that could only belong to this week: a day, a run, a record, or an artist can open it. Then connect the facts that belong together, and say what sat alongside them.
- Use a count only when the number itself makes the point, one or two per paragraph at most, and say the rest in words.
- An opinion about a record is welcome when it grows out of what you just said. Phrase it in your own words, as an opinion.
- Every listening claim (a count, a day, an album played start to finish, a return, a first play) comes from the facts above. Leave out what they don't show, and do no arithmetic they don't state. An artist marked "first plays under this name" may have played under another name, so say it that way. The facts give days, not times of day, so name the day and leave out morning, afternoon, and night.
- Keep to the facts above about the records themselves: no release years, band members, labels, or who played on what.
- Leave out guesses about mood or motive.
- Write artist and album names exactly as they appear above.
- Say each thing directly. Use no em dashes and no "not X, it's Y" contrasts.
- No greeting, sign-off, emoji, or question.

The two notes below show the voice. Their artists, albums, and numbers come from other weeks, so use none of them here, and find your own way into this week.

<example>
${USER_INSIGHTS_VOICE_EXAMPLES[0]}
</example>

<example>
${USER_INSIGHTS_VOICE_EXAMPLES[1]}
</example>

Return only JSON: {"note": "<the paragraphs, separated by a blank line>", "names": ["<every artist and album the note names, spelled as above>"]}`;

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];
}

/**
 * The note's paragraphs, each on one line, separated by exactly one blank line: CRLF becomes LF, paragraphs split on
 * blank lines, newlines inside a paragraph become spaces, and empty paragraphs are dropped.
 */
function normaliseParagraphs(note: string): string {
  return note
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, ' ').trim())
    .filter((paragraph) => paragraph !== '')
    .join('\n\n');
}

/**
 * Validate one parsed value as a week note: an object (not an array) whose `note` is a string with text after
 * normalising and whose `names` is an array of strings. Names are trimmed and empty ones dropped; extra keys go.
 */
function toWeekNote(value: unknown): WeekNote | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { note, names } = value as { note?: unknown; names?: unknown };
  if (typeof note !== 'string') return null;
  if (!Array.isArray(names) || !names.every((name) => typeof name === 'string')) return null;
  const text = normaliseParagraphs(note);
  if (text === '') return null;
  return { note: text, names: (names as string[]).map((name) => name.trim()).filter((name) => name !== '') };
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The indexes in `text` where `char` occurs, in order. */
function indexesOf(text: string, char: string): number[] {
  const found: number[] = [];
  for (let i = 0; i < text.length; i++) if (text[i] === char) found.push(i);
  return found;
}

/**
 * Whether the span from `start` to `end` sits inside a JSON array in `raw`: some '[' before it and ']' after it
 * enclose a span that parses as an array. Brackets in prose ("facts [1] and [2]") enclose nothing that parses.
 */
function insideArray(raw: string, start: number, end: number): boolean {
  const opens = indexesOf(raw.slice(0, start), '[');
  const closes = indexesOf(raw, ']').filter((i) => i > end);
  return opens.some((open) => closes.some((close) => Array.isArray(tryParse(raw.slice(open, close + 1)))));
}

/**
 * Parse the model's reply into a week note. Accepts bare JSON, a fenced ```json block, or an object with prose
 * before or after it. Returns null, never throws, for anything else, including an array, bare or wrapped in a fence
 * or prose: wrapping never changes whether a payload passes.
 */
export function parseWeekNote(raw: string): WeekNote | null {
  const whole = tryParse(raw.trim());
  if (whole !== undefined) return toWeekNote(whole);

  // Fences and surrounding prose: try each '{' as the object's start against each '}' as its end, widest first.
  // Prose can hold braces of its own, so the first span that parses is not always the note.
  const starts = indexesOf(raw, '{');
  const ends = indexesOf(raw, '}');
  for (const start of starts) {
    for (let e = ends.length - 1; e >= 0 && ends[e] > start; e--) {
      const note = toWeekNote(tryParse(raw.slice(start, ends[e] + 1)));
      if (note) return insideArray(raw, start, ends[e]) ? null : note;
    }
  }
  return null;
}

/**
 * Generate the weekly note from a prompt view. One model call, no retry and no cache: the route checks the note,
 * decides whether to regenerate, and caches only a checked note through `isCacheableResponse(raw, metadata, ...)`.
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
    // An error body can quote the prompt view, so a failed call logs its status alone.
    quietErrors: true,
  });

  // The prompt view and the note stay out of logs; the model name is enough.
  console.log(
    `[Insights Note] Model: ${response.metadata?.provider ?? 'unknown'}/${response.metadata?.model ?? config.model}`
  );

  return {
    note: parseWeekNote(response.content),
    raw: response.content,
    metadata: response.metadata,
  };
}
