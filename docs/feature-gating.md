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
  internalFetch('/api/internal/album-summary?spotifyId=' + encodeURIComponent(albumId))
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

`/api/internal/*` skips the eager session lookup that pages get, so `currentUser` and `isAuthenticated` are not on the internal routers' context type (`InternalAppContext`). `requireSessionAuth` loads the session itself; a handler that needs the viewer calls `await getCurrentUser(c)` from `middleware/session.ts`, which queries D1 at most once per request.

The album and artist AI routes take `?spotifyId=` and resolve names server-side via `api/internal/spotify-lookup.ts` (normally a KV cache hit, since the page already fetched the entity). Do not put artist or album names in these URLs: the zone WAF's managed rules read titles such as `I'm Like a Virgin...` (quote followed by `LIKE`) as SQL injection and challenge the request, which a background fetch can never pass.

## Public When Cached

Album, artist and genre pages show an AI summary to every visitor when one is already cached. Generating a summary still needs a sign-in. This covers four AI tasks: `albumDetail`, `artistSummary`, `genreSummary` and `albumRecommendations`.

- **Anonymous requests never trigger generation.** Page handlers read the cache with the read-only `AIService` methods (`getCachedAlbumDetail`, `getCachedAlbumRecommendations`, `getCachedArtistSummary`, `getCachedGenreSummary`), which return `null` on a miss or a KV error and never call a model. The internal AI routes that generate keep `requireSessionAuth`, and the client script fetches them only when `window.__IS_AUTHENTICATED__` is set and the server rendered nothing.
- **Output is sanitised.** Cached Markdown goes through `renderPublicSummary` (`apps/web/src/utils/public-summaries.ts`). It escapes raw HTML except site-relative album links, drops unsafe link URLs, renders images as alt text, and refuses empty and "Not enough information available" replies, which leaves the page as it is on a miss.
- **On a hit**, logged-out visitors see the summary with an "AI-written summary" label and, below it, a sign-in prompt for personal features (`SignInCTA variant="personal"`). Signed-in visitors get the same server-rendered summary. **On a miss**, logged-out visitors see the usual `<SignInGate>` prompt and signed-in visitors get the progressive fetch.
- **Sitemap.** `/sitemap.xml` (`apps/web/src/sitemap.ts`) lists the static pages, plus album and artist pages whose `albumDetail` or `artistSummary` key is live in KV and has a row in the D1 `entity_pages` table (migration 009), plus curated genres (`isCuratedGenre`) with a cached `genreSummary`. Other genres keep `noindex` and stay out. The signed-in album and artist summary routes write the `entity_pages` rows; `apps/web/scripts/cached-summaries.ts backfill` maps entries cached before the table existed.
- **Flag.** Public rendering runs only when `PUBLIC_CACHED_SUMMARIES` is exactly `"true"` (`[vars]` in `apps/web/wrangler.toml`). The page script gets the same value as `window.__PUBLIC_SUMMARIES__` and labels a summary it fetches only when it's on. To revert, set it to anything else and deploy; no code change is needed. The flag rolls back public rendering only: pages go back to sign-in-only, unlabelled summaries, and `/sitemap.xml` (still named in robots.txt) lists the static pages only. `entity_pages` writes from the signed-in summary routes continue, so the sitemap is complete again when the flag is turned back on.

## Currently Gated

### Gated (AI-powered, costly)

Generation stays behind sign-in. With `PUBLIC_CACHED_SUMMARIES` on, album, artist and genre pages also show already-cached output from the first four routes to everyone (see "Public When Cached").

- `/api/internal/album-summary`
- `/api/internal/album-recommendations`
- `/api/internal/artist-summary`
- `/api/internal/genre-summary`
- `/api/internal/user-insights-summary`
- `/api/internal/user-insights-recommendations`
- `/api/internal/user-insights-trivia` (only the profile owner's view generates a card; visitors read the cached one)

### Public (cheap)
- `/api/internal/streaming-links`
- `/api/internal/search`
- `/api/internal/artist-lastfm`
- `/api/internal/artist-sentence` (short, cheap, used on public home page)
- `/api/internal/user-insights-cooldown`

## Adding a New Gated Page

1. Decide: full-page or per-section?
2. Add middleware or `<SignInGate>` wrapper
3. If the page has client-side JS fetches for gated content, wrap them in `if (window.__IS_AUTHENTICATED__)`
4. If the page calls internal API routes for AI content, add `requireSessionAuth` to those routes
5. Update the "Currently Gated" list above
