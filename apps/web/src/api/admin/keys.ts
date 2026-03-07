// Admin endpoint to create API keys
// Always requires X-Admin-Secret header matching the ADMIN_SECRET env var

import { Hono } from 'hono';
import type { Bindings, Variables } from '../../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/**
 * Constant-time string comparison to prevent timing attacks on the admin secret.
 */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  // Pad to the same length so length itself doesn't leak information
  const maxLen = Math.max(aBytes.length, bBytes.length);
  const aPadded = new Uint8Array(maxLen);
  const bPadded = new Uint8Array(maxLen);
  aPadded.set(aBytes);
  bPadded.set(bBytes);
  return crypto.subtle.timingSafeEqual(aPadded, bPadded);
}

app.post('/keys', async (c) => {
  const adminSecret = c.req.header('X-Admin-Secret');

  // Always require admin secret - no exceptions.
  // Use constant-time comparison to prevent timing attacks.
  const secretConfigured = !!c.env.ADMIN_SECRET;
  const secretMatch = secretConfigured
    ? await timingSafeEqual(adminSecret ?? '', c.env.ADMIN_SECRET!)
    : false;

  if (!secretConfigured || !secretMatch) {
    return c.json({ error: 'Unauthorized', message: 'Admin access required' }, 401);
  }

  try {
    const body = await c.req.json<{
      name?: string;
      tier?: 'standard' | 'premium';
      scopes?: ('read' | 'write' | 'ai')[];
    }>();

    const db = c.get('db');
    const result = await db.createApiKey({
      name: body.name,
      tier: body.tier || 'standard',
      scopes: body.scopes || ['read'],
    });

    return c.json({
      message: 'API key created successfully',
      key: result.key, // Only returned once!
      keyPrefix: result.record.key_prefix,
      tier: result.record.tier,
      scopes: result.record.scopes,
      warning: 'Save this key - it will not be shown again!',
    });
  } catch (error) {
    console.error('Failed to create API key:', error);
    return c.json({ error: 'Failed to create API key' }, 500);
  }
});

export const keysAdminRoutes = app;
