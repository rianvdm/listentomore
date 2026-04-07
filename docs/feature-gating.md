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
- `/api/internal/user-insights-summary`
- `/api/internal/user-insights-recommendations`

### Public (cheap)
- `/api/internal/streaming-links`
- `/api/internal/search`
- `/api/internal/artist-lastfm`
- `/api/internal/artist-sentence` (short, cheap, used on public home page)
- `/api/internal/genre-summary` (genre pages are public discovery content)
- `/api/internal/user-insights-cooldown`

## Adding a New Gated Page

1. Decide: full-page or per-section?
2. Add middleware or `<SignInGate>` wrapper
3. If the page has client-side JS fetches for gated content, wrap them in `if (window.__IS_AUTHENTICATED__)`
4. If the page calls internal API routes for AI content, add `requireSessionAuth` to those routes
5. Update the "Currently Gated" list above
