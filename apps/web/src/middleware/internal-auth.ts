// Internal API authentication middleware
// Validates HMAC-SHA256 signed tokens for internal API endpoints

import type { Context, Next } from 'hono';
import { validateInternalToken } from '../utils/internal-token';

const INTERNAL_TOKEN_HEADER = 'X-Internal-Token';

type Env = {
  Bindings: {
    INTERNAL_API_SECRET: string;
  };
};

export function internalAuthMiddleware() {
  return async (c: Context<Env>, next: Next) => {
    const token = c.req.header(INTERNAL_TOKEN_HEADER);

    if (!token) {
      return c.json({ error: 'Missing internal token' }, 401);
    }

    const secret = c.env.INTERNAL_API_SECRET;

    if (!secret) {
      console.error('INTERNAL_API_SECRET not configured');
      return c.json({ error: 'Server configuration error' }, 500);
    }

    const isValid = await validateInternalToken(token, secret);

    if (!isValid) {
      return c.json({ error: 'Invalid or expired token' }, 401);
    }

    await next();
  };
}
