# Claude Instructions for ListenToMore

## Quick Reference

### Project Overview

Music discovery web app built with **Hono on Cloudflare Workers**. Monorepo managed by **Turborepo** and **pnpm**.

**Key constraint:** Single Worker architecture. Do NOT create new workers or separate API services.

### Architecture

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

### Commands

```bash
pnpm install          # Install dependencies
pnpm dev              # Start local dev server (http://localhost:8787)
pnpm build            # Build all packages
pnpm typecheck        # Type check all packages
pnpm test             # Run tests
pnpm run deploy       # Deploy to Cloudflare
```

### URL Strategy

| Resource | URL Pattern | Example |
|----------|-------------|---------|
| Albums | `/album/{spotifyId}` | `/album/4LH4d3cOWNNsVw41Gqt2kv` |
| Artists | `/artist/{spotifyId}` | `/artist/0k17h0D3J5VfsdmQ1iZtE9` |
| Genres | `/genre/{slug}` | `/genre/indie-rock` |
| User stats | `/u/{lastfm-username}` | `/u/bordesak` |

### Services via Context

```typescript
const spotify = c.get('spotify') as SpotifyService;
const lastfm = c.get('lastfm') as LastfmService;
const ai = c.get('ai') as AIService;
const songlink = c.get('songlink') as SonglinkService;
const db = c.get('db') as Database;
```

### Environment Variables

Required secrets in `apps/web/wrangler.toml`:

| Variable | Purpose |
|----------|---------|
| `SPOTIFY_CLIENT_ID` | Spotify API |
| `SPOTIFY_CLIENT_SECRET` | Spotify API |
| `SPOTIFY_REFRESH_TOKEN` | Spotify API |
| `LASTFM_API_KEY` | Last.fm API |
| `OPENAI_API_KEY` | GPT models |
| `PERPLEXITY_API_KEY` | Web-grounded AI |
| `INTERNAL_API_SECRET` | Internal API tokens |
| `ADMIN_SECRET` | Admin endpoints |

---

## Key Patterns

### Server-Side Rendering with Progressive Loading

Pages render immediately with fast data (Spotify), then progressively load slow data (AI summaries, streaming links) via client-side fetch.

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

### Adding New Pages

1. Create page component in `apps/web/src/pages/{section}/`
2. Export route handler function
3. Register route in `apps/web/src/index.tsx`

```typescript
// pages/example/index.tsx
export function ExamplePage({ data }: Props) {
  return (
    <Layout title="Example">
      <h1>Example</h1>
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

### Adding New AI Calls

**See [docs/how-to/ai-models.md](docs/how-to/ai-models.md) for the complete guide.**

| Provider | Models | Best For |
|----------|--------|----------|
| Perplexity | `sonar` | Web-grounded responses with citations |
| OpenAI | `gpt-5.1`, `gpt-5-mini`, `gpt-5-nano` | Reasoning, creative tasks, coding |

Key points:
- Pass `internalToken` to Layout for pages using internal APIs
- Use `internalFetch()` (not `fetch()`) for `/api/internal/*` calls
- AI results use markdown; use `marked.parse()` client-side

### Caching

All cache TTLs in `packages/config/src/cache.ts`. Use `getTtlSeconds()` helper.

| Data | TTL |
|------|-----|
| AI content | 120-180 days |
| Spotify data | 30 days |
| Last.fm (artist detail) | 30 days |
| Last.fm (top albums/artists) | 1 hour |
| Songlink | 30 days |

### Internal API Security

Internal APIs (`/api/internal/*`) use 5-minute signed HMAC tokens.

```typescript
// Route handler - get token from context
export async function handleMyPage(c: Context) {
  const internalToken = c.get('internalToken') as string;
  return c.html(<MyPage internalToken={internalToken} />);
}

// Component - pass token to Layout
<Layout title="My Page" internalToken={internalToken}>

// Client-side - use internalFetch()
internalFetch('/api/internal/my-endpoint').then(...)
```

Key files:
- `apps/web/src/utils/internal-token.ts` - Token generation/validation
- `apps/web/src/middleware/internal-auth.ts` - Auth middleware
- `apps/web/src/components/layout/Layout.tsx` - Embeds token

### Database (D1)

```typescript
const db = c.get('db') as Database;
const user = await db.getUserByUsername(username);
```

**Adding migrations:**
1. Create file: `packages/db/src/migrations/00X_description.sql`
2. Run locally: `pnpm --filter @listentomore/web exec wrangler d1 migrations apply DB --local`
3. Deploy: migrations auto-apply on `pnpm run deploy`

### UI Components

Located in `apps/web/src/components/ui/`. Check for existing components before creating new ones:

- **Button** - `variant: 'primary' | 'secondary'`, `size: 'small' | 'medium' | 'large'`
- **Input** - Text input with consistent styling
- **LoadingSpinner** - `text?: string`, `size: 'small' | 'medium' | 'large'`
- **FilterDropdown** - Dropdown select component
- **TrackCard** - Display track/album with image

---

## Debugging

### Local Development

```bash
pnpm dev                    # Start dev server at http://localhost:8787
```

Dev server uses local D1 database and local KV. Secrets from `.dev.vars` file.

### Viewing Production Logs

```bash
# Real-time logs from production
cd apps/web && npx wrangler tail

# With JSON formatting for parsing
npx wrangler tail --format=json
```

### Common Issues

**"Service not found" errors:**
- Check that service is initialized in middleware (`apps/web/src/index.tsx`)
- Verify `cache: c.env.CACHE` is passed when instantiating services

**Caching not working:**
- Verify `cache` parameter is passed to service constructor
- Check cache key normalization (lowercase, trim)
- Use `wrangler kv:key list --namespace-id=...` to inspect KV

**Internal API 401 errors:**
- Token expired (5-min lifetime) - refresh the page
- Missing `internalToken` prop in Layout
- Using `fetch()` instead of `internalFetch()`

**AI responses failing:**
- Check API keys in `.dev.vars` (local) or wrangler secrets (prod)
- Perplexity rate limit: 30 req/min
- OpenAI rate limit: 60 req/min

### Inspecting Cache

```bash
# List all keys in a namespace
npx wrangler kv:key list --namespace-id=YOUR_NAMESPACE_ID

# Get a specific key
npx wrangler kv:key get --namespace-id=YOUR_NAMESPACE_ID "ai:artistSummary:radiohead"

# Delete a key
npx wrangler kv:key delete --namespace-id=YOUR_NAMESPACE_ID "ai:artistSummary:radiohead"
```

### Database Queries

```bash
# Run SQL against local D1
pnpm --filter @listentomore/web exec wrangler d1 execute DB --local --command "SELECT * FROM users"

# Run against production
pnpm --filter @listentomore/web exec wrangler d1 execute DB --remote --command "SELECT * FROM users"
```

### Error Handling Pattern

```typescript
try {
  const result = await someService.getData();
  return c.json({ data: result });
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error('Context about what failed:', errorMessage, error);
  return c.json({ error: 'Failed to fetch data' }, 500);
}
```

---

## Do's and Don'ts

### Do

- Use existing UI components from `components/ui/`
- Use `c.get('serviceName')` for data fetching
- Use progressive loading for slow data (AI, external APIs)
- Use `Promise.all()` for parallel independent fetches
- Add routes to `apps/web/src/index.tsx`
- Return HTML with `c.html(<Component />)`
- Use `internalFetch()` for all `/api/internal/*` calls
- Pass `internalToken` to Layout for pages using internal APIs
- Use `getTtlSeconds(CACHE_CONFIG.x.y)` for cache TTLs

### Don't

- Create new workers or separate API services
- Use client-side data fetching for initial page render (except progressive loading)
- Expose API keys to browser
- Hardcode cache TTLs (use `CACHE_CONFIG`)
- Create duplicate components - check `components/ui/` first
- Use regular `fetch()` for internal APIs
- Cache user-specific data that changes frequently

---

## Admin Operations

### Creating API Keys

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

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | optional | Identifier for the key |
| `tier` | `"standard"` \| `"premium"` | `"standard"` | Rate limit tier (60 vs 300 req/min) |
| `scopes` | array | `["read"]` | Permissions: `read`, `write`, `ai` |

### Clearing Cache

Premium API key holders can clear cached data:

```bash
curl -X DELETE "https://listentomore.com/api/cache?type=albumDetail&artist=radiohead&album=ok%20computer" \
  -H "X-API-Key: YOUR_PREMIUM_KEY"
```

Supported types: `albumDetail`, `artistSummary`, `genreSummary`, `spotify:album`, `spotify:artist`
