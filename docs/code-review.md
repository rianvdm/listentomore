# ListenToMore Code Review

**Review Type:** CODEBASE_AUDIT

**What was reviewed:** Full codebase analysis of the ListenToMore music discovery web application

**Context:** Hono-based Cloudflare Workers app with Turborepo monorepo, integrating Spotify, Last.fm, OpenAI, and Perplexity APIs

---

## Summary

ListenToMore is a well-architected music discovery application with thoughtful design patterns including progressive loading, tiered API authentication, and intelligent caching. The monorepo structure provides clean separation between services, and the single-Worker constraint is respected throughout. Security fundamentals are strong (HMAC tokens, API key hashing, rate limiting), but XSS vulnerabilities in progressive loading scripts and insufficient input validation require immediate attention.

---

## Strengths

- **Clean architecture** - Clear separation between `pages/`, `api/`, `components/`, `middleware/` with services isolated in `/packages/` (`apps/web/src/`)
- **Strong authentication system** - Tiered API keys with hashed storage, scope-based permissions, and rate limiting per tier (`middleware/auth.ts:40-145`)
- **Internal API security** - HMAC-SHA256 signed tokens with 5-minute expiry prevent CSRF (`utils/internal-token.ts`)
- **Progressive loading pattern** - Pages render immediately with fast data, slow data (AI, streaming links) loads via client-side fetch (`pages/album/detail.tsx`, `pages/artist/detail.tsx`)
- **Intelligent cache TTLs** - Differentiated by data freshness: 30 days for Spotify, 1 hour for Last.fm top items, 120-180 days for AI (`packages/config/src/cache.ts`)
- **Security headers applied globally** - X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy (`middleware/security.ts`)
- **Consistent error handling** - All routes wrapped in try-catch with proper HTTP status codes and error utilities
- **Type safety throughout** - Well-defined Bindings/Variables types, service interfaces, and database schema types (`apps/web/src/types.ts`)

---

## Issues

### Critical (Must Fix Before Production Changes)

**1. XSS via innerHTML in progressive loading scripts**
- Location: `apps/web/src/pages/album/detail.tsx`, `apps/web/src/pages/artist/detail.tsx`, `apps/web/src/pages/user/stats.tsx`, and 50+ uses of `dangerouslySetInnerHTML`
- Problem: User-controlled data (artist names, album titles, query parameters) inserted into HTML via `innerHTML` assignments without sanitization
- Impact: Attackers could inject malicious scripts via crafted artist/album names
- Suggestion: Replace `innerHTML` with `textContent` for text content, or use `createElement` for DOM construction:
  ```javascript
  // Instead of:
  element.innerHTML = '<a href="...">' + artistName + '</a>';

  // Use:
  const link = document.createElement('a');
  link.href = '...';
  link.textContent = artistName;
  element.appendChild(link);
  ```

**2. Token embedded in page source**
- Location: `apps/web/src/components/layout/Layout.tsx:90`
- Problem: `window.__INTERNAL_TOKEN__ = '${internalToken}'` exposes auth token in HTML
- Impact: Token visible in view-source, could be logged in browser history or error tracking
- Suggestion: Consider passing token via HTTP-only cookie or fetching via authenticated endpoint. The 5-minute expiry mitigates but doesn't eliminate risk.

---

### Important (Should Fix)

**1. Unvalidated query parameter lengths**
- Location: All API endpoints (`api/v1/*.ts`, `api/internal/*.ts`)
- Problem: Parameters like `artist`, `album`, `q` accept arbitrary length strings
- Impact: DoS via extremely long strings, cache key pollution, potential memory exhaustion
- Suggestion: Add validation middleware:
  ```typescript
  const MAX_PARAM_LENGTH = 500;
  app.use('/api/*', (c, next) => {
    for (const [key, value] of Object.entries(c.req.query())) {
      if (typeof value === 'string' && value.length > MAX_PARAM_LENGTH) {
        return c.json({ error: `Parameter '${key}' exceeds maximum length` }, 400);
      }
    }
    return next();
  });
  ```

**2. Error details exposed to clients**
- Location: `api/v1/album.ts:114`, `api/v1/artist.ts`, and similar
- Problem: Full error messages returned in API responses: `{ error: '...', details: errorMessage }`
- Impact: Could reveal internal API structure, paths, or sensitive configuration
- Suggestion: Log full error server-side, return generic message to clients:
  ```typescript
  const isProduction = c.env.ENVIRONMENT === 'production';
  return c.json({
    error: 'Failed to fetch album',
    ...(isProduction ? {} : { details: errorMessage }),
  }, 500);
  ```

**3. No circuit breaker for external APIs**
- Location: `packages/services/src/spotify/`, `packages/services/src/ai/`
- Problem: If external APIs (Spotify, OpenAI, Perplexity) fail repeatedly, requests continue to be made
- Impact: Cascading failures, wasted requests during outages, poor user experience
- Suggestion: Implement circuit breaker pattern with exponential backoff:
  ```typescript
  class CircuitBreaker {
    private failures = 0;
    private lastFailure = 0;
    private readonly threshold = 5;
    private readonly resetTime = 30000; // 30s

    async call<T>(fn: () => Promise<T>): Promise<T> {
      if (this.isOpen()) {
        throw new Error('Circuit breaker open');
      }
      try {
        const result = await fn();
        this.failures = 0;
        return result;
      } catch (e) {
        this.failures++;
        this.lastFailure = Date.now();
        throw e;
      }
    }

    private isOpen(): boolean {
      return this.failures >= this.threshold &&
             Date.now() - this.lastFailure < this.resetTime;
    }
  }
  ```

**4. CRON job could exceed Worker timeout**
- Location: `apps/web/src/index.tsx` (scheduled handler)
- Problem: User data fetch + Spotify enrichment for all users could exceed 30s Worker limit
- Impact: Incomplete pre-warming, potential dropped work
- Suggestion: Add early exit check and batch processing:
  ```typescript
  const startTime = Date.now();
  const MAX_RUNTIME = 25000; // 25s safety margin

  for (const user of users) {
    if (Date.now() - startTime > MAX_RUNTIME) {
      console.log('CRON: Exiting early to avoid timeout');
      break;
    }
    // Process user...
  }
  ```

**5. Fire-and-forget database writes without retry**
- Location: `apps/web/src/middleware/auth.ts:145`
- Problem: `db.incrementApiKeyUsage(apiKey.id).catch(...)` silently fails
- Impact: Usage tracking becomes inaccurate over time
- Suggestion: Consider queuing failed writes for retry, or at minimum add metrics on failure rate

**6. Inconsistent cache key normalization**
- Location: Various service files in `packages/services/`
- Problem: Some keys use `toLowerCase().trim()`, others don't normalize at all
- Impact: Cache misses for similar requests (e.g., "Radiohead" vs "radiohead")
- Suggestion: Centralize key generation with consistent normalization:
  ```typescript
  function cacheKey(prefix: string, ...parts: string[]): string {
    return `${prefix}:${parts.map(p => p.toLowerCase().trim()).join(':')}`;
  }
  ```

---

### Minor (Consider Fixing)

**1. Magic strings throughout codebase**
- Location: Cache key prefixes (`ai:`, `spotify:`, `user-listens:v2:`), API paths
- Problem: Refactoring-prone, easy to introduce typos
- Suggestion: Extract to constants:
  ```typescript
  const CACHE_PREFIX = {
    AI: 'ai',
    SPOTIFY: 'spotify',
    USER_LISTENS: 'user-listens:v2',
  } as const;
  ```

**2. Repeated validation logic**
- Location: 20+ occurrences across API routes
- Problem: Same pattern repeated: `if (!artist || !album) { return c.json({...}, 400); }`
- Suggestion: Extract to validation helper or middleware

**3. Long inline scripts difficult to maintain**
- Location: Progressive loading scripts in page components (some exceed 100 lines)
- Problem: Hard to test, lint, and maintain
- Suggestion: Extract complex scripts to `/public/js/` files and load via `<script src>`

**4. Type assertions in tests**
- Location: `apps/web/src/__tests__/services/*.test.ts`
- Problem: `as any` used to bypass type checking: `mockAuth as any`
- Impact: Tests may not catch actual type incompatibilities
- Suggestion: Create proper mock types that satisfy interfaces

**5. No API versioning strategy**
- Location: `apps/web/src/api/v1/`
- Problem: Only v1 exists with no forward compatibility planning
- Suggestion: Document versioning strategy, consider deprecation headers when needed

**6. Limited test coverage**
- Location: `apps/web/src/__tests__/`
- Problem: Only unit tests for services; no integration, e2e, or component tests
- Suggestion: Add integration tests for critical API paths, test progressive loading behavior

---

## Questions

- Is there a reason `fetch()` is allowed in some page components instead of `internalFetch()`? Are those intentionally public endpoints?
- Should failed API key usage tracking be alerted on, or is silent logging acceptable?
- What's the expected user growth rate? The CRON job may need batching/pagination.
- Are there plans to add rate limiting to anonymous API access (currently only authenticated requests are limited)?

---

## Recommendations

1. **Security audit with OWASP payloads** - Test all user input paths with standard XSS vectors
2. **Add Content Security Policy header** - Restrict inline scripts, would catch future XSS issues:
   ```typescript
   "Content-Security-Policy": "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'"
   ```
3. **Implement structured logging** - Current `console.log` makes parsing difficult; consider JSON-formatted logs
4. **Add health check with dependency status** - Current `/health` is basic; could report external API status
5. **OpenAPI documentation** - Auto-generate from route definitions, host on `/api/docs`
6. **Database query logging** - Add duration tracking to identify slow queries
7. **Feature flags system** - Enable gradual rollouts and quick rollbacks

---

## Verdict

**Ready to merge:** Yes, after addressing Critical and Important issues

**Confidence:** High - Reviewed all major directories, middleware chain, API routes, and service implementations. XSS and input validation issues are clear patterns that need remediation.

---

## Appendix: Files Reviewed

### Core Application
- `apps/web/src/index.tsx` - Entry point, middleware, routes
- `apps/web/src/types.ts` - Type definitions
- `apps/web/src/api/**/*.ts` - All API routes
- `apps/web/src/pages/**/*.tsx` - Page components
- `apps/web/src/middleware/*.ts` - Auth, security, rate limiting
- `apps/web/src/utils/*.ts` - Helpers and utilities
- `apps/web/src/components/**/*.tsx` - UI components

### Packages
- `packages/services/src/**/*.ts` - Spotify, AI, Last.fm, Songlink services
- `packages/db/src/index.ts` - Database client
- `packages/config/src/*.ts` - Configuration
- `packages/shared/src/**/*.ts` - Shared utilities

### Tests
- `apps/web/src/__tests__/**/*.test.ts` - Unit tests
