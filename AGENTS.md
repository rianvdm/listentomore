# AGENTS.md - ListenToMore

Reference for AI coding agents working in this repository. `README.md` and `docs/` hold the longer project docs.

## Project Overview

Music discovery web app: **Hono on Cloudflare Workers**, monorepo with **Turborepo** + **pnpm**.
Single Worker architecture -- do NOT create new workers or separate API services.

## Build / Lint / Test Commands

```bash
pnpm install                # Install all dependencies
pnpm build                  # Build all packages (turbo)
pnpm typecheck              # Type-check all packages (strict mode)
pnpm test                   # Run all tests (turbo)
pnpm dev                    # Local dev server at http://localhost:8787
pnpm run deploy             # Deploy to Cloudflare
```

### Running tests for a single package

```bash
pnpm --filter @listentomore/web test
pnpm --filter @listentomore/streaming-links test
```

### Running a single test file

```bash
pnpm --filter @listentomore/web exec vitest run src/__tests__/services/spotify.test.ts
```

### Watch mode for a single test file

```bash
pnpm --filter @listentomore/web exec vitest src/__tests__/services/spotify.test.ts
```

### Typecheck a single package

```bash
pnpm --filter @listentomore/web typecheck
```

## Code Style

No ESLint, Prettier, or Biome configs exist. Follow the conventions below.

### Formatting

- **2-space indentation**, no tabs
- **Semicolons** at end of statements
- **Single quotes** for strings
- **Trailing commas** in multi-line arrays/objects
- `async/await` preferred over raw Promises
- Arrow functions for callbacks and short helpers

### File Headers

Files should start with `// ABOUTME:` comments (1-2 lines) describing the file's purpose:

```typescript
// ABOUTME: Spotify album operations - fetching album details and track lists.
// ABOUTME: Includes caching with configurable TTLs and distributed rate limiting.
```

### Naming Conventions

| Element          | Convention           | Example                          |
|------------------|----------------------|----------------------------------|
| Files            | kebab-case           | `album-detail.ts`, `rate-limit.ts` |
| Classes          | PascalCase           | `SpotifyService`, `Database`     |
| Interfaces/Types | PascalCase           | `AlbumDetails`, `Bindings`       |
| Functions        | camelCase            | `handleAlbumDetail`, `getTtlSeconds` |
| Constants        | SCREAMING_SNAKE_CASE | `CACHE_CONFIG`, `BATCH_SIZE`     |
| Variables        | camelCase            | `albumData`, `internalToken`     |

### Import Order

1. Framework/library imports (`hono`, `vitest`)
2. Internal workspace packages (`@listentomore/*`)
3. Relative imports (`./`, `../`)
4. Use `import type { ... }` for type-only imports

```typescript
import { Hono } from 'hono';
import type { Context } from 'hono';
import { SpotifyService } from '@listentomore/spotify';
import type { AlbumDetails } from '@listentomore/shared';
import { formatDate } from '../utils/format';
```

### TypeScript

- **Strict mode** is enabled (`strict: true`, `noUnusedLocals`, `noUnusedParameters`)
- JSX uses **Hono's JSX** (`jsxImportSource: "hono/jsx"`) -- not React
- Use explicit `import type` for type-only imports
- Use `as` casts for Hono context: `c.get('spotify') as SpotifyService`
- Explicit return types on exported/public functions; inference OK for internal ones
- Use interfaces for data shapes, type aliases for unions and app context
- Target is ES2022 with bundler module resolution

### Error Handling

Always use this pattern:

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

- Extract message via `instanceof Error` check
- Log with `console.error` and a contextual prefix
- Return user-friendly error (don't leak internals)

### API Responses

- Success: `{ data: ... }`
- Error: `{ error: '...' }` with appropriate HTTP status

### Components (JSX)

- Server-rendered Hono JSX, functional components only
- Props via destructured typed interface
- Wrap pages in `<Layout title="..." currentUser={currentUser} internalToken={internalToken}>`
- Progressive loading for slow data (AI, streaming links) via `dangerouslySetInnerHTML` with vanilla JS
- Use `internalFetch()` (not `fetch()`) for `/api/internal/*` calls client-side
- Pass Spotify IDs, not artist/album names, to the AI routes (`album-summary`, `album-recommendations`, `artist-summary`); names in query strings can trip the zone WAF (see `docs/feature-gating.md`)

### Route Handlers

Page handler and component live in the same file:

```typescript
// pages/example/index.tsx
export function ExamplePage({ data, currentUser }: Props) {
  return <Layout title="Example" currentUser={currentUser}>...</Layout>;
}

export async function handleExample(c: Context) {
  const spotify = c.get('spotify') as SpotifyService;
  const currentUser = c.get('currentUser') as User | null;
  return c.html(<ExamplePage data={await spotify.getData()} currentUser={currentUser} />);
}
```

Register in `apps/web/src/index.tsx`. Use `requireAuth` middleware for protected routes.

### API Routes

Modular Hono sub-apps in `apps/web/src/api/{v1,internal,admin}/`:

```typescript
const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
app.get('/', async (c) => { ... });
export const myRoutes = app;
```

Mount in the directory's `index.ts` via `app.route('/path', myRoutes)`.

## Testing

- Framework: **Vitest** with `globals: true` (no need to import `describe`/`it`/`expect`)
- Tests live in `src/__tests__/` mirroring source structure
- Setup file mocks `globalThis.fetch` and clears mocks in `beforeEach`
- Use `createMockKV()`, `setupFetchMock()`, `createMockSpotifyAuth()` from `__tests__/utils/mocks`
- Fixtures in `__tests__/utils/fixtures.ts`
- Pattern: arrange (mock setup) -> act (call method) -> assert (`expect`)
- Handler tests use Hono's `app.request()` for HTTP-level testing

## Key Constraints

- **Single Worker** -- all code runs in one Cloudflare Worker, no separate services
- **No client-side framework** -- vanilla JS only for progressive loading
- Cache TTLs come from `packages/config/src/cache.ts` via `getTtlSeconds()` -- never hardcode
- **`maxTokens` in `packages/config/src/ai.ts` is a budget for reasoning + prose, not prose.** Reasoning tokens are invisible and highly variable -- 294 to 2025 measured on one unchanged prompt -- so a cap sized for the visible answer truncates. Reasoning (GPT) or thinking (Claude) tokens count against the cap. Set `reasoning` explicitly on every task (Opus 5.5 and the GPT-5.6 tiers default to `medium`) and leave 3-4x headroom. Read the comment block above `AI_TASKS` before changing either
- **Never cache an AI response without `isCacheableResponse()`** (`packages/services/ai/src/cacheable.ts`). Truncation arrives as a 200 OK with `status: "incomplete"`, and these TTLs run 1-180 days, so one bad response becomes a bad page for months
- **Anonymous requests never trigger AI summary generation** -- pages read cached summaries with the read-only `getCached*` methods on `AIService`, and the generating `/api/internal/*` AI routes keep `requireSessionAuth` (see "Public When Cached" in `docs/feature-gating.md`)
- Services accessed via Hono context: `c.get('spotify')`, `c.get('lastfm')`, `c.get('ai')`, `c.get('db')`
- User auth state: `c.get('currentUser')`, `c.get('isAuthenticated')` on pages and public API routes. `/api/internal/*` skips the eager session lookup; use `await getCurrentUser(c)` (`middleware/session.ts`) or `requireSessionAuth` there
- Check `profile_visibility` before exposing any user profile data
- **The insights `WeekFacts` object and its prompt view never leave the server** -- not in an HTTP response, not in a log line
- Salience scores (`packages/services/insights/src/`) and the note prompt (`packages/services/ai/src/prompts/user-insights-note.ts`) change only alongside a run of `apps/web/scripts/insights-eval.ts` (see `docs/how-to/ai-models.md`)
- The insights history caches (scrobble days, charts, top lists, per-user artist and album counts) and the insights keys use the builders in `packages/services/insights/src/keys.ts`, whose `userKeyPrefixes` and `userExactKeys` account deletion reads. Per-user artist detail and the older per-user `lastfm:*` families (user info, top artists, top albums, loved tracks) are listed in `apps/web/src/utils/insights-cleanup.ts` itself. A new per-user family goes in one of the two, or deletion misses it
- **Only the owner's insights request starts card work** -- MusicBrainz credits calls, Spotify release-date and cover lookups, and the `albumTrivia` web search. A visitor reads `insights:card:<user>` or gets nothing (`apps/web/src/api/internal/insights-card-route.ts`, `insights-week.ts`)
- MusicBrainz credits calls go through `MUSICBRAINZ_RATE_LIMITER`, at most `CARD_MB_CALLS` per card request, retries included. A request cut short (cap, MusicBrainz error, making-of error) caches no card, so the owner's next view continues
- Tie-back text is rendered by code (`renderTieBack`). Card templates and making-of facts pass `checkCopyRubric` (`packages/services/insights/src/rubric.ts`); the making-of fact is checked before it is cached
- Card text, credits and trivia text never go in a log line: MusicBrainz credits fetch with `logUrl: false`, the insights Spotify lookups pass `quiet: true`, and the `albumTrivia`, week-note (`userInsightsSummary`) and album-picks (`userInsightsRecommendations`) calls set `quietErrors: true`, so an Anthropic error logs its status, never its body. The card helpers (`insights-card-route.ts`, `insights-making-of.ts`) and the week-note helpers in `insights-week.ts` log only fixed codes, counts and error classes from `utils/error-kind.ts`, never a username or a name. Older insights logs do carry them (the album-picks route); `docs/privacy-data-inventory.md` section 4 lists these legacy exceptions
- `insights-card.ts`, `insights-making-of.ts` and `insights-week.ts` stay Node-safe because `apps/web/scripts/insights-eval.ts` imports them. Value imports of Worker-only modules (`cloudflare:workers`) stay in `durable-objects/`; `utils/musicbrainz-limiter.ts` imports the Durable Object as a type only. `__tests__/scripts/insights-imports.test.ts` guards this
- `insights:card:<user>` is in `userExactKeys`; `insights:trivia:*` and `musicbrainz:credits:*` are global, hold no user data, and expire on their own. Update `docs/privacy-data-inventory.md` first, then the privacy page, when any of these change
- **Run D1 migration `011_user_timezone.sql` on production before deploying the insights week-facts branch.** Without it every signed-in page load fires a failing `UPDATE` (pages still render)
- Pass `internalToken` to Layout for pages that use internal APIs
- Do not expose secrets or session tokens to the browser

## Releases

GitHub releases follow Rian's side-project release notes contract: `~/git/product-ai/05-personal/side-projects/release-notes-contract.md`. Read it before drafting. Publishing a release cross-posts it to elezea.com (`.github/workflows/elezea-release-post.yml`), and the endpoint rejects anything off-contract.

- Name: `listentomore vX.Y.Z — <tagline>` (em dash).
- Body: a 1-3 sentence opening paragraph, then only `## What's new`, `## Fixes`, `## Under the hood` (optional `## Breaking changes` first). No H3s, no issue numbers, written from the user's side.
- Check every claim against the commits since the last tag, show Rian the final text, and wait for a go before `gh release create`.
- After publishing, point `BANNER_CONFIG` in `packages/config/src/index.ts` at the new release (new `id`, link, `expiresAt` about a week out) and deploy.
