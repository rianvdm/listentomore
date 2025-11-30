# ListenToMore v2 - Implementation Plan

> **For LLMs:** This is a rewrite of a music discovery website. The old app (my-music-next) used Next.js + 34 separate Cloudflare Workers. The new app consolidates everything into a single Hono-based Cloudflare Worker with shared service packages. Key points:
> - **Current phase:** Phase 5 in progress (Web App - Core Pages). Skipped Phase 4 (Discogs) for now.
> - **Architecture:** Server-side rendering with progressive loading. Pages call services directly (no API keys needed). External `/api/*` endpoints require API key auth.
> - **Progressive loading:** Album and artist detail pages load instantly with basic Spotify data (~0.3s), then stream in AI summary and additional data via client-side JS calling `/api/internal/*` endpoints.
> - **Don't:** Create new workers, use client-side data fetching for pages (except progressive loading), or expose API keys to browser.
> - **Do:** Add page routes to `apps/web/src/index.tsx`, use `c.get('serviceName')` for data, return HTML with `c.html()`.

---

## Quick Reference

**Tech stack:** Hono, TypeScript, Turborepo, Cloudflare Workers + D1 + KV, Vitest

**Reference repos:**
- `/Users/rian/Documents/GitHub/my-music-next` - Current frontend
- `/Users/rian/Documents/GitHub/cloudflare-workers` - Current workers

**Deployed:** https://listentomore-web.rian-db8.workers.dev

---

## Project Structure

```
listentomore/
├── apps/
│   ├── web/                    # Main Hono web app (single Worker)
│   └── discord-bot/            # Discord bot (separate Worker, Phase 8)
├── packages/
│   ├── services/               # Backend services (spotify, lastfm, ai, songlink, discogs, library)
│   ├── db/                     # D1 schema and migrations
│   ├── config/                 # AI config, cache TTLs, env typing
│   └── shared/                 # Types and utilities
└── tools/scripts/              # Setup and migration scripts
```

---

## Infrastructure (Completed)

**D1 Database:** `listentomore` (512d0c41-502c-41ba-82ff-635d0413b071)
**KV Namespace:** CACHE (a6011a8b5bac4be9a472ff86f8d5fd91)

**Secrets (via `wrangler secret put`):**
- `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`
- `LASTFM_API_KEY`, `LASTFM_USERNAME`
- `OPENAI_API_KEY`, `PERPLEXITY_API_KEY`
- `ADMIN_SECRET`

**API Endpoints:**
- `/api/spotify/search`, `/api/spotify/album/:id`, `/api/spotify/artist/:id`
- `/api/lastfm/recent`, `/api/lastfm/top-albums`, `/api/lastfm/top-artists`, `/api/lastfm/loved`
- `/api/songlink?url=:streamingUrl`
- `/api/ai/artist-summary`, `/api/ai/album-detail`, `/api/ai/genre-summary`, `/api/ai/artist-sentence`, `/api/ai/random-fact`
- `/api/ai/ask` (POST), `/api/ai/playlist-cover/prompt` (POST), `/api/ai/playlist-cover/image` (POST)
- `/api/internal/*` - Progressive loading endpoints (no auth)

**API Security:** All `/api/*` endpoints require `X-API-Key` header. Keys stored hashed in D1. Tiers: standard (60 req/min), premium (300 req/min).

---

## Database Schema

```sql
-- Users (single-user mode: id='default')
CREATE TABLE users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE, lastfm_username TEXT,
  discogs_username TEXT, spotify_connected INTEGER DEFAULT 0,
  created_at TEXT, updated_at TEXT
);

-- Search history
CREATE TABLE searches (
  id TEXT PRIMARY KEY, user_id TEXT, search_type TEXT, query TEXT,
  result_id TEXT, result_name TEXT, result_artist TEXT, searched_at TEXT
);

-- Recent community searches (home page)
CREATE TABLE recent_searches (
  id TEXT PRIMARY KEY, spotify_id TEXT, album_name TEXT, artist_name TEXT,
  image_url TEXT, searched_at TEXT
);

-- API keys
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY, key_hash TEXT UNIQUE, name TEXT, tier TEXT,
  scopes TEXT, created_at TEXT, last_used_at TEXT, request_count INTEGER
);

-- Discogs (Phase 4)
CREATE TABLE discogs_sync_state (...);
CREATE TABLE discogs_releases (...);
```

---

## URL Strategy

URLs use Spotify IDs directly:
- Album: `/album/4LH4d3cOWNNsVw41Gqt2kv`
- Artist: `/artist/0k17h0D3J5VfsdmQ1iZtE9`
- Genre: `/genre/indie-rock` (slug-based)

```typescript
// packages/shared/src/utils/slug.ts
export function albumUrl(spotifyId: string): string { return `/album/${spotifyId}`; }
export function artistUrl(spotifyId: string): string { return `/artist/${spotifyId}`; }
export function genreUrl(slug: string): string { return `/genre/${slug}`; }
```

---

## Implementation Phases

### Phases 1-3: COMPLETED
- Foundation: Turborepo monorepo, packages structure, Hono app deployed
- Database & Services: D1 schema, Spotify/Last.fm/Songlink services with KV caching
- AI Service: OpenAI + Perplexity clients, all prompts, DALL-E image generation

### Phase 4: Discogs Service (SKIPPED for now)
- [ ] Collection sync with pagination checkpointing
- [ ] Master data enrichment
- [ ] CRON triggers

### Phase 5: Web App - Core Pages (IN PROGRESS)
- [x] Hono JSX rendering, layout, CSS
- [x] Home page (recent searches, random fact CRON)
- [x] Album search + detail (progressive loading)
- [x] Artist search + detail (basic)
- [x] Genre page
- [x] Internal API endpoints for progressive loading
- [ ] LoadingSpinner, FilterDropdown components

### Phase 6: Stats & Collection
- [ ] My Stats page (recent tracks, top artists/albums)
- [ ] Collection pages (stats, filters)
- [ ] Library page (Airtable integration)
- [ ] Recommendations page

### Phase 7: Additional Features
- [ ] Playlist cover generator
- [ ] About, Privacy, Terms, 404 pages
- [ ] Error boundaries

### Phase 8: Discord Bot
- [ ] Set up `apps/discord-bot`
- [ ] Port commands: `/listento`, `/listenlast`, `/whois`, `/ask`

### Phase 9: Testing & Polish
- [ ] Integration tests, performance testing
- [ ] Error handling audit, logging

### Phase 10: Migration & Launch
- [ ] Staging deploy, DNS cutover to listentomore.com

---

## Environment Variables

Create `apps/web/.dev.vars` for local development:
```bash
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REFRESH_TOKEN=
LASTFM_API_KEY=
LASTFM_USERNAME=
DISCOGS_API_TOKEN=
DISCOGS_USERNAME=
OPENAI_API_KEY=
PERPLEXITY_API_KEY=
AIRTABLE_API_KEY=
AIRTABLE_BASE_ID=
```

---

## Key Patterns

**Server-side rendering:** Fetch data in route handlers, return complete HTML
**Parallel fetches:** Use `Promise.all()` for independent service calls
**Progressive loading:** Fast initial render with Spotify data, then fetch AI/slow data client-side
**Caching:** Services use KV with TTLs defined in `packages/config/src/cache.ts`

**Adding new pages:**
```typescript
app.get('/my-page', async (c) => {
  const spotify = c.get('spotify');
  const data = await spotify.getData();
  return c.html(<MyPage data={data} />);
});
```

---

## Features NOT Being Ported

- `guessme` - Music guessing game
- `admin` - Admin panel
- `bluesky-random-fact` - Separate project

---

## Questions to Resolve

1. Charts: Port Recharts or find lighter alternative for server rendering?
2. Theme toggle: Server-side cookie vs client-side localStorage?
