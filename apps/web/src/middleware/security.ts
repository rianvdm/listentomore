// Security middleware for API protection
// Includes CORS, rate limiting, and origin validation

import { Context, Next, MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';

// Environment bindings type
type Env = {
  Bindings: {
    CACHE: KVNamespace;
    ENVIRONMENT?: string;
  };
};

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
  'https://listentomore-web.rian-db8.workers.dev',
  'https://listentomore.com', // Future custom domain
];

// Development origins (only allowed when ENVIRONMENT !== 'production')
const DEV_ORIGINS = ['http://localhost:8787', 'http://127.0.0.1:8787'];

/**
 * CORS middleware configured for this application
 */
export function corsMiddleware(env: { ENVIRONMENT?: string }): MiddlewareHandler {
  const origins =
    env.ENVIRONMENT === 'production' ? ALLOWED_ORIGINS : [...ALLOWED_ORIGINS, ...DEV_ORIGINS];

  return cors({
    origin: origins,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400, // 24 hours
    credentials: false,
  });
}

/**
 * Rate limiting configuration
 */
interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
  keyPrefix?: string; // KV key prefix
}

const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60_000, // 1 minute
  maxRequests: 60, // 60 requests per minute
  keyPrefix: 'ratelimit',
};

/**
 * Get client IP from request headers
 * Cloudflare provides the real IP in CF-Connecting-IP header
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
 * Rate limiting middleware using KV storage
 * Implements a sliding window counter algorithm
 */
export function rateLimitMiddleware(config: Partial<RateLimitConfig> = {}): MiddlewareHandler<Env> {
  const { windowMs, maxRequests, keyPrefix } = { ...DEFAULT_RATE_LIMIT, ...config };

  return async (c: Context<Env>, next: Next) => {
    const cache = c.env.CACHE;
    if (!cache) {
      // If KV is not available, skip rate limiting
      console.warn('Rate limiting skipped: CACHE KV not available');
      return next();
    }

    const clientIP = getClientIP(c);
    const windowStart = Math.floor(Date.now() / windowMs);
    const key = `${keyPrefix}:${clientIP}:${windowStart}`;

    try {
      // Get current request count
      const currentCount = await cache.get(key);
      const count = currentCount ? parseInt(currentCount, 10) : 0;

      // Set rate limit headers
      c.header('X-RateLimit-Limit', maxRequests.toString());
      c.header('X-RateLimit-Remaining', Math.max(0, maxRequests - count - 1).toString());
      c.header('X-RateLimit-Reset', ((windowStart + 1) * windowMs).toString());

      if (count >= maxRequests) {
        c.header('Retry-After', Math.ceil(windowMs / 1000).toString());
        return c.json(
          {
            error: 'Too many requests',
            message: `Rate limit exceeded. Please try again in ${Math.ceil(windowMs / 1000)} seconds.`,
          },
          429
        );
      }

      // Increment counter with TTL matching window
      await cache.put(key, (count + 1).toString(), {
        expirationTtl: Math.ceil(windowMs / 1000) + 1,
      });
    } catch (error) {
      // On KV error, log and allow request through
      console.error('Rate limit error:', error);
    }

    return next();
  };
}

/**
 * Origin validation middleware
 * Validates that requests to API endpoints come from allowed origins
 * This provides an additional layer of security beyond CORS
 */
export function originValidationMiddleware(env: {
  ENVIRONMENT?: string;
}): MiddlewareHandler {
  const validOrigins =
    env.ENVIRONMENT === 'production' ? ALLOWED_ORIGINS : [...ALLOWED_ORIGINS, ...DEV_ORIGINS];

  return async (c: Context, next: Next) => {
    // Skip validation for preflight requests
    if (c.req.method === 'OPTIONS') {
      return next();
    }

    // Get origin or referer header
    const origin = c.req.header('Origin');
    const referer = c.req.header('Referer');

    // In production, require valid origin/referer for API requests
    if (env.ENVIRONMENT === 'production') {
      // Allow same-origin requests (no Origin header for same-origin in some browsers)
      if (!origin && !referer) {
        // Could be a direct API call - check if it's from Cloudflare Worker context
        const cfRay = c.req.header('CF-Ray');
        if (!cfRay) {
          // Not a Cloudflare request and no origin - block it
          return c.json(
            {
              error: 'Forbidden',
              message: 'API access requires valid origin',
            },
            403
          );
        }
        // Allow Cloudflare internal requests (e.g., scheduled workers)
        return next();
      }

      // Validate origin
      if (origin && !validOrigins.includes(origin)) {
        return c.json(
          {
            error: 'Forbidden',
            message: 'Origin not allowed',
          },
          403
        );
      }

      // Validate referer if no origin
      if (!origin && referer) {
        const refererOrigin = new URL(referer).origin;
        if (!validOrigins.includes(refererOrigin)) {
          return c.json(
            {
              error: 'Forbidden',
              message: 'Referer not allowed',
            },
            403
          );
        }
      }
    }

    return next();
  };
}

/**
 * Security headers middleware
 * Adds common security headers to all responses
 */
export function securityHeadersMiddleware(): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    await next();

    // Add security headers
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('X-XSS-Protection', '1; mode=block');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Remove server header if present
    c.res.headers.delete('Server');
  };
}

/**
 * Combined security middleware
 * Applies all security measures in the correct order
 */
export function createSecurityMiddleware(env: { ENVIRONMENT?: string; CACHE?: KVNamespace }): {
  cors: MiddlewareHandler;
  rateLimit: MiddlewareHandler<Env>;
  originValidation: MiddlewareHandler;
  securityHeaders: MiddlewareHandler;
} {
  return {
    cors: corsMiddleware(env),
    rateLimit: rateLimitMiddleware(),
    originValidation: originValidationMiddleware(env),
    securityHeaders: securityHeadersMiddleware(),
  };
}
