# Observability Issues fixes (#35) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four problems in issue #35: slug URLs 404, OpenAI geoblock returns `{ data: null }`, MusicBrainz requests serialised through a Durable Object, and query strings stripped from `TimeoutError`.

**Architecture:** Three small, contained fixes (items 1, 2, 4) plus a Durable Object rate limiter (item 3). The DO lives in the existing web Worker. Its slot arithmetic is a pure function in the musicbrainz package, and the package depends only on a small `MusicBrainzRateLimiter` interface, so its node-based Vitest suite keeps working.

**Tech Stack:** Hono on Cloudflare Workers, TypeScript (strict), pnpm + Turborepo, Vitest (node environment), Wrangler 4.140, Durable Objects (SQLite-backed class, RPC).

**Spec:** `docs/superpowers/specs/2026-09-28-observability-issues-35-design.md`

## Global Constraints

- Red/green TDD for every behaviour change: write the failing test, run it and see the expected failure, write the minimum code, run it green.
- Branch: `fix/observability-issues-35` in the main clone (`/Users/rian/git/listentomore`). No worktree.
- Every commit message references `#35` and ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- New files start with two `// ABOUTME:` lines. 2-space indent, semicolons, single quotes, trailing commas, `import type` for type-only imports.
- Error handling follows AGENTS.md: `error instanceof Error ? error.message : String(error)`, `console.error` with a contextual prefix for real failures.
- Single Worker: do not create a new Worker. The Durable Object class is exported from `apps/web/src/index.tsx`.
- MusicBrainz spacing: `intervalMs = 1100`, `maxWaitMs = 5000`.
- Durable Object binding name `MUSICBRAINZ_RATE_LIMITER`, class `MusicBrainzRateLimiterDO`, migration `tag = "v1"`, `new_sqlite_classes`.
- Do not deploy. `wrangler deploy --dry-run` is allowed.
- Commands run from the repo root: `cd /Users/rian/git/listentomore`.

## Review Focus

1. **A 22-character slug with no punctuation** (e.g. `radioheadpablohoneyabc`) passes `isSpotifyId`, reaches Spotify, and renders today's "Failed to load" page. This is accepted: the 404 targets the slug shape seen in the logs, and Spotify is the authority on real IDs. Pinned in Task 2 by a test asserting that exactly-22-alphanumeric input is treated as an ID.
2. **An OpenAI 403 whose body isn't JSON** (an HTML error page from a proxy) must fall through to the existing error path, not throw a parse error or a `RegionUnsupportedError`. Pinned in Task 3.
3. **The Durable Object is unreachable or `reserve` rejects.** The MusicBrainz lookup should log at error, return `null`, not call MusicBrainz, and not cache. Pinned in Task 5.
4. **A queue-full or 503 on the second call of a lookup** (MBID follow-up or ISRC attempt) must not cache `null` for 30 days. Today the inner lookups swallow errors, so the outer function caches `__null__`. Pinned in Task 5 for both UPC and ISRC.
5. **A `TimeoutError` built from a URL that `new URL()` can't parse** (a relative path) must still strip the query string. Pinned in Task 1.

---

### Task 1: Strip query strings from `TimeoutError`

**Files:**
- Modify: `packages/shared/src/utils/fetch.ts` (the `TimeoutError` class, ~lines 26-34)
- Test (create): `apps/web/src/__tests__/utils/fetch-timeout.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `TimeoutError(url: string, timeoutMs: number)`, whose `url` and `message` never contain `?` or `#` content. Constructor signature unchanged. `TimeoutError` is only used inside `fetch.ts` (checked with `grep -rn TimeoutError apps packages`).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/__tests__/utils/fetch-timeout.test.ts`:

```ts
// ABOUTME: Tests for TimeoutError URL redaction.
// ABOUTME: Query strings can carry API keys, so they must never reach error messages or logs.

import { describe, it, expect } from 'vitest';
import { TimeoutError } from '@listentomore/shared';

describe('TimeoutError', () => {
  it('strips the query string from the message and url', () => {
    const error = new TimeoutError(
      'https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=calisza&api_key=secret123&limit=1&format=json',
      10000,
    );

    expect(error.message).toBe('Request to https://ws.audioscrobbler.com/2.0/ timed out after 10000ms');
    expect(error.url).toBe('https://ws.audioscrobbler.com/2.0/');
    expect(error.message).not.toContain('secret123');
    expect(error.url).not.toContain('?');
  });

  it('strips fragments', () => {
    const error = new TimeoutError('https://example.com/callback#token=abc', 5000);

    expect(error.url).toBe('https://example.com/callback');
    expect(error.message).not.toContain('token=abc');
  });

  it('strips the query string from URLs that cannot be parsed', () => {
    const error = new TimeoutError('/relative/path?api_key=secret123', 5000);

    expect(error.url).toBe('/relative/path');
    expect(error.message).toBe('Request to /relative/path timed out after 5000ms');
  });

  it('leaves a URL without a query string unchanged', () => {
    const error = new TimeoutError('https://api.spotify.com/v1/albums/abc', 10000);

    expect(error.url).toBe('https://api.spotify.com/v1/albums/abc');
    expect(error.name).toBe('TimeoutError');
    expect(error.timeoutMs).toBe(10000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/utils/fetch-timeout.test.ts`
Expected: FAIL. The first three tests fail because `message`/`url` still contain `?api_key=secret123` / `#token=abc`. The fourth passes.

- [ ] **Step 3: Write minimal implementation**

In `packages/shared/src/utils/fetch.ts`, replace the `TimeoutError` class with:

```ts
/**
 * Remove the query string and fragment from a URL.
 * Query strings can carry credentials (e.g. Last.fm api_key), which must not reach logs.
 */
function stripQuery(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split(/[?#]/)[0];
  }
}

/**
 * Error thrown when a fetch request times out.
 * The URL is stored and reported without its query string.
 */
export class TimeoutError extends Error {
  public url: string;

  constructor(
    url: string,
    public timeoutMs: number
  ) {
    const safeUrl = stripQuery(url);
    super(`Request to ${safeUrl} timed out after ${timeoutMs}ms`);
    this.url = safeUrl;
    this.name = 'TimeoutError';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/utils/fetch-timeout.test.ts`
Expected: PASS (4 tests).

Then run: `pnpm --filter @listentomore/shared typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/utils/fetch.ts apps/web/src/__tests__/utils/fetch-timeout.test.ts
git commit -m "fix(shared): strip query strings from TimeoutError (#35)

Timeout errors logged the full request URL, which put Last.fm's api_key
into Workers Logs.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 404 for non-Spotify IDs on artist and album pages

**Files:**
- Create: `packages/shared/src/utils/spotify-id.ts`
- Modify: `packages/shared/src/utils/index.ts` (add export)
- Create: `apps/web/src/components/ui/NotFoundPage.tsx`
- Modify: `apps/web/src/components/ui/index.ts` (add export)
- Modify: `apps/web/src/index.tsx:777-792` (`app.notFound` uses `NotFoundPage`)
- Modify: `apps/web/src/pages/artist/detail.tsx` (`handleArtistDetail`, ~line 271, and the ui import on line 7)
- Modify: `apps/web/src/pages/album/detail.tsx` (`handleAlbumDetail`, ~line 207, and the ui import on line 7)
- Test (create): `apps/web/src/__tests__/utils/spotify-id.test.ts`
- Test (create): `apps/web/src/__tests__/handlers/detail-not-found.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `isSpotifyId(id: string): boolean`, exported from `@listentomore/shared`. `NotFoundPage(): JSX.Element`, exported from `apps/web/src/components/ui`.

- [ ] **Step 1: Write the failing `isSpotifyId` test**

Create `apps/web/src/__tests__/utils/spotify-id.test.ts`:

```ts
// ABOUTME: Tests for isSpotifyId, which gates artist/album detail routes.
// ABOUTME: Legacy slug URLs must be rejected before they reach the Spotify API.

import { describe, it, expect } from 'vitest';
import { isSpotifyId } from '@listentomore/shared';

describe('isSpotifyId', () => {
  it('accepts a real 22-character base62 Spotify ID', () => {
    expect(isSpotifyId('4Z8W4fKeB5YxbusRsdQVPb')).toBe(true);
    expect(isSpotifyId('0k17h0D3J5VfsdmQ1iZtE9')).toBe(true);
  });

  it('rejects legacy artist slugs', () => {
    expect(isSpotifyId('the-grateful-dead')).toBe(false);
    expect(isSpotifyId('theaudience')).toBe(false);
    expect(isSpotifyId("dali's-dilemma")).toBe(false);
  });

  it('rejects legacy album slugs', () => {
    expect(isSpotifyId('radiohead_pablo-honey')).toBe(false);
    expect(isSpotifyId('colter-wall_western-swing-%26-waltzes-and-other-punchy-songs')).toBe(false);
    expect(isSpotifyId('wham!_last-christmas')).toBe(false);
  });

  it('rejects strings of the wrong length', () => {
    expect(isSpotifyId('4Z8W4fKeB5YxbusRsdQVP')).toBe(false); // 21
    expect(isSpotifyId('4Z8W4fKeB5YxbusRsdQVPbX')).toBe(false); // 23
    expect(isSpotifyId('')).toBe(false);
  });

  it('rejects 22-character strings containing non-base62 characters', () => {
    expect(isSpotifyId('4Z8W4fKeB5Yxbus-sdQVPb')).toBe(false);
    expect(isSpotifyId('4Z8W4fKeB5Yxbus_sdQVPb')).toBe(false);
  });

  it('treats any 22 alphanumeric characters as an ID (Spotify is the authority beyond shape)', () => {
    expect(isSpotifyId('radioheadpablohoneyabc')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/utils/spotify-id.test.ts`
Expected: FAIL with `isSpotifyId is not a function` (the export doesn't exist).

- [ ] **Step 3: Implement `isSpotifyId`**

Create `packages/shared/src/utils/spotify-id.ts`:

```ts
// ABOUTME: Shape check for Spotify IDs (22 base62 characters).
// ABOUTME: Lets routes reject legacy slug URLs without calling the Spotify API.

const SPOTIFY_ID_PATTERN = /^[0-9A-Za-z]{22}$/;

/**
 * True when the value has the shape of a Spotify ID.
 * Does not prove the ID exists; Spotify is the authority on that.
 */
export function isSpotifyId(id: string): boolean {
  return SPOTIFY_ID_PATTERN.test(id);
}
```

In `packages/shared/src/utils/index.ts`, add after the existing exports:

```ts
export * from './spotify-id';
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/utils/spotify-id.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Write the failing handler test**

Create `apps/web/src/__tests__/handlers/detail-not-found.test.ts`:

```ts
// ABOUTME: Tests that artist/album detail routes 404 legacy slug URLs.
// ABOUTME: Slugs must never reach Spotify (it returns 400, which we used to render as a 200 error page).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { handleArtistDetail } from '../../pages/artist/detail';
import { handleAlbumDetail } from '../../pages/album/detail';

type TestVariables = {
  spotify: unknown;
  currentUser: unknown;
  internalToken: string;
};

describe('Detail routes with non-Spotify IDs', () => {
  let app: Hono<{ Variables: TestVariables }>;
  const spotify = {
    getArtist: vi.fn(),
    getAlbum: vi.fn(),
  };

  beforeEach(() => {
    app = new Hono<{ Variables: TestVariables }>();
    app.use('*', async (c, next) => {
      c.set('spotify', spotify);
      c.set('currentUser', null);
      c.set('internalToken', 'test-token');
      await next();
    });
    app.get('/artist/:id', handleArtistDetail);
    app.get('/album/:id', handleAlbumDetail);
  });

  it('returns 404 for a slug artist URL without calling Spotify', async () => {
    const res = await app.request('/artist/the-grateful-dead');

    expect(res.status).toBe(404);
    expect(await res.text()).toContain('404');
    expect(spotify.getArtist).not.toHaveBeenCalled();
  });

  it('returns 404 for a slug album URL with encoded characters without calling Spotify', async () => {
    const res = await app.request('/album/colter-wall_western-swing-%26-waltzes-and-other-punchy-songs');

    expect(res.status).toBe(404);
    expect(await res.text()).toContain('404');
    expect(spotify.getAlbum).not.toHaveBeenCalled();
  });

  it('passes a valid artist ID to Spotify', async () => {
    spotify.getArtist.mockResolvedValue(null);

    const res = await app.request('/artist/4Z8W4fKeB5YxbusRsdQVPb');

    expect(res.status).toBe(200);
    expect(spotify.getArtist).toHaveBeenCalledWith('4Z8W4fKeB5YxbusRsdQVPb');
  });

  it('passes a valid album ID to Spotify', async () => {
    spotify.getAlbum.mockResolvedValue(null);

    const res = await app.request('/album/0k17h0D3J5VfsdmQ1iZtE9');

    expect(res.status).toBe(200);
    expect(spotify.getAlbum).toHaveBeenCalledWith('0k17h0D3J5VfsdmQ1iZtE9');
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/handlers/detail-not-found.test.ts`
Expected: the two slug tests FAIL (status 200, and `getArtist`/`getAlbum` were called). The two valid-ID tests PASS.

- [ ] **Step 7: Extract `NotFoundPage`**

Create `apps/web/src/components/ui/NotFoundPage.tsx` (markup moved verbatim from `app.notFound` in `apps/web/src/index.tsx`):

```tsx
// ABOUTME: 404 page shared by the app-wide notFound handler and detail routes.
// ABOUTME: Detail routes use it for IDs that can't be valid Spotify IDs (legacy slug URLs).

import { Layout } from '../layout';

export function NotFoundPage() {
  return (
    <Layout title="Page Not Found">
      <div class="text-center" style={{ paddingTop: '4rem' }}>
        <h1 style={{ fontSize: '4rem', marginBottom: '0.5rem' }}>404</h1>
        <p>The page you're looking for doesn't exist.</p>
        <p class="mt-2">
          <a href="/" class="button">
            Go Home
          </a>
        </p>
      </div>
    </Layout>
  );
}
```

In `apps/web/src/components/ui/index.ts`, add (keep alphabetical order, after `LoadingSpinner`):

```ts
export { NotFoundPage } from './NotFoundPage';
```

In `apps/web/src/index.tsx`, replace the `app.notFound` handler body:

```tsx
// 404 handler
app.notFound((c) => {
  return c.html(<NotFoundPage />, 404);
});
```

and add `NotFoundPage` to the existing import from `'./components/ui'`. If `index.tsx` has no such import, add `import { NotFoundPage } from './components/ui';` next to the other component imports. If `Layout` is no longer used elsewhere in `index.tsx` after this change, remove its import (`noUnusedLocals` is on).

- [ ] **Step 8: Gate both handlers**

In `apps/web/src/pages/artist/detail.tsx`:
- Add `import { isSpotifyId } from '@listentomore/shared';` after the `@listentomore/db` type import.
- Change line 7 to `import { NotFoundPage, RateLimitedPage, SignInGate } from '../../components/ui';`
- At the top of `handleArtistDetail`, directly after `const spotifyId = c.req.param('id');`, insert:

```tsx
  // Legacy slug URLs (e.g. /artist/the-grateful-dead) predate ID-based routes; Spotify 400s them.
  if (!isSpotifyId(spotifyId)) {
    return c.html(<NotFoundPage />, 404);
  }
```

In `apps/web/src/pages/album/detail.tsx`, make the same three changes to `handleAlbumDetail`, with the comment reading `// Legacy slug URLs (e.g. /album/radiohead_pablo-honey) predate ID-based routes; Spotify 400s them.`

- [ ] **Step 9: Run tests to verify they pass**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/handlers/detail-not-found.test.ts src/__tests__/handlers/album.test.ts`
Expected: PASS (all tests).

Run: `pnpm --filter @listentomore/web typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add packages/shared/src/utils/spotify-id.ts packages/shared/src/utils/index.ts \
  apps/web/src/components/ui/NotFoundPage.tsx apps/web/src/components/ui/index.ts \
  apps/web/src/index.tsx apps/web/src/pages/artist/detail.tsx apps/web/src/pages/album/detail.tsx \
  apps/web/src/__tests__/utils/spotify-id.test.ts apps/web/src/__tests__/handlers/detail-not-found.test.ts
git commit -m "fix(web): 404 legacy slug URLs on artist and album pages (#35)

Pre-rewrite slugs were passed to Spotify, which returned 400, and the
page rendered an error with HTTP 200 (a soft 404 that crawlers index).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: OpenAI region block returns `{ data: null }`

**Files:**
- Create: `packages/services/ai/src/errors.ts`
- Modify: `packages/services/ai/src/index.ts` (export `RegionUnsupportedError`)
- Modify: `packages/services/ai/src/openai.ts` (`chatCompletionViaChatCompletions` ~line 256, `responses` ~line 371, plus a new private helper)
- Modify: `apps/web/src/api/internal/artist.ts` (`/artist-sentence` route, ~lines 55-70)
- Test (modify): `apps/web/src/__tests__/services/ai.test.ts` (add a describe block)
- Test (create): `apps/web/src/__tests__/handlers/artist-sentence.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `class RegionUnsupportedError extends Error { provider: 'openai' }`, exported from `@listentomore/ai`. `isOpenAIRegionBlock(status: number, body: string): boolean`, internal to the ai package.

- [ ] **Step 1: Write the failing client tests**

In `apps/web/src/__tests__/services/ai.test.ts`:
- Add `afterEach` to the vitest import: `import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';`
- Add `RegionUnsupportedError` to the `@listentomore/ai` import list.
- Append this block at the end of the file:

```ts
describe('OpenAIClient region blocks', () => {
  const regionBody = {
    error: {
      code: 'unsupported_country_region_territory',
      message: 'Country, region, or territory not supported',
      param: null,
      type: 'request_forbidden',
    },
  };
  let client: OpenAIClient;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    client = new OpenAIClient('test-api-key');
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('responses() throws RegionUnsupportedError and warns on a region 403', async () => {
    setupFetchMock([{ pattern: /api\.openai\.com/, response: regionBody, options: { status: 403, ok: false } }]);

    await expect(client.responses({ model: 'gpt-5.6-terra', input: 'hi' })).rejects.toBeInstanceOf(RegionUnsupportedError);
    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('chat completions path throws RegionUnsupportedError on a region 403', async () => {
    setupFetchMock([{ pattern: /api\.openai\.com/, response: regionBody, options: { status: 403, ok: false } }]);

    await expect(
      client.chatCompletion({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toBeInstanceOf(RegionUnsupportedError);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('keeps the generic error for other 403s', async () => {
    setupFetchMock([{
      pattern: /api\.openai\.com/,
      response: { error: { code: 'insufficient_quota', message: 'quota' } },
      options: { status: 403, ok: false },
    }]);

    const promise = client.responses({ model: 'gpt-5.6-terra', input: 'hi' });
    await expect(promise).rejects.toThrow('OpenAI Responses API error');
    await expect(promise).rejects.not.toBeInstanceOf(RegionUnsupportedError);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('keeps the generic error for a 500', async () => {
    setupFetchMock([{ pattern: /api\.openai\.com/, response: { error: 'boom' }, options: { status: 500, ok: false } }]);

    await expect(client.responses({ model: 'gpt-5.6-terra', input: 'hi' })).rejects.not.toBeInstanceOf(RegionUnsupportedError);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('falls through to the generic error when a 403 body is not JSON', async () => {
    const htmlResponse = {
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token <')),
      text: vi.fn().mockResolvedValue('<html><body>Forbidden</body></html>'),
      headers: new Headers(),
    } as unknown as Response;
    globalThis.fetch = vi.fn().mockResolvedValue(htmlResponse) as typeof fetch;

    const promise = client.responses({ model: 'gpt-5.6-terra', input: 'hi' });
    await expect(promise).rejects.toThrow('OpenAI Responses API error: Forbidden');
    await expect(promise).rejects.not.toBeInstanceOf(RegionUnsupportedError);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/services/ai.test.ts -t "region blocks"`
Expected: FAIL. `RegionUnsupportedError` is undefined (import resolves to `undefined`, so `toBeInstanceOf` throws), and the region tests see a generic `Error` and a `console.error` call.

- [ ] **Step 3: Implement the error type and client check**

Create `packages/services/ai/src/errors.ts`:

```ts
// ABOUTME: Typed errors raised by AI provider clients.
// ABOUTME: Lets callers tell expected provider refusals (geoblocks) from real failures.

const OPENAI_REGION_CODE = 'unsupported_country_region_territory';

/**
 * The provider refused the request because of where it came from.
 * Workers call providers from a colo near the visitor, so this is expected
 * for visitors in regions the provider doesn't serve.
 */
export class RegionUnsupportedError extends Error {
  constructor(public provider: 'openai') {
    super(`${provider} does not serve the region this request came from`);
    this.name = 'RegionUnsupportedError';
  }
}

/**
 * True when an OpenAI error response is the unsupported-region 403.
 */
export function isOpenAIRegionBlock(status: number, body: string): boolean {
  if (status !== 403) return false;
  try {
    const parsed = JSON.parse(body) as { error?: { code?: string } };
    return parsed.error?.code === OPENAI_REGION_CODE;
  } catch {
    return false;
  }
}
```

In `packages/services/ai/src/index.ts`, after `export { AnthropicClient } from './anthropic';` add:

```ts
export { RegionUnsupportedError } from './errors';
```

In `packages/services/ai/src/openai.ts`:
- Add `import { isOpenAIRegionBlock, RegionUnsupportedError } from './errors';` with the other relative imports.
- Add this private method to `OpenAIClient` (next to `checkRateLimit`):

```ts
  /**
   * Throw RegionUnsupportedError (logged at warn) when OpenAI rejected the caller's region.
   * Other error responses are left to the caller's existing error handling.
   */
  private throwIfRegionBlocked(label: string, status: number, errorBody: string): void {
    if (isOpenAIRegionBlock(status, errorBody)) {
      console.warn(`${label} Request region not supported by OpenAI; skipping`);
      throw new RegionUnsupportedError('openai');
    }
  }
```

- In `chatCompletionViaChatCompletions`, change the non-OK block to:

```ts
    if (!response.ok) {
      const errorBody = await response.text();
      this.throwIfRegionBlocked('[OpenAI]', response.status, errorBody);
      console.error(`[OpenAI] API error: ${response.status} - ${errorBody}`);
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }
```

- In `responses`, change the non-OK block to:

```ts
    if (!response.ok) {
      const errorBody = await response.text();
      this.throwIfRegionBlocked('[OpenAI Responses]', response.status, errorBody);
      console.error(
        `[OpenAI Responses] API error: ${response.status} - ${errorBody}`
      );
      throw new Error(`OpenAI Responses API error: ${response.statusText}`);
    }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/services/ai.test.ts`
Expected: PASS (existing tests plus the 5 new ones).

- [ ] **Step 5: Write the failing route test**

Create `apps/web/src/__tests__/handlers/artist-sentence.test.ts`:

```ts
// ABOUTME: Tests for /api/internal/artist-sentence error handling.
// ABOUTME: An OpenAI region block should omit the sentence (200, null data), not return 500.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { RegionUnsupportedError } from '@listentomore/ai';
import type { AIService } from '@listentomore/ai';
import { artistInternalRoutes } from '../../api/internal/artist';
import type { AppContext } from '../../types';

function buildApp(getArtistSentence: ReturnType<typeof vi.fn>) {
  const app = new Hono<AppContext>();
  app.use('*', async (c, next) => {
    c.set('ai', { getArtistSentence } as unknown as AIService);
    await next();
  });
  app.route('/', artistInternalRoutes);
  return app;
}

describe('GET /artist-sentence', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('returns 200 with null data when OpenAI rejects the region', async () => {
    const app = buildApp(vi.fn().mockRejectedValue(new RegionUnsupportedError('openai')));

    const res = await app.request('/artist-sentence?name=Radiohead');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: null });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('still returns 500 for other failures', async () => {
    const app = buildApp(vi.fn().mockRejectedValue(new Error('OpenAI Responses API error: Internal Server Error')));

    const res = await app.request('/artist-sentence?name=Radiohead');

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to generate artist sentence' });
  });

  it('returns the sentence on success', async () => {
    const app = buildApp(vi.fn().mockResolvedValue({ sentence: 'An English rock band.' }));

    const res = await app.request('/artist-sentence?name=Radiohead');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { sentence: 'An English rock band.' } });
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/handlers/artist-sentence.test.ts`
Expected: the region test FAILS (status 500, `console.error` called). The other two PASS.

- [ ] **Step 7: Handle the error in the route**

In `apps/web/src/api/internal/artist.ts`:
- Add `import { RegionUnsupportedError } from '@listentomore/ai';` after the `hono` import.
- Change the `/artist-sentence` catch block to:

```ts
  } catch (error) {
    // OpenAI refuses visitors' regions it doesn't serve (e.g. CN, RU); omit the sentence.
    if (error instanceof RegionUnsupportedError) {
      console.warn('Internal artist sentence skipped: provider does not serve this region');
      return c.json({ data: null });
    }
    console.error('Internal artist sentence error:', error);
    return c.json({ error: 'Failed to generate artist sentence' }, 500);
  }
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/handlers/artist-sentence.test.ts src/__tests__/services/ai.test.ts`
Expected: PASS.

Run: `pnpm --filter @listentomore/web typecheck && pnpm --filter @listentomore/ai typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/services/ai/src/errors.ts packages/services/ai/src/index.ts packages/services/ai/src/openai.ts \
  apps/web/src/api/internal/artist.ts apps/web/src/__tests__/services/ai.test.ts \
  apps/web/src/__tests__/handlers/artist-sentence.test.ts
git commit -m "fix(ai): return null artist sentence when OpenAI rejects the region (#35)

Visitors whose nearest colo OpenAI doesn't serve (seen from CN and RU)
got a 500. The client now throws RegionUnsupportedError (logged at warn)
and the route omits the sentence.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: MusicBrainz slot reservation and the Durable Object

**Files:**
- Create: `packages/services/musicbrainz/src/rate-limit.ts`
- Modify: `packages/services/musicbrainz/src/index.ts` (exports)
- Create: `apps/web/src/durable-objects/musicbrainz-rate-limiter.ts`
- Modify: `apps/web/src/types.ts` (`Bindings`)
- Modify: `apps/web/src/index.tsx` (export the DO class)
- Modify: `apps/web/wrangler.toml` (binding and migration)
- Test (create): `packages/services/musicbrainz/__tests__/rate-limit.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `reserveSlot(nextSlotAt: number, now: number, maxWaitMs: number, intervalMs: number): SlotReservation`
  - `interface SlotReservation { waitMs: number | null; nextSlotAt: number }`
  - `interface MusicBrainzRateLimiter { reserve(maxWaitMs: number): Promise<number | null> }`
  - `MUSICBRAINZ_INTERVAL_MS = 1100`, `MUSICBRAINZ_MAX_WAIT_MS = 5000`
  - all exported from `@listentomore/musicbrainz`
  - `class MusicBrainzRateLimiterDO` with RPC `reserve(maxWaitMs: number): number | null`
  - `getMusicBrainzLimiter(ns: DurableObjectNamespace<MusicBrainzRateLimiterDO>): MusicBrainzRateLimiter`, exported from `apps/web/src/durable-objects/musicbrainz-rate-limiter.ts`
  - `Bindings.MUSICBRAINZ_RATE_LIMITER`

This task leaves the DO bound but unused. Task 5 wires it in.

- [ ] **Step 1: Write the failing `reserveSlot` test**

Create `packages/services/musicbrainz/__tests__/rate-limit.test.ts`:

```ts
// ABOUTME: Tests for reserveSlot, the pure slot arithmetic behind the MusicBrainz Durable Object.
// ABOUTME: Guarantees 1100ms spacing and bounded waits for concurrent callers.

import { describe, it, expect } from 'vitest';
import { reserveSlot } from '../src/rate-limit';

const INTERVAL = 1100;
const MAX_WAIT = 5000;

describe('reserveSlot', () => {
  it('grants an idle limiter immediately', () => {
    expect(reserveSlot(0, 10_000, MAX_WAIT, INTERVAL)).toEqual({ waitMs: 0, nextSlotAt: 11_100 });
  });

  it('spaces back-to-back reservations by the interval', () => {
    const now = 10_000;
    const first = reserveSlot(0, now, MAX_WAIT, INTERVAL);
    const second = reserveSlot(first.nextSlotAt, now, MAX_WAIT, INTERVAL);
    const third = reserveSlot(second.nextSlotAt, now, MAX_WAIT, INTERVAL);

    expect([first.waitMs, second.waitMs, third.waitMs]).toEqual([0, 1100, 2200]);
    expect(third.nextSlotAt).toBe(now + 3300);
  });

  it('declines without changing state when the wait would exceed maxWaitMs', () => {
    const now = 10_000;
    const nextSlotAt = now + 5001;

    expect(reserveSlot(nextSlotAt, now, MAX_WAIT, INTERVAL)).toEqual({ waitMs: null, nextSlotAt });
  });

  it('accepts a wait exactly equal to maxWaitMs', () => {
    const now = 10_000;

    expect(reserveSlot(now + 5000, now, MAX_WAIT, INTERVAL)).toEqual({ waitMs: 5000, nextSlotAt: now + 6100 });
  });

  it('grants immediately once the reserved slot has passed', () => {
    expect(reserveSlot(9_000, 10_000, MAX_WAIT, INTERVAL)).toEqual({ waitMs: 0, nextSlotAt: 11_100 });
  });

  it('admits exactly five queued callers at 1100ms spacing before declining (burst of 7)', () => {
    const now = 10_000;
    let nextSlotAt = 0;
    const waits: Array<number | null> = [];
    for (let i = 0; i < 7; i++) {
      const result = reserveSlot(nextSlotAt, now, MAX_WAIT, INTERVAL);
      nextSlotAt = result.nextSlotAt;
      waits.push(result.waitMs);
    }

    expect(waits).toEqual([0, 1100, 2200, 3300, 4400, null, null]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @listentomore/musicbrainz exec vitest run __tests__/rate-limit.test.ts`
Expected: FAIL with `Failed to load url ../src/rate-limit` (module doesn't exist).

- [ ] **Step 3: Implement `reserveSlot` and the interface**

Create `packages/services/musicbrainz/src/rate-limit.ts`:

```ts
// ABOUTME: Slot reservation for spacing MusicBrainz requests (max 1/sec per their API rules).
// ABOUTME: Pure so it tests in node; the web Worker's Durable Object holds the state.

/** Spacing between MusicBrainz requests (slightly over 1s for safety). */
export const MUSICBRAINZ_INTERVAL_MS = 1100;

/** Longest a caller will queue before giving up on MusicBrainz enrichment. */
export const MUSICBRAINZ_MAX_WAIT_MS = 5000;

export interface SlotReservation {
  /** Milliseconds to wait before requesting, or null if declined. */
  waitMs: number | null;
  /** Earliest time the next caller may request. */
  nextSlotAt: number;
}

/**
 * Something that hands out MusicBrainz request slots.
 * Implemented in production by a Durable Object so all Worker instances share one queue.
 */
export interface MusicBrainzRateLimiter {
  reserve(maxWaitMs: number): Promise<number | null>;
}

/**
 * Reserve the next request slot. Declines (state unchanged) when the wait would exceed maxWaitMs.
 */
export function reserveSlot(
  nextSlotAt: number,
  now: number,
  maxWaitMs: number,
  intervalMs: number
): SlotReservation {
  const slot = Math.max(now, nextSlotAt);
  const waitMs = slot - now;

  if (waitMs > maxWaitMs) {
    return { waitMs: null, nextSlotAt };
  }

  return { waitMs, nextSlotAt: slot + intervalMs };
}
```

In `packages/services/musicbrainz/src/index.ts`, after the existing `export type { MusicBrainzRelease, MusicBrainzRecording } from './types';` add:

```ts
export { reserveSlot, MUSICBRAINZ_INTERVAL_MS, MUSICBRAINZ_MAX_WAIT_MS } from './rate-limit';
export type { MusicBrainzRateLimiter, SlotReservation } from './rate-limit';
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @listentomore/musicbrainz exec vitest run __tests__/rate-limit.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Add the Durable Object and binding**

Create `apps/web/src/durable-objects/musicbrainz-rate-limiter.ts`:

```ts
// ABOUTME: Durable Object that spaces MusicBrainz requests across every Worker instance.
// ABOUTME: reserve() has no awaits, so each reservation is atomic; state is in memory only.

import { DurableObject } from 'cloudflare:workers';
import { reserveSlot, MUSICBRAINZ_INTERVAL_MS } from '@listentomore/musicbrainz';
import type { MusicBrainzRateLimiter } from '@listentomore/musicbrainz';

export class MusicBrainzRateLimiterDO extends DurableObject {
  // Resets to 0 on eviction; worst case is one extra request within a second.
  private nextSlotAt = 0;

  reserve(maxWaitMs: number): number | null {
    const result = reserveSlot(this.nextSlotAt, Date.now(), maxWaitMs, MUSICBRAINZ_INTERVAL_MS);
    this.nextSlotAt = result.nextSlotAt;
    return result.waitMs;
  }
}

/**
 * Adapt the global limiter instance to the musicbrainz package's interface.
 */
export function getMusicBrainzLimiter(
  namespace: DurableObjectNamespace<MusicBrainzRateLimiterDO>
): MusicBrainzRateLimiter {
  const stub = namespace.get(namespace.idFromName('global'));
  return {
    reserve: async (maxWaitMs: number) => stub.reserve(maxWaitMs),
  };
}
```

In `apps/web/src/types.ts`:
- Add `import type { MusicBrainzRateLimiterDO } from './durable-objects/musicbrainz-rate-limiter';` after the existing type imports.
- In `Bindings`, after `CACHE: KVNamespace;` add:

```ts
  // Durable Objects
  MUSICBRAINZ_RATE_LIMITER: DurableObjectNamespace<MusicBrainzRateLimiterDO>;
```

In `apps/web/src/index.tsx`, directly above `export default {`, add:

```ts
// Durable Object classes must be exported from the Worker entry point
export { MusicBrainzRateLimiterDO } from './durable-objects/musicbrainz-rate-limiter';
```

In `apps/web/wrangler.toml`, after the `[[d1_databases]]` block, add:

```toml
# Durable Object: global MusicBrainz rate limiter (1 request per 1.1s across all instances)
[[durable_objects.bindings]]
name = "MUSICBRAINZ_RATE_LIMITER"
class_name = "MusicBrainzRateLimiterDO"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["MusicBrainzRateLimiterDO"]
```

- [ ] **Step 6: Verify types and bundling**

Run: `pnpm --filter @listentomore/web typecheck && pnpm --filter @listentomore/musicbrainz typecheck`
Expected: no errors. If `stub.reserve` doesn't type-check because of RPC result wrapping, keep the adapter shape and cast only the return: `reserve: async (maxWaitMs: number) => (await stub.reserve(maxWaitMs)) as number | null`.

Run: `pnpm --filter @listentomore/web exec wrangler deploy --dry-run --outdir /tmp/ltm-dry-run`
Expected: exits 0, prints `--dry-run: exiting now.`, and the bindings table lists `env.MUSICBRAINZ_RATE_LIMITER (MusicBrainzRateLimiterDO)` as a Durable Object.

Run: `pnpm --filter @listentomore/web test`
Expected: PASS (full web suite still green; no test imports `index.tsx`, so `cloudflare:workers` isn't loaded under node).

- [ ] **Step 7: Commit**

```bash
git add packages/services/musicbrainz/src/rate-limit.ts packages/services/musicbrainz/src/index.ts \
  packages/services/musicbrainz/__tests__/rate-limit.test.ts \
  apps/web/src/durable-objects/musicbrainz-rate-limiter.ts apps/web/src/types.ts apps/web/src/index.tsx \
  apps/web/wrangler.toml
git commit -m "feat(musicbrainz): add Durable Object slot limiter (#35)

reserveSlot is the pure spacing logic; MusicBrainzRateLimiterDO holds the
state so every Worker instance shares one queue. Not wired in yet.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Route MusicBrainz requests through the limiter

**Files:**
- Create: `packages/services/musicbrainz/src/errors.ts`
- Modify: `packages/services/musicbrainz/src/fetch.ts` (whole file)
- Modify: `packages/services/musicbrainz/src/release-lookup.ts` (`lookupAlbumUpc`, `lookupReleaseBarcode`)
- Modify: `packages/services/musicbrainz/src/recording-lookup.ts` (`lookupTrackIsrc`, `lookupRecordingIsrc`)
- Modify: `packages/services/musicbrainz/src/index.ts` (constructor, method calls, error export)
- Modify: `apps/web/src/index.tsx:126` (pass the limiter)
- Test (modify): `packages/services/musicbrainz/__tests__/musicbrainz.test.ts`

**Interfaces:**
- Consumes: `MusicBrainzRateLimiter`, `MUSICBRAINZ_MAX_WAIT_MS` (Task 4). `getMusicBrainzLimiter(namespace)` and `Bindings.MUSICBRAINZ_RATE_LIMITER` (Task 4).
- Produces:
  - `new MusicBrainzService(cache: KVNamespace, limiter: MusicBrainzRateLimiter)`
  - `musicbrainzFetch(endpoint: string, limiter: MusicBrainzRateLimiter): Promise<Response>`
  - `class MusicBrainzRateLimitError extends Error { reason: 'queue_full' | 'upstream_503' }`, exported from `@listentomore/musicbrainz`
  - `logLookupFailure(context: string, error: unknown): void`, internal

- [ ] **Step 1: Update the test setup and write the failing tests**

In `packages/services/musicbrainz/__tests__/musicbrainz.test.ts`:
- Change the vitest import to `import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';` and add `import type { Mock } from 'vitest';`
- Change the service import to `import { MusicBrainzService, MusicBrainzRateLimitError } from '../src/index';`
- Replace the top-level `describe('MusicBrainzService', ...)` setup so it declares a limiter:

```ts
describe('MusicBrainzService', () => {
  let mockKV: KVNamespace;
  let limiter: { reserve: Mock<(maxWaitMs: number) => Promise<number | null>> };
  let service: MusicBrainzService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockKV = createMockKV();
    limiter = { reserve: vi.fn<(maxWaitMs: number) => Promise<number | null>>(async () => 0) };
    service = new MusicBrainzService(mockKV, limiter);
  });
```

(the existing `getAlbumUpc` and `getTrackIsrc` describes stay inside, unchanged)

- Append this describe block inside `describe('MusicBrainzService', ...)`, after `getTrackIsrc`:

```ts
  describe('rate limiting', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
      vi.useRealTimers();
    });

    it('reserves a slot with the 5000ms cap before each request', async () => {
      setupFetchMock([{ pattern: /musicbrainz\.org\/ws\/2\/release\//, response: releaseSearchResponse }]);

      await service.getAlbumUpc('Radiohead', 'In Rainbows');

      expect(limiter.reserve).toHaveBeenCalledTimes(1);
      expect(limiter.reserve).toHaveBeenCalledWith(5000);
    });

    it('waits the reserved time before fetching', async () => {
      vi.useFakeTimers();
      limiter.reserve.mockResolvedValue(1100);
      const mockFetch = setupFetchMock([{ pattern: /musicbrainz\.org\/ws\/2\/release\//, response: releaseSearchResponse }]);

      const pending = service.getAlbumUpc('Radiohead', 'In Rainbows');
      await vi.advanceTimersByTimeAsync(1099);
      expect(mockFetch).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toBe('634904078560');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('makes no KV rate-limit reads or writes', async () => {
      setupFetchMock([{ pattern: /musicbrainz\.org\/ws\/2\/release\//, response: releaseSearchResponse }]);

      await service.getAlbumUpc('Radiohead', 'In Rainbows');

      const keys = [
        ...vi.mocked(mockKV.get).mock.calls.map((call) => call[0]),
        ...vi.mocked(mockKV.put).mock.calls.map((call) => call[0]),
      ];
      expect(keys).not.toContain('musicbrainz:ratelimit:state');
    });

    it('returns null without fetching or caching when the queue is full, logging at warn', async () => {
      limiter.reserve.mockResolvedValue(null);
      const mockFetch = setupFetchMock([{ pattern: /musicbrainz\.org/, response: releaseSearchResponse }]);

      const result = await service.getAlbumUpc('Radiohead', 'In Rainbows');

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockKV.put).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('does not cache null when the MBID follow-up hits a full queue', async () => {
      limiter.reserve.mockResolvedValueOnce(0).mockResolvedValueOnce(null);
      setupFetchMock([{ pattern: /musicbrainz\.org\/ws\/2\/release\/\?/, response: releaseSearchNoBarcode }]);

      const result = await service.getAlbumUpc('Radiohead', 'In Rainbows');

      expect(result).toBeNull();
      expect(mockKV.put).not.toHaveBeenCalled();
    });

    it('does not cache null when an ISRC lookup hits a full queue', async () => {
      limiter.reserve.mockResolvedValueOnce(0).mockResolvedValueOnce(null);
      setupFetchMock([{ pattern: /musicbrainz\.org\/ws\/2\/recording\/\?/, response: recordingSearchResponse }]);

      const result = await service.getTrackIsrc('Radiohead', 'Reckoner');

      expect(result).toBeNull();
      expect(mockKV.put).not.toHaveBeenCalled();
    });

    it('returns null, logs at error, and does not cache on a MusicBrainz 503', async () => {
      setupFetchMock([{ pattern: /musicbrainz\.org/, response: { error: 'unavailable' }, options: { status: 503, ok: false } }]);

      const result = await service.getAlbumUpc('Radiohead', 'In Rainbows');

      expect(result).toBeNull();
      expect(mockKV.put).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    });

    it('returns null without fetching when the limiter itself fails', async () => {
      limiter.reserve.mockRejectedValue(new Error('Durable Object unavailable'));
      const mockFetch = setupFetchMock([{ pattern: /musicbrainz\.org/, response: releaseSearchResponse }]);

      const result = await service.getAlbumUpc('Radiohead', 'In Rainbows');

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockKV.put).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    });

    it('exposes the queue-full reason on the error type', () => {
      const error = new MusicBrainzRateLimitError('queue_full');

      expect(error.reason).toBe('queue_full');
      expect(error.name).toBe('MusicBrainzRateLimitError');
    });
  });
```

The `releaseSearchNoBarcode` and `recordingSearchResponse` fixtures already exist at the top of the file. The patterns `release\/\?` and `recording\/\?` match only the search calls, so the MBID follow-ups would 404 if reached. The tests assert they are never reached, because the limiter declines first.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @listentomore/musicbrainz exec vitest run __tests__/musicbrainz.test.ts`
Expected: FAIL. `MusicBrainzRateLimitError` isn't exported, `limiter.reserve` is never called, KV rate-limit keys appear, and queue-full/503 paths cache `__null__` or log at error. Existing tests may also fail to compile because of the import; that's part of the red state.

- [ ] **Step 3: Add the error type and logging helper**

Create `packages/services/musicbrainz/src/errors.ts`:

```ts
// ABOUTME: MusicBrainz rate-limit error and lookup failure logging.
// ABOUTME: Queue-full rejections are expected backpressure and log at warn; everything else is an error.

export type MusicBrainzRateLimitReason = 'queue_full' | 'upstream_503';

export class MusicBrainzRateLimitError extends Error {
  constructor(public reason: MusicBrainzRateLimitReason) {
    super(
      reason === 'queue_full'
        ? 'MusicBrainz rate limit queue full'
        : 'MusicBrainz API rate limited (503)'
    );
    this.name = 'MusicBrainzRateLimitError';
  }
}

/**
 * Log a failed lookup at the right level.
 */
export function logLookupFailure(context: string, error: unknown): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  if (error instanceof MusicBrainzRateLimitError && error.reason === 'queue_full') {
    console.warn(`[MusicBrainz] ${context}:`, errorMessage);
    return;
  }
  console.error(`[MusicBrainz] ${context}:`, errorMessage);
}
```

- [ ] **Step 4: Rewrite `musicbrainzFetch`**

Replace the contents of `packages/services/musicbrainz/src/fetch.ts` with:

```ts
// ABOUTME: Rate-limited fetch wrapper for MusicBrainz API.
// ABOUTME: Takes a slot from a shared limiter (Durable Object in production) before each request.

import { fetchWithTimeout } from '@listentomore/shared';
import { MusicBrainzRateLimitError } from './errors';
import { MUSICBRAINZ_MAX_WAIT_MS } from './rate-limit';
import type { MusicBrainzRateLimiter } from './rate-limit';

const MUSICBRAINZ_API_BASE = 'https://musicbrainz.org/ws/2';
const USER_AGENT = 'ListenToMore/1.0 (https://listentomore.com)';

/**
 * Rate-limited fetch for MusicBrainz API.
 *
 * MusicBrainz enforces max 1 request per second. Exceeding this results in
 * IP-level blocking. The limiter serialises requests across Worker instances
 * and declines callers who would wait longer than MUSICBRAINZ_MAX_WAIT_MS.
 */
export async function musicbrainzFetch(
  endpoint: string,
  limiter: MusicBrainzRateLimiter
): Promise<Response> {
  const waitMs = await limiter.reserve(MUSICBRAINZ_MAX_WAIT_MS);

  if (waitMs === null) {
    throw new MusicBrainzRateLimitError('queue_full');
  }

  if (waitMs > 0) {
    console.log(`[MusicBrainz] Rate limit: waiting ${waitMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const url = `${MUSICBRAINZ_API_BASE}${endpoint}`;
  console.log(`[MusicBrainz] Fetching: ${url}`);

  const response = await fetchWithTimeout(url, {
    timeout: 'fast',
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json',
    },
  });

  if (response.status === 503) {
    console.error('[MusicBrainz] 503 Service Unavailable - rate limited or down');
    throw new MusicBrainzRateLimitError('upstream_503');
  }

  if (!response.ok) {
    console.error(`[MusicBrainz] API error: ${response.status} ${response.statusText}`);
    throw new Error(`MusicBrainz API error: ${response.status} ${response.statusText}`);
  }

  return response;
}
```

- [ ] **Step 5: Thread the limiter through the lookups**

In `packages/services/musicbrainz/src/release-lookup.ts`:
- Add imports: `import { MusicBrainzRateLimitError, logLookupFailure } from './errors';` and `import type { MusicBrainzRateLimiter } from './rate-limit';`
- `lookupAlbumUpc` signature becomes `(artist: string, album: string, cache: KVNamespace, limiter: MusicBrainzRateLimiter)`.
- Its search call becomes `musicbrainzFetch(\`/release/?query=${encoded}&fmt=json&limit=5\`, limiter)`.
- Its follow-up becomes `const upc = await lookupReleaseBarcode(bestMatch.id, limiter);`
- Its outer catch becomes:

```ts
  } catch (error) {
    logLookupFailure(`Release lookup failed for ${artist} - ${album}`, error);
    // Don't cache errors -- they might be transient
    return null;
  }
```

- `lookupReleaseBarcode` signature becomes `(mbid: string, limiter: MusicBrainzRateLimiter)`, its fetch becomes `musicbrainzFetch(\`/release/${mbid}?fmt=json\`, limiter)`, and its catch becomes:

```ts
  } catch (error) {
    // Rate-limit failures must reach lookupAlbumUpc so it doesn't cache a false "no UPC"
    if (error instanceof MusicBrainzRateLimitError) throw error;
    logLookupFailure(`Release barcode lookup failed for ${mbid}`, error);
    return null;
  }
```

(keep the existing log wording in that catch if it differs; only the level-routing and rethrow are required).

In `packages/services/musicbrainz/src/recording-lookup.ts`, make the matching changes:
- Same two imports.
- `lookupTrackIsrc(artist: string, track: string, cache: KVNamespace, limiter: MusicBrainzRateLimiter)`. The search fetch passes `limiter`. The loop calls `lookupRecordingIsrc(match.id, limiter)`. The outer catch becomes:

```ts
  } catch (error) {
    logLookupFailure(`Recording lookup failed for ${artist} - ${track}`, error);
    return null;
  }
```

- `lookupRecordingIsrc(mbid: string, limiter: MusicBrainzRateLimiter)`. Its fetch passes `limiter`. Its catch becomes:

```ts
  } catch (error) {
    // Rate-limit failures must reach lookupTrackIsrc so it doesn't cache a false "no ISRC"
    if (error instanceof MusicBrainzRateLimitError) throw error;
    logLookupFailure(`Recording ISRC lookup failed for ${mbid}`, error);
    return null;
  }
```

In `packages/services/musicbrainz/src/index.ts`:
- Add `import type { MusicBrainzRateLimiter } from './rate-limit';`
- Add `export { MusicBrainzRateLimitError } from './errors';`
- Constructor: `constructor(private cache: KVNamespace, private limiter: MusicBrainzRateLimiter) {}`
- `getAlbumUpc` returns `lookupAlbumUpc(artist, album, this.cache, this.limiter);`
- `getTrackIsrc` returns `lookupTrackIsrc(artist, track, this.cache, this.limiter);`

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @listentomore/musicbrainz test`
Expected: PASS (11 existing, 9 new, and the 6 `rate-limit.test.ts` tests). The suite now runs in well under a second, since the old 1100ms KV waits are gone.

- [ ] **Step 7: Wire the Durable Object into the web Worker**

In `apps/web/src/index.tsx`:
- Add `import { getMusicBrainzLimiter } from './durable-objects/musicbrainz-rate-limiter';` with the other local imports.
- Change `musicbrainz: new MusicBrainzService(c.env.CACHE),` to:

```ts
      musicbrainz: new MusicBrainzService(
        c.env.CACHE,
        getMusicBrainzLimiter(c.env.MUSICBRAINZ_RATE_LIMITER)
      ),
```

Run: `pnpm typecheck`
Expected: all packages pass. `MusicBrainzService` is constructed only at `apps/web/src/index.tsx:126`, which you can confirm with `grep -rn "new MusicBrainzService" apps packages --include='*.ts' --include='*.tsx' | grep -v node_modules`.

Run: `pnpm test`
Expected: all packages pass.

Run: `pnpm --filter @listentomore/web exec wrangler deploy --dry-run --outdir /tmp/ltm-dry-run`
Expected: exits 0 with the Durable Object binding listed.

- [ ] **Step 8: Local smoke check**

Run `pnpm --filter @listentomore/web exec wrangler dev --port 8787` in the background. When it logs `Ready on http://localhost:8787`, run:

`curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8787/artist/the-grateful-dead`
Expected: `404` (Task 2, served by the full Worker with the DO bound).

`curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8787/`
Expected: `200`, and the `wrangler dev` output shows no Durable Object binding or migration errors.

Stop `wrangler dev`. If it can't start because local secrets are missing from `apps/web/.dev.vars`, record that and rely on the dry run. Do not create or edit `.dev.vars`.

- [ ] **Step 9: Commit**

```bash
git add packages/services/musicbrainz/src/errors.ts packages/services/musicbrainz/src/fetch.ts \
  packages/services/musicbrainz/src/release-lookup.ts packages/services/musicbrainz/src/recording-lookup.ts \
  packages/services/musicbrainz/src/index.ts packages/services/musicbrainz/__tests__/musicbrainz.test.ts \
  apps/web/src/index.tsx
git commit -m "fix(musicbrainz): serialise requests through the Durable Object limiter (#35)

The KV read-then-write gate let concurrent requests through (7 parallel
lookups all got 503s and tripped a KV 429). Requests now take a slot from
MusicBrainzRateLimiterDO; callers who would wait over 5s are declined and
logged at warn. Rate-limit failures in MBID follow-ups no longer get
cached as a 30-day 'not found'.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Final verification (after Task 5)

- [ ] `pnpm typecheck`: all packages pass.
- [ ] `pnpm test`: all packages pass; record the counts.
- [ ] `git log --oneline main..HEAD`: spec commit plus five task commits, each referencing #35.
- [ ] `git status`: clean.
- [ ] No deploy. Report the branch as ready for review.
