# Insights Trivia Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship note prompt variant C with the round-2 guard fixes, a `release_week` week fact from Spotify release dates, and a "Did you know" card under the note that shows a code-rendered credits tie-back from MusicBrainz or, failing that, a cited making-of fact from web search.

**Architecture:** Variant C, the guard fixes and the 72-hour "after" edge land in the existing note files. Release dates come from an injected `ReleaseLookup` the collector calls for the owner only. The card is a second internal route that reads the cached `WeekFacts`, never computes them, and owns a per-profile cache. Candidates, tie-back selection and templates are pure code in `@listentomore/insights`; the MusicBrainz credits client is budgeted and globally cached; the making-of fact is an uncached AI task whose cache, rubric and retry live in the web app, the split the note already uses. Card generation is a Node-safe module the eval can import; the Worker-only limiter adapter stays out of its import graph.

**Tech Stack:** TypeScript strict, Hono on Cloudflare Workers, Workers KV, the `MUSICBRAINZ_RATE_LIMITER` Durable Object, Vitest (Node environment), pnpm + Turborepo, Claude Opus 5.5 with the basic `web_search_20250305` tool, Spotify search through `SpotifyService`.

**Spec:** `docs/superpowers/specs/2026-11-10-insights-trivia-card-design.md`. Experiment commits to port, read-only, from the local branch `insights-prompt-experiment` (based on `fa3ba2e`, this branch's base): `17ed7c7` (keep only its 6-sentence cap), `0450d45` (prompt C), `837623f` (guard idioms), `eb04be9` (albumTrivia, `standoutAlbum`, `insights-eval --trivia`, per-task `max_uses`).

## Global Constraints

- Follow `AGENTS.md`: `// ABOUTME:` 2-line header on new files, 2-space indent, single quotes, semicolons, trailing commas, `import type` for type-only imports, the standard error-handling pattern, `{ data }` / `{ error }` responses.
- Single Worker. No new services, background jobs, queues, cron triggers or polling.
- Cache TTLs come from `packages/config/src/cache.ts` through `getTtlSeconds()`; never hardcode a TTL. Never cache an AI response without `isCacheableResponse()`.
- The profile-visibility check runs before any cache read on every insights request, the card route included.
- The full `WeekFacts` object and prompt views never appear in an HTTP response; only the intended note and card response fields do. WeekFacts, prompt views, note text and card text never appear in a log line. Guard failures are logged as categorical codes only, through the existing `logSafeFailures`. New log lines on the insights path carry no artist, album, person or band name, no fact text, no upstream error body and no URL with a name in it.
- Only the owner's view may start card generation: MusicBrainz calls, Spotify release-date and album-art lookups, and the web-search call. A visitor reads cached results or gets nothing.
- Every user-visible string passes `~/git/product-ai/01-context/avoid-ai-patterns.md`: no em dashes, no negation-contrast (including "rather than", "instead of", "not only"), none of the listed overused words, no announcing preambles. Tests check new copy with `checkCopyRubric` (Task 4).
- Salience values change only with an `insights-eval` run. `release_week` starts at 70, plus 10 on the release day, judged in Task 10.
- Work on branch `insights-trivia-card` in the main clone (`/Users/rian/git/listentomore`). No worktrees.
- Stage files by explicit path. Never `git add -A`, `git commit --amend` or `git stash`. Every commit: `git commit -m "<subject>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`.
- Do not push, deploy or run a production migration. The live eval (Task 10) spends real money and never runs in CI. `pnpm typecheck` and `pnpm test` pass after every task.

## Review Focus

1. **Credit names with diacritics or punctuation.** MusicBrainz writes "Justin Meldal‐Johnsen" with U+2010 and "Tom Petty and the Heartbreakers"; Last.fm keys may carry an ASCII hyphen, "&" or no accents. A person expects the band they play to be found. Task 6 test `matches library names across U+2010 hyphens, accents and "&"`.
2. **A visitor opens the page before the owner has a card.** A person expects no card, no gap, and no MusicBrainz, Spotify, model or Last.fm call on their behalf. Task 8 test `a visitor gets data: null and starts nothing when no card is cached`.
3. **The 10-call cap runs out in the middle of an album.** A person expects no card this load, no result pinned for the week, and the next load to continue from the cached credits. Task 8 test `a cap hit mid-album returns null, caches no card and keeps the fetched credits`.
4. **An album with no MusicBrainz release group** (a mixtape, a bootleg, a title MusicBrainz spells another way). A person expects the card to move on and the miss not to be asked again every load. Task 3 test `caches a search with no release group as a miss and spends no call on the next lookup`; Task 8 test `moves past a candidate with no release group`.
5. **A Spotify search that returns another edition or another record** ("Eternal Embers (Deluxe Edition)", "Eternal Embers Live"). A person expects no release-week claim from that date. Task 2 test `skips a Spotify match whose title is another edition or another record`.

---

## File Structure

New files, each with one job (every task's Files block lists the edits to existing ones):

- `packages/services/insights/src/`: `match.ts` name keys and edition markers (T2); `facts-release.ts` the `release_week` rule (T2); `rubric.ts` the note and copy rubrics (T4); `standout.ts` and `card-albums.ts` card candidates and signature (T5); `tieback.ts` library matching, tie-backs and templates (T6).
- `packages/services/musicbrainz/src/`: `credits-types.ts`, `credits-parse.ts` (pure), `credits.ts` (budgeted, cached client) (T3); `packages/services/ai/src/prompts/album-trivia.ts`, the uncached albumTrivia task (T7).
- `apps/web/src/`: `api/internal/insights-making-of.ts`, the cached, rubric-checked fact (T7); `api/internal/insights-card.ts`, Node-safe card generation and rendering (T8); `api/internal/insights-card-route.ts`, its Worker wiring (T8); `utils/musicbrainz-limiter.ts`, the Node-safe limiter adapter (T8).

---

### Task 1: Note variant C, guard fixes and the 72-hour "after" edge

**Files:**
- Modify: `packages/services/ai/src/prompts/user-insights-note.ts`, `packages/services/insights/src/guard.ts`, `facts-shared.ts:11,51-58`, `types.ts:83`, `apps/web/src/api/internal/insights-week.ts:63` (comment), `docs/how-to/ai-models.md:37`
- Test: `packages/services/insights/__tests__/guard.test.ts`, `facts-artist.test.ts:226-238`, `facts-album.test.ts:64,117-130`; `apps/web/src/__tests__/services/ai.test.ts`, `handlers/insights-week.test.ts:644-665`

**Interfaces:**
- Produces: `USER_INSIGHTS_PROMPT_VERSION = 'v7'`; `RULE_VERSION = 'r2'`; guard code `'shape:lead'` (no sentence prefix) when no sentence cites fact 1; `parseNoteSentences` keeps `facts: []`.

- [ ] **Step 1: Check the branch.** `git branch --show-current` prints `insights-trivia-card`; `git status --short` shows no tracked changes.

- [ ] **Step 2: Apply the experiment commits.** `git diff fa3ba2e 837623f | git apply`. Expected: applies cleanly to `ai.test.ts`, `user-insights-note.ts`, `guard.test.ts`, `guard.ts` (prompt C, `MAX_SENTENCES = 6`, the idioms). Set the version to `'v7'` in the prompt and in the `exposes a bumped prompt version` test.

- [ ] **Step 3: Write the failing tests**, each with its assertion (`guard.test.ts` helpers `S1`, `S2`, `say`, `jazz`, `shoegaze`, `returns`):
- `accepts fact 1 cited by any sentence, and fails a note where no sentence cites it` (replaces the `'s1:shape:lead'` case): `guardNote([S2, S1], may24)` is `{ ok: true, failures: [] }`; `[S2, say('Tracy Chapman came back too.', returns)]` fails with exactly `['shape:lead']`.
- `accepts the plural first-plays phrases only for two or more first-under-this-name artists`: "Slow Crush, NRTHRN and Spotlight Kid got their first plays under these names." and "... got first plays under those names." citing `shoegaze` pass; "Grant Green got his first plays under these names." citing `jazz` fails with `['s2:banned:first-plays']`. `reads "a week already full of" and "a day full of" as figures of speech`: "It was a week already full of returns, with Tracy Chapman back on 13 plays." and "Tracy Chapman made it a day full of returns." citing `returns` pass; "Tracy Chapman came back after a week out of rotation." fails with `['s2:quantity:1:weeks']`.
- `fails only the uncited sentence when one sentence cites nothing`: `guardNote([S1, { ...S2, facts: [] }], may24).failures` contains `'s2:shape:uncited'` and every code starts with `'s2:'`. `ai.test.ts`: delete the `"facts": []` → `null` expectation; add `keeps a sentence with an empty facts list`: `parseNoteSentences('[{"text": "One.", "facts": [1]}, {"text": "Two.", "facts": []}]')` equals `[{ text: 'One.', facts: [1] }, { text: 'Two.', facts: [] }]`.
- `facts-artist.test.ts` replaces the 36-hour case with `no "after" edge unless plays span 2+ days and end 72+ hours before the window end` (window ends Sun Nov 8 21:17 UTC): 12 plays Mon Nov 2 10:00 plus 12 Thu Nov 5 10:00 give `[{ kind: 'after', text: 'What happened with Meltt after Thu Nov 5?' }]` (82.5 h); the same with Fri Nov 6 10:00 gives `[]` (58.5 h, an edge under the old rule).
- `facts-album.test.ts`: the same pair for `repeat_album` (`'What happened with Eternal Embers after Thu Nov 5?'`, then `[]`). `insights-week.test.ts`: the `logSafeFailures` cases read `'shape:lead'` for `'s1:shape:lead'`, input and expectation.

- [ ] **Step 4: Run to verify they fail.** `pnpm --filter @listentomore/insights test`; `pnpm --filter @listentomore/web exec vitest run src/__tests__/services/ai.test.ts src/__tests__/handlers/insights-week.test.ts`. Expected: the new cases FAIL.

- [ ] **Step 5: Implement.**
  - `guard.ts`: for a non-empty note, push `'shape:lead'` unless `ctx.view.has(LEAD_FACT_ID)` and some sentence cites it. `PLURAL_FIRST_PLAYS = ['first plays under these names', 'first plays under those names']`, allowed when the cited facts passing `isFirstUnderThisName` contain `FIRST_UNDER_THIS_NAME` two or more times in total. `ARTICLE_UNIT`'s lookahead becomes `(?! (?:(?:already|so|completely|mostly|full|made|up) ){0,2}of\b)`. Doc comment: "two to six sentences, some sentence citing fact 1".
  - `user-insights-note.ts`: `toNoteSentences` accepts an empty `facts` array of integers.
  - `facts-shared.ts`: `QUIET_GAP_SECONDS = 72 * 3600`. `types.ts`: `RULE_VERSION = 'r2'`; Tasks 2 and 5 change `WeekFacts` again, and since nothing ships between tasks they keep `'r2'`. `docs/how-to/ai-models.md:37`: "four to six sentences".

- [ ] **Step 6: Run the full suites.** `pnpm test`, `pnpm typecheck`. Update a fixture expectation elsewhere only when the 72-hour edge or the version explains the move, and name it in the commit body; anything else stops the task and is reported.

- [ ] **Step 7: Dry-run the eval.** From `apps/web`: `pnpm dlx tsx scripts/insights-eval.ts --label v7-dry --dry-run`. Expected: a call count and projection, no API call.

- [ ] **Step 8: Commit** the files above, plus any test file Step 6 changed, by path: `"Ship note variant C with the round-2 guard fixes and a 72-hour after edge"`.

---

### Task 2: The `release_week` fact and the owner-only release-date lookup

**Files:**
- Create: `packages/services/insights/src/match.ts`, `src/facts-release.ts`
- Modify: `packages/services/insights/src/types.ts`, `window.ts`, `collect.ts`, `build.ts`, `render.ts`, `index.ts`; `packages/services/spotify/src/search.ts`; `apps/web/src/api/internal/insights-week.ts`
- Test: `packages/services/insights/__tests__/match.test.ts`, `facts-release.test.ts` (new); `collect.test.ts`, `render.test.ts`, `build.test.ts`, `guard.test.ts`; `apps/web/src/__tests__/services/spotify.test.ts`, `handlers/insights-week.test.ts`

**Interfaces:**
- Produces:

```ts
// match.ts
export function matchKey(s: string): string;              // norm(), '&' -> 'and', NFD minus marks, non-letter/digit runs -> ' ', trim
export function hasEditionMarker(title: string): boolean; // /\b(?:remaster(?:ed)?|deluxe|anniversary|edition|expanded|reissue|alternative master)\b/i
export function stripEdition(title: string): string;      // drops trailing (...), [...] or ' - ...' segments carrying a marker, repeatedly
// window.ts
export function localDate(ts: number, tz: string | null): string; // 'YYYY-MM-DD'; UTC when tz is null
export function tsOnLocalDate(date: string, tz: string | null, from: number, to: number): number | null; // first whole hour in [from, to) on that date
// types.ts
export interface ReleaseInfo { title: string; artist: string; date: string } // Spotify title, artists joined ', ', release_date as given
export type ReleaseLookup = (artist: string, album: string) => Promise<ReleaseInfo | null>;
// WeekInputs.releases?: Record<string, ReleaseInfo> (albumKey; absent when no lookup ran); FactKind += 'release_week'; WeekFacts.releasesChecked: boolean
export function releaseWeekFacts(ctx: FactContext): Draft[];                       // facts-release.ts
export function collectReleases(inputs: WeekInputs, lookup: ReleaseLookup, limit?: number): Promise<Record<string, ReleaseInfo>>; // collect.ts
// CAPS.releaseLookups = 6; CollectArgs.releases?: ReleaseLookup
// search.ts: search(query, type, limit = 1, options: { quiet?: boolean } = {}); searchAlbumByArtist(artist, album, options: { quiet?: boolean } = {})
export function spotifyReleaseLookup(spotify: SpotifyService): ReleaseLookup;      // insights-week.ts
```

- [ ] **Step 1: Write the failing tests.** `graded(week, releases)` is a local helper over the existing `context` and `albumRuns` that sets `inputs.albums` (TEN, count 0) and `inputs.releases`; the window ends Sun Nov 8 2026 21:17 UTC, timezone null.

```ts
const MON = ts('2026-11-02T10:00:00');
const release = (date: string, title = 'Eternal Embers', artist = 'Meltt') => ({ [albumKey('Meltt', 'Eternal Embers')]: { title, artist, date } });
const full = (start: number) => listen('Meltt', 'Eternal Embers', TEN, start);

it('fires at 80 when the album was played start to finish on its release day', () => {
  const d = only(releaseWeekFacts(graded(full(MON), release('2026-11-02'))), 'release_week');
  expect([d.salience, d.subject]).toEqual([80, 'Meltt']);
  expect(d.statement).toBe('Eternal Embers by Meltt came out on Mon Nov 2, and you played it start to finish that day.');
  expectGrounded(d);
});
it('skips a Spotify match whose title is another edition or another record', () => { // Review Focus 5
  for (const title of ['Eternal Embers Live', 'Eternal Embers (Deluxe Edition)', 'Embers']) {
    expect(releaseWeekFacts(graded(full(MON), release('2026-11-02', title)))).toEqual([]);
  }
});
```

Also, each with its assertion:
- `facts-release.test.ts` `fires at 70 for a most_of run later in the release week`: 8 of TEN from Wed Nov 4 10:00 gives salience 70 and `'Eternal Embers by Meltt came out on Mon Nov 2, and you played 8 of 10 tracks of it, in order, on Wed Nov 4.'`, grounded. `facts-release.test.ts` `skips an edition marker on the Last.fm title`: a run of "Eternal Embers (2026 Remaster)" with a matching release entry gives `[]`. `makes no fact for an unverified run or without releases`: both `[]`.
- `facts-release.test.ts` `needs day precision, a date in the window and on or before the run, and a matching artist`: dates `'2026-11'`, `'2026'`, `'2026-10-30'` and `'2026-11-03'` give `[]` for the Monday run; Spotify artist `'Meltt, Guest'` gives one fact; `'Meltt Tribute Band'` and `'Someone Else'` give `[]`.
- `match.test.ts`: `matchKey('Justin Meldal‐Johnsen') === matchKey('Justin Meldal-Johnsen')`; `matchKey('Sigur Rós') === 'sigur ros'`; `matchKey('Tom Petty & The Heartbreakers') === matchKey('Tom Petty and the Heartbreakers')`; `stripEdition('In Rainbows (Remastered)') === 'In Rainbows'`, `stripEdition('Inferno - 2023 Remaster') === 'Inferno'`, `"(What's the Story) Morning Glory?"` unchanged. `collect.test.ts` `looks up at most 6 run albums, most played first, skipping edition-marked titles without a call`: 8 `start_to_finish` albums, one "X (Deluxe Edition)", give 6 lookup calls in plays order, never the marked one. `makes no release lookup without a releases client`: `releases` is `undefined`. `skips a lookup that throws`: other entries kept. Existing tests passing `caps` add `releaseLookups`.
- `render.test.ts` `renders the release-week line in both persons`: `'You played Eternal Embers by Meltt start to finish on Mon Nov 2, the day it came out.'` and, `most_of` later in the week, `'rian played 8 of 10 tracks of Eternal Embers by Meltt on Wed Nov 4, in the week it came out.'` `build.test.ts` `releasesChecked is false without releases and true with them`. `guard.test.ts`: `release_week` joins `SYNTHETIC`, so "every fact's own statement passes the guard" covers it.
- `spotify.test.ts` `quiet search logs no query, artist or album, even on a 429 or a rejected cache write`: `searchAlbumByArtist('Sentinel Artist', 'Sentinel Album', { quiet: true })` against a 429, then against a KV `put` rejecting with `new Error('put failed for spotify:search:album:Sentinel Album')`; after flushing promises, no argument to `console.log`, `.warn` or `.error` contains `'Sentinel'`.
- `insights-week.test.ts` `passes a release lookup to the collector for the owner and none for a visitor` (`collectWeekInputs.mock.calls[0][0].releases` is a function, then `undefined`); `the owner recomputes facts a visitor computed without release dates` (cached `releasesChecked: false` makes an owner load call `collectWeekInputs` once).

- [ ] **Step 2: Run to verify they fail.** `pnpm --filter @listentomore/insights test`; web files with `pnpm --filter @listentomore/web exec vitest run <file>`. Expected: FAIL.

- [ ] **Step 3: Implement the fact.** `releases` stays optional on `WeekInputs`; `buildWeekFacts` sets `releasesChecked: inputs.releases !== undefined` and appends `releaseWeekFacts(ctx)` after `albumFacts`. Rule: `start_to_finish` and `most_of` runs only; the date is `YYYY-MM-DD`; neither title has an edition marker; title `matchKey`s are equal; the Spotify artist matches whole or as one of its `', '`-separated names; `localDate(window.from, tz) <= date <= localDate(run.from, tz)`. One fact per album (the run on the release day if any, else the first; `start_to_finish` first). Salience 70, +10 when `date === localDate(run.from, tz)`. Values go through `StatementBuilder`; the release day is `run.from` on that day, else `tsOnLocalDate(date, tz, window.from, run.from)`, and is `dates[0]`. Statements:
  - `{Album} by {Artist} came out on {day}, and you played it start to finish that day.`
  - `{Album} by {Artist} came out on {day}, and you played {c} of {n} tracks of it, in order, that day.`
  - later in the week: the same two ending `on {runDay}.` in place of `that day.`
  Render line: `{You} played {album} by {artist} start to finish on {day}, the day it came out.` or `{You} played {c} of {n} tracks of {album} by {artist} on {day}, ...`; later in the week, `on {runDay}, in the week it came out.`

- [ ] **Step 4: Implement the lookup.** `collectReleases` reads this week's deduped scrobbles and `albumRuns(week, inputs.albums)`, keeps each `start_to_finish` or `most_of` album once, orders by the album's plays this week then name, drops edition-marked titles without a call, and looks up the first `limit` (default `CAPS.releaseLookups`) through the existing `mapLimit`, 4 at a time. A throw skips the album; only the failure count joins the existing log. `collectWeekInputs` calls it after `collectAlbums` only when `args.releases` is set; Spotify calls do not count against `totalFetches`.
  - Spotify `quiet`: no log line carries the query, artist or album (cache-miss and field-filter lines are skipped; the 429 line keeps status and Retry-After). The deferred cache write uses the categorical label `'cache write spotify:search'` and wraps the `put` so a rejection reaches the deferred logger as `new Error('KV write rejected')`.
  - `spotifyReleaseLookup` calls `searchAlbumByArtist(artist, album, { quiet: true })` and maps a hit to `{ title: r.name, artist: r.artist, date: r.releaseDate }`. `getWeekInsights` passes `releases` for the owner only and treats cached facts with `releasesChecked: false` as unusable for the owner (builder's call: the owner's next load recomputes them once, mostly from cached Last.fm data).

- [ ] **Step 5: Run the suites.** `pnpm test`, `pnpm typecheck`. Expected: PASS; no fixture gains a `release_week` fact, since fixtures carry no `releases`.

- [ ] **Step 6: Commit** the files above by path: `"Add the release_week fact from Spotify release dates, looked up for the owner only"`.

---

### Task 3: MusicBrainz credits client

**Files:**
- Create: `packages/services/musicbrainz/src/credits-types.ts`, `credits-parse.ts`, `credits.ts`
- Modify: `src/fetch.ts`, `src/index.ts`; `packages/config/src/cache.ts` (`musicbrainz.credits: { ttlDays: 30 }`, `musicbrainz.creditsMiss: { ttlDays: 7 }`, builder's call)
- Test: `packages/services/musicbrainz/__tests__/credits-parse.test.ts`, `credits.test.ts` (copy `createMockKV` and `setupFetchMock` from `musicbrainz.test.ts`)

**Interfaces:**
- Produces:

```ts
export interface CreditArtist { id: string; name: string }
export interface Credit { artist: CreditArtist; type: string; attributes: string[]; level: 'release' | 'recording' | 'track' }
export interface ReleaseCredits { releaseId: string; artists: CreditArtist[]; credits: Credit[] }
export interface ArtistBands { artist: CreditArtist; type: string | null; memberOf: Array<{ band: CreditArtist; ended: boolean }>; members: Array<{ person: CreditArtist; ended: boolean }> }
export interface ReleaseRef { releaseGroupId: string; releaseId: string }
export interface CreditsClient { // `calls`: network calls this instance made
  findRelease(artist: string, album: string): Promise<ReleaseRef | null>; releaseCredits(releaseId: string): Promise<ReleaseCredits | null>;
  artistBands(artistId: string): Promise<ArtistBands | null>; readonly calls: number;
}
export class CreditsCapReached extends Error {}
// credits-parse.ts, pure: pickReleaseGroup(search: unknown, album: string): string | null; pickEarliestOfficial(releaseGroup: unknown): string | null;
//   parseReleaseCredits(release: unknown): ReleaseCredits; parseArtistBands(artist: unknown): ArtistBands
export class MusicBrainzCredits implements CreditsClient { constructor(cache: KVNamespace, limiter: MusicBrainzRateLimiter, options: { maxCalls: number }) }
export async function musicbrainzFetch(endpoint: string, limiter: MusicBrainzRateLimiter, options: { logUrl?: boolean } = {}): Promise<Response>;
```

- [ ] **Step 1: Write the failing tests** with small inline JSON in MusicBrainz's shapes.

```ts
it('caches a search with no release group as a miss and spends no call on the next lookup', async () => { // Review Focus 4
  setupFetchMock([{ pattern: /\/release-group\/\?query=/, response: { 'release-groups': [] } }]);
  const first = new MusicBrainzCredits(kv, limiter, { maxCalls: 10 });
  expect(await first.findRelease('DJ Nobody', 'Mixtape Vol. 3')).toBeNull();
  expect(first.calls).toBe(1);
  expect(kv.put).toHaveBeenCalledWith(expect.stringMatching(/^musicbrainz:credits:rg:/), JSON.stringify({ miss: true }), { expirationTtl: 7 * 86400 });
  const second = new MusicBrainzCredits(kv, limiter, { maxCalls: 10 });
  expect(await second.findRelease('DJ Nobody', 'Mixtape Vol. 3')).toBeNull();
  expect(second.calls).toBe(0);
});
```

Also, each with its assertion:
- `drops supporting-musician links and any link with a touring attribute`: forward relations `member of band` to b1, `member of band` with attribute `'touring'` to b2, and `supporting musician` to b3 give `memberOf` equal to `[{ band: { id: 'b1', name: 'b1' }, ended: false }]`. `picks the best-scoring release group whose folded title matches, preferring albums`: a Single at 100 and an Album at 95, both "Sea Change", give the Album's id; nothing at 90+ or no title match gives `null`.
- `reads a release with no relations as no credits`: `{ id: 'r1', 'artist-credit': [Beck], media: [] }` gives `{ releaseId: 'r1', artists: [Beck], credits: [] }`. `picks the earliest dated official release`: Official 2002-09-24, Official 2002-10-01, Bootleg 2002-01-01 and Promotion 2002-09-01 give the 2002-09-24 id.
- `reads release-level, recording-level and track credits once each`: a producer, a bass credit on two recordings and a featured track artist give 3 credits, levels `release`, `recording`, `track`. `logs no artist or album name and no request URL`: across a search, a miss and a 503, no console argument contains `'DJ Nobody'`, `'Mixtape'` or `'musicbrainz.org'`.
- `keeps member-of-band links forward as memberOf and backward as members`; `reads an artist with no relations as empty lists`. `resolves a release in two calls and caches it for 30 days`; `serves cached releases and artists with calls === 0`.
- `throws CreditsCapReached before the call that would pass maxCalls`: with `maxCalls: 2`, the third uncached lookup rejects after 2 fetches, and both fetched entries are in KV. `passes MusicBrainzRateLimitError through and caches nothing for that lookup`; `reserves a limiter slot for every network call`.

- [ ] **Step 2: Run to verify they fail.** `pnpm --filter @listentomore/musicbrainz test`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - Endpoints, all with `{ logUrl: false }`: `/release-group/?query=<q>&fmt=json&limit=5` with `releasegroup:"<album>" AND artist:"<artist>"` (Lucene-escaped); `/release-group/<id>?inc=releases&fmt=json`; `/release/<id>?inc=artist-credits+recordings+artist-rels+recording-level-rels&fmt=json`; `/artist/<id>?inc=artist-rels&fmt=json`.
  - `pickReleaseGroup`: score ≥ 90 and folded-title equality (NFKC, lower case, accents removed, non-alphanumerics to a space); prefer `primary-type` 'Album', then score. `pickEarliestOfficial`: status 'Official' with a date, earliest first; an undated one only when none has a date.
  - `parseReleaseCredits`: album artists from the release `artist-credit`; credits from release `relations`, recording `relations`, and track `artist-credit` entries that are not album artists (type `'performer'`, level `'track'`); deduplicate on artist id, type and sorted attributes. `parseArtistBands`: only `member of band` to an artist; `forward` to `memberOf`, `backward` to `members`; drop any link whose attributes include 'touring' (case-insensitive).
  - Cache keys (builder's call): `musicbrainz:credits:rg:<seg(artist)>:<seg(album)>` (a `ReleaseRef`, or `{ miss: true }` also for a group with no usable release), `musicbrainz:credits:release:<id>`, `musicbrainz:credits:artist:<id>`; `seg` is `encodeURIComponent` of the NFKC, lower-cased, trimmed name. Hits use `credits`, misses `creditsMiss`; keys over 512 bytes are not cached; errors are never cached.
  - Budget: cache reads are free; before each network call throw `CreditsCapReached` when `calls >= maxCalls`, else count it. `maxCalls: Infinity` lifts the cap.

- [ ] **Step 4: Run to verify they pass**, then `pnpm typecheck`, `pnpm test`.

- [ ] **Step 5: Commit** the files above by path: `"Add a budgeted, globally cached MusicBrainz credits client"`.

---

### Task 4: Copy rubric in the insights package

**Files:**
- Create: `packages/services/insights/src/rubric.ts`
- Modify: `apps/web/scripts/insights-rubric.ts` (becomes a re-export), `packages/services/insights/src/index.ts`
- Test: `packages/services/insights/__tests__/rubric.test.ts` (new); `apps/web/src/__tests__/utils/insights-rubric.test.ts` passes unchanged

**Interfaces:**
- Produces: `maskNames`, `checkRubric`, `checkNoteRubric` (moved, unchanged) and `checkCopyRubric(text: string, names: string[]): string[]`: `checkNoteRubric`'s hits plus `'announcing'`, `'negation contrast'` for the quiet variants, and `'overused:<entry>'`.

- [ ] **Step 1: Move the rubric.** Move the body of `apps/web/scripts/insights-rubric.ts` into `src/rubric.ts` unchanged and export the three functions; the script file re-exports them from `@listentomore/insights` under its ABOUTME header. Run `pnpm --filter @listentomore/web exec vitest run src/__tests__/utils/insights-rubric.test.ts`. Expected: PASS.

- [ ] **Step 2: Write the failing tests**, each with its assertion:
- `flags announcing openers`: "Here's the fact: Inferno was cut in a barn.", "Fun fact: Inferno was cut in a barn." and "Did you know Inferno was cut in a barn?" (names `['Inferno']`) each contain `'announcing'`. `masks names, so an album called Echoes passes`: "Echoes was recorded over two weeks in 1971." with `['Echoes']` gives `[]`.
- `flags overused entries in any inflection, shadow and quiet included`: "The sessions showcased a pivotal shift." contains `'overused:showcase'` and `'overused:pivotal'`; "It sits in the shadow of their debut." contains `'overused:shadow'`; "A record of quiet confidence." contains `'overused:quiet'`.
- `allows the literal "a quiet week" and nothing else with quiet`: "A quiet week: 12 plays. Meltt came up most." (names `['Meltt']`) gives `[]`; "A quiet week of quietly growing plays." contains `'overused:quiet'`. `flags the quiet negation-contrast variants`: "It was cut live rather than overdubbed.", "They used tape instead of a computer." and "It was not only fast but loud." each contain `'negation contrast'`.

- [ ] **Step 3: Run to verify they fail.** `pnpm --filter @listentomore/insights test`. Expected: FAIL, `checkCopyRubric` missing.

- [ ] **Step 4: Implement `checkCopyRubric`**, reading with names masked. Entries, whole-word in any inflection, every item from the lists in `avoid-ai-patterns.md`:
  - verbs: delve, underscore, highlight, showcase, leverage, utilize, facilitate, foster, navigate, garner, craft, harness, boast, surpass;
  - adjectives: intricate, meticulous, swift, adept, liminal, spectral, crucial, pivotal, robust, seamless, transformative, groundbreaking, cutting-edge, nuanced, multifaceted, sharp, load-bearing;
  - nouns: tapestry, journey, echo, whisper, shadow, ghost, landscape, realm, paradigm, ecosystem, synergy, seam, throughline, shape;
  - atmosphere and filler: quiet, hum, humming, woven, weave, deeply, fundamentally, remarkably, genuinely, truly, incredibly, arguably;
  - phrases: "it's worth noting", "it bears mentioning", notably, interestingly, importantly, "cannot be overstated", "a testament to", "paving the way", "unlock the potential", "at the end of the day", "in conclusion", "to sum up", "in summary", "serves as", "stands as".
  `announcing`: an opening "Here's", "Here is", "Fun fact", "Did you know", "The best part", "But here's the thing". `negation contrast` adds "rather than", "instead of", "not only", "less about". The one exception, stated in a code comment: the literal phrase "a quiet week" (the site's own quiet-week line) is masked before the `quiet` check.

- [ ] **Step 5: Run to verify they pass**, then `pnpm typecheck`, `pnpm test`.

- [ ] **Step 6: Commit** `src/rubric.ts`, `src/index.ts`, `__tests__/rubric.test.ts`, `apps/web/scripts/insights-rubric.ts`: `"Move the insights rubric into the package and add the copy rubric"`.

---

### Task 5: Album identities on facts, card candidates and the card signature

**Files:**
- Create: `packages/services/insights/src/standout.ts` (from `eb04be9`), `src/card-albums.ts`
- Modify: `src/statement.ts`, `facts-shared.ts` (`writeRun`), `facts-album.ts:78,181`, `facts-release.ts`, `rank.ts` (`foldInto`), `types.ts`, `build.ts`, `index.ts`
- Test: `__tests__/standout.test.ts` (from `eb04be9`), `card-albums.test.ts` (new), `facts-album.test.ts`, `build.test.ts`

**Interfaces:**
- Produces:

```ts
export interface AlbumRef { artist: string; album: string }
// Fact.albums: AlbumRef[] (every album the statement names, with its artist); WeekFacts.cardAlbums: CardAlbum[]
export interface CardAlbum { artist: string; album: string; plays: number } // deduped plays of the album this week
// StatementBuilder.album(artist: string, album: string): this  -- writes the album name, records it in entities and albums
export interface StandoutAlbum { artist: string; album: string }
export function standoutAlbum(wf: Pick<WeekFacts, 'facts'>): StandoutAlbum | null;
export const CARD_CANDIDATES = 6;
export const CARD_VERSION = 'c1';
export function cardAlbums(facts: Fact[], runs: AlbumRun[], week: Scrobble[]): CardAlbum[];
export async function cardSignature(wf: WeekFacts): Promise<string>; // 16 hex of SHA-256 over [ruleVersion, CARD_VERSION, top six facts as [id, kind, statement], cardAlbums, standoutAlbum(wf)]
```

- [ ] **Step 1: Port `standoutAlbum`.** `git show eb04be9:packages/services/insights/src/standout.ts > packages/services/insights/src/standout.ts`, and the same for `__tests__/standout.test.ts`. Drop "experimental" from the header, take `Pick<WeekFacts, 'facts'>`, and read `release_week` as `albums[0]`. It feeds the making-of fallback and the card signature only, never candidate order.

- [ ] **Step 2: Write the failing tests.** `run(artist, album, tracks)` builds a graded 6+-track `AlbumRun`; `weekOf(runs)` holds `tracks` scrobbles per run; `repeatAlbumFact` and `volumeFact` build drafts through the existing fact builders.

```ts
it('lists the top 6 by plays this week, leaving out a standout that ranks 7th', () => {
  const runs = [9, 8, 8, 7, 7, 6].map((n, i) => run(`Artist ${i}`, `A${i}`, n + 3)).concat(run('Seventh', 'A7', 6));
  const facts = [{ ...repeatAlbumFact('Seventh', 'A7'), id: 1 }]; // fact 1: the standout album
  expect(cardAlbums(facts, runs, weekOf(runs)).map((a) => a.album)).toEqual(['A0', 'A1', 'A2', 'A3', 'A4', 'A5']);
  expect(standoutAlbum({ facts })).toEqual({ artist: 'Seventh', album: 'A7' });
});
```

Also, each with its assertion: `never reads an artist named like an album as that album` (20 plays of the band Low from "Things We Lost in the Fire" plus 3 of David Bowie's "Low", with a volume fact about Low as fact 1: no card album is titled "Low"); `keeps each artist's album apart when two artists share a title` (runs of "Greatest Hits" by Artist A, 9 tracks, and Artist B, 7, give `[{ artist: 'Artist A', album: 'Greatest Hits', plays: 9 }, { artist: 'Artist B', album: 'Greatest Hits', plays: 7 }]`); `breaks equal plays by album name, then artist name` (runs Zed/Same 8, Abe/Same 8, Abe/Other 8 give `Other/Abe`, `Same/Abe`, `Same/Zed`); `cardSignature changes with the ranked facts, and ignores pulledAt` (on May 24, `pulledAt + 3600` keeps the signature; swapping facts 1 and 2 changes it); `facts-album.test.ts` `repeat, single-listen and chain facts record their albums with artists` (a chain of Hysteria (Def Leppard) and A La Sala (Khruangbin) has both pairs in `albums`); `build.test.ts` `a folded single listen carries its album into the host` and `May 24 card albums include Inferno by Boards of Canada`.

- [ ] **Step 3: Run to verify they fail.** `pnpm --filter @listentomore/insights test`. Expected: FAIL.

- [ ] **Step 4: Implement.** `StatementBuilder.album` writes like `name()` and records `{ artist, album }` once; `build()` returns `albums`. Use it at the four places a statement writes an album: `writeRun`, `repeatAlbum` (line 78), `chainFact` (line 181) and `releaseWeekFacts`. `foldInto` merges `albums` like `entities`; statements do not change. `cardAlbums`: the top six facts' `albums` plus every run with `tracksPlayed >= 6` (any verdict), deduplicated by `albumKey`, `plays` the album's deduped plays this week, ordered by plays descending, then album name, then artist name, capped at `CARD_CANDIDATES`. `buildWeekFacts` sets `cardAlbums`. The library side of a card's validity is Task 6's `eligibilityKey`.

- [ ] **Step 5: Run to verify they pass**, then `pnpm typecheck`, `pnpm test`; fixture statements do not change.

- [ ] **Step 6: Commit** the files above by path: `"Record album identities on facts and pick card albums by plays this week"`.

---

### Task 6: Tie-back selection and templates

**Files:**
- Create: `packages/services/insights/src/tieback.ts`
- Modify: `src/index.ts`, `package.json` (add `"@listentomore/musicbrainz": "workspace:*"` for types), `pnpm-lock.yaml`
- Test: `packages/services/insights/__tests__/tieback.test.ts`

**Interfaces:**
- Consumes: `matchKey` (T2), `checkCopyRubric` (T4), `CardAlbum` (T5), `ReleaseCredits`, `ArtistBands`, `CreditArtist` (T3, `import type`).
- Produces:

```ts
export const TIEBACK_MIN_PLAYS = 10;
export type Library = ReadonlyMap<string, number>;                  // matchKey(name) -> lifetime plays
export function libraryFrom(list: Pick<CountList, 'counts'>): Library;
export interface CreditedPerson { artist: CreditArtist; role: string | null; producer: boolean; member: boolean }
export function peopleToCheck(credits: ReleaseCredits, albumArtists: ArtistBands[]): { guests: CreditedPerson[]; members: CreditedPerson[] };
export interface TieBackInput { album: CardAlbum; credits: ReleaseCredits; albumArtists: ArtistBands[]; bands: ReadonlyMap<string, ArtistBands | null> }
// TieBack: album and albumArtist in Last.fm spelling; one or two people with the same band and member flag; band is the
// MusicBrainz name of the matched band, or of the person on a direct match
export interface TieBack { album: string; albumArtist: string; people: CreditedPerson[]; band: string; plays: number; direct: boolean }
export function selectTieBacks(input: TieBackInput, library: Library): { tieBacks: TieBack[]; considered: string[] }; // considered: matchKeys looked up
export function eligibilityKey(considered: string[], library: Library): string; // sorted considered keys at 10+ plays, each with its lifetime count ('key=count'), joined
export type Viewer = { person: 'second' } | { person: 'third'; name: string };
export function renderTieBack(t: TieBack, viewer: Viewer, library?: Library): string;
```

- [ ] **Step 1: Write the failing tests.** Makers at the top: `guest(id, name, type, attributes = [])` builds a `Credit`; `release(credits)` a `ReleaseCredits` by Beck; `person(id, name, bands: CreditArtist[])` an `ArtistBands`; `SEA_CHANGE = { artist: 'Beck', album: 'Sea Change', plays: 12 }`; `one(id, credit, bands)` a `TieBackInput` for `SEA_CHANGE` with that one guest; `CASES` holds one `TieBack` per template row below.

```ts
it('matches library names across U+2010 hyphens, accents and "&"', () => { // Review Focus 1
  const library = libraryFrom({ counts: { 'justin meldal-johnsen': 12, 'sigur ros': 40, 'tom petty & the heartbreakers': 25 } });
  const credits = release([guest('jmj', 'Justin Meldal‐Johnsen', 'instrument', ['bass guitar']), guest('jonsi', 'Jónsi', 'vocal'),
    guest('mike', 'Mike Campbell', 'instrument', ['guitar'])]);
  const bands = new Map([
    ['jmj', person('jmj', 'Justin Meldal‐Johnsen', [])],
    ['jonsi', person('jonsi', 'Jónsi', [{ id: 'sr', name: 'Sigur Rós' }])],
    ['mike', person('mike', 'Mike Campbell', [{ id: 'tp', name: 'Tom Petty and the Heartbreakers' }])],
  ]);
  const { tieBacks } = selectTieBacks({ album: SEA_CHANGE, credits, albumArtists: [person('beck', 'Beck', [])], bands }, library);
  expect(tieBacks.map((t) => [t.band, t.plays, t.direct])).toEqual([
    ['Sigur Rós', 40, false], ['Tom Petty and the Heartbreakers', 25, false], ['Justin Meldal‐Johnsen', 12, true]]);
});
```

Also, each with its assertion:
- `a band at 9 plays is no tie-back, and eligibilityKey changes when it reaches 10`: a guitarist in "Heartbreakers" gives `[]` against `{ heartbreakers: 9 }` and one tie-back against 10, and `eligibilityKey(considered, at9) !== eligibilityKey(considered, at10)`. `eligibilityKey changes when two eligible bands swap order by count`: with `considered` holding keys for bands A and B, `{ a: 20, b: 30 }` and `{ a: 30, b: 20 }` keep the same eligible set and give different keys. `allows a band member's other band`: In Rainbows by Radiohead, members Thom Yorke and Jonny Greenwood both in The Smile (40), gives one tie-back with both people.
- `a person with no band relations gives no tie-back and does not throw`: `one('x', drummer, [])` with an empty library gives `tieBacks` `[]`. `keeps instrument, vocal, performer and producer credits and drops engineering, mixing, mastering, design and executive producers`: `peopleToCheck` over one credit of each returns 4 guests. `keeps a co-producer and ties back through their band`: a producer credit with attribute `'co'` for a member of The Black Keys (531 plays) gives one tie-back with `people[0].producer === true` and `band === 'The Black Keys'`.
- `ranks guests before members of the album band, then by lifetime plays`: Chad Smith (guest, RHCP 19) before Thom Yorke (member, The Smile 40). `excludes the album artist and a solo artist's own other bands`: an Eddie Vedder album with guest Mike McCready, both in Pearl Jam (500), gives `[]`.
- `names at most two people, both tied to the same band`: three RHCP guests give `people.length === 2`. `skips people whose bands lookup is missing or null`. `renderTieBack` `third person names the profile`: the two-members case reads `'... a band rian has played 40 times.'`, the direct case `'Josh Klinghoffer plays guitar on Earthling. rian has played Josh Klinghoffer 12 times.'` `renderTieBack` `states the library's current count, with a comma from 1,000`: the producer case with a library of `{ 'the black keys': 1204 }` ends `'1,204 times.'`.

```ts
describe('renderTieBack', () => {
  it.each([
    ['guest', "Chad Smith plays drums on Earthling and has played in Red Hot Chili Peppers, a band you've played 19 times."],
    ['vocals', "Jónsi sings on Sea Change and has played in Sigur Rós, a band you've played 40 times."],
    ['no role', "Mike Campbell plays on Sea Change and has played in Tom Petty and the Heartbreakers, a band you've played 25 times."],
    ['two guests', "Earthling has Chad Smith and Josh Klinghoffer on it. Both have played in Red Hot Chili Peppers, a band you've played 19 times."],
    ['producer', "Los Ojos Del Cóndor was produced by Dan Auerbach, who has played in The Black Keys, a band you've played 531 times."],
    ['one member', "Thom Yorke from Radiohead plays on In Rainbows and has also played in The Smile, a band you've played 40 times."],
    ['two members', "Thom Yorke and Jonny Greenwood from Radiohead play on In Rainbows and have also played in The Smile, a band you've played 40 times."],
    ['direct', "Josh Klinghoffer plays guitar on Earthling. You've played Josh Klinghoffer 12 times."],
    ['direct producer', "Sea Change was produced by Nigel Godrich. You've played Nigel Godrich 11 times."],
  ])('%s, second person', (name, text) => expect(renderTieBack(CASES[name], { person: 'second' })).toBe(text));
  it('every template in both persons passes checkCopyRubric', () => {
    for (const t of Object.values(CASES)) for (const viewer of [{ person: 'second' }, { person: 'third', name: 'rian' }] as Viewer[]) {
      expect(checkCopyRubric(renderTieBack(t, viewer), [t.album, t.albumArtist, t.band, ...t.people.map((p) => p.artist.name)])).toEqual([]);
    }
  });
});
```

- [ ] **Step 2: Run to verify they fail.** `pnpm --filter @listentomore/insights test`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `libraryFrom` re-keys by `matchKey`, keeping the larger count on collisions.
  - `peopleToCheck`: guests are credited artists, other than album artists, of type instrument, vocal, performer or producer; a producer credit with an executive, assistant or associate attribute is dropped; a co-producer is kept. Members are the album artists' `members`; someone in both is a member. `role`: 'vocals' for vocal; for instrument the first attribute that is not guest, additional, solo or similar, parenthetical removed ("drums (drum set)" becomes "drums"); else null. Producer plus player takes the playing role. Guests stay in credit order.
  - `selectTieBacks`: excluded bands are the album artists (by MusicBrainz id, and by `matchKey` of the card album's artist) and, for an album artist of type 'Person', its `memberOf` bands. Each person's non-excluded bands, and the person, at 10+ plays are tie-backs; `considered` lists every key looked up. Order: guests first, then plays descending, then band name; the first absorbs the next with the same band and member flag, two people at most.
  - `renderTieBack`: the copy above; "you've played" or `{name} has played`; the direct second sentence "You've played {person} {N} times." or "{name} has played {person} {N} times."; `N = library?.get(matchKey(band)) ?? t.plays`, with `toLocaleString('en-US')`.

- [ ] **Step 4: Run to verify they pass**, then `pnpm install`, `pnpm typecheck`, `pnpm test`.

- [ ] **Step 5: Commit** the files above by path: `"Select credit tie-backs and render them from templates"`.

---

### Task 7: The albumTrivia task with citations, and the making-of fact

**Files:**
- Create: `packages/services/ai/src/prompts/album-trivia.ts` (from `eb04be9`), `apps/web/src/api/internal/insights-making-of.ts`
- Modify: `packages/config/src/ai.ts`, `cache.ts` (`albumTrivia: { fact: { ttlDays: 120 }, none: { ttlDays: 30 } }`); `packages/services/ai/src/types.ts`, `anthropic.ts`, `prompts/index.ts`, `index.ts`; `packages/services/insights/src/keys.ts`; `docs/how-to/ai-models.md` (an `albumTrivia` row)
- Test: `apps/web/src/__tests__/services/ai.test.ts`, `handlers/insights-making-of.test.ts` (new), `packages/services/insights/__tests__/collect.test.ts`

**Interfaces:**
- Produces:

```ts
export interface WebCitation { url: string; title: string | null }
// ChatCompletionOptions.webSearchMaxUses?: number; ChatCompletionOptions.quietErrors?: boolean; ChatCompletionResponse.citations?: WebCitation[]
export const ALBUM_TRIVIA_NONE = 'NONE';
export function buildAlbumTriviaMessages(artistName: string, albumName: string): ChatMessage[];
export function parseAlbumTrivia(content: string): string | null;
export interface AlbumTriviaResult { text: string | null; sourceUrl: string | null; raw: string; metadata?: AIResponseMetadata }
export async function generateAlbumTrivia(artistName: string, albumName: string, client: ChatClient): Promise<AlbumTriviaResult>;
// AIService.getAlbumTrivia(artistName, albumName): Promise<AlbumTriviaResult>
// keys.trivia(artist, album) = `insights:trivia:${segment(artist)}:${segment(album)}` (global)
export type MakingOfResult =
  | { status: 'found'; text: string; sourceUrl: string; calls: AIResponseMetadata[] }
  | { status: 'none' | 'error'; calls: AIResponseMetadata[] };
export async function makingOfFact(ai: AIService, kv: KVNamespace, artist: string, album: string): Promise<MakingOfResult>;
```

- [ ] **Step 1: Port the spike.** `git diff 837623f eb04be9 -- packages/config/src/ai.ts packages/services/ai/src/anthropic.ts packages/services/ai/src/types.ts packages/services/ai/src/index.ts packages/services/ai/src/prompts/index.ts | git apply` and `git show eb04be9:packages/services/ai/src/prompts/album-trivia.ts > packages/services/ai/src/prompts/album-trivia.ts`. Drop "EXPERIMENTAL" and "Not wired into any route" from the config comment; the prompt stays as written. From `git diff 837623f eb04be9 -- apps/web/src/__tests__/services/ai.test.ts`, keep the prompt, parse, `max_uses` and dropped-block tests; replace its cache tests with the uncached contract.

- [ ] **Step 2: Write the failing tests.** `insights-making-of.test.ts` uses a fake `ai` with a `getAlbumTrivia` spy and `createMockKV`.

```ts
const FACT = { text: 'Inferno was recorded in two weeks in 2023.', sourceUrl: 'https://a.example/x', raw: 'x', metadata: { truncated: false } };
it('caches a cited fact that passes the rubric for 120 days under insights:trivia', async () => {
  ai.getAlbumTrivia.mockResolvedValue(FACT);
  expect(await makingOfFact(ai, kv, 'Boards of Canada', 'Inferno')).toMatchObject({ status: 'found', text: FACT.text, sourceUrl: FACT.sourceUrl });
  expect(kv.put).toHaveBeenCalledWith(keys.trivia('Boards of Canada', 'Inferno'),
    JSON.stringify({ text: FACT.text, sourceUrl: FACT.sourceUrl }), { expirationTtl: 120 * 86400 });
});
```

Also, each with its assertion:
- `ai.test.ts` `a quietErrors call logs only the status of a non-2xx response and throws without the body`: a 400 whose body is "Sentinel Album by Sentinel Artist: Sentinel fact" rejects with exactly `Anthropic API error: 400`, and no argument to `console.log`, `.warn` or `.error` contains `'Sentinel'`. `ai.test.ts`: `sends the task's max_uses` (albumTrivia 2, a task without one 5); `returns the answer's citations once each, ignoring blocks before the last search result` (two answer blocks citing `https://a.example/x` and a pre-search block citing `https://b.example` give `[{ url: 'https://a.example/x', title: 'A' }]`); `generateAlbumTrivia is uncached and takes the first https citation as sourceUrl`; `an http-only citation gives sourceUrl null`; `parseAlbumTrivia reads "NONE. I could not..." as null and keeps "None of the songs..."`.
- `insights-making-of.test.ts` `a second rubric failure caches { none: true } for 30 days`: text "Fun fact: Inferno showcased a pivotal shift." on both calls gives `none`, 2 calls, and a `put` of `{ none: true }` with `expirationTtl: 30 * 86400`. `collect.test.ts`: `trivia keys are global: no user segment, not in userKeyPrefixes`.
- `insights-making-of.test.ts`: `regenerates once after a rubric failure, then caches the second`; `NONE caches none with no second call`; `an answer with no citation caches none`; `a cached fact or none makes no model call`; `a thrown or truncated call returns error and writes nothing`; `logs no artist, album, fact text or source URL` across found, none and error runs with sentinel names.

- [ ] **Step 3: Run to verify they fail.** `pnpm --filter @listentomore/web exec vitest run src/__tests__/services/ai.test.ts src/__tests__/handlers/insights-making-of.test.ts`. Expected: FAIL.

- [ ] **Step 4: Implement.**
  - `anthropic.ts`: content blocks gain `citations?`; collect `web_search_result_location` citations from text blocks after the last `web_search_tool_result`, deduplicated by URL, onto `citations`. With `quietErrors`, a non-2xx logs `[Anthropic] API error: <status>` and throws `Anthropic API error: <status>`; otherwise unchanged.
  - `album-trivia.ts`: no cache; one call with config `webSearchMaxUses` and `quietErrors: true`; `sourceUrl` is the first citation URL with protocol `https:`; logs the model only.
  - `makingOfFact`: read `keys.trivia` (a failed read is a miss); `{ none: true }` gives none, a fact gives found. On a miss, up to 2 calls. A throw, or `isCacheableResponse(raw, metadata, 'albumTrivia')` false, gives error and writes nothing. `text === null` or `sourceUrl === null` caches none at once. A `checkCopyRubric(text, [artist, album])` hit spends the next attempt; after the second, cache none. Writes use KV `put` directly (the `AICache` log lines carry names) with `CACHE_CONFIG.albumTrivia.fact` or `.none`. Logs carry the outcome and attempt count only.

- [ ] **Step 5: Run to verify they pass**, then `pnpm typecheck`, `pnpm test`.

- [ ] **Step 6: Commit** the files above by path: `"Add the albumTrivia task with citations and a rubric-checked making-of fact"`.

---

### Task 8: Card generation and the trivia card endpoint

**Files:**
- Create: `apps/web/src/utils/musicbrainz-limiter.ts`, `apps/web/src/api/internal/insights-card.ts`, `insights-card-route.ts`
- Modify: `apps/web/src/durable-objects/musicbrainz-rate-limiter.ts` (adapter moves out), `apps/web/src/index.tsx:53`, `api/internal/insights.ts`, `insights-week.ts` (export `isCurrentFacts`), `packages/services/insights/src/keys.ts` (`card`, `userExactKeys`), `packages/config/src/cache.ts` (`userInsights.card: { ttlDays: 8 }`, builder's call: the note's lifetime), `docs/feature-gating.md`
- Test: `apps/web/src/__tests__/handlers/insights-card.test.ts`, `scripts/insights-imports.test.ts` (new); `packages/services/insights/__tests__/collect.test.ts`, `apps/web/src/__tests__/utils/insights-cleanup.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 5, 6, 7.
- Produces:

```ts
export function getMusicBrainzLimiter(namespace: DurableObjectNamespace<MusicBrainzRateLimiterDO>): MusicBrainzRateLimiter; // utils/musicbrainz-limiter.ts, `import type` of the DO only
// keys.card(user) = `insights:card:${u(user)}`, also in userExactKeys
// insights-card.ts: Node-safe; imports packages and types only
export const CARD_MB_CALLS = 10;
export type StoredCard = { album: string; artist: string; imageUrl: string | null }
  & ({ kind: 'tieback'; tieBack: TieBack } | { kind: 'making_of'; text: string; sourceUrl: string });
export interface CachedCard { signature: string; considered: string[]; eligible: string; card: StoredCard | null }
export interface TriviaCard { kind: 'tieback' | 'making_of'; album: string; artist: string; text: string; sourceUrl?: string; imageUrl?: string }
export interface CheckedAlbum { album: CardAlbum; tieBacks: TieBack[] | null }  // null: no release group or credits
export type CardOutcome = ({ status: 'card'; card: StoredCard } | { status: 'none' } | { status: 'cut' }) // cut: cache nothing
  & { checked: CheckedAlbum[]; considered: string[] };
export interface CardDeps { credits: CreditsClient; makingOf(artist: string, album: string): Promise<MakingOfResult>; albumArt(artist: string, album: string): Promise<string | null> }
export async function generateCard(deps: CardDeps, wf: WeekFacts, library: Library, opts?: { exhaustive?: boolean }): Promise<CardOutcome>;
export function renderCard(card: StoredCard, viewer: Viewer, library?: Library): TriviaCard;
export function isCardValid(cached: CachedCard, signature: string, library: Library): boolean; // equal signature and eligibilityKey(cached.considered, library) === cached.eligible
export async function getTriviaCard(c: Context<InternalAppContext>, args: { user: User; isOwner: boolean }): Promise<TriviaCard | null>; // insights-card-route.ts
// GET /api/internal/user-insights-trivia?username=  ->  { data: TriviaCard | null }
```

- [ ] **Step 1: Write the failing tests.** Harness: the `insights-week.test.ts` setup (Hono app, `createMockKV`, signed-in cookie, `collectWeekInputs` mocked), plus `seedFacts(kv, wf)` writing `keys.facts('bordesak')`, `seedOverall(kv, counts)` writing `keys.topList('bordesak', 'overall')`, and `mb = mockMusicBrainz()`, which mocks `fetch` for `musicbrainz.org` by URL: `mb.album(artist, title, spec | null)` serves the search, release-group, release and artist responses (`null` is an empty search; `spec.guests` lists `mbGuest(id, bandNames)`, each credited on drums with those `member of band` links), and `mb.calls()` counts MusicBrainz fetches; other URLs reject. Env `MUSICBRAINZ_RATE_LIMITER` is a namespace whose stub `reserve` resolves 0; `services.spotify.search.searchAlbumByArtist` and `services.ai.getAlbumTrivia` are spies. `wfWith(cardAlbums)` is `buildWeekFacts(MAY24)` with `cardAlbums` replaced; `EARTHLING = { artist: 'David Bowie', album: 'Earthling', plays: 30 }`.

```ts
it('a visitor gets data: null and starts nothing when no card is cached', async () => { // Review Focus 2
  const services = createServices(VISITOR, OWNER);
  await seedFacts(services.kv, wfWith([EARTHLING]));
  await seedOverall(services.kv, { 'red hot chili peppers': 19 });
  expect(await (await buildApp(services)(URL_TRIVIA)).json()).toEqual({ data: null });
  expect(mb.calls()).toBe(0); expect(writtenKeys(services.kv)).toEqual([]);
  for (const spy of [services.spotify.search.searchAlbumByArtist, services.ai.getAlbumTrivia, collectWeekInputs]) expect(spy).not.toHaveBeenCalled();
});
it('a cap hit mid-album returns null, caches no card and keeps the fetched credits', async () => { // Review Focus 3
  // 2 calls find the release, 1 reads its credits, 1 reads Bowie, then 12 guests: 16 calls; only the 12th is in RHCP
  mb.album('David Bowie', 'Earthling', { guests: [...Array.from({ length: 11 }, (_, i) => mbGuest(`g${i}`, [])), mbGuest('chad', ['Red Hot Chili Peppers'])] });
  const services = createServices(OWNER, OWNER);
  await seedFacts(services.kv, wfWith([EARTHLING]));
  await seedOverall(services.kv, { 'red hot chili peppers': 19 });
  const app = buildApp(services);
  expect(await (await app(URL_TRIVIA)).json()).toEqual({ data: null });
  expect(mb.calls()).toBe(10);
  const written = writtenKeys(services.kv);
  expect(written.filter((k) => k.startsWith('musicbrainz:credits:'))).toHaveLength(9); // rg, release, Bowie, 6 guests
  expect(written.some((k) => k.startsWith('insights:card:') || k.startsWith('insights:trivia:'))).toBe(false);
  expect(services.ai.getAlbumTrivia).not.toHaveBeenCalled();
  const second = await (await app(URL_TRIVIA)).json();
  expect(mb.calls()).toBe(16); expect(collectWeekInputs).not.toHaveBeenCalled();
  expect(second.data).toMatchObject({ kind: 'tieback', album: 'Earthling' }); expect(second.data.text).toContain("a band you've played 19 times.");
});
it('moves past a candidate with no release group', async () => { // Review Focus 4
  mb.album('DJ Nobody', 'Mixtape Vol. 3', null);
  mb.album('Beck', 'Sea Change', { guests: [mbGuest('jmj', ['Nine Inch Nails'])] });
  const services = createServices(OWNER, OWNER);
  await seedFacts(services.kv, wfWith([{ artist: 'DJ Nobody', album: 'Mixtape Vol. 3', plays: 40 }, { artist: 'Beck', album: 'Sea Change', plays: 12 }]));
  await seedOverall(services.kv, { 'nine inch nails': 60 });
  expect((await (await buildApp(services)(URL_TRIVIA)).json()).data).toMatchObject({ kind: 'tieback', album: 'Sea Change' });
  expect(writtenKeys(services.kv).some((k) => k.startsWith('musicbrainz:credits:rg:dj%20nobody:'))).toBe(true);
});
```

Also, each with its assertion:
- `refuses a visitor on a private profile before touching KV`: 403, `kv.get` not called. `returns data: null when the facts are not cached or the overall list is missing`: no MusicBrainz, Spotify, model or `collectWeekInputs` call, nothing written.
- `owner gets a tie-back card cached under insights:card for 8 days` (`expirationTtl: 8 * 86400`); `a second load serves it with no MusicBrainz, Spotify or model call`; `the owner reads "you've played" and a visitor "rian has played" from the same cached card`. `falls back to the making-of fact only after every candidate is checked`: two candidates, no tie-back; `getAlbumTrivia` is called once, after both albums' MusicBrainz calls, for `standoutAlbum(wf)`.
- `regenerates when a considered band crosses from 9 to 10 plays, with the same candidates`: at 9 the card is null and cached; reseeding at 10 gives a tie-back on the next load. `regenerates when the making-of standout changes, with the same candidates`: swapping the top two facts changes `cardSignature`, and `getAlbumTrivia` is called for the new standout.
- `a making-of error or a MusicBrainz 503 caches nothing`; `the response holds only the card fields` (keys within `kind, album, artist, text, sourceUrl, imageUrl`); `logs no album, artist, person, band, card text or source URL` across a full owner generation with sentinel names. `collect.test.ts` `userExactKeys includes insights:card`; `insights-cleanup.test.ts` `deletes insights:card:<lower> by exact key`. `scripts/insights-imports.test.ts` `the route, card core, making-of and eval lib import in Node`: dynamic `import()` of `api/internal/insights.ts`, `insights-card.ts`, `insights-making-of.ts` and `scripts/insights-eval-lib.ts` resolves, which fails on any `cloudflare:workers` import (`ERR_UNSUPPORTED_ESM_URL_SCHEME`).

- [ ] **Step 2: Run to verify they fail.** `pnpm --filter @listentomore/web exec vitest run src/__tests__/handlers/insights-card.test.ts src/__tests__/scripts/insights-imports.test.ts`. Expected: FAIL.

- [ ] **Step 3: Move the limiter adapter.** `getMusicBrainzLimiter` moves to `utils/musicbrainz-limiter.ts` with `import type { MusicBrainzRateLimiterDO }`; the DO file keeps only the class; `index.tsx` imports the new path. Nothing under `api/` imports `durable-objects/`.

- [ ] **Step 4: Implement `generateCard`, `renderCard`, `isCardValid`.** Call order, which the budget depends on: per card album in order, `findRelease(album.artist, stripEdition(album.album))`, `releaseCredits`, `artistBands` for each album artist, then each guest, and each member only when no guest ties back. Record `{ album, tieBacks }` and the union of `considered`; stop at the first tie-back unless `opts.exhaustive`. `CreditsCapReached`, `MusicBrainzRateLimitError` or any other error before a tie-back gives `'cut'`. A tie-back gives a `'tieback'` card, `imageUrl` from `albumArt` (null on failure). Otherwise `standoutAlbum(wf)`: null gives `'none'`; `makingOf` found gives a `'making_of'` card, none gives `'none'`, error gives `'cut'`. `renderCard` uses `renderTieBack(card.tieBack, viewer, library)` or the stored text, with `sourceUrl` and `imageUrl` only when present.

- [ ] **Step 5: Implement `getTriviaCard` and the route.** Endpoint order:
  1. The route runs `getUserWithInsightsAccess` (visibility) first.
  2. Read `keys.facts(lfm)`; null unless `isCurrentFacts(wf)`, `wf.plays.deduped >= MIN_WEEK_PLAYS` and `wf.cardAlbums.length > 0`.
  3. Read the overall list at `keys.topList(lfm, 'overall')`; missing gives null, nothing written (builder's call: the card makes no Last.fm call).
  4. Read `keys.card(lfm)`; when `isCardValid` against `await cardSignature(wf)` and the library, render it (a stored null card gives null).
  5. A visitor stops with null.
  6. The owner runs `generateCard` with `new MusicBrainzCredits(c.env.CACHE, getMusicBrainzLimiter(c.env.MUSICBRAINZ_RATE_LIMITER), { maxCalls: CARD_MB_CALLS })`, `makingOfFact(ai, c.env.CACHE, ...)` and art from `spotify.search.searchAlbumByArtist(artist, album, { quiet: true })`.
  7. `'cut'` returns null and writes nothing; otherwise write the `CachedCard` (`eligible` from `eligibilityKey(considered, library)`) with `getTtlSeconds(CACHE_CONFIG.userInsights.card)`.
  8. One log line: `[Insights] <lfm> card: <tieback|making_of|none|cut> mb_calls=<n>`.
  Viewer: owner `{ person: 'second' }`, visitor `{ person: 'third', name: user.username || lfm }`. `app.get('/user-insights-trivia', requireSessionAuth, ...)`: missing username 400; `c.json({ data })`; the standard catch returns `{ error: 'Failed to load the card' }`, 500. List the route in `docs/feature-gating.md` with the other session routes.

- [ ] **Step 6: Run to verify they pass**, then `pnpm typecheck`, `pnpm test`.

- [ ] **Step 7: Commit** the files above by path: `"Serve the Did you know card from cached facts, generated only on the owner's view"`.

---

### Task 9: The card on the insights page (option B)

**Files:**
- Modify: `apps/web/src/pages/user/insights.tsx`
- Test: `apps/web/src/__tests__/pages/insights.test.ts`

**Interfaces:**
- Consumes: `GET /api/internal/user-insights-trivia` → `{ data: TriviaCard | null }` (Task 8).
- Produces: `<aside id="insights-card" class="insights-card" hidden></aside>` after `#insights-meta`; script functions `loadCard()` and `hideCard()`.

- [ ] **Step 1: Extend the harness.** `StubNode` gains `parent` (set by `appendChild`), `setAttribute`, `getAttribute` and `removeAttribute` over an attribute map, and `remove()`, which takes the node out of its parent's children. `runScript(pageHtml, summary, card = { data: null }, onFetch?)` serves the trivia URL and calls `onFetch(url, element)` synchronously inside `internalFetch`, before any response; a response may be a `deferred()` whose `resolve(body)` settles it later.

- [ ] **Step 2: Write the failing tests.**

```ts
const CARD = { kind: 'making_of', album: 'Inferno', artist: 'Boards of Canada', text: 'Inferno was recorded in two weeks.',
  sourceUrl: 'https://a.example/x', imageUrl: 'https://i.scdn.co/image/abc' };
const TRIVIA = '/api/internal/user-insights-trivia';

it('requests the card only after the summary renders', async () => {
  const summary = deferred();
  const noteAtCardFetch: Array<string | undefined> = [];
  const run = await runScript(owner, summary, { data: CARD }, (url, el) => {
    if (url.startsWith(TRIVIA)) noteAtCardFetch.push(el('insights-summary').find('insights-note')?.textContent);
  });
  expect(noteAtCardFetch).toEqual([]);
  summary.resolve({ data: week });
  await run.settle();
  expect(noteAtCardFetch).toEqual([week.note]); // the note was in the DOM at the moment the card request started
});
it('renders art, label, album and artist, text and Source link through attributes and textContent', async () => {
  const run = await runScript(owner, { data: week }, { data: CARD });
  const card = run.element('insights-card');
  expect(card.hidden).toBe(false);
  const img = card.find('insights-card-art')!;
  expect([img.getAttribute('src'), img.getAttribute('alt'), img.getAttribute('loading')]).toEqual([CARD.imageUrl, '', 'lazy']);
  expect(['insights-card-label', 'insights-card-album', 'insights-card-text'].map((c) => card.find(c)?.textContent))
    .toEqual(['Did you know', 'Inferno by Boards of Canada', CARD.text]);
  const source = card.find('insights-card-source')!;
  expect([source.textContent, source.getAttribute('href'), source.getAttribute('target'), source.getAttribute('rel')])
    .toEqual(['Source', CARD.sourceUrl, '_blank', 'noopener noreferrer']);
  expect(run.innerHtmlWrites.join('')).not.toContain(CARD.text);
  img.dispatch('error');
  expect(card.find('insights-card-art')).toBeUndefined();
});
```

Also: `shows no image or Source link for a URL that is not https` (`sourceUrl: 'javascript:alert(1)'` and `imageUrl: 'http://i.example/a'` leave both `find` results `undefined`); `keeps the card hidden and empty when data is null or the request fails` (`hidden` true, `textContent === ''`); `hides and empties the card while a refresh loads`; `never requests the card on a sparse week`; `hides [hidden] cards even though the card sets display` (the HTML contains `.insights-card[hidden] { display: none; }`).

- [ ] **Step 3: Run to verify they fail.** `pnpm --filter @listentomore/web exec vitest run src/__tests__/pages/insights.test.ts`. Expected: FAIL.

- [ ] **Step 4: Implement.** A successful `renderWeek` calls `loadCard()`; `loadInsights` calls `hideCard()` with the other loading states. Build with `createElement`, `textContent` and `setAttribute` only, with the classes and attributes the tests assert; image and link only for `https:` URLs; the image's `error` listener calls `img.remove()`. Styles in the page's `<style>` block, existing variables only: a flex row, 1rem gap and padding, 8px radius, `rgba(var(--c-base-rgb), 0.05)` background, 3px `var(--c-accent)` left border, `.insights-card[hidden] { display: none; }`, a 64px square image with `object-fit: cover`, a 14px label and source link.

- [ ] **Step 5: Run to verify they pass**, then `pnpm typecheck`, `pnpm test`.

- [ ] **Step 6: Look at it.** `pnpm dev`; open your own `/u/<you>/insights` at desktop width and with 375px device emulation. Expected: the card after the note, or nothing and no gap; no horizontal scroll.

- [ ] **Step 7: Commit** both files: `"Show the Did you know card under the weekly note"`.

---

### Task 10: Eval `--trivia`, then the owner checkpoint

**Files:**
- Modify: `apps/web/scripts/insights-eval.ts`, `insights-eval-lib.ts`, `docs/how-to/ai-models.md:47-60`
- Test: `apps/web/src/__tests__/utils/insights-eval-lib.test.ts`

**Interfaces:**
- Consumes: `collectReleases`, `spotifyReleaseLookup` (T2); `MusicBrainzCredits`, `reserveSlot`, `MUSICBRAINZ_INTERVAL_MS` (T3); `checkCopyRubric`, `libraryFrom`, `matchKey`; `makingOfFact` (T7); `generateCard`, `renderCard`, `CheckedAlbum`, `TriviaCard` from `insights-card.ts` (T8).
- Produces (`insights-eval-lib.ts`):

```ts
export interface KnownTieBack { album: string; bands: string[] }
export const KNOWN_TIEBACKS: KnownTieBack[]; // Los Ojos Del Cóndor: The Black Keys; Earthling: Red Hot Chili Peppers, Tom Petty and the Heartbreakers;
                                             // Sea Change: Nine Inch Nails; In Rainbows: The Smile
export function knownTieBackReport(checked: CheckedAlbum[], known?: KnownTieBack[]): Array<{ album: string; band: string; status: 'found' | 'missing' | 'not a candidate' }>;
export function createLocalLimiter(now?: () => number): MusicBrainzRateLimiter; // reserveSlot over in-memory state
export function factCheckLines(cards: Array<{ fixture: string; card: TriviaCard | null }>): string[]; // making-of only: '- <fixture>: <album> (<artist>): <text> <sourceUrl>'
```

- [ ] **Step 1: Write the failing tests.**

```ts
it('spaces reservations 1.1 s apart for every MusicBrainzCredits client sharing one limiter', async () => {
  let t = 0;
  const limiter = createLocalLimiter(() => t);
  const [a, b] = [new MusicBrainzCredits(createMemoryKV().kv, limiter, { maxCalls: 5 }), new MusicBrainzCredits(createMemoryKV().kv, limiter, { maxCalls: 5 })];
  const reserve = vi.spyOn(limiter, 'reserve');
  await Promise.all([a.findRelease('A', 'X'), b.findRelease('B', 'Y')]); // fetch mocked to empty searches; fake timers run the wait
  expect(await Promise.all(reserve.mock.results.map((r) => r.value))).toEqual([0, 1100]);
});
```

Also, each with its assertion: `reports known tie-backs as found, missing or not a candidate, matching names loosely` (checked `Los Ojos del Condor` with a tie-back to The Black Keys and `Sea Change` with none give, in `KNOWN_TIEBACKS` order: found, not a candidate twice for Earthling, missing for Sea Change, not a candidate for In Rainbows); `lists each making-of card with its source URL` (a making-of card, a tie-back card and null give exactly `` [`- a: Inferno (Boards of Canada): ${text} ${sourceUrl}`] ``).

- [ ] **Step 2: Run to verify they fail, implement the helpers, run them to PASS.**

- [ ] **Step 3: Extend the eval.** Start from the spike (`git diff 837623f eb04be9 -- apps/web/scripts/insights-eval.ts | git apply`) and replace its `runTrivia` with a card run. `main` builds one `createLocalLimiter()` and passes it to every fixture's `MusicBrainzCredits`, so the four concurrent fixtures share the 1.1 s spacing. With `--trivia`, per fixture:
  1. `inputs.releases = await collectReleases(inputs, spotifyReleaseLookup(spotify))`, `spotify` from `.dev.vars` (`SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`) over a fresh `createMemoryKV()`; record each `release_week` fact's salience and statement.
  2. Both notes as today, checked with `checkCopyRubric` (builder's call: the note is user-visible copy).
  3. `generateCard` as the owner with the cap lifted: `new MusicBrainzCredits(memoryKv, sharedLimiter, { maxCalls: Infinity })`, `makingOfFact` over a fresh `AIService` and memory KV, `albumArt: async () => null`, `libraryFrom(inputs.overall)`, `{ exhaustive: true }`. Record the outcome, `renderCard(card, { person: 'second' })`, MusicBrainz calls, model cost and searches, and `checkCopyRubric(text, [...noteNames(wf), every person and band in the tie-back])`.
  4. `summary.md` gains `## Release week`, `## Card` (fixture, kind, album, text, source, MusicBrainz calls, rubric hits, cost), `## Known tie-backs` and `## Fact check`. A fixture fails on a guard failure in both runs, a note rubric hit or a card rubric hit.
  5. `--dry-run --trivia` adds the spike's projection at two trivia calls per week; MusicBrainz and Spotify calls cost nothing.

- [ ] **Step 4: Run the suites and the import smoke run.** `pnpm typecheck`, `pnpm test`, then from `apps/web`: `pnpm dlx tsx scripts/insights-eval.ts --label trivia-v7 --trivia --dry-run`. Expected: the projection prints, so the eval's whole import graph loads in Node before any money is spent.

- [ ] **Step 5: The live run.** `pnpm dlx tsx scripts/insights-eval.ts --label trivia-v7 --trivia` (several minutes of MusicBrainz spacing). Merge gate: exit 0, no fixture failing the guard twice, no rubric hits on any note or card.

- [ ] **Step 6: Docs and commit.** Add the `--trivia` usage line and one paragraph to `docs/how-to/ai-models.md`; commit the four files above by path: `"Extend insights-eval with --trivia: release-week facts, the card, known tie-backs and a fact-check list"`.

- [ ] **Step 7: OWNER CHECKPOINT. Stop here.** Show the owner `apps/web/eval-output/trivia-v7/insights/summary.md`: guard and rubric results for every note, each week's card, the known tie-backs report, each `release_week` fact with its salience, and the fact-check list with source URLs to spot-check. Do not start Task 11 until he says go. A salience or template change he asks for means another Step 5 run and another stop here.

---

### Task 11: Privacy inventory, privacy page and AGENTS.md invariants

**Files:**
- Modify: `docs/privacy-data-inventory.md`, `apps/web/src/pages/legal/privacy.tsx`, `AGENTS.md`; `apps/web/src/pages/about/index.tsx` only if its "what signing in stores" bullets name insights caches
- Test: `apps/web/src/__tests__/pages/privacy.test.ts`

- [ ] **Step 1: Update the inventory**, re-verifying each row against the code and the "Last verified" line (branch `insights-trivia-card`).
  - Section 4: MusicBrainz receives the artist and album title of up to 6 albums from the owner's week and the ids of credited people, at most 10 calls per card load (30 since 2026-11-11), through the shared limiter, owner's view only, no Last.fm username. Spotify receives release-date lookups (up to 6 albums with a run this week, owner's collection only) and card-art lookups. Anthropic's third insights call, `albumTrivia` with web search, receives an artist and album name only, on the owner's view, cached for every listener. A new row for the source link: a web-search URL shown to everyone who sees the card; the browser contacts that site only on a click, with `rel="noopener noreferrer"`.
  - Section 5: `insights:card:<lower>` (per user, 8 days: album, artist, image URL, the tie-back with a band's lifetime play count or the fact and source URL, and the considered name keys); `insights:trivia:<artist>:<album>` (global, 120 days, 30 for no fact); `musicbrainz:credits:*` (global, 30 days, 7 for a miss); the Spotify search cache, now also written by release and art lookups.
  - Section 6: visitors of a public profile see the card and its play count. Section 7: deletion removes `insights:card:<lower>` by exact key; the global families expire on their own.
  - Logs: the card line carries the username, outcome and MusicBrainz call count; the insights MusicBrainz, Spotify and trivia paths log no names, texts or upstream error bodies.

- [ ] **Step 2: Draft the privacy page copy and tests.** Anthropic paragraph: the album fact (artist and album name only, only when the owner opens their insights, cached for everyone). Spotify and MusicBrainz paragraph: the insights lookups. Retention list: the card, 8 days. Visitor paragraph: visitors see the card and its play count. Bump the effective date. Tests, each a `toContain` on the rendered page: `says the album fact sends Anthropic only the artist and album name`, `names the card, its 8-day retention and that deletion removes it`, `says a visitor to a public profile sees the card and the play count it names`, `says MusicBrainz and Spotify get album and artist names from the owner's week`. Every new sentence passes `checkCopyRubric` with no names masked.

- [ ] **Step 3: OWNER CHECKPOINT for public copy.** Show the owner the privacy page and inventory diffs; commit nothing until he says go, and apply his edits first.

- [ ] **Step 4: Update `AGENTS.md` Key Constraints:**
  - Only the owner's insights request generates the card (MusicBrainz credits, Spotify release-date and art lookups, the `albumTrivia` web search); visitors read `insights:card:<user>` or get nothing.
  - MusicBrainz credits calls go through `MUSICBRAINZ_RATE_LIMITER`, at most `CARD_MB_CALLS` per card request; a request cut short caches no card.
  - Tie-backs are rendered by code (`renderTieBack`); card templates and making-of facts pass `checkCopyRubric` (`packages/services/insights/src/rubric.ts`).
  - Card text, credits and trivia text never go in a log line: MusicBrainz `logUrl: false`, Spotify `quiet: true`, Anthropic `quietErrors: true` on the trivia task.
  - `insights-card.ts` stays Node-safe because the eval imports it; Worker-only imports stay in `insights-card-route.ts` and `durable-objects/`.
  - `insights:card:<user>` is in `userExactKeys`; `insights:trivia:*` and `musicbrainz:credits:*` are global.

- [ ] **Step 5: Run the suites.** `pnpm typecheck`, `pnpm test`. Expected: PASS.

- [ ] **Step 6: Commit** (after the owner's go) `docs/privacy-data-inventory.md`, `apps/web/src/pages/legal/privacy.tsx`, `apps/web/src/__tests__/pages/privacy.test.ts`, `AGENTS.md`, and the About page only if Step 1 changed it: `"Document the trivia card's caches and third parties in the privacy inventory and policy"`.
