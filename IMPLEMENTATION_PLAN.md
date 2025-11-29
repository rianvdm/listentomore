# ListenToMore v2 - Implementation Plan

This document provides everything needed to start each coding session for the rewrite.

---

## Quick Reference

**New repo name:** `listentomore`

**Tech stack:**

- Hono (web framework for Workers)
- TypeScript
- Turborepo (monorepo tooling)
- Cloudflare Workers + D1 + KV
- Vitest (testing)

**Reference repos:**

- `/Users/rian/Documents/GitHub/my-music-next` - Current frontend
- `/Users/rian/Documents/GitHub/cloudflare-workers` - Current workers

---

## Patterns to Get Right from the Start

These are anti-patterns found in the current codebase that we must avoid in the rewrite:

### 1. No Layout Files for Metadata

**Current hack:** 9 layout.js files exist solely to call `generateMetadata()` and return `{children}`.

**New approach:** Metadata lives in page files only. Create a centralized metadata utility:

```typescript
// packages/shared/src/utils/metadata.ts
export function createMetadata(params: MetadataParams): Metadata {
  return {
    title: params.title ? `${params.title} | Listen To More` : 'Listen To More',
    description: params.description || DEFAULT_DESCRIPTION,
    openGraph: { ...DEFAULT_OG, ...params.openGraph },
    twitter: { ...DEFAULT_TWITTER, ...params.twitter },
  };
}
```

### 2. Centralized API Endpoints

**Current hack:** 30+ hardcoded URLs like `https://api-lastfm-artistdetail.rian-db8.workers.dev` scattered across files.

**New approach:** All API calls go through service classes. No raw URLs in components.

### 3. Single Data Fetching Pattern

**Current hack:** 5 different patterns (useEffect, hooks, layout fetching, sequential, nested).

**New approach:** One custom hook pattern for all data fetching:

```typescript
// Example usage in any component
const { data, loading, error } = useQuery(() => spotify.getAlbum(id));
```

### 4. Consistent Error Handling

**Current hack:** Some pages show errors, others silently fail, others crash.

**New approach:** Every fetch has error handling. Standardized error UI component.

### 5. Consistent Loading States

**Current hack:** String states (`'Loading...'`), booleans, nulls, objects all used.

**New approach:** Single pattern: `{ data: T | null, loading: boolean, error: Error | null }`

### 6. No Inline Styles

**Current hack:** 13 files with inline style objects.

**New approach:** CSS modules only. Create utility classes for common patterns.

### 7. No Duplicate Code

**Current issues found:**

- Random fact fetching duplicated in album/page.js and artist/page.js
- Citation rendering duplicated in album and genre pages
- URL parsing duplicated in layout and page files
- Filter logic duplicated in collection and library pages

**New approach:** Extract to shared components and hooks immediately.

### 8. Consistent Link Handling

**Current hack:** Mix of `<Link>` and `<a>` tags for internal routes.

**New approach:** Always use framework's Link component for internal routes.

---

## Project Structure

```
listentomore/
├── apps/
│   ├── web/                          # Main web application
│   │   ├── src/
│   │   │   ├── index.ts              # Hono app entry point
│   │   │   ├── routes/               # Page routes
│   │   │   │   ├── index.tsx         # Home page
│   │   │   │   ├── album/
│   │   │   │   │   ├── index.tsx     # Album search
│   │   │   │   │   └── [id].tsx      # Album detail (by Spotify ID)
│   │   │   │   ├── artist/
│   │   │   │   │   ├── index.tsx     # Artist search
│   │   │   │   │   └── [id].tsx      # Artist detail
│   │   │   │   ├── stats/            # My stats page
│   │   │   │   ├── collection/       # Discogs collection
│   │   │   │   ├── library/          # Digital library
│   │   │   │   ├── recommendations/  # Recommendations page
│   │   │   │   ├── genre/[slug].tsx  # Genre pages
│   │   │   │   └── playlist-cover/   # Playlist cover generator
│   │   │   ├── api/                  # API routes
│   │   │   │   ├── spotify.ts
│   │   │   │   ├── lastfm.ts
│   │   │   │   ├── discogs.ts
│   │   │   │   ├── ai.ts
│   │   │   │   └── songlink.ts
│   │   │   ├── components/           # JSX components
│   │   │   │   ├── ui/               # Reusable UI components
│   │   │   │   ├── layout/           # Layout components
│   │   │   │   └── features/         # Feature-specific components
│   │   │   ├── lib/                  # App-specific utilities
│   │   │   └── styles/               # CSS files
│   │   ├── public/                   # Static assets
│   │   ├── wrangler.toml
│   │   └── package.json
│   │
│   └── discord-bot/                  # Discord bot (separate worker)
│       ├── src/
│       │   ├── index.ts              # Bot entry point
│       │   ├── commands/             # Slash command handlers
│       │   │   ├── listento.ts
│       │   │   ├── listenlast.ts
│       │   │   ├── whois.ts
│       │   │   └── ask.ts
│       │   └── lib/                  # Bot utilities
│       ├── wrangler.toml
│       └── package.json
│
├── packages/
│   ├── services/                     # Backend service modules
│   │   ├── spotify/
│   │   │   ├── src/
│   │   │   │   ├── index.ts          # SpotifyService class
│   │   │   │   ├── auth.ts           # Token management
│   │   │   │   ├── search.ts         # Search functionality
│   │   │   │   ├── albums.ts         # Album operations
│   │   │   │   └── artists.ts        # Artist operations
│   │   │   └── package.json
│   │   │
│   │   ├── lastfm/
│   │   │   ├── src/
│   │   │   │   ├── index.ts          # LastfmService class
│   │   │   │   ├── recent-tracks.ts
│   │   │   │   ├── top-albums.ts
│   │   │   │   ├── top-artists.ts
│   │   │   │   ├── loved-tracks.ts
│   │   │   │   └── artist-detail.ts
│   │   │   └── package.json
│   │   │
│   │   ├── discogs/
│   │   │   ├── src/
│   │   │   │   ├── index.ts          # DiscogsService class
│   │   │   │   ├── sync.ts           # Collection sync (state machine)
│   │   │   │   ├── enrichment.ts     # Master data enrichment
│   │   │   │   ├── collection.ts     # Collection queries
│   │   │   │   └── rate-limiter.ts   # Centralized rate limiting
│   │   │   └── package.json
│   │   │
│   │   ├── ai/
│   │   │   ├── src/
│   │   │   │   ├── index.ts          # AIService class
│   │   │   │   ├── openai.ts         # OpenAI client
│   │   │   │   ├── perplexity.ts     # Perplexity client
│   │   │   │   ├── prompts/          # All prompts live here
│   │   │   │   │   ├── artist-summary.ts
│   │   │   │   │   ├── album-detail.ts
│   │   │   │   │   ├── genre-summary.ts
│   │   │   │   │   ├── random-fact.ts
│   │   │   │   │   └── playlist-cover.ts
│   │   │   │   └── cache.ts          # AI response caching
│   │   │   └── package.json
│   │   │
│   │   ├── songlink/
│   │   │   ├── src/
│   │   │   │   └── index.ts          # SonglinkService class
│   │   │   └── package.json
│   │   │
│   │   └── library/
│   │       ├── src/
│   │       │   └── index.ts          # LibraryService (Airtable)
│   │       └── package.json
│   │
│   ├── db/                           # Database package
│   │   ├── src/
│   │   │   ├── schema.ts             # D1 schema definitions
│   │   │   ├── migrations/           # SQL migrations
│   │   │   ├── queries/              # Prepared queries
│   │   │   └── index.ts              # Database client
│   │   └── package.json
│   │
│   ├── config/                       # Centralized configuration
│   │   ├── src/
│   │   │   ├── ai.ts                 # AI configuration (see below)
│   │   │   ├── cache.ts              # Cache TTL configuration
│   │   │   ├── env.ts                # Environment variable typing
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   └── shared/                       # Shared utilities & types
│       ├── src/
│       │   ├── types/                # TypeScript types
│       │   │   ├── album.ts
│       │   │   ├── artist.ts
│       │   │   ├── track.ts
│       │   │   ├── collection.ts
│       │   │   └── index.ts
│       │   ├── utils/
│       │   │   ├── cors.ts
│       │   │   ├── errors.ts
│       │   │   ├── http.ts
│       │   │   └── slug.ts           # New slug utilities (with ID support)
│       │   └── index.ts
│       └── package.json
│
├── tools/                            # Build and dev tooling
│   └── scripts/
│       ├── setup.ts                  # Initial setup script
│       └── migrate.ts                # D1 migration runner
│
├── turbo.json                        # Turborepo configuration
├── package.json                      # Root package.json (workspaces)
├── tsconfig.json                     # Base TypeScript config
├── .env.example                      # Environment template
└── README.md
```

---

## Centralized AI Configuration

All AI settings live in `packages/config/src/ai.ts`:

```typescript
// packages/config/src/ai.ts

export const AI_CONFIG = {
  providers: {
    openai: {
      baseUrl: 'https://api.openai.com/v1',
      defaultModel: 'gpt-4o-mini',
    },
    perplexity: {
      baseUrl: 'https://api.perplexity.ai',
      defaultModel: 'llama-3.1-sonar-small-128k-online',
    },
  },

  tasks: {
    artistSummary: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      maxTokens: 500,
      temperature: 0.7,
      cacheTtlDays: 180,
      systemPrompt: `You are a music expert who writes concise, engaging artist summaries.
Use plain language without hyperbole. Focus on the artist's musical style,
key albums, and cultural impact. Keep responses under 200 words.

When mentioning other artists, wrap their names in [[double brackets]] like [[Artist Name]].
When mentioning albums, wrap them in {{double braces}} like {{Album Title}}.`,
      userPromptTemplate: (artistName: string) =>
        `Write a summary of the music artist/band "${artistName}".`,
    },

    albumDetail: {
      provider: 'perplexity',
      model: 'llama-3.1-sonar-small-128k-online',
      maxTokens: 1000,
      temperature: 0.5,
      cacheTtlDays: 120,
      systemPrompt: `You are a music critic who writes informative album reviews.
Include context about when the album was released, its reception, and its place
in the artist's discography. Be factual and cite sources when possible.
Keep responses under 300 words.`,
      userPromptTemplate: (artist: string, album: string) =>
        `Write about the album "${album}" by ${artist}. Include its reception and significance.`,
    },

    genreSummary: {
      provider: 'perplexity',
      model: 'llama-3.1-sonar-small-128k-online',
      maxTokens: 200,
      temperature: 0.5,
      cacheTtlDays: 180,
      systemPrompt: `You are a music historian. Write brief, informative genre descriptions.
Focus on the genre's origins, key characteristics, and notable artists.
Keep responses to 2-3 sentences.`,
      userPromptTemplate: (genre: string) =>
        `Describe the music genre "${genre}" in 2-3 sentences.`,
    },

    artistSentence: {
      provider: 'perplexity',
      model: 'llama-3.1-sonar-small-128k-online',
      maxTokens: 100,
      temperature: 0.5,
      cacheTtlDays: 180,
      systemPrompt: `You write single-sentence artist descriptions. Be concise and factual.
Maximum 38 words. No fluff or superlatives.`,
      userPromptTemplate: (artistName: string) =>
        `Describe ${artistName} in one sentence (max 38 words).`,
    },

    randomFact: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      maxTokens: 200,
      temperature: 0.9,
      cacheTtlDays: 0, // No caching - always fresh
      systemPrompt: `You share interesting, lesser-known music facts. Be specific with dates,
names, and details. Facts should be surprising or counterintuitive.
Keep responses to 2-3 sentences.`,
      userPromptTemplate: () => `Share an interesting, lesser-known fact about music history.`,
    },

    playlistCoverPrompt: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      maxTokens: 300,
      temperature: 0.8,
      cacheTtlDays: 0,
      systemPrompt: `You create DALL-E prompts for playlist cover art.
The prompts should be visual and artistic, avoiding text or words in the image.
Focus on mood, color, and abstract representation of the music.`,
      userPromptTemplate: (playlistName: string, description: string) =>
        `Create a DALL-E prompt for a playlist called "${playlistName}". Description: ${description}`,
    },

    listenAi: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      maxTokens: 600,
      temperature: 0.8,
      cacheTtlDays: 0,
      systemPrompt: `You are Rick Rubin, the legendary music producer. You speak thoughtfully
and philosophically about music. You reference your experiences producing artists
across genres - from Beastie Boys to Johnny Cash to Slayer.
Keep responses to 4 sentences maximum. Be warm but wise.`,
      userPromptTemplate: (question: string) => question,
    },
  },

  imageGeneration: {
    playlistCover: {
      provider: 'openai',
      model: 'dall-e-3',
      size: '1024x1024',
      quality: 'standard',
    },
  },

  rateLimits: {
    openai: {
      requestsPerMinute: 60,
      tokensPerMinute: 90000,
    },
    perplexity: {
      requestsPerMinute: 30,
    },
  },
} as const;

// Type exports for use in services
export type AITask = keyof typeof AI_CONFIG.tasks;
export type AIProvider = keyof typeof AI_CONFIG.providers;
```

---

## Centralized Cache Configuration

```typescript
// packages/config/src/cache.ts

export const CACHE_CONFIG = {
  // AI-generated content (expensive to regenerate)
  ai: {
    artistSummary: { ttlDays: 180 },
    albumDetail: { ttlDays: 120 },
    genreSummary: { ttlDays: 180 },
    artistSentence: { ttlDays: 180 },
  },

  // External API data (changes occasionally)
  spotify: {
    search: { ttlDays: 30 },
    album: { ttlDays: 30 },
    artist: { ttlDays: 30 },
    token: { ttlMinutes: 55 }, // Tokens expire in 60 min
  },

  lastfm: {
    artistDetail: { ttlDays: 7 },
    topAlbums: { ttlHours: 1 },
    topArtists: { ttlHours: 1 },
    recentTracks: { ttlMinutes: 5 },
    lovedTracks: { ttlHours: 1 },
  },

  discogs: {
    collection: { ttlHours: 8 },
    master: { ttlDays: 90 },
  },

  songlink: {
    links: { ttlDays: 30 },
  },

  // HTTP cache headers for responses
  http: {
    static: { maxAge: 86400, staleWhileRevalidate: 43200 }, // 1 day
    dynamic: { maxAge: 300, staleWhileRevalidate: 60 }, // 5 min
    realtime: { maxAge: 60, staleWhileRevalidate: 30 }, // 1 min
    noCache: { maxAge: 0, staleWhileRevalidate: 0 },
  },
} as const;
```

---

## Database Schema (D1)

```sql
-- packages/db/src/migrations/001_initial.sql

-- Users table (for future multi-user support)
CREATE TABLE users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email TEXT UNIQUE,
  lastfm_username TEXT,
  discogs_username TEXT,
  spotify_connected INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- For single-user mode, we'll have one row with id = 'default'
INSERT INTO users (id, lastfm_username, discogs_username)
VALUES ('default', NULL, NULL);

-- Search history
CREATE TABLE searches (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT DEFAULT 'default' REFERENCES users(id),
  search_type TEXT NOT NULL, -- 'album', 'artist'
  query TEXT NOT NULL,
  result_id TEXT, -- Spotify ID if found
  result_name TEXT,
  result_artist TEXT,
  searched_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_searches_user_time ON searches(user_id, searched_at DESC);

-- Recent community searches (for home page)
CREATE TABLE recent_searches (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  spotify_id TEXT NOT NULL,
  album_name TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  image_url TEXT,
  searched_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_recent_searches_time ON recent_searches(searched_at DESC);

-- Discogs sync state (for pagination/enrichment tracking)
CREATE TABLE discogs_sync_state (
  id TEXT PRIMARY KEY DEFAULT 'default',
  user_id TEXT DEFAULT 'default' REFERENCES users(id),
  last_full_sync TEXT,
  last_enrichment_sync TEXT,
  current_page INTEGER DEFAULT 0,
  total_pages INTEGER DEFAULT 0,
  enrichment_cursor INTEGER DEFAULT 0,
  status TEXT DEFAULT 'idle', -- 'idle', 'syncing', 'enriching', 'error'
  error_message TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO discogs_sync_state (id) VALUES ('default');

-- Discogs collection (normalized)
CREATE TABLE discogs_releases (
  id INTEGER PRIMARY KEY, -- Discogs release ID
  user_id TEXT DEFAULT 'default' REFERENCES users(id),
  instance_id INTEGER,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  year INTEGER,
  original_year INTEGER, -- From master
  format TEXT,
  label TEXT,
  genres TEXT, -- JSON array
  styles TEXT, -- JSON array
  master_genres TEXT, -- JSON array (from master)
  master_styles TEXT, -- JSON array (from master)
  image_url TEXT,
  discogs_url TEXT,
  date_added TEXT,
  rating INTEGER,
  master_id INTEGER,
  master_enriched INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_discogs_user ON discogs_releases(user_id);
CREATE INDEX idx_discogs_added ON discogs_releases(user_id, date_added DESC);
CREATE INDEX idx_discogs_master ON discogs_releases(master_id) WHERE master_enriched = 0;

-- Rate limit tracking (shared across services)
CREATE TABLE rate_limits (
  service TEXT PRIMARY KEY, -- 'discogs', 'spotify', 'openai', 'perplexity'
  requests_remaining INTEGER,
  window_reset_at TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO rate_limits (service, requests_remaining) VALUES
  ('discogs', 60),
  ('spotify', 100),
  ('openai', 60),
  ('perplexity', 30);
```

---

## URL Strategy

### New URL Format

| Page          | Old URL                         | New URL                                  |
| ------------- | ------------------------------- | ---------------------------------------- |
| Album detail  | `/album/artist-name_album-name` | `/album/spotify:4LH4d3cOWNNsVw41Gqt2kv`  |
| Artist detail | `/artist/artist-name`           | `/artist/spotify:0k17h0D3J5VfsdmQ1iZtE9` |
| Genre         | `/genre/indie-rock`             | `/genre/indie-rock` (unchanged)          |

### Slug Generation (for display/SEO)

```typescript
// packages/shared/src/utils/slug.ts

export function generateDisplaySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '-') // Spaces to hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .trim();
}

// URLs use Spotify IDs as the source of truth
export function albumUrl(spotifyId: string): string {
  return `/album/spotify:${spotifyId}`;
}

export function artistUrl(spotifyId: string): string {
  return `/artist/spotify:${spotifyId}`;
}

// Parse ID from URL
export function parseSpotifyId(param: string): string | null {
  if (param.startsWith('spotify:')) {
    return param.slice(8);
  }
  return null;
}
```

---

## Discogs Sync State Machine

The new Discogs sync uses D1 to track state:

```typescript
// packages/services/discogs/src/sync.ts

type SyncStatus = 'idle' | 'syncing' | 'enriching' | 'error';

interface SyncState {
  status: SyncStatus;
  currentPage: number;
  totalPages: number;
  enrichmentCursor: number;
  lastFullSync: string | null;
  lastEnrichmentSync: string | null;
  errorMessage: string | null;
}

export class DiscogsSyncService {
  constructor(
    private db: D1Database,
    private kv: KVNamespace,
    private env: Env
  ) {}

  // CRON handler for collection sync
  async syncCollection(): Promise<void> {
    const state = await this.getState();

    if (state.status !== 'idle') {
      console.log(`Sync already in progress: ${state.status}`);
      return;
    }

    await this.setState({ status: 'syncing', currentPage: 1 });

    try {
      let page = state.currentPage || 1;

      while (true) {
        // Check rate limit before fetching
        await this.waitForRateLimit();

        const data = await this.fetchPage(page);

        // Save releases to D1 (upsert)
        await this.saveReleases(data.releases);

        // Checkpoint progress
        await this.setState({
          currentPage: page + 1,
          totalPages: data.pagination.pages,
        });

        if (page >= data.pagination.pages) break;
        page++;
      }

      await this.setState({
        status: 'idle',
        currentPage: 0,
        lastFullSync: new Date().toISOString(),
      });
    } catch (error) {
      await this.setState({
        status: 'error',
        errorMessage: error.message,
      });
      throw error;
    }
  }

  // CRON handler for enrichment
  async enrichMasterData(): Promise<void> {
    const state = await this.getState();

    if (state.status !== 'idle') {
      console.log(`Sync in progress: ${state.status}`);
      return;
    }

    await this.setState({ status: 'enriching' });

    try {
      // Get releases needing enrichment
      const releases = await this.db
        .prepare(
          `
          SELECT id, master_id FROM discogs_releases
          WHERE master_enriched = 0 AND master_id IS NOT NULL
          LIMIT 100
        `
        )
        .all();

      for (const release of releases.results) {
        await this.waitForRateLimit();

        const masterData = await this.fetchMaster(release.master_id);

        await this.db
          .prepare(
            `
            UPDATE discogs_releases
            SET original_year = ?, master_genres = ?, master_styles = ?,
                master_enriched = 1, updated_at = datetime('now')
            WHERE id = ?
          `
          )
          .bind(
            masterData.year,
            JSON.stringify(masterData.genres),
            JSON.stringify(masterData.styles),
            release.id
          )
          .run();
      }

      await this.setState({
        status: 'idle',
        lastEnrichmentSync: new Date().toISOString(),
      });
    } catch (error) {
      await this.setState({ status: 'error', errorMessage: error.message });
      throw error;
    }
  }

  private async waitForRateLimit(): Promise<void> {
    const limit = await this.db
      .prepare('SELECT * FROM rate_limits WHERE service = ?')
      .bind('discogs')
      .first();

    if (limit && limit.requests_remaining <= 0) {
      const resetAt = new Date(limit.window_reset_at).getTime();
      const waitMs = Math.max(0, resetAt - Date.now());
      if (waitMs > 0) {
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
    }
  }
}
```

---

## Implementation Phases

### Phase 1: Foundation (Sessions 1-3)

**Goal:** Empty monorepo that builds and deploys

**Tasks:**

- [ ] Create new repo `listentomore`
- [ ] Initialize Turborepo with TypeScript
- [ ] Set up workspace structure (`apps/`, `packages/`)
- [ ] Configure base `tsconfig.json`
- [ ] Set up `packages/shared` with basic types
- [ ] Set up `packages/config` with AI and cache config
- [ ] Create `apps/web` with minimal Hono app ("Hello World")
- [ ] Configure wrangler.toml for web app
- [ ] Deploy empty app to Cloudflare Workers
- [ ] Set up CI/CD (GitHub Actions)

**Verification:** `turbo run build` succeeds, app deploys to Workers

---

### Phase 2: Database & Core Services (Sessions 4-7)

**Goal:** D1 database and core service packages working

**Tasks:**

- [ ] Set up `packages/db` with D1 schema
- [ ] Create and run migrations
- [ ] Implement `packages/services/spotify`:
  - [ ] Token management (port from `api-spotify-getspotifytoken`)
  - [ ] Search (port from `api-spotify-search`)
  - [ ] Albums (port from `api-spotify-albums`)
  - [ ] Artists (port from `api-spotify-artists`)
- [ ] Implement `packages/services/lastfm`:
  - [ ] Recent tracks (port from `api-lastfm-recenttracks`)
  - [ ] Top albums/artists (port from `api-lastfm-topalbums`, `api-lastfm-topartists`)
  - [ ] Artist detail (port from `api-lastfm-artistdetail`)
  - [ ] Loved tracks (port from `api-lastfm-lovedtracks`)
- [ ] Implement `packages/services/songlink`:
  - [ ] Link aggregation (port from `api-songlink`)
- [ ] Write tests for each service

**Verification:** Services can be imported and called from `apps/web`

---

### Phase 3: AI Service (Sessions 8-10)

**Goal:** Centralized AI with all prompts

**Tasks:**

- [ ] Implement `packages/services/ai`:
  - [ ] OpenAI client with rate limiting
  - [ ] Perplexity client with rate limiting
  - [ ] Cache layer (KV-backed)
- [ ] Port all prompts to `packages/services/ai/src/prompts/`:
  - [ ] `artist-summary.ts` (from `api-openai-artistdetail`)
  - [ ] `album-detail.ts` (from `api-perplexity-albumdetail`)
  - [ ] `genre-summary.ts` (from `api-perplexity-genresummary`)
  - [ ] `artist-sentence.ts` (from `api-perplexity-artistsentence`)
  - [ ] `random-fact.ts` (from `api-openai-randomfact`)
  - [ ] `playlist-cover.ts` (from `api-openai-playlist-prompt`)
  - [ ] `listen-ai.ts` (Rick Rubin personality from `listen-ai`)
- [ ] Image generation support (DALL-E)
- [ ] Write tests

**Verification:** Can generate artist summary, album detail from `apps/web`

---

### Phase 4: Discogs Service (Sessions 11-14)

**Goal:** Robust Discogs sync with state machine

**Tasks:**

- [ ] Implement `packages/services/discogs`:
  - [ ] Rate limiter (D1-backed, shared)
  - [ ] Collection sync with pagination checkpointing
  - [ ] Master data enrichment with cursor tracking
  - [ ] Collection queries
- [ ] Set up CRON triggers in wrangler.toml
- [ ] Test failure recovery scenarios
- [ ] Write tests

**Verification:** Full collection syncs without data loss on interruption

---

### Phase 5: Web App - Core Pages (Sessions 15-20)

**Goal:** Main pages working with new URL system

**Tasks:**

- [ ] Set up Hono JSX rendering
- [ ] Create layout component (nav, theme toggle)
- [ ] Port CSS/styling (modernize as we go)
- [ ] Implement pages:
  - [ ] Home page (recent searches, random fact)
  - [ ] Album search page
  - [ ] Album detail page (new ID-based URL)
  - [ ] Artist search page
  - [ ] Artist detail page (new ID-based URL)
  - [ ] Genre page
- [ ] Implement UI components:
  - [ ] Button
  - [ ] Input
  - [ ] LoadingSpinner
  - [ ] FilterDropdown
- [ ] Wire up to services

**Verification:** Can search for album, view detail page with AI summary

---

### Phase 6: Web App - Stats & Collection (Sessions 21-25)

**Goal:** Personal stats and collection pages

**Tasks:**

- [ ] My Stats page:
  - [ ] Recent tracks
  - [ ] Top artists (7 days)
  - [ ] Top albums (30 days)
  - [ ] Recent Discogs additions
- [ ] Collection pages:
  - [ ] Collection stats (charts)
  - [ ] Full collection view with filters
- [ ] Library page:
  - [ ] Implement `packages/services/library` (Airtable integration)
  - [ ] Library view with filters
- [ ] Recommendations page:
  - [ ] Loved tracks display
  - [ ] Artist sentences

**Verification:** Full feature parity with current stats/collection pages

---

### Phase 7: Additional Features (Sessions 26-28)

**Goal:** Remaining features

**Tasks:**

- [ ] Playlist cover generator page
- [ ] About page
- [ ] Privacy/Terms pages
- [ ] 404 page
- [ ] Error boundaries

**Verification:** All pages from current site working (minus guessme/admin)

---

### Phase 8: Discord Bot (Sessions 29-31)

**Goal:** Discord bot in monorepo

**Tasks:**

- [ ] Set up `apps/discord-bot`
- [ ] Port command handlers:
  - [ ] `/listento` - Album lookup
  - [ ] `/listenlast` - Recent track
  - [ ] `/whois` - Artist info
  - [ ] `/ask` - Rick Rubin AI
- [ ] Configure service bindings to main web app
- [ ] Deploy as separate worker

**Verification:** Bot responds to all commands using new services

---

### Phase 9: Testing & Polish (Sessions 32-35)

**Goal:** Production ready

**Tasks:**

- [ ] Write integration tests for critical paths
- [ ] Performance testing
- [ ] Error handling audit
- [ ] Logging/observability setup
- [ ] Documentation (README)
- [ ] Environment setup documentation

**Verification:** Confident in production deployment

---

### Phase 10: Migration & Launch (Sessions 36-38)

**Goal:** Live on listentomore.com

**Tasks:**

- [ ] Deploy to staging domain (new.listentomore.com)
- [ ] Manual testing of all features
- [ ] Set up secrets via `wrangler secret put`
- [ ] DNS cutover
- [ ] Monitor for issues
- [ ] Deprecate old repos (archive)

**Verification:** listentomore.com running on new system

---

## Session Checklist

Start each coding session with:

1. **Pull latest:** `git pull`
2. **Install deps:** `npm install` (from root)
3. **Check current phase:** Review this document
4. **Pick a task:** Choose unchecked item from current phase
5. **Run tests:** `turbo run test` (when applicable)
6. **Build:** `turbo run build`
7. **Commit:** Clear commit message describing what was done

---

## Environment Variables

Create `.env` in each app directory (gitignored):

```bash
# apps/web/.env
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

For production, use `wrangler secret put KEY_NAME` for each.

---

## Worker Migration Reference

### Workers TO MIGRATE (for ListenToMore)

**Spotify (4 workers → 1 service)**
| Current Worker | New Location | Notes |
|----------------|--------------|-------|
| api-spotify-search | `packages/services/spotify/src/search.ts` | Core search functionality |
| api-spotify-albums | `packages/services/spotify/src/albums.ts` | Album detail lookup |
| api-spotify-artists | `packages/services/spotify/src/artists.ts` | Artist detail + genres |
| api-spotify-getspotifytoken | `packages/services/spotify/src/auth.ts` | OAuth token refresh |

**Last.fm (9 workers → 1 service)**
| Current Worker | New Location | Notes |
|----------------|--------------|-------|
| api-lastfm-recenttracks | `packages/services/lastfm/src/recent-tracks.ts` | My Stats page |
| api-lastfm-topalbums | `packages/services/lastfm/src/top-albums.ts` | My Stats page |
| api-lastfm-topartists | `packages/services/lastfm/src/top-artists.ts` | My Stats page |
| api-lastfm-artistdetail | `packages/services/lastfm/src/artist-detail.ts` | Artist pages |
| api-lastfm-artisttopalbums | `packages/services/lastfm/src/artist-top-albums.ts` | Artist pages |
| api-lastfm-lovedtracks | `packages/services/lastfm/src/loved-tracks.ts` | Recommendations page |
| api-lastfm-recenttracks-user | `packages/services/lastfm/src/recent-tracks.ts` | Discord bot (merge with above) |
| api-lastfm-albumdetail | `packages/services/lastfm/src/album-detail.ts` | Album pages |
| api-lastfm-weeklytrackchart | `packages/services/lastfm/src/weekly-chart.ts` | Stats (if used) |

**Discogs (3 workers → 1 service)**
| Current Worker | New Location | Notes |
|----------------|--------------|-------|
| api-discogs-all | `packages/services/discogs/src/sync.ts` | Collection sync |
| api-discogs-collection | `packages/services/discogs/src/collection.ts` | Latest additions |
| api-discogs-getmaster | `packages/services/discogs/src/enrichment.ts` | Master data enrichment |

**AI (7 workers → 1 service)**
| Current Worker | New Location | Notes |
|----------------|--------------|-------|
| api-openai-artistdetail | `packages/services/ai/src/prompts/artist-summary.ts` | Artist pages |
| api-openai-randomfact | `packages/services/ai/src/prompts/random-fact.ts` | Home page |
| api-openai-playlist-prompt | `packages/services/ai/src/prompts/playlist-cover.ts` | Playlist generator |
| api-openai-images | `packages/services/ai/src/openai.ts` | DALL-E image generation |
| api-perplexity-albumdetail | `packages/services/ai/src/prompts/album-detail.ts` | Album pages |
| api-perplexity-artistsentence | `packages/services/ai/src/prompts/artist-sentence.ts` | Short artist bios |
| api-perplexity-genresummary | `packages/services/ai/src/prompts/genre-summary.ts` | Genre pages |
| listen-ai | `packages/services/ai/src/prompts/listen-ai.ts` | Rick Rubin chatbot |

**Other (2 workers → 2 services)**
| Current Worker | New Location | Notes |
|----------------|--------------|-------|
| api-songlink | `packages/services/songlink/src/index.ts` | Streaming links |
| api-library | `packages/services/library/src/index.ts` | Airtable digital library |

**Discord Bot (1 worker → 1 app)**
| Current Worker | New Location | Notes |
|----------------|--------------|-------|
| discord-listen-bot | `apps/discord-bot/` | Separate deployable app |

**KV Fetch Workers (8 workers → replaced)**
| Current Worker | New Location | Notes |
|----------------|--------------|-------|
| kv-fetch-discogs-all | D1 queries in discogs service | No longer needed |
| kv-fetch-discogs-collection | D1 queries in discogs service | No longer needed |
| kv-fetch-last-track | Inline in lastfm service | No longer needed |
| kv-fetch-lastfm-stats | D1 queries in lastfm service | No longer needed |
| kv-fetch-random-fact | KV cache in AI service | No longer needed |
| kv-fetch-recentsearches | D1 queries | No longer needed |
| kv-fetch-top-albums | D1 queries in lastfm service | No longer needed |
| kv-fetch-top-artists | D1 queries in lastfm service | No longer needed |

---

### Workers NOT TO MIGRATE (separate projects or deprecated)

**Separate Projects (not part of ListenToMore)**
| Worker | Reason | Action |
|--------|--------|--------|
| bluesky-random-fact | Bluesky automation, not part of website | Keep in cloudflare-workers repo or own repo |
| discogs-mcp-server | MCP server for AI tools | Keep in cloudflare-workers repo or own repo |

**Being Removed (per requirements)**
| Worker | Reason | Action |
|--------|--------|--------|
| personality-api | Powers admin panel for AI personalities | Delete (admin panel removed) |

**Already Archived**
| Worker | Notes |
|--------|-------|
| api-openai-albumdetail | Replaced by perplexity version |
| api-openai-albumrecs | Unused |
| api-openai-artistsentence | Replaced by perplexity version |
| api-openai-genresummary | Replaced by perplexity version |
| api-openai-personalities | Old personality system |
| api-openai-songrec | Unused |
| api-perplexity-albumdetail-fu | Experimental |
| api-perplexity-albumrecs | Unused |
| api-perplexity-songrec | Unused |

---

### Migration Summary

| Category  | Current Workers | New Services/Apps      |
| --------- | --------------- | ---------------------- |
| Spotify   | 4               | 1 service              |
| Last.fm   | 9               | 1 service              |
| Discogs   | 3               | 1 service              |
| AI        | 7               | 1 service              |
| Songlink  | 1               | 1 service              |
| Library   | 1               | 1 service              |
| Discord   | 1               | 1 app                  |
| KV Fetch  | 8               | 0 (replaced by D1)     |
| **Total** | **34**          | **6 services + 1 app** |

**What happens to old repos after migration:**

- `my-music-next` → Archive (read-only), keep for reference
- `cloudflare-workers` → Archive (read-only), keep for reference
- `bluesky-random-fact` and `discogs-mcp-server` stay active in cloudflare-workers (not part of listentomore)

Nothing gets deleted. The old code remains available for reference.

---

## Features NOT Being Ported

- `guessme` - Music guessing game (removed)
- `admin` - Admin panel (removed)
- `bluesky-random-fact` - Can be added later as separate app

---

## Questions to Resolve During Implementation

1. **Hono static assets:** How to serve CSS/images? (Workers Assets or KV)
2. **JSX hydration:** Do we need client-side JS, or is server-only sufficient?
3. **Charts:** Port Recharts or find lighter alternative for server rendering?
4. **Theme toggle:** Server-side cookie vs client-side localStorage?

These will be answered as we encounter them in implementation.
