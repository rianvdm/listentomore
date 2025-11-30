# ListenToMore v2 - Implementation Plan

> **For LLMs:** This is a rewrite of a music discovery website. The old app (my-music-next) used Next.js + 34 separate Cloudflare Workers. The new app consolidates everything into a single Hono-based Cloudflare Worker with shared service packages. Key points:
> - **Current phase:** Phase 3 complete (AI service). Next: Phase 4 (Discogs service).
> - **Architecture:** Server-side rendering. Pages call services directly (no API keys needed). External `/api/*` endpoints require API key auth.
> - **Don't:** Create new workers, use client-side data fetching for pages, or expose API keys to browser.
> - **Do:** Add page routes to `apps/web/src/index.tsx`, use `c.get('serviceName')` for data, return HTML with `c.html()`.

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

## Storage Strategy: KV vs D1

Cloudflare offers two storage options. Use the right one for each use case:

### KV (Key-Value Store) - Use for Caching

KV is optimized for **read-heavy, low-latency lookups** by key. Use it for:

| Data Type | Key Pattern | TTL | Notes |
|-----------|-------------|-----|-------|
| AI responses | `ai:{task}:{hash}` | 90-180 days | Expensive to regenerate |
| Spotify tokens | `spotify:token` | 55 min | Refresh before expiry |
| Spotify API cache | `spotify:{endpoint}:{id}` | 30 days | Album/artist data rarely changes |
| Last.fm API cache | `lastfm:{endpoint}:{params}` | 5 min - 7 days | Varies by endpoint volatility |
| Songlink cache | `songlink:{spotifyId}` | 30 days | Links rarely change |
| Rate limits | `ratelimit:{service}` | 1 min | Atomic counters, auto-expire |

**Why KV for rate limits:** KV supports atomic increment operations and automatic TTL expiry. No need to manually clean up expired windows. Simpler than D1 for this use case.

### D1 (SQLite Database) - Use for Queryable Data

D1 is a **relational database**. Use it for data that needs filtering, sorting, or relationships:

| Table | Why D1 |
|-------|--------|
| `users` | Need to query by email, join with other tables |
| `searches` | Need to query by user, sort by time, aggregate stats |
| `recent_searches` | Need to sort by time, limit results |
| `discogs_releases` | Need complex filtering (by genre, year, artist), sorting, full-text search |
| `discogs_sync_state` | Transactional updates, need to track multiple fields atomically |

### Decision Flowchart

```
Is it a cache of external API data or AI output?
  → Yes → KV (with appropriate TTL)
  → No ↓

Do you need to query/filter/sort the data?
  → Yes → D1
  → No ↓

Is it a simple counter or flag?
  → Yes → KV (with atomic operations)
  → No → D1 (default to structured storage)
```

### Migration Note

The 8 "kv-fetch" workers in the old architecture were a workaround for slow API calls. In the new architecture:
- **Caching** happens in KV (same as before, but unified)
- **Querying** happens in D1 (new capability - we can now filter/sort server-side)

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
│   │   │   │   └── rate-limiter.ts   # KV-backed rate limiting
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
│   │   │   │   └── cache.ts          # KV-backed AI response caching
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
      defaultModel: 'gpt-5-mini',
    },
    perplexity: {
      baseUrl: 'https://api.perplexity.ai',
      defaultModel: 'sonar',
    },
  },

  tasks: {
    artistSummary: {
      provider: 'openai',
      model: 'gpt-5-mini',
      maxTokens: 10000,
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
      model: 'sonar',
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
      model: 'sonar',
      maxTokens: 1000,
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
      model: 'sonar',
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
      model: 'gpt-5-mini',
      maxTokens: 10000,
      temperature: 0.9,
      cacheTtlDays: 0, // No caching - always fresh
      systemPrompt: `You share interesting, lesser-known music facts. Be specific with dates,
names, and details. Facts should be surprising or counterintuitive.
Keep responses to 2-3 sentences.`,
      userPromptTemplate: () => `Share an interesting, lesser-known fact about music history.`,
    },

    playlistCoverPrompt: {
      provider: 'openai',
      model: 'gpt-5-nano',
      maxTokens: 10000,
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
      model: 'gpt-5-mini',
      maxTokens: 10000,
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
      model: 'gpt-image-1',
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
```

### KV Keys (for caching and rate limits)

```typescript
// Rate limiting - uses KV atomic counters with auto-expiry
// Key: `ratelimit:{service}:{window}`
// Value: request count
// TTL: 60 seconds (auto-expires each window)

// Example rate limit keys:
// ratelimit:discogs:1699123456 → 45 (45 requests in this minute window)
// ratelimit:spotify:1699123456 → 12

// Cache keys follow the pattern from Storage Strategy section above
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
    // Rate limiting uses KV with minute-window keys
    // Discogs allows 60 requests per minute
    const windowKey = `ratelimit:discogs:${Math.floor(Date.now() / 60000)}`;
    const count = await this.kv.get(windowKey);

    if (count && parseInt(count) >= 60) {
      // Wait for next minute window
      const msUntilNextWindow = 60000 - (Date.now() % 60000);
      await new Promise(resolve => setTimeout(resolve, msUntilNextWindow));
    }
  }

  private async incrementRateLimit(): Promise<void> {
    const windowKey = `ratelimit:discogs:${Math.floor(Date.now() / 60000)}`;
    const current = await this.kv.get(windowKey);
    const newCount = current ? parseInt(current) + 1 : 1;
    // TTL of 120 seconds ensures cleanup (2 windows)
    await this.kv.put(windowKey, newCount.toString(), { expirationTtl: 120 });
  }
}
```

---

## Implementation Phases

### Phase 1: Foundation (Sessions 1-3) ✅

**Goal:** Empty monorepo that builds and deploys

**Tasks:**

- [x] Create new repo `listentomore`
- [x] Initialize Turborepo with TypeScript
- [x] Set up workspace structure (`apps/`, `packages/`)
- [x] Configure base `tsconfig.json`
- [x] Set up `packages/shared` with basic types
- [x] Set up `packages/config` with AI and cache config
- [x] Create `apps/web` with minimal Hono app ("Hello World")
- [x] Configure wrangler.toml for web app
- [x] Deploy empty app to Cloudflare Workers
- [ ] Set up CI/CD (GitHub Actions)

**Verification:** `turbo run build` succeeds, app deploys to Workers ✅

**Deployed:** https://listentomore-web.rian-db8.workers.dev

---

### Phase 2: Database & Core Services (Sessions 4-7) ✅

**Goal:** D1 database and core service packages working

**Tasks:**

- [x] Set up `packages/db` with D1 schema
- [x] Create and run migrations
- [x] Implement `packages/services/spotify`:
  - [x] Token management (port from `api-spotify-getspotifytoken`)
  - [x] Search (port from `api-spotify-search`)
  - [x] Albums (port from `api-spotify-albums`)
  - [x] Artists (port from `api-spotify-artists`)
- [x] Implement `packages/services/lastfm`:
  - [x] Recent tracks (port from `api-lastfm-recenttracks`)
  - [x] Top albums/artists (port from `api-lastfm-topalbums`, `api-lastfm-topartists`)
  - [x] Artist detail (port from `api-lastfm-artistdetail`)
  - [x] Loved tracks (port from `api-lastfm-lovedtracks`)
- [x] Implement `packages/services/songlink`:
  - [x] Link aggregation (port from `api-songlink`)
- [ ] Write tests for each service

**Verification:** Services can be imported and called from `apps/web` ✅

**Infrastructure:**

- **D1 Database:** `listentomore` (512d0c41-502c-41ba-82ff-635d0413b071)
- **KV Namespace:** CACHE (a6011a8b5bac4be9a472ff86f8d5fd91)
- **KV Preview:** CACHE_preview (d6703c6a7283467eb7a452a6cb34fa87)

**Secrets configured via `wrangler secret put`:**

- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `SPOTIFY_REFRESH_TOKEN`
- `LASTFM_API_KEY`
- `LASTFM_USERNAME`
- `ADMIN_SECRET` - For API key creation (see API Security section)

**Local development:** Create `apps/web/.dev.vars` with the same keys for `wrangler dev`

**API Endpoints:**

- `/api/spotify/search?q=:query&type=:type` - Search tracks/albums/artists
- `/api/spotify/album/:id` - Album details
- `/api/spotify/artist/:id` - Artist details
- `/api/lastfm/recent` - Recent tracks
- `/api/lastfm/top-albums?period=:period` - Top albums
- `/api/lastfm/top-artists?period=:period` - Top artists
- `/api/lastfm/loved` - Loved tracks
- `/api/songlink?url=:streamingUrl` - Cross-platform streaming links
- `/api/auth/keys` - Create API keys (POST, requires admin secret)

---

## API Security

All `/api/*` endpoints require authentication via API key. This protects against abuse and allows rate limiting per user.

### How It Works

1. **API Keys** are stored in D1 (hashed with SHA-256)
2. **Tiers** determine rate limits:
   | Tier | Rate Limit | Use Case |
   |------|------------|----------|
   | `standard` | 60 req/min | Normal users |
   | `premium` | 300 req/min | High-volume users |
3. **Scopes** control access: `read`, `write`, `ai`

### Authentication Flow

```
Request with X-API-Key header
        ↓
authMiddleware() validates key against D1
        ↓
requireAuth() blocks if no valid key
        ↓
userRateLimitMiddleware() applies tier-based limits
        ↓
Route handler executes
```

### Frontend vs External API Access

**For website pages (server-side rendering):**
- Pages access services directly via `c.get('lastfm')`, `c.get('spotify')`, etc.
- No API key needed - data is fetched server-side
- User only receives rendered HTML
- API keys never exposed to browser

```typescript
// Example: Page route with server-side data fetching
app.get('/my-music', async (c) => {
  const lastfm = c.get('lastfm');  // Direct service access
  const tracks = await lastfm.recentTracks.getRecentTracks(10);
  return c.html(<MyMusicPage tracks={tracks} />);
});
```

**For external/programmatic access:**
- Must include `X-API-Key` header
- Subject to rate limits based on tier
- Used by: mobile apps, CLI tools, third-party integrations

```bash
curl -H "X-API-Key: ltm_..." https://listentomore-web.rian-db8.workers.dev/api/lastfm/recent
```

### Creating API Keys (Admin Only)

API keys can only be created by admins with the `ADMIN_SECRET`:

```bash
curl -X POST "https://listentomore-web.rian-db8.workers.dev/api/auth/keys" \
  -H "Content-Type: application/json" \
  -H "X-Admin-Secret: <your-admin-secret>" \
  -d '{"name": "My App", "tier": "standard", "scopes": ["read"]}'
```

Response includes the key (shown only once):
```json
{
  "key": "ltm_abc123...",
  "keyPrefix": "ltm_abc1",
  "tier": "standard",
  "warning": "Save this key - it will not be shown again!"
}
```

### Adding New Endpoints

**For new pages (recommended):**
```typescript
// Use services directly - secure, fast, simple
app.get('/artist/:id', async (c) => {
  const spotify = c.get('spotify');
  const artist = await spotify.getArtist(c.req.param('id'));
  return c.html(<ArtistPage artist={artist} />);
});
```

**For new API endpoints:**
```typescript
// Automatically protected by requireAuth() middleware on /api/*
app.get('/api/my-endpoint', async (c) => {
  const apiKey = c.get('apiKey');  // Access authenticated user info
  // ... handler logic
  return c.json({ data });
});

// For endpoints requiring specific scopes (e.g., AI endpoints):
app.post('/api/ai/analyze', requireAuth({ requiredScopes: ['ai'] }), async (c) => {
  // Only users with 'ai' scope can access
});
```

### Security Infrastructure

**Additional secrets configured:**
- `ADMIN_SECRET` - Required for API key creation

**Database tables added (002_api_keys.sql):**
- `api_keys` - Stores hashed keys, tiers, scopes, usage counts
- `api_usage_log` - Tracks all API requests for analytics

**Middleware stack for `/api/*`:**
1. `securityHeadersMiddleware()` - XSS, frame, content-type protection
2. `corsMiddleware()` - Restricts cross-origin requests
3. `originValidationMiddleware()` - Additional origin checks (production)
4. `authMiddleware()` - Validates API key
5. `requireAuth()` - Blocks unauthenticated requests
6. `userRateLimitMiddleware()` - Per-user rate limiting via KV
7. `apiLoggingMiddleware()` - Usage logging to D1

---

### Phase 3: AI Service (Sessions 8-10) ✅

**Goal:** Centralized AI with all prompts

**Tasks:**

- [x] Implement `packages/services/ai`:
  - [x] OpenAI client with rate limiting
  - [x] Perplexity client with rate limiting
  - [x] Cache layer (KV-backed)
- [x] Port all prompts to `packages/services/ai/src/prompts/`:
  - [x] `artist-summary.ts` (from `api-openai-artistdetail`)
  - [x] `album-detail.ts` (from `api-perplexity-albumdetail`)
  - [x] `genre-summary.ts` (from `api-perplexity-genresummary`)
  - [x] `artist-sentence.ts` (from `api-perplexity-artistsentence`)
  - [x] `random-fact.ts` (from `api-openai-randomfact`)
  - [x] `playlist-cover.ts` (from `api-openai-playlist-prompt`)
  - [x] `listen-ai.ts` (Rick Rubin personality from `listen-ai`)
- [x] Image generation support (DALL-E)
- [ ] Write tests

**Verification:** Can generate artist summary, album detail from `apps/web` ✅

**API Endpoints Added:**
- `/api/ai/artist-summary?name=:artistName` - Full artist summary (OpenAI)
- `/api/ai/album-detail?artist=:artistName&album=:albumName` - Album details with citations (Perplexity)
- `/api/ai/genre-summary?genre=:genreName` - Genre summary with citations (Perplexity)
- `/api/ai/artist-sentence?name=:artistName` - Short artist description (Perplexity)
- `/api/ai/random-fact` - Random music fact (OpenAI)
- `POST /api/ai/ask` - Rick Rubin AI chatbot (OpenAI)
- `POST /api/ai/playlist-cover/prompt` - Generate DALL-E prompt (OpenAI)
- `POST /api/ai/playlist-cover/image` - Generate cover image (DALL-E)

**Secrets needed for production:**
- `OPENAI_API_KEY` - OpenAI API key (configured via `wrangler secret put`)
- `PERPLEXITY_API_KEY` - Perplexity API key (configured via `wrangler secret put`)

**Package structure:**
```
packages/services/ai/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts          # AIService class + exports
    ├── openai.ts         # OpenAI client with rate limiting
    ├── perplexity.ts     # Perplexity client with rate limiting
    ├── cache.ts          # KV-backed cache layer
    └── prompts/
        ├── index.ts
        ├── artist-summary.ts    # [[artist]] and {{album}} link formatting
        ├── album-detail.ts      # With Perplexity citations
        ├── genre-summary.ts     # With Perplexity citations
        ├── artist-sentence.ts   # Short descriptions
        ├── random-fact.ts       # Random music facts
        ├── playlist-cover.ts    # DALL-E prompt + image generation
        └── listen-ai.ts         # Rick Rubin AI personality
```

**Important notes:**
- `gpt-5-mini` and `gpt-5-nano` only support `temperature=1` - config updated accordingly
- AI responses are cached in KV with configurable TTL per task type
- Artist summaries auto-convert `[[Artist Name]]` → markdown links to `/artist/artist-name`
- Artist summaries auto-convert `{{Album Name}}` → markdown links to `/album/artist-name_album-name`
- Perplexity responses include `citations` array with source URLs

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

## Performance Architecture

The new architecture is designed to be significantly faster than the old Next.js + 34 Workers setup.

### Why It's Faster

| Factor | Old (my-music-next) | New (listentomore) |
|--------|---------------------|-------------------|
| **Inter-service calls** | HTTP requests (50-100ms each) | Function calls (0ms) |
| **Cold starts** | Multiple workers could cold start | Single worker |
| **Server location** | Vercel (single region) | Cloudflare edge (300+ global locations) |
| **Data fetching** | Client-side JS fetches after page load | Server-rendered, data included in HTML |
| **Round trips** | Browser → Vercel → Workers → APIs | Browser → Edge → APIs |

### Example: Page Loading Recent Tracks + Top Albums

**Old architecture:**
```
Browser → Vercel (US) → api-lastfm-recenttracks.workers.dev → Last.fm API
                      → api-lastfm-topalbums.workers.dev → Last.fm API
       ← Render on client after both fetch

~400-600ms total (network latency + multiple cold starts possible)
```

**New architecture:**
```
Browser → Cloudflare Edge (nearest location)
       → lastfm.getRecentTracks() ← direct function call
       → lastfm.getTopAlbums()    ← direct function call
       ← Return complete HTML

~100-200ms total (single hop to edge, then to Last.fm)
```

### Performance Features Enabled

In `apps/web/wrangler.toml`:

```toml
[placement]
mode = "smart"  # Worker placed close to backend APIs (Last.fm, Spotify servers)

[observability]
enabled = true  # Performance monitoring in Cloudflare dashboard
```

### Best Practices for New Code

1. **Use server-side rendering** - Fetch data in route handlers, return complete HTML
2. **Avoid client-side fetches** - Don't make the browser call `/api/*` endpoints for page data
3. **Parallel fetches** - Use `Promise.all()` when fetching from multiple services:
   ```typescript
   const [tracks, albums] = await Promise.all([
     lastfm.getRecentTracks(10),
     lastfm.getTopAlbums('1month', 6)
   ]);
   ```
4. **Cache appropriately** - Services use KV caching to avoid repeated external API calls

---

## Questions to Resolve During Implementation

1. **Hono static assets:** How to serve CSS/images? (Workers Assets or KV)
2. **JSX hydration:** Do we need client-side JS, or is server-only sufficient?
3. **Charts:** Port Recharts or find lighter alternative for server rendering?
4. **Theme toggle:** Server-side cookie vs client-side localStorage?

These will be answered as we encounter them in implementation.
