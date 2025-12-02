# Claude Instructions for ListenToMore

## Project Overview

Music discovery web app built with **Hono on Cloudflare Workers**. Monorepo managed by **Turborepo** and **pnpm**.

**Key constraint:** Single Worker architecture. Do NOT create new workers or separate API services.

---

## Architecture

```
apps/
  web/              # Main Hono web app (Cloudflare Worker)
  discord-bot/      # Discord bot (separate Worker)
packages/
  services/         # Backend services (spotify, lastfm, ai, songlink)
  db/               # D1 schema and migrations
  config/           # Cache TTLs, site config, env typing
  shared/           # Types and utilities
```

---

## Key Patterns

### 1. Server-Side Rendering with Progressive Loading

Pages render immediately with fast data (Spotify), then progressively load slow data (AI summaries, streaming links) via client-side fetch.

**Pattern:**
```typescript
// Route handler - fetch only fast data
export async function handleAlbumDetail(c: Context) {
  const spotify = c.get('spotify');
  const album = await spotify.getAlbum(id);
  return c.html(<AlbumDetailPage album={album} />);
}

// Component - show placeholder, load slow data via JS
<div id="ai-summary">
  <p class="text-muted">Loading AI summary...</p>
</div>
<script dangerouslySetInnerHTML={{ __html: `
  internalFetch('/api/internal/album-summary?artist=...')
    .then(r => r.json())
    .then(data => {
      document.getElementById('ai-summary').innerHTML = formatMarkdown(data.data.content);
    });
` }} />
```

**Internal endpoints** (`/api/internal/*`) are used for progressive loading. They require signed tokens (not API keys) - see "Internal API Security" below.

### 2. Services via Context

Services are initialized in middleware and accessed via `c.get()`:

```typescript
const spotify = c.get('spotify') as SpotifyService;
const lastfm = c.get('lastfm') as LastfmService;
const ai = c.get('ai') as AIService;
const songlink = c.get('songlink') as SonglinkService;
const db = c.get('db') as Database;
```

### 3. Reusable UI Components

Located in `apps/web/src/components/ui/`. Always check for existing components before creating new ones:

- **Button** - `variant: 'primary' | 'secondary'`, `size: 'small' | 'medium' | 'large'`
- **Input** - Text input with consistent styling
- **LoadingSpinner** - `text?: string`, `size: 'small' | 'medium' | 'large'`
- **FilterDropdown** - Dropdown select component
- **TrackCard** - Display track/album with image

```typescript
import { Button, LoadingSpinner } from '../../components/ui';
```

### 4. Adding New Pages

1. Create page component in `apps/web/src/pages/{section}/`
2. Export route handler function
3. Register route in `apps/web/src/index.tsx`

```typescript
// pages/example/index.tsx
export function ExamplePage({ data }: Props) {
  return (
    <Layout title="Example">
      <h1>Example</h1>
      {/* content */}
    </Layout>
  );
}

export async function handleExample(c: Context) {
  const spotify = c.get('spotify');
  const data = await spotify.getData();
  return c.html(<ExamplePage data={data} />);
}

// index.tsx
import { handleExample } from './pages/example';
app.get('/example', handleExample);
```

### 5. Caching Strategy

All cache TTLs defined in `packages/config/src/cache.ts`:

- **AI content:** 120-180 days (expensive to regenerate)
- **Spotify data:** 30 days
- **Last.fm stats:** 1 hour (top albums/artists), 5 min (aggregated), 0 (recent tracks)
- **Songlink:** 30 days

Use `getTtlSeconds(CACHE_CONFIG.spotify.album)` for consistency.

### 6. URL Strategy

- Albums: `/album/{spotifyId}`
- Artists: `/artist/{spotifyId}`
- Genres: `/genre/{slug}` (e.g., `indie-rock`)
- User stats: `/u/{lastfm-username}`

Helper functions in `packages/shared/src/utils/slug.ts`:
```typescript
albumUrl(spotifyId)  // → /album/4LH4d3cOWNNsVw41Gqt2kv
artistUrl(spotifyId) // → /artist/0k17h0D3J5VfsdmQ1iZtE9
genreUrl(slug)       // → /genre/indie-rock
```

### 7. Internal API Security

Internal APIs (`/api/internal/*`) are protected with short-lived signed tokens to prevent abuse (especially costly AI endpoints).

**How it works:**
1. Server generates a 5-minute HMAC-SHA256 token on each page render
2. Token is embedded in HTML via `window.__INTERNAL_TOKEN__`
3. Client JS uses `internalFetch()` which adds the token header automatically
4. Middleware validates the token before allowing access

**For pages using internal APIs:**

```typescript
// 1. Route handler - get token from context and pass to component
export async function handleMyPage(c: Context) {
  const internalToken = c.get('internalToken') as string;
  return c.html(<MyPage data={data} internalToken={internalToken} />);
}

// 2. Component - pass token to Layout
export function MyPage({ data, internalToken }: Props) {
  return (
    <Layout title="My Page" internalToken={internalToken}>
      {/* content */}
    </Layout>
  );
}

// 3. In client-side scripts - use internalFetch() instead of fetch()
<script dangerouslySetInnerHTML={{ __html: `
  internalFetch('/api/internal/my-endpoint')
    .then(r => r.json())
    .then(data => { /* ... */ });
` }} />
```

**Key files:**
- `src/utils/internal-token.ts` - Token generation/validation
- `src/middleware/internal-auth.ts` - Auth middleware
- `src/components/layout/Layout.tsx` - Embeds token and `internalFetch()` helper

---

## Do's and Don'ts

### Do
- Use existing UI components from `components/ui/`
- Use `c.get('serviceName')` for data fetching
- Use progressive loading for slow data (AI, external APIs)
- Use `Promise.all()` for parallel independent fetches
- Add routes to `apps/web/src/index.tsx`
- Return HTML with `c.html(<Component />)`
- Use `internalFetch()` for all `/api/internal/*` calls in client-side scripts
- Pass `internalToken` to Layout for pages that use internal APIs

### Don't
- Create new workers or separate API services
- Use client-side data fetching for initial page render (except progressive loading)
- Expose API keys to browser
- Hardcode cache TTLs (use `CACHE_CONFIG`)
- Create duplicate components - check `components/ui/` first
- Use regular `fetch()` for internal APIs - always use `internalFetch()`

---

## Commands

```bash
pnpm install          # Install dependencies
pnpm dev              # Start local dev server
pnpm build            # Build all packages
pnpm run deploy       # Deploy to Cloudflare
pnpm typecheck        # Type check all packages
```

---

## Current Status

See `IMPLEMENTATION_PLAN.md` for phase details. Currently in Phase 6 (User Pages).
