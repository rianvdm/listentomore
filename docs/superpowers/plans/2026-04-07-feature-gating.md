# Feature Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate AI-powered features behind login to reduce OpenAI costs and incentivize sign-ups, starting with album pages.

**Architecture:** Two complementary patterns — `requireAuthPage` middleware for full-page gating, `<SignInGate>` component for per-section gating. Both use a shared `<SignInCTA>` component. Internal API routes for AI features get a session auth guard as a second layer of protection.

**Tech Stack:** Hono (middleware + JSX components), Cloudflare Workers, Vitest

**Spec:** `docs/superpowers/specs/2026-04-07-feature-gating-design.md`

---

### Task 1: Create `<SignInCTA>` Component

**Files:**
- Create: `apps/web/src/components/ui/SignInCTA.tsx`
- Modify: `apps/web/src/components/ui/index.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/__tests__/handlers/sign-in-cta.test.ts`:

```typescript
// SignInCTA component rendering tests

import { describe, it, expect } from 'vitest';
import { SignInCTA } from '../../components/ui/SignInCTA';

describe('SignInCTA', () => {
  it('renders sign-in link with current path', () => {
    const html = SignInCTA({ currentPath: '/album/abc123' }).toString();
    expect(html).toContain('/login?next=%2Falbum%2Fabc123');
  });

  it('renders benefits list', () => {
    const html = SignInCTA({ currentPath: '/' }).toString();
    expect(html).toContain('AI-powered album and artist summaries');
    expect(html).toContain('Personalized music recommendations');
    expect(html).toContain('Weekly listening insights');
    expect(html).toContain('Your listening stats and history');
    expect(html).toContain('Public profile page');
  });

  it('renders heading', () => {
    const html = SignInCTA({ currentPath: '/' }).toString();
    expect(html).toContain('Sign in to unlock more');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Documents/GitHub/listentomore && pnpm --filter @listentomore/web exec vitest run src/__tests__/handlers/sign-in-cta.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the component**

Create `apps/web/src/components/ui/SignInCTA.tsx`:

```tsx
// ABOUTME: Sign-in call-to-action component for feature gating.
// ABOUTME: Shared by SignInGate (per-section) and requireAuthPage (full-page) patterns.

interface SignInCTAProps {
  currentPath: string;
}

export function SignInCTA({ currentPath }: SignInCTAProps) {
  const loginUrl = `/login?next=${encodeURIComponent(currentPath)}`;

  return (
    <div class="cta-box" style={{ maxWidth: '600px', marginTop: '2rem' }}>
      <h3 style={{ marginTop: '0' }}>Sign in to unlock more</h3>
      <ul style={{ textAlign: 'left', margin: '1rem auto', maxWidth: '400px' }}>
        <li>AI-powered album and artist summaries</li>
        <li>Personalized music recommendations</li>
        <li>Weekly listening insights</li>
        <li>Your listening stats and history</li>
        <li>Public profile page</li>
      </ul>
      <a href={loginUrl} class="button">Sign in with Last.fm</a>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Documents/GitHub/listentomore && pnpm --filter @listentomore/web exec vitest run src/__tests__/handlers/sign-in-cta.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Export from UI index**

Modify `apps/web/src/components/ui/index.ts` — add this line:

```typescript
export { SignInCTA } from './SignInCTA';
```

- [ ] **Step 6: Commit**

```bash
cd ~/Documents/GitHub/listentomore && git add apps/web/src/components/ui/SignInCTA.tsx apps/web/src/components/ui/index.ts apps/web/src/__tests__/handlers/sign-in-cta.test.ts && git commit -m "feat: add SignInCTA component for feature gating"
```

---

### Task 2: Create `<SignInGate>` Component

**Files:**
- Create: `apps/web/src/components/ui/SignInGate.tsx`
- Modify: `apps/web/src/components/ui/index.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/__tests__/handlers/sign-in-gate.test.ts`:

```typescript
// SignInGate component rendering tests

import { describe, it, expect } from 'vitest';
import { SignInGate } from '../../components/ui/SignInGate';

describe('SignInGate', () => {
  it('renders children when user is authenticated', () => {
    const html = SignInGate({
      currentUser: { id: '1', username: 'test' } as any,
      currentPath: '/album/abc',
      children: '<div>Protected content</div>',
    }).toString();

    expect(html).toContain('Protected content');
    expect(html).not.toContain('Sign in to unlock more');
  });

  it('renders SignInCTA when user is null', () => {
    const html = SignInGate({
      currentUser: null,
      currentPath: '/album/abc',
      children: '<div>Protected content</div>',
    }).toString();

    expect(html).not.toContain('Protected content');
    expect(html).toContain('Sign in to unlock more');
    expect(html).toContain('/login?next=%2Falbum%2Fabc');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Documents/GitHub/listentomore && pnpm --filter @listentomore/web exec vitest run src/__tests__/handlers/sign-in-gate.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the component**

Create `apps/web/src/components/ui/SignInGate.tsx`:

```tsx
// ABOUTME: Per-section auth gate component for feature gating.
// ABOUTME: Renders children for authenticated users, sign-in CTA for anonymous users.

import type { Child } from 'hono/jsx';
import type { User } from '@listentomore/db';
import { SignInCTA } from './SignInCTA';

interface SignInGateProps {
  currentUser: User | null;
  currentPath: string;
  children: Child;
}

export function SignInGate({ currentUser, currentPath, children }: SignInGateProps) {
  if (currentUser) {
    return <>{children}</>;
  }

  return <SignInCTA currentPath={currentPath} />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Documents/GitHub/listentomore && pnpm --filter @listentomore/web exec vitest run src/__tests__/handlers/sign-in-gate.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Export from UI index**

Modify `apps/web/src/components/ui/index.ts` — add this line:

```typescript
export { SignInGate } from './SignInGate';
```

- [ ] **Step 6: Commit**

```bash
cd ~/Documents/GitHub/listentomore && git add apps/web/src/components/ui/SignInGate.tsx apps/web/src/components/ui/index.ts apps/web/src/__tests__/handlers/sign-in-gate.test.ts && git commit -m "feat: add SignInGate component for per-section auth gating"
```

---

### Task 3: Create `requireAuthPage` Middleware

**Files:**
- Create: `apps/web/src/middleware/require-auth-page.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/__tests__/handlers/require-auth-page.test.ts`:

```typescript
// requireAuthPage middleware tests

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requireAuthPage } from '../../middleware/require-auth-page';

type TestVariables = {
  currentUser: any;
  isAuthenticated: boolean;
};

describe('requireAuthPage', () => {
  let app: Hono<{ Variables: TestVariables }>;

  describe('when user is authenticated', () => {
    beforeEach(() => {
      app = new Hono<{ Variables: TestVariables }>();
      app.use('*', async (c, next) => {
        c.set('currentUser', { id: '1', username: 'test' });
        c.set('isAuthenticated', true);
        await next();
      });
      app.get('/protected', requireAuthPage, (c) => c.text('protected content'));
    });

    it('passes through to the handler', async () => {
      const res = await app.request('/protected');
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toBe('protected content');
    });
  });

  describe('when user is not authenticated', () => {
    beforeEach(() => {
      app = new Hono<{ Variables: TestVariables }>();
      app.use('*', async (c, next) => {
        c.set('currentUser', null);
        c.set('isAuthenticated', false);
        await next();
      });
      app.get('/protected', requireAuthPage, (c) => c.text('protected content'));
    });

    it('returns 200 with sign-in CTA instead of handler content', async () => {
      const res = await app.request('/protected');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Sign in to unlock more');
      expect(html).not.toContain('protected content');
    });

    it('includes login link with return URL', async () => {
      const res = await app.request('/protected');
      const html = await res.text();
      expect(html).toContain('/login?next=%2Fprotected');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Documents/GitHub/listentomore && pnpm --filter @listentomore/web exec vitest run src/__tests__/handlers/require-auth-page.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the middleware**

Create `apps/web/src/middleware/require-auth-page.tsx`:

```tsx
// ABOUTME: Full-page auth gate middleware for feature gating.
// ABOUTME: Renders a sign-in CTA page instead of redirecting to /login.

import { createMiddleware } from 'hono/factory';
import type { Bindings, Variables } from '../types';
import { Layout } from '../components/layout';
import { SignInCTA } from '../components/ui';

export const requireAuthPage = createMiddleware<{
  Bindings: Bindings;
  Variables: Variables;
}>(async (c, next) => {
  if (c.get('isAuthenticated')) {
    await next();
    return;
  }

  const currentPath = c.req.path;
  return c.html(
    <Layout title="Sign In Required" currentUser={null}>
      <div style={{ paddingTop: '2rem' }}>
        <SignInCTA currentPath={currentPath} />
      </div>
    </Layout>
  );
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Documents/GitHub/listentomore && pnpm --filter @listentomore/web exec vitest run src/__tests__/handlers/require-auth-page.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/GitHub/listentomore && git add apps/web/src/middleware/require-auth-page.tsx apps/web/src/__tests__/handlers/require-auth-page.test.ts && git commit -m "feat: add requireAuthPage middleware for full-page auth gating"
```

---

### Task 4: Create `requireSessionAuth` Middleware for Internal API

**Files:**
- Create: `apps/web/src/middleware/require-session-auth.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/__tests__/handlers/require-session-auth.test.ts`:

```typescript
// requireSessionAuth middleware tests

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requireSessionAuth } from '../../middleware/require-session-auth';

type TestVariables = {
  currentUser: any;
  isAuthenticated: boolean;
};

describe('requireSessionAuth', () => {
  let app: Hono<{ Variables: TestVariables }>;

  describe('when user is authenticated', () => {
    beforeEach(() => {
      app = new Hono<{ Variables: TestVariables }>();
      app.use('*', async (c, next) => {
        c.set('currentUser', { id: '1', username: 'test' });
        c.set('isAuthenticated', true);
        await next();
      });
      app.get('/api/internal/album-summary', requireSessionAuth, (c) =>
        c.json({ data: 'summary' })
      );
    });

    it('passes through to the handler', async () => {
      const res = await app.request('/api/internal/album-summary');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ data: 'summary' });
    });
  });

  describe('when user is not authenticated', () => {
    beforeEach(() => {
      app = new Hono<{ Variables: TestVariables }>();
      app.use('*', async (c, next) => {
        c.set('currentUser', null);
        c.set('isAuthenticated', false);
        await next();
      });
      app.get('/api/internal/album-summary', requireSessionAuth, (c) =>
        c.json({ data: 'summary' })
      );
    });

    it('returns 401 with error message', async () => {
      const res = await app.request('/api/internal/album-summary');
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json).toEqual({ error: 'Authentication required' });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Documents/GitHub/listentomore && pnpm --filter @listentomore/web exec vitest run src/__tests__/handlers/require-session-auth.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the middleware**

Create `apps/web/src/middleware/require-session-auth.ts`:

```typescript
// ABOUTME: Session-based auth guard for internal API routes.
// ABOUTME: Returns 401 JSON for unauthenticated requests to AI-powered endpoints.

import { createMiddleware } from 'hono/factory';
import type { Bindings, Variables } from '../types';

export const requireSessionAuth = createMiddleware<{
  Bindings: Bindings;
  Variables: Variables;
}>(async (c, next) => {
  if (c.get('isAuthenticated')) {
    await next();
    return;
  }

  return c.json({ error: 'Authentication required' }, 401);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Documents/GitHub/listentomore && pnpm --filter @listentomore/web exec vitest run src/__tests__/handlers/require-session-auth.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/GitHub/listentomore && git add apps/web/src/middleware/require-session-auth.ts apps/web/src/__tests__/handlers/require-session-auth.test.ts && git commit -m "feat: add requireSessionAuth middleware for internal API gating"
```

---

### Task 5: Add `__IS_AUTHENTICATED__` Flag to Layout

**Files:**
- Modify: `apps/web/src/components/layout/Layout.tsx:89-104`

- [ ] **Step 1: Modify the Layout component**

In `apps/web/src/components/layout/Layout.tsx`, replace the internal token script block (lines 89–104):

Replace this:
```tsx
        {/* Internal API Token - for progressive loading fetch calls */}
        {internalToken && (
          <script
            dangerouslySetInnerHTML={{
              __html: `
                window.__INTERNAL_TOKEN__ = '${internalToken}';
                window.internalFetch = function(url, options) {
                  options = options || {};
                  options.headers = options.headers || {};
                  options.headers['X-Internal-Token'] = window.__INTERNAL_TOKEN__;
                  return fetch(url, options);
                };
              `,
            }}
          />
        )}
```

With this:
```tsx
        {/* Internal API Token and auth flag - for progressive loading fetch calls */}
        {internalToken && (
          <script
            dangerouslySetInnerHTML={{
              __html: `
                window.__INTERNAL_TOKEN__ = '${internalToken}';
                window.__IS_AUTHENTICATED__ = ${!!currentUser};
                window.internalFetch = function(url, options) {
                  options = options || {};
                  options.headers = options.headers || {};
                  options.headers['X-Internal-Token'] = window.__INTERNAL_TOKEN__;
                  return fetch(url, options);
                };
              `,
            }}
          />
        )}
```

- [ ] **Step 2: Run existing tests to verify no regressions**

Run: `cd ~/Documents/GitHub/listentomore && pnpm --filter @listentomore/web test`
Expected: All existing tests pass

- [ ] **Step 3: Commit**

```bash
cd ~/Documents/GitHub/listentomore && git add apps/web/src/components/layout/Layout.tsx && git commit -m "feat: add __IS_AUTHENTICATED__ flag to Layout for client-side gating"
```

---

### Task 6: Gate Album Page AI Sections

**Files:**
- Modify: `apps/web/src/pages/album/detail.tsx:1-199`

- [ ] **Step 1: Add SignInGate import**

In `apps/web/src/pages/album/detail.tsx`, add the import after the existing imports (after line 9):

```typescript
import { SignInGate } from '../../components/ui';
```

- [ ] **Step 2: Wrap AI sections in SignInGate**

In the `AlbumDetailPage` component, replace the AI summary and recommendations divs (lines 114–124):

Replace this:
```tsx
          {/* AI Summary - loaded via JS */}
          <div id="ai-summary" class="ai-summary">
            <p class="text-muted">Loading AI summary...</p>
          </div>

          {/* Album Recommendations - loaded via JS */}
          <div id="album-recommendations" class="ai-summary" style={{ marginTop: '2rem' }}>
            <h3>Album Recommendations</h3>
            <p class="text-muted">Loading recommendations...</p>
          </div>
```

With this:
```tsx
          {/* AI Summary + Recommendations - gated behind login */}
          <SignInGate currentUser={currentUser} currentPath={`/album/${album.id}`}>
            <div id="ai-summary" class="ai-summary">
              <p class="text-muted">Loading AI summary...</p>
            </div>

            <div id="album-recommendations" class="ai-summary" style={{ marginTop: '2rem' }}>
              <h3>Album Recommendations</h3>
              <p class="text-muted">Loading recommendations...</p>
            </div>
          </SignInGate>
```

- [ ] **Step 3: Gate client-side AI fetch calls**

In the same file, in the inline `<script>` block (around lines 128–196), wrap the AI summary and recommendations fetch calls in an auth check. Replace the two fetch blocks (album-summary and album-recommendations) by wrapping them:

After the streaming-links fetch block (which stays ungated), replace:
```javascript
          // Fetch AI summary
          internalFetch('/api/internal/album-summary?artist=' + encodeURIComponent(artistName) + '&album=' + encodeURIComponent(albumName), { cache: 'no-store' })
```

With:
```javascript
          // AI features - only fetch for authenticated users
          if (window.__IS_AUTHENTICATED__) {

          // Fetch AI summary
          internalFetch('/api/internal/album-summary?artist=' + encodeURIComponent(artistName) + '&album=' + encodeURIComponent(albumName), { cache: 'no-store' })
```

And after the album-recommendations `.catch()` block closing `});`, add:
```javascript
          } // end auth check
```

The full gated block should look like:
```javascript
          // AI features - only fetch for authenticated users
          if (window.__IS_AUTHENTICATED__) {

          // Fetch AI summary
          internalFetch('/api/internal/album-summary?artist=' + ...
            .then(...)
            .catch(...);

          // Fetch album recommendations
          internalFetch('/api/internal/album-recommendations?artist=' + ...
            .then(...)
            .catch(...);

          } // end auth check
```

- [ ] **Step 4: Run existing tests to verify no regressions**

Run: `cd ~/Documents/GitHub/listentomore && pnpm --filter @listentomore/web test`
Expected: All existing tests pass

- [ ] **Step 5: Run typecheck**

Run: `cd ~/Documents/GitHub/listentomore && pnpm --filter @listentomore/web typecheck`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
cd ~/Documents/GitHub/listentomore && git add apps/web/src/pages/album/detail.tsx && git commit -m "feat: gate album page AI summary and recommendations behind login"
```

---

### Task 7: Apply `requireSessionAuth` to Internal API Routes

**Files:**
- Modify: `apps/web/src/api/internal/album.ts`
- Modify: `apps/web/src/api/internal/artist.ts`
- Modify: `apps/web/src/api/internal/genre.ts`
- Modify: `apps/web/src/api/internal/insights.ts`

- [ ] **Step 1: Gate album internal routes**

In `apps/web/src/api/internal/album.ts`, add the import at the top (after line 3):

```typescript
import { requireSessionAuth } from '../../middleware/require-session-auth';
```

Then add `requireSessionAuth` as middleware to both routes. Replace:
```typescript
app.get('/album-summary', async (c) => {
```
With:
```typescript
app.get('/album-summary', requireSessionAuth, async (c) => {
```

Replace:
```typescript
app.get('/album-recommendations', async (c) => {
```
With:
```typescript
app.get('/album-recommendations', requireSessionAuth, async (c) => {
```

- [ ] **Step 2: Gate artist internal routes**

In `apps/web/src/api/internal/artist.ts`, add the import at the top (after line 3):

```typescript
import { requireSessionAuth } from '../../middleware/require-session-auth';
```

Gate the AI-powered routes only. Replace:
```typescript
app.get('/artist-summary', async (c) => {
```
With:
```typescript
app.get('/artist-summary', requireSessionAuth, async (c) => {
```

Replace:
```typescript
app.get('/artist-sentence', async (c) => {
```
With:
```typescript
app.get('/artist-sentence', requireSessionAuth, async (c) => {
```

Leave `/artist-lastfm` ungated — it calls Last.fm, not OpenAI.

- [ ] **Step 3: Gate genre internal routes**

In `apps/web/src/api/internal/genre.ts`, add the import at the top (after line 3):

```typescript
import { requireSessionAuth } from '../../middleware/require-session-auth';
```

Replace:
```typescript
app.get('/genre-summary', async (c) => {
```
With:
```typescript
app.get('/genre-summary', requireSessionAuth, async (c) => {
```

- [ ] **Step 4: Gate insights internal routes**

In `apps/web/src/api/internal/insights.ts`, add the import at the top (after line 8):

```typescript
import { requireSessionAuth } from '../../middleware/require-session-auth';
```

Gate the AI-powered routes. Replace:
```typescript
app.get('/user-insights-summary', async (c) => {
```
With:
```typescript
app.get('/user-insights-summary', requireSessionAuth, async (c) => {
```

Replace:
```typescript
app.get('/user-insights-recommendations', async (c) => {
```
With:
```typescript
app.get('/user-insights-recommendations', requireSessionAuth, async (c) => {
```

Leave `/user-insights-cooldown` ungated — it just checks rate limit status, no AI calls.

- [ ] **Step 5: Run all tests**

Run: `cd ~/Documents/GitHub/listentomore && pnpm test`
Expected: All tests pass

- [ ] **Step 6: Run typecheck**

Run: `cd ~/Documents/GitHub/listentomore && pnpm typecheck`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
cd ~/Documents/GitHub/listentomore && git add apps/web/src/api/internal/album.ts apps/web/src/api/internal/artist.ts apps/web/src/api/internal/genre.ts apps/web/src/api/internal/insights.ts && git commit -m "feat: add session auth guard to AI-powered internal API routes"
```

---

### Task 8: Manual Smoke Test

**Files:** None (verification only)

- [ ] **Step 1: Start dev server**

Run: `cd ~/Documents/GitHub/listentomore && pnpm dev`

- [ ] **Step 2: Test album page as anonymous user**

Open `http://localhost:8787/album/4LH4d3cOWNNsVw41Gqt2kv` (OK Computer by Radiohead) in an incognito/private window.

Verify:
- Album name, artist, cover image, release year, genres all render
- Streaming links load (Spotify, Apple Music, etc.)
- AI summary and recommendations sections do NOT appear
- Sign-in CTA banner appears at the bottom with the benefits list
- "Sign in with Last.fm" button links to `/login?next=%2Falbum%2F4LH4d3cOWNNsVw41Gqt2kv`
- Browser DevTools Network tab shows NO requests to `/api/internal/album-summary` or `/api/internal/album-recommendations`

- [ ] **Step 3: Test album page as authenticated user**

Open the same URL in a normal window where you're logged in.

Verify:
- All album info renders as before
- AI summary loads
- Recommendations load
- No sign-in CTA banner

- [ ] **Step 4: Test internal API hardening**

In browser DevTools console (incognito window), try:

```javascript
fetch('/api/internal/album-summary?artist=Radiohead&album=OK%20Computer', {
  headers: { 'X-Internal-Token': 'fake-token' }
}).then(r => r.json()).then(console.log)
```

Verify: Returns `{ error: 'Authentication required' }` with 401 status (or `{ error: 'Invalid or expired token' }` from the internal token middleware — either is correct, the point is it doesn't return AI content).

- [ ] **Step 5: Stop dev server and commit verification notes**

No code changes. Stop the dev server with Ctrl+C.

---

### Task 9: Write Developer Guide

**Files:**
- Create: `docs/feature-gating.md`

- [ ] **Step 1: Write the guide**

Create `docs/feature-gating.md`:

```markdown
# Feature Gating Guide

How to gate features behind authentication in ListenToMore.

## Two Patterns

### 1. Full-Page Gating (`requireAuthPage`)

For pages that should be entirely inaccessible to anonymous users. The handler never runs, so no data is fetched.

```typescript
// In apps/web/src/index.tsx
import { requireAuthPage } from './middleware/require-auth-page';

app.get('/stats', requireAuthPage, handleStats);
```

Anonymous users see a sign-in CTA page. Authenticated users see the normal page.

### 2. Per-Section Gating (`<SignInGate>`)

For pages where some content is public and some is gated (e.g., album pages show info publicly but gate AI features).

```tsx
import { SignInGate } from '../../components/ui';

// In your page component:
<SignInGate currentUser={currentUser} currentPath={`/album/${album.id}`}>
  <div id="ai-summary">...</div>
  <div id="recommendations">...</div>
</SignInGate>
```

Anonymous users see a sign-in CTA banner where the gated content would be. Authenticated users see the content.

### Client-Side JS Gating

For progressive-loading fetch calls that should only fire for authenticated users:

```javascript
if (window.__IS_AUTHENTICATED__) {
  internalFetch('/api/internal/album-summary?...')
    .then(...)
    .catch(...);
}
```

The `__IS_AUTHENTICATED__` flag is set automatically by `Layout.tsx` for all pages that receive an `internalToken`.

### Internal API Auth Guard

For API routes that back gated features (prevents manual API calls from anonymous users):

```typescript
import { requireSessionAuth } from '../../middleware/require-session-auth';

app.get('/album-summary', requireSessionAuth, async (c) => {
  // Only runs if session cookie is valid
});
```

## Currently Gated

### Gated (AI-powered, costly)
- `/api/internal/album-summary`
- `/api/internal/album-recommendations`
- `/api/internal/artist-summary`
- `/api/internal/artist-sentence`
- `/api/internal/genre-summary`
- `/api/internal/user-insights-summary`
- `/api/internal/user-insights-recommendations`

### Public (cheap)
- `/api/internal/streaming-links`
- `/api/internal/search`
- `/api/internal/artist-lastfm`
- `/api/internal/user-insights-cooldown`

## Adding a New Gated Page

1. Decide: full-page or per-section?
2. Add middleware or `<SignInGate>` wrapper
3. If the page has client-side JS fetches for gated content, wrap them in `if (window.__IS_AUTHENTICATED__)`
4. If the page calls internal API routes for AI content, add `requireSessionAuth` to those routes
5. Update the "Currently Gated" list above
```

- [ ] **Step 2: Commit**

```bash
cd ~/Documents/GitHub/listentomore && git add docs/feature-gating.md && git commit -m "docs: add feature gating guide for adding new gated pages"
```

---

### Task 10: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `cd ~/Documents/GitHub/listentomore && pnpm test`
Expected: All tests pass

- [ ] **Step 2: Run full typecheck**

Run: `cd ~/Documents/GitHub/listentomore && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Run build**

Run: `cd ~/Documents/GitHub/listentomore && pnpm build`
Expected: Build succeeds
