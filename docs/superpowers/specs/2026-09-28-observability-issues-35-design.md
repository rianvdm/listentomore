# Observability Issues fixes (#35) — design

**Issue:** [#35](https://github.com/rianvdm/listentomore/issues/35)
**Branch:** `fix/observability-issues-35`
**Status:** approved in chat 2026-09-28

## Goal

Clear four real problems surfaced by the Workers Observability Issues view (enabled in ad40b6b). Each fix stops a class of false or leaky error logs, and two change what visitors get back (a proper 404; no 500 for geoblocked regions).

Success criteria:

- Legacy slug URLs on `/artist/:id` and `/album/:id` return HTTP 404 without calling Spotify.
- `/api/internal/artist-sentence` returns `200 { data: null }` when OpenAI rejects the caller's region, and logs at warn.
- Concurrent MusicBrainz lookups are spaced at least 1100 ms apart across all Worker instances; overflow is declined quickly and logged at warn.
- No `TimeoutError` message or `url` property contains a query string.

All changes are built red/green: a failing test first, then the minimum code to pass it.

## 1. Legacy slug URLs → 404

**Cause:** `handleArtistDetail` (`apps/web/src/pages/artist/detail.tsx`) and `handleAlbumDetail` (`apps/web/src/pages/album/detail.tsx`) pass `c.req.param('id')` straight to Spotify. Pre-rewrite slugs (`the-grateful-dead`, `radiohead_pablo-honey`) get a Spotify 400 and the page renders "Failed to load" with HTTP 200.

**Design:**

- Add `isSpotifyId(id: string): boolean` — true only for exactly 22 characters of `[0-9A-Za-z]`. Location: `packages/shared` utils (exported), since both handlers use it.
- Extract the markup inside `app.notFound` (`apps/web/src/index.tsx`) into a shared `NotFoundPage` component under `apps/web/src/components/`, and use it from `app.notFound`.
- Both handlers check `isSpotifyId` first. When false, return `c.html(<NotFoundPage />, 404)` and do not call Spotify.

**Tests:**

- `isSpotifyId`: accepts a real ID (e.g. `4Z8W4fKeB5YxbusRsdQVPb`); rejects slugs, 21/23-char strings, and strings with `-`, `_`, `'`, `%`.
- Handler tests (`apps/web/src/__tests__/handlers/`): a slug returns 404 and the Spotify mock is never called; a valid ID keeps today's behaviour.

## 2. OpenAI region block → `{ data: null }`

**Cause:** `OpenAIClient.responses` (`packages/services/ai/src/openai.ts`) `console.error`s the body and throws a generic `Error(statusText)` for any non-OK response. Visitors whose nearest colo OpenAI rejects (seen from CN and RU) get a 500 from `/api/internal/artist-sentence`.

**Design:**

- Add `RegionUnsupportedError extends Error` in `packages/services/ai` (exported from the package index).
- In `OpenAIClient.responses`, when the response is 403 and the parsed body has `error.code === 'unsupported_country_region_territory'`, `console.warn` a one-line message and throw `RegionUnsupportedError`. All other non-OK responses keep the existing error log and throw. If the body is not JSON, fall through to the existing path.
- Apply the same check in `chatCompletionViaChatCompletions` (same client, same error handling at `openai.ts:256`) through a shared private helper, so the behaviour doesn't depend on which OpenAI endpoint a task uses. `generateImage` is out of scope.
- `/api/internal/artist-sentence` (`apps/web/src/api/internal/artist.ts`) catches `RegionUnsupportedError` and returns `c.json({ data: null })` with status 200. Other errors still return 500.
- No client changes: all four callers (`index.tsx` ×2, `likes.tsx`, `stats.tsx`) already treat a missing `data.sentence` as "no sentence".

**Tests:**

- The client throws `RegionUnsupportedError` for a 403 with that code, and logs at warn, not error.
- The client throws a plain `Error` and logs at error for another 403 body, and for a 500.
- The route returns `200 { data: null }` when `getArtistSentence` throws `RegionUnsupportedError`, and 500 for a generic error.

## 3. MusicBrainz rate limiter → Durable Object

**Cause:** `musicbrainzFetch` (`packages/services/musicbrainz/src/fetch.ts`) reads `lastRequestTime` from KV, sleeps, then writes it back. The read-then-write isn't atomic, KV reads can be stale, and KV allows about one write per second per key. One page firing 7 parallel `/api/internal/streaming-links` calls sent 7 simultaneous MusicBrainz requests (all 503'd) and tripped a KV 429.

**Design:**

Units:

1. **`reserveSlot(nextSlotAt, now, maxWaitMs, intervalMs)`**: a pure function in `packages/services/musicbrainz/src/rate-limit.ts`. Computes `slot = max(now, nextSlotAt)`. If `slot - now > maxWaitMs`, returns `{ waitMs: null, nextSlotAt }` (declined, state unchanged). Otherwise returns `{ waitMs: slot - now, nextSlotAt: slot + intervalMs }`.
2. **`MusicBrainzRateLimiter` interface** in the musicbrainz package: `{ reserve(maxWaitMs: number): Promise<number | null> }`.
3. **`MusicBrainzRateLimiterDO`**: a Durable Object class in `apps/web/src/durable-objects/musicbrainz-rate-limiter.ts`, extending `DurableObject` from `cloudflare:workers`. It holds `nextSlotAt` in memory (no storage) and exposes RPC `reserve(maxWaitMs)`, which calls `reserveSlot` with `Date.now()` and `intervalMs = 1100`, with no `await` in the method body, so each reservation is atomic within the single-threaded object.
4. **`musicbrainzFetch(endpoint, limiter)`**: calls `limiter.reserve(5000)`. On `null`, throws `MusicBrainzRateLimitError('queue full')`. Otherwise waits `waitMs`, then fetches as today. On a 503 it throws `MusicBrainzRateLimitError` (still logged at error, since after serialisation a 503 means MusicBrainz is down or the limiter failed). Removes the KV `musicbrainz:ratelimit:state` reads and writes.

Wiring:

- `MusicBrainzService` constructor becomes `(cache: KVNamespace, limiter: MusicBrainzRateLimiter)`. `cache` stays for UPC/ISRC result caching. The limiter is threaded to `lookupAlbumUpc` / `lookupTrackIsrc` and on to `musicbrainzFetch`.
- `apps/web/src/index.tsx` builds the limiter from `env.MUSICBRAINZ_RATE_LIMITER.get(env.MUSICBRAINZ_RATE_LIMITER.idFromName('global'))` and passes it in. The entry file also exports `MusicBrainzRateLimiterDO`.
- `apps/web/wrangler.toml`: a `[[durable_objects.bindings]]` entry with `name = "MUSICBRAINZ_RATE_LIMITER"` and `class_name = "MusicBrainzRateLimiterDO"`, plus `[[migrations]]` with `tag = "v1"` and `new_sqlite_classes = ["MusicBrainzRateLimiterDO"]`. Add `MUSICBRAINZ_RATE_LIMITER: DurableObjectNamespace<MusicBrainzRateLimiterDO>` to `Bindings` in `apps/web/src/types.ts`.

Error handling:

- The lookup `catch` blocks in `release-lookup.ts` and `recording-lookup.ts` log `MusicBrainzRateLimitError` for "queue full" at **warn**; other errors stay at error. Errors are still not cached, so a later visit retries.
- `maxWaitMs = 5000` is roughly four queued requests (an album lookup can take two calls). A burst beyond that degrades to "no MusicBrainz enrichment", which is today's outcome for a 503, without the 503.
- If the Durable Object is evicted, `nextSlotAt` resets to 0. The worst case is one extra request within a second.

Testing strategy: the pure function and the fetch wrapper are tested in node with Vitest (the existing musicbrainz package setup). The DO class is a thin wrapper around `reserveSlot` and is not unit-tested under the Workers pool; it's covered by typecheck and a local `wrangler dev` smoke check.

**Tests:**

- `reserveSlot`: an idle limiter returns wait 0; back-to-back calls return 0, 1100, 2200; a call beyond `maxWaitMs` returns `null` and leaves `nextSlotAt` unchanged; a call after the slot has passed returns 0.
- `musicbrainzFetch`: waits the reserved time before fetching (fake timers); throws `MusicBrainzRateLimitError` without fetching when the limiter returns `null`; makes no KV rate-limit calls.
- Lookups: a queue-full error logs at warn, not error, and returns `null` without caching.
- Update the existing `musicbrainz.test.ts` construction to pass a mock limiter.

**Out of scope:** `SpotifyRateLimiter` uses the same KV pattern (the source of the one KV 429). Not changed here.

## 4. Strip query strings from `TimeoutError`

**Cause:** `TimeoutError` (`packages/shared/src/utils/fetch.ts`) embeds the full URL in its message and `url` property, so query-string credentials (Last.fm `api_key`, and any other query-string credential) end up in Workers Logs.

**Design:** in the `TimeoutError` constructor, compute the URL without its query string and fragment, and use it for both `this.url` and the message. Parse with `new URL()`, keeping origin and pathname; if parsing fails, split on `?`.

**Tests:** for a URL containing `?method=x&api_key=secret`, neither `error.message` nor `error.url` contains `api_key` or `?`; the path is preserved.

## Delivery

- One commit per plan task (item 3 splits into the limiter and its wiring), each referencing #35, on `fix/observability-issues-35`.
- Inner MBID lookups (`lookupReleaseBarcode`, `lookupRecordingIsrc`) rethrow `MusicBrainzRateLimitError` so the outer lookup doesn't cache a rate-limit failure as a 30-day "not found". Today a 503 on the follow-up call is cached that way.
- `pnpm typecheck` and `pnpm test` pass before the branch is offered for review.
- No deploy until Rian says so. The Durable Object migration applies on the first deploy.
