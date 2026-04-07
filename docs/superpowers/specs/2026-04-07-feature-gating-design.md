# Feature Gating Design Spec

**Date:** 2026-04-07
**Status:** Draft
**Goal:** Gate AI-powered features behind login to reduce OpenAI costs and incentivize sign-ups, starting with album pages.

## Overview

Two complementary patterns for gating content behind authentication:

1. **`requireAuthPage` middleware** — for fully-gated pages. Renders a sign-in CTA instead of the page content. The handler never runs, so no data is fetched.
2. **`<SignInGate>` component** — for per-section gating within a page. Renders a sign-in CTA banner in place of gated children.

Both use a shared `<SignInCTA>` component for the call-to-action UI.

## What's NOT Affected

- **Discord bot** — uses its own service layer (`createServices(env)`), not web routes. No changes needed.
- **REST API (v1)** — has its own API-key auth via `X-API-Key` header. No changes needed.
- **Streaming links** — cheap, non-AI. Stay public on album pages and in the internal API.

## Components

### `<SignInCTA>` Component

**File:** `apps/web/src/components/ui/SignInCTA.tsx`

A styled card containing:

- Heading: "Sign in to unlock more"
- Benefits list (bullet points):
  - AI-powered album and artist summaries
  - Personalized music recommendations
  - Weekly listening insights
  - Your listening stats and history
  - Public profile page
- "Sign in with Last.fm" button linking to `/login?next={currentPath}`

Props:
- `currentPath: string` — for the `?next=` redirect after login

Styling follows existing card patterns in the codebase.

### `<SignInGate>` Component

**File:** `apps/web/src/components/ui/SignInGate.tsx`

Per-section gating. Wraps content that should only render for authenticated users.

Props:
- `currentUser: User | null`
- `currentPath: string`
- `children: Child`

Behavior:
- If `currentUser` is set: render `children`
- If `currentUser` is null: render `<SignInCTA currentPath={currentPath} />`

### `requireAuthPage` Middleware

**File:** `apps/web/src/middleware/require-auth-page.tsx`

For fully-gated pages. Instead of redirecting to `/login` like the existing `requireAuth`, it renders a Layout with the `<SignInCTA>` component inside.

Behavior:
- If `c.get('isAuthenticated')` is true: call `next()` (handler runs normally)
- If false: return `c.html(...)` with a Layout containing `<SignInCTA>`, using `c.req.path` for the redirect URL

Usage:
```typescript
app.get('/stats', requireAuthPage, handleStats);
```

The handler never executes for anonymous users — no unnecessary data fetching.

## Album Page Changes

**File:** `apps/web/src/pages/album/detail.tsx`

### Server-side (component)

Wrap the AI summary and recommendations divs in `<SignInGate>`:

```tsx
{/* Public content: album info, image, genres, streaming links — unchanged */}

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

### Client-side (progressive loading JS)

Gate the AI fetch calls so they never fire for anonymous users:

- Set `window.__IS_AUTHENTICATED__ = true/false` in Layout alongside the existing `__INTERNAL_TOKEN__`
- Wrap the `album-summary` and `album-recommendations` fetch calls in `if (window.__IS_AUTHENTICATED__)` checks
- The `streaming-links` fetch stays ungated — it's cheap and public

The handler (`handleAlbumDetail`) doesn't change — it still fetches Spotify data regardless of auth state.

## Internal API Hardening

**Files:** `apps/web/src/api/internal/album.ts`, `artist.ts`, `genre.ts`, `insights.ts`

Add a session-based auth guard to AI-powered internal API routes so that manual API calls from anonymous users also get rejected:

**Gated routes (AI-backed, costly):**
- `/api/internal/album-summary`
- `/api/internal/album-recommendations`
- `/api/internal/artist-summary`
- `/api/internal/genre-summary`
- `/api/internal/recommendations` (if it exists in insights)
- `/api/internal/insights-summary`

**Ungated routes (cheap, stay public):**
- `/api/internal/streaming-links`
- `/api/internal/search`

Implementation: A `requireSessionAuth` middleware (in `apps/web/src/middleware/require-session-auth.ts`) that checks for a valid session cookie using the existing `validateSession` utility and returns `{ error: 'Authentication required' }` with 401 if missing. Applied to individual routes in each internal API file (e.g., `app.get('/album-summary', requireSessionAuth, async (c) => { ... })`) — not as a blanket internal API change.

Note: These routes already require a valid internal token (HMAC-signed, 5-minute expiry). The session check adds a second layer — the token proves the request came from the server-rendered page, the session proves the user is logged in.

## Auth Flag in Layout

**File:** `apps/web/src/components/layout/Layout.tsx`

Add `window.__IS_AUTHENTICATED__` alongside the existing `__INTERNAL_TOKEN__` setup:

```typescript
{internalToken && (
  <script dangerouslySetInnerHTML={{ __html: `
    window.__INTERNAL_TOKEN__ = '${internalToken}';
    window.__IS_AUTHENTICATED__ = ${!!currentUser};
    window.internalFetch = function(url, options) { ... };
  ` }} />
)}
```

This flag is used by client-side JS to skip AI fetch calls for anonymous users.

## Future Pages

Once this infrastructure is in place, gating additional pages is straightforward:

- **Full-page gating:** Add `requireAuthPage` middleware to the route in `index.tsx`
- **Per-section gating:** Wrap sections in `<SignInGate>` and gate corresponding client-side JS behind `window.__IS_AUTHENTICATED__`

Candidate pages for future gating: artist detail (AI summary), genre pages (AI summary), user stats, insights, recommendations.

## Developer Guide

As a final implementation step, write a short guide at `docs/feature-gating.md` documenting how to gate new pages. Should cover:

- How to add full-page gating (middleware approach, with example)
- How to add per-section gating (component approach, with example)
- How to gate client-side JS fetches
- How to add session auth to new internal API routes
- Which routes are currently gated vs public
