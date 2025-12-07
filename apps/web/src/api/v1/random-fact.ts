// GET /api/v1/random-fact - Get a random music fact from the cached pool

import { Hono } from 'hono';
import type { Bindings, Variables } from '../../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.get('/', async (c) => {
  const exclude = c.req.query('exclude')?.split(',').filter(Boolean) || [];

  try {
    const cache = c.env.CACHE;
    const KV_KEY = 'random-facts:pool';

    // Get facts from pool
    const stored = await cache.get<{ facts: Array<{ fact: string; timestamp: string }>; lastUpdated: string }>(KV_KEY, 'json');

    if (!stored || stored.facts.length === 0) {
      return c.json({ error: 'No facts available', message: 'Fact pool is empty. Please try again later.' }, 503);
    }

    // Filter out excluded facts (by simple hash of fact text)
    const hashFact = (fact: string) => {
      // Simple hash using Web Crypto-compatible approach
      // Convert to bytes, sum them with position weighting, return hex
      let hash = 0;
      for (let i = 0; i < fact.length; i++) {
        const char = fact.charCodeAt(i);
        hash = ((hash << 5) - hash + char) | 0; // Convert to 32-bit integer
      }
      // Convert to unsigned and then to hex (8 chars)
      return (hash >>> 0).toString(16).padStart(8, '0');
    };

    const availableFacts = stored.facts.filter((f) => !exclude.includes(hashFact(f.fact)));

    if (availableFacts.length === 0) {
      // All facts excluded - return the newest one anyway (better than nothing)
      const newestFact = stored.facts[0];
      return c.json({
        data: {
          fact: newestFact.fact,
          hash: hashFact(newestFact.fact),
          timestamp: newestFact.timestamp,
        },
        warning: 'All facts in pool were excluded. Returning newest fact.',
      });
    }

    // Pick a random fact from available pool
    const randomIndex = Math.floor(Math.random() * availableFacts.length);
    const selectedFact = availableFacts[randomIndex];

    return c.json({
      data: {
        fact: selectedFact.fact,
        hash: hashFact(selectedFact.fact),
        timestamp: selectedFact.timestamp,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('v1 random-fact error:', errorMessage, error);
    return c.json({ error: 'Failed to fetch random fact', details: errorMessage }, 500);
  }
});

export const randomFactRoutes = app;
