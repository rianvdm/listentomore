# Public Cached Summaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show already-cached AI album, artist and genre summaries (and cached album recommendations) in the page HTML for every visitor, without ever generating one for an anonymous visitor, and publish a sitemap of those pages.

**Architecture:** Page handlers read the AI cache through new read-only `AIService` methods and pass rendered HTML to the page components; the client script only fetches what the server didn't render, and only for signed-in users. A D1 table maps album and artist cache keys to page paths (written by the signed-in internal routes, backfilled once); `/sitemap.xml` joins live KV keys with that table. A `PUBLIC_CACHED_SUMMARIES` var turns the whole behaviour off.

**Tech Stack:** Hono JSX on Cloudflare Workers, KV, D1, Vitest (node environment), `marked` 18.1.3 for server-side Markdown, `tsx` for scripts.

**Spec:** `docs/superpowers/specs/2026-11-08-public-cached-summaries-design.md`

## Global Constraints

- Single Worker; Hono JSX server rendering; no client framework (`AGENTS.md`).
- Files start with two `// ABOUTME:` lines; 2-space indent, semicolons, single quotes, trailing commas.
- No anonymous request may trigger a model call for `albumDetail`, `artistSummary`, `genreSummary` or `albumRecommendations`.
- `/api/internal/*` AI routes keep `requireSessionAuth`.
- Never cache an AI response without `isCacheableResponse()`. The only new KV writes are the audit script's expiry refresh.
- Cache TTLs come from `getCacheTtlSeconds()` in `@listentomore/config`; never hardcode them.
- Public behaviour is on only when `env.PUBLIC_CACHED_SUMMARIES === 'true'`.
- Label copy: `AI-written summary` linking to `/about#how-its-built`.
- Genres outside `isCuratedGenre()` keep `noindex` and stay out of the sitemap.
- `marked` pinned to `18.1.3` in `apps/web/package.json`.

## Review Focus

1. **Name casing and whitespace** ("OK Computer" vs "ok computer ") must hit the same cache entry the generator wrote; a miss must render the normal page, never error. Test in Task 1.
2. **Cached artist summaries contain raw `<a href="/album?q=…">` links** produced by `replacePlaceholders`; server rendering must keep them as working links, not escaped text. Test in Task 2.
3. **A cached "Not enough information available…" reply** must not be published; anonymous visitors see the sign-in prompt instead. Test in Task 2 and Task 3.
4. **Anonymous visitor, flag on, cache miss** must make zero model calls. Test in Tasks 3 to 5.
5. **KV read throws** (a KV outage) must leave the page rendering as today, with status 200. Test in Task 3.

---

### Task 1: Read-only cache access in AIService

**Files:**
- Modify: `packages/services/ai/src/cache.ts` (export the key builder)
- Modify: `packages/services/ai/src/index.ts` (four read-only methods, export `aiCacheKey`)
- Test: `apps/web/src/__tests__/services/ai-cached-reads.test.ts`

**Interfaces:**
- Produces: `aiCacheKey(task: AITask, ...params: string[]): string` (same normalization as today's private `makeKey`: lowercase, trim, joined with `:`, prefixed `ai:<task>:`), used by `AICache` internally and by Tasks 6 and 7.
- Produces on `AIService`: `getCachedAlbumDetail(artist: string, album: string): Promise<string | null>`, `getCachedAlbumRecommendations(artist: string, album: string): Promise<string | null>`, `getCachedArtistSummary(name: string): Promise<string | null>`, `getCachedGenreSummary(name: string): Promise<string | null>`. Each returns the stored Markdown (`content`, or `summary` for artists) or `null`, never calls a chat client, and returns `null` if the KV read throws (log with `console.error`).

- [ ] **Step 1: Write the failing tests**

```ts
it('reads what the generator wrote, regardless of case and whitespace', async () => {
  const kv = createMockKV();
  await new AICache(kv).set('albumDetail', ['radiohead', 'ok computer'], { content: '### Hi' });
  const ai = makeService(kv);
  expect(await ai.getCachedAlbumDetail(' Radiohead', 'OK Computer ')).toBe('### Hi');
});
it('returns the artist summary field', async () => { /* set artistSummary {summary:'x'} → 'x' */ });
it('returns null on a miss and never calls fetch', async () => {
  expect(await ai.getCachedGenreSummary('shoegaze')).toBeNull();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
it('returns null when KV throws', async () => { /* kv.get rejects → null */ });
it('aiCacheKey matches the stored key', () => {
  expect(aiCacheKey('albumDetail', 'Radiohead ', 'OK Computer')).toBe('ai:albumDetail:radiohead:ok computer');
});
```

`makeService(kv)` builds `new AIService({ openaiApiKey: 'x', anthropicApiKey: 'x', cache: kv })`; check `AIServiceConfig` for any other required field.

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/services/ai-cached-reads.test.ts`
Expected: FAIL (methods and export missing).

- [ ] **Step 3: Implement** `aiCacheKey` (move `makeKey`'s body; `AICache` calls it) and the four methods, each one `this.cache.get(task, ...)` wrapped in try/catch.

- [ ] **Step 4: Run the test file, then `pnpm typecheck`.** Expected: PASS, no errors.

- [ ] **Step 5: Commit** `Add read-only cached summary lookups to AIService`

### Task 2: Shared rendering pieces and the feature flag

**Files:**
- Create: `apps/web/src/utils/public-summaries.ts`
- Create: `apps/web/src/components/ui/AiSummaryLabel.tsx`
- Modify: `apps/web/src/components/ui/SignInCTA.tsx`, `apps/web/src/components/ui/index.ts`
- Modify: `apps/web/src/pages/about/index.tsx` (add `id="how-its-built"` to the "How it's built" `<h2>`)
- Modify: `apps/web/src/types.ts` (`PUBLIC_CACHED_SUMMARIES?: string` on `Bindings`)
- Modify: `apps/web/package.json` (`"marked": "18.1.3"`)
- Test: `apps/web/src/__tests__/utils/public-summaries.test.ts`, `apps/web/src/__tests__/components/ui/public-summary-ui.test.ts`

**Interfaces:**
- Produces: `publicSummariesEnabled(env: { PUBLIC_CACHED_SUMMARIES?: string } | undefined): boolean` (true only for the string `'true'`).
- Produces: `renderPublicSummary(markdown: string | null): string | null`: returns `null` for `null`, empty or whitespace, or text containing `Not enough information available`; otherwise `marked.parse(markdown, { async: false })` with default options, matching the client's `marked.parse`.
- Produces: `<AiSummaryLabel />` rendering `<p class="ai-summary-label text-muted"><a href="/about#how-its-built">AI-written summary</a></p>`.
- Produces: `SignInCTA` gains `variant?: 'unlock' | 'personal'` (default `'unlock'`, today's markup unchanged). `'personal'` renders heading `Sign in with Last.fm for more` and bullets: `Your listening stats and history`, `Weekly listening insights`, `Recommendations based on what you play`, `A public profile page`; no bullet mentions AI summaries.

- [ ] **Step 1: Write the failing tests**

```ts
it('renders Markdown to HTML', () => { expect(renderPublicSummary('### A\n\nb')).toContain('<h3>A</h3>'); });
it('keeps cached anchor HTML as links', () => {
  expect(renderPublicSummary('Try <a href="/album?q=x">X</a>.')).toContain('<a href="/album?q=x">X</a>');
});
it('refuses empty and not-enough-information text', () => {
  expect(renderPublicSummary('')).toBeNull();
  expect(renderPublicSummary('Not enough information available for this artist.')).toBeNull();
  expect(renderPublicSummary(null)).toBeNull();
});
it('reads the flag strictly', () => {
  expect(publicSummariesEnabled({ PUBLIC_CACHED_SUMMARIES: 'true' })).toBe(true);
  expect(publicSummariesEnabled({ PUBLIC_CACHED_SUMMARIES: 'false' })).toBe(false);
  expect(publicSummariesEnabled({})).toBe(false);
});
it('personal CTA pitches personal features, not AI summaries', () => {
  const html = SignInCTA({ currentPath: '/album/x', variant: 'personal' }).toString();
  expect(html).toContain('Recommendations based on what you play');
  expect(html).not.toMatch(/AI-powered album and artist summaries/);
});
it('default CTA is unchanged', () => { /* contains 'AI-powered album and artist summaries' */ });
it('label links to the About anchor', () => { /* AiSummaryLabel contains href="/about#how-its-built" */ });
it('About has the anchor', () => { /* AboutPage html contains id="how-its-built" */ });
```

- [ ] **Step 2: Run, confirm failure.** `pnpm --filter @listentomore/web exec vitest run src/__tests__/utils/public-summaries.test.ts src/__tests__/components/ui/public-summary-ui.test.ts`
- [ ] **Step 3: `pnpm install` after adding `marked`, then implement.**
- [ ] **Step 4: Run tests and `pnpm typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** `Add public summary rendering, AI label and personal sign-in prompt`

### Task 3: Album page renders cached summary and recommendations

**Files:**
- Modify: `apps/web/src/pages/album/detail.tsx`
- Test: `apps/web/src/__tests__/handlers/album-public-summary.test.ts`

**Interfaces:**
- Consumes: Task 1 methods via `c.get('ai')`; Task 2 `publicSummariesEnabled(c.env)`, `renderPublicSummary`, `AiSummaryLabel`, `SignInCTA variant="personal"`.
- `AlbumDetailPage` props gain `summaryHtml?: string | null` and `recommendationsHtml?: string | null`.

Behaviour (flag on): the handler reads both cached entries in parallel after the Spotify fetch, using `albumData.artist` and `albumData.name` (the same names `resolveSpotifyAlbum` passes to the generators). If `summaryHtml` exists, render it inside `#ai-summary` with `<AiSummaryLabel />` for every visitor; same for `recommendationsHtml` inside `#album-recommendations` under its `<h3>Album Recommendations</h3>`. Logged-out visitors see `SignInCTA variant="personal"` below whatever was rendered; if neither was rendered they see today's `SignInGate` output. The client script fetches a section only when the user is signed in and the server didn't render it (emit `window.__AI_SUMMARY_RENDERED__` and `window.__AI_RECS_RENDERED__` booleans); it still calls `enrichLinks('album-recommendations')` on server-rendered recommendations. Flag off: exactly today's output.

- [ ] **Step 1: Write the failing tests** (Hono app as in `detail-not-found.test.ts`; `ai` mock with `getCachedAlbumDetail`, `getCachedAlbumRecommendations`, and `getAlbumDetail`/`getAlbumRecommendations` as `vi.fn()` that must stay uncalled; pass `{ PUBLIC_CACHED_SUMMARIES: 'true' }` as env to `app.request`):

```ts
it('shows a cached summary to a logged-out visitor with the label and personal prompt');
  // html contains the rendered summary text, 'AI-written summary', 'Recommendations based on what you play'
  // and not 'AI-powered album and artist summaries'; getAlbumDetail not called
it('shows cached recommendations under their heading');
it('shows today\'s sign-in prompt and makes no model call on a cache miss');
  // getCached* return null → html contains 'AI-powered album and artist summaries'; no generate call
it('does not publish a cached "Not enough information" reply');
it('renders the normal page with status 200 when the cache read fails');
  // getCachedAlbumDetail rejects → status 200
it('ignores the cache when the flag is off');
  // env {} → no summary text in html even though getCached* would return it
```

- [ ] **Step 2: Run, confirm failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run this file, the existing `detail-not-found.test.ts`, and `pnpm typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** `Render cached album summaries and recommendations for every visitor`

### Task 4: Artist page renders cached summary

**Files:** Modify `apps/web/src/pages/artist/detail.tsx`; Test `apps/web/src/__tests__/handlers/artist-public-summary.test.ts`

**Interfaces:** Same pattern as Task 3 with `getCachedArtistSummary(artistData.name)`, prop `summaryHtml`, the existing `<p><strong>Overview:</strong></p>` heading kept above it, and `enrichLinks('ai-summary')` run on server-rendered content. Flag `window.__AI_SUMMARY_RENDERED__`.

- [ ] **Step 1: Failing tests:** cached summary shown to logged-out visitor with label and personal prompt, with the cached `<a href="/album?q=…">` link intact; miss → today's prompt, `getArtistSummary` not called; flag off → today's output.
- [ ] **Step 2: Run, confirm failure.** **Step 3: Implement.** **Step 4: Run file + typecheck.**
- [ ] **Step 5: Commit** `Render cached artist summaries for every visitor`

### Task 5: Genre page renders cached summary

**Files:** Modify `apps/web/src/pages/genre/detail.tsx`; Test `apps/web/src/__tests__/handlers/genre-public-summary.test.ts`

**Interfaces:** `getCachedGenreSummary(slugToDisplayName(slug))` (the client sends the display name, so that is the cache key today). Prop `summaryHtml`; render inside `#genre-summary` with the label; the client script's early `return` for anonymous users stays, and signed-in users skip the fetch when `window.__AI_SUMMARY_RENDERED__` is true but still run `enrichLinks('genre-summary')`. The page keeps `noindex={!isCuratedGenre(slug)}`.

- [ ] **Step 1: Failing tests:** `/genre/shoegaze` with cached summary → shown to logged-out visitor, no `noindex`; `/genre/post-punk` with cached summary → shown but `noindex`; miss → today's prompt and `getGenreSummary` not called; flag off → today's output.
- [ ] **Step 2–4** as above.
- [ ] **Step 5: Commit** `Render cached genre summaries for every visitor`

### Task 6: Entity page index in D1

**Files:**
- Create: `packages/db/src/migrations/009_entity_pages.sql`
- Modify: `packages/db/src/index.ts`, `packages/db/src/schema.ts`
- Modify: `apps/web/src/api/internal/album.ts`, `apps/web/src/api/internal/artist.ts`
- Test: `apps/web/src/__tests__/handlers/entity-page-index.test.ts`

**Interfaces:**
- Migration:

```sql
CREATE TABLE IF NOT EXISTS entity_pages (
  cache_key TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('album', 'artist')),
  path TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- Produces on `Database`: `upsertEntityPage(page: { cacheKey: string; type: 'album' | 'artist'; path: string }): Promise<void>` (`INSERT … ON CONFLICT(cache_key) DO UPDATE SET path = excluded.path, updated_at = datetime('now')`) and `getEntityPages(): Promise<EntityPage[]>` where `EntityPage = { cache_key: string; type: 'album' | 'artist'; path: string; updated_at: string }`.
- `/album-summary` upserts `{ cacheKey: aiCacheKey('albumDetail', artist, name), type: 'album', path: '/album/' + spotifyId }` after a successful response; `/artist-summary` upserts `aiCacheKey('artistSummary', name)` with `/artist/<id>`. Run the upsert through `waitUntil` (see `getWaitUntil` in `index.tsx`) and log, never fail the request, if it rejects. The route already needs the Spotify ID; expose it from `resolveSpotifyAlbum`/`resolveSpotifyArtist` results if it isn't already there.

- [ ] **Step 1: Failing tests:** successful album summary → `upsertEntityPage` called with `ai:albumDetail:radiohead:ok computer` and `/album/<id>`; AI failure (500) → not called; upsert rejection → response still 200.
- [ ] **Step 2–4** as above, plus `pnpm --filter @listentomore/db typecheck`.
- [ ] **Step 5: Commit** `Record which page each album and artist summary belongs to`

### Task 7: Sitemap and robots.txt

**Files:**
- Create: `apps/web/src/sitemap.ts`
- Modify: `apps/web/src/index.tsx` (route `GET /sitemap.xml`), `apps/web/src/robots.ts`, `apps/web/src/__tests__/robots.test.ts`
- Test: `apps/web/src/__tests__/sitemap.test.ts`

**Interfaces:**
- Produces: `buildSitemap(input: { origin: string; cachedKeys: Array<{ name: string; expiration?: number }>; entityPages: EntityPage[] }): string`. Rules: album and artist keys (`ai:albumDetail:…`, `ai:artistSummary:…`) appear only when an `entity_pages` row has that `cache_key`; genre keys (`ai:genreSummary:<name>`) map to `/genre/<name with spaces as ->` and appear only if `isCuratedGenre`; `lastmod` is `expiration − getCacheTtlSeconds(task)` as `YYYY-MM-DD`, omitted when `expiration` is missing; static pages `/`, `/about`, `/tools`, `/genre`, `/discord`, `/privacy`, `/terms` always appear without `lastmod`; URLs XML-escaped; duplicates removed.
- Route: when `publicSummariesEnabled(c.env)`, list KV keys for the three prefixes (follow `cursor` until `list_complete`), read `getEntityPages()`, return `buildSitemap(...)` with `Content-Type: application/xml` and `Cache-Control: public, max-age=3600`. Flag off: static pages only.
- `robots.ts` regains `Sitemap: https://listentomore.com/sitemap.xml`; update the robots test so it now expects that line and still forbids `Crawl-delay`.

- [ ] **Step 1: Failing tests:**

```ts
it('lists a cached album only when its page is known');
it('lists curated genres and skips others', () => {
  // keys ai:genreSummary:shoegaze, ai:genreSummary:yvl → only /genre/shoegaze
});
it('sets lastmod to the write date', () => {
  // albumDetail expiration = Date.UTC(2027,2,1)/1000 → lastmod 2026-11-01 (120 days earlier)
});
it('always lists the static pages');
it('escapes XML');
```

- [ ] **Step 2–4** as above.
- [ ] **Step 5: Commit** `Publish a sitemap of pages with cached summaries`

### Task 8: Audit and backfill scripts

**Files:**
- Create: `apps/web/scripts/cached-summaries.ts` (subcommands `audit`, `refresh`, `backfill`)
- Create: `apps/web/scripts/cached-summaries-lib.ts` (pure functions)
- Test: `apps/web/src/__tests__/scripts/cached-summaries-lib.test.ts` (vitest only includes `src/**`; import the lib from `../../../scripts/cached-summaries-lib`)

**Interfaces:**
- Produces: `auditFlags(task: 'albumDetail' | 'artistSummary' | 'genreSummary' | 'albumRecommendations', text: string): string[]` returning any of `'empty'`, `'not-enough-information'`, `'short'` (under 200 characters for summaries, 100 for recommendations), `'no-final-punctuation'` (last non-space character not one of `. ! ? ) " ' * _ ]` or `}`), `'unbalanced-markdown'` (odd count of `**`, `[[`/`]]` or `{{`/`}}` mismatch), `'error-text'` (contains `error`, `unable to`, `I cannot` or `as an AI`, case-insensitive).
- Produces: `pickSpotifyMatch(wanted: { artist: string; album?: string }, results: Array<{ id: string; name: string; artist?: string }>): string | null`: exact match after lowercasing and trimming on both names, else `null`.
- CLI (run from `apps/web` with `pnpm dlx tsx scripts/cached-summaries.ts <cmd>`), shelling out to `npx wrangler kv key list|get|put|delete --namespace-id <CACHE id from wrangler.toml> --remote` and `npx wrangler d1 execute listentomore --remote`:
  - `audit` prints a Markdown table (key, task, write date, flags) to stdout and writes `eval-output/cached-summaries-audit.json`; changes nothing.
  - `refresh --approve <file>` reads a JSON list of keys to delete and deletes them, then re-puts every other summary key under the four tasks with its current value and `expirationTtl` = `getCacheTtlSeconds(task)`. Prints counts. Requires `--yes` to write; without it, prints what it would do.
  - `backfill` lists `albumDetail` and `artistSummary` keys, searches Spotify (client credentials from `.dev.vars`) by the names in each key, uses `pickSpotifyMatch`, and writes `eval-output/entity-pages-backfill.sql` of `INSERT OR IGNORE` rows plus a list of unmatched keys. Executes the SQL only with `--yes`.

- [ ] **Step 1: Failing tests** for `auditFlags` (one case per flag plus a clean summary returning `[]`) and `pickSpotifyMatch` (exact match, case-insensitive match, near-miss "OK Computer OKNOTOK" → `null`).
- [ ] **Step 2–4** as above.
- [ ] **Step 5: Commit** `Add audit, expiry refresh and backfill script for cached summaries`

### Task 9: Turn it on and document it

**Files:**
- Modify: `apps/web/wrangler.toml` (`[vars] PUBLIC_CACHED_SUMMARIES = "true"`)
- Modify: `docs/feature-gating.md` (new "Public when cached" section: which tasks, the flag, the no-generation rule, how to revert)
- Modify: `AGENTS.md` (one line under Key Constraints: anonymous requests never trigger summary generation; use the `getCached*` methods)

- [ ] **Step 1: Run the full suite and typecheck.** `pnpm test && pnpm typecheck`. Expected: all pass.
- [ ] **Step 2: Local check.** `pnpm dev`, then fetch an album, artist and genre page and `/sitemap.xml`; confirm pages render and the sitemap is valid XML (local KV is empty, so expect static pages only).
- [ ] **Step 3: Commit** `Turn on public cached summaries and document the gating change`

**Not in this plan (owner-gated rollout, done by the coordinator after review):** run `audit`, get the owner's approval on deletions, run `refresh --yes`, apply migration 009 with `npx wrangler d1 migrations apply listentomore --remote`, run `backfill --yes`, merge, deploy, then submit `/sitemap.xml` in Search Console and Bing Webmaster Tools and record the launch date and URL count.
