// Random fact prompt - generates interesting music facts

import { AI_TASKS } from '@listentomore/config';
import type { OpenAIClient } from '../openai';

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
 * Get a random element from an array
 */
function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generate a random music fact using OpenAI
 * Note: This is not cached since each request should return a fresh fact
 */
export async function generateRandomFact(
  client: OpenAIClient
): Promise<RandomFactResult> {
  const config = AI_TASKS.randomFact;

  // Build a randomized prompt
  const genre = randomChoice(GENRES);
  const unit = randomChoice(UNITS);
  const decade = randomChoice(DECADES);
  const focus = randomChoice(FOCUSES);

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

  return {
    fact: response.content.trim(),
    timestamp: new Date().toISOString(),
  };
}
