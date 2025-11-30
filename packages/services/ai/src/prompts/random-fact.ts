// Random fact prompt - generates interesting music facts
// Cached in KV with hourly rotation per the implementation plan

import { AI_TASKS } from '@listentomore/config';
import type { OpenAIClient } from '../openai';
import type { AICache } from '../cache';

export interface RandomFactResult {
  fact: string;
  timestamp: string;
}

// Categories for randomizing fact requests
const GENRES = [
  'rock',
  'pop',
  'jazz',
  'grunge',
  'electronic',
  'hip-hop',
  'metal',
  'alternative',
  'indie rock',
  'singer-songwriter',
  'blues',
  'soul',
  'punk',
  'country',
  'dance',
];

const UNITS = ['music artist', 'band', 'song', 'cover version'];

const DECADES = [
  '1960s or 1970s',
  '1980s',
  '1990s',
  '2000s',
  '2010s',
  '2020s',
];

const FOCUSES = [
  'cultural impact',
  'historical significance',
  'musical innovation',
  'collaboration',
  'live performance',
];

/**
 * Get a random element from an array using a seed
 */
function seededChoice<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length];
}

/**
 * Generate a random music fact using OpenAI
 * Cached in KV with hourly rotation - uses hour-based slots for variety
 * while keeping page loads fast
 */
export async function generateRandomFact(
  client: OpenAIClient,
  cache: AICache
): Promise<RandomFactResult> {
  // Use current hour as cache slot (rotates every hour, 24 variations per day)
  const hourSlot = new Date().getUTCHours();

  // Check cache first
  const cached = await cache.get<RandomFactResult>('randomFact', `slot`, `${hourSlot}`);
  if (cached) {
    return cached;
  }

  const config = AI_TASKS.randomFact;

  // Build a deterministic prompt based on hour slot for consistency
  const genre = seededChoice(GENRES, hourSlot);
  const unit = seededChoice(UNITS, hourSlot + 1);
  const decade = seededChoice(DECADES, hourSlot + 2);
  const focus = seededChoice(FOCUSES, hourSlot + 3);

  const prompt = `Give me an interesting, verifiable fact about a ${genre} ${unit} from the ${decade}, focusing on ${focus}. Use two sentences or less, and start with the phrase "Did you know". Use plain text with no Markdown formatting. Critical instruction: Responses MUST be less than 300 characters in total length.`;

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

  const result: RandomFactResult = {
    fact: response.content.trim(),
    timestamp: new Date().toISOString(),
  };

  // Cache with 2 hour TTL (overlapping ensures fresh facts each hour)
  await cache.set('randomFact', [`slot`, `${hourSlot}`], result, 2 * 60 * 60);

  return result;
}
