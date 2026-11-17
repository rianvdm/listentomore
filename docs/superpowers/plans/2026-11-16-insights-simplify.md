# Simplify the Weekly Insights Note Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opus writes the owner's weekly note from the computed week facts in the June voice, one light check replaces the guard, and the "Did you know" card, the question and the guard are deleted.

**Architecture:** Week facts stay as computed, plus a top-albums list (rule version `r3`). The prompt view shows up to 10 facts and the top albums. The model returns `{ note, names }`. A pure `checkNote` in `@listentomore/insights` checks the names and integers. A small `writeWeekNote` module in `apps/web` runs up to two attempts and is shared by the route and the eval. Everything that existed only for the card, the guard or the question is deleted.

**Tech Stack:** TypeScript (strict), Hono on Cloudflare Workers, pnpm + Turborepo, vitest, Anthropic Messages API (`claude-opus-5-5`), Workers KV.

**Spec:** `docs/superpowers/specs/2026-11-13-insights-simplify-design.md`. Executors read the spec and this plan.

## Global Constraints

- Work on the plain branch `insights-simplify` in the main clone `/Users/rian/git/listentomore`. Don't create a worktree.
- Code style follows `AGENTS.md`: `// ABOUTME:` headers (two lines), single quotes, semicolons, trailing commas, `import type` for types, explicit return types on exports.
- End every commit message with exactly this line, even if a harness reminder suggests another: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- `USER_INSIGHTS_PROMPT_VERSION = 'v8'`. `RULE_VERSION = 'r3'`.
- The owner's route calls the model when the week has **30 or more** deduplicated plays (`NOTE_MIN_PLAYS = 30`), whatever `wf.quiet` says. `MIN_WEEK_PLAYS = 5`, `QUIET_THRESHOLD` and `wf.quiet` stay as they are.
- `PROMPT_FACTS = 10`. `NOTE_ATTEMPTS = 2`.
- The note is two or three short paragraphs, about 120 to 200 words. Paragraphs are separated by `\n\n` in the response.
- Week-fact computation (dedupe, runs, returns, tiers, release week, timezone, salience) does not change. The fact *shape* loses `edges` and `albums`, and `WeekFacts` loses `question` and `cardAlbums` and gains `topAlbums`.
- Log lines carry fixed codes only: never the note, a name, the prompt view, a count from the week or a raw model reply. `WeekFacts` and the prompt view never leave the server.
- Visitors keep the code-rendered third-person line and never trigger a model call.
- This is a public repo. No other listener's data in any file or commit. Eval output stays in the gitignored `apps/web/eval-output/`.
- No deploy, no production KV or D1 writes, no `git push` and no issue comments without Rian's explicit go. Task 8 is where those happen.
- Verification for every task: `pnpm typecheck` and `pnpm test` from the repo root, both clean.

## Review Focus

1. **Edition suffixes.** The note writes "Felt" and `wf.names` has "Felt (Special Edition)". The name check must pass it. (Task 2 test.)
2. **Number formats.** The note writes "1,204 plays" or "40%", and the view has `1204` and `40`. The check reads both as the integers 1204 and 40. (Task 2 test.)
3. **Partial name matches.** A name in `names` that the note holds only inside a longer word ("Low" inside "Lowell") fails as absent. A faded artist named only in a fact's entities passes as known. (Task 2 test.)
4. **Wrapped replies.** The model wraps the JSON in a ```json fence, adds prose around it, or separates paragraphs with `\r\n\r\n` or three newlines. The parser still returns the note with paragraphs joined by exactly `\n\n`. (Task 3 test.)
5. **The 30-play gate.** For the owner, a week with 30+ plays and `wf.quiet === true` calls the model. A week with 29 plays shows the code line and makes no call. A visitor never calls the model, at any count. (Task 3 test.)

---

### Task 1: Delete the card

Everything that exists only for the "Did you know" card goes. Nothing in production calls MusicBrainz credits, `albumTrivia` or the card route after this task.

**Files:**
- Delete: `apps/web/src/api/internal/insights-card.ts`, `insights-card-route.ts`, `insights-making-of.ts`; `apps/web/src/__tests__/handlers/insights-card.test.ts`, `insights-making-of.test.ts`
- Delete: `packages/services/ai/src/prompts/album-trivia.ts` and its tests in `apps/web/src/__tests__/services/ai.test.ts` (the trivia and citation cases only)
- Delete: `packages/services/insights/src/tieback.ts`, `card-albums.ts`, `standout.ts`, and `__tests__/tieback.test.ts`, `card-albums.test.ts`, `standout.test.ts` (check `git grep standoutAlbum` first; the spec keeps `standout.ts` only if something else uses it, and today only the card and the eval do)
- Delete: `packages/services/musicbrainz/src/credits.ts`, `credits-parse.ts`, `credits-types.ts`, `__tests__/credits.test.ts`, `__tests__/credits-parse.test.ts`
- Revert to `a161ed0`: `packages/services/musicbrainz/src/fetch.ts`, `errors.ts`, `index.ts`. No commit after `a5b9006` touched them, so `git checkout a161ed0 -- <those three files>` removes exactly the credits-only changes (`logUrl`, `followRedirects`, `retryAfterMs`, `MusicBrainzApiError`).
- Modify: `apps/web/src/api/internal/insights.ts` (remove the `/user-insights-trivia` route and the `getTriviaCard` import)
- Modify: `apps/web/src/pages/user/insights.tsx` (remove `#insights-card`, `hideCard`, `renderCard`, `loadCard`, `isHttpsUrl`, `isFilled` and `appendText` if nothing else uses them, the `.insights-card*` CSS, and the card mentions in the ABOUTME and comments; keep `loadGeneration`)
- Modify: `packages/services/ai/src/anthropic.ts`, `types.ts`, `index.ts`, `prompts/index.ts` (remove `WebCitation`, `collectCitations`, the `citations` field on the response, and `webSearchMaxUses`; keep `quietErrors`, `webSearchErrors` and the dropped-blocks log)
- Modify: `packages/config/src/ai.ts` (remove the `albumTrivia` task and `webSearchMaxUses`; fix the "Nine tasks / Eight tasks" comment counts), `packages/config/src/cache.ts` (remove `userInsights.card`, `albumTrivia`, `musicbrainz.credits` and `musicbrainz.creditsMiss`)
- Modify: `packages/services/insights/src/types.ts` (remove `CardAlbum` and `WeekFacts.cardAlbums`), `build.ts` (stop computing `cardAlbums`), `keys.ts` (remove `card` and `trivia`; drop `keys.card` from `userExactKeys`; update the ABOUTME), `index.ts` (drop the removed exports), `package.json` (remove the `@listentomore/musicbrainz` dependency), then `pnpm install` so `pnpm-lock.yaml` loses only that importer entry
- Modify: `apps/web/src/utils/error-kind.ts` (drop `MusicBrainzApiError` and `CreditsCapReached`) and `apps/web/src/__tests__/utils/error-kind.test.ts`
- Modify: `apps/web/scripts/insights-eval-lib.ts` and `apps/web/src/__tests__/utils/insights-eval-lib.test.ts` (remove the card helpers: `KNOWN_TIEBACKS`, `knownTieBackReport`, `createLocalLimiter`, `createSerialQueue`, `CardVerdict`, `cardFailure`, `factCheckLines`, and the `trivia` parameter of `requiredDevVars`)
- Modify: `apps/web/src/__tests__/scripts/insights-imports.test.ts` (import the route, `insights-week.ts` and the eval lib only)
- Modify: tests that reference `cardAlbums` or `keys.card`: `build.test.ts`, `insights-cleanup.test.ts`, `pages/insights.test.ts`
- Keep: `MusicBrainzRateLimiterDO`, `apps/web/src/utils/musicbrainz-limiter.ts` (the UPC and ISRC lookups use them), the Spotify `quiet` search option and `spotifyReleaseLookup` (release_week uses them)

**Interfaces:**
- Produces: `WeekFacts` without `cardAlbums`. `keys` without `card` and `trivia`. `userExactKeys(user)` returns `[facts, question, generating, last]`. `ChatCompletionResponse` has no `citations`.

`apps/web/scripts/insights-eval.ts` imports the deleted card modules and does not run between this task and Task 5, which rewrites it. Nothing else imports it, and `tsc` does not cover `scripts/`.

- [ ] **Step 1: Delete the files and make the edits above.**
- [ ] **Step 2: Confirm nothing still names the card.** Run: `git grep -n -i -E 'trivia|tieback|tie-back|cardAlbum|CARD_|standoutAlbum|makingOf|making-of|credits|webSearchMaxUses|WebCitation|insights:card' -- packages apps/web/src` Expected: no hits except the unrelated `random-fact` trivia wording, if any. Inspect each hit.
- [ ] **Step 3: Run `pnpm install` and check the lockfile diff.** Run: `git diff --stat pnpm-lock.yaml` Expected: 3 lines removed (the `@listentomore/musicbrainz` entry under `packages/services/insights`), nothing else.
- [ ] **Step 4: Typecheck and test.** Run: `pnpm typecheck && pnpm test` Expected: both clean.
- [ ] **Step 5: Commit.** Message: `Delete the "Did you know" card and the MusicBrainz credits client`, with the issue context (#61, #62) in the body.

---

### Task 2: Top albums, the wider prompt view and the note check

This task only adds to the insights package. The route still uses the guard until Task 3.

**Files:**
- Modify: `packages/services/insights/src/types.ts` (`WeekFacts.topAlbums`, `RULE_VERSION = 'r3'`)
- Modify: `packages/services/insights/src/build.ts` (compute `topAlbums`)
- Modify: `packages/services/insights/src/render.ts` (`PROMPT_FACTS = 10`, a top-albums line in the view and the signature; update the doc comments that say "six")
- Create: `packages/services/insights/src/check.ts`
- Modify: `packages/services/insights/src/index.ts` (export `checkNote`, `NoteCheckFailure`)
- Test: `__tests__/build.test.ts`, `__tests__/render.test.ts`, create `__tests__/check.test.ts`

**Interfaces:**
- Produces: `WeekFacts.topAlbums: Array<{ artist: string; album: string; plays: number }>`. Up to `TOP_ALBUMS = 5` albums by deduped plays this week, then by album name, then by artist name. Scrobbles with a blank album are skipped. Albums are grouped by `albumKey` and spelled as first seen.
- Produces: `renderPromptView(wf)` with this order: the window line, up to 10 ranked facts, the top-artists line, the top-albums line, the caveats. The top-albums line reads `Top albums this week: <album> by <artist> <n> play|plays, ...` or `Top albums this week: none.`
- Produces: `noteSignature(wf, promptVersion)`, which also hashes the top-albums line and covers the first `PROMPT_FACTS` facts.
- Produces, in `check.ts`:
  ```ts
  export type NoteCheckFailure = 'name-unknown' | 'name-absent' | 'number';
  export function checkNote(note: { note: string; names: readonly string[] }, wf: WeekFacts, promptView: string): NoteCheckFailure[];
  ```
  The function returns the distinct failures in the order above, and an empty array when the note passes. It works like this:
  - *Known names:* `matchKey(n)` and `matchKey(stripEdition(n))` for every `n` in `wf.names`.
  - *A name is absent* when `` ` ${matchKey(note.note)} ` `` does not include `` ` ${matchKey(name)} ` ``.
  - *Integers* are the digit runs of a text after the thousands commas between digits are removed (`1,204` → `1204`). Every integer in the note must also appear in `promptView`. Numbers written as words aren't checked.

- [ ] **Step 1 (EXECUTE FIRST, TDD): write the failing tests.**
  - `check.test.ts`, built on a `buildWeekFacts(makeInputs(...))` week from `__tests__/helpers.ts`:
    - `passes a note whose names and integers are all in the week` → `[]`
    - `passes an album named without its edition suffix`: `wf.names` holds `Felt (Special Edition)`, `names: ['Felt']`, and the note contains "Felt" → `[]`
    - `passes a faded artist named only in a fact's entities` → `[]`
    - `fails a name the week does not hold` → `['name-unknown']`
    - `fails a listed name missing from the text`, including "Low" when the note only has "Lowell" → `['name-absent']`
    - `fails an integer missing from the prompt view`, such as "1997" → `['number']`
    - `reads thousands separators and percents as integers`: the note's "1,204 plays" and "40%" pass when the view has `1204` and `40`, and "1,205" fails
    - `reports each failure type once`: two unknown names → `['name-unknown']`
  - `build.test.ts`: `topAlbums` lists up to 5 albums by plays, skips blank albums, merges case and Unicode variants by `albumKey`, and keeps the first spelling. `ruleVersion` is `'r3'`.
  - `render.test.ts`: the view holds up to 10 facts and the top-albums line in the order above, and the empty week reads `none.`. Edit the existing signature test (`changed(6)` "the seventh fact is not in the prompt view") so fact index 9 changes the signature and index 10 does not. Dropping the first top album changes the signature.
- [ ] **Step 2: Run the tests and watch them fail.** Run: `pnpm --filter @listentomore/insights test` Expected: FAIL. `checkNote` is not exported, and `topAlbums` is undefined.
- [ ] **Step 3: Implement** `topAlbums` in `build.ts` (the per-album counting loop the deleted `cardAlbums` used is the pattern), the render changes, and `checkNote` in `check.ts`. `check.ts` imports `matchKey` and `stripEdition` from `./match`.
- [ ] **Step 4: Run the package and app tests.** Run: `pnpm typecheck && pnpm test` Expected: clean. `guard.test.ts` uses `PROMPT_FACTS` by name, so the wider view should not break it. If a guard case fails only because the view now has 10 facts, delete that case and name it in your report, since Task 4 deletes the guard anyway.
- [ ] **Step 5: Commit.** Message: `Add top albums to week facts, widen the prompt view and add the note check`

---

### Task 3: The v8 note, end to end

**Files:**
- Modify: `packages/services/ai/src/prompts/user-insights-note.ts` (a rewrite: the v8 prompt, the `{ note, names }` contract, the parser, and the voice examples)
- Modify: `packages/services/ai/src/index.ts`, `prompts/index.ts` (exports)
- Modify: `packages/config/src/ai.ts` (the `userInsightsSummary` comment; `reasoning: 'medium'`; `maxTokens` stays 5000)
- Create: `apps/web/src/api/internal/insights-note.ts`
- Modify: `apps/web/src/api/internal/insights-week.ts`
- Modify: `apps/web/src/pages/user/insights.tsx`
- Test: `apps/web/src/__tests__/services/ai.test.ts` (or the existing note-parser test file; find it with `git grep -l parseNoteSentences`), create `apps/web/src/__tests__/handlers/insights-note.test.ts`, update `insights-week.test.ts` and `pages/insights.test.ts`

**Interfaces:**
- Consumes: `checkNote`, `NoteCheckFailure`, `renderPromptView`, `noteSignature`, `renderLine` (Task 2).
- Produces, in `user-insights-note.ts`:
  ```ts
  export const USER_INSIGHTS_PROMPT_VERSION = 'v8';
  export interface WeekNote { note: string; names: string[] }
  export interface UserInsightsNoteResult { note: WeekNote | null; raw: string; metadata?: AIResponseMetadata }
  export const USER_INSIGHTS_VOICE_EXAMPLES: readonly string[];   // the two examples below, exactly
  export function buildUserInsightsNoteMessages(promptView: string): ChatMessage[];
  export function parseWeekNote(raw: string): WeekNote | null;
  export async function generateUserInsightsNote(promptView: string, client: ChatClient): Promise<UserInsightsNoteResult>;
  ```
  `parseWeekNote` accepts bare JSON, a fenced block, or an object with prose around it. To find the object, it tries each `{` against each `}`, widest span first, the way the old array parser did. It returns null unless `note` is a non-empty string and `names` is an array of strings. To normalise the note, it turns `\r\n` into `\n`, splits paragraphs on blank lines, collapses the single newlines inside a paragraph to spaces, trims, drops empty paragraphs, and joins them with `\n\n`. Names are trimmed, and empty ones are dropped. The old `NoteSentence`, `parseNoteSentences` and `toNoteSentences` go.
- Produces, in `insights-note.ts`, a module that stays Node-safe because the eval imports it:
  ```ts
  export const NOTE_ATTEMPTS = 2;
  export type NoteAttempt =
    | { outcome: 'ok'; raw: string }
    | { outcome: 'call-failed'; kind: string }
    | { outcome: 'unparseable'; raw: string }
    | { outcome: 'check-failed'; failures: NoteCheckFailure[]; raw: string };
  export interface NoteRun { note: WeekNote | null; result: UserInsightsNoteResult | null; attempts: NoteAttempt[] }
  export async function writeWeekNote(ai: Pick<AIService, 'getUserInsightsNote'>, wf: WeekFacts): Promise<NoteRun>;
  ```
  The function renders the prompt view once, then runs up to `NOTE_ATTEMPTS` calls. It stops at the first note that passes `checkNote`. `kind` comes from `errorKind`. The function logs nothing; its caller logs.
- Produces, in `insights-week.ts`: `export const NOTE_MIN_PLAYS = 30;` and
  ```ts
  export interface WeekInsightsResponse { note: string; header: string; pulledAt: string; mode: 'note' | 'line' | 'quiet'; refreshing?: boolean }
  ```
  The response has no `question` field.

**The prompt.** This is exact copy. The system message stays: `You're a friend who follows someone's scrobbles. Once a week you send them a short note about what they played.` The user message:

```
Here is this week's listening, already counted and ranked. It is everything you know about the week.

${promptView}

Write them this week's note, in second person.

- Two or three short paragraphs, 120 to 200 words in all.
- Open with what the week was about, in your own words. Then connect the facts that belong together, and say what sat alongside them.
- An opinion about a record is welcome when you phrase it as one ("Still the one, no argument.").
- Every listening claim (a count, a day, an album played start to finish, a return, a first play) comes from the facts above. Leave out what they don't show, and do no arithmetic they don't state. An artist marked "first plays under this name" may have played under another name, so say it that way.
- Keep to the facts above about the records themselves: no release years, band members, labels, or who played on what.
- Leave out guesses about mood or motive.
- Write artist and album names exactly as they appear above.
- Say each thing directly. Use no em dashes and no "not X, it's Y" contrasts.
- No greeting, sign-off, emoji, or question.

The two notes below show the voice. Their artists, albums, and numbers come from other weeks, so use none of them here, and find your own way into this week.

<example>
${USER_INSIGHTS_VOICE_EXAMPLES[0]}
</example>

<example>
${USER_INSIGHTS_VOICE_EXAMPLES[1]}
</example>

Return only JSON: {"note": "<the paragraphs, separated by a blank line>", "names": ["<every artist and album the note names, spelled as above>"]}
```

**The voice examples.** These are exact copy: the v3 `FEW_SHOT_EXAMPLES` voice-only notes (`git show a161ed0:packages/services/ai/src/prompts/user-insights-summary.ts`) with their two em dashes replaced by colons.

Example 0 (the 2026-06-12 gold week):

```
Siiga came out of nowhere and took the top spot in a week: Nostalgia Burns at 39 plays, and it slots right into the ambient pocket you already live in next to Celer, Nils Frahm, and Deserta. The Capri remaster got the full front-to-back treatment too, so a lot of this week was pressing play and letting a record run.

Around the ambient stuff, the familiar names held up. You went back to In Rainbows and ran the whole thing. Still the one, no argument. I Built You A Tower stayed in heavy rotation too, and the Raveonettes binge (Pe'ahi II and Lust Lust Lust back to back) was the one loud stretch this week.

The Police live album is the curveball. Certifiable at 21 plays is a lot of stage banter and crowd noise for someone who mostly listens to drone. But Every Breath You Take live still does the job.
```

Example 1:

```
This was an I Built You A Tower week, full stop. You wore the whole record down to the grain: Envy the Birds, Full of Stars, Pep Talk, Stone Over Water all sitting around three plays each. When a Death Cab record clicks for you, it clicks.

Underneath it, the usual ambient names were all there: Nils Frahm at 31, plus Ólafur Arnalds, Stars of the Lid, and Sigur Rós. Seasurfer's Stay was the one new thing that stuck.

Then the weird ones, which are the fun part. Evanescence (Beautiful Lie, How Do I Heal), Michael Jackson, and Chris de Burgh all showed up the same week as Stars of the Lid. No notes. That's a healthy week.
```

**Route changes (`insights-week.ts`):**
- Replace `guardedNote`, `NAMED_FAILURES`, `VALUED_FAILURES` and `logSafeFailures` with a call to `writeWeekNote`. For each attempt, log `[Insights] note-attempt:<n> <outcome>`, followed by `kind=<kind>` or the failure codes joined by commas. Never log `raw`.
- For the owner, replace the `wf.quiet` gate with `wf.plays.deduped < NOTE_MIN_PLAYS` → `{ note: renderLine(wf, 'second'), mode: 'quiet' }` with no model call. The visitor path doesn't change.
- Remove `StoredQuestion`, `ownerQuestion`, `lastQuestion`, the question KV read and write, and `question` from every response. Call `buildWeekFacts(inputs)` without options.
- Cache the note through `isCacheableResponse(result.raw, result.metadata, 'userInsightsSummary')`, as today. When both attempts fail, serve the second-person code line with `mode: 'line'`, as today.

**Page changes (`insights.tsx`):** `renderWeek` splits `week.note` on `/\n\s*\n/` and appends one `<p class="insights-note">` per paragraph through `textContent`. The "Updating..." span goes on the last paragraph. Remove `#insights-question`, its CSS, and its handling in `renderWeek` and `hideWeekDetails`.

- [ ] **Step 1 (EXECUTE FIRST, TDD): write the failing tests.**
  - Parser (wherever the current `parseNoteSentences` tests live):
    - parses bare JSON; parses a fenced ```json block; parses an object with prose before and after
    - normalises `\r\n\r\n` and triple newlines to exactly `\n\n` between paragraphs, and turns single newlines inside a paragraph into spaces
    - returns null for an empty note, a missing or non-array `names`, a non-string name, or an array reply
    - drops empty names
  - Prompt: `buildUserInsightsNoteMessages('VIEW')` contains `VIEW` and both examples, and the user message contains no `—`. `USER_INSIGHTS_PROMPT_VERSION === 'v8'`.
  - `insights-note.test.ts`, with a fake `getUserInsightsNote`:
    - a first reply that passes → one call, `note` set, attempts `['ok']`
    - check failure then pass → two calls, attempts `['check-failed', 'ok']`, failures `['name-unknown']` on the first
    - two throws → `note: null`, attempts are `call-failed` with `kind`
    - unparseable then check failure → `note: null`, no third call
  - `insights-week.test.ts`, edited:
    - an owner week of 30+ plays where `wf.quiet` is true → the model is called once, `mode: 'note'`, and the note has `\n\n` paragraphs
    - an owner week of 29 plays → no call, `mode: 'quiet'`, note equals `renderLine(wf, 'second')`
    - a visitor on a 30+ play week → no call, the third-person line
    - two failed checks → `mode: 'line'`; the log has `check-failed` and the codes, and has neither the reply text nor any name
    - no response has a `question` key, and no `insights:question:` key is read or written
    - delete the `logSafeFailures` tests and the question-rotation tests
  - `pages/insights.test.ts`: the page script splits the note into paragraphs through `textContent`. It has no `insights-question`, and assigns no `innerHTML` with response text.
- [ ] **Step 2: Run them and watch them fail.** Run: `pnpm test` Expected: FAIL on `parseWeekNote` (not exported), `writeWeekNote` (module missing), and the 30-play and question assertions.
- [ ] **Step 3: Implement** the prompt module, the config change, `insights-note.ts`, and the route and page changes.
- [ ] **Step 4: Typecheck and test.** Run: `pnpm typecheck && pnpm test` Expected: clean.
- [ ] **Step 5: Commit.** Message: `Write the weekly note in the owner's voice with a light names-and-numbers check`

---

### Task 4: Delete the guard, the question and the card-only fact fields

After Task 3 the route no longer reads any of this, so this task is pure deletion.

**Files:**
- Delete: `packages/services/insights/src/guard.ts`, `__tests__/guard.test.ts`
- Modify: `packages/services/insights/src/rank.ts` (remove `chooseQuestion` and `QUESTION_RANKS`; remove the `albums` merge in the fold; update the ABOUTME)
- Modify: `packages/services/insights/src/types.ts` (remove `QuestionKind`, `QuestionOption`, `AlbumRef`, `Fact.edges`, `Fact.albums` and `WeekFacts.question`)
- Modify: `packages/services/insights/src/facts-artist.ts`, `facts-album.ts`, `facts-week.ts`, `facts-release.ts`, `build.ts` (stop building `edges`; remove the `lastQuestion` option and the `question` field; `windowFact` loses `edges: []`)
- Modify: `packages/services/insights/src/statement.ts` (stop collecting `albums`; keep the `album()` method's entity behaviour)
- Modify: `packages/services/insights/src/keys.ts` (remove `question`; `userExactKeys` returns `[facts, generating, last]`), `index.ts`
- Modify: `packages/config/src/cache.ts` (remove `userInsights.questionState`)
- Modify: tests that build or assert these fields: `facts-artist.test.ts`, `facts-album.test.ts`, `facts-week.test.ts`, `facts-release.test.ts`, `build.test.ts`, `collect.test.ts`, `helpers.ts`, `render.test.ts`, `insights-cleanup.test.ts`

`packages/services/insights/src/rubric.ts` stays until Task 5 moves it.

**Interfaces:**
- Produces: `Fact` = `{ id, kind, salience, subject, statement, entities, quantities, dates }`. `buildWeekFacts(inputs: WeekInputs): WeekFacts`.

- [ ] **Step 1: Make the deletions.** Fact statements, saliences and ranks must not change. The existing fact tests assert them, so leave those assertions alone and only remove the `edges` and `albums` expectations.
- [ ] **Step 2: Confirm nothing still names them.** Run: `git grep -n -E '\bedges\b|QuestionKind|QuestionOption|AlbumRef|chooseQuestion|guardNote|guardSentence|questionState|keys\.question|lastQuestion' -- packages apps/web/src apps/web/scripts` Expected: no hits. (`insights-eval.ts` may still hit until Task 5 rewrites it.)
- [ ] **Step 3: Typecheck and test.** Run: `pnpm typecheck && pnpm test` Expected: clean.
- [ ] **Step 4: Commit.** Message: `Delete the note guard, the closing question and the fact fields only they used`

---

### Task 5: The eval, slimmed to the note

**Files:**
- Rewrite: `apps/web/scripts/insights-eval.ts`
- Modify: `apps/web/scripts/insights-eval-lib.ts`, `apps/web/src/__tests__/utils/insights-eval-lib.test.ts`
- Rewrite: `apps/web/scripts/insights-rubric.ts` (from a re-export to the rubric itself), `apps/web/src/__tests__/utils/insights-rubric.test.ts`
- Delete: `packages/services/insights/src/rubric.ts`, `__tests__/rubric.test.ts`, and its exports in `index.ts`

**Interfaces:**
- Consumes: `writeWeekNote`, `NOTE_MIN_PLAYS` and `MIN_WEEK_PLAYS` (Task 3), `USER_INSIGHTS_VOICE_EXAMPLES`, `buildWeekFacts`, `renderPromptView`, `renderLine`, `matchKey`.
- Produces, in `insights-rubric.ts`: `maskNames(text, names)` and `checkEvalRubric(text, names): string[]`, which returns `'em-dash'` and `'negation-contrast'` hits with names masked first. The em-dash check and the three `NEGATION_CONTRAST_PATTERNS` move verbatim from the package's `rubric.ts`. `BANNED_PHRASES` and the copy rubric don't move, because opinions are now allowed.
- Produces, in `insights-eval-lib.ts`, alongside the kept `evalOutputDir`, `requiredDevVars(providers)` and `missingDevVarsError`:
  ```ts
  export type FixtureTag = 'gold' | 'gold, example in prompt' | 'held-out' | 'live' | 'extra';
  export function fixtureTag(name: string): FixtureTag;   // 'bordesak-2026-06-12' → 'gold, example in prompt'
  export function goldKey(name: string): string | null;    // 'bordesak-2026-05-24' → '2026-05-24'; held-out, live, extra → null
  export function copiedPhrases(note: string, examples: readonly string[], n?: number): string[]; // n defaults to 6; matchKey word n-grams shared with any example
  export function wordCount(note: string): number;
  ```

**The script.** Usage: `pnpm dlx tsx scripts/insights-eval.ts --label <name> [--extra <dir>]`. It loads every fixture in `packages/services/insights/__fixtures__` (skipping `gold.json`) and every JSON file in `--extra`; extra files are labelled `extra-1`, `extra-2`, and so on, as today. For each fixture, it runs `buildWeekFacts`. A week under `MIN_WEEK_PLAYS` or `NOTE_MIN_PLAYS` is recorded as skipped, with the code line it would show. Otherwise it runs one `writeWeekNote` with a real `AIService` built from the `.dev.vars` keys. It writes `eval-output/<label>/insights/<fixture>.json` (the prompt view, every attempt with its raw reply, the final note, flags, tokens, cost and ms) and `summary.md`. For each fixture, `summary.md` shows the tag, the attempt outcomes, and the final note as a blockquote with the gold summary below it when `goldKey` finds one. Under them it lists the flags: check failures, `checkEvalRubric` hits, copied phrases, and the word count with "outside 120-200" when it is. The summary also gives the total cost. The run exits 0 when it finishes and 2 when it cannot start (a missing key or a bad label). No pass rate gates it: the owner reads the notes. Keys come from `apps/web/.dev.vars` only. Drop `--trivia`, `--dry-run`, the MusicBrainz limiter, the Spotify release lookups, `RUNS` and the opener-overlap figure. Keep the concurrency cap.

- [ ] **Step 1 (EXECUTE FIRST, TDD): write the failing tests.**
  - `insights-rubric.test.ts`: an em dash → `['em-dash']`; "It's not a phase, it's a direction." → `['negation-contrast']`; an album named "Not Waving But Drowning" in `names` → `[]`; "Still the one, no argument." → `[]`
  - `insights-eval-lib.test.ts`: `fixtureTag` and `goldKey` for all six committed fixture names and `extra-1`; `copiedPhrases` finds the six-word "you went back to in rainbows" span copied from example 0 and returns `[]` for a five-word overlap; `wordCount('a b\n\nc')` is 3; delete the removed helpers' tests
- [ ] **Step 2: Run them and watch them fail.** Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/utils/insights-rubric.test.ts src/__tests__/utils/insights-eval-lib.test.ts` Expected: FAIL.
- [ ] **Step 3: Implement** the rubric, the lib helpers and the script. Delete the package rubric.
- [ ] **Step 4: Typecheck, test, and check that the script loads without calling the API.** Run: `pnpm typecheck && pnpm test`, then from `apps/web`: `pnpm dlx tsx scripts/insights-eval.ts --label smoke --extra /nonexistent` Expected: clean, then exit code 2 with the `--extra` message, which shows the script parses and imports in Node.
- [ ] **Step 5: Commit.** Message: `Slim the insights eval to the note and move its rubric into scripts`

---

### Task 6: Copy and docs

The privacy page is public copy. Show Rian the rendered before and after of every changed paragraph and wait for his approval before committing it.

**Files:**
- Modify: `docs/privacy-data-inventory.md` first, then `apps/web/src/pages/legal/privacy.tsx` and `apps/web/src/__tests__/pages/privacy.test.ts`
- Modify: `docs/feature-gating.md` (remove the `/user-insights-trivia` line), `docs/how-to/ai-models.md`, `AGENTS.md`
- Check: `apps/web/src/pages/about/index.tsx` has no card mention (verified 2026-11-16; its MusicBrainz lines are the UPC lookups). Leave it unchanged unless that has changed.

**What changes:**
- Privacy page: remove the card paragraph(s) (around lines 124-133 and 154-156), the card and last-question retention rows (lines 192-193), the album-facts and credits rows (lines 211-216), the visitor-sees-the-card sentence (lines 234-235), and "card and last question" in the deletion list (line 249). "The note about your week and the question under it" (line 231) becomes "the note about your week". "Three kinds of request" (line 109) becomes two, and the sentence that lists them changes to match. Keep every claim traceable to the inventory.
- Inventory: remove the MusicBrainz insights-card row, the card source link row, the card mention in the image-hosts row, the `albumTrivia` section, the card and making-of log bullets, the `logUrl: false` bullet, and the `insights:question`, `insights:card`, `insights:trivia` and `musicbrainz:credits:*` key rows. Replace the guard failure-type logging bullet with the `note-attempt` codes. Update the longest-lived-entry sentence (now 40 days), the exact-key deletion list, and the "Last verified" line (today's date, branch `insights-simplify`). Line citations must point at the new code.
- `ai-models.md`: remove the `albumTrivia` row, the `--trivia` usage and text, and the citations bullet. Update the `userInsightsSummary` row (two or three paragraphs as `{ note, names }`, effort medium) and rewrite the eval section to describe Task 5's script, its flags and its exit codes.
- `AGENTS.md`: delete the card bullets (from "Only the owner's insights request starts card work" through the `insights:card:<user>` bullet). Add one bullet: `insights-week.ts` and `insights-note.ts` stay Node-safe because the eval imports them, guarded by `insights-imports.test.ts`. Keep the `011_user_timezone.sql` bullet.

- [ ] **Step 1: Edit the inventory, then the privacy page and its test.**
- [ ] **Step 2: Show Rian the privacy diff** (the rendered paragraphs, before and after) and wait for his approval or edits.
- [ ] **Step 3: Edit the other docs.** Then run: `git grep -n -i -E 'card|trivia|question|guard|credits' -- docs/privacy-data-inventory.md apps/web/src/pages/legal/privacy.tsx docs/how-to/ai-models.md docs/feature-gating.md AGENTS.md` Expected: no hit about the insights card, question, guard or credits. Inspect each hit; "Ask" questions, album cards and the auth guard are unrelated.
- [ ] **Step 4: Typecheck and test.** Run: `pnpm typecheck && pnpm test` Expected: clean.
- [ ] **Step 5: Commit.** Message: `Update the privacy page, data inventory and docs for the simpler insights note`

---

### Task 7: One-off script for the retired KV families

**Files:**
- Create: `apps/web/scripts/delete-retired-insights-keys.ts`
- Test: `apps/web/src/__tests__/scripts/delete-retired-insights-keys.test.ts` (pure helpers only)

**Interfaces:**
- Produces:
  ```ts
  export const RETIRED_PREFIXES = ['insights:question:', 'insights:card:', 'insights:trivia:', 'musicbrainz:credits:'] as const;
  export function parseKeyList(stdout: string): string[];   // JSON.parse a `wrangler kv key list` reply into key names; throws on anything else
  ```
- Usage, from `apps/web`: `pnpm dlx tsx scripts/delete-retired-insights-keys.ts [--yes]`. The namespace id comes from `cacheNamespaceId()` in `cached-summaries-lib.ts`. For each prefix, the script runs `npx wrangler kv key list --namespace-id <id> --prefix <prefix> --remote` with the `execFile` pattern from `cached-summaries.ts`, and prints the prefix and its count. With `--yes`, it writes the names as a JSON array of strings to a file under `eval-output/`, runs `npx wrangler kv bulk delete <file> --namespace-id <id> --remote --force`, deletes the file, lists again, and exits 1 unless every count is 0. Never print a key name: these keys hold usernames and artist names.

- [ ] **Step 1 (EXECUTE FIRST, TDD): write the failing test.** `parseKeyList('[{"name":"insights:card:a"}]')` → `['insights:card:a']`. `parseKeyList('[]')` → `[]`. `parseKeyList('✘ [ERROR] 404')` throws. Every prefix in `RETIRED_PREFIXES` ends in `:`.
- [ ] **Step 2: Run it and watch it fail.** Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/scripts/delete-retired-insights-keys.test.ts` Expected: FAIL, module not found.
- [ ] **Step 3: Implement the script.** Don't run it against production in this task.
- [ ] **Step 4: Typecheck and test.** Run: `pnpm typecheck && pnpm test` Expected: clean.
- [ ] **Step 5: Commit.** Message: `Add a one-off script that deletes the retired insights KV families`

---

### Task 8: Owner gate, then ship

This task is Rian's. An agent runs the commands he asks for, and each step that ships waits for his explicit go.

- [ ] **Step 1: Capture the owner's current week.** From `apps/web`: `pnpm dlx tsx scripts/capture-week-inputs.ts --user bordesak --tz America/Los_Angeles --out eval-output/current-week/bordesak-current.json`
- [ ] **Step 2: Run the eval.** From `apps/web`: `pnpm dlx tsx scripts/insights-eval.ts --label simplify-r1 --extra eval-output/current-week` Expected: exit 0, and `eval-output/simplify-r1/insights/summary.md` holds seven weeks.
- [ ] **Step 3: Rian reads the notes against the gold summaries and decides.** Put the notes and flags in the chat message itself; don't put them only in a file or in a question dialog. If he asks for prompt changes, bump `USER_INSIGHTS_PROMPT_VERSION` only when shipping a changed prompt over a deployed one (v8 has not shipped yet, so edits stay v8), then rerun Step 2.
- [ ] **Step 4: Whole-branch review and final verification.** Run: `pnpm typecheck && pnpm test`, then `git diff --stat main...HEAD | tail -1` Expected: clean, and more deletions than insertions (spec goal 5).
- [ ] **Step 5, on Rian's go: merge and deploy.** Push the branch, open the PR (problem and outcome first, per Rian's PR rule), merge, then run `pnpm run deploy` by hand (merging does not deploy). No migration is needed.
- [ ] **Step 6, on Rian's go: delete the retired KV families.** From `apps/web`: run `pnpm dlx tsx scripts/delete-retired-insights-keys.ts` (dry run, counts only), then the same command with `--yes`. Expected: final counts of 0.
- [ ] **Step 7: Check production.** Rian loads his insights page signed in and confirms two or three paragraphs, no card, and no question. In the logs, `[Insights] note-attempt:` lines carry codes only.
- [ ] **Step 8, on Rian's go: close the issues.** Close #57, #58, #61 and #62 with a one-line comment that links the merged PR.
