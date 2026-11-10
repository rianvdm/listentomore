# Design: Week facts for "Your Week in Music"

**Date:** 2026-11-08
**Status:** Draft for owner approval (revised after a builder check and an independent GPT-6.1-sol review)
**Branch:** `insights-week-facts`
**Background:** the owner's recommendation and research in `product-ai/05-personal/side-projects/listentomore/2026-11-08-insights-summary-redesign-recommendation.md` and `insights-redesign-research/` (diagnosis, signals, product, prototype reports; two rounds of a throwaway fact builder run on real weeks; the review in `sol-review-2026-11-08.md`).

## Why

The "Your Week in Music" summary on `/u/:username/insights` reads like a generic AI bot. The diagnosis traced that to the input, not the prose. The model receives four thin lists that are partly wrong: a weekly total that is really the sum of the top five artists (122 for a 412-scrobble week), a "familiar / new" flag that is membership in the 6-month top 20 and so labels returning artists with hundreds of plays as new, and 30 untimed recent tracks that cover about two hours of the week. It is then asked to find the interesting thing and have opinions about records, so it invents both: 40 of 71 sentences in the Opus eval outputs were unsupported by the input, and the same "opinion" appeared word for word in two runs. Six rounds of prompt edits since March changed the prose and left the input alone.

A throwaway fact builder, run on real weeks, showed what the data can say: an album played through three days running and then dropped, six artists back after months away, a first-time artist from last week that stuck, four jazz returns in one week, an artist at eight times their normal weekly plays. Fed those facts, a two-to-four-sentence note stayed inside the facts, led with what the owner himself led with in two of three annotated weeks, and cost about a third of today's call.

## What success looks like

On the test set (section 9), after implementation:

- Every sentence of the note cites the facts it draws on, and every artist name, album name and quantity in that sentence is found in those cited facts (the guard, section 3). The guard does not prove relations such as order or causation in free prose; the eval's corrupted-example tests and a rubric cover those, and the document says so rather than promising more.
- For the two annotated weeks where the owner's lead is measurable (May 24 jazz returns, Jun 12 Siiga), the note leads with it. May 31 ("widest week") is accepted as unmeasurable by the owner's own baseline.
- No opinions about how music sounds, no adjectives for music, no claims about mood or motive, no em dashes, in any test output, judged by the rubric in section 9.
- Different weeks open differently. Two runs of the same week may be near-identical; that is acceptable.
- A week whose top fact scores under the quiet threshold produces the code fallback sentence and no model call.
- A warm generation for a 400-play week makes under 20 Last.fm calls. A fully cold one was measured at about 75 on the throwaway builder; that is one listener's figure, not a bound. The bounds are the caps in section 1.
- Model cost per generation at or below today's (measured $0.028 on the current prompt; the prototype note ran $0.008 to $0.015).

## Goals

1. Replace the model's input with a ranked, pre-phrased week-facts object computed in code from Last.fm, with true counts, tracklist-checked album runs, familiarity tiers from lifetime plays, and week-over-week change, each fact carrying its provenance.
2. Replace the summary prompt with the tested note prompt: two to four sentences in second person, leading with the top-ranked fact, connecting the top facts only when the facts themselves connect them.
3. Validate each sentence against the facts it cites before display, regenerate once on failure, and fall back to a code-rendered sentence.
4. Skip the model on quiet weeks and render a plain code sentence instead.
5. Choose any closing question in code and append it in code; show it only to the owner.
6. Give visitors a code-rendered third-person line from the top fact, with no model call.
7. Store the owner's timezone so day and time labels are right.
8. Remove the regex detector and scrub pass, the few-shot examples, the top-five "total", the 6-month flag, and the opinion mandate.
9. Add fixtures, unit tests, endpoint tests and an eval, so later prompt or weight changes are judged against evidence.

Phase 2 (same design, separate plan): code-rendered "chart notes" under the note (new, back after a break, played through, dropped off), a deeper weekly-chart backfill so returns can say "since May" and album-level returns exist, tag-based habits as model background, and a possible Claude-written visitor note.

Phase 3: album recommendations anchored to the week's facts with lifetime-playcount exclusion; a Sonnet test; possibly a stored one-line reply to the question.

## Non-goals

- Changing the Albums to Explore section or its route in phase 1, including its own sparse threshold.
- Any dashboard, genre percentages, badges, streaks, milestones, or user-to-user comparisons.
- A "same week last year" line.
- A Claude-written note for visitors in phase 1.
- Background jobs, polling, queues or cron precompute in phase 1.
- Multi-artist compilation albums as album runs. Runs are keyed by artist and album; a compilation never forms a run. Accepted omission.
- Reconstructing history for past weeks in production. (The throwaway builder's past-week reconstruction exists only to build fixtures.)

## Anti-goals (failure even if it "works")

- A name or quantity in the note that is not in the facts the sentence cites. Enforced by the guard.
- Opinions about records or claims about the listener's reasons, mood or taste in the note.
- A quota of facts: a quiet week padded with trivia.
- The note or question asking the user to do anything (streak pressure, "keep it up").
- A cached note shown against facts it was not written from. A note is reused only when the semantic inputs it was written from are identical (section 5).
- "First plays ever", or any absence claim, said of an artist whose history is incomplete or unknown. The facts say "first plays under this name" only when the history snapshot is complete and consistent; otherwise the claim is suppressed.
- Describing recorded gaps as intent. Scrobbles show recorded plays, not why they stopped: facts say "no plays recorded after Wed", never "you stopped".

## Constraints

- Single Worker, Hono JSX, vanilla JS progressive loading, TypeScript strict (`AGENTS.md`).
- Cache TTLs from `packages/config/src/cache.ts`; never cache an AI response without `isCacheableResponse()`; `maxTokens` is a budget for thinking plus prose.
- `/api/internal/*` routes keep `requireSessionAuth`; the session is loaded lazily there.
- Workers plan: assumed Workers Paid (the existing 5-minute cron's per-user KV writes would exceed the Free plan's daily write cap). The builder confirms the plan and its subrequest and CPU limits before relying on them. Workers KV allows 1,000 operations per invocation; every cached `LastfmService` call is a get plus a put, so KV operations are budgeted alongside fetches. `waitUntil` extends execution by at most 30 seconds, so nothing that must finish runs there.
- KV is eventually consistent and has no atomic lock. The design tolerates duplicate concurrent generations instead of trying to prevent them (section 5).
- Last.fm gives lifetime play counts but no last-played dates, so absence is phrased against period-list boundaries ("none in the 6+ months before this week"), never as "first time since <month>", until phase 2's weekly-chart history exists.
- Last.fm's `artist.getinfo` returns a `userplaycount` of 0 for some names containing "+"; lifetime counts come from the user's overall top list first and `getinfo` second.
- Last.fm's API terms cap stored Last.fm data at 100 MB in total. Section 5 sets the storage budget and expiry that keep this design well under it.

## Decided by the owner (2026-11-08)

- Two-layer design: a short Claude-written note, then code-rendered chart notes (phase 2), instead of improved paragraphs.
- No opinions in the summary; opinion stays in Albums to Explore.
- The three few-shot examples are removed now. If the voice drifts, the owner writes paired examples from real facts objects later.
- Work happens on a plain branch in the main clone, no worktrees.
- Proceed without a further generalisation spike; weights are frozen as tested and judged on a held-out set during implementation.
- The owner's own listening fixtures are committed to this repository so tests run in CI. The other user's week stays in the private vault and runs locally only.
- Visitors see a plain code-rendered third-person line in phase 1, not a Claude-written note.

## Design

### 1. Data the module needs

All times are UTC epoch seconds internally. The week is the half-open interval `[T − 168 h, T)` where `T` is generation time; "previous weeks" are the four preceding 168-hour intervals. Day and time labels are rendered in the owner's timezone (section 6). A week is always 168 hours, so a DST change shifts labels, not the window.

| Data | Call | Cache and key |
|---|---|---|
| Scrobbles for the last 35 days, with timestamps | `user.getrecenttracks` with `from`/`to`, `limit=200`, `extended=1`, paginated | Stored in stable UTC calendar-day partitions, `lastfm:scrobbles:<user>:<YYYY-MM-DD>`. A completed day is immutable and cached 40 days; the current day is always fetched live. A generation reads the 35 or 36 partitions it overlaps and filters by timestamp, so the window can move freely without invalidating anything. |
| Weekly artist charts for the 8 chart weeks before those 35 days (the per-artist baseline covers 12 weeks: 4 from scrobbles, 8 from charts) | `user.getweeklychartlist`, `user.getweeklyartistchart` | Per user and chart week; immutable once over; 40 days. |
| Period top artists: 3, 6 and 12 month, complete | `user.gettopartists`, `limit=1000`, paginated to `totalPages`, capped at 3 pages each | Per user, stored with `fetched_at` and `complete: true/false`; 24 h. |
| Overall top artists | `user.gettopartists period=overall limit=1000`, 2 pages | Per user, with `fetched_at`; 7 days. |
| Lifetime plays for this week's top 25 artists with 4+ plays | `artist.getinfo?username=` | Per user and artist, with `fetched_at`; 24 h. Never under the existing global `artistDetail` key. |
| Album tracklist | `album.getinfo` | Global, tracklist only; 30 days. |
| Album user play count | `album.getinfo?username=` (same response) | Per user and album; 24 h. Stored separately from the global tracklist entry so one user's count can never be served to another. |
| Artist top tags, for artists the rules look at | `artist.gettoptags` | Global; 30 days. |

`LastfmService` gains range-based recent tracks, album info, weekly chart list and chart, artist top tags, and backoff on Last.fm error 29 and HTTP 429 (at most 2 retries per call).

**Caps and degraded behaviour.** These bound a generation regardless of the listener:

| Resource | Cap per generation | When reached |
|---|---|---|
| Recent-track pages for the current week | 15 (3,000 scrobbles) | Use the most recent 3,000, add a caveat, suppress share-of-week facts. |
| Recent-track pages for uncached history days | 20 | Stop; mark the baseline `partial`; suppress `volume_vs_normal`, `breadth`, `album_mode`, `volume` and, if last week is incomplete, `last_week_faded`. Fetched days are cached, so later loads fill the gap. |
| `album.getinfo` | 20, longest runs first | Runs beyond the cap are `unverified`. |
| `artist.getinfo` | 25 | Remaining artists use the overall list only. |
| `artist.gettoptags` | 45 | Remaining artists have no tags; they join no cluster. |
| Total Last.fm fetches | 150 | Abort the remainder; compute facts from what is present, with the suppressions above. |

A generation that cannot fetch the current week at all returns today's "unable to generate insights" response and caches nothing.

**Provenance.** Every history input carries `fetched_at` and, for lists, `complete`. The module derives "before this week" only from a consistent snapshot: `lifetime_before = lifetime_now − raw plays in the week with timestamp ≤ that count's fetched_at`. If the result is negative, or the lifetime count is missing, the artist's history is `unknown`. Absence from a period list counts as zero plays only when that list is `complete`; otherwise absence is `unknown`. Accounts with fewer than 4 prior weeks of data have no baseline, and baseline facts are suppressed. Missing chart weeks reduce the baseline's denominator and are recorded.

### 2. The week-facts module

A pure module that takes the fetched data and returns a `WeekFacts` object and a prompt view. No network inside; the fetch layer is separate so the module runs on fixtures. The round 2 throwaway builder (`insights-redesign-research/step0/round2/build.py` in the vault) is the reference for the rules below; port its logic, with the corrections this section makes.

**Dedupe.** A scrobble is treated as a duplicate when the same artist and track was scrobbled under 10 minutes earlier and either the gap is under 150 s or one of the pair shares its timestamp (±2 s) with another track. This is a heuristic: it will occasionally drop a real repeat of a very short track. Facts use deduplicated counts; the object keeps raw counts beside them, and the page says counts exclude likely duplicate scrobbles.

**Familiarity tiers.** `first_under_this_name` (0 before, history complete), `barely_known` (1 to 15 before), `lapsed` (20+ before and zero plays in a complete 3-, 6- or 12-month list minus this week), `all_time_favourite` (overall rank ≤ 25), `regular`, `occasional`, `unknown` (history missing, inconsistent or incomplete). An artist whose name contains a credit separator as a whole token (`&`, `and`, `feat`, `ft`, `x`, `with`, `+`) or a comma or slash is marked `name_uncertain`: it can never be `first_under_this_name`. This is uncertainty, not identity resolution, and it will also catch real names like "AC/DC"; the only effect is to withhold a first-plays claim.

**Album runs.** Consecutive scrobbles with the same artist and album and gaps under 90 minutes. A run is a candidate at 6+ tracks, or at 4+ tracks when it covers a whole tracklist of 4 or 5. Checked against the Last.fm tracklist using unique track identities (normalised titles, repeated tracks counted once, all discs concatenated):

| Verdict | Condition | Phrase |
|---|---|---|
| `start_to_finish` | ≥ 90% of the tracklist, includes its first and last track, ≥ 80% in order, ≤ 10% off-list | "X start to finish" |
| `most_of` | ≥ 60% of the tracklist in order, but not the above | "N of M tracks of X, in order" |
| `mislabelled` | > 30% of the run's tracks are not on the tracklist | caveat: "call it an X run" |
| `unverified` | no tracklist, the tracklist is shorter than the tracks played, or the lookup cap was reached | "N tracks in a row from X" |

A long run is never dropped for failing verification. A repeat-album fact needs two or more `start_to_finish` runs.

**Fact kinds and salience.** Scores are clamped to 0 to 100. Ties break by plays, then by name. Any ratio with a zero or missing denominator suppresses the fact. Weights are frozen as tested in round 2; changing them requires the eval (section 9). The prompt gets the top six.

| Kind | Fires when | Salience |
|---|---|---|
| discovery | first under this name or barely known, 8+ plays | 40 + 60 × novelty × min(1, plays/30); novelty 1.0 first, 0.9 barely known |
| repeat_album | 2+ `start_to_finish` listens of one album | 40 + 10 × min(listens, 3) + 40 × album novelty (1.0 under one prior listen, 0.5 under three, 0.1 otherwise) |
| volume_vs_normal | 20+ plays and ≥ 3× the artist's mean weekly plays over the prior 12 weeks (raw counts on both sides); not for new, lapsed or repeat-album artists | 45 + 8 × log2(min(ratio, 16)) + min(20, plays/2.5), max 95; four or more merge into one "spread" fact |
| genre_cluster | 3+ lapsed or new artists (3+ plays) sharing a top-3 tag, excluding noise tags and tags too broad to name a cluster (rock, alternative, indie, pop, electronic and their compounds); an artist joins one cluster at most, the largest | 55 + 8 × members, max 95 |
| returns | lapsed artists with 6+ plays not in a cluster, as one fact | 45 + min(25, total plays/2) + 5 if any absent 12+ months |
| breadth | artists at 10+ plays ≥ 1.5× the prior-12-week median and at least 4 more; or ≤ half with a median of 4+ | 60 + 30 × min(1, ratio − 1); 55 for narrow |
| single_listen | one `start_to_finish` listen or a run of 20+ tracks, where the album had under one listen before, or the artist's top tag is outside the week's top 10 tags, or the run is 20+ tracks | 45 + 25 new + 10 outlier + 10 long |
| album_chain | 3+ `start_to_finish` albums back to back | 60 |
| album_mode | share of plays inside 8+-track single-album runs strictly the highest of the last 5 weeks | 50 |
| last_week_faded | last week's top artists at ≤ 10% of their plays | 45 |
| themed_block | 60+ min, 12+ plays, 4+ artists in one tag bucket that is under 15% of the week | 40 |
| volume | total plays ± 20% vs the 4-week average | 35 |

Merging: a single listen by an artist who already has a stronger fact folds into it; an artist with a repeat-album fact gets no volume fact; a discovery inside a cluster is dropped.

Each fact is an object: `id`, `kind`, `salience`, `statement` (the pre-phrased sentence the model reads), `entities` (every artist and album name it mentions) and `quantities` (every number it states, each with its unit and the entity it belongs to). The guard reads `entities` and `quantities`; nothing parses `statement`.

**Quiet week.** Quiet is defined by salience, not by play count: if the top fact scores under 50, there is no model call. A 25-play week with a real discovery is not quiet and gets a note. Code renders one sentence by volume: zero or under 5 plays keeps today's sparse message; under 80% of the 4-week average, "A quiet week: N plays. <top artist> came up most."; otherwise "Nothing stood out this week: N plays, led by <top artist>."

**Question.** Only when the rank-1 fact (or rank 2 if rank 1 has none) has an unexplained edge: no plays recorded for 36+ hours before the window end after plays on 2+ days; first plays under this name; or a return after 12+ months. Kinds: what happened after, where did it come from, what started it, was it one sitting. The text is written by code and appended by code after the model's sentences; the model never writes or sees a question. Rotation: store per user the kind and subject of the last question returned in a response to the owner. If the new lead has the same subject, keep the same question; otherwise rotate away from the stored kind. Visitor requests never read or write this state.

**Prompt view.** Plain text, about 1 to 1.5k tokens: the window line with plays and the 4-week average (fact 0); the top six facts numbered by id; the top 8 artists with tier labels; caveats. Standing habits join as background in phase 2.

### 3. Note generation and the guard

Prompt: system "You're a friend who follows someone's scrobbles. Once a week you send them a short note about what they played." User: the prompt view, then the tested instruction (two to four sentences, second person, lead with the most notable item, connect two or three of the top items only when the facts themselves show the connection, under 90 words, no greeting or sign-off) and rules (use only the facts; nothing about how music sounds; no adjectives for music; no guessing at reasons, moods, taste or personality; no negation-contrast, no em dashes, no clichés; plain words; names as given). No few-shots. No question instruction.

Output is structured: a JSON array of sentences, each `{ "text": "...", "facts": [ids] }`. The page renders the texts joined, then the code-chosen question if any.

Config: `claude-opus-5-5`, reasoning `low`, `maxTokens` 5000 (measured output 80 to 540 tokens including thinking), bump `USER_INSIGHTS_PROMPT_VERSION`.

**The guard's contract.** For each sentence, against the union of its cited facts:

1. Names. Build the set of every artist and album name in the whole `WeekFacts` object (not only the prompt view). Any of those names found in the sentence must be in the cited facts' `entities`. Matching is on normalised strings, longest name first.
2. Quantities. Every number in the sentence, after normalisation, must equal a quantity in the cited facts. Normalisation covers digits, number words one to twelve, "once/twice/three times", "a/an/one" before a unit, "a year" = 12 months, "half a year" = 6 months, and full versus abbreviated weekday and month names. Where the fact ties a quantity to an entity and the sentence names exactly one entity from its cited facts, the quantity must be one tied to that entity or to no entity.
3. Banned claims. "first time", "first ever", "never" fail unless a cited fact's kind allows it; "under this name" facts allow only "first plays under this name" or "first plays on record".
4. Shape. Two to four sentences; every sentence cites at least one fact; rank 1 is cited by the first sentence.

On failure, regenerate once; on a second failure, the page shows the code-rendered line for the rank-1 fact (the same renderer visitors get, in second person). Only guarded notes are cached, through `isCacheableResponse()`.

**What the guard does not prove.** A name the listener never played, invented by the model, is outside the week's name set and is not detected by rule 1. Relations between facts stated in free prose (order, simultaneity, "fits the pattern") are not checked. Both are covered only by the eval's rubric and corrupted-example tests. Structured output with cited facts has not been run yet; the first implementation task after the module is to run it on the fixtures. If it flattens the prose, the fallback is the same guard applied per sentence against all prompt-view facts.

Acceptance tests for the guard: the round 2 outputs must pass, including "one track play", "two full listens", full weekday names where the facts abbreviate, and "a year away" for "12+ months". Deliberately corrupted versions must fail: a swapped count ("Grant Green had 41 plays"), a name from the week outside the cited facts, an added "for the first time", a fifth sentence.

### 4. Owner and visitor

The header reads "Your week" for the owner and "<username>'s week" for visitors.

The owner gets the guarded note plus the question. A visitor gets one code-rendered third-person sentence built from the rank-1 fact's structured fields, one template per fact kind (for example "<username> played Eternal Embers by Meltt start to finish three times this week."), or the quiet-week sentence in third person. No model call, no question, no question-state access.

### 5. Where it runs, caching and privacy

**Inline, no background job.** The page already loads the summary with one client fetch to `/api/internal/user-insights-summary` and waits for the response; today that call takes about 9 seconds. The new generation runs inside that same request: fetch, compute facts, call the model, guard, respond. There is no `waitUntil` compute and no polling. Every partition, tracklist, tag and list is written to KV as it is fetched, so a request the client abandons still warms the next one. `waitUntil` is used only for those fire-and-forget cache writes.

**Concurrency.** Two simultaneous requests for the same user may both generate. That is tolerated: they compute from the same data, and the note cache is keyed by a signature of its inputs, so whichever finishes last writes an equivalent entry. A best-effort KV marker `insights:generating:<user>` (TTL 60 s) lets a second request return the previous cached note with a "refreshing" flag instead of starting a duplicate; correctness never depends on it.

**One reuse rule.** The note is cached under `insights:note:<user>:<signature>`, where the signature hashes the rule version, the prompt version, the top-six fact statements with their ids, the top-artists line and the caveats. Window timestamps and `pulled_at` are not part of it. A note is served only when the freshly computed signature equals its key. TTL 8 days, so a signature that recurs within the week costs no model call. There is no re-validation of an old note against new facts and no "top fact unchanged" shortcut.

The facts object is cached under `insights:facts:<user>` for 24 hours with its `pulled_at`. Within that day a page load reuses it without touching Last.fm. Refresh (owner only, 5-minute cooldown as today) discards it, re-pulls the current day's scrobbles, recomputes, and regenerates only if the signature changed. The page shows when the data was pulled.

**Privacy.**
- The profile-visibility check runs on every request that reads facts, a note or the visitor line, before any cache read. A profile switched to private stops serving visitors immediately even though cached entries remain.
- The full facts object never reaches the browser. The response carries the note text, the question, the header and `pulled_at`.
- Facts and prompt views are never logged. Logs carry the user, the fact kinds and saliences, counts of calls, and guard outcomes.
- Account deletion and Last.fm unlink delete the user's `insights:*` and per-user `lastfm:*` keys. Today's account deletion does not clear KV; this design adds that step.

**Storage budget.** Per active user: 36 day partitions (about 60 scrobbles a day at roughly 150 bytes each, under 0.5 MB for a heavy listener), four period and overall lists (under 0.5 MB), 8 weekly charts, facts and notes: under 1.5 MB, all expiring within 40 days. Global tracklists and tags expire in 30 days. At 50 active users that is under 100 MB including globals; the builder adds a simple counter or periodic check so the figure is known rather than assumed.

### 6. Timezone

Add `users.timezone` (IANA string, nullable). Set it from `cf.timezone` whenever the owner loads a page while signed in (the homepage already reads it). Use the stored owner timezone for every viewer of that profile. When null, use UTC and omit time-of-day phrases (keep dates). Migration `011_user_timezone.sql`.

### 7. Removals and config changes

Delete `FORBIDDEN_CONSTRUCTION_PATTERNS`, `containsForbiddenConstruction` and the scrub pass; delete `FEW_SHOT_EXAMPLES`; drop the top-five sum as `weeklyPlayCount` and the 6-month `isRegular` flag. The summary route's `MIN_PLAYS_THRESHOLD` check is replaced by the quiet-week rule. The recommendations route keeps its own threshold and behaviour unchanged in phase 1. `temperature` stays in the config only because `AITaskConfig` requires it.

### 8. Albums to Explore (phase 3, recorded here)

Pass the fired facts into the recommendations prompt so each pick anchors to one; exclude by lifetime playcount instead of the 6-month top 20; apply the same reuse rule.

### 9. Tests and eval

**Fixtures.** The owner's three annotated weeks (2026-05-24, 2026-05-31, 2026-06-12 to 06-19 15:40 PT) with his gold summaries, committed here as module inputs. One other public-profile user's week, kept in the private vault and run locally. The raw Last.fm responses behind them are archived in the vault (`insights-redesign-research/raw-lastfm-cache.tar.gz`); a one-off script converts them. For the past weeks the "before this week" counts were reconstructed from weekly charts; the module takes inputs and does not care how they were derived. One fixture is captured live in production shape for the owner's current week at implementation time, to exercise the fetch layer end to end.

**Held-out weeks.** Because the weights were tuned with the three gold summaries in view, three more weeks are captured that were never looked at during tuning: two of the owner's and one of another listener's. No lead is prescribed for them. They are judged for guard pass, rubric pass and plausibility by the owner reading the notes. The weights do not change in response to them without re-running everything.

**Synthetic cases** for the module: a 2,000-play week hitting the page cap; an empty week; a new account with one prior week; truncated period lists (`complete: false`); a lifetime count older than this week's scrobbles; legitimate back-to-back repeats of a 2-minute track beside same-second duplicate pairs; a multi-artist compilation; an album with no tracklist and one with a shorter tracklist; missing tags; a week spanning a DST change; a 10-track ordered excerpt missing both ends of a 12-track album (must not say "start to finish"); a 4-track EP played whole.

**Unit tests**: partition reads and window filtering, dedupe, tiers including `unknown` and `name_uncertain`, run verdicts, each fact kind firing and not firing, clamping and tie-breaks, merging, the ranking order on the committed fixtures (jazz cluster first on May 24, Siiga first on Jun 12), question selection and rotation, quiet rule, the guard's acceptance and corruption cases, the visitor templates, the signature.

**Endpoint tests** with Hono's `app.request()`: a private profile refuses a visitor on every path even with warm caches; owner versus visitor responses; the facts object never appears in a response; refresh cooldown; a second concurrent request while the generating marker is set; Last.fm failure returns the error response and caches nothing; account deletion clears the user's keys.

**Live eval** (extends `apps/web/scripts/ai-eval.ts`, costs real money, never runs in CI): run manually before merging any change to the prompt, the model config or the weights. Two runs per fixture and held-out week. It fails if any run fails the guard twice, or trips the rubric. The rubric is concrete: a banned list of taste and sound words and phrases ("best", "great", "gorgeous", "lush", "sounds like", "for me", "I'd", "still holds up", "says a lot", "clearly", "must have"), em dashes, and negation-contrast patterns. Opener overlap across weeks is reported for the owner to read and does not fail the run.

Deterministic tests (unit, endpoint, guard) run in CI.

### 10. Phasing

1. This design: data layer with partitions and caps, the module, structured note prompt and guard, quiet rule, code question, visitor line, timezone, privacy and deletion, removals, fixtures, tests and eval. Estimated 4 to 5 days. The phase-1 baseline uses 8 weekly charts per user.
2. Chart notes, a deeper weekly-chart backfill (a year) for "since May" and album-level returns, tag habits, cron precompute if page latency needs it, a Claude-written visitor note if wanted. Estimated 2 to 3 days.
3. Recommendations tied to facts, Sonnet test, stored reply.

## Left to the builder

- Module location and file layout; fetch orchestration and concurrency (the throwaway used 4).
- Exact KV key names and `cache.ts` entries, within the keys and lifetimes named above.
- Tokenisation details of the guard, as long as it meets the contract and passes the acceptance and corruption tests.
- The visitor templates' wording per fact kind.
- Tag noise and broad-tag lists: start from the reference builder's, extend from fixtures.
- How the storage figure is measured.

## Calls made after the reviews

A fresh engineer (builder check) and an independent GPT-6.1-sol review read this document. These were settled by the author, not the owner:

- Tag-based facts are in phase 1; the measured cold figure is about 75 calls and the bounds are the caps table (section 1).
- The module reads 35 days of scrobbles, in stable UTC day partitions, so a moving window does not invalidate history (section 1). The earlier "blocks aligned to the current window" would have missed its cache on every generation.
- Period lists are fetched complete, and every history input carries provenance; incomplete or inconsistent history yields `unknown` and suppresses first-play and absence claims (section 1).
- "Start to finish" requires 90% of the tracklist including its first and last track; weaker runs are phrased by what they are (section 2).
- Salience is clamped, ties are defined, zero baselines suppress facts, and cold-start accounts get no baseline facts (section 2).
- The grounding promise was narrowed to what the guard can check. The note is structured output with cited facts, facts carry typed entities and quantities, and the guard's limits are stated (section 3).
- The question is appended by code; the model never writes it (sections 2 and 3).
- Generation runs inline in the existing request; the background job and polling were removed (section 5).
- One cache reuse rule: identical semantic inputs. The "note survives if it still validates" path and the "top fact unchanged" shortcut were removed (section 5).
- Visibility is checked on every read, facts stay server-side and out of logs, and account deletion clears KV (section 5).
- The recommendations route is untouched in phase 1 (section 7).
- Weights are frozen; a held-out set, synthetic cases, endpoint tests, a concrete rubric and a defined live-eval policy were added (section 9).
- Quiet is defined by salience; the wording depends on volume (section 2).
