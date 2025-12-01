// Random fact prompt - generates interesting music facts
// Uses CRON job to generate hourly and stores 10 rotating facts in KV

import { AI_TASKS } from '@listentomore/config';
import type { OpenAIClient } from '../openai';

export interface RandomFactResult {
  fact: string;
  timestamp: string;
}

interface StoredFacts {
  facts: RandomFactResult[];
  lastUpdated: string;
}

const KV_KEY = 'random-facts:pool';
const MAX_FACTS = 10;

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
 * Generate a new random fact and add it to the rotating pool in KV
 * Called by CRON job every hour
 */
export async function generateAndStoreFact(
  client: OpenAIClient,
  kv: KVNamespace
): Promise<RandomFactResult> {
  const config = AI_TASKS.randomFact;

  // Build a random prompt for variety
  const genre = randomChoice(GENRES);
  const unit = randomChoice(UNITS);
  const decade = randomChoice(DECADES);
  const focus = randomChoice(FOCUSES);

  const prompt = `Give me an interesting, verifiable fact about a ${genre} ${unit} from the ${decade}, focusing on ${focus}. Use two sentences or less, and start with the phrase "Did you know". Use plain text with no Markdown formatting. Critical instruction: Responses MUST be less than 300 characters in total length. Don't ask me questions about this prompt, just execute it and provide the fact. You don't need to search the web.`;

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

  const newFact: RandomFactResult = {
    fact: response.content.trim(),
    timestamp: new Date().toISOString(),
  };

  // Get existing facts from KV
  const existing = await kv.get<StoredFacts>(KV_KEY, 'json');
  const facts = existing?.facts || [];

  // Add new fact to the front, keep only MAX_FACTS
  facts.unshift(newFact);
  if (facts.length > MAX_FACTS) {
    facts.pop();
  }

  // Store updated pool (no expiration - we manage rotation ourselves)
  await kv.put(
    KV_KEY,
    JSON.stringify({
      facts,
      lastUpdated: new Date().toISOString(),
    } as StoredFacts)
  );

  console.log(`[RandomFact] Generated and stored new fact. Pool size: ${facts.length}`);

  return newFact;
}

/**
 * Get a random fact from the cached pool
 * Called on page load - always fast (just KV read)
 */
export async function getRandomCachedFact(
  kv: KVNamespace
): Promise<RandomFactResult | null> {
  const stored = await kv.get<StoredFacts>(KV_KEY, 'json');

  if (!stored || stored.facts.length === 0) {
    console.log('[RandomFact] No cached facts available');
    return null;
  }

  // Pick a random fact from the pool
  const randomFact = randomChoice(stored.facts);
  console.log(`[RandomFact] Serving cached fact from pool of ${stored.facts.length}`);

  return randomFact;
}

/**
 * Legacy function for backwards compatibility
 * Now just returns a cached fact (fast) instead of generating on-demand
 */
export async function generateRandomFact(
  client: OpenAIClient,
  kv: KVNamespace
): Promise<RandomFactResult> {
  // Try to get a cached fact first (fast path)
  const cached = await getRandomCachedFact(kv);
  if (cached) {
    return cached;
  }

  // Fallback: generate one if pool is empty (e.g., first deployment)
  // This will be slow, but only happens once until CRON populates the pool
  console.log('[RandomFact] Pool empty, generating initial fact...');
  return generateAndStoreFact(client, kv);
}
