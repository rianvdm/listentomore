// POST /api/v1/ask - Chat with the music AI

import { Hono } from 'hono';
import type { Bindings, Variables } from '../../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const question = body.question;

    if (!question || typeof question !== 'string') {
      return c.json({ error: 'Missing required field: question' }, 400);
    }

    const ai = c.get('ai');
    const result = await ai.askListenAI(question);

    return c.json({
      data: {
        question,
        answer: result.response,
        // Include metadata for debugging (shows actual model, API used, features, etc.)
        metadata: result.metadata,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('v1 ask error:', errorMessage, error);
    return c.json({ error: 'Failed to generate response', details: errorMessage }, 500);
  }
});

export const askRoutes = app;
