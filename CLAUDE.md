# Claude Instructions for ListenToMore

## Quick Reference

### Project Overview

Music discovery web app built with **Hono on Cloudflare Workers**. Monorepo managed by **Turborepo** and **pnpm**.

**Version:** 1.2.0 (Released 2026-01-10)

**Key constraint:** Single Worker architecture. Do NOT create new workers or separate API services.

### Architecture

```
apps/
  web/              # Main Hono web app (Cloudflare Worker)
    src/
      index.tsx     # App entry, middleware, page routes
      types.ts      # Shared Bindings/Variables types
      api/          # API routes (modular structure)
        index.ts    # API overview + route mounting
        v1/         # Public API endpoints
        internal/   # Token-protected internal endpoints
        admin/      # Admin endpoints (keys, cache)
      pages/        # Page components and handlers
        account/    # Account settings and profile management
        auth/       # Login and Last.fm OAuth callback
        user/       # User profile and stats pages
        tools/      # Tools page (Discord bot, MCP server)
        album/      # Album detail pages
        artist/     # Artist detail pages
        genre/      # Genre exploration pages
      components/   # UI components
      middleware/   # Auth, rate limiting, logging, session management
      utils/        # Helpers and utilities (session, internal tokens)
  discord-bot/      # Discord bot (separate Worker, uses StreamingLinksService)
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
| User profile - Stats | `/u/{username}` | `/u/bordesak` |
| User profile - Recommendations | `/u/{username}/recommendations` | `/u/bordesak/recommendations` |
| User profile - Insights | `/u/{username}/insights` | `/u/bordesak/insights` |
| Account settings | `/account` | `/account` |
| Login | `/login` | `/login?next=/account` |
| Tools | `/tools` | `/tools` |

### Services via Context

```typescript
// Services
const spotify = c.get('spotify') as SpotifyService;
const lastfm = c.get('lastfm') as LastfmService;
const ai = c.get('ai') as AIService;
const streamingLinks = c.get('streamingLinks') as StreamingLinksService;
const db = c.get('db') as Database;

// User session context (set by sessionMiddleware)
const currentUser = c.get('currentUser') as User | null;
const isAuthenticated = c.get('isAuthenticated') as boolean;
```

### Environment Variables

Required secrets in `apps/web/wrangler.toml`:

| Variable | Purpose |
|----------|---------|
| `SPOTIFY_CLIENT_ID` | Spotify API |
| `SPOTIFY_CLIENT_SECRET` | Spotify API |
| `SPOTIFY_REFRESH_TOKEN` | Spotify API |
| `LASTFM_API_KEY` | Last.fm API (read-only) |
| `LASTFM_SHARED_SECRET` | Last.fm API (for authentication) |
| `OPENAI_API_KEY` | GPT models |
| `PERPLEXITY_API_KEY` | Web-grounded AI |
| `INTERNAL_API_SECRET` | Internal API tokens |
| `ADMIN_SECRET` | Admin endpoints |
| `DISCORD_WEBHOOK_URL` | Discord notifications (user signups) |

Discord bot secrets in `apps/discord-bot/wrangler.toml`:

| Variable | Purpose |
|----------|---------|
| `DISCORD_TOKEN` | Discord bot token |
| `DISCORD_APPLICATION_ID` | Discord app ID |
| `DISCORD_PUBLIC_KEY` | Discord interaction verification |
| `SPOTIFY_CLIENT_ID` | Spotify API |
| `SPOTIFY_CLIENT_SECRET` | Spotify API |
| `SPOTIFY_REFRESH_TOKEN` | Spotify API |
| `LASTFM_API_KEY` | Last.fm API |
| `OPENAI_API_KEY` | AI summaries |
| `PERPLEXITY_API_KEY` | AI summaries |
| `APPLE_KEY_ID` | Apple MusicKit (for StreamingLinksService) |
| `APPLE_TEAM_ID` | Apple MusicKit |
| `APPLE_PRIVATE_KEY` | Apple MusicKit (PEM format) |

---

## Key Patterns

### User Authentication & Session Management

The app uses **Last.fm OAuth authentication** with cookie-based sessions.

**Authentication flow:**
1. User clicks "Sign In" → redirects to `/login`
2. Login page redirects to Last.fm OAuth
3. Last.fm redirects back to `/auth/lastfm/callback` with token
4. App exchanges token for Last.fm session key
5. App creates user record (or updates existing user)
6. App creates session with 30-day cookie
7. User is redirected to original destination

**Session management:**

```typescript
// Middleware injects currentUser into context for all routes
import { sessionMiddleware, requireAuth } from './middleware/session';

// Apply session middleware globally in index.tsx
app.use('*', sessionMiddleware);

// Require authentication for specific routes
app.get('/account', requireAuth, handleAccount);

// Access current user in route handlers
export async function handleMyPage(c: Context) {
  const currentUser = c.get('currentUser') as User | null;
  const isAuthenticated = c.get('isAuthenticated') as boolean;

  if (!isAuthenticated) {
    return c.redirect('/login?next=/my-page');
  }

  return c.html(<MyPage user={currentUser} />);
}
```

**Session utilities:**

```typescript
import { createSession, validateSession, destroySession } from './utils/session';

// Create session on login
await createSession(c, userId, db);

// Validate session (done automatically by sessionMiddleware)
const user = await validateSession(c, db);

// Destroy session on logout
await destroySession(c, db);
```

**User profile privacy:**
- Users have `profile_visibility` field: `'public'` or `'private'`
- Private profiles only visible to the owner
- Check in route handlers before rendering profile data

**Key files:**
- `apps/web/src/middleware/session.ts` - Session middleware
- `apps/web/src/utils/session.ts` - Session utilities
- `apps/web/src/pages/auth/login.tsx` - Login page
- `apps/web/src/pages/auth/lastfm.ts` - OAuth callback handler
- `apps/web/src/pages/account/` - Account settings
- `packages/db/src/migrations/005_user_auth.sql` - User auth schema
- `packages/db/src/migrations/006_sessions.sql` - Sessions schema

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
export function ExamplePage({ data, currentUser }: Props) {
  return (
    <Layout title="Example" currentUser={currentUser}>
      <h1>Example</h1>
    </Layout>
  );
}

export async function handleExample(c: Context) {
  const spotify = c.get('spotify');
  const currentUser = c.get('currentUser');
  const data = await spotify.getData();
  return c.html(<ExamplePage data={data} currentUser={currentUser} />);
}

// index.tsx - public page
import { handleExample } from './pages/example';
app.get('/example', handleExample);

// index.tsx - protected page (requires login)
import { requireAuth } from './middleware/session';
app.get('/account', requireAuth, handleAccount);
```

### Adding User Profile Pages

User profile pages use a shared tab navigation component for consistent UX and easy scalability.

**Current user profile pages:**
- `/u/:username` - Stats (top artists, albums, recent listening)
- `/u/:username/recommendations` - Recommendations (loved tracks, similar artists)
- `/u/:username/insights` - AI-powered 7-day listening analysis and album recommendations

**To add a new user profile page:**

1. **Create the page component** in `apps/web/src/pages/user/`

```typescript
// pages/user/insights.tsx
import type { Context } from 'hono';
import { Layout } from '../../components/layout';
import { UserProfileHeader } from '../../components/layout/UserProfileHeader';
import { UserProfileNav } from '../../components/layout/UserProfileNav';
import type { User } from '@listentomore/db';

interface UserInsightsPageProps {
  username: string;
  lastfmUsername: string;
  internalToken?: string;
  currentUser?: User | null;
}

export function UserInsightsPage({ username, lastfmUsername, internalToken, currentUser }: UserInsightsPageProps) {
  return (
    <Layout
      title={`Insights for ${username}`}
      description={`AI-powered listening insights for ${username}`}
      internalToken={internalToken}
      currentUser={currentUser}
    >
      {/* Static header establishes identity - same on all profile pages */}
      <UserProfileHeader username={username} lastfmUsername={lastfmUsername} />

      {/* Tab navigation below static header */}
      <UserProfileNav username={username} activePage="insights" />

      <main>
        {/* Page content - no changing h1 headlines */}
      </main>
    </Layout>
  );
}

export async function handleUserInsights(c: Context) {
  const username = c.req.param('username');
  const db = c.get('db') as Database;
  const internalToken = c.get('internalToken') as string;
  const currentUser = c.get('currentUser') as User | null;

  // Get user and check privacy (copy from stats.tsx)
  let user = await db.getUserByLastfmUsername(username);
  if (!user) user = await db.getUserByUsername(username);
  if (!user) return c.html(<UserNotFound username={username} />, 404);

  // Privacy check
  if (user.profile_visibility === 'private' && (!currentUser || currentUser.id !== user.id)) {
    return c.html(<PrivateProfile username={username} currentUser={currentUser} />);
  }

  return c.html(
    <UserInsightsPage
      username={user.username || user.lastfm_username}
      lastfmUsername={user.lastfm_username}
      internalToken={internalToken}
      currentUser={currentUser}
    />
  );
}
```

2. **Update UserProfileNav component** to include the new tab:

```typescript
// components/layout/UserProfileNav.tsx
interface UserProfileNavProps {
  username: string;
  activePage: 'stats' | 'recommendations' | 'insights'; // Add new page
}

export function UserProfileNav({ username, activePage }: UserProfileNavProps) {
  return (
    <nav class="profile-nav">
      <a href={`/u/${username}`} class={`profile-nav-link${activePage === 'stats' ? ' active' : ''}`}>
        Stats
      </a>
      <a href={`/u/${username}/recommendations`} class={`profile-nav-link${activePage === 'recommendations' ? ' active' : ''}`}>
        Recommendations
      </a>
      <a href={`/u/${username}/insights`} class={`profile-nav-link${activePage === 'insights' ? ' active' : ''}`}>
        Insights
      </a>
    </nav>
  );
}
```

3. **Register the route** in `apps/web/src/index.tsx`:

```typescript
import { handleUserInsights } from './pages/user/insights';
app.get('/u/:username/insights', handleUserInsights);
```

**Key requirements:**
- Use **UserProfileHeader** above **UserProfileNav** for consistent visual hierarchy (Static Header → Tabs → Content)
- No changing `<h1>` headlines below tabs - the static header provides identity
- All user pages must check `profile_visibility` before showing data
- Use `UserNotFound` and `PrivateProfile` components for error states
- Pass `internalToken` to Layout if using internal APIs for progressive loading
- Pass both `username` and `lastfmUsername` to UserProfileHeader

### Adding New API Routes

API routes are organized in `apps/web/src/api/` using Hono's sub-app pattern:

| Directory | Purpose | Auth |
|-----------|---------|------|
| `api/v1/` | Public API endpoints | Optional API key |
| `api/internal/` | Progressive loading endpoints | HMAC token |
| `api/admin/` | Admin operations | Admin secret or premium key |

**Adding a new v1 endpoint:**

```typescript
// api/v1/my-endpoint.ts
import { Hono } from 'hono';
import type { Bindings, Variables } from '../../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.get('/', async (c) => {
  const spotify = c.get('spotify');
  // ... endpoint logic
  return c.json({ data: result });
});

export const myEndpointRoutes = app;

// api/v1/index.ts - add the import and mount
import { myEndpointRoutes } from './my-endpoint';
app.route('/my-endpoint', myEndpointRoutes);
```

**Adding a new internal endpoint:**

```typescript
// api/internal/my-internal.ts
import { Hono } from 'hono';
import type { Bindings, Variables } from '../../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.get('/my-internal-data', async (c) => {
  const ai = c.get('ai');
  // ... endpoint logic
  return c.json({ data: result });
});

export const myInternalRoutes = app;

// api/internal/index.ts - add the import and mount (flat paths)
import { myInternalRoutes } from './my-internal';
app.route('/', myInternalRoutes);  // Results in /api/internal/my-internal-data
```

**Key files:**
- `apps/web/src/types.ts` - Shared `Bindings` and `Variables` types
- `apps/web/src/api/index.ts` - Main API router, mounts all sub-routers
- Middleware (auth, rate limiting) applies at `/api/*` level in `index.tsx`

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
| StreamingLinks | 30 days |

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

// User queries
const user = await db.getUserByUsername(username);
const user = await db.getUser(userId);
await db.createUser({ username, lastfm_username, ... });
await db.updateUser(userId, { display_name, bio, profile_visibility, ... });
await db.deleteUser(userId); // Cascades to sessions, searches, etc.

// Session queries
await db.createSession({ id, user_id, token_hash, expires_at, ... });
const session = await db.getSessionByToken(tokenHash);
await db.deleteSession(sessionId);
await db.deleteSessionByToken(tokenHash);
await db.updateSessionActivity(sessionId);
```

**Key tables:**
- `users` - User accounts with Last.fm integration
  - Fields: `id`, `username`, `lastfm_username`, `lastfm_session_key`, `display_name`, `avatar_url`, `bio`, `profile_visibility`, `last_login_at`, `login_count`
- `sessions` - Cookie-based sessions (30-day expiry)
  - Fields: `id`, `user_id`, `token_hash`, `user_agent`, `ip_address`, `expires_at`, `last_active_at`
  - Cascades on user delete
- `api_keys` - API authentication
- `searches` - Search history (user_id foreign key)

**Adding migrations:**
1. Create file: `packages/db/src/migrations/00X_description.sql`
2. Run locally: `pnpm --filter @listentomore/web exec wrangler d1 migrations apply DB --local`
3. Deploy: migrations auto-apply on `pnpm run deploy`

### UI Components

Located in `apps/web/src/components/ui/` and `apps/web/src/components/layout/`. Check for existing components before creating new ones:

**UI Components:**
- **Button** - `variant: 'primary' | 'secondary'`, `size: 'small' | 'medium' | 'large'`
- **Input** - Text input with consistent styling
- **LoadingSpinner** - `text?: string`, `size: 'small' | 'medium' | 'large'`
- **FilterDropdown** - Dropdown select component
- **TrackCard** - Display track/album with image

**Layout Components:**
- **Layout** - Main page wrapper with navigation and footer
- **NavBar** - Top navigation bar with site-wide links
- **UserProfileHeader** - Static header for user profile pages (`username: string`, `lastfmUsername: string`)
- **UserProfileNav** - Tab navigation for user profile pages (`username: string`, `activePage: 'stats' | 'recommendations' | 'insights'`)

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

**Session/authentication issues:**
- Session cookie not set - check `LASTFM_SHARED_SECRET` is configured
- User not authenticated - check `sessionMiddleware` is applied before route
- Login redirect loop - check `requireAuth` is not applied to `/login` or `/auth/*`
- Sessions expire after 30 days - users must re-login

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

# Check active sessions
pnpm --filter @listentomore/web exec wrangler d1 execute DB --local --command "SELECT u.username, s.last_active_at FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.expires_at > datetime('now')"

# Delete expired sessions
pnpm --filter @listentomore/web exec wrangler d1 execute DB --local --command "DELETE FROM sessions WHERE expires_at < datetime('now')"
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
- Use `c.get('currentUser')` and `c.get('isAuthenticated')` for user context
- Use `requireAuth` middleware for protected routes
- Check `profile_visibility` before showing user data
- Use progressive loading for slow data (AI, external APIs)
- Use `Promise.all()` for parallel independent fetches
- Add page routes to `apps/web/src/index.tsx`
- Add API routes to `apps/web/src/api/{v1,internal,admin}/`
- Return HTML with `c.html(<Component />)`
- Use `internalFetch()` for all `/api/internal/*` calls
- Pass `internalToken` to Layout for pages using internal APIs
- Pass `currentUser` to Layout for navigation auth state
- Use `getTtlSeconds(CACHE_CONFIG.x.y)` for cache TTLs
- Import types from `apps/web/src/types.ts` in API route files

### Don't

- Create new workers or separate API services
- Use client-side data fetching for initial page render (except progressive loading)
- Expose API keys or session tokens to browser
- Show private user profiles without checking `profile_visibility`
- Hardcode cache TTLs (use `CACHE_CONFIG`)
- Create duplicate components - check `components/ui/` first
- Use regular `fetch()` for internal APIs
- Cache user-specific data that changes frequently
- Define API routes inline in `index.tsx` (use `api/` directory)
- Store sensitive user data in KV cache

---

## API Route Structure

The API is organized into modular sub-applications under `apps/web/src/api/`:

```
api/
├── index.ts              # GET /api - overview, mounts all sub-routers
├── v1/                   # Public API (optional API key auth)
│   ├── index.ts          # Mounts all v1 routes
│   ├── album.ts          # GET /api/v1/album, /api/v1/album/recommendations
│   ├── artist.ts         # GET /api/v1/artist
│   ├── genre.ts          # GET /api/v1/genre
│   ├── ask.ts            # POST /api/v1/ask
│   ├── links.ts          # GET /api/v1/links
│   └── random-fact.ts    # GET /api/v1/random-fact
├── internal/             # Progressive loading (HMAC token auth)
│   ├── index.ts          # Mounts all internal routes (flat paths)
│   ├── album.ts          # /album-summary, /album-recommendations
│   ├── artist.ts         # /artist-summary, /artist-sentence
│   ├── genre.ts          # /genre-summary
│   ├── search.ts         # /search
│   ├── streaming.ts      # /streaming-links
│   ├── user.ts           # /user-stats, /user-top-*, /user-recent-tracks
│   ├── insights.ts       # /user-insights-summary, /user-insights-recommendations, /user-insights-cooldown
└── admin/                # Admin operations
    ├── index.ts          # Exports authRoutes and cacheRoutes
    ├── keys.ts           # POST /api/auth/keys (admin secret)
    └── cache.ts          # GET/DELETE /api/cache (premium tier)
```

**Middleware chain** (applied in `index.tsx` before routes):
1. `authMiddleware` - Validates API keys, sets `apiKey` in context
2. `requireAuth` - Enforces auth for specific routes
3. `userRateLimitMiddleware` - Rate limits by API key tier
4. `apiLoggingMiddleware` - Logs API requests
5. `internalAuthMiddleware` - Validates HMAC tokens for `/api/internal/*`

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

Supported types: `albumDetail`, `artistSummary`, `genreSummary`, `spotify:album`, `spotify:artist`, `artistSentence`
