# Discogs Collection Integration Plan

## Executive Summary

This document outlines the plan to port Discogs collection functionality from the standalone my-music-next Next.js app and brittle Cloudflare Workers setup into the listentomore platform. The new implementation will provide authenticated users with comprehensive collection statistics, search, and filtering capabilities while leveraging listentomore's existing authentication, caching, and API infrastructure.

**Key Improvements Over Previous Implementation:**
- OAuth-based Discogs authentication (vs. hardcoded credentials)
- Integrated with listentomore user system (privacy controls, per-user collections)
- Single unified Worker architecture (vs. 3 separate workers)
- Better rate limit management with exponential backoff
- Progressive data loading for better UX
- Leverages existing patterns and components from listentomore

---

## Table of Contents

1. [Previous Implementation Analysis](#previous-implementation-analysis)
2. [Proposed Architecture](#proposed-architecture)
3. [Data Model & Storage](#data-model--storage)
4. [Discogs OAuth Integration](#discogs-oauth-integration)
5. [Collection Sync Strategy](#collection-sync-strategy)
6. [API Design](#api-design)
7. [UI Components & Pages](#ui-components--pages)
8. [Migration Strategy](#migration-strategy)
9. [Rate Limiting & Caching](#rate-limiting--caching)
10. [Implementation Phases](#implementation-phases)
11. [Reusable Components](#reusable-components)
12. [Chart Library Decision](#chart-library-decision)

---

## Previous Implementation Analysis

### What Existed

The old implementation consisted of three separate Cloudflare Workers and a Next.js frontend:

#### **1. api-discogs-collection** (Latest 10 additions)
- **Purpose:** Fetch the 10 most recently added releases
- **Storage:** KV namespace `DISCOGS_COLLECTION`
- **Schedule:** Every 6 hours (cron: `0 */6 * * *`)
- **Issues:**
  - Only fetches 10 items (not useful for stats)
  - Hardcoded username and token
  - No user authentication

#### **2. api-discogs-all** (Full collection fetch)
- **Purpose:** Fetch all releases in collection, paginated
- **Storage:** KV namespace `DISCOGS_ALL`
- **Schedule:** Every 8 hours (cron: `0 */8 * * *`)
- **Features:**
  - Paginates through full collection (100 per page)
  - Preserves enriched data (master genres, original year) when updating
  - Returns stats: `lastUpdated`, release count
- **Issues:**
  - Hardcoded credentials
  - No per-user support
  - Runs automatically regardless of whether data changed

#### **3. api-discogs-getmaster** (Data enrichment)
- **Purpose:** Enrich releases with master release data (original year, genres, styles)
- **Schedule:** Triggered manually (scheduled event)
- **Features:**
  - Rate limit tracking (60 req/min authenticated)
  - Periodic saves every 200 releases
  - Enriches `original_year`, `master_genres`, `master_styles`
- **Issues:**
  - Very slow (hundreds of API calls)
  - Rate limiting is basic (429 handling only)
  - Runs as separate process, not integrated with collection fetch

#### **4. my-music-next Frontend** (Next.js)
- **Pages:**
  - `/collection` - Statistics dashboard with charts
  - `/collection/all` - Full collection list with filters and search
- **Features:**
  - Genre, format, decade, style filtering
  - Search across collection
  - Pagination (25 per page)
  - Sort by date added or artist name
  - Random selection feature
  - Charts: genre distribution, format distribution, top artists, releases by year
- **Data Source:** Fetches from `kv-fetch-discogs-all.rian-db8.workers.dev` (hardcoded)

### What Worked Well

1. **Chart visualizations** - Clean, informative stats with pie/bar charts
2. **Filtering system** - Multi-dimensional filtering (genre, format, decade, style)
3. **Search functionality** - Client-side search across collection
4. **Progressive enrichment** - Master release data fetched separately
5. **UI patterns** - Clean, responsive design with good UX

### What Was Brittle/Problematic

1. **Three separate workers** - Complex deployment, coordination issues
2. **Hardcoded credentials** - Single user only, no multi-tenant support
3. **No authentication** - Anyone with the URL could access
4. **Rate limiting gaps** - Basic 429 handling, no exponential backoff
5. **Enrichment complexity** - Separate worker, slow, manual trigger
6. **No incremental updates** - Full collection fetch every time
7. **No privacy controls** - All data public by default
8. **Tight coupling** - Frontend hardcoded to specific worker URL
9. **No error recovery** - Workers fail silently on errors
10. **Duplicate data fetching** - Collection worker and enrichment worker both fetch same data

---

## Proposed Architecture

### Design Principles

1. **Single Worker Architecture**: All Discogs functionality lives in the main listentomore web worker
2. **User-Scoped Collections**: Each user has their own Discogs collection tied to their account
3. **OAuth Authentication**: Users connect via Discogs OAuth (not hardcoded tokens)
4. **Progressive Loading**: Initial page load shows cached data, enrichment happens in background
5. **Privacy-First**: Users control who can see their collection (public/unlisted/private)
6. **Leverage Existing Patterns**: Reuse listentomore's auth, caching, rate limiting, and UI components

### System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                     listentomore Web Worker                     │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ User Pages (/u/:username/collection)                     │  │
│  │  - Collection stats (charts, summaries)                  │  │
│  │  - Full collection list (filtered, searchable)           │  │
│  └──────────────────────────────────────────────────────────┘  │
│                             ▲                                   │
│                             │                                   │
│  ┌──────────────────────────┴───────────────────────────────┐  │
│  │ API Routes                                                │  │
│  │  /api/internal/discogs-collection (fetch full)            │  │
│  │  /api/internal/discogs-stats (aggregate stats)            │  │
│  │  /api/internal/discogs-sync (trigger sync)                │  │
│  └──────────────────────────────────────────────────────────┘  │
│                             ▲                                   │
│                             │                                   │
│  ┌──────────────────────────┴───────────────────────────────┐  │
│  │ DiscogsService (packages/services/discogs)                │  │
│  │  - OAuth token management                                 │  │
│  │  - Collection fetching with pagination                    │  │
│  │  - Master release enrichment                              │  │
│  │  - Rate limit management (60 req/min)                     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                             ▲                                   │
│                             │                                   │
└─────────────────────────────┼───────────────────────────────────┘
                              │
              ┌───────────────┴────────────────┐
              │                                │
    ┌─────────▼─────────┐         ┌──────────▼──────────┐
    │   D1 Database     │         │   KV Cache (CACHE)  │
    │                   │         │                     │
    │ - oauth_tokens    │         │ Per-user collection │
    │   (Discogs OAuth) │         │ cache with TTL      │
    │                   │         │                     │
    │ - users           │         │ Key format:         │
    │   (discogs_       │         │ discogs:collection: │
    │    username)      │         │ {user_id}           │
    └───────────────────┘         └─────────────────────┘
```

### Key Differences from Old Implementation

| Aspect | Old | New |
|--------|-----|-----|
| **Architecture** | 3 separate Workers | Single Worker with service layer |
| **Authentication** | Hardcoded token | OAuth per user |
| **User Support** | Single user | Multi-user with privacy controls |
| **Data Storage** | Dedicated KV namespaces | D1 (metadata) + shared KV (cache) |
| **Enrichment** | Separate worker, manual | Background job, automatic |
| **Rate Limiting** | Basic 429 retry | Exponential backoff + queue |
| **Caching** | Worker-level | User-scoped with TTL |
| **Frontend** | Separate Next.js app | Integrated pages in main app |
| **Privacy** | Public by default | Respects user privacy settings |

---

## Data Model & Storage

### Database Schema (D1)

```sql
-- Already exists in USER_AUTHENTICATION_PLAN.md (Migration 007)
-- oauth_tokens table stores Discogs OAuth tokens

-- Add discogs_username to users table (if not exists)
ALTER TABLE users ADD COLUMN discogs_username TEXT;
CREATE INDEX IF NOT EXISTS idx_users_discogs ON users(discogs_username);
```

### Cache Storage (KV)

Discogs collection data is cached in the shared `CACHE` KV namespace with user-scoped keys:

```typescript
// Cache key format
const cacheKey = `discogs:collection:${userId}`;

// Cached data structure
interface DiscogsCollectionCache {
  userId: string;
  discogsUsername: string;
  lastSynced: string; // ISO timestamp
  releaseCount: number;
  releases: DiscogsRelease[];
  stats: {
    totalItems: number;
    uniqueGenres: string[];
    uniqueFormats: string[];
    uniqueStyles: string[];
    earliestYear: number;
    latestYear: number;
    lastAdded: string; // ISO timestamp of most recently added item
  };
}

interface DiscogsRelease {
  // Core Discogs data
  id: number;
  instance_id: number;
  date_added: string;
  rating: number;
  basic_information: {
    id: number;
    master_id: number;
    master_url: string;
    resource_url: string;
    thumb: string;
    cover_image: string;
    title: string;
    year: number;
    formats: Array<{
      name: string;
      qty: string;
      descriptions?: string[];
    }>;
    artists: Array<{
      name: string;
      id: number;
      resource_url: string;
    }>;
    labels: Array<{
      name: string;
      catno: string;
      entity_type: string;
      id: number;
      resource_url: string;
    }>;
    genres: string[];
    styles: string[];
  };

  // Enriched data from master release (populated progressively)
  original_year?: number;
  master_genres?: string[];
  master_styles?: string[];
  enriched_at?: string; // ISO timestamp of when enrichment completed
}
```

### Cache TTL Strategy

```typescript
// packages/config/src/cache.ts
export const CACHE_CONFIG = {
  discogs: {
    collection: {
      full: 6 * 60 * 60, // 6 hours (matches old worker schedule)
      stats: 6 * 60 * 60, // 6 hours
    },
    masterRelease: {
      data: 30 * 24 * 60 * 60, // 30 days (rarely changes)
    },
  },
};
```

---

## Discogs OAuth Integration

### Setting Up OAuth Credentials

Before implementing, you need to register an OAuth application with Discogs:

1. **Go to Discogs Developer Settings**
   - Visit: https://www.discogs.com/settings/developers
   - Log in with your Discogs account

2. **Create a New Application**
   - Click "Create an App" or similar button
   - Fill in the application details:
     - **Application Name:** `ListenToMore`
     - **Description:** `Music discovery platform that integrates with your Discogs collection`
     - **Callback URL:** `https://listentomore.com/auth/discogs/callback`
       - For local dev: `http://localhost:8787/auth/discogs/callback`

3. **Save Credentials**
   - You'll receive:
     - **Consumer Key** (public, but still treated as secret)
     - **Consumer Secret** (private)

4. **Add to Local Development** (`apps/web/.dev.vars`):
   ```bash
   # apps/web/.dev.vars
   DISCOGS_OAUTH_CONSUMER_KEY=your_consumer_key_here
   DISCOGS_OAUTH_CONSUMER_SECRET=your_consumer_secret_here
   OAUTH_ENCRYPTION_KEY=your_existing_encryption_key
   ```

5. **Add to Production** (via wrangler CLI):
   ```bash
   cd apps/web

   # Add consumer key
   npx wrangler secret put DISCOGS_OAUTH_CONSUMER_KEY
   # Paste your consumer key when prompted

   # Add consumer secret
   npx wrangler secret put DISCOGS_OAUTH_CONSUMER_SECRET
   # Paste your consumer secret when prompted

   # OAUTH_ENCRYPTION_KEY should already exist from Spotify OAuth
   ```

**Important:**
- Do NOT add credentials to `wrangler.toml` - use `.dev.vars` for local and `wrangler secret put` for production
- Both the consumer key and secret should be treated as secrets
- `.dev.vars` is gitignored by default
- You can keep using your existing personal token (`DISCOGS_API_TOKEN`) for initial local testing during development

### OAuth Flow

Discogs supports OAuth 1.0a for authentication. The flow:

1. **User initiates**: Click "Connect Discogs" in account settings
2. **Request token**: Get temporary request token from Discogs
3. **User authorization**: Redirect to Discogs authorization page
4. **Callback**: Discogs redirects back with verifier
5. **Access token**: Exchange verifier for access token + secret
6. **Store tokens**: Save encrypted tokens in `oauth_tokens` table

### Implementation

```typescript
// packages/services/discogs/oauth.ts
import OAuth from 'oauth-1.0a';
import crypto from 'crypto';

export class DiscogsOAuthService {
  private oauth: OAuth;
  private consumerKey: string;
  private consumerSecret: string;

  constructor(config: { consumerKey: string; consumerSecret: string }) {
    this.consumerKey = config.consumerKey;
    this.consumerSecret = config.consumerSecret;

    this.oauth = new OAuth({
      consumer: {
        key: this.consumerKey,
        secret: this.consumerSecret,
      },
      signature_method: 'HMAC-SHA1',
      hash_function(base_string, key) {
        return crypto.createHmac('sha1', key).update(base_string).digest('base64');
      },
    });
  }

  async getRequestToken(callbackUrl: string): Promise<{ token: string; secret: string }> {
    const requestData = {
      url: 'https://api.discogs.com/oauth/request_token',
      method: 'POST',
      data: { oauth_callback: callbackUrl },
    };

    const headers = this.oauth.toHeader(this.oauth.authorize(requestData));

    const response = await fetch(requestData.url, {
      method: requestData.method,
      headers: {
        ...headers,
        'User-Agent': 'ListenToMore/1.0',
      },
    });

    const body = await response.text();
    const params = new URLSearchParams(body);

    return {
      token: params.get('oauth_token')!,
      secret: params.get('oauth_token_secret')!,
    };
  }

  async getAccessToken(
    requestToken: string,
    requestSecret: string,
    verifier: string
  ): Promise<{ token: string; secret: string }> {
    const requestData = {
      url: 'https://api.discogs.com/oauth/access_token',
      method: 'POST',
      data: {
        oauth_token: requestToken,
        oauth_verifier: verifier,
      },
    };

    const headers = this.oauth.toHeader(
      this.oauth.authorize(requestData, { key: requestToken, secret: requestSecret })
    );

    const response = await fetch(requestData.url, {
      method: requestData.method,
      headers: {
        ...headers,
        'User-Agent': 'ListenToMore/1.0',
      },
    });

    const body = await response.text();
    const params = new URLSearchParams(body);

    return {
      token: params.get('oauth_token')!,
      secret: params.get('oauth_token_secret')!,
    };
  }

  getAuthorizationUrl(requestToken: string): string {
    return `https://www.discogs.com/oauth/authorize?oauth_token=${requestToken}`;
  }
}
```

### API Routes

```typescript
// apps/web/src/api/auth/discogs.ts
import { Hono } from 'hono';
import type { Bindings, Variables } from '../../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Step 1: Initiate OAuth flow
app.get('/connect', async (c) => {
  const currentUser = c.get('currentUser');
  if (!currentUser) {
    return c.redirect('/login?next=/account');
  }

  const oauthService = new DiscogsOAuthService({
    consumerKey: c.env.DISCOGS_OAUTH_CONSUMER_KEY,
    consumerSecret: c.env.DISCOGS_OAUTH_CONSUMER_SECRET,
  });

  const callbackUrl = `${new URL(c.req.url).origin}/auth/discogs/callback`;
  const { token, secret } = await oauthService.getRequestToken(callbackUrl);

  // Store request token temporarily (we'll need the secret for step 2)
  await c.env.CACHE.put(
    `discogs:oauth:request:${token}`,
    JSON.stringify({ secret, userId: currentUser.id }),
    { expirationTtl: 600 } // 10 minutes
  );

  const authUrl = oauthService.getAuthorizationUrl(token);
  return c.redirect(authUrl);
});

// Step 2: Handle callback from Discogs
app.get('/callback', async (c) => {
  const token = c.req.query('oauth_token');
  const verifier = c.req.query('oauth_verifier');
  const denied = c.req.query('denied');

  if (denied || !token || !verifier) {
    return c.redirect('/account?error=discogs_auth_cancelled');
  }

  // Retrieve request token secret
  const requestData = await c.env.CACHE.get(`discogs:oauth:request:${token}`, 'json') as {
    secret: string;
    userId: string;
  } | null;

  if (!requestData) {
    return c.redirect('/account?error=discogs_auth_expired');
  }

  const oauthService = new DiscogsOAuthService({
    consumerKey: c.env.DISCOGS_OAUTH_CONSUMER_KEY,
    consumerSecret: c.env.DISCOGS_OAUTH_CONSUMER_SECRET,
  });

  const { token: accessToken, secret: accessSecret } = await oauthService.getAccessToken(
    token,
    requestData.secret,
    verifier
  );

  // Fetch user's Discogs identity to get username
  const discogsService = new DiscogsService({
    accessToken,
    accessSecret,
    consumerKey: c.env.DISCOGS_OAUTH_CONSUMER_KEY,
    consumerSecret: c.env.DISCOGS_OAUTH_CONSUMER_SECRET,
  });

  const identity = await discogsService.getIdentity();

  // Store OAuth tokens in database (encrypted)
  const db = c.get('db');
  await db.storeOAuthToken({
    userId: requestData.userId,
    provider: 'discogs',
    accessToken: await encrypt(accessToken, c.env.OAUTH_ENCRYPTION_KEY),
    refreshToken: await encrypt(accessSecret, c.env.OAUTH_ENCRYPTION_KEY), // Using refresh_token field for secret
    providerUserId: identity.id.toString(),
    providerUsername: identity.username,
  });

  // Update user's discogs_username
  await db.updateUser(requestData.userId, {
    discogs_username: identity.username,
  });

  // Clean up temporary request token
  await c.env.CACHE.delete(`discogs:oauth:request:${token}`);

  return c.redirect('/account?success=discogs_connected');
});

// Disconnect Discogs
app.delete('/disconnect', async (c) => {
  const currentUser = c.get('currentUser');
  if (!currentUser) {
    return c.json({ error: 'Not authenticated' }, 401);
  }

  const db = c.get('db');
  await db.deleteOAuthToken(currentUser.id, 'discogs');
  await db.updateUser(currentUser.id, { discogs_username: null });

  // Clear cached collection
  await c.env.CACHE.delete(`discogs:collection:${currentUser.id}`);

  return c.json({ success: true });
});

export const discogsAuthRoutes = app;
```

### Environment Variables

Required environment variables (in addition to existing ones):

**Local Development** (`.dev.vars`):
```bash
# apps/web/.dev.vars (gitignored)
DISCOGS_OAUTH_CONSUMER_KEY=your_consumer_key
DISCOGS_OAUTH_CONSUMER_SECRET=your_consumer_secret
OAUTH_ENCRYPTION_KEY=your_existing_encryption_key
```

**Production** (via `wrangler secret put`):
```bash
cd apps/web

# Add both OAuth credentials as secrets
npx wrangler secret put DISCOGS_OAUTH_CONSUMER_KEY
npx wrangler secret put DISCOGS_OAUTH_CONSUMER_SECRET

# OAUTH_ENCRYPTION_KEY should already exist from Spotify OAuth
```

**Important:**
- ❌ **DO NOT** add credentials to `wrangler.toml`
- ✅ **DO** use `.dev.vars` for local development (gitignored)
- ✅ **DO** use `wrangler secret put` for production
- Both consumer key and secret are treated as secrets

---

## Collection Sync Strategy

### Sync Modes

**Core Principle: Pages always load from KV cache for instant performance. Syncs happen in the background.**

1. **Initial Sync** - When user first connects Discogs account
   - Triggered automatically after OAuth connection
   - Fetches full collection and stores in KV
   - Queues enrichment job
   - User sees "Collection is syncing..." until first sync completes

2. **Scheduled Background Sync** - Automatic sync every 6 hours for active users
   - Runs via scheduled worker (cron: `0 */6 * * *`)
   - Updates KV cache with any new/changed releases
   - Preserves existing enrichment data
   - Queues enrichment for new releases only
   - **User never waits** - always sees existing cached data

3. **Manual Refresh** - User clicks "Refresh Collection" button (optional)
   - Triggers immediate background sync (cooldown: 4 hours)
   - Returns immediately, sync runs in background via `waitUntil()`
   - User sees current cached data, page shows "Syncing..." status
   - Page auto-refreshes after 30 seconds to show updates

### Sync Algorithm

```typescript
// packages/services/discogs/sync.ts
export class DiscogsCollectionSync {
  private service: DiscogsService;
  private cache: KVNamespace;
  private userId: string;

  async syncCollection(options: { force?: boolean } = {}): Promise<SyncResult> {
    const cacheKey = `discogs:collection:${this.userId}`;
    const lockKey = `discogs:sync:lock:${this.userId}`;

    // Check if sync already in progress
    const existingLock = await this.cache.get(lockKey);
    if (existingLock && !options.force) {
      throw new Error('Sync already in progress');
    }

    // Set lock (5 min TTL)
    await this.cache.put(lockKey, Date.now().toString(), { expirationTtl: 300 });

    try {
      // Step 1: Fetch all releases from Discogs API
      const releases = await this.fetchAllReleases();

      // Step 2: Load existing cache to preserve enriched data
      const existingCache = await this.cache.get(cacheKey, 'json') as DiscogsCollectionCache | null;
      const existingReleasesMap = new Map(
        existingCache?.releases.map(r => [r.id, r]) || []
      );

      // Step 3: Merge new data with existing enriched data
      const mergedReleases = releases.map(release => {
        const existing = existingReleasesMap.get(release.id);
        return {
          ...release,
          // Preserve enrichment if it exists
          original_year: existing?.original_year || release.original_year,
          master_genres: existing?.master_genres || release.master_genres,
          master_styles: existing?.master_styles || release.master_styles,
          enriched_at: existing?.enriched_at,
        };
      });

      // Step 4: Calculate stats
      const stats = this.calculateStats(mergedReleases);

      // Step 5: Save to cache
      const cacheData: DiscogsCollectionCache = {
        userId: this.userId,
        discogsUsername: await this.service.getUsername(),
        lastSynced: new Date().toISOString(),
        releaseCount: mergedReleases.length,
        releases: mergedReleases,
        stats,
      };

      await this.cache.put(cacheKey, JSON.stringify(cacheData), {
        expirationTtl: getTtlSeconds(CACHE_CONFIG.discogs.collection.full),
      });

      // Step 6: Queue enrichment job for releases missing data
      await this.queueEnrichment(mergedReleases);

      return {
        success: true,
        releaseCount: mergedReleases.length,
        newReleases: mergedReleases.length - (existingCache?.releaseCount || 0),
        enrichmentQueued: mergedReleases.filter(r => !r.enriched_at).length,
      };

    } finally {
      // Release lock
      await this.cache.delete(lockKey);
    }
  }

  private async fetchAllReleases(): Promise<DiscogsRelease[]> {
    const allReleases: DiscogsRelease[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await this.service.getCollectionPage(page, 100);
      allReleases.push(...response.releases);

      if (response.pagination.pages === page) {
        hasMore = false;
      } else {
        page++;
        // Rate limit: 60 req/min authenticated = 1 per second
        await sleep(1000);
      }
    }

    return allReleases;
  }

  private calculateStats(releases: DiscogsRelease[]) {
    const genres = new Set<string>();
    const formats = new Set<string>();
    const styles = new Set<string>();
    const years: number[] = [];

    releases.forEach(release => {
      // Genres
      const releaseGenres = release.master_genres || release.basic_information.genres;
      releaseGenres?.forEach(g => genres.add(g));

      // Formats
      release.basic_information.formats?.forEach(f => formats.add(f.name));

      // Styles
      const releaseStyles = release.master_styles || release.basic_information.styles;
      releaseStyles?.forEach(s => styles.add(s));

      // Years
      const year = release.original_year || release.basic_information.year;
      if (year) years.push(year);
    });

    return {
      totalItems: releases.length,
      uniqueGenres: Array.from(genres).sort(),
      uniqueFormats: Array.from(formats).sort(),
      uniqueStyles: Array.from(styles).sort(),
      earliestYear: Math.min(...years),
      latestYear: Math.max(...years),
      lastAdded: releases[0]?.date_added || new Date().toISOString(),
    };
  }

  private async queueEnrichment(releases: DiscogsRelease[]) {
    // Find releases that need enrichment
    const needsEnrichment = releases.filter(r =>
      !r.enriched_at && r.basic_information.master_id
    );

    if (needsEnrichment.length === 0) return;

    // Store enrichment queue in KV
    const queueKey = `discogs:enrich:queue:${this.userId}`;
    await this.cache.put(
      queueKey,
      JSON.stringify({
        userId: this.userId,
        releases: needsEnrichment.map(r => ({
          releaseId: r.id,
          masterId: r.basic_information.master_id,
        })),
        createdAt: new Date().toISOString(),
      }),
      { expirationTtl: 86400 } // 24 hours
    );

    // Trigger background enrichment (via Durable Object or cron)
    // This will process the queue gradually to avoid rate limits
  }
}
```

### Background Enrichment

```typescript
// packages/services/discogs/enrichment.ts
export class DiscogsEnrichmentService {
  private service: DiscogsService;
  private cache: KVNamespace;
  private userId: string;

  async processEnrichmentQueue(): Promise<EnrichmentResult> {
    const queueKey = `discogs:enrich:queue:${this.userId}`;
    const queue = await this.cache.get(queueKey, 'json') as EnrichmentQueue | null;

    if (!queue || queue.releases.length === 0) {
      return { processed: 0, remaining: 0 };
    }

    const batchSize = 50; // Process 50 at a time to respect rate limits
    const batch = queue.releases.slice(0, batchSize);
    const remaining = queue.releases.slice(batchSize);

    let enrichedCount = 0;

    for (const item of batch) {
      try {
        const masterData = await this.service.getMasterRelease(item.masterId);

        // Update the release in cache
        await this.updateReleaseEnrichment(item.releaseId, {
          original_year: masterData.year,
          master_genres: masterData.genres,
          master_styles: masterData.styles,
          enriched_at: new Date().toISOString(),
        });

        enrichedCount++;

        // Rate limit: 60 req/min = 1 per second
        await sleep(1000);

      } catch (error) {
        console.error(`Failed to enrich release ${item.releaseId}:`, error);
        // Continue with next item
      }
    }

    // Update queue
    if (remaining.length > 0) {
      await this.cache.put(
        queueKey,
        JSON.stringify({ ...queue, releases: remaining }),
        { expirationTtl: 86400 }
      );
    } else {
      await this.cache.delete(queueKey);
    }

    return { processed: enrichedCount, remaining: remaining.length };
  }

  private async updateReleaseEnrichment(
    releaseId: number,
    enrichment: Partial<DiscogsRelease>
  ) {
    const cacheKey = `discogs:collection:${this.userId}`;
    const cache = await this.cache.get(cacheKey, 'json') as DiscogsCollectionCache;

    if (!cache) return;

    const releaseIndex = cache.releases.findIndex(r => r.id === releaseId);
    if (releaseIndex === -1) return;

    cache.releases[releaseIndex] = {
      ...cache.releases[releaseIndex],
      ...enrichment,
    };

    await this.cache.put(cacheKey, JSON.stringify(cache), {
      expirationTtl: getTtlSeconds(CACHE_CONFIG.discogs.collection.full),
    });
  }
}
```

### Scheduled Background Sync

```typescript
// apps/web/src/index.tsx (add to scheduled handler)
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // Run every 6 hours
    if (event.cron === '0 */6 * * *') {
      ctx.waitUntil(syncActiveUsersCollections(env));
    }
  },
};

async function syncActiveUsersCollections(env: Env) {
  const db = new Database(env.DB);

  // Get users who have Discogs connected and were active in last 7 days
  const activeUsers = await db.query(`
    SELECT u.id, u.discogs_username
    FROM users u
    INNER JOIN oauth_tokens ot ON u.id = ot.user_id
    WHERE ot.provider = 'discogs'
      AND u.last_login_at > datetime('now', '-7 days')
  `);

  for (const user of activeUsers.results) {
    try {
      // Get OAuth tokens
      const tokens = await db.getOAuthToken(user.id, 'discogs');
      if (!tokens) continue;

      const accessToken = await decrypt(tokens.access_token_encrypted, env.OAUTH_ENCRYPTION_KEY);
      const accessSecret = await decrypt(tokens.refresh_token_encrypted!, env.OAUTH_ENCRYPTION_KEY);

      const service = new DiscogsService({
        accessToken,
        accessSecret,
        consumerKey: env.DISCOGS_OAUTH_CONSUMER_KEY,
        consumerSecret: env.DISCOGS_OAUTH_CONSUMER_SECRET,
        cache: env.CACHE,
      });

      const sync = new DiscogsCollectionSync(service, env.CACHE, user.id);
      await sync.syncCollection();

      console.log(`Synced Discogs collection for user ${user.id}`);

    } catch (error) {
      console.error(`Failed to sync Discogs for user ${user.id}:`, error);
      // Continue with next user
    }
  }
}
```

---

## API Design

### Internal API Routes

```typescript
// apps/web/src/api/internal/discogs.ts
import { Hono } from 'hono';
import type { Bindings, Variables } from '../../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Get user's full collection
app.get('/collection', async (c) => {
  const username = c.req.query('username');
  if (!username) {
    return c.json({ error: 'Username required' }, 400);
  }

  const db = c.get('db');
  const user = await db.getUserByUsername(username);

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  // Check privacy permissions
  const currentUser = c.get('currentUser');
  if (!await canViewCollection(user, currentUser)) {
    return c.json({ error: 'Collection is private' }, 403);
  }

  // Get cached collection
  const cacheKey = `discogs:collection:${user.id}`;
  const cached = await c.env.CACHE.get(cacheKey, 'json') as DiscogsCollectionCache | null;

  if (!cached) {
    return c.json({ error: 'Collection not synced yet' }, 404);
  }

  return c.json({ data: cached });
});

// Get collection statistics
app.get('/stats', async (c) => {
  const username = c.req.query('username');
  if (!username) {
    return c.json({ error: 'Username required' }, 400);
  }

  const db = c.get('db');
  const user = await db.getUserByUsername(username);

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  const currentUser = c.get('currentUser');
  if (!await canViewCollection(user, currentUser)) {
    return c.json({ error: 'Collection is private' }, 403);
  }

  const cacheKey = `discogs:collection:${user.id}`;
  const cached = await c.env.CACHE.get(cacheKey, 'json') as DiscogsCollectionCache | null;

  if (!cached) {
    return c.json({ error: 'Collection not synced yet' }, 404);
  }

  return c.json({
    data: {
      lastSynced: cached.lastSynced,
      releaseCount: cached.releaseCount,
      stats: cached.stats,
    },
  });
});

// Trigger collection sync (auth required)
app.post('/sync', async (c) => {
  const currentUser = c.get('currentUser');
  if (!currentUser) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  // Check if user has Discogs connected
  const db = c.get('db');
  const tokens = await db.getOAuthToken(currentUser.id, 'discogs');

  if (!tokens) {
    return c.json({ error: 'Discogs not connected' }, 400);
  }

  // Check sync cooldown (prevent spam)
  const lastSyncKey = `discogs:last-sync:${currentUser.id}`;
  const lastSync = await c.env.CACHE.get(lastSyncKey);

  if (lastSync) {
    const lastSyncTime = parseInt(lastSync);
    const cooldown = 4 * 60 * 60 * 1000; // 4 hours
    if (Date.now() - lastSyncTime < cooldown) {
      const remainingMs = cooldown - (Date.now() - lastSyncTime);
      const remainingHours = Math.ceil(remainingMs / (60 * 60 * 1000));
      return c.json({
        error: `Please wait ${remainingHours} hour(s) before syncing again`,
      }, 429);
    }
  }

  // Decrypt tokens
  const accessToken = await decrypt(tokens.access_token_encrypted, c.env.OAUTH_ENCRYPTION_KEY);
  const accessSecret = await decrypt(tokens.refresh_token_encrypted!, c.env.OAUTH_ENCRYPTION_KEY);

  const service = new DiscogsService({
    accessToken,
    accessSecret,
    consumerKey: c.env.DISCOGS_OAUTH_CONSUMER_KEY,
    consumerSecret: c.env.DISCOGS_OAUTH_CONSUMER_SECRET,
    cache: c.env.CACHE,
  });

  const sync = new DiscogsCollectionSync(service, c.env.CACHE, currentUser.id);
  const result = await sync.syncCollection();

  // Set last sync timestamp
  await c.env.CACHE.put(lastSyncKey, Date.now().toString(), {
    expirationTtl: 86400, // 24 hours
  });

  return c.json({ data: result });
});

async function canViewCollection(targetUser: User, currentUser: User | null): Promise<boolean> {
  // Public collections are viewable by anyone
  if (targetUser.profile_visibility === 'public') {
    return true;
  }

  // Unlisted collections require direct link (always true here)
  if (targetUser.profile_visibility === 'unlisted') {
    return true;
  }

  // Private collections only viewable by owner
  if (targetUser.profile_visibility === 'private') {
    return currentUser?.id === targetUser.id;
  }

  return false;
}

export const discogsInternalRoutes = app;
```

---

## UI Components & Pages

### Page Structure

```
/u/:username/collection         # Collection stats dashboard
/u/:username/collection/all     # Full collection list (filtered)
```

### Collection Stats Page

Reuse components and patterns from the old `my-music-next/app/collection/page.js`:

```typescript
// apps/web/src/pages/user/collection/stats.tsx
import type { Context } from 'hono';
import { Layout } from '../../../components/layout';
import type { Database } from '@listentomore/db';

interface CollectionStatsPageProps {
  username: string;
  internalToken: string;
  isOwner: boolean;
}

export function CollectionStatsPage({
  username,
  internalToken,
  isOwner,
}: CollectionStatsPageProps) {
  return (
    <Layout
      title={`${username}'s Collection`}
      description={`${username}'s music collection statistics from Discogs`}
      url={`https://listentomore.com/u/${username}/collection`}
      internalToken={internalToken}
    >
      <header>
        <h1>{username}'s Physical Collection</h1>
        {isOwner && (
          <p class="text-center">
            <button id="sync-button" class="button-secondary">
              Refresh Collection
            </button>
          </p>
        )}
      </header>

      <main>
        <section id="collection-stats">
          {/* Loading state */}
          <div id="loading" class="loading-container">
            <span class="spinner">↻</span>
            <span class="loading-text">Loading collection...</span>
          </div>

          {/* Stats content (loaded via JS) */}
          <div id="stats-content" style="display: none;">
            <div id="summary"></div>
            <div id="filters"></div>
            <div id="genre-chart"></div>
            <div id="format-chart"></div>
            <div id="artists-chart"></div>
            <div id="year-chart"></div>
          </div>

          {/* Error state */}
          <div id="error" style="display: none;" class="text-center">
            <p class="text-muted">Unable to load collection data.</p>
          </div>
        </section>
      </main>

      {/* Progressive loading script */}
      <script dangerouslySetInnerHTML={{ __html: `
        (function() {
          var username = ${JSON.stringify(username)};
          var isOwner = ${JSON.stringify(isOwner)};

          // Fetch collection stats
          internalFetch('/api/internal/discogs-stats?username=' + encodeURIComponent(username))
            .then(function(r) { return r.json(); })
            .then(function(result) {
              if (result.error) {
                document.getElementById('loading').style.display = 'none';
                document.getElementById('error').style.display = 'block';
                document.getElementById('error').innerHTML = '<p>' + result.error + '</p>';
                return;
              }

              var stats = result.data.stats;
              var lastSynced = new Date(result.data.lastSynced);

              // Render summary
              var summaryHtml = '<div class="track_ul2">';
              summaryHtml += '<p><strong>' + stats.totalItems + ' items</strong> in collection</p>';
              summaryHtml += '<p class="text-muted">Last updated ' + lastSynced.toLocaleString() + '</p>';
              summaryHtml += '<p><a href="/u/' + username + '/collection/all" class="button">View Full Collection &rarr;</a></p>';
              summaryHtml += '</div>';
              document.getElementById('summary').innerHTML = summaryHtml;

              // Show content, hide loading
              document.getElementById('loading').style.display = 'none';
              document.getElementById('stats-content').style.display = 'block';

              // Load full collection data for charts
              return internalFetch('/api/internal/discogs-collection?username=' + encodeURIComponent(username));
            })
            .then(function(r) { return r ? r.json() : null; })
            .then(function(result) {
              if (!result || result.error) return;

              var releases = result.data.releases;

              // Render charts (reuse logic from my-music-next)
              renderGenreChart(releases);
              renderFormatChart(releases);
              renderArtistsChart(releases);
              renderYearChart(releases);
            })
            .catch(function(err) {
              console.error('Failed to load collection:', err);
              document.getElementById('loading').style.display = 'none';
              document.getElementById('error').style.display = 'block';
            });

          // Sync button handler
          if (isOwner) {
            document.getElementById('sync-button').addEventListener('click', function() {
              var btn = this;
              btn.disabled = true;
              btn.textContent = 'Syncing...';

              internalFetch('/api/internal/discogs-sync', { method: 'POST' })
                .then(function(r) { return r.json(); })
                .then(function(result) {
                  if (result.error) {
                    alert(result.error);
                  } else {
                    alert('Collection synced! Refreshing page...');
                    window.location.reload();
                  }
                })
                .catch(function(err) {
                  alert('Sync failed: ' + err.message);
                })
                .finally(function() {
                  btn.disabled = false;
                  btn.textContent = 'Refresh Collection';
                });
            });
          }

          // Chart rendering functions (adapted from my-music-next)
          function renderGenreChart(releases) {
            // ... genre distribution pie chart
          }

          function renderFormatChart(releases) {
            // ... format distribution pie chart
          }

          function renderArtistsChart(releases) {
            // ... top 10 artists bar chart
          }

          function renderYearChart(releases) {
            // ... releases by year line chart
          }
        })();
      ` }} />
    </Layout>
  );
}

export async function handleCollectionStats(c: Context) {
  const username = c.req.param('username');
  const db = c.get('db') as Database;
  const currentUser = c.get('currentUser');
  const internalToken = c.get('internalToken') as string;

  const user = await db.getUserByUsername(username);

  if (!user) {
    return c.html(<UserNotFound username={username} />, 404);
  }

  // Check if user has Discogs connected
  if (!user.discogs_username) {
    return c.html(<DiscogsNotConnected username={username} />, 404);
  }

  // Check privacy
  if (user.profile_visibility === 'private' && currentUser?.id !== user.id) {
    return c.html(<PrivateCollection username={username} />, 403);
  }

  return c.html(
    <CollectionStatsPage
      username={user.username}
      internalToken={internalToken}
      isOwner={currentUser?.id === user.id}
    />
  );
}
```

### Full Collection List Page

Reuse patterns from `my-music-next/app/collection/all/page.js`:

```typescript
// apps/web/src/pages/user/collection/list.tsx
export function CollectionListPage({
  username,
  internalToken,
  isOwner,
}: CollectionListPageProps) {
  return (
    <Layout
      title={`${username}'s Collection`}
      internalToken={internalToken}
    >
      <header>
        <h1>{username}'s Music Collection</h1>
      </header>

      <main>
        <section id="collection-list">
          {/* Loading state */}
          <div id="loading" class="loading-container">
            <span class="spinner">↻</span>
            <span class="loading-text">Loading collection...</span>
          </div>

          {/* Collection content */}
          <div id="list-content" style="display: none;">
            {/* Summary */}
            <div id="summary" class="track_ul2"></div>

            {/* Filters */}
            <div id="filters" class="track_ul2">
              <div style="display: flex; gap: 1.5rem; flex-wrap: wrap;">
                <div>
                  <label for="genre-filter">Genre</label>
                  <select id="genre-filter"></select>
                </div>
                <div>
                  <label for="format-filter">Format</label>
                  <select id="format-filter"></select>
                </div>
                <div>
                  <label for="decade-filter">Decade</label>
                  <select id="decade-filter"></select>
                </div>
                <div>
                  <label for="style-filter">Style</label>
                  <select id="style-filter"></select>
                </div>
                <div>
                  <label for="sort-select">Sort by</label>
                  <select id="sort-select">
                    <option value="dateAdded">Date Added</option>
                    <option value="artistName">Artist Name</option>
                  </select>
                </div>
              </div>

              {/* Search */}
              <div style="margin-top: 1rem;">
                <input
                  type="text"
                  id="search-input"
                  placeholder="Search collection..."
                  style="width: 100%; max-width: 400px;"
                />
              </div>

              {/* Action buttons */}
              <div style="margin-top: 1rem;">
                <button id="reset-btn" class="button-link">Reset filters</button>
                <button id="random-btn" class="button-link">Random selection</button>
              </div>
            </div>

            {/* Release list */}
            <div id="releases" class="track-list"></div>

            {/* Pagination */}
            <div id="pagination" class="track_ul2" style="text-align: center;"></div>
          </div>
        </section>
      </main>

      {/* Collection list script (adapted from my-music-next) */}
      <script dangerouslySetInnerHTML={{ __html: `
        // Full collection list implementation with filtering, search, pagination
        // (Reuse logic from my-music-next/app/collection/all/page.js)
      ` }} />
    </Layout>
  );
}
```

---

## Code Organization & Hygiene

### Service Architecture Pattern

Follow the **exact same pattern** as existing services (Spotify, Last.fm):

```
packages/services/discogs/
├── src/
│   ├── index.ts              # Main service class + exports
│   ├── types.ts              # All TypeScript interfaces
│   ├── oauth.ts              # OAuth 1.0a authentication
│   ├── collection.ts         # Collection fetching
│   ├── sync.ts               # Collection sync logic
│   ├── enrichment.ts         # Master release enrichment
│   └── rate-limiter.ts       # Rate limit management
├── package.json
└── tsconfig.json
```

**File Size Guidelines:**
- Keep individual files under **250 lines** (like Spotify: 138-216 lines per file)
- Main `index.ts` should be **~75-100 lines** (just exports + convenience class)
- Each file has **one primary responsibility**

**Service Class Pattern:**

```typescript
// packages/services/discogs/src/index.ts
import { DiscogsOAuth } from './oauth';
import { DiscogsCollection } from './collection';
import { DiscogsSync } from './sync';
import { DiscogsEnrichment } from './enrichment';

export { DiscogsOAuth } from './oauth';
export { DiscogsCollection } from './collection';
export { DiscogsSync } from './sync';
export { DiscogsEnrichment } from './enrichment';
export type * from './types';

// Main convenience class
export class DiscogsService {
  public readonly oauth: DiscogsOAuth;
  public readonly collection: DiscogsCollection;
  public readonly sync: DiscogsSync;
  public readonly enrichment: DiscogsEnrichment;

  constructor(config: DiscogsConfig) {
    this.oauth = new DiscogsOAuth(config);
    this.collection = new DiscogsCollection(config);
    this.sync = new DiscogsSync(config, this.collection);
    this.enrichment = new DiscogsEnrichment(config, this.collection);
  }

  // Convenience methods (delegate to sub-services)
  async getCollection(userId: string) {
    return this.collection.getCollection(userId);
  }

  async syncCollection(userId: string) {
    return this.sync.syncCollection(userId);
  }
}
```

### API Route Organization

Follow the **existing modular API pattern**:

```
apps/web/src/api/
├── internal/
│   ├── index.ts              # Mounts all internal routes (flat)
│   ├── discogs.ts            # NEW: /discogs-collection, /discogs-stats, /discogs-sync
│   └── ...existing files
└── auth/
    ├── discogs.ts            # NEW: OAuth routes
    └── ...existing files
```

**API File Pattern:**

```typescript
// apps/web/src/api/internal/discogs.ts
import { Hono } from 'hono';
import type { Bindings, Variables } from '../../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// GET /api/internal/discogs-collection
app.get('/discogs-collection', async (c) => { /* ... */ });

// GET /api/internal/discogs-stats
app.get('/discogs-stats', async (c) => { /* ... */ });

// POST /api/internal/discogs-sync
app.post('/discogs-sync', async (c) => { /* ... */ });

export const discogsInternalRoutes = app;
```

**Mount in `apps/web/src/api/internal/index.ts`:**

```typescript
import { discogsInternalRoutes } from './discogs';

// Mount with flat paths (routes already include full path)
app.route('/', discogsInternalRoutes);
```

### UI Component Organization

Follow the **existing component pattern**:

```
apps/web/src/
├── pages/
│   └── user/
│       └── collection/           # NEW
│           ├── stats.tsx         # Collection stats page
│           └── list.tsx          # Collection list page
└── components/
    └── ui/                       # Reuse existing components
        ├── FilterDropdown.tsx    # ✅ Already exists
        ├── Button.tsx            # ✅ Already exists
        ├── LoadingSpinner.tsx    # ✅ Already exists
        └── ...
```

**No new UI components needed** - reuse existing ones.

### What NOT to Add

**❌ Don't create:**
- New top-level directories in `apps/web/src/`
- New utility files (use existing `utils/` directory)
- New chart libraries (use existing or add to shared `components/ui/`)
- Separate worker files (everything in main worker)
- New middleware files (use existing auth patterns)

**✅ Do add:**
- One service package: `packages/services/discogs/`
- One internal API file: `apps/web/src/api/internal/discogs.ts`
- One auth API file: `apps/web/src/api/auth/discogs.ts`
- Two page files: `apps/web/src/pages/user/collection/*.tsx`

### Code Hygiene Checklist

Before any PR/commit:

- [ ] **No files over 250 lines** - split if needed
- [ ] **Service follows Spotify/Last.fm pattern** - modular classes
- [ ] **All exports in index.ts** - clean public API
- [ ] **Types in separate types.ts** - not inline
- [ ] **Each file has ABOUTME comment** - 2-line description
- [ ] **No duplicate logic** - DRY principle
- [ ] **Reuse existing UI components** - don't create new ones
- [ ] **Follow existing naming** - camelCase methods, PascalCase classes
- [ ] **Cache keys follow pattern** - `discogs:type:id`
- [ ] **Error handling consistent** - try/catch with logging

### Integration Points (Minimize Surface Area)

**Only 3 touch points in main app:**

1. **Service initialization** (`apps/web/src/index.tsx`):
   ```typescript
   // Add to middleware
   app.use('*', async (c, next) => {
     // ... existing services
     c.set('discogs', new DiscogsService({ /* config */ }));
     await next();
   });
   ```

2. **API routes** (`apps/web/src/api/index.ts`):
   ```typescript
   import { discogsInternalRoutes } from './internal/discogs';
   import { discogsAuthRoutes } from './auth/discogs';
   ```

3. **Page routes** (`apps/web/src/index.tsx`):
   ```typescript
   import { handleCollectionStats, handleCollectionList } from './pages/user/collection';
   app.get('/u/:username/collection', handleCollectionStats);
   app.get('/u/:username/collection/all', handleCollectionList);
   ```

That's it. **No sprawl, no clutter.**

### Database Changes (Minimal)

```sql
-- Only ONE new column (oauth_tokens table already exists)
ALTER TABLE users ADD COLUMN discogs_username TEXT;
CREATE INDEX IF NOT EXISTS idx_users_discogs ON users(discogs_username);
```

**No new tables.** Reuse existing `oauth_tokens` table.

### Dependencies (Minimal)

**Only ONE new dependency:**

```json
// packages/services/discogs/package.json
{
  "dependencies": {
    "oauth-1.0a": "^2.2.6"  // For OAuth 1.0a (Discogs requirement)
  }
}
```

Everything else reuses existing dependencies (hono, crypto, etc.).

### Summary: The "Lightweight" Rule

| Aspect | Count | Justification |
|--------|-------|---------------|
| New service packages | 1 | `packages/services/discogs` |
| New API files | 2 | `api/internal/discogs.ts`, `api/auth/discogs.ts` |
| New page files | 2 | `pages/user/collection/stats.tsx`, `list.tsx` |
| New UI components | 0 | Reuse existing |
| New database tables | 0 | Use existing `oauth_tokens` |
| New dependencies | 1 | `oauth-1.0a` |
| New middleware | 0 | Use existing auth |
| Lines of service code | ~800 | Similar to Spotify (746 lines) |
| Integration points | 3 | Service init, API mount, page routes |

**Total new files: ~7-8 files** across the entire codebase.

---

## Reusable Components

### From my-music-next

The following components can be directly reused or adapted:

1. **FilterDropdown** - Already exists in listentomore (`components/ui/FilterDropdown.tsx`)
2. **LazyImage** - For album artwork
3. **Button** - For action buttons
4. **LoadingSpinner** - For loading states
5. **ReleaseSummary** - Summary of filtered releases count

### New Components Needed

1. **Chart Components** - Pie chart, bar chart, line chart
   - Use Chart.js v4 (see [Chart Library Decision](#chart-library-decision) below)
   - Lazy load charts for performance

2. **CollectionEmptyState** - When user hasn't connected Discogs
3. **SyncStatus** - Show last sync time and sync button
4. **ReleaseCard** - Display individual release in list/grid

---

## Rate Limiting & Caching

### Discogs API Rate Limits

- **Authenticated**: 60 requests per minute
- **Unauthenticated**: 25 requests per minute

### Rate Limit Strategy

```typescript
// packages/services/discogs/rate-limiter.ts
export class DiscogsRateLimiter {
  private requestTimes: number[] = [];
  private readonly maxRequests = 60;
  private readonly windowMs = 60 * 1000;

  async waitForSlot(): Promise<void> {
    const now = Date.now();

    // Remove timestamps outside the window
    this.requestTimes = this.requestTimes.filter(
      time => now - time < this.windowMs
    );

    if (this.requestTimes.length >= this.maxRequests) {
      // Wait until oldest request falls outside window
      const oldestRequest = this.requestTimes[0];
      const waitTime = this.windowMs - (now - oldestRequest);

      if (waitTime > 0) {
        await sleep(waitTime + 100); // Add 100ms buffer
      }
    }

    this.requestTimes.push(Date.now());
  }
}
```

### Exponential Backoff

```typescript
async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;

      // 429 or 503 errors - exponential backoff
      if (error instanceof Response && [429, 503].includes(error.status)) {
        const delay = baseDelay * Math.pow(2, attempt);
        await sleep(delay);
      } else {
        throw error; // Don't retry other errors
      }
    }
  }

  throw new Error('Max retries exceeded');
}
```

### Cache Strategy

```typescript
// Master release data (rarely changes)
const masterCacheKey = `discogs:master:${masterId}`;
await cache.put(masterCacheKey, JSON.stringify(data), {
  expirationTtl: getTtlSeconds(CACHE_CONFIG.discogs.masterRelease.data), // 30 days
});

// Full collection (changes frequently)
const collectionCacheKey = `discogs:collection:${userId}`;
await cache.put(collectionCacheKey, JSON.stringify(data), {
  expirationTtl: getTtlSeconds(CACHE_CONFIG.discogs.collection.full), // 6 hours
});
```

---

## Migration Strategy

### Phase 1: Foundation (Weeks 1-2)

**Goal:** Set up basic infrastructure

**Prerequisites:**
- [x] Register OAuth app at https://www.discogs.com/settings/developers
- [x] Add OAuth credentials to `.dev.vars` (local)
- [ ] Add OAuth credentials via `wrangler secret put` (production)
- [x] Add `discogs_username` column to `users` table (already existed)

**Implementation:**
- [x] Create `DiscogsService` in `packages/services/discogs`
- [x] Implement OAuth 1.0a flow (request token → authorize → access token)
- [x] Add OAuth routes: `/auth/discogs/connect`, `/auth/discogs/callback`, `/auth/discogs/disconnect`
- [ ] Test OAuth flow with your personal account
- [x] Verify tokens stored securely in `oauth_tokens` table (migration 005 created)
- [x] Add "Connect Discogs" button to user stats page (`/u/:username`)

**Deliverables:**
- Users can connect Discogs account via OAuth
- Tokens stored securely and encrypted in database
- Your account successfully connected as first test user

### Phase 2: Collection Sync (Weeks 3-4)

**Goal:** Fetch and cache collection data

- [x] Implement `DiscogsCollectionSync` service (in `packages/services/discogs/src/collection.ts`)
- [x] Add API route: `POST /api/internal/discogs-sync`
- [x] Test full collection fetch (all pages) - **1,497 releases synced successfully**
- [x] Implement cache storage in KV
- [x] Add sync lock mechanism (4-hour cooldown)
- [x] Test with large collection (500+ releases) - **Tested with 1,497 releases**

**Deliverables:**
- [x] Users can trigger manual sync
- [x] Collection data cached in KV
- [x] Stats calculated and stored

### Phase 3: Background Enrichment (Week 5)

**Goal:** Enrich releases with master data

- [ ] Implement `DiscogsEnrichmentService`
- [ ] Create enrichment queue in KV
- [ ] Add rate limiter for master release fetches
- [ ] Test enrichment process
- [ ] Add scheduled job for processing queue

**Deliverables:**
- Releases progressively enriched with master data
- Original year, genres, styles populated

### Phase 4: Stats UI (Weeks 6-7)

**Goal:** Build collection stats dashboard

- [ ] Create `/u/:username/collection` route
- [ ] Build `CollectionStatsPage` component
- [ ] Add chart components (genre, format, artists, year)
- [ ] Implement privacy checks
- [ ] Add "Refresh Collection" button for owners
- [ ] Test with different collection sizes

**Deliverables:**
- Stats page showing charts and summaries
- Privacy controls working
- Sync button functional

### Phase 5: Full Collection List (Weeks 8-9)

**Goal:** Build searchable, filterable collection list

- [ ] Create `/u/:username/collection/all` route
- [ ] Build `CollectionListPage` component
- [ ] Implement client-side filtering (genre, format, decade, style)
- [ ] Add client-side search
- [ ] Implement pagination
- [ ] Add sort options (date added, artist name)
- [ ] Test performance with large collections

**Deliverables:**
- Full collection list page
- Filtering and search working
- Good performance even with 1000+ releases

### Phase 6: Background Sync (Week 10)

**Goal:** Automate collection updates

- [ ] Add scheduled job for background sync
- [ ] Implement "active user" detection
- [ ] Add sync cooldown (6 hours)
- [ ] Test scheduled sync
- [ ] Monitor sync performance and errors

**Deliverables:**
- Collections auto-sync every 6 hours for active users
- No manual intervention needed

### Phase 7: Polish & Testing (Week 11)

**Goal:** Final polish and comprehensive testing

- [ ] Add loading states and error handling
- [ ] Implement empty states (no Discogs connected, no releases)
- [ ] Add success/error notifications
- [ ] Cross-browser testing
- [ ] Mobile responsiveness
- [ ] Performance optimization
- [ ] Documentation

**Deliverables:**
- Production-ready feature
- Comprehensive documentation
- All edge cases handled

---

## Implementation Phases Summary

| Phase | Duration | Key Deliverables | Dependencies |
|-------|----------|------------------|--------------|
| 1. Foundation | 2 weeks | OAuth flow, token storage | User auth system |
| 2. Collection Sync | 2 weeks | Sync service, KV caching | Phase 1 |
| 3. Background Enrichment | 1 week | Enrichment queue, rate limiting | Phase 2 |
| 4. Stats UI | 2 weeks | Dashboard with charts | Phase 2, 3 |
| 5. Full Collection List | 2 weeks | Filterable list page | Phase 2, 3 |
| 6. Background Sync | 1 week | Scheduled auto-sync | Phase 2 |
| 7. Polish & Testing | 1 week | Production readiness | All phases |

**Total Timeline:** ~11 weeks

### Development Workflow

**All development happens in a feature branch for easy rollback:**

```bash
# Create feature branch from main
git checkout main
git pull
git checkout -b feature/discogs-collection

# Work on implementation...
git add .
git commit -m "Phase 1: Implement OAuth foundation"

# Push to remote regularly
git push -u origin feature/discogs-collection

# When ready to merge (after all phases complete)
git checkout main
git merge feature/discogs-collection
git push origin main

# If you need to rollback (before merge)
git checkout main  # Already clean, nothing merged yet

# If you need to rollback (after merge)
git revert <merge-commit-hash>
```

**Benefits of feature branch approach:**
- ✅ **Easy rollback** - Just delete the branch or don't merge
- ✅ **Safe experimentation** - Main branch stays stable
- ✅ **Incremental commits** - Can commit after each phase
- ✅ **Review before deploy** - Can review full diff before merging
- ✅ **Parallel work** - Can work on other features in separate branches
- ✅ **Testing isolation** - Deploy feature branch to preview environment

**Branch naming convention:**
```
feature/discogs-collection
```

**Commit message pattern:**
```
Phase 1: Implement OAuth foundation
Phase 2: Add collection sync service
Phase 3: Implement background enrichment
Phase 4: Build stats dashboard UI
Phase 5: Add collection list page
Phase 6: Add background sync automation
Phase 7: Polish and testing
```

**Deployment strategy:**
1. Develop in `feature/discogs-collection` branch
2. Test thoroughly in local environment
3. Optionally deploy branch to preview environment (if using wrangler environments)
4. Merge to `main` only when fully tested
5. Deploy `main` to production

**Preview environment (optional):**
```toml
# wrangler.toml
[env.preview]
name = "listentomore-preview"
# Use same config as production but different KV namespaces
```

```bash
# Deploy feature branch to preview
git checkout feature/discogs-collection
npx wrangler deploy --env preview
```

---

## Key Improvements Over Previous Implementation

### 1. Architecture

| Old | New | Benefit |
|-----|-----|---------|
| 3 separate Workers | Single Worker with services | Easier deployment, shared cache |
| Hardcoded credentials | OAuth per user | Multi-tenant, secure |
| Manual coordination | Automatic background jobs | Less maintenance |

### 2. User Experience

| Old | New | Benefit |
|-----|-----|---------|
| Public by default | Privacy controls | User choice |
| No user accounts | Integrated auth | Personalized experience |
| Hardcoded username in URL | Username from user profile | Clean URLs |
| No sync UI | Sync button + status | Transparency |

### 3. Performance

| Old | New | Benefit |
|-----|-----|---------|
| Full page fetch every time | Progressive loading | Faster initial load |
| All enrichment at once | Background queue | No blocking |
| Basic rate limiting | Exponential backoff | Better reliability |

### 4. Data Management

| Old | New | Benefit |
|-----|-----|---------|
| Separate KV namespaces | Unified cache | Simpler management |
| No incremental updates | Preserve enrichment | Faster updates |
| Fixed 8-hour schedule | Per-user schedules | Resource efficiency |

### 5. Maintainability

| Old | New | Benefit |
|-----|-----|---------|
| 3 separate codebases | Single codebase | Easier to maintain |
| No error monitoring | Integrated logging | Better debugging |
| Tight coupling | Service layer abstraction | Flexible, testable |

---

## Open Questions

1. ~~**Chart Library**: Which charting library should we use?~~ **RESOLVED** - Use Chart.js v4 (see [Chart Library Decision](#chart-library-decision) below)

2. **Enrichment Trigger**: When should enrichment start?
   - **Recommendation:** Immediately after sync, process in background
   - Don't block user from seeing collection

3. **Large Collections**: How to handle 5000+ item collections?
   - **Recommendation:** Pagination on backend, virtualization on frontend
   - Consider lazy loading for charts

4. **Collection Exports**: Should users be able to export their collection?
   - **Recommendation:** Phase 2 feature - CSV/JSON export

5. **Collection Sharing**: Should users be able to share specific filtered views?
   - **Recommendation:** URL parameters for filters (already exists in old implementation)

---

## Success Metrics

- **Sync Reliability**: >95% success rate for collection syncs
- **Enrichment Coverage**: >90% of releases enriched within 24 hours
- **Page Load Time**: <2s for stats page, <3s for full list
- **API Latency**: <500ms for cached collection, <5s for fresh sync
- **User Adoption**: % of users who connect Discogs after feature launch
- **Privacy Compliance**: Zero unauthorized access incidents

---

## Chart Library Decision

### Background

Since listentomore uses server-side rendering with Hono (not React), we need a charting library that works well with SSR and client-side hydration.

### Options Evaluated

#### Recharts (Not Recommended)

- **Version:** 2.12.7
- **Size:** ~400KB (fairly heavy)
- **React-specific**

**Pros:**
- ✅ React-friendly API
- ✅ Good documentation
- ✅ Responsive containers

**Cons:**
- ❌ Large bundle size (~400KB)
- ❌ Not great for SSR/Workers (React dependency)
- ❌ Can be sluggish with large datasets
- ❌ Accessibility could be better

#### Chart.js v4 (⭐ Recommended)

**Why it's better for listentomore:**
- ✅ **Lightweight:** ~60KB (vs 400KB Recharts) - 6x smaller
- ✅ **Framework-agnostic:** Works with vanilla JS
- ✅ **Perfect for SSR:** Render charts client-side after page load
- ✅ **Great performance:** Canvas-based, handles large datasets (1000+ releases)
- ✅ **Modern & maintained:** v4.4+ actively developed
- ✅ **Accessibility:** Built-in ARIA support
- ✅ **CDN-friendly:** No build complexity

#### ApexCharts (Alternative)

- ✅ Modern, beautiful defaults
- ✅ Interactive and animated
- ✅ Good TypeScript support
- ⚠️ Larger than Chart.js (~150KB)
- ⚠️ More complex API

#### Plotly.js (Not Recommended)

- ✅ Extremely powerful for complex visualizations
- ❌ Very heavy (~1MB+) - overkill for pie/bar charts

#### D3.js (Not Recommended)

- ✅ Maximum flexibility, industry standard
- ❌ Steep learning curve
- ❌ More code to write for basic charts
- ❌ Overkill for pie/bar charts

### Comparison Table

| Library     | Size     | SSR-Friendly | Performance | Recommendation |
|-------------|----------|--------------|-------------|----------------|
| Chart.js v4 | 60KB     | ✅ Excellent  | ✅ Great     | ⭐ Use this     |
| ApexCharts  | 150KB    | ✅ Good       | ✅ Good      | Alternative    |
| Recharts    | 400KB    | ❌ React-only | ⚠️ Okay     | ❌ Don't use    |
| Plotly      | 1MB+     | ⚠️ Heavy     | ✅ Great     | ❌ Overkill     |
| D3.js       | Variable | ✅ Excellent  | ✅ Excellent | ❌ Complex      |

### Decision: Use Chart.js v4

**Reasons:**
1. 6x smaller than Recharts (60KB vs 400KB)
2. Works perfectly with SSR - render charts client-side
3. No React dependency - framework-agnostic
4. Better performance with large collections (1000+ releases)
5. Easier integration with existing patterns
6. CDN-friendly - no build complexity

### Implementation Example

```html
<!-- Load from CDN (no build step needed) -->
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
```

```tsx
// apps/web/src/pages/user/collection/stats.tsx
<script dangerouslySetInnerHTML={{ __html: `
  function renderGenreChart(releases) {
    const genreCounts = {}; // ... your existing logic
    
    const ctx = document.getElementById('genreChart').getContext('2d');
    new Chart(ctx, {
      type: 'pie',
      data: {
        labels: Object.keys(genreCounts),
        datasets: [{
          data: Object.values(genreCounts),
          backgroundColor: ['#FF6C00', '#FFA500', '#FFD700', /* ... */]
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom' },
          tooltip: {
            callbacks: {
              label: (ctx) => \`\${ctx.label}: \${ctx.parsed}%\` 
            }
          }
        }
      }
    });
  }
\` }} />
```

**Migration effort:** Low - Chart.js has similar API to Recharts

---

## Conclusion

This plan provides a comprehensive roadmap for integrating Discogs collection functionality into listentomore. The new implementation addresses all the brittleness of the previous system while leveraging listentomore's existing infrastructure for authentication, caching, and API management.

**Key Advantages:**
- ✅ Multi-user support with OAuth authentication
- ✅ Privacy controls (public/unlisted/private)
- ✅ Single Worker architecture (simpler deployment)
- ✅ Background enrichment (non-blocking)
- ✅ Reuses existing UI components and patterns
- ✅ Better rate limit handling
- ✅ Progressive loading for better UX

**Next Steps:**
1. Review and approve this plan
2. Set up Discogs OAuth app credentials
3. Begin Phase 1 implementation
4. Iterate based on testing and feedback
