# lastfm-mcp Lookup Route, Tailored Sign-in and Click Measurement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A lastfm-mcp album or artist result links, via a name-based lookup route, to the matching ListenToMore page, which shows a Last.fm-specific sign-in prompt and records clicks and sign-ups per referrer.

**Architecture:** A new `/lookup` page route resolves names to a Spotify ID with its own strict match check, caches the result in KV, records a click row in D1 and redirects with `?ref=` carried through. Album and artist pages read `ref` to choose the sign-in copy; `/login` and the Last.fm auth handlers carry `ref` to user creation, which stores it in `users.signup_ref`. A script reads the counts. lastfm-mcp then adds one line linking to `/lookup`.

**Tech Stack:** Hono on Cloudflare Workers (TypeScript, Hono JSX), D1, KV, vitest; lastfm-mcp on vitest-pool-workers.

**Spec:** `docs/superpowers/specs/2026-11-09-lastfm-mcp-lookup-design.md` (read it before any task).

## Global Constraints

- listentomore: single Worker; no new Workers or services. 2-space indent, semicolons, single quotes, trailing commas, two `// ABOUTME:` lines on every new file, `import type` for types (`AGENTS.md`).
- Known referrer values: exactly `lastfm-mcp`. Any other `ref` value is ignored everywhere (not recorded, not forwarded, not stored).
- No new cookie for logged-out visitors. Attribution travels only in URLs.
- Click rows store no IP address, no user agent and no searched names.
- A wrong match is worse than a miss: when unsure, redirect to search.
- Anything new placed in an inline `<script>` must be escaped against `</script>`; the existing gap is out of scope.
- With `PUBLIC_CACHED_SUMMARIES` off, pages behave as before apart from the tailored copy.
- Commits on branch `feat/lastfm-mcp-lookup` in `~/git/listentomore`. Stage by explicit path, never `git add -A`; never `--amend`. Check `git branch --show-current` before each commit (another T3 thread may share this clone). Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Reviews after each task and on the whole branch: GPT 6 Astra, reasoning effort high, via T3 `delegate_task` (provider `codex`).
- No production step (migration, deploy, push to `main`, merge, release) without Rian's go.
- Run the web tests with `pnpm --filter @listentomore/web test` and typecheck with `pnpm --filter @listentomore/web typecheck`; don't pipe either through a filter (`set -o pipefail` if you must).

## Review Focus

1. A name with quotes, ampersands, slashes, accents or non-Latin script (`Guns N' Roses`, `AC/DC`, `"Heroes"`, `Sigur Rós`, `坂本龍一`) must resolve or miss cleanly, never 500 and never break the Spotify field-filter query. Task 4 tests a double quote in a name and a non-Latin name.
2. A `ref` value that isn't `lastfm-mcp` (`ref=evil`, `ref=<script>`, repeated `ref`) must be dropped at every hop: lookup, page, `/login`, `/auth/lastfm`, callback. Tasks 1, 5 and 6 test it.
3. A failed D1 click write or KV cache write must not change the redirect. Task 4 tests both.
4. A Spotify error (429, 5xx, timeout) during lookup must redirect to search and must not be cached as a miss. Task 4 tests a thrown 429.
5. A returning user who signs in with `ref=lastfm-mcp` must not get `signup_ref` written or a Discord sign-up message. Task 6 tests it.

---

### Task 1: Referral and bot helpers

**Files:**
- Create: `apps/web/src/utils/referral.ts`
- Test: `apps/web/src/__tests__/utils/referral.test.ts`

**Interfaces:**
- Produces:
  - `export const KNOWN_REFS = ['lastfm-mcp'] as const;`
  - `export type Ref = (typeof KNOWN_REFS)[number];`
  - `export function parseRef(value: string | null | undefined): Ref | null`
  - `export function isBotRequest(userAgent: string | null | undefined, cf?: { botManagement?: { verifiedBot?: boolean } } | null): boolean`

- [ ] **Step 1: Write the failing tests**

```typescript
describe('parseRef', () => {
  it('accepts lastfm-mcp', () => expect(parseRef('lastfm-mcp')).toBe('lastfm-mcp'));
  it.each([undefined, null, '', 'LASTFM-MCP', 'evil', '<script>', 'lastfm-mcp '])('rejects %s', (v) =>
    expect(parseRef(v)).toBeNull());
});

describe('isBotRequest', () => {
  it('flags a Cloudflare verified bot', () =>
    expect(isBotRequest('Mozilla/5.0', { botManagement: { verifiedBot: true } })).toBe(true));
  it.each([
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; Claude-User/1.0',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0',
    'Mozilla/5.0 (compatible; Perplexity-User/1.0)',
    'Mozilla/5.0 (compatible; OAI-SearchBot/1.0)',
    'Mozilla/5.0 (compatible; Googlebot/2.1)',
    'Mozilla/5.0 (compatible; bingbot/2.0)',
    'curl/8.4.0',
  ])('flags %s', (ua) => expect(isBotRequest(ua, null)).toBe(true));
  it('does not flag desktop Chrome', () =>
    expect(isBotRequest('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36', null)).toBe(false));
  it('treats a missing user agent as a bot', () => expect(isBotRequest(undefined, null)).toBe(true));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/utils/referral.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `apps/web/src/utils/referral.ts`**

`parseRef` is an exact, case-sensitive membership check. `isBotRequest` returns true when `cf?.botManagement?.verifiedBot === true`, when the user agent is missing or empty, or when it matches one case-insensitive regex covering `Claude-User`, `Claude-SearchBot`, `ClaudeBot`, `ChatGPT-User`, `OAI-SearchBot`, `GPTBot`, `Perplexity-User`, `PerplexityBot`, `Googlebot`, `bingbot`, `Applebot`, `DuckDuckBot`, `YandexBot`, `Discordbot`, `Slackbot`, `Twitterbot`, `facebookexternalhit`, `curl`, `wget`, `python-requests`, `node-fetch`, `undici`, and the generic tokens `bot`, `crawler`, `spider`.

- [ ] **Step 4: Run to verify they pass** (same command; expected PASS)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/utils/referral.ts apps/web/src/__tests__/utils/referral.test.ts
git commit -m "Add referral parsing and bot detection helpers"
```

### Task 2: Strict name matching for lookups

**Files:**
- Create: `apps/web/src/utils/lookup-match.ts`
- Test: `apps/web/src/__tests__/utils/lookup-match.test.ts`

**Interfaces:**
- Consumes: `AlbumSearchResult`, `ArtistSearchResult` types from `@listentomore/spotify` (`packages/services/spotify/src/search.ts:26-42`). `AlbumSearchResult.artist` is Spotify's artist names joined with `', '` (`search.ts:150`).
- Produces:
  - `export function normalizeName(name: string): string`
  - `export function stripEdition(title: string): string`
  - `export function pickAlbumMatch(candidates: AlbumSearchResult[], artist: string, album: string): AlbumSearchResult | null`
  - `export function pickArtistMatch(candidates: ArtistSearchResult[], artist: string): ArtistSearchResult | null`

- [ ] **Step 1: Write the failing tests**

Use a small `album(name, artist, id)` fixture builder.

```typescript
it('normalizes case, accents, punctuation, ampersands and a leading "The"', () => {
  expect(normalizeName('The Cure')).toBe(normalizeName('cure'));
  expect(normalizeName('Sigur Rós')).toBe('sigur ros');
  expect(normalizeName('Guns N’ Roses')).toBe(normalizeName("Guns N' Roses"));
  expect(normalizeName('Simon & Garfunkel')).toBe(normalizeName('Simon and Garfunkel'));
  expect(normalizeName('AC/DC')).toBe(normalizeName('ACDC'));
  expect(normalizeName('坂本龍一')).toBe('坂本龍一');
});
it('strips edition suffixes', () => {
  expect(stripEdition('OK Computer (Remastered 2009)')).toBe('OK Computer');
  expect(stripEdition('Rumours [Super Deluxe Edition]')).toBe('Rumours');
  expect(stripEdition('Hunky Dory - 2015 Remaster')).toBe('Hunky Dory');
  expect(stripEdition('Unplugged - Live')).toBe('Unplugged');
  expect(stripEdition('Abbey Road')).toBe('Abbey Road');
  expect(stripEdition('Songs: Ohia')).toBe('Songs: Ohia');
});
it('rejects a lone result by a different artist', () => {
  expect(pickAlbumMatch([album('Ritual', 'Some Other Band', 'x')], 'Jon Hopkins', 'Ritual')).toBeNull();
});
it('rejects a title that only contains the requested title', () => {
  expect(pickAlbumMatch([album('Voices 2', 'Max Richter', 'x')], 'Max Richter', 'Voices')).toBeNull();
});
it('prefers an exact title over an edition variant', () => {
  const r = pickAlbumMatch([album('Rumours (Super Deluxe)', 'Fleetwood Mac', 'deluxe'), album('Rumours', 'Fleetwood Mac', 'base')], 'Fleetwood Mac', 'Rumours');
  expect(r?.id).toBe('base');
});
it('matches an edition-suffixed request to the base album by the same artist', () => {
  expect(pickAlbumMatch([album('OK Computer', 'Radiohead', 'ok')], 'Radiohead', 'OK Computer (Remastered 2009)')?.id).toBe('ok');
});
it('matches when the requested artist is one of several credited artists', () => {
  expect(pickAlbumMatch([album('Watch the Throne', 'JAY-Z, Kanye West', 'wtt')], 'Kanye West', 'Watch the Throne')?.id).toBe('wtt');
});
it('matches an artist name containing a comma as a whole', () => {
  expect(pickAlbumMatch([album('Déjà Vu', 'Crosby, Stills, Nash & Young', 'dv')], 'Crosby, Stills, Nash & Young', 'Deja Vu')?.id).toBe('dv');
});
it('picks the artist whose normalized name matches, not the top hit', () => {
  const r = pickArtistMatch([{ name: 'Cure for Pain', id: 'a', url: '', image: null }, { name: 'The Cure', id: 'b', url: '', image: null }], 'The Cure');
  expect(r?.id).toBe('b');
});
it('returns null when no artist matches', () => {
  expect(pickArtistMatch([{ name: 'Cure for Pain', id: 'a', url: '', image: null }], 'The Cure')).toBeNull();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/utils/lookup-match.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `apps/web/src/utils/lookup-match.ts`**

`normalizeName`: NFKD, drop combining marks, lowercase, curly quotes to straight, `&` to ` and `, drop a leading `the `, remove every character that is not a letter or number in any script (`\p{L}\p{N}` with the `u` flag) except spaces, collapse whitespace, trim.

`stripEdition`: repeatedly remove a trailing `(...)` or `[...]` group, or a trailing ` - ...` segment, when it contains (case-insensitive) one of: `remaster`, `remastered`, `deluxe`, `edition`, `expanded`, `anniversary`, `bonus`, `version`, `reissue`, `mono`, `stereo`, `live`, `special`, `collector`. Leave anything else alone.

`pickAlbumMatch`: keep candidates whose artist matches (normalized `candidate.artist` equals normalized requested artist, or any of `candidate.artist.split(', ')` normalized equals it). Among those, return the first whose normalized name equals the normalized requested album; else the first whose `normalizeName(stripEdition(name))` equals `normalizeName(stripEdition(album))`; else `null`. No substring or prefix matching.

`pickArtistMatch`: first candidate whose normalized name equals the normalized requested artist, else `null`.

- [ ] **Step 4: Run to verify they pass** (same command; expected PASS)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/utils/lookup-match.ts apps/web/src/__tests__/utils/lookup-match.test.ts
git commit -m "Add strict artist and album name matching for lookups"
```

### Task 3: Migration 010 and database methods

**Files:**
- Create: `packages/db/src/migrations/010_referrals.sql`
- Modify: `packages/db/src/schema.ts` (`User`), `packages/db/src/index.ts` (`createUser` at `:64-80`, new method)
- Test: `apps/web/src/__tests__/services/referral-db.test.ts`

**Interfaces:**
- Produces:
  - Table `referral_clicks (id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('album','artist')), matched INTEGER NOT NULL, signed_in INTEGER NOT NULL, is_bot INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`, index `idx_referral_clicks_ref_created ON referral_clicks (ref, created_at)`.
  - Column `users.signup_ref TEXT` (nullable); `User.signup_ref: string | null`.
  - `Database.createUser(data)` accepts optional `signup_ref?: string` and inserts it.
  - `Database.recordReferralClick(click: { ref: string; type: 'album' | 'artist'; matched: boolean; signedIn: boolean; isBot: boolean }): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Use a fake `D1Database` whose `prepare(sql)` records the SQL and `bind(...args)` records the arguments, returning objects with `run`/`first`. Assert:

```typescript
it('inserts a referral click with booleans as 0/1 and no identifying fields', async () => {
  await db.recordReferralClick({ ref: 'lastfm-mcp', type: 'album', matched: true, signedIn: false, isBot: true });
  expect(lastSql).toMatch(/INSERT INTO referral_clicks \(ref, type, matched, signed_in, is_bot\)/);
  expect(lastBind).toEqual(['lastfm-mcp', 'album', 1, 0, 1]);
});
it('stores signup_ref when creating a user', async () => {
  await db.createUser({ id: 'u1', username: 'x', lastfm_username: 'X', signup_ref: 'lastfm-mcp' });
  expect(lastSql).toMatch(/signup_ref/);
  expect(lastBind).toContain('lastfm-mcp');
});
it('stores null signup_ref when none is given', async () => {
  await db.createUser({ id: 'u1', username: 'x', lastfm_username: 'X' });
  expect(lastBind).toContain(null);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/services/referral-db.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the migration and the methods**

Migration header comment in the style of `009_entity_pages.sql`, explaining that rows record lookup clicks from a referrer with no identifying data, and `signup_ref` records which referrer a new account came from.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/services/referral-db.test.ts && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Apply the migration locally**

Run (from `apps/web`): `npx wrangler d1 migrations apply listentomore --local`
Expected: `010_referrals.sql` applied. Do **not** run with `--remote`.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/migrations/010_referrals.sql packages/db/src/schema.ts packages/db/src/index.ts apps/web/src/__tests__/services/referral-db.test.ts
git commit -m "Add referral_clicks table and users.signup_ref"
```

### Task 4: The `/lookup` route

**Files:**
- Create: `apps/web/src/pages/lookup.ts`
- Modify: `packages/services/spotify/src/index.ts` (new method), `apps/web/src/index.tsx` (route next to the album routes at `:652`), `apps/web/src/robots.ts`
- Test: `apps/web/src/__tests__/handlers/lookup.test.ts`, `apps/web/src/__tests__/robots.test.ts`

**Interfaces:**
- Consumes: `parseRef`, `isBotRequest` (Task 1); `pickAlbumMatch`, `pickArtistMatch`, `normalizeName`, `stripEdition` (Task 2); `Database.recordReferralClick` (Task 3); `createServiceDefer` from `@listentomore/shared` and `getWaitUntil` from `utils/wait-until.ts`, as `middleware/auth.ts:200-212` uses them.
- Produces:
  - `SpotifyService.searchCandidates<T extends SearchType>(query: string, type: T, limit: number)`, delegating to `SpotifySearch.search` (already KV-cached per query).
  - `export async function handleLookup(c: Context): Promise<Response>`, registered as `app.get('/lookup', handleLookup)`.
  - URL contract used by lastfm-mcp (Task 10): `GET /lookup?artist=<name>[&album=<name>][&ref=lastfm-mcp]`.

**Behaviour:**
- `artist` missing, blank, or either name over 300 characters → `400` plain text.
- Lookup cache: KV `CACHE`, key `lookup:v1:album:<normalizeName(artist)>|<normalizeName(stripEdition(album))>` or `lookup:v1:artist:<normalizeName(artist)>`, value `{"id":"<spotifyId>"}` (TTL 30 days) or `{"miss":true}` (TTL 1 day). A cached value skips Spotify.
- Album candidates, stopping at the first that `pickAlbumMatch` accepts: (1) `artist:"A" album:"B"` limit 10; (2) the same with `stripEdition(album)` when it differs; (3) natural `A B` limit 10. Before building a field filter, remove `"` from both names. Artist: `searchCandidates(artist, 'artist', 10)` then `pickArtistMatch`.
- Match → `302` to `/album/<id>` or `/artist/<id>`, plus `?ref=lastfm-mcp` only when `parseRef` accepts the ref.
- No match → cache the miss, `302` to `/album?q=<artist> <album>` or `/artist?q=<artist>` (URL-encoded), with no `ref`.
- Spotify throws → log with `console.error('[Lookup] ...')`, `302` to the search URL, cache nothing.
- Every response sets `X-Robots-Tag: noindex` and `Cache-Control: no-store`.
- When `parseRef` accepts the ref, record one click through `createServiceDefer('[Lookup]', getWaitUntil(c))(db.recordReferralClick({...}), 'referral click')` with `matched`, `signedIn: Boolean(c.get('currentUser'))`, `isBot: isBotRequest(c.req.header('User-Agent'), c.req.raw.cf as ...)`. No click is recorded for an unknown or missing ref.
- KV read/write failures are logged and treated as a cache miss/no-op.

- [ ] **Step 1: Write the failing tests**

Build the app as `album-public-summary.test.ts` does, with `spotify = { searchCandidates: vi.fn() }`, `db = { recordReferralClick: vi.fn().mockResolvedValue(undefined) }`, `createMockKV()` from `__tests__/utils/mocks.ts` passed as `env.CACHE`, and `currentUser` settable. Tests:

```typescript
it('redirects a matched album to its page with ref', ...)              // 302, Location '/album/<id>?ref=lastfm-mcp'
it('redirects a matched artist to its page', ...)                     // /artist/<id>?ref=lastfm-mcp
it('drops an unknown ref and records no click', ...)                  // ref=evil → Location has no ref; recordReferralClick not called
it('redirects a miss to the search page and caches the miss', ...)    // Location '/album?q=Jon%20Hopkins%20Nonexistent'; second request makes no Spotify call
it('serves a cached hit without calling Spotify', ...)
it('retries with the edition stripped before the natural query', ...) // 'OK Computer (Remastered 2009)' → second call's query is artist:"Radiohead" album:"OK Computer"
it('removes double quotes from field filters', ...)                   // album '"Heroes"' → query contains album:"Heroes" with no inner quotes
it('resolves a non-Latin artist name', ...)                           // '坂本龍一' candidate named '坂本龍一' → /artist/<id>
it('returns 400 when artist is missing or blank', ...)
it('returns 400 when a name is over 300 characters', ...)
it('redirects to search and caches nothing when Spotify throws a 429', ...)
it('still redirects when the click write rejects', ...)               // recordReferralClick rejects → 302 unchanged
it('still redirects when the KV write throws', ...)
it('records matched, signed-in and bot flags', ...)                   // UA 'Claude-User' → isBot true; currentUser set → signedIn true
it('sets noindex and no-store headers', ...)
```

In `robots.test.ts` add: `it('disallows /lookup for every crawler', () => expect(ROBOTS_TXT).toMatch(/User-agent: \*[\s\S]*Disallow: \/lookup/))`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/handlers/lookup.test.ts src/__tests__/robots.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `searchCandidates`, `handleLookup`, the route, and `Disallow: /lookup`** (in the `User-agent: *` group, after `Disallow: /api/`)

- [ ] **Step 4: Run the full web suite and typecheck**

Run: `pnpm --filter @listentomore/web test && pnpm typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/lookup.ts apps/web/src/index.tsx apps/web/src/robots.ts packages/services/spotify/src/index.ts apps/web/src/__tests__/handlers/lookup.test.ts apps/web/src/__tests__/robots.test.ts
git commit -m "Add /lookup route that resolves names to album and artist pages"
```

### Task 5: Last.fm sign-in prompt on album and artist pages

**Files:**
- Modify: `apps/web/src/components/ui/SignInCTA.tsx`, `apps/web/src/components/ui/SignInGate.tsx`, `apps/web/src/pages/album/detail.tsx` (`:96-178`, handler `:282-`), `apps/web/src/pages/artist/detail.tsx` (`:78-140`, handler `:320-`)
- Test: `apps/web/src/__tests__/components/ui/sign-in-cta.test.ts` (create), `apps/web/src/__tests__/handlers/album-public-summary.test.ts`, `apps/web/src/__tests__/handlers/artist-public-summary.test.ts`

**Interfaces:**
- Consumes: `parseRef`, `Ref` (Task 1).
- Produces:
  - `SignInCTAVariant = 'unlock' | 'personal' | 'lastfm-mcp'`.
  - `SignInCTAProps` gains `entity?: 'album' | 'artist'` (used by `'lastfm-mcp'`; defaults to `'album'`) and `signInRef?: Ref`. When `signInRef` is set, the login URL is `/login?next=<encoded path>&ref=<ref>`.
  - `SignInGateProps` gains optional `variant`, `entity` and `signInRef`, passed through to `SignInCTA`.
  - Album and artist page props gain `signInRef?: Ref | null`; handlers set it from `parseRef(c.req.query('ref'))`.

**Copy for `'lastfm-mcp'` (Rian reviews the wording in the PR):**
- Heading: `You already use Last.fm`
- Line under the heading: `Sign in with it to get more from ListenToMore:`
- Bullets when the page did **not** render a summary: `The AI summary and recommendations for this {entity}`, `Recommendations based on what you play`, `Your listening stats and weekly insights`.
- Bullets when the page rendered a cached summary: `Recommendations based on what you play`, `Your listening stats and weekly insights`, `A public profile page`.
- Button: `Sign in with Last.fm`.

Pass a `summaryShown?: boolean` prop to pick the bullet list.

- [ ] **Step 1: Write the failing tests**

`sign-in-cta.test.ts` (render with `toString()` on the JSX, as other component tests do):
```typescript
it('shows the Last.fm heading and the album summary bullet', ...)   // 'You already use Last.fm', 'The AI summary and recommendations for this album'
it('omits the summary bullet when a summary is shown', ...)
it('says artist on artist pages', ...)                              // 'for this artist'
it('adds ref to the login link', ...)                               // href '/login?next=%2Falbum%2Fabc&ref=lastfm-mcp'
it('keeps existing variants unchanged', ...)                        // 'unlock' and 'personal' headings as before, no &ref
```
In the album and artist public-summary tests add:
```typescript
it('shows the Last.fm prompt in the summary slot for ?ref=lastfm-mcp with no cached summary', ...)
it('shows the summary and the Last.fm prompt for ?ref=lastfm-mcp with a cached summary', ...)
it('shows the default prompt for an unknown ref', ...)            // ?ref=evil → 'Sign in to unlock more'
it('shows no prompt to a signed-in visitor with ref', ...)
it('keeps ref out of the canonical URL', ...)                       // <link rel="canonical" href="https://listentomore.com/album/<id>">
it('shows the Last.fm prompt with the flag off', ...)               // ?ref=lastfm-mcp, flag off → 'You already use Last.fm'
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/components/ui/sign-in-cta.test.ts src/__tests__/handlers/album-public-summary.test.ts src/__tests__/handlers/artist-public-summary.test.ts`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

On each page: when `signInRef === 'lastfm-mcp'` and there is no `currentUser`, use variant `'lastfm-mcp'` (with `entity`, `summaryShown` and `signInRef`) wherever the page now renders `SignInCTA` or `SignInGate`. Otherwise render exactly what it renders today.

- [ ] **Step 4: Run the full web suite and typecheck** (as Task 4 Step 4)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui/SignInCTA.tsx apps/web/src/components/ui/SignInGate.tsx apps/web/src/pages/album/detail.tsx apps/web/src/pages/artist/detail.tsx apps/web/src/__tests__/components/ui/sign-in-cta.test.ts apps/web/src/__tests__/handlers/album-public-summary.test.ts apps/web/src/__tests__/handlers/artist-public-summary.test.ts
git commit -m "Show a Last.fm sign-in prompt to visitors from lastfm-mcp"
```

### Task 6: Carry `ref` through sign-in and store it on new users

**Files:**
- Modify: `apps/web/src/pages/auth/login.tsx` (`:11-16`, `:93-95`), `apps/web/src/pages/auth/lastfm.ts` (`:24-45` start, `:51-` callback, `:131-145` create and Discord)
- Test: `apps/web/src/__tests__/handlers/auth-referral.test.ts` (create)

**Interfaces:**
- Consumes: `parseRef` (Task 1); `createUser({... signup_ref })` (Task 3).
- Produces: the URL chain `/login?next=<p>&ref=lastfm-mcp` → `/auth/lastfm?next=<p>&ref=lastfm-mcp` → Last.fm `cb=<origin>/auth/lastfm/callback?next=<p>&ref=lastfm-mcp` → `createUser({ ..., signup_ref: 'lastfm-mcp' })`.

- [ ] **Step 1: Write the failing tests**

Mock `fetch` for the Last.fm session call (see `__tests__/utils/mocks.ts` `setupFetchMock`) and a `db` with `getUserByLastfmUsername`, `createUser`, `updateUser` and session creation as `lastfm.ts` uses them.
```typescript
it('login page forwards a known ref to /auth/lastfm', ...)          // link href contains '&ref=lastfm-mcp'
it('login page drops an unknown ref', ...)
it('auth start puts ref on the callback URL', ...)                  // Location's cb param decodes to '...callback?next=%2Falbum%2Fx&ref=lastfm-mcp'
it('auth start forwards ref with no next', ...)                     // cb '...callback?ref=lastfm-mcp'
it('auth start drops an unknown ref', ...)
it('callback stores signup_ref on a new user', ...)                 // createUser called with signup_ref 'lastfm-mcp'
it('callback stores no signup_ref for an unknown ref', ...)         // signup_ref undefined
it('callback does not write signup_ref for a returning user', ...)  // existing user → createUser not called, updateUser args have no signup_ref
it('Discord message names the referrer for a new user', ...)        // body contains '(via lastfm-mcp)'
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/handlers/auth-referral.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Build the callback URL with `URLSearchParams` so `next` and `ref` combine correctly. Discord content for a new user with a ref: `` `🎉 New signup: **${username}** (via ${signupRef}) — https://listentomore.com/u/${username}` ``.

- [ ] **Step 4: Run the full web suite and typecheck** (as Task 4 Step 4)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/auth/login.tsx apps/web/src/pages/auth/lastfm.ts apps/web/src/__tests__/handlers/auth-referral.test.ts
git commit -m "Carry the referrer through sign-in and record it on new users"
```

### Task 7: Referral report script

**Files:**
- Create: `apps/web/scripts/referral-report-lib.ts`, `apps/web/scripts/referral-report.ts`
- Test: `apps/web/src/__tests__/scripts/referral-report-lib.test.ts`

**Interfaces:**
- Produces:
  - `export function buildReferralReportSql(ref: Ref, from: string, to: string): string[]`: two `SELECT`s, one over `referral_clicks` (counts: total, matched, missed, human = `is_bot = 0`, bot) and one over `users` (count where `signup_ref = ref`), both with `created_at >= from AND created_at < to`. `from`/`to` are `YYYY-MM-DD`; reject anything else by throwing.
  - `export function formatReferralReport(input: { ref: string; from: string; to: string; clicks: { total: number; matched: number; missed: number; human: number; bot: number }; signups: number }): string`: plain text, one figure per line, ending with `Conversion (sign-ups ÷ human clicks, counts requests not people): <pct or "n/a">`.
  - CLI: `pnpm dlx tsx scripts/referral-report.ts [--ref lastfm-mcp] [--from YYYY-MM-DD] [--to YYYY-MM-DD]` from `apps/web`; defaults `lastfm-mcp`, the last 30 days. Runs each SQL through `npx wrangler d1 execute listentomore --remote --json --command <sql>`, like `scripts/cached-summaries.ts`.

- [ ] **Step 1: Write the failing tests**

```typescript
it('builds date-bounded queries for the ref', ...)          // both SQL strings contain "'lastfm-mcp'", "'2026-11-01'", "'2026-12-01'"
it('rejects malformed dates', ...)                          // "2026-11-01' OR 1=1" throws
it('formats conversion as a percentage of human clicks', ...) // human 40, signups 2 → '5.0%'
it('prints n/a when there are no human clicks', ...)
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/scripts/referral-report-lib.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the lib and CLI.** The CLI header comment gives usage and says it reads production D1.

- [ ] **Step 4: Run the tests (PASS), then a local smoke run**

Run (from `apps/web`) each string from `buildReferralReportSql('lastfm-mcp', '2026-11-01', '2026-12-01')` with `npx wrangler d1 execute listentomore --local --command "<sql>"`.
Expected: zero counts and no SQL errors against the locally migrated DB.

- [ ] **Step 5: Commit**

```bash
git add apps/web/scripts/referral-report-lib.ts apps/web/scripts/referral-report.ts apps/web/src/__tests__/scripts/referral-report-lib.test.ts
git commit -m "Add referral report script for lookup clicks and sign-ups"
```

### Task 8: Privacy page and data inventory

**Files:**
- Modify: `docs/privacy-data-inventory.md` (§1 user columns, new rows in §5-style table or a new §11 `referral_clicks`), `apps/web/src/pages/legal/privacy.tsx` (§1 "What I store when you sign in", §2 "Sessions, cookies, and logs", effective date)
- Test: `apps/web/src/__tests__/pages/privacy.test.ts`

**Interfaces:** none.

- [ ] **Step 1: Write the failing tests**

```typescript
it('says a lastfm-mcp link click is recorded without IP or browser details', ...)  // text contains 'lastfm-mcp' and 'not your IP address'
it('says a new account records that it came from lastfm-mcp', ...)
it('still says the site sets no cookie if you never sign in', ...)
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/pages/privacy.test.ts`
Expected: the new tests FAIL.

- [ ] **Step 3: Write the copy**

Plain first person, current behaviour only (2026-11-08 privacy decision). Substance: following a ListenToMore link from lastfm-mcp records the time, whether it was an album or artist, whether a match was found, whether you were signed in and whether the request looked like a bot, and nothing else (not your IP address, browser or what was looked up); if you then create an account, the account records that it came from lastfm-mcp. Inventory rows cite file:line for the writes (`pages/lookup.ts`, `pages/auth/lastfm.ts`, `packages/db/src/index.ts`) and the migration. Update the effective date to the day this is written and the existing effective-date test with it.

- [ ] **Step 4: Run the full web suite and typecheck** (as Task 4 Step 4)

- [ ] **Step 5: Commit**

```bash
git add docs/privacy-data-inventory.md apps/web/src/pages/legal/privacy.tsx apps/web/src/__tests__/pages/privacy.test.ts
git commit -m "Describe referral clicks and signup_ref in the privacy policy"
```

### Task 9: Branch review, local check and production rollout (coordinator, gated on Rian)

Not for an implementer subagent.

- [ ] **Step 1:** Whole-branch review by GPT 6 Astra (high); fix findings; re-review if anything changed.
- [ ] **Step 2: Local check.** `pnpm dev` with `.dev.vars`; in Chrome open `http://localhost:8787/lookup?artist=Radiohead&album=OK%20Computer&ref=lastfm-mcp`, signed out. Expect the album page with the Last.fm prompt, and a row in local `referral_clicks`. Follow the button to `/login` and check the `ref` in the sign-in link. Then Rian looks at the prompt and approves the copy.
- [ ] **Step 3:** Push the branch and open the PR (Rian's go). Merge after Rian says "merge it".
- [ ] **Step 4:** With Rian's go: `npx wrangler d1 migrations apply listentomore --remote` (from `apps/web`), then `pnpm --filter @listentomore/web run deploy`; confirm with `wrangler deployments list`.
- [ ] **Step 5: Firewall test on production.** Request `/lookup` for each of: `Sigur Rós`, `Hermanos Gutiérrez` / `Sonido Cósmico`, `Bon Iver` / `i,i`, `Songs: Ohia`, `AC/DC`, `Guns N' Roses`, `David Bowie` / `"Heroes"`, `坂本龍一`, `Pink Floyd` / `The Dark Side of the Moon`, `Weezer` / `Pinkerton (Deluxe Edition)`, `SELECT` / `DROP TABLE`, from a browser (Chrome) or with the `Discordbot` user agent. Expect `302` for each (a miss → search page is fine). Then query Security Events for `/lookup` in the window (`firewallEventsAdaptiveGroups` via GraphQL, as in `corrections/workers-platform.md`). Any block → stop and bring options to Rian; change no firewall rule without his approval.
- [ ] **Step 6:** `pnpm dlx tsx scripts/referral-report.ts --from <today> --to <tomorrow>` against production shows the test clicks (all flagged as bots if sent with `Discordbot`).

### Task 10: lastfm-mcp link line (after Task 9 passes)

Repo `~/git/lastfm-mcp`, new branch `feat/listentomore-link` from up-to-date `main`. Follow its `AGENTS.md`: tabs, no semicolons, single quotes, 140 columns, two `ABOUTME` lines, Node 22.

**Files:**
- Create: `src/utils/listentomore-link.ts`, `test/utils/listentomore-link.test.ts`
- Modify: `src/mcp/tools/public.ts` (`get_artist_info` text at `:173-192`, `get_album_info` text at `:233-255`); for the release: `package.json`, `package-lock.json`, `src/mcp/protocol.ts` (`SERVER_VERSION` → `2.8.0`)

**Interfaces:**
- Consumes: the URL contract from Task 4.
- Produces: `export function buildListenToMoreLine(entity: { type: 'album'; artist: string; album: string } | { type: 'artist'; artist: string }): string`

- [ ] **Step 1: Write the failing tests**

```typescript
it('links an album through the lookup route with ref', () => {
	expect(buildListenToMoreLine({ type: 'album', artist: 'Radiohead', album: 'OK Computer' })).toBe(
		'**ListenToMore:** streaming links and an AI summary for this album → https://listentomore.com/lookup?artist=Radiohead&album=OK+Computer&ref=lastfm-mcp',
	)
})
it('links an artist', () => {
	expect(buildListenToMoreLine({ type: 'artist', artist: 'Sigur Rós' })).toBe(
		'**ListenToMore:** streaming links and an AI summary for this artist → https://listentomore.com/lookup?artist=Sigur+R%C3%B3s&ref=lastfm-mcp',
	)
})
it('encodes ampersands, slashes and quotes', () => {
	expect(buildListenToMoreLine({ type: 'album', artist: 'AC/DC', album: 'Rock & "Roll"' })).toContain('artist=AC%2FDC&album=Rock+%26+%22Roll%22')
})
```

- [ ] **Step 2: Run to verify they fail:** `npx vitest run test/utils/listentomore-link.test.ts` → FAIL.
- [ ] **Step 3: Implement** with `URLSearchParams`. In `public.ts`, add the line after the `**Description:**`/`**Bio:**` block and before the sign-in note and `${nextSteps}`, using `data.album.name` with `albumArtist`, and `data.artist.name`. Nothing in `buildNextSteps`, the server instructions or other tools changes.
- [ ] **Step 4:** `npm test`, `npm run lint`, `npm run format:check`, `npm run build` all pass. If the server snapshot changes, the only diff allowed is the version.
- [ ] **Step 5: Commit** (`git add` the explicit paths; message `feat(tools): link album and artist results to ListenToMore`), then the version bump as its own commit (`chore(release): bump version to 2.8.0`).
- [ ] **Step 6 (gated):** Astra (high) review; push and open the PR; Rian merges (merge deploys production). Then tag the merge commit and create release `lastfm-mcp v2.8.0 — <tagline>` with `<!-- skip-elezea-post -->`; show Rian the release text first.

### Task 11: elezea.com slug links (independent of Task 10; after Task 9 Step 4)

Repo `~/git/elezea.com`, new branch `fix/listentomore-slug-links` from up-to-date `main`. Read its `AGENTS.md` first. A push to `main` deploys production.

- [ ] **Step 1:** List the 17 links: `/usr/bin/grep -n -o 'listentomore.com/album/[^)"]*_[^)" ]*' src/content/posts/my-2024-in-music.md src/content/posts/the-cure-deliver-the-power-doom-epic-weve-been-waiting-for.md`. Expected: 16 + 1.
- [ ] **Step 2:** For each, write the artist and album names by hand from the post text, resolve them through production `/lookup` (Chrome) or a scratchpad script using listentomore's Spotify credentials, and record slug → Spotify ID → Spotify album name in a table in the session scratchpad.
- [ ] **Step 3:** Rian checks the table. Any row that didn't resolve or looks wrong gets an ID he picks.
- [ ] **Step 4:** Replace each link with `https://listentomore.com/album/<spotifyId>`; grep again expecting 0 slug links; `npm run check`, `npm test`, `npm run build:prod` pass.
- [ ] **Step 5 (gated):** commit by explicit path, push, open the PR; Rian merges.
