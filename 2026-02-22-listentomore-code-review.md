# ListenToMore Full Codebase Review

*2026-02-22 | Automated 3-pass review with validation*

**Repo:** `listentomore` — TypeScript monorepo (Hono + Cloudflare Workers), ~135 source files across 10 packages
**Scope:** Full codebase, all packages and apps
**Tooling results:** Typecheck passes (10/10 packages), tests pass (89/89 across 6 test files)

## Summary

| Severity | Count |
|----------|-------|
| **Critical** | 1 |
| **High** | 10 |
| **Medium** | 22 |
| **Low** | 3 |

One finding was disputed during validation (type safety bypass in `updateUser` — the DB layer's field-by-field checks prevent runtime harm despite the sloppy type annotation).

---

## Critical

### F1. Account deletion via GET request (CSRF)

**`apps/web/src/index.tsx:639`**

`app.get('/account/delete', handleAccountDelete)` routes account deletion as a GET request. The handler at `apps/web/src/pages/account/index.tsx:256-326` performs destructive operations: deletes sessions, deletes the user (with CASCADE), and clears the cookie. The client-side `confirm()` dialog is trivially bypassed since the actual endpoint has no server-side confirmation.

**Attack:** `<img src="https://listentomore.com/account/delete">` on any page deletes any logged-in user's account.

**Fix:** Change to `app.post('/account/delete', ...)` with CSRF token and server-side confirmation.

---

## High — Security

### F2. XSS via unescaped user data in HTML widget

**`apps/web/src/index.tsx:681`**

The `/widget/recent` endpoint returns HTML with `track.album`, `track.artist`, and `username` (from query param) interpolated directly without escaping.

```
GET /widget/recent?format=html&username=<script>alert(1)</script>
```

**Fix:** HTML-escape all interpolated values before embedding in the response.

### F3. Timing-unsafe HMAC signature comparison

**`apps/web/src/utils/internal-token.ts:44`**

`if (signature !== expectedSignature)` short-circuits on first differing byte, enabling timing side-channel attacks against the internal token that protects all `/api/internal/*` endpoints.

**Fix:** Use `crypto.subtle.timingSafeEqual()` (available in Workers runtime).

### F4. Open redirect in Last.fm OAuth callback

**`apps/web/src/pages/auth/lastfm.ts:44,255`**

The `next` query parameter is used as a redirect target after authentication without any validation that it's a relative URL.

**Attack:** `https://listentomore.com/auth/lastfm?next=https://evil.com/phishing`

**Fix:** Validate `next` starts with `/` and doesn't start with `//`.

### F5. XSS via innerHTML in home page community feed

**`apps/web/src/index.tsx:312-330` (logged-in) and `512-531` (logged-out)**

Community feed builds HTML strings from Last.fm data (`listen.artist`, `listen.album`, `listen.username`) without escaping, set via `innerHTML`. The user stats page (`stats.tsx`) correctly uses `escapeHtml()` for similar rendering — this appears to be an oversight.

**Fix:** Apply the same `escapeHtml()` function used in `stats.tsx` to all user-controlled values.

---

## High — Correctness

### F7. Race condition in KV-based rate limiters (TOCTOU)

**`packages/services/spotify/src/rate-limit.ts:23-67` and `packages/services/ai/src/rate-limit.ts:31-73`**

Both rate limiters use a read-then-write pattern on KV with no atomic operations. Under concurrent requests, two isolates can read the same count, both pass the limit check, and both write `count + 1`.

**Fix:** Document as known limitation (KV-based rate limiting is inherently best-effort), or switch to Durable Objects for atomic counters.

---

## High — Maintainability

### F8. Citation parsing duplicated in OpenAI client

**`packages/services/ai/src/openai.ts:292-345, 537-586`**

The identical 3-step citation extraction algorithm is copy-pasted between `chatCompletionViaChatCompletions()` and `parseResponsesResult()`.

**Fix:** Extract a shared `normalizeCitations(content, annotationUrls)` function.

### F9. `escapeHtml` function duplicated in 3 prompt files

**`packages/services/ai/src/prompts/artist-summary.ts:16-22`, `genre-summary.ts:16-22`, `album-recommendations.ts:16-22`**

**Fix:** Move to `@listentomore/shared` as a shared utility.

### F10. `replacePlaceholders` duplicated with divergent implementations

**`packages/services/ai/src/prompts/genre-summary.ts:29-58`, `album-recommendations.ts:28-57`, `artist-summary.ts:30-47`**

Two complex variants handle `{{Album by Artist}}` parsing identically; the artist-summary variant is simpler and doesn't parse "by" syntax. Bug fixes in one won't propagate.

**Fix:** Extract a single parameterized `replacePlaceholders` into a shared prompt utilities module.

### F11. Rate limiter classes ~90% duplicated

**`packages/services/ai/src/rate-limit.ts:14-124` and `packages/services/spotify/src/rate-limit.ts:12-116`**

Identical structure, same `acquire()` flow, same KV pattern. Only differences: Spotify adds jitter, different cache key prefixes, different max wait times.

**Fix:** Create a generic `DistributedRateLimiter` in `@listentomore/shared` parameterized by provider.

### F12. Inline JS (~200 lines) duplicated between home page variants

**`apps/web/src/index.tsx:283-397` (logged-in) and `479-605` (logged-out)**

Community feed progressive loading script is copy-pasted between logged-in and logged-out code paths with nearly identical logic.

**Fix:** Extract to a shared function in `utils/client-scripts.ts` or a static JS asset.

---

## Medium — Security

### F13. XSS in album detail inline script

**`apps/web/src/pages/album/detail.tsx:134-135`**

`album.id` and `album.spotifyUrl` interpolated into JS via template literals without `JSON.stringify()`. Other fields on lines 136-137 correctly use `JSON.stringify()`.

**Fix:** Use `JSON.stringify()` consistently.

### F14. XSS in artist detail inline script

**`apps/web/src/pages/artist/detail.tsx:111`**

Same issue as F13: `artist.id` interpolated without escaping.

### F17. Error responses leak internal details

**`apps/web/src/api/v1/ask.ts:31`, `album.ts:113`, `artist.ts:87`, `genre.ts:38`, `links.ts:65`, `random-fact.ts:64`**

All v1 API error handlers include `details: errorMessage` which can expose upstream provider URLs, API error messages, or stack traces.

**Fix:** Log full errors server-side; return only generic messages to clients.

### F18. Internal API token exposed in page HTML

**`apps/web/src/components/layout/Layout.tsx:93`**

HMAC-signed internal token (5-minute validity) embedded as `window.__INTERNAL_TOKEN__` in every page's HTML source. Visible to browser extensions, injected scripts, or "View Source."

**Fix:** Add per-token rate limiting, bind to requesting IP, or use session-based validation.

### F19. No input length validation on profile update

**`apps/web/src/pages/account/index.tsx:216-233`**

`display_name` and `bio` from form data passed to DB without length validation.

**Fix:** Add length limits (e.g., 100 chars for name, 500 for bio).

### F20. No CSRF protection on POST form endpoints

**`apps/web/src/index.tsx:637-638`**

POST `/account/profile` and `/account/privacy` accept form submissions with session cookie auth only. No CSRF token.

**Fix:** Implement CSRF tokens.

### F21. Prompt injection via unvalidated AI input

**`apps/web/src/api/v1/ask.ts:18` and `packages/services/ai/src/prompts/listen-ai.ts:31`**

User's `question` passed directly to OpenAI with no sanitization or length limit.

**Fix:** Add max length (e.g., 500 chars) and input sanitization.

### F22. Discord bot `/register-commands` has no auth

**`apps/discord-bot/src/index.ts:94-102`**

Publicly accessible command registration endpoint.

**Fix:** Require admin secret header.

### F23. `Access-Control-Allow-Origin: *` in shared HTTP utility

**`packages/shared/src/utils/http.ts:10`**

Wildcard CORS applied to all responses using shared `jsonResponse()` utility.

**Fix:** Remove wildcard default; let each app configure CORS explicitly.

### F24. Rate limiting bypassed when KV unavailable

**`apps/web/src/middleware/security.ts:77-81` and `auth.ts:99-102`**

Rate limiting silently skipped when KV is unavailable (fail-open).

**Fix:** Consider failing closed (503) for expensive endpoints.

---

## Medium — Correctness

### F15. Discord webhook calls fire-and-forget without waitUntil

**`apps/web/src/pages/auth/lastfm.ts:143-167,222-246`**

Webhook `fetch()` calls not wrapped in `executionCtx.waitUntil()`. Worker may terminate before webhook completes.

**Fix:** Wrap in `c.executionCtx.waitUntil()`.

### F16. Last.fm auth callback uses raw `fetch` without timeout

**`apps/web/src/pages/auth/lastfm.ts:67-68`**

Uses global `fetch()` instead of `fetchWithTimeout` like the rest of the codebase.

**Fix:** Use `fetchWithTimeout` with appropriate timeout.

### F25. `toLocaleDateString()` without locale in Workers

**`packages/services/lastfm/src/loved-tracks.ts:65`**

No locale specified — produces inconsistent date formats across Worker isolates.

**Fix:** Specify locale explicitly: `.toLocaleDateString('en-US')`.

---

## Medium — Maintainability

### F26. `LastfmConfig` interface defined 7 times

**`packages/services/lastfm/src/` — 7 files**

**Fix:** Define once in shared types module.

### F27. `LASTFM_API_BASE` constant defined 6 times

**`packages/services/lastfm/src/` — 6 files**

**Fix:** Define once in `@listentomore/config` or a package-level constants file.

### F28. Backup image URL hardcoded in 19+ locations

**Various files — `'https://file.elezea.com/noun-no-image.png'`**

**Fix:** Define `BACKUP_IMAGE_URL` once in `@listentomore/config`.

### F29. `AppError` hierarchy is dead code

**`packages/shared/src/utils/errors.ts:1-91`**

Defines `AppError`, `NotFoundError`, `ValidationError`, `ExternalApiError`, `RateLimitError` — none used anywhere.

**Fix:** Either adopt across the codebase or delete.

### F30. `rateLimitMiddleware` is dead code

**`apps/web/src/middleware/security.ts:72-119`**

Exported but never imported or called. App uses `userRateLimitMiddleware` from `auth.ts` instead.

**Fix:** Delete the unused function and related types.

### F31. `getClientIP` function duplicated

**`apps/web/src/middleware/security.ts:59-66` and `auth.ts:161-168`**

**Fix:** Move to shared `utils/request.ts`.

### F32. Manual TTL calculation instead of `getTtlSeconds()`

**`packages/services/spotify/src/albums.ts:133`, `artists.ts:94,167,216`, `search.ts:181`, `streaming-links/src/index.ts:558`**

6 locations manually compute `ttlDays * 24 * 60 * 60` instead of using the centralized utility.

**Fix:** Use `getTtlSeconds()` consistently.

### F33. `getUserWithPrivacyCheck` duplicated

**`apps/web/src/api/internal/user.ts:12-43` and `insights.ts:17-48`**

Same lookup + privacy check pattern with slightly different return types.

**Fix:** Extract shared helper returning `{ user, lastfm, isOwner }`.

### F34. Verbose DB update boilerplate

**`packages/db/src/index.ts:98-154, 267-308`**

50+ lines of `if (data.field !== undefined)` boilerplate in `updateUser` and `updateSyncState`.

**Fix:** Extract a generic `buildUpdateQuery(data, allowedFields)` helper.

### F35. `scheduled()` is a 130-line god function

**`apps/web/src/index.tsx:737-870`**

Handles random fact generation, user fetching, batched API calls, sorting, caching, and verification in one function.

**Fix:** Extract each cron task into its own function.

### F36. Inconsistent retry logic across AI prompts

**`packages/services/ai/src/prompts/`**

`genre-summary.ts` has 3-attempt retry with exponential backoff. `artist-summary.ts`, `album-detail.ts`, and `album-recommendations.ts` have no retry logic.

**Fix:** Extract `withRetry(fn, options)` utility and apply consistently.

### F37. YouTubeProvider instantiated but never used

**`packages/services/streaming-links/src/index.ts:97-108`**

Commented as "kept for potential future use" but consuming memory on every request.

**Fix:** Remove until needed.

---

## Low

### F38. `slugToDisplayName` incorrect for genre slugs

**`apps/web/src/data/genres.ts:126-131`**

`"r-n-b"` → `"R N B"` instead of `"R&B"`. Similar issues likely with `"edm"` → `"Edm"`.

**Fix:** Add a `DISPLAY_NAME_OVERRIDES` map for known genres.

### F39. Admin secret comparison not constant-time

**`apps/web/src/api/admin/keys.ts:13`**

`adminSecret !== c.env.ADMIN_SECRET` uses standard string comparison. Lower risk than F3 since it's a full secret (not an HMAC signature).

**Fix:** Use constant-time comparison.

### F40. `orderBy` param uses string interpolation in SQL

**`packages/db/src/index.ts:376`**

TypeScript types constrain inputs to safe values (`'date_added' | 'artist' | 'year'` and `'ASC' | 'DESC'`), but the SQL string itself uses interpolation rather than a validated allowlist.

**Fix:** Add runtime allowlist validation before interpolation.

---

## Priority Recommendations

**Fix immediately (security):**
1. F1 — CSRF account deletion via GET (critical, trivial to exploit)
2. F4 — Open redirect in OAuth callback (high, trivial to exploit)
3. F2, F5 — XSS in widget and community feed (high, exploitable via Last.fm data)

**Fix soon (security hardening):**
4. F3 — Timing-unsafe HMAC comparison
5. F13, F14 — XSS in inline scripts (use `JSON.stringify()` — one-line fix each)
6. F17 — Error response leakage (remove `details` field from production responses)
7. F20 — CSRF on POST forms

**Fix when convenient (maintainability):**
8. F8-F12 — Duplication across rate limiters, citation parsing, inline JS, prompt utilities
9. F26-F28 — Constant/interface/URL duplication in Last.fm package
10. F29-F30 — Dead code cleanup
