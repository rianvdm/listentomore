// Authentication middleware for API key validation
// Provides tiered access control with different rate limits per tier

import { Context, MiddlewareHandler } from 'hono';
import { createServiceDefer } from '@listentomore/shared';
import { ParsedApiKey, ApiKeyScope } from '@listentomore/db';
import { getWaitUntil } from '../utils/wait-until';

/**
 * Authentication middleware
 * Extracts and validates API key from X-API-Key header
 * Attaches parsed key to context for downstream use
 */
export function authMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const apiKeyHeader = c.req.header('X-API-Key');
    const db = c.get('db');

    let apiKey: ParsedApiKey | null = null;

    if (apiKeyHeader) {
      try {
        apiKey = await db.validateApiKey(apiKeyHeader);
      } catch (error) {
        console.error('API key validation error:', error);
        // Don't fail the request, just treat as unauthenticated
      }
    }

    // Set context variables
    c.set('apiKey', apiKey);
    c.set('authTier', apiKey?.tier ?? 'public');

    return next();
  };
}

/**
 * Require authentication middleware
 * Use this on routes that require a valid API key
 */
export function requireAuth(options?: {
  minTier?: 'standard' | 'premium';
  requiredScopes?: ApiKeyScope[];
}): MiddlewareHandler {
  return async (c, next) => {
    const apiKey = c.get('apiKey') as ParsedApiKey | null;

    if (!apiKey) {
      return c.json(
        {
          error: 'Unauthorized',
          message: 'Valid API key required. Include X-API-Key header.',
        },
        401
      );
    }

    // Check tier requirement
    if (options?.minTier) {
      const tierOrder: Record<string, number> = { public: 0, standard: 1, premium: 2 };
      if (tierOrder[apiKey.tier] < tierOrder[options.minTier]) {
        return c.json(
          {
            error: 'Forbidden',
            message: `This endpoint requires ${options.minTier} tier or higher.`,
          },
          403
        );
      }
    }

    // Check scope requirements
    if (options?.requiredScopes) {
      const hasAllScopes = options.requiredScopes.every((scope) =>
        apiKey.scopes.includes(scope)
      );
      if (!hasAllScopes) {
        return c.json(
          {
            error: 'Forbidden',
            message: `Missing required scopes: ${options.requiredScopes.join(', ')}`,
          },
          403
        );
      }
    }

    return next();
  };
}

/**
 * Per-user rate limiting middleware
 * Uses the authenticated user's tier to determine rate limits
 * Falls back to public tier limits for unauthenticated requests
 */
export function userRateLimitMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const cache = c.env.CACHE;
    if (!cache) {
      console.warn('User rate limiting skipped: CACHE KV not available');
      return next();
    }

    const apiKey = c.get('apiKey');
    const db = c.get('db');

    // Determine rate limit and identifier
    const rateLimit = db.getEffectiveRateLimit(apiKey);
    const identifier = apiKey?.id ?? getClientIP(c);
    const windowMs = 60_000; // 1 minute window

    const windowStart = Math.floor(Date.now() / windowMs);
    const key = `ratelimit:user:${identifier}:${windowStart}`;

    try {
      const currentCount = await cache.get(key);
      const count = currentCount ? parseInt(currentCount, 10) : 0;

      // Set rate limit headers
      c.header('X-RateLimit-Limit', rateLimit.toString());
      c.header('X-RateLimit-Remaining', Math.max(0, rateLimit - count - 1).toString());
      c.header('X-RateLimit-Reset', ((windowStart + 1) * windowMs).toString());
      c.header('X-RateLimit-Tier', apiKey?.tier ?? 'public');

      if (count >= rateLimit) {
        c.header('Retry-After', Math.ceil(windowMs / 1000).toString());
        return c.json(
          {
            error: 'Too many requests',
            message: `Rate limit exceeded (${rateLimit} req/min for ${apiKey?.tier ?? 'public'} tier). Please try again later.`,
            tier: apiKey?.tier ?? 'public',
            limit: rateLimit,
          },
          429
        );
      }

      // Increment counter.
      // Note: KV does not support atomic compare-and-swap, so this read-then-write
      // is inherently racy under concurrent requests. Parallel requests can read the
      // same count and each write count+1, allowing a client to exceed their limit
      // proportional to their concurrency. This is intentionally accepted as a soft
      // limit. For a hard rate limit, migrate to Durable Objects.
      await cache.put(key, (count + 1).toString(), {
        expirationTtl: Math.ceil(windowMs / 1000) + 1,
      });

      // Track usage in database off the response path
      if (apiKey) {
        createServiceDefer('[API]', getWaitUntil(c))(
          db.incrementApiKeyUsage(apiKey.id),
          'API key usage increment'
        );
      }
    } catch (error) {
      console.error('User rate limit error:', error);
      // On error, allow request through
    }

    return next();
  };
}

/**
 * Get client IP from request headers
 */
function getClientIP(c: Context): string {
  return (
    c.req.header('CF-Connecting-IP') ||
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    c.req.header('X-Real-IP') ||
    'unknown'
  );
}

/**
 * API usage logging middleware
 * Logs all API requests for analytics
 */
// Progressive-loading calls from our own pages. They are fully visible in Workers
// Observability and would add up to ~49 D1 rows per home view, so they are not logged.
const UNLOGGED_PATH_PREFIX = '/api/internal/';

export function apiLoggingMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.path.startsWith(UNLOGGED_PATH_PREFIX)) {
      return next();
    }

    const startTime = Date.now();

    await next();

    const responseTime = Date.now() - startTime;
    const apiKey = c.get('apiKey');
    const db = c.get('db');

    // Log usage without blocking the response. waitUntil keeps the INSERT alive
    // after the response is sent; without it the runtime can drop the write.
    createServiceDefer('[API]', getWaitUntil(c))(
      db.logApiUsage({
        apiKeyId: apiKey?.id,
        endpoint: c.req.path,
        method: c.req.method,
        statusCode: c.res.status,
        ipAddress: getClientIP(c),
        userAgent: c.req.header('User-Agent'),
        responseTimeMs: responseTime,
      }),
      'API usage log'
    );
  };
}
