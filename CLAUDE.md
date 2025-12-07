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

### 5. Adding New AI Calls

AI calls are expensive and slow, so they use progressive loading (fetch client-side after initial render) with long cache TTLs.

**See [docs/how-to/ai-models.md](docs/how-to/ai-models.md) for the complete guide**, including:
- Step-by-step instructions for adding new AI tasks
- How to switch providers (Perplexity vs OpenAI) by editing `packages/config/src/ai.ts`
- GPT-5.1 configuration (reasoning effort, verbosity, web search)

**Quick reference - provider choice:**
| Provider | Models | Best For |
|----------|--------|----------|
| Perplexity | `sonar` | Web-grounded responses with citations |
| OpenAI | `gpt-5.1`, `gpt-5-mini`, `gpt-5-nano` | Reasoning, creative tasks, coding |

**Key points:**
- Always pass `internalToken` to Layout for pages using internal APIs
- Use `internalFetch()` (not `fetch()`) for `/api/internal/*` calls
- Internal endpoints are protected with 5-minute signed HMAC tokens
- AI results use markdown; use `marked.parse()` client-side

### 6. Environment Variables for AI

Required in `apps/web/wrangler.toml` (secrets):
- `OPENAI_API_KEY` - For GPT models (random facts, playlist covers, ListenAI)
- `PERPLEXITY_API_KEY` - For web-grounded responses (artist/album/genre summaries)
- `INTERNAL_API_SECRET` - For signing internal API tokens (any random string)

These are accessed via `c.env.OPENAI_API_KEY`, etc. The AIService is initialized in middleware and available via `c.get('ai')`.

### 7. Caching Strategy

All cache TTLs defined in `packages/config/src/cache.ts`:

- **AI content:** 120-180 days (expensive to regenerate)
- **Spotify data:** 30 days
- **Last.fm stats:** 30 days (artist detail), 1 hour (top albums/artists), 5 min (aggregated), 0 (recent tracks)
- **Songlink:** 30 days

Use `getTtlSeconds(CACHE_CONFIG.spotify.album)` for consistency.

#### Implementing Caching in Services

When adding caching to a service class, follow this pattern:

```typescript
// 1. Import from config
import { CACHE_CONFIG, getTtlSeconds } from '@listentomore/config';

// 2. Accept cache in constructor
export class MyService {
  constructor(
    private config: ServiceConfig,
    private cache?: KVNamespace
  ) {}

  async getData(key: string): Promise<MyData> {
    // 3. Create normalized cache key
    const cacheKey = `prefix:dataType:${key.toLowerCase().trim()}`;

    // 4. Check cache first
    if (this.cache) {
      const cached = await this.cache.get(cacheKey, 'json');
      if (cached) {
        return cached as MyData;
      }
    }

    // 5. Fetch from API
    const result = await this.fetchFromApi(key);

    // 6. Store in cache with TTL from config
    if (this.cache) {
      await this.cache.put(cacheKey, JSON.stringify(result), {
        expirationTtl: getTtlSeconds(CACHE_CONFIG.myService.dataType),
      });
    }

    return result;
  }
}
```

**Key points:**
- Always use `getTtlSeconds()` helper - never manually calculate seconds
- Normalize cache keys (lowercase, trim) to avoid duplicates
- Add TTL config to `packages/config/src/cache.ts` before implementing
- Pass `cache` from parent service (e.g., `LastfmService` passes to `ArtistDetails`)
- **Important:** Verify `cache: c.env.CACHE` is passed when instantiating services in middleware (`apps/web/src/index.tsx`). Missing this means caching silently fails.
- Don't cache user-specific data that changes frequently (e.g., playcount)

### 8. URL Strategy

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

### 9. Error Handling

Log details server-side, return user-friendly messages to clients:

```typescript
try {
  const result = await someService.getData();
  return c.json({ data: result });
} catch (error) {
  // Log full error for debugging
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error('Context about what failed:', errorMessage, error);
  
  // Return generic message to user (don't leak internals)
  return c.json({ error: 'Failed to fetch data' }, 500);
}
```

For internal APIs, include brief `details` for debugging in dev:
```typescript
return c.json({ error: 'Failed to generate summary', details: errorMessage }, 500);
```

### 10. Database (D1)

D1 SQLite database accessed via `c.get('db')`:

```typescript
const db = c.get('db') as Database;
const user = await db.getUserByUsername(username);
```

**Key files:**
- `packages/db/src/schema.ts` - Table definitions and types
- `packages/db/src/migrations/` - SQL migration files
- `packages/db/src/index.ts` - Database class with query methods

**Adding migrations:**
1. Create new file: `packages/db/src/migrations/00X_description.sql`
2. Run locally: `pnpm --filter @listentomore/web exec wrangler d1 migrations apply DB --local`
3. Deploy: migrations auto-apply on `pnpm run deploy`

### 11. Internal API Security

Internal APIs (`/api/internal/*`) are protected with short-lived signed tokens to prevent abuse (especially costly AI endpoints).

**Security architecture:**
1. Server generates a 5-minute HMAC-SHA256 token using `INTERNAL_API_SECRET` on each page render
2. Token is embedded in HTML via `window.__INTERNAL_TOKEN__`
3. Client JS uses `internalFetch()` which adds `X-Internal-Token` header automatically
4. `internalAuthMiddleware` validates the token before allowing access
5. Internal endpoints also have `Cache-Control: no-store` to prevent browser caching

**Environment variable required:** `INTERNAL_API_SECRET` (set in wrangler.toml secrets)

**Token flow:**
```
Page Request → Middleware generates token → Token embedded in HTML
                                              ↓
Client-side JS → internalFetch() adds X-Internal-Token header → Internal endpoint validates
```

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
- `apps/web/src/utils/internal-token.ts` - Token generation/validation (5-min expiry)
- `apps/web/src/middleware/internal-auth.ts` - Auth middleware
- `apps/web/src/components/layout/Layout.tsx` - Embeds token and `internalFetch()` helper

**Rate limits:** Internal endpoints skip the API key rate limiting (they're for page progressive loading, not external API access). The token expiry (5 min) and cost of AI calls provide natural protection.

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

## Admin Operations

### Creating API Keys

API keys are created via a protected admin endpoint:

```bash
curl -X POST https://listentomore.com/api/auth/keys \
  -H "X-Admin-Secret: YOUR_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "User Name or App Name",
    "tier": "standard",
    "scopes": ["read", "ai"]
  }'
```

**Parameters:**
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | optional | Identifier for the key (e.g., user name) |
| `tier` | `"standard"` \| `"premium"` | `"standard"` | Rate limit tier (60 vs 300 req/min) |
| `scopes` | array | `["read"]` | Permissions: `read`, `write`, `ai` |

**Response:**
```json
{
  "message": "API key created successfully",
  "key": "ltm_abc123...",
  "keyPrefix": "ltm_abc",
  "tier": "standard",
  "scopes": ["read", "ai"],
  "warning": "Save this key - it will not be shown again!"
}
```

**Important:** The full key is only returned once. Store it immediately.

**Environment variable required:** `ADMIN_SECRET` (set in wrangler.toml secrets)

### Clearing Cache (Premium)

Premium API key holders can clear cached data:

```bash
curl -X DELETE "https://listentomore.com/api/cache?type=albumDetail&artist=radiohead&album=ok%20computer" \
  -H "X-API-Key: YOUR_PREMIUM_KEY"
```

Supported cache types: `albumDetail`, `artistSummary`, `genreSummary`, `spotify:album`, `spotify:artist`

---

## Commands

```bash
pnpm install          # Install dependencies
pnpm dev              # Start local dev server
pnpm build            # Build all packages
pnpm test             # Run tests
pnpm run deploy       # Deploy to Cloudflare
pnpm typecheck        # Type check all packages
```

---

