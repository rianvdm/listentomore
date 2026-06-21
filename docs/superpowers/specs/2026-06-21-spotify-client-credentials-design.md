# Spotify auth: migrate to Client Credentials flow

**Date:** 2026-06-21
**Status:** Design approved, ready for plan
**Branch:** `feat/spotify-client-credentials`

## Problem

Spotify is putting a hard **6-month expiration on refresh tokens** ([announcement, 2026-06-18](https://developer.spotify.com/blog/2026-06-18-refresh-token-expiration)). The clock starts at the original authorization and does **not** reset on refresh. On expiry the token endpoint returns `{"error": "invalid_grant"}`.

- New apps: enforced immediately.
- Existing apps: enforced from **2026-07-20**.

ListenToMore authenticates Spotify with static, app-level **refresh tokens** obtained via the Authorization Code flow — exactly the affected flow. After the 6-month mark these tokens expire and every Spotify-backed feature (album/artist pages, search, streaming links, the Discord bot's lookups) breaks. Because this is the developer's own authorization rather than per-user OAuth, there is no end user to "re-login" — under the current design the only recovery is a manual re-authorization and secret rotation every six months.

## Verification (why Client Credentials is the right fix)

1. **LTM is on the affected flow.** `packages/services/spotify/src/auth.ts:43` posts `grant_type=refresh_token` with static secrets `SPOTIFY_REFRESH_TOKEN` and `SPOTIFY_STREAMING_REFRESH_TOKEN`. The announcement: *"This only applies to tokens issued on behalf of a user (Authorization Code and Authorization Code with PKCE flows)."*
2. **Every Spotify call is catalog-only.** The only endpoints used are `/search`, `/artists/{id}`, `/artists/{id}/albums`, `/artists/{id}/related-artists`, `/albums/{id}` (in `search.ts`, `artists.ts`, `albums.ts`). `streaming-links` calls no Spotify API directly — it consumes the injected `SpotifyService`. No `/me`, no user scopes.
3. **Nothing forces Authorization Code.** The classic reason to use a user token for catalog data — `market=from_token` — is not used. The only market reference is a hardcoded `market: 'US'` (`artists.ts:141`), which is what Client Credentials needs anyway.
4. **Client Credentials is exempt and needs no refresh token.** Spotify's [Client Credentials tutorial](https://developer.spotify.com/documentation/web-api/tutorials/client-credentials-flow) returns only `access_token`, `token_type`, `expires_in` — no refresh token. The announcement FAQ: *"Does this affect Client Credentials flow? No."*

Migrating to Client Credentials doesn't just handle the expiry; it removes the refresh-token lifecycle entirely. There is nothing to re-authorize, ever.

## Decision

**Approach A — surgical Client Credentials swap.** Move both Spotify apps to `grant_type=client_credentials`, remove the two refresh-token secrets and the `refreshToken` config field, add a direct unit test for the new token request, and keep everything else (including the two-app rate-limit split) as is.

Rejected alternatives:
- **Consolidate to one app** — would also merge the secondary "streaming" Spotify app into the primary, but loses the rate-limit isolation that app exists to provide. No reason to change architecture during an auth migration.
- **Stay on Authorization Code, harden** — detect `invalid_grant`, alert, document a manual ~6-month re-auth runbook. Smallest diff today but keeps the time bomb and adds recurring toil. Strictly worse for a catalog-only consumer.

## Design

### 1. Token request — `packages/services/spotify/src/auth.ts`

The only behavioral change.

- Rename `refreshAccessToken()` → `fetchAccessToken()` (it no longer refreshes anything).
- Swap the POST body from `{ grant_type: 'refresh_token', refresh_token }` to `{ grant_type: 'client_credentials' }`.
- Remove `refreshToken` from the `SpotifyAuthConfig` interface (`auth.ts:14`).
- Unchanged: the `https://accounts.spotify.com/api/token` URL, the Basic `clientId:clientSecret` auth header, the KV token cache keyed by client ID, the `expires_in` math with the 60-second early-expiry buffer, and `fetchWithTimeout('fast')`. The response is already parsed as `{ access_token, expires_in }`, which is exactly the Client Credentials response shape.
- `getAccessToken()` is untouched. The class's public surface is identical, so `search.ts` / `albums.ts` / `artists.ts` need no changes.

No new Spotify app or dashboard change is required — a registered app supports Client Credentials with its existing client ID / secret. Only the grant type changes.

### 2. Drop `refreshToken` through the wiring

- `packages/services/spotify/src/index.ts` — `SpotifyService` config type (`:43`) and the `SpotifyAuth` construction (`:55`).
- `apps/web/src/index.tsx` — both constructions (`:90` primary, `:101` secondary). The secondary-app fallback stays gated on `SPOTIFY_STREAMING_CLIENT_ID` (`:97`).
- `apps/discord-bot/src/index.ts` — the construction (`:58`) and the `Env` field (`:33`).
- `apps/web/src/types.ts` — `SPOTIFY_REFRESH_TOKEN` (`:19`) and `SPOTIFY_STREAMING_REFRESH_TOKEN` (`:23`).
- `.dev.vars` (both apps) and the `wrangler.toml` secret-comment lists. Keep both client ID / secret pairs.

### 3. Error handling

No new path. Client Credentials has no `invalid_grant` / refresh-token lifecycle; a 4xx now means bad client credentials, which is a deploy-time config error. The existing `if (!response.ok) throw` (`auth.ts:65`) already surfaces it.

### 4. Testing

`packages/services/spotify` has no test runner (only `typecheck`), so Spotify logic is tested from the web package. Add one focused test under `apps/web/src/__tests__/services/` that constructs a real `SpotifyAuth` (exported from the `@listentomore/spotify` barrel) with `setupFetchMock` + `createMockKV`, asserting:

1. the token POST body is `grant_type=client_credentials` with the Basic header and **no** `refresh_token`;
2. the returned token is cached;
3. a cache hit skips the fetch.

Existing tests are unaffected — they mock at the `getAccessToken()` boundary (`createMockSpotifyAuth`, `mocks.ts:80`), which is also why no current test exercises the request body. Gate: full web suite green + `typecheck`.

### 5. Rollout (load-bearing — this is production auth)

Strict ordering so there is no outage window:

1. Land and deploy the code. While the old secrets still exist, Client Credentials ignores them — nothing breaks.
2. Verify locally: `.dev.vars` with Client Credentials creds, then exercise an album page, an artist page, and a streaming-link resolution; run the full suite.
3. Deploy web + discord-bot. Smoke-test prod: an album/artist render, a streaming link, and one Discord command.
4. **Only after prod is verified green**, delete the dead secrets: `wrangler secret delete SPOTIFY_REFRESH_TOKEN` (+ `SPOTIFY_STREAMING_REFRESH_TOKEN` on web).

Rollback is a plain deploy-revert; the refresh tokens stay valid in Spotify until their 6-month expiry, so a revert before 2026-07-20 still works. Cached `spotify:token:<clientId>` entries are plain bearer tokens (same shape under Client Credentials), so no cache migration is needed.

## Out of scope (flagged, not touched)

- The `/artists/{id}/related-artists` Nov-2024 deprecation for Development-Mode apps — pre-existing and orthogonal to the OAuth flow.
- Any future "log in with Spotify" user feature — that would need a separate user-OAuth path and would itself be subject to the 6-month expiry, handled per-user via re-login. Build only if and when needed.
- The vestigial `user-read-private` / `user-read-email` scopes from the original authorization — irrelevant under Client Credentials, nothing in code to remove.

## Files touched

| File | Change |
|------|--------|
| `packages/services/spotify/src/auth.ts` | grant type → `client_credentials`; rename method; drop `refreshToken` from `SpotifyAuthConfig` |
| `packages/services/spotify/src/index.ts` | drop `refreshToken` from `SpotifyService` config + `SpotifyAuth` construction |
| `apps/web/src/index.tsx` | drop `refreshToken` from both constructions |
| `apps/web/src/types.ts` | remove `SPOTIFY_REFRESH_TOKEN` + `SPOTIFY_STREAMING_REFRESH_TOKEN` |
| `apps/discord-bot/src/index.ts` | drop `refreshToken` from construction + `Env` field |
| `apps/web/src/__tests__/services/*` | new Client Credentials token-request test |
| `apps/web/.dev.vars`, `apps/discord-bot/.dev.vars` | remove refresh-token lines |
| `apps/web/wrangler.toml`, `apps/discord-bot/wrangler.toml` | remove refresh-token comment lines |
| Spotify dashboard / `wrangler secret delete` | remove `SPOTIFY_REFRESH_TOKEN` (both Workers) + `SPOTIFY_STREAMING_REFRESH_TOKEN` (web), post-verify |

## References

- [Spotify: Refresh token expiration (2026-06-18)](https://developer.spotify.com/blog/2026-06-18-refresh-token-expiration)
- [Spotify: Client Credentials flow tutorial](https://developer.spotify.com/documentation/web-api/tutorials/client-credentials-flow)
