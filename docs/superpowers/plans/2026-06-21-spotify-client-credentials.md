# Spotify Client Credentials Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move both Spotify apps off Authorization Code refresh tokens to the Client Credentials flow, so the 6-month refresh-token expiry (existing apps from 2026-07-20) can never break catalog access.

**Architecture:** `SpotifyAuth` (`packages/services/spotify/src/auth.ts`) requests an app token with `grant_type=client_credentials` and Basic `clientId:clientSecret` auth, caching it in KV by client ID. The `refreshToken` field is removed from the config and threaded out of all three construction sites. The two-app rate-limit split (primary + streaming) is preserved — each just uses its own client ID/secret. No user-scoped endpoints are involved.

**Tech Stack:** TypeScript, Cloudflare Workers, Hono, vitest, pnpm 9.14.2 + turbo, Node 22.

## Global Constraints

- Client Credentials is for catalog endpoints only; no user scopes, no `/me`. (Verified: only `/search`, `/artists/{id}`, `/artists/{id}/albums`, `/artists/{id}/related-artists`, `/albums/{id}` are used.)
- No new Spotify app/dashboard registration — a registered app supports Client Credentials with its existing client ID/secret. Only the grant type changes.
- Keep the two-app rate-limit split (primary + streaming). Do not consolidate.
- `packages/services/spotify` has **no test runner** (only `typecheck`). All Spotify tests live in the **web** package (`apps/web/src/__tests__/`).
- Rollout is strict: deploy + verify on Client Credentials BEFORE deleting any refresh-token secret. Never delete first.
- Spec: `docs/superpowers/specs/2026-06-21-spotify-client-credentials-design.md`.

---

### Task 1: Swap the token request to Client Credentials (code)

This is one atomic change: TypeScript couples the `SpotifyAuthConfig` change to every caller, so the request swap, the config-field removal, and all call-site updates land together and the build is green at the end. TDD drives the behavior; the plumbing keeps typecheck green.

**Files:**
- Create: `apps/web/src/__tests__/services/spotify-auth.test.ts`
- Modify: `packages/services/spotify/src/auth.ts` (interface `:14`, `getAccessToken` `:40`, `refreshAccessToken` `:43-53`, log line `:45`)
- Modify: `packages/services/spotify/src/index.ts` (config type `:43`, construction `:55`)
- Modify: `apps/web/src/index.tsx` (`:90`, `:101`)
- Modify: `apps/web/src/types.ts` (`:19`, `:23`)
- Modify: `apps/discord-bot/src/index.ts` (`Env` `:33`, construction `:58`)
- Modify: `apps/web/wrangler.toml` (secret comments `:52`, `:55`)
- Modify: `apps/discord-bot/wrangler.toml` (secret comment `:33`)
- Local only (gitignored, not committed): `apps/web/.dev.vars`, `apps/discord-bot/.dev.vars`

**Interfaces:**
- Consumes: `SpotifyAuth` (exported from `@listentomore/spotify`), `createMockKV` + `setupFetchMock` (from `apps/web/src/__tests__/utils/mocks.ts`).
- Produces: `SpotifyAuthConfig = { clientId: string; clientSecret: string }` (no `refreshToken`). `SpotifyService` constructor config drops `refreshToken`. `getAccessToken(): Promise<string>` is unchanged.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/__tests__/services/spotify-auth.test.ts`:

```typescript
// Client Credentials token-request tests for SpotifyAuth
import { describe, it, expect, beforeEach } from 'vitest';
import { SpotifyAuth } from '@listentomore/spotify';
import { createMockKV, setupFetchMock } from '../utils/mocks';

describe('SpotifyAuth (Client Credentials)', () => {
  let mockKV: KVNamespace;

  beforeEach(() => {
    mockKV = createMockKV();
  });

  it('requests a token via the client_credentials grant with no refresh_token', async () => {
    const mockFetch = setupFetchMock([
      {
        pattern: 'accounts.spotify.com/api/token',
        response: { access_token: 'cc-token', expires_in: 3600 },
      },
    ]);

    const auth = new SpotifyAuth({ clientId: 'abc12345', clientSecret: 'shh' }, mockKV);
    const token = await auth.getAccessToken();

    expect(token).toBe('cc-token');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain('accounts.spotify.com/api/token');

    const body = (init as RequestInit).body as string;
    expect(body).toContain('grant_type=client_credentials');
    expect(body).not.toContain('refresh_token');

    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${btoa('abc12345:shh')}`);
  });

  it('caches the token and skips the fetch on the next call', async () => {
    const mockFetch = setupFetchMock([
      {
        pattern: 'accounts.spotify.com/api/token',
        response: { access_token: 'cc-token', expires_in: 3600 },
      },
    ]);

    const auth = new SpotifyAuth({ clientId: 'abc12345', clientSecret: 'shh' }, mockKV);
    await auth.getAccessToken();
    await auth.getAccessToken();

    expect(mockFetch).toHaveBeenCalledTimes(1); // second call served from KV cache
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd apps/web && npx vitest run src/__tests__/services/spotify-auth.test.ts`
Expected: FAIL on the first test — the current code sends `grant_type=refresh_token` (with `refresh_token=undefined` because the test passes no refresh token), so `body` does not contain `grant_type=client_credentials`.

- [ ] **Step 3: Change the token request in `auth.ts`**

In `packages/services/spotify/src/auth.ts`:

Remove `refreshToken` from the config interface (`:14-18`):

```typescript
export interface SpotifyAuthConfig {
  clientId: string;
  clientSecret: string;
}
```

Rename the call in `getAccessToken` (`:40`):

```typescript
    // Token expired or not in cache - fetch a new one
    return this.fetchAccessToken();
```

Rename the method and swap the grant type (`:43-53`). Replace the method signature, log line, and body:

```typescript
  private async fetchAccessToken(): Promise<string> {
    const clientIdPrefix = this.config.clientId.substring(0, 8);
    console.log(`[Spotify] Fetching client-credentials token for app ${clientIdPrefix}...`);

    const credentials = btoa(`${this.config.clientId}:${this.config.clientSecret}`);

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
    });
```

Everything below (the `fetchWithTimeout` POST, the `!response.ok` throw, the `expires_in` math, the KV `put`) stays exactly as is.

- [ ] **Step 4: Thread `refreshToken` out of the callers**

In `packages/services/spotify/src/index.ts` — drop it from the `SpotifyService` config type (`:40-45`) and the `SpotifyAuth` construction (`:51-58`):

```typescript
  constructor(config: {
    clientId: string;
    clientSecret: string;
    cache: KVNamespace;
  }) {
```

```typescript
    this.auth = new SpotifyAuth(
      {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
      },
      config.cache
    );
```

In `apps/web/src/index.tsx` — remove the `refreshToken` line from both constructions (delete `:90` and `:101`):

```typescript
  // Primary Spotify service (album/artist pages, search)
  const spotify = new SpotifyService({
    clientId: c.env.SPOTIFY_CLIENT_ID,
    clientSecret: c.env.SPOTIFY_CLIENT_SECRET,
    cache: c.env.CACHE,
  });
```

```typescript
  const spotifyStreaming = c.env.SPOTIFY_STREAMING_CLIENT_ID
    ? new SpotifyService({
      clientId: c.env.SPOTIFY_STREAMING_CLIENT_ID!,
      clientSecret: c.env.SPOTIFY_STREAMING_CLIENT_SECRET!,
      cache: c.env.CACHE,
    })
    : spotify;
```

In `apps/web/src/types.ts` — delete both env fields (`:19` and `:23`): `SPOTIFY_REFRESH_TOKEN: string;` and `SPOTIFY_STREAMING_REFRESH_TOKEN?: string;`. Keep `SPOTIFY_STREAMING_CLIENT_ID` / `SPOTIFY_STREAMING_CLIENT_SECRET`.

In `apps/discord-bot/src/index.ts` — delete the `Env` field (`:33`) `SPOTIFY_REFRESH_TOKEN: string;` and the construction line (`:58`):

```typescript
    spotify: new SpotifyService({
      clientId: env.SPOTIFY_CLIENT_ID,
      clientSecret: env.SPOTIFY_CLIENT_SECRET,
      cache: env.CACHE,
    }),
```

- [ ] **Step 5: Run the new test, verify it passes**

Run: `cd apps/web && npx vitest run src/__tests__/services/spotify-auth.test.ts`
Expected: PASS (both tests).

- [ ] **Step 6: Run the full gates, verify green**

Run: `pnpm test` (from repo root — turbo runs every package's vitest)
Expected: PASS, no regressions.

Run: `pnpm typecheck` (from repo root — turbo runs `tsc --noEmit` in every package, catching all the type ripples from the removed field)
Expected: PASS in `@listentomore/spotify`, `apps/web`, `apps/discord-bot`, and all others.

- [ ] **Step 7: Update the secret-comment lists and local `.dev.vars`**

In `apps/web/wrangler.toml` delete the two comment lines (`:52`, `:55`): `# - SPOTIFY_REFRESH_TOKEN` and `# - SPOTIFY_STREAMING_REFRESH_TOKEN`. Keep the `SPOTIFY_STREAMING_CLIENT_ID` / `_SECRET` comment lines.

In `apps/discord-bot/wrangler.toml` delete the comment line (`:33`): `# - SPOTIFY_REFRESH_TOKEN`.

In `apps/web/.dev.vars` and `apps/discord-bot/.dev.vars` (gitignored — local edit only, NOT staged) delete the `SPOTIFY_REFRESH_TOKEN=…` line (and `SPOTIFY_STREAMING_REFRESH_TOKEN=…` in the web one). Keep the client ID/secret lines. These are only needed for the optional `wrangler dev` manual check; the vitest suite doesn't read them.

- [ ] **Step 8: Optional local smoke check (`wrangler dev`)**

Run: `cd apps/web && npx wrangler dev`, then load an album page and an artist page and resolve a streaming link in the local UI. Confirm Spotify data renders with no `SPOTIFY_REFRESH_TOKEN` present. (Skip if you trust the unit + typecheck gates; the real verification is prod in Task 2.)

- [ ] **Step 9: Commit**

```bash
git add packages/services/spotify/src/auth.ts \
        packages/services/spotify/src/index.ts \
        apps/web/src/index.tsx \
        apps/web/src/types.ts \
        apps/web/src/__tests__/services/spotify-auth.test.ts \
        apps/discord-bot/src/index.ts \
        apps/web/wrangler.toml \
        apps/discord-bot/wrangler.toml
git commit -m "Migrate Spotify auth to Client Credentials flow

Removes the Authorization Code refresh-token dependency (subject to
Spotify's 6-month expiry from 2026-07-20). Catalog-only access works
under Client Credentials with the existing client ID/secret pairs."
```

(`.dev.vars` is gitignored and is intentionally not staged.)

---

### Task 2: Deploy, verify, then delete the dead secrets (manual ops — Rian runs this)

Not agent-drivable: requires a production deploy, live smoke tests, and secret deletion against the real Workers. `ci.yml` is test-only, so deploys are manual. Per the project's workflow, Task 1 is locally tested and approved, then pushed + PR'd + merged to `main` **before** this task. **Order is load-bearing: deploy and verify on Client Credentials BEFORE deleting any secret.** While the old secrets still exist, Client Credentials ignores them, so there is no outage window.

- [ ] **Step 1: Deploy both Workers from `main`**

Ensure wrangler targets the correct account for ListenToMore. Then:

```bash
# from repo root (turbo deploys both apps):
pnpm deploy
# — or per app:
cd apps/web && npx wrangler deploy
cd apps/discord-bot && npx wrangler deploy
```

- [ ] **Step 2: Smoke-test production**

- Load an album page and an artist page on listentomore.com — confirm Spotify-sourced data (cover art, tracks, related artists) renders.
- Resolve a streaming link (paste a Spotify or Apple Music URL into the streaming-links flow) — confirm cross-platform links return.
- Run one Discord command that hits Spotify (e.g. `/whatis` or `/listento`) — confirm it responds.

If anything fails, roll back (`wrangler rollback` per Worker, or redeploy the prior commit). The refresh tokens are still valid in Spotify until expiry, so a pre-2026-07-20 revert restores the old flow. Do **not** proceed to Step 3 until prod is green.

- [ ] **Step 3: Delete the dead refresh-token secrets**

Only after Step 2 is green:

```bash
cd apps/web
npx wrangler secret delete SPOTIFY_REFRESH_TOKEN
npx wrangler secret delete SPOTIFY_STREAMING_REFRESH_TOKEN

cd ../discord-bot
npx wrangler secret delete SPOTIFY_REFRESH_TOKEN
```

- [ ] **Step 4: Confirm still green after secret deletion**

Reload an album page and run a Discord command once more — confirm Spotify still works with the refresh-token secrets gone. Done: the 6-month expiry can no longer affect ListenToMore.

---

## Self-Review

**Spec coverage:**
- §1 token request → Task 1 Steps 1–5. ✓
- §2 drop `refreshToken` plumbing (all 5 code locations + env types) → Task 1 Step 4. ✓
- §3 error handling (no new path) → unchanged; `!response.ok` throw kept in Step 3. ✓
- §4 testing (new CC token-request test in web suite) → Task 1 Steps 1, 5, 6. ✓
- §5 rollout (deploy → verify → delete secrets, strict order) → Task 2. ✓
- §6 out of scope (related-artists, future user OAuth, vestigial scopes) → not touched. ✓
- Files-touched table → all covered across Task 1 (code + wrangler comments + .dev.vars) and Task 2 (secret deletion). ✓

**Placeholder scan:** No TBD/TODO. Every code step shows the actual code; every command shows expected output. ✓

**Type consistency:** `SpotifyAuthConfig` becomes `{ clientId, clientSecret }` in Task 1 Step 3 and is constructed with exactly those fields in Step 4 (`index.ts`). `SpotifyService` config drops `refreshToken` in Step 4 and is constructed without it at all three call sites in the same step. `getAccessToken()` / `fetchAccessToken()` rename is internal to `auth.ts` (Step 3) and consistent. ✓
