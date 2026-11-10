# Insights Week Facts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "Your Week in Music" summary's thin, partly wrong model input with ranked week facts computed in code, a two-to-four-sentence note that cites and is checked against those facts, and a code-rendered line for visitors.

**Architecture:** A new pure package `@listentomore/insights` turns a `WeekInputs` object into a ranked `WeekFacts` object, a prompt view, a guard and code-rendered lines; it has no network and no KV. A thin uncached `LastfmHistory` client in `@listentomore/lastfm` makes the raw calls; a collector in the insights package owns caching (UTC day partitions), caps and provenance through an injected client and KV. The existing internal route orchestrates inline: visibility check, facts, signature, note cache, model call, guard, fallback.

**Tech Stack:** TypeScript strict, Hono on Cloudflare Workers, Workers KV, D1, Vitest, pnpm + Turborepo, Claude Opus 5.5 through the existing `AnthropicClient`, Python 3 for the one-off fixture exporter.

**Spec:** `docs/superpowers/specs/2026-11-08-insights-week-facts-design.md` (phase 1 only). Reference implementation of the rules: `~/git/product-ai/05-personal/side-projects/listentomore/insights-redesign-research/step0/round2/build.py`. Where the spec and `build.py` disagree, the spec wins.

## Global Constraints

- Follow `AGENTS.md`: `// ABOUTME:` 2-line header on new files, 2-space indent, single quotes, semicolons, trailing commas, `import type` for types, the standard error-handling pattern, `{ data }` / `{ error }` responses.
- Single Worker. No new services, queues, cron triggers, background jobs or polling.
- Cache TTLs come from `packages/config/src/cache.ts` through `getTtlSeconds()`; never hardcode a TTL.
- Never cache an AI response without `isCacheableResponse()`. `maxTokens` stays 5000 for the note.
- `/api/internal/*` routes keep `requireSessionAuth` and use `getCurrentUser(c)`.
- The profile-visibility check runs before any cache read on every insights request.
- The `WeekFacts` object and the prompt view never appear in an HTTP response or a log line.
- Salience weights are frozen at the spec's values. If a fixture ranking test fails after a faithful port, stop and report; do not tune weights.
- No opinions, no adjectives for music, no em dashes in any string this code renders for users.
- User-facing copy is plain English; check new copy against `~/git/product-ai/01-context/avoid-ai-patterns.md`.
- Do not deploy, push, open a PR or run a D1 migration against production. The live eval (Task 16) spends real money and never runs in CI.
- Work on branch `insights-week-facts` in the main clone. No worktrees.
- `pnpm typecheck` and `pnpm test` pass after every task.

## Review Focus

1. **Names that contain digits or punctuation** ("blink-182", "Prophecy At 1420 MHz", "AC/DC", "(Hummingbird in the Garden)", "Sigur Rós"). A person expects the guard to treat "182" and "1420" as part of a name, not as unverified quantities, and to match names with regex-special characters. Task 8 test `ignores digits inside matched names`.
2. **Owner with no stored timezone.** A person expects dates without invented clock times and no crash. Task 1 test `labels fall back to UTC dates when timezone is null`; Task 7 test `prompt view omits times of day when timezone is null`.
3. **Scrobbles with an empty album** (singles, podcasts, radio). A person expects them to count as plays and never form or break an album run incorrectly. Task 4 test `scrobbles without an album never join a run`.
4. **Last.fm oddities**: an error body on HTTP 200, a single object where a list is expected, a now-playing row with no date. A person expects no crash and no phantom scrobble. Task 9 tests `treats a 200 error body as failure`, `wraps a single item as a list`, `drops the now-playing row`.
5. **The model returns its JSON wrapped in a code fence or with prose around it.** A person expects the note to still render, or the fallback line, never raw JSON on the page. Task 11 test `parses fenced and prefixed JSON` and Task 13 test `falls back to the code line when the model returns no parseable sentences`.

---

## File Structure

```
packages/services/insights/                 new package @listentomore/insights (pure)
  package.json, tsconfig.json, vitest.config.ts
  src/types.ts          WeekInputs, WeekFacts, Fact, Quantity, LastfmHistoryClient
  src/text.ts           norm(), day/time labels, number words
  src/window.ts         week intervals, UTC day partitions
  src/dedupe.ts         duplicate-scrobble heuristic
  src/history.ts        lifetime-before, absence, tiers, name_uncertain
  src/runs.ts           album runs, verdicts, chains
  src/tags.ts           noise and broad tag lists, buckets
  src/facts-artist.ts   discovery, volume_vs_normal, genre_cluster, returns
  src/facts-album.ts    repeat_album, single_listen, album_chain, album_mode
  src/facts-week.ts     breadth, last_week_faded, themed_block, volume
  src/rank.ts           merge, clamp, sort, quiet, question
  src/build.ts          buildWeekFacts()
  src/render.ts         prompt view, signature, code-rendered lines
  src/guard.ts          guardNote()
  src/keys.ts           KV key builders and per-user prefixes
  src/collect.ts        collectWeekInputs() with partitions, caps, provenance
  src/index.ts          exports
  __tests__/*.test.ts
  __fixtures__/*.json   committed owner weeks
packages/services/lastfm/src/history.ts     LastfmHistory (raw calls, backoff)
packages/services/ai/src/prompts/user-insights-note.ts   replaces user-insights-summary.ts
packages/db/src/migrations/011_user_timezone.sql
apps/web/src/api/internal/insights-week.ts  orchestration used by the route
apps/web/src/utils/timezone.ts              syncUserTimezone()
apps/web/src/utils/insights-cleanup.ts      deleteUserInsightsData()
apps/web/scripts/insights-eval.ts           live eval
scripts/insights-fixtures/export_inputs.py  one-off fixture exporter
```

---

### Task 1: Package scaffold, types, text, window, dedupe

**Files:**
- Create: `packages/services/insights/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/types.ts`, `src/text.ts`, `src/window.ts`, `src/dedupe.ts`, `src/index.ts`
- Test: `packages/services/insights/__tests__/window.test.ts`, `dedupe.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the types below (all later tasks use them verbatim) and:
  - `norm(s: string): string` — NFKC, lower-case, `‐` to `-`, collapse whitespace, trim.
  - `dayLabel(ts: number, tz: string | null): string` — `'Mon Nov 2'`; `timeLabel(ts: number, tz: string | null): string | null` — `'5:29 PM'`, or `null` when `tz` is null.
  - `weekWindow(now: number, weeksBack = 0): { from: number; to: number }` — half-open, 168 h each.
  - `utcDays(from: number, to: number): string[]` — `'YYYY-MM-DD'` partitions overlapping the interval.
  - `dedupe(scrobbles: Scrobble[]): { kept: Scrobble[]; dropped: Scrobble[] }`.

```ts
// src/types.ts
export interface Scrobble { artist: string; album: string; track: string; ts: number }
export interface CountList { fetchedAt: number; complete: boolean; counts: Record<string, number> } // key: norm(artist)
export interface AlbumInfo { tracklist: string[] | null; userPlaycount: number | null; fetchedAt: number }
export interface WeekInputs {
  username: string;
  timezone: string | null;            // IANA or null
  now: number;                        // T, epoch seconds
  scrobbles: Scrobble[];              // raw, ascending ts, within [now - 35 d, now)
  historyComplete: boolean;           // false when the history page cap was hit
  currentWeekTruncated: boolean;      // true when the 15-page cap was hit
  chartWeeks: Array<{ from: number; to: number; counts: Record<string, number> }>; // up to 8, all older than now - 35 d
  period: { m3: CountList; m6: CountList; m12: CountList };
  overall: CountList & { ranks: Record<string, number> };
  artistLifetime: Record<string, { count: number; fetchedAt: number }>; // key: exact artist name
  albums: Record<string, AlbumInfo>;  // key: albumKey(artist, album)
  tags: Record<string, string[]>;     // key: exact artist name; raw Last.fm order
}
export type Tier = 'first_under_this_name' | 'barely_known' | 'lapsed' | 'all_time_favourite' | 'regular' | 'occasional' | 'unknown';
export type FactKind = 'discovery' | 'repeat_album' | 'volume_vs_normal' | 'volume_spread' | 'genre_cluster' | 'returns'
  | 'breadth' | 'single_listen' | 'album_chain' | 'album_mode' | 'last_week_faded' | 'themed_block' | 'volume';
export type Unit = 'plays' | 'tracks' | 'times' | 'days' | 'months' | 'percent' | 'artists' | 'albums' | 'weeks';
export interface Quantity { value: number; unit: Unit; entity?: string }
export type QuestionKind = 'after' | 'where_from' | 'started' | 'one_sitting';
export interface QuestionOption { kind: QuestionKind; text: string }
export interface Fact {
  id: number;                 // 1-based rank, assigned in rank.ts; 0 is the window line
  kind: FactKind;
  salience: number;           // 0..100
  subject: string | null;     // artist name, tag, or null
  statement: string;          // the sentence the model reads
  entities: string[];         // every artist and album name in the statement
  quantities: Quantity[];     // every number in the statement
  dates: number[];            // epoch seconds of every day or time the statement names
  edges: QuestionOption[];
}
export interface WeekFacts {
  schema: 'week-facts/v1';
  ruleVersion: string;        // RULE_VERSION
  username: string;
  timezone: string | null;
  window: { from: number; to: number };
  pulledAt: number;
  plays: { deduped: number; raw: number; duplicatesRemoved: number };
  priorAverage: number | null;         // mean deduped plays of the 4 prior weeks, null without baseline
  baseline: 'full' | 'partial' | 'none';
  windowFact: Fact;                    // id 0
  facts: Fact[];                       // ranked, ids 1..n
  topArtists: Array<{ artist: string; plays: number; tier: Tier; nameUncertain: boolean }>;
  caveats: string[];
  quiet: boolean;
  question: (QuestionOption & { subject: string }) | null;
  names: string[];                     // every artist and album name in the week's scrobbles
}
export interface LastfmHistoryClient {
  getRecentTracksPage(from: number, to: number, page: number): Promise<{ tracks: Scrobble[]; totalPages: number }>;
  getWeeklyChartList(): Promise<Array<{ from: number; to: number }>>;
  getWeeklyArtistChart(from: number, to: number): Promise<Record<string, number>>;
  getTopArtistsPage(period: '3month' | '6month' | '12month' | 'overall', page: number):
    Promise<{ artists: Array<{ name: string; playcount: number; rank: number }>; totalPages: number }>;
  getUserArtistPlaycount(artist: string): Promise<number | null>;
  getAlbumInfo(artist: string, album: string): Promise<{ tracklist: string[] | null; userPlaycount: number | null }>;
  getArtistTopTags(artist: string): Promise<string[]>;
}
export const RULE_VERSION = 'r1';
export const albumKey = (artist: string, album: string): string => `${norm(artist)}\u0000${norm(album)}`;
```

- [ ] **Step 1: Scaffold the package.** Copy `packages/services/streaming-links/package.json` and `tsconfig.json`, name it `@listentomore/insights`, dependencies `@listentomore/config` and `@listentomore/shared` only, scripts `typecheck` and `test` (`vitest run`). `vitest.config.ts`: `environment: 'node'`, `globals: true`, `include: ['__tests__/**/*.test.ts']`. Add `"@listentomore/insights": "workspace:*"` to `apps/web/package.json`. Run `pnpm install`.

- [ ] **Step 2: Write the failing tests.**

```ts
// __tests__/window.test.ts
import { weekWindow, utcDays, dayLabel, timeLabel, norm } from '../src';
const T = Date.UTC(2026, 10, 8, 21, 17, 0) / 1000; // Sun Nov 8 2026 13:17 PST
it('weeks are half-open 168-hour intervals', () => {
  expect(weekWindow(T)).toEqual({ from: T - 604800, to: T });
  expect(weekWindow(T, 1)).toEqual({ from: T - 1209600, to: T - 604800 });
});
it('lists every UTC day the interval touches', () => {
  expect(utcDays(T - 604800, T)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
});
it('labels in the owner timezone', () => {
  expect(dayLabel(T, 'America/Los_Angeles')).toBe('Sun Nov 8');
  expect(timeLabel(T, 'America/Los_Angeles')).toBe('1:17 PM');
});
it('labels fall back to UTC dates when timezone is null', () => {
  expect(dayLabel(T, null)).toBe('Sun Nov 8');
  expect(timeLabel(T, null)).toBeNull();
});
it('a week spanning a DST change is still 168 hours', () => {
  const afterDst = Date.UTC(2026, 10, 3, 12, 0, 0) / 1000; // US DST ended Nov 1 2026
  const w = weekWindow(afterDst);
  expect(w.to - w.from).toBe(604800);
  expect(dayLabel(w.from, 'America/Los_Angeles')).toBe('Tue Oct 27');
});
it('norm folds case, width and hyphens', () => {
  expect(norm('  A‐HA  ')).toBe('a-ha');
  expect(norm('Sigur  Rós')).toBe('sigur rós');
});
```

```ts
// __tests__/dedupe.test.ts
import { dedupe } from '../src';
const s = (track: string, ts: number, artist = 'A') => ({ artist, album: 'X', track, ts });
it('drops a same-second pair from two scrobblers', () => {
  expect(dedupe([s('Oceans', 1000), s('Oceans', 1000)]).kept).toHaveLength(1);
});
it('drops a repeat under 150 seconds', () => {
  expect(dedupe([s('Numb', 1000), s('Numb', 1100)]).dropped).toHaveLength(1);
});
it('keeps a real replay of a normal-length track', () => {
  expect(dedupe([s('Invincible', 1000), s('Invincible', 1420)]).kept).toHaveLength(2);
});
it('keeps repeats more than 10 minutes apart even when timestamps collide with other tracks', () => {
  expect(dedupe([s('Briefly', 1000), s('Other', 1000), s('Briefly', 2380)]).kept).toHaveLength(3);
});
it('drops a repeat within 10 minutes when either scrobble shares its second with another track', () => {
  expect(dedupe([s('Let There Be', 1000), s('Oceans', 1300), s('Let There Be', 1300)]).dropped.map((d) => d.track)).toEqual(['Let There Be']);
});
```

- [ ] **Step 3: Run to verify they fail.** `pnpm --filter @listentomore/insights test` — FAIL, exports missing.

- [ ] **Step 4: Implement** `src/types.ts` (as above), `src/text.ts`, `src/window.ts`, `src/dedupe.ts`, `src/index.ts` (re-export everything). Labels use `Intl.DateTimeFormat('en-US', { timeZone })`. Dedupe rule, identical to `build.py`'s `dedupe`: walking in time order, a scrobble is dropped when the last kept scrobble of the same `norm(artist)` + `norm(track)` is under 600 s earlier and (the gap is under 150 s, or `near(this.ts)`, or `near(previous.ts)`), where `near(ts)` is true when any scrobble exists at `ts − 2`, `ts − 1`, `ts + 1` or `ts + 2`, or more than one scrobble has exactly `ts`.

- [ ] **Step 5: Run to verify they pass**, then `pnpm typecheck`.

- [ ] **Step 6: Commit.** `git add packages/services/insights apps/web/package.json pnpm-lock.yaml && git commit -m "Add insights package with week windows, labels and scrobble dedupe"`

---

### Task 2: Fixture exporter and committed owner weeks

**Files:**
- Create: `scripts/insights-fixtures/export_inputs.py`, `scripts/insights-fixtures/README.md`
- Create: `packages/services/insights/__fixtures__/bordesak-2026-05-24.json`, `bordesak-2026-05-31.json`, `bordesak-2026-06-12.json`, `gold.json`
- Test: `packages/services/insights/__tests__/fixtures.test.ts`

**Interfaces:**
- Consumes: `WeekInputs` (Task 1), the raw archive at `~/git/product-ai/05-personal/side-projects/listentomore/insights-redesign-research/raw-lastfm-cache.tar.gz`, `step0/lfm.py` and `step0/round2/build.py` beside it.
- Produces: `loadFixture(name: string): WeekInputs` in `__tests__/helpers.ts`; fixture files in the `WeekInputs` JSON shape.

- [ ] **Step 1: Write the exporter.** Copy `lfm.py` and sections 1 to 4 of `build.py` (scrobble loading, chart loading, lifetime and album lookups, tags) into `export_inputs.py`; delete everything from the fact-building section on. It takes `USER TAG WINDOW_END_ISO TZ` like `build.py`, reads only the extracted raw cache (`LFM_RAW` env var points at `prototype/step0/raw`; make a cache miss a hard error so it never hits the network), and writes one `WeekInputs` JSON. Mapping for a past week, where `T` is the window end:
  - `scrobbles`: raw scrobbles in `[T − 35 d, T)`, ascending.
  - `chartWeeks`: the 8 chart weeks ending before `T − 35 d`, counts keyed by `norm(artist)`.
  - `period.m3 / m6 / m12`: reconstructed as-of `T` from scrobbles plus weekly charts over the preceding 3, 6 and 12 months, including this week's plays; `fetchedAt: T`, `complete: true`.
  - `overall`: today's overall list minus chart and scrobble plays after `T`; `ranks` from today's list; `fetchedAt: T`, `complete` true only if the cached list has every page.
  - `artistLifetime[name]`: `userplaycount` minus plays after `T`; `fetchedAt: T`. Omit artists where the result is below this week's raw plays.
  - `albums[albumKey]`: tracklist from `album.getinfo`; `userPlaycount` minus album plays after `T`; `fetchedAt: T`.
  - `tags[name]`: raw tag names in order, from `getinfo` or `gettoptags`.
  - `historyComplete: true`, `currentWeekTruncated: false`, `timezone: TZ`, `now: T`.
  Write minified JSON. `README.md` records the three commands and says the other listener's week must be written to the vault (`insights-redesign-research/step0/fixtures/`), never to this repository.

- [ ] **Step 2: Export the three owner weeks.** Extract the archive to a temp directory and run, with `TZ=America/Los_Angeles`: window ends `2026-05-31T00:00`, `2026-06-07T00:00`, `2026-06-19T15:40`. Also export the other listener's week into the vault path above; its username, window end and timezone are in the vault's `insights-redesign-research/step0-round2-report.md` and are kept out of this repository.

- [ ] **Step 3: Write `gold.json`.** Keys `2026-05-24`, `2026-05-31`, `2026-06-12`; values are the owner's summaries copied verbatim from `~/git/product-ai/05-personal/side-projects/listentomore/2026-06-19-insights-voice-examples-worksheet.md` (weeks 4, 3 and 1).

- [ ] **Step 4: Write the test.**

```ts
// __tests__/fixtures.test.ts
import { loadFixture } from './helpers';
import { weekWindow } from '../src';
describe.each(['bordesak-2026-05-24', 'bordesak-2026-05-31', 'bordesak-2026-06-12'])('%s', (name) => {
  const f = loadFixture(name);
  it('has 35 days of ascending scrobbles inside the window', () => {
    expect(f.scrobbles.length).toBeGreaterThan(1000);
    expect(f.scrobbles[0].ts).toBeGreaterThanOrEqual(f.now - 35 * 86400);
    expect(f.scrobbles.at(-1)!.ts).toBeLessThan(f.now);
    expect([...f.scrobbles].sort((a, b) => a.ts - b.ts)).toEqual(f.scrobbles);
  });
  it('has 8 chart weeks older than the scrobbles and complete period lists', () => {
    expect(f.chartWeeks).toHaveLength(8);
    expect(Math.max(...f.chartWeeks.map((w) => w.to))).toBeLessThanOrEqual(f.now - 35 * 86400 + 7 * 86400);
    expect(f.period.m3.complete && f.period.m6.complete && f.period.m12.complete).toBe(true);
  });
  it('contains no other listener', () => expect(f.username).toBe('bordesak'));
});
it('the May 24 week has the raw play count the worksheet saw', () => {
  const f = loadFixture('bordesak-2026-05-24');
  const w = weekWindow(f.now);
  expect(f.scrobbles.filter((s) => s.ts >= w.from).length).toBe(488);
});
```

- [ ] **Step 5: Run.** `pnpm --filter @listentomore/insights test` — PASS. If the 488 assertion fails, compare with `step0-round2-report.md` section 1 before changing anything.

- [ ] **Step 6: Commit.** `git commit -m "Add week-inputs fixtures for three annotated weeks and the exporter that builds them"`

---

### Task 3: History, tiers and provenance

**Files:**
- Create: `packages/services/insights/src/history.ts`
- Test: `packages/services/insights/__tests__/history.test.ts`

**Interfaces:**
- Consumes: `WeekInputs`, `Scrobble`, `norm`, `weekWindow`.
- Produces:
  - `interface ArtistWeek { artist: string; plays: number; rawPlays: number; playsLastWeek: number; lifetimeBefore: number | null; absentMonths: 3 | 6 | 12 | null; tier: Tier; nameUncertain: boolean; allTimeRank: number | null }`
  - `artistWeeks(inputs: WeekInputs, weeks: Scrobble[][], rawWeeks: Scrobble[][]): Map<string, ArtistWeek>` — `weeks[0]` is this week deduped, `weeks[1]` last week; keyed by exact artist name.
  - `isNameUncertain(name: string): boolean`.

- [ ] **Step 1: Write the failing tests** with a small `makeInputs(overrides)` helper in `__tests__/helpers.ts` that returns a valid empty `WeekInputs` with `now = 1794172620`. Cases, each one `it`:

```ts
it('first under this name: nothing before, history complete', ...)          // lifetime 9 fetched after 9 raw plays -> lifetimeBefore 0, tier 'first_under_this_name'
it('barely known: 1 to 15 before', ...)                                      // lifetime 61, 50 raw this week -> 11, 'barely_known'
it('lapsed: 20+ before and absent from a complete 6-month list', ...)        // lifetime 237, 16 this week, m3 and m6 counts equal this week's plays, m12 has more -> absentMonths 6, 'lapsed'
it('absence is unknown when the period list is incomplete', ...)             // same but m6.complete false -> absentMonths null (falls to m3 if complete), never 6
it('lifetime older than some of this week is subtracted only up to fetchedAt', ...) // count 100 fetched mid-week after 4 of 10 plays -> lifetimeBefore 96
it('inconsistent snapshot is unknown', ...)                                  // lifetime 3, 10 plays before fetchedAt -> lifetimeBefore null, tier 'unknown'
it('prefers the overall list, falls back to getinfo, and takes the larger when both exist', ...)
it('all-time favourite at overall rank 25, not 26', ...)
it('credit separators make a name uncertain', () => {
  for (const n of ["Bear's Den + Paul Frith", 'Kenny Burrell & John Coltrane', 'A feat. B', 'Tyler, The Creator', 'AC/DC']) expect(isNameUncertain(n)).toBe(true);
  for (const n of ['Boxer Rebellion', 'Andy Shauf', 'The xx', 'Withered Hand']) expect(isNameUncertain(n)).toBe(false);
});
it('an uncertain name with no history is never first_under_this_name', ...)  // tier 'unknown', nameUncertain true
```

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement.** `lifetimeNow` = max of `inputs.overall.counts[norm]` and `inputs.artistLifetime[name]?.count`, each paired with its own `fetchedAt`; `lifetimeBefore = count − raw plays this week with ts ≤ that fetchedAt`; negative or missing gives `null`. `absentMonths` = the largest of 12, 6, 3 whose list is `complete` and whose count minus this week's raw plays (ts ≤ list `fetchedAt`) is 0. Tier order: `unknown` (no lifetime) → `first_under_this_name` (0 before, not uncertain; uncertain becomes `unknown`) → `barely_known` (1..15) → `lapsed` (≥ 20 and `absentMonths` set) → `all_time_favourite` (rank ≤ 25) → `regular` (in the m6 top 40 by count, or `absentMonths` null) → `occasional`. Credit tokens: whole-word `&`, `and`, `feat`, `feat.`, `ft`, `ft.`, `x`, `with`, `+`, or any `,` or `/`.

- [ ] **Step 4: Run to verify they pass.**

- [ ] **Step 5: Commit.** `git commit -m "Derive familiarity tiers from history with provenance"`

---

### Task 4: Album runs and verdicts

**Files:**
- Create: `packages/services/insights/src/runs.ts`
- Test: `packages/services/insights/__tests__/runs.test.ts`

**Interfaces:**
- Consumes: `Scrobble`, `AlbumInfo`, `albumKey`, `norm`.
- Produces:
  - `type Verdict = 'start_to_finish' | 'most_of' | 'mislabelled' | 'unverified'`
  - `interface AlbumRun { artist: string; album: string; from: number; to: number; tracksPlayed: number; tracklistLength: number | null; coverage: number | null; verdict: Verdict; phrase: string }`
  - `albumRuns(week: Scrobble[], albums: Record<string, AlbumInfo>): AlbumRun[]` — only candidates, longest first.
  - `albumChains(runs: AlbumRun[]): AlbumRun[][]` — 3+ `start_to_finish` runs with under 30 minutes between each.
  - `albumModeShare(week: Scrobble[]): number` — share of plays inside same-album runs of 8+ distinct tracks.

- [ ] **Step 1: Write the failing tests.** Build scrobble sequences with a helper `play(artist, album, tracks: string[], startTs, gap = 240)`. Tracklist `TEN = ['t1', ..., 't10']`.

```ts
it('whole album in order is start_to_finish', ...)                 // 10/10 -> verdict 'start_to_finish', phrase 'A start to finish'
it('an ordered excerpt missing both ends is most_of', ...)         // t2..t9 of 10 -> 'most_of', phrase '8 of 10 tracks of A, in order'
it('nine of ten including first and last, one swap, is start_to_finish', ...)
it('more than 30% off-list tracks is mislabelled', ...)            // 15 played, 11 not on the 11-track list
it('a tracklist shorter than the tracks played is unverified, never mislabelled', ...) // 10 played vs 1-track list -> 'unverified', phrase '10 tracks in a row from A'
it('no tracklist is unverified', ...)
it('a 4-track EP played whole is a candidate', ...)                // 4/4 -> 'start_to_finish'
it('four tracks of a ten-track album are not a candidate', ...)    // albumRuns returns []
it('a gap over 90 minutes splits a run', ...)
it('scrobbles without an album never join a run', ...)             // album '' interleaved -> the empty-album plays form no run and split nothing they are not between
it('a multi-artist compilation forms no run', ...)                 // 12 tracks, one album name, 12 different artists -> albumRuns returns []
it('a repeated track counts once toward coverage', ...)
it('titles match across " - 2007 Remaster" suffixes', ...)
it('three full albums 10 minutes apart form a chain; a 45-minute break ends it', ...)
```

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement.** Runs: consecutive scrobbles with equal `albumKey` and non-empty album, gaps ≤ 5400 s. Candidate: ≥ 6 distinct tracks, or ≥ 4 when the tracklist has 4 or 5 tracks and the run covers all of it. Title match: equal after `norm`, or one is a prefix of the other, or equal before `' - '`. Verdicts exactly as the spec's table (90% with first and last and ≥ 80% in order and ≤ 10% off-list; ≥ 60% in order; > 30% off-list; otherwise `unverified`, and always `unverified` when `tracklist` is null or shorter than the distinct tracks played). In-order = fraction of adjacent matched indices that increase.

- [ ] **Step 4: Run to verify they pass.**

- [ ] **Step 5: Commit.** `git commit -m "Detect album runs and grade them against tracklists"`

---

### Task 5: Artist-level facts and tags

**Files:**
- Create: `packages/services/insights/src/tags.ts`, `src/facts-artist.ts`
- Modify: `packages/services/insights/src/types.ts` (add `Draft` and `FactContext`)
- Test: `packages/services/insights/__tests__/facts-artist.test.ts`

**Interfaces:**
- Consumes: `ArtistWeek` (Task 3), `AlbumRun` (Task 4), `Fact`, `WeekInputs`, labels.
- Produces:
  - `cleanTags(raw: string[]): string[]` — drops `NOISE_TAGS` and tags containing a digit, keeps the first 3.
  - `BROAD_TAGS: Set<string>`, `bucketOf(tags: string[]): string | null`.
  - `type Draft = Omit<Fact, 'id'>` (exported from `src/types.ts`).
  - `interface FactContext { inputs: WeekInputs; artists: Map<string, ArtistWeek>; runs: AlbumRun[]; week: Scrobble[]; rawWeeks: Scrobble[][]; weeks: Scrobble[][]; baseline: 'full' | 'partial' | 'none' }` (exported from `src/types.ts`).
  - `artistFacts(ctx: FactContext): Draft[]`.

- [ ] **Step 1: Write the failing tests.** Each builds a `FactContext` by hand. Assert salience to one decimal, `kind`, `subject`, and that `entities` and `quantities` carry what the statement says.

```ts
it('discovery scales with plays: barely known at 39 plays scores 94', ...)      // 40 + 60*0.9*min(1, 39/30) = 94.0
it('discovery needs 8 plays', ...)
it('first under this name at 9 plays scores 58', ...)                           // 40 + 60*1.0*0.3
it('discovery statement names the run and the days', ...)                       // contains 'only 3 plays before this week, 39 this week', 'played on 2 days (Mon Jun 15, Thu Jun 18)'
it('volume against normal: 41 plays against 6 a week scores 83.6', ...)         // 45 + 8*log2(41/6) + 16.4
it('volume ratio uses raw counts on both sides', ...)                           // raw 50 vs chart mean 6 -> ratio 8.33
it('volume fact is suppressed without a full baseline', ...)                    // ctx.baseline 'partial' -> none
it('volume fact is suppressed for new and lapsed artists', ...)
it('a zero average is treated as 0.5, never a divide by zero', ...)
it('four lapsed jazz artists form a cluster scoring 87', ...)                   // 55 + 8*4; subject 'jazz'; statement starts 'Four jazz artists came back in one week'
it('broad tags never name a cluster', ...)                                      // three artists sharing only 'indie rock' -> no cluster
it('an artist joins at most one cluster, the largest', ...)
it('artists without tags join no cluster and break nothing', ...)               // inputs.tags missing for two of three candidates -> no cluster, no throw
it('returns: lapsed artists outside clusters become one fact', ...)             // 45 + min(25, total/2) + 5 if any 12 months
it('absence is phrased against the boundary', ...)                              // contains 'none in the 6+ months before this week'; never contains 'since' or 'first time'
it('an edge is attached for first under this name and for a 12-month return', ...) // edges kinds 'where_from','started'; 'started' text 'What got you back into jazz this week?'
it('no "stop" edge unless plays span 2+ days and end 36+ hours before the window end', ...) // kind 'after', text 'What happened with Eternal Embers after Wed Nov 4?'
```

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement** by porting `build.py` lines 340 to 422 with these spec changes: tier name `first_under_this_name`; statements say "first plays under this name"; the gap edge's kind is `after` and its wording never says "stopped"; clamp every score to 0..100; skip `volume_vs_normal` unless `ctx.baseline === 'full'`; populate `entities`, `quantities` (with `entity` set when the number belongs to one artist or album) and `dates` for every value interpolated into the statement. Copy `STOP`, `NOISE`, `BROAD` and `BUCKETS` from `build.py` into `tags.ts`.

- [ ] **Step 4: Run to verify they pass.**

- [ ] **Step 5: Commit.** `git commit -m "Add artist-level week facts: discovery, volume against normal, genre clusters, returns"`

---

### Task 6: Album-level and week-level facts

**Files:**
- Create: `packages/services/insights/src/facts-album.ts`, `src/facts-week.ts`
- Test: `packages/services/insights/__tests__/facts-album.test.ts`, `facts-week.test.ts`

**Interfaces:**
- Consumes: `FactContext`, `Draft`, `AlbumRun`, `albumChains`, `albumModeShare`, `bucketOf`.
- Produces: `albumFacts(ctx: FactContext): Draft[]`, `weekFacts(ctx: FactContext): Draft[]`.

- [ ] **Step 1: Write the failing tests.**

```ts
// facts-album
it('two start_to_finish listens of a new album score 100', ...)                 // 40 + 10*2 + 40*1.0
it('three listens of a familiar album score 74', ...)                           // 40 + 30 + 40*0.1
it('most_of runs never count toward a repeat', ...)
it('album familiarity is "less than one full listen" under one tracklist of prior plays', ...)
it('a single 36-track unverified run is notable as long and new', ...)          // 45 + 25 + 10; statement contains '36 tracks in a row from Capri (Remastered 2026)'
it('a single listen fires for a genre outlier', ...)                            // top tag not in week top 10 -> +10
it('a familiar in-genre full listen under 20 tracks does not fire', ...)
it('three albums back to back make a chain at 60', ...)
it('album mode fires only when strictly the highest of five weeks', ...)        // tie -> no fact
// facts-week
it('wide week: 27 artists at 10+ against a median of 18 scores 75', ...)        // 60 + 30*(27/18 - 1)
it('15 against a median of 18 is not wide', ...)
it('narrow week needs a median of at least 4', ...)
it('last week faded lists top artists at 10% or less', ...)
it('volume fires at +/-20% against the 4-week average', ...)
it('week-level baseline facts are suppressed when the baseline is partial or none', ...)
it('themed block needs 60 minutes, 12 plays, 4 artists and a bucket under 15% of the week', ...)
```

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement** by porting `build.py` lines 356 to 373 and 423 to 468, with `start_to_finish` in place of `full`, clamping, and typed `entities` / `quantities` / `dates`. Breadth counts artists with ≥ 10 raw plays this week against the median of the same count over the 12 baseline weeks (4 raw scrobble weeks + 8 chart weeks).

- [ ] **Step 4: Run to verify they pass.**

- [ ] **Step 5: Commit.** `git commit -m "Add album-level and week-level facts"`

---

### Task 7: Ranking, question, buildWeekFacts, prompt view, lines

**Files:**
- Create: `packages/services/insights/src/rank.ts`, `src/build.ts`, `src/render.ts`
- Test: `packages/services/insights/__tests__/build.test.ts`, `render.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 6.
- Produces:
  - `rankFacts(drafts: Draft[]): Fact[]` — merge, clamp, sort (salience desc, then plays desc, then name), assign ids from 1.
  - `chooseQuestion(facts: Fact[], last: { kind: QuestionKind; subject: string } | null): WeekFacts['question']`
  - `buildWeekFacts(inputs: WeekInputs, opts?: { lastQuestion?: { kind: QuestionKind; subject: string } | null }): WeekFacts`
  - `QUIET_THRESHOLD = 50`
  - `renderPromptView(wf: WeekFacts): string`
  - `noteSignature(wf: WeekFacts, promptVersion: string): Promise<string>` — first 16 hex chars of SHA-256 over `[wf.ruleVersion, promptVersion, top-six ids and statements, top-artists line, caveats]`; excludes window timestamps and `pulledAt`.
  - `renderLine(wf: WeekFacts, person: 'second' | 'third'): string` — the code-rendered sentence for the rank-1 fact, or the quiet sentence.

- [ ] **Step 1: Write the failing tests.**

```ts
// build.test.ts
import { buildWeekFacts, QUIET_THRESHOLD } from '../src';
import { loadFixture, makeInputs } from './helpers';
it('May 24 leads with the jazz cluster, then Boards of Canada', () => {
  const wf = buildWeekFacts(loadFixture('bordesak-2026-05-24'));
  expect(wf.facts[0]).toMatchObject({ id: 1, kind: 'genre_cluster', subject: 'jazz' });
  expect(wf.facts[1]).toMatchObject({ kind: 'volume_vs_normal', subject: 'Boards of Canada' });
  expect(wf.question?.text).toBe('What got you back into jazz this week?');
  expect(wf.plays).toMatchObject({ raw: 488, deduped: 455 });
});
it('Jun 12 leads with Siiga, then Celer and The Police', () => {
  const wf = buildWeekFacts(loadFixture('bordesak-2026-06-12'));
  expect(wf.facts.slice(0, 3).map((f) => f.subject)).toEqual(['Siiga', 'Celer', 'The Police']);
  expect(wf.facts[0].kind).toBe('discovery');
  expect(wf.question).toBeNull();
});
it('May 31 leads with the Death Cab repeat', () => {
  expect(buildWeekFacts(loadFixture('bordesak-2026-05-31')).facts[0]).toMatchObject({ kind: 'repeat_album', subject: 'Death Cab for Cutie' });
});
it('never claims a first for a name with uncertain or unknown history', () => {
  for (const n of ['bordesak-2026-05-24', 'bordesak-2026-05-31', 'bordesak-2026-06-12'])
    for (const f of buildWeekFacts(loadFixture(n)).facts)
      if (f.statement.includes('first plays')) expect(f.statement).toContain('first plays under this name');
});
it('an empty week is quiet with no facts and no question', () => {
  const wf = buildWeekFacts(makeInputs({}));
  expect(wf.quiet).toBe(true); expect(wf.facts).toEqual([]); expect(wf.question).toBeNull();
});
it('a new account with one prior week has no baseline facts', ...)            // baseline 'none'; no volume_vs_normal, breadth, album_mode, volume
it('a truncated current week adds a caveat and drops share facts', ...)       // currentWeekTruncated true
it('a partial history marks the baseline partial', ...)                       // historyComplete false
it('scores are clamped to 100 and ties break by plays then name', ...)
it('a single listen folds into a stronger fact about the same artist', ...)
it('a discovery inside a cluster is dropped', ...)
it('the question keeps the same text for the same subject and rotates kind for a new one', ...)
it('no question when neither of the top two facts has an edge', ...)
it('a 25-play week with a 9-play first-timer is not quiet', ...)              // top salience 58 >= QUIET_THRESHOLD
```

```ts
// render.test.ts
it('prompt view lists the window line as fact 0 and the top six facts by id', ...)   // lines '0. Week: ...', '1. ...' ... '6. ...'; no line '7.'
it('prompt view never contains a question', ...)                                    // no '?' on any line
it('prompt view omits times of day when timezone is null', ...)                     // no /\d{1,2}:\d{2} (AM|PM)/
it('signature ignores the window and pulledAt, changes with any top-six statement', ...)
it('signature changes with the rule version and the prompt version', ...)
it('second-person line for a repeat album', ...)   // 'You played Eternal Embers by Meltt start to finish 3 times this week.'
it('third-person line uses the username', ...)     // 'bordesak played Eternal Embers by Meltt start to finish 3 times this week.'
it('every fact kind has a line in both persons and none contains an em dash', ...)
it('quiet lines by volume', ...)
// plays < 80% of average: 'A quiet week: 30 plays. Nils Frahm came up most.'
// otherwise:              'Nothing stood out this week: 412 plays, led by Nils Frahm.'
// third person:           "A quiet week for bordesak: 30 plays. Nils Frahm came up most."
```

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement.** `buildWeekFacts`: split `inputs.scrobbles` into five raw weeks with `weekWindow`, dedupe each, compute `baseline` (`none` under 4 prior weeks with any plays or under 4 usable baseline weeks; `partial` when `!historyComplete`; else `full`), build `FactContext`, concatenate the three fact functions, `rankFacts`, `chooseQuestion`, fill `windowFact` (id 0: "Week: <from> to <to> (rolling 7 days). N plays; the usual week is about M." with quantities), `topArtists` (top 8), `caveats` (mislabelled runs, truncation, "counts exclude likely duplicate scrobbles"), `names`. Merging rules and question rules exactly as spec section 2. `renderLine` has one template per `FactKind` built from the fact's structured fields, never by editing `statement`.

- [ ] **Step 4: Run to verify they pass.** If a fixture lead differs, stop and report the top six with saliences; do not change weights.

- [ ] **Step 5: Commit.** `git commit -m "Rank week facts, choose the question in code, render the prompt view and fallback lines"`

---

### Task 8: The guard

**Files:**
- Create: `packages/services/insights/src/guard.ts`
- Test: `packages/services/insights/__tests__/guard.test.ts`

**Interfaces:**
- Consumes: `WeekFacts`, `Fact`, `norm`.
- Produces: `interface NoteSentence { text: string; facts: number[] }`, `guardNote(sentences: NoteSentence[], wf: WeekFacts): { ok: boolean; failures: string[] }`.

- [ ] **Step 1: Write the failing tests** against `buildWeekFacts(loadFixture('bordesak-2026-05-24'))` and the `05-31` and `06-12` weeks. Cite facts by looking up ids by kind and subject in the test, not by hardcoded id.

```ts
it('passes the round 2 May 24 note', ...)
// s1 'Four jazz names came back to you this week: Wes Montgomery with 8 plays, Wayne Shorter and Joe Henderson with 6 each, and Grant Green with 5, and Joe Henderson had been gone for 12+ months.' cites the jazz cluster
// s2 'Boards of Canada took over Friday with 41 plays, including Inferno start to finish.' cites the BoC fact
it('accepts number words, "twice", full weekday names and "a year" for 12 months', ...)
// 'You played I Built You A Tower by Death Cab for Cutie start to finish twice, on Friday and Saturday, after it had only one track play before this week.'
// 'Joe Henderson returned after a year away.'
it('rejects a count moved to another artist', ...)                 // 'Grant Green had 41 plays' citing both facts -> failure mentions '41'
it('rejects a name from the week that is not in the cited facts', ...) // mentions 'Tracy Chapman' while citing only the jazz cluster
it('rejects a number in no cited fact', ...)
it('rejects "for the first time" unless a cited fact is a first-under-this-name discovery, and then only as "first plays under this name"', ...)
it('rejects one sentence, five sentences, a sentence citing nothing, and a first sentence that does not cite fact 1', ...)
it('rejects a weekday the cited facts do not carry', ...)          // 'on Tuesday' when dates are Fri and Sat
it('ignores digits inside matched names', ...)                     // 'Prophecy At 1420 MHz', 'blink-182' in names -> not treated as quantities
it('matches names with regex-special characters and diacritics', ...) // '(Hummingbird in the Garden)', 'Sigur Rós', 'AC/DC'
it('fact 0 may be cited for the week total and average', ...)
it('rejects an em dash and a question mark in any sentence', ...)
```

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement** the four rules of spec section 3. Order: shape; mask every occurrence of every name in `wf.names` (longest first, on `norm`-ed text, escaping nothing because matching is by `indexOf`) and check each masked name is in the cited facts' `entities`; on the masked text, extract quantities (digits; `one`..`twelve`; `once`, `twice`, `N times`; `a|an` before a unit word; `a year` = 12 months, `half a year` = 6 months) and require each to equal a `Quantity.value` in the cited facts, applying the entity tie when the sentence names exactly one cited entity; weekday and month names must match a cited fact's `dates` rendered in `wf.timezone`; banned phrases `first time`, `first ever`, `never`. `failures` are short machine-readable strings; they are logged, not shown.

- [ ] **Step 4: Run to verify they pass.**

- [ ] **Step 5: Commit.** `git commit -m "Guard each note sentence against the facts it cites"`

---

### Task 9: Last.fm history client

**Files:**
- Create: `packages/services/lastfm/src/history.ts`
- Modify: `packages/services/lastfm/src/index.ts` (export `LastfmHistory`; add `public readonly history: LastfmHistory` to `LastfmService`)
- Test: `apps/web/src/__tests__/services/lastfm-history.test.ts`

**Interfaces:**
- Consumes: `fetchWithTimeout` from `@listentomore/shared`.
- Produces: `class LastfmHistory` with exactly the seven methods of `LastfmHistoryClient` (Task 1). It satisfies that interface structurally; `@listentomore/lastfm` does not import `@listentomore/insights`. `class LastfmApiError extends Error { code: number | null; status: number }`.

- [ ] **Step 1: Write the failing tests** with `setupFetchMock` from `__tests__/utils/mocks`.

```ts
it('requests a time range with extended=1 and limit=200', ...)       // URL contains 'method=user.getrecenttracks', 'from=100', 'to=200', 'limit=200', 'extended=1', 'page=2'
it('maps tracks to scrobbles in ascending time', ...)
it('drops the now-playing row', ...)                                  // a track with '@attr': { nowplaying: 'true' } and no date is excluded
it('wraps a single item as a list', ...)                              // recenttracks.track is one object, not an array
it('treats a 200 error body as failure', ...)                         // { error: 6, message: 'User not found' } -> rejects with LastfmApiError code 6
it('retries error 29 and HTTP 429 twice, then fails', ...)            // fetch called 3 times
it('weekly chart list returns from/to numbers', ...)
it('weekly artist chart keys by normalised name and sums duplicate entities', ...)
it('top artists page returns totalPages and 1-based ranks', ...)      // limit=1000
it('user artist playcount is null when stats are missing', ...)
it('album info returns a tracklist and a user playcount, null tracklist when Last.fm has none', ...)
it('album info for an unknown album returns nulls, not an error', ...) // HTTP 400 with error 6 body
it('artist top tags returns names in order', ...)
```

- [ ] **Step 2: Run to verify they fail.** `pnpm --filter @listentomore/web exec vitest run src/__tests__/services/lastfm-history.test.ts`

- [ ] **Step 3: Implement.** One private `call(params)` that builds the URL, uses `fetchWithTimeout(url, { timeout: 'fast' })`, parses the body before trusting `response.ok`, throws `LastfmApiError`, and retries code 29 or status 429 with 1 s then 2 s waits. No caching in this class. `autocorrect=0` on `artist.getinfo`, `album.getinfo` and `artist.gettoptags`. The weekly chart is keyed with the same `norm` rule as the insights package; duplicate it as a private helper here with a comment naming `packages/services/insights/src/text.ts`.

- [ ] **Step 4: Run to verify they pass**, then `pnpm typecheck`.

- [ ] **Step 5: Commit.** `git commit -m "Add an uncached Last.fm history client with backoff"`

---

### Task 10: Input collector with day partitions, caps and provenance

**Files:**
- Create: `packages/services/insights/src/keys.ts`, `src/collect.ts`
- Modify: `packages/config/src/cache.ts`
- Test: `packages/services/insights/__tests__/collect.test.ts`

**Interfaces:**
- Consumes: `LastfmHistoryClient`, `WeekInputs`, `utcDays`, `weekWindow`, `dedupe`, `albumRuns` (to pick album lookups), `artistWeeks` is NOT used here.
- Produces:
  - `keys` object: `scrobbleDay(user, day)` → `lastfm:scrobbles:<user>:<day>`; `chart(user, from, to)` → `lastfm:chart:<user>:<from>-<to>`; `topList(user, period)` → `lastfm:toplist:<user>:<period>`; `userArtist(user, artist)` → `lastfm:userartist:<user>:<norm>`; `tracklist(artist, album)` → `lastfm:tracklist:<norm>:<norm>`; `userAlbum(user, artist, album)` → `lastfm:useralbum:<user>:<norm>:<norm>`; `topTags(artist)` → `lastfm:toptags:<norm>`; `facts(user)` → `insights:facts:<user>`; `question(user)` → `insights:question:<user>`; `generating(user)` → `insights:generating:<user>`; `last(user)` → `insights:last:<user>` (holds `{ signature }` of the note last served to the owner). `<user>` is the Last.fm username lower-cased.
  - `userKeyPrefixes(user: string): string[]` — only the multi-key families, each ending in `:` so one user's prefix can never match another's: `lastfm:scrobbles:<user>:`, `lastfm:chart:<user>:`, `lastfm:toplist:<user>:`, `lastfm:userartist:<user>:`, `lastfm:useralbum:<user>:`, `ai:userInsightsSummary:<user>:`.
  - `userExactKeys(user: string): string[]` — the single-key families: `facts`, `question`, `generating`, `last`. These are deleted by exact key, never by prefix (`insights:facts:alice` is a prefix of `insights:facts:alice2`).
  - `CAPS = { currentWeekPages: 15, historyPages: 20, albumLookups: 20, artistLookups: 25, tagLookups: 45, totalFetches: 150 }`
  - `class InsightsFetchError extends Error`
  - `collectWeekInputs(args: { client: LastfmHistoryClient; kv: KVNamespace; username: string; timezone: string | null; now: number; defer?: (p: Promise<unknown>) => void }): Promise<WeekInputs>`

- [ ] **Step 1: Add cache config.** In `CACHE_CONFIG.lastfm`: `scrobbleDay: { ttlDays: 40 }`, `weeklyChart: { ttlDays: 40 }`, `periodList: { ttlHours: 24 }`, `overallList: { ttlDays: 7 }`, `userArtistCount: { ttlHours: 24 }`, `albumTracklist: { ttlDays: 30 }`, `userAlbumCount: { ttlHours: 24 }`, `artistTopTags: { ttlDays: 30 }`. In `CACHE_CONFIG.userInsights`: `weekFacts: { ttlHours: 24 }`, `note: { ttlDays: 8 }`, `generatingMarker: { ttlMinutes: 1 }`, `questionState: { ttlDays: 60 }`.

- [ ] **Step 2: Write the failing tests** with a fake client that records calls and `createMockKV` copied into `__tests__/helpers.ts` (the web app's mock is not importable from this package).

```ts
it('fetches a completed UTC day once and serves it from KV afterwards', ...)   // second collect with now + 3600: no call whose range lies inside a completed day
it('always refetches the current UTC day', ...)
it('moving the window by a day reuses every cached day it still overlaps', ...) // at most 2 recent-track calls on the second run
it('filters partition contents to [now - 35 d, now)', ...)
it('stops history at 20 pages, marks historyComplete false, and still caches the days it got', ...)
it('stops the current week at 15 pages and sets currentWeekTruncated', ...)
it('throws InsightsFetchError when the current week cannot be fetched and writes nothing', ...)
it('fetches period lists page by page to totalPages, capped at 3, and records complete', ...)
it('records fetchedAt on every list, lifetime count and album', ...)
it('looks up at most 25 artists, 20 albums (longest runs first) and 45 tag sets', ...)
it('stores the tracklist globally and the user count per user', ...)          // kv keys 'lastfm:tracklist:...' has no username and no count; 'lastfm:useralbum:alice:...' has the count
it('never serves one user's album count to another', ...)                     // collect for alice then bob with different counts
it('stops at 150 total fetches and returns what it has', ...)
it('a cold generation stays under 500 KV operations', ...)                    // count kv.get + kv.put on the mock for a 400-play fixture-sized week; the Workers limit is 1,000 per invocation and the route adds a few more
it('a failing tag or album lookup is skipped, not fatal', ...)
it('picks 8 chart weeks that end before the 35-day span', ...)
```

- [ ] **Step 3: Run to verify they fail.**

- [ ] **Step 4: Implement.** Concurrency 4. Order: current UTC day and uncached days newest first (so the current week is complete before history); then chart list and 8 charts; period and overall lists; dedupe this week's scrobbles to choose the top 25 artists with 4+ plays for `getUserArtistPlaycount`, the runs for `getAlbumInfo`, and the tag targets (new, lapsed-looking, run artists, top 40 by plays). Each day partition stores every scrobble with a timestamp in that UTC day. KV writes go through `args.defer` when given, else are awaited. A page fetch that fails after retries inside the current week raises `InsightsFetchError`; inside history it ends history with `historyComplete: false`.

- [ ] **Step 5: Run to verify they pass**, then `pnpm typecheck`.

- [ ] **Step 6: Commit.** `git commit -m "Collect week inputs through UTC day partitions with caps and provenance"`

---

### Task 11: The note prompt; remove the old summary prompt

**Files:**
- Create: `packages/services/ai/src/prompts/user-insights-note.ts`
- Delete: `packages/services/ai/src/prompts/user-insights-summary.ts`
- Modify: `packages/services/ai/src/prompts/index.ts`, `packages/services/ai/src/index.ts`, `packages/config/src/ai.ts` (comment on `userInsightsSummary` only), `apps/web/scripts/ai-eval.ts`, `apps/web/scripts/ai-eval-inputs.json`
- Test: `apps/web/src/__tests__/services/ai.test.ts` (replace the insights-summary tests)

**Interfaces:**
- Consumes: `ChatClient`, `getTaskConfig`.
- Produces:
  - `USER_INSIGHTS_PROMPT_VERSION = 'v4'`
  - `interface NoteSentence { text: string; facts: number[] }` (same shape as the guard's; declared here too, no cross-package import)
  - `buildUserInsightsNoteMessages(promptView: string): ChatMessage[]`
  - `parseNoteSentences(raw: string): NoteSentence[] | null`
  - `generateUserInsightsNote(promptView: string, client: ChatClient): Promise<{ sentences: NoteSentence[] | null; raw: string; metadata?: AIResponseMetadata }>` — no cache inside; the route owns caching.
  - `AIService.getUserInsightsNote(promptView: string)` replacing `getUserInsightsSummary`.

- [ ] **Step 1: Write the failing tests.**

```ts
it('system prompt is the friend-who-follows-scrobbles line', ...)
// "You're a friend who follows someone's scrobbles. Once a week you send them a short note about what they played."
it('user prompt carries the prompt view, asks for JSON sentences with cited fact ids, and contains no example note', ...)
// contains the view verbatim; contains '"facts"'; does not contain 'Boards of Canada immersion' or 'Here are a few summaries'
it('user prompt has no question instruction', ...)                 // does not contain 'question'
it('parses a bare JSON array', ...)
it('parses fenced and prefixed JSON', ...)                         // '```json\n[...]\n```' and 'Here is the note:\n[...]'
it('returns null for prose, for an empty array, and for items missing text or facts', ...)
it('requests the configured model, effort and max tokens', ...)    // claude-opus-5-5, reasoning 'low', maxTokens 5000
it('no export named containsForbiddenConstruction or buildUserInsightsMessages remains', ...) // import * as ai from '@listentomore/ai'
```

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement.** User prompt, exactly:

```
Here is this week's listening, already measured and ranked. It is the only thing you know.

{PROMPT_VIEW}

Write the note, in second person. Two to four sentences. Lead with the most notable item (fact 1). If two or three of the top items connect in a way the facts themselves show, say so in one sentence; if they don't connect, say only the top one or two things. Under 90 words. No greeting, no sign-off, no emoji, no question.

Rules:
- Use only what is in the facts. If something is not listed, it did not happen. Quote no number that is not there, and do no arithmetic beyond what the facts state.
- Say nothing about how the music sounds. No adjectives for music, records or songs. You have not heard these records.
- Do not guess at reasons, moods, taste or personality, and do not say what a choice "says" about them.
- Do not contrast by negation ("not X, it's Y", "rather than", "less X, more Y"). No em dashes. No cliches.
- Plain words. Mix short and long sentences. Use artist and album names exactly as given.

Return only a JSON array, one object per sentence: [{"text": "...", "facts": [1]}]. "facts" lists the numbers of the facts that sentence draws on.
```

Then: delete the old prompt file and its exports; in `ai-eval.ts` remove the `userInsightsSummary` cases, its entry in `TITLE_LINE_TASKS` and the scrub-pass comment, and import `InsightsListeningData` from the recommendations prompt's `ListeningData` (re-export it under that name from `prompts/index.ts`); leave `ai-eval-inputs.json`'s `insights` block for the recommendations cases. Run `grep -rn "getUserInsightsSummary\|containsForbiddenConstruction\|buildUserInsightsMessages" apps packages --include='*.ts' --include='*.tsx'` and expect only `apps/web/src/api/internal/insights.ts`, which Task 13 rewrites; stub that one call site to throw `new Error('replaced in Task 13')` so the tree typechecks.

- [ ] **Step 4: Run to verify they pass**, `pnpm typecheck`, `pnpm test`.

- [ ] **Step 5: Commit.** `git commit -m "Replace the insights summary prompt with a structured note; drop few-shots and the scrub pass"`

---

### Task 12: Owner timezone

**Files:**
- Create: `packages/db/src/migrations/011_user_timezone.sql`, `apps/web/src/utils/timezone.ts`
- Modify: `packages/db/src/schema.ts` (`timezone: string | null` on `User`), `packages/db/src/index.ts` (`updateUser` accepts `timezone`), `apps/web/src/middleware/session.ts`
- Test: `apps/web/src/__tests__/utils/timezone.test.ts`

**Interfaces:**
- Produces: `syncUserTimezone(c: Context, user: User | null): void` — when `c.req.raw.cf?.timezone` is a string that `Intl.DateTimeFormat` accepts and differs from `user.timezone`, schedule `db.updateUser(user.id, { timezone })` through `getWaitUntil(c)` (or an unawaited, error-logged promise). Called from `sessionMiddleware` after the eager lookup, so it runs on pages and never on `/api/internal/*`.

- [ ] **Step 1: Write the migration.** Number 009 is `009_entity_pages.sql` (merged in PR #53) and 010 is claimed by `010_referrals.sql` on `feat/lastfm-mcp-lookup`, which ships first. Use `011_user_timezone.sql`; if the lookup branch was abandoned, use the next free number on `main` and update this plan and the spec to match.

```sql
-- Add the owner's IANA timezone, set from the request's cf.timezone on signed-in page loads.
-- Run with: wrangler d1 execute listentomore --remote --file=./011_user_timezone.sql
ALTER TABLE users ADD COLUMN timezone TEXT;
```

- [ ] **Step 2: Write the failing tests.**

```ts
it('stores a new timezone for a signed-in user', ...)            // updateUser called with ('user-1', { timezone: 'America/Los_Angeles' })
it('does nothing when the timezone is unchanged', ...)
it('does nothing for an anonymous request or a missing cf object', ...)
it('ignores a value Intl rejects', ...)                           // cf.timezone 'Not/AZone'
it('a failed write is logged and never throws', ...)
```

- [ ] **Step 3: Run to verify they fail; implement; run to verify they pass**, then `pnpm typecheck`.

- [ ] **Step 4: Commit.** `git commit -m "Store the owner's timezone from signed-in page loads"`. The owner runs the migration against production before deploy; do not run it.

---

### Task 13: Route orchestration

**Files:**
- Create: `apps/web/src/api/internal/insights-week.ts`
- Modify: `apps/web/src/api/internal/insights.ts` (the `/user-insights-summary` handler only; `/user-insights-recommendations` and `/user-insights-cooldown` unchanged)
- Test: `apps/web/src/__tests__/handlers/insights-week.test.ts`

**Interfaces:**
- Consumes: `collectWeekInputs`, `InsightsFetchError`, `buildWeekFacts`, `renderPromptView`, `noteSignature`, `renderLine`, `guardNote`, `keys`, `AIService.getUserInsightsNote`, `USER_INSIGHTS_PROMPT_VERSION`, `isCacheableResponse`, `LastfmService.history`.
- Produces: `getWeekInsights(c: Context<InternalAppContext>, args: { user: User; isOwner: boolean; refresh: boolean }): Promise<WeekInsightsResponse>` and

```ts
export interface WeekInsightsResponse {
  note: string;                 // sentences joined by a space, or the code line
  question: string | null;      // owner only
  header: string;               // 'Your week' | "<username>'s week"
  pulledAt: string;             // ISO
  mode: 'note' | 'line' | 'quiet';
  refreshing?: boolean;
}
```

The route returns `{ data: WeekInsightsResponse }`; under 5 deduped plays it keeps today's `{ data: null, sparse: true, message }`; on `InsightsFetchError` it returns 500 `{ error: 'Failed to generate insights' }`.

Flow, in this order: the existing `getUserWithInsightsAccess` visibility check → for refresh, the existing owner check and cooldown, then delete `keys.facts(user)` → read `keys.facts(user)`; on a miss, check `keys.generating(user)` (if it is set and `keys.last(user)` points at a note still in the cache, return that note with `refreshing: true`; otherwise carry on, since a duplicate generation is tolerated), set the marker, `collectWeekInputs` (timezone from `user.timezone`, `defer` from `getWaitUntil(c)`), `buildWeekFacts` with `lastQuestion` from `keys.question(user)`, write facts with `CACHE_CONFIG.userInsights.weekFacts` → visitor: return `renderLine(wf, 'third')`, `question: null`, `mode: wf.quiet ? 'quiet' : 'line'`, and touch nothing else → owner, quiet: `renderLine(wf, 'second')`, `mode: 'quiet'` → owner, not quiet: `noteSignature`; `ai.cache.get('userInsightsSummary', user, signature)`; on a miss call `getUserInsightsNote(renderPromptView(wf))`, `guardNote`, regenerate once on failure or `null` sentences, then fall back to `renderLine(wf, 'second')` with `mode: 'line'`; cache only a guarded note, only if `isCacheableResponse`, with `ttlSeconds` from `CACHE_CONFIG.userInsights.note` → when a note or line is returned to the owner, write `keys.last(user)` with `{ signature }` (TTL from `CACHE_CONFIG.userInsights.note`) and, if a question is returned, `keys.question(user)` with `{ kind, subject }` → clear the marker.

Logging: user, fact kinds and saliences, fetch counts, guard failures. Never the statements, the prompt view or the note text.

- [ ] **Step 1: Write the failing tests** in the style of `internal-ai-routes.test.ts`: build a Hono app with mocked `db`, `ai` (`getUserInsightsNote`, `cache` backed by `createMockKV`), a KV in `c.env.CACHE`, and `vi.mock('@listentomore/insights', ...)` to stub `collectWeekInputs` with a fixture loaded from the insights package's `__fixtures__` (import the JSON by relative path).

```ts
it('refuses a visitor on a private profile before touching KV', ...)          // 403; kv.get not called
it('refuses a visitor on a private profile even with warm facts and note caches', ...)
it('owner gets the guarded note, the code question and "Your week"', ...)
it('visitor gets the third-person line, no question, "<username>\'s week", and no model call', ...)
it('a visitor request never reads or writes the question state', ...)
it('the response never contains statements, entities or the prompt view', ...) // JSON.stringify(body) has no 'statement', 'entities', 'salience'
it('regenerates once when the guard fails, then serves the second note', ...)  // getUserInsightsNote called twice
it('falls back to the code line when the guard fails twice', ...)              // mode 'line'; nothing written under ai:userInsightsSummary
it('falls back to the code line when the model returns no parseable sentences', ...)
it('never caches a truncated note', ...)                                       // metadata.truncated true
it('a second load with unchanged facts makes no Last.fm and no model call', ...)
it('refresh with an unchanged signature reuses the note; a changed signature regenerates', ...)
it('refresh is owner-only and respects the cooldown', ...)                     // 403 for a visitor, 429 inside 5 minutes
it('a quiet week makes no model call', ...)
it('under 5 plays returns the sparse message', ...)
it('InsightsFetchError returns 500 and writes nothing', ...)
it('a second request while the generating marker is set returns the previous note with refreshing: true', ...)
it('uses the stored owner timezone and null when unset', ...)
```

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement** `insights-week.ts` and replace the summary handler's body. Remove `MIN_PLAYS_THRESHOLD` use from the summary handler only.

- [ ] **Step 4: Run to verify they pass**, `pnpm typecheck`, `pnpm test`.

- [ ] **Step 5: Commit.** `git commit -m "Serve the week note from computed facts with guard, fallback and visitor line"`

---

### Task 14: The insights page

**Files:**
- Modify: `apps/web/src/pages/user/insights.tsx`
- Test: `apps/web/src/__tests__/pages/insights.test.ts`

**Interfaces:**
- Consumes: `WeekInsightsResponse` (Task 13).
- Produces: `UserInsightsPage` keeps its props.

- [ ] **Step 1: Write the failing tests** by rendering `UserInsightsPage(props).toString()`.

```ts
it('owner sees the heading "Your week"', ...)
it('a visitor sees "<username>\'s week" and no refresh button', ...)
it('the client script writes the note with textContent, not marked.parse', ...)   // script contains 'textContent'; does not contain 'marked.parse(data.data.content)'
it('the question renders in its own element', ...)                                // id 'insights-question'
it('shows when the data was pulled and that counts exclude likely duplicate scrobbles', ...) // id 'insights-meta'; copy 'Counts exclude likely duplicate scrobbles.'
it('the loading text no longer says "Analyzing your listening"', ...)              // 'Reading your week...'
it('a "refreshing" response shows "Updating..." beside the note', ...)
```

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement.** Server-side heading from `isOwner`. Client script: on `data.data`, set `#insights-summary` text from `note`; show `#insights-question` only when `question` is non-null; set `#insights-meta` to `Updated <local time from pulledAt>. Counts exclude likely duplicate scrobbles.`; keep the sparse and error branches; drop `enrichLinks('insights-summary')`. Styles through existing CSS variables only.

- [ ] **Step 4: Run to verify they pass.** Then check by hand at `pnpm dev`: sign in, open `/u/<you>/insights`, confirm the note, the question, the meta line and a refresh; open it signed out for a public profile and confirm the visitor line.

- [ ] **Step 5: Commit.** `git commit -m "Render the week note, question and visitor line on the insights page"`

---

### Task 15: Privacy: deletion, inventory and policy

**Files:**
- Create: `apps/web/src/utils/insights-cleanup.ts`
- Modify: `apps/web/src/pages/account/index.tsx` (`handleAccountDelete`), `apps/web/src/__tests__/utils/mocks.ts` (`createMockKV().list` honours `prefix`), `docs/privacy-data-inventory.md`, `apps/web/src/pages/legal/privacy.tsx`
- Test: `apps/web/src/__tests__/utils/insights-cleanup.test.ts`, `apps/web/src/__tests__/handlers/account.test.ts`, `apps/web/src/__tests__/pages/privacy.test.ts`

**Interfaces:**
- Consumes: `userKeyPrefixes`, `userExactKeys` (Task 10).
- Produces: `deleteUserInsightsData(kv: KVNamespace, lastfmUsername: string): Promise<number>` — deletes each exact key, then lists each prefix with pagination (`cursor`) and deletes every key found; returns the count.

- [ ] **Step 1: Write the failing tests.**

```ts
it('deletes every per-user key and nothing else', ...)
// seed: lastfm:scrobbles:alice:2026-11-01, lastfm:toplist:alice:6month, insights:facts:alice, insights:question:alice,
//       ai:userInsightsSummary:alice:abcd,
//       lastfm:scrobbles:alice2:2026-11-01, insights:facts:alice2, lastfm:tracklist:meltt:eternal embers, lastfm:toptags:meltt
// after: both alice2 keys and the two global keys remain; returns 5
it('never deletes a user whose name starts with this user's name', ...)   // the alice2 keys above, asserted explicitly
it('follows list cursors', ...)
it('account deletion clears the user's insights keys before deleting the user', ...) // in account.test.ts
it('account deletion still succeeds when KV cleanup throws', ...)                   // logged, user row deleted
it('the privacy page names stored listening history, the timezone and their retention', ...) // 'up to 40 days', 'timezone'
it('the privacy effective date changed', ...)
```

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement.** Call `deleteUserInsightsData` in `handleAccountDelete` after the sessions are deleted and before `db.deleteUser`, inside its own try/catch. Search for a Last.fm unlink path (`grep -rn "lastfm_username: null" apps/web/src`); if one exists, call the cleanup there too and add a test; if none exists, write that in the inventory. Update `docs/privacy-data-inventory.md` with a row per new key family and the `users.timezone` column, each with its `file:line` and TTL. Draft the privacy-page wording for the new items (scrobbles cached by day for up to 40 days, period lists up to 7 days, computed week facts 24 hours, notes 8 days, timezone until account deletion; what a visitor can see; that deletion removes them) and bump `PRIVACY_EFFECTIVE_DATE`. This is public copy: show the owner the exact text and wait for a go before the commit.

- [ ] **Step 4: Run to verify they pass.**

- [ ] **Step 5: Commit.** `git commit -m "Clear insights data on account deletion and document what is stored"`

---

### Task 16: Eval, held-out weeks, live check (owner checkpoint)

**Files:**
- Create: `apps/web/scripts/insights-eval.ts`, `apps/web/scripts/capture-week-inputs.ts`
- Create: `packages/services/insights/__fixtures__/bordesak-live-<date>.json`, `bordesak-heldout-2026-08-02.json`, `bordesak-heldout-2026-09-20.json`
- Modify: `packages/services/insights/__tests__/fixtures.test.ts`, `docs/how-to/ai-models.md`
- Test: `apps/web/src/__tests__/utils/insights-rubric.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `checkRubric(text: string): string[]` in `apps/web/scripts/insights-rubric.ts` — returns the banned items found. Banned: `best`, `great`, `gorgeous`, `lush`, `sounds like`, `for me`, `I'd`, `still holds up`, `says a lot`, `clearly`, `must have`, an em dash, and the three negation-contrast patterns from the deleted `FORBIDDEN_CONSTRUCTION_PATTERNS` (copy them from git history, commit `0b4a2cf`).

- [ ] **Step 1: Rubric tests, fail, implement, pass.**

```ts
it('flags taste and sound words as whole words only', ...)   // 'best' flagged; 'Bestival' not
it('flags an em dash and "not X, it\'s Y"', ...)
it('passes the round 2 May 24 note', ...)
```

- [ ] **Step 2: `capture-week-inputs.ts`.** Runs the real `collectWeekInputs` with `LastfmHistory` and an in-memory KV against Last.fm for a username, prints fetch counts, KV operation counts, elapsed time and the total bytes it wrote to KV split into per-user and global keys (the measured input to the spec's storage budget), runs it a second time against the same KV to print the warm figures, and writes a `WeekInputs` JSON. Usage: `pnpm dlx tsx scripts/capture-week-inputs.ts --user bordesak --tz America/Los_Angeles --out <path>`. Reads `LASTFM_API_KEY` from `apps/web/.dev.vars` only.

- [ ] **Step 3: Capture and export.** Capture the owner's current week into `bordesak-live-<date>.json`. Record the printed cold fetch count and seconds in the task report; they are the first production-shaped measurement of the spec's budget. Export two held-out past weeks with Task 2's exporter (window ends `2026-08-09T00:00` and `2026-09-27T00:00`, fetching what the archive lacks with the exporter's network guard lifted for this run only), and one held-out week of another listener into the vault path, not this repository. Extend `fixtures.test.ts` to shape-check the three new files; add no ranking assertions for them.

- [ ] **Step 4: `insights-eval.ts`.** For each fixture in `__fixtures__` plus any in `--extra <dir>`: `buildWeekFacts`, then twice: `getUserInsightsNote`, `guardNote`, `checkRubric`. Writes `eval-output/<label>/insights/<fixture>.json` (prompt view, both raw outputs, guard results, rubric hits, tokens, cost, ms) and a `summary.md` with a table and an opener-overlap figure (share of first-sentence 4-grams shared between different weeks). Exit 1 if any fixture fails the guard on both runs or trips the rubric. Usage: `pnpm dlx tsx scripts/insights-eval.ts --label <name> [--extra <dir>]`. Keys from `apps/web/.dev.vars` first.

- [ ] **Step 5: Run the live eval once.** `--label week-facts-r1 --extra ~/git/product-ai/05-personal/side-projects/listentomore/insights-redesign-research/step0/fixtures`. Expected spend under $0.50.

- [ ] **Step 6: Owner checkpoint. Stop here.** Give the owner `summary.md` and every note beside the gold summaries for the three annotated weeks, and ask two questions: does structured output read as well as the round 2 notes, and are the held-out notes plausible. If structured output has flattened the prose, the spec's fallback applies: drop the per-sentence citation requirement, apply the guard per sentence against all prompt-view facts, bump the prompt version, rerun. Do not continue to Task 17 without the owner's go.

- [ ] **Step 7: Document and commit.** Add a section to `docs/how-to/ai-models.md`: when to run `insights-eval.ts` (before merging any change to the note prompt, the model config or a salience weight), what failure means, and that it never runs in CI. `git commit -m "Add the insights eval, rubric, held-out weeks and a live capture script"`

---

### Task 17: Final checks and handover

**Files:**
- Modify: `AGENTS.md` (Key Constraints), `README.md` if it describes the insights page

- [ ] **Step 1: Add to `AGENTS.md` Key Constraints:** the week-facts object and prompt view never leave the server or reach logs; salience weights and the note prompt change only with an `insights-eval.ts` run; per-user Last.fm caches must use the key builders in `packages/services/insights/src/keys.ts` so account deletion finds them.

- [ ] **Step 2: Run everything.** `pnpm typecheck && pnpm test`. Expected: all packages pass, including `@listentomore/insights`.

- [ ] **Step 2b: Confirm the platform assumptions.** Ask the owner to confirm the Worker is on Workers Paid (the spec assumes it) and note the plan's subrequest limit. Compare with the measured cold figures from Task 16: fetches must be under the 150 cap and KV operations under 1,000 per invocation with room to spare. Compare the measured per-user bytes with the spec's 1.5 MB estimate. Report any figure that is over.

- [ ] **Step 3: Check the removals.** `grep -rn "FEW_SHOT_EXAMPLES\|containsForbiddenConstruction\|weeklyPlayCount\|isRegular" apps packages --include='*.ts' --include='*.tsx'` — expect matches only in `user-insights-recommendations.ts` for `isRegular` (unchanged in phase 1) and none for the rest.

- [ ] **Step 4: Commit and report.** `git commit -m "Document the insights invariants"`. Report to the owner: what shipped on the branch, the measured cold and warm fetch counts and latency from Task 16, the eval summary, the migration to run (`011_user_timezone.sql`), the privacy copy change, and that nothing has been pushed or deployed.
