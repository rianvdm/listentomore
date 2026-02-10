# AGENTS.md - ListenToMore

Reference for AI coding agents working in this repository. See CLAUDE.md for full project docs.

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
- Services accessed via Hono context: `c.get('spotify')`, `c.get('lastfm')`, `c.get('ai')`, `c.get('db')`
- User auth state: `c.get('currentUser')`, `c.get('isAuthenticated')`
- Check `profile_visibility` before exposing any user profile data
- Pass `internalToken` to Layout for pages that use internal APIs
- Do not expose secrets or session tokens to the browser
