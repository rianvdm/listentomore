# API Route Extraction Plan

This document describes the refactoring of API routes from `apps/web/src/index.tsx` into a modular structure.

## Problem Statement

The main entry point `apps/web/src/index.tsx` has grown to ~1800 lines and handles multiple concerns:

| Section | Lines | Description |
|---------|-------|-------------|
| App setup & middleware | 1-196 | Hono app, service initialization, auth |
| Static routes | 197-246 | /health, /robots.txt |
| Home page | 249-428 | Complex JSX with inline scripts |
| Page routes | 430-454 | One-liner delegations to handlers |
| Widget endpoint | 456-499 | /widget/recent |
| Internal APIs | 501-943 | ~440 lines of route handlers |
| API overview | 945-1005 | /api endpoint |
| Admin endpoints | 1007-1170 | /api/auth/keys, /api/cache |
| Public API v1 | 1172-1597 | ~425 lines of route handlers |
| 404 & CRON | 1599-1795 | Error handler, scheduled tasks |

**Issues:**
1. Single file doing too many things (violates single responsibility)
2. Hard to navigate and find specific API endpoints
3. Changes to APIs risk breaking unrelated code
4. Difficult to test API routes in isolation
5. Code review noise when changing one endpoint affects a 1800-line diff

## Solution

Extract API routes into a modular structure using Hono's sub-app pattern (`.route()`).

### Target Structure

```
apps/web/src/
  api/
    v1/
      album.ts              # GET /api/v1/album, GET /api/v1/album/recommendations
      artist.ts             # GET /api/v1/artist
      genre.ts              # GET /api/v1/genre
      links.ts              # GET /api/v1/links
      ask.ts                # POST /api/v1/ask
      random-fact.ts        # GET /api/v1/random-fact
      index.ts              # Combines all v1 routes
    internal/
      album.ts              # album-summary, album-recommendations
      artist.ts             # artist-summary, artist-sentence, artist-lastfm
      genre.ts              # genre-summary
      search.ts             # search, search-album-by-artist
      user.ts               # user-recommendations, user-listens, user-* endpoints
      streaming.ts          # streaming-links
      index.ts              # Combines all internal routes
    admin/
      keys.ts               # POST /api/auth/keys
      cache.ts              # GET/DELETE /api/cache
      index.ts              # Combines admin routes
    index.ts                # /api overview, mounts v1/, internal/, admin/
  index.tsx                 # App setup, middleware, page routes, CRON (~600 lines)
```

### Implementation Pattern

Hono supports composing applications using `.route()`:

```typescript
// api/v1/album.ts
import { Hono } from 'hono';
import type { Bindings, Variables } from '../../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.get('/', async (c) => {
  // ... handler logic
});

app.get('/recommendations', async (c) => {
  // ... handler logic
});

export const albumRoutes = app;

// api/v1/index.ts
import { Hono } from 'hono';
import { albumRoutes } from './album';
import { artistRoutes } from './artist';
// ...

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.route('/album', albumRoutes);
app.route('/artist', artistRoutes);
// ...

export const v1Routes = app;

// index.tsx
import { v1Routes } from './api/v1';
import { internalRoutes } from './api/internal';
import { adminRoutes } from './api/admin';

// Mount after middleware
app.route('/api/v1', v1Routes);
app.route('/api/internal', internalRoutes);
app.route('/api/auth', adminRoutes);
```

### Type Sharing

Create a shared types file for Bindings and Variables:

```typescript
// types.ts (or types/index.ts)
export type Bindings = {
  DB: D1Database;
  CACHE: KVNamespace;
  SPOTIFY_CLIENT_ID: string;
  // ... all env vars
};

export type Variables = {
  db: Database;
  spotify: SpotifyService;
  // ... all services
};

export type AppContext = { Bindings: Bindings; Variables: Variables };
```

## Implementation Steps

### Phase 1: Setup (non-breaking)

1. Create `apps/web/src/types.ts` with Bindings and Variables exports
2. Update `index.tsx` to import types from new location
3. Create empty `apps/web/src/api/` directory structure
4. Verify build passes

### Phase 2: Extract v1 Routes

Extract in order of complexity (simplest first):

1. `api/v1/random-fact.ts` - Simple, no dependencies
2. `api/v1/genre.ts` - Simple, just AI service
3. `api/v1/ask.ts` - Simple POST handler
4. `api/v1/links.ts` - Medium, uses Spotify + streaming
5. `api/v1/artist.ts` - Medium, uses Spotify + AI + Last.fm
6. `api/v1/album.ts` - Complex, handles /album and /album/recommendations
7. `api/v1/index.ts` - Combine all routes

After each extraction:
- Run `pnpm typecheck`
- Test endpoint manually with curl

### Phase 3: Extract Internal Routes

1. `api/internal/genre.ts` - genre-summary
2. `api/internal/streaming.ts` - streaming-links
3. `api/internal/album.ts` - album-summary, album-recommendations
4. `api/internal/artist.ts` - artist-summary, artist-sentence, artist-lastfm
5. `api/internal/search.ts` - search, search-album-by-artist
6. `api/internal/user.ts` - All user-* endpoints (largest file)
7. `api/internal/index.ts` - Combine all routes

### Phase 4: Extract Admin Routes

1. `api/admin/keys.ts` - POST /api/auth/keys
2. `api/admin/cache.ts` - GET/DELETE /api/cache
3. `api/admin/index.ts` - Combine admin routes

### Phase 5: Cleanup

1. Remove extracted code from `index.tsx`
2. Create `api/index.ts` with /api overview endpoint
3. Final typecheck and test
4. Update CLAUDE.md to reference new structure

## Route Mapping Reference

### Public API v1 (/api/v1/*)

| Current Location | New File | Routes |
|------------------|----------|--------|
| index.tsx:1179-1283 | api/v1/album.ts | GET /album |
| index.tsx:1555-1597 | api/v1/album.ts | GET /album/recommendations |
| index.tsx:1348-1430 | api/v1/artist.ts | GET /artist |
| index.tsx:1285-1318 | api/v1/genre.ts | GET /genre |
| index.tsx:1432-1492 | api/v1/links.ts | GET /links |
| index.tsx:1320-1346 | api/v1/ask.ts | POST /ask |
| index.tsx:1494-1553 | api/v1/random-fact.ts | GET /random-fact |

### Internal API (/api/internal/*)

| Current Location | New File | Routes |
|------------------|----------|--------|
| index.tsx:514-568 | api/internal/streaming.ts | GET /streaming-links |
| index.tsx:570-586 | api/internal/album.ts | GET /album-summary |
| index.tsx:588-604 | api/internal/album.ts | GET /album-recommendations |
| index.tsx:606-621 | api/internal/artist.ts | GET /artist-summary |
| index.tsx:623-639 | api/internal/genre.ts | GET /genre-summary |
| index.tsx:641-665 | api/internal/artist.ts | GET /artist-lastfm |
| index.tsx:667-682 | api/internal/artist.ts | GET /artist-sentence |
| index.tsx:684-700 | api/internal/search.ts | GET /search |
| index.tsx:702-719 | api/internal/search.ts | GET /search-album-by-artist |
| index.tsx:721-827 | api/internal/user.ts | GET /user-recommendations |
| index.tsx:829-867 | api/internal/user.ts | GET /user-listens |
| index.tsx:885-903 | api/internal/user.ts | GET /user-recent-track |
| index.tsx:905-923 | api/internal/user.ts | GET /user-top-artists |
| index.tsx:925-943 | api/internal/user.ts | GET /user-top-albums |

### Admin (/api/auth/*, /api/cache)

| Current Location | New File | Routes |
|------------------|----------|--------|
| index.tsx:1009-1043 | api/admin/keys.ts | POST /keys |
| index.tsx:1045-1148 | api/admin/cache.ts | DELETE /cache |
| index.tsx:1150-1170 | api/admin/cache.ts | GET /cache |

## Testing Strategy

After each file extraction:

1. **Type check:** `pnpm typecheck`
2. **Build:** `pnpm build`
3. **Manual test:** Start dev server and test affected endpoints

### Test Commands

```bash
# Public API (requires API key)
curl -H "X-API-Key: $API_KEY" "http://localhost:8787/api/v1/album?artist=radiohead&album=ok%20computer"
curl -H "X-API-Key: $API_KEY" "http://localhost:8787/api/v1/artist?q=radiohead"
curl -H "X-API-Key: $API_KEY" "http://localhost:8787/api/v1/genre?q=shoegaze"
curl -H "X-API-Key: $API_KEY" "http://localhost:8787/api/v1/links?artist=radiohead&album=ok%20computer"
curl -H "X-API-Key: $API_KEY" "http://localhost:8787/api/v1/random-fact"
curl -X POST -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"question":"recommend albums like ok computer"}' \
  "http://localhost:8787/api/v1/ask"

# Internal API (requires valid internal token - test via page load)
# These are tested by loading pages that use progressive loading

# Admin (requires admin secret)
curl -H "X-Admin-Secret: $ADMIN_SECRET" "http://localhost:8787/api/cache?prefix=ai:"
```

## Risk Mitigation

1. **Extract incrementally** - One route file at a time, test after each
2. **Keep middleware in index.tsx** - Auth, rate limiting, CORS stay centralized
3. **No logic changes** - Pure extraction, no refactoring of handler logic
4. **Types stay shared** - All routes use same Bindings/Variables types
5. **Git commits per phase** - Easy to revert if issues arise

## Success Criteria

- [ ] `index.tsx` reduced from ~1800 to ~600 lines
- [ ] All routes pass type checking
- [ ] All manual tests pass
- [ ] Build completes successfully
- [ ] No changes to API behavior (responses identical)

## Future Considerations

After this refactoring is complete, we could further:

1. Add unit tests for individual route handlers
2. Generate OpenAPI spec from route definitions
3. Add request/response validation middleware per-route
4. Consider extracting widget endpoint to `api/widget/`

These are out of scope for this refactoring.
