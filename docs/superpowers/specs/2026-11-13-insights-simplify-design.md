# Design: Simplify the weekly insights note

**Date:** 2026-11-13
**Status:** Approved by the owner 2026-11-16
**Branch:** `insights-simplify` (from `main` at `d4c1def`)
**Replaces:** the note sections of `2026-11-08-insights-week-facts-design.md` and all of `2026-11-10-insights-trivia-card-design.md`. The week-facts computation from the 11-08 design stays.

## Why

The owner wants the Insights tab to read like a friend talking about his week. That means framing the week, connecting records, and giving an opinion now and then ("You went back to In Rainbows and ran the whole thing. Still the one, no argument."). That's the voice of his June gold summaries.

Two rounds of work since 2026-11-08 made the tab worse at this:

1. The 11-08 redesign fixed the real cause of the old summary's inventions: the model was fed wrong and thin data. It also banned opinions and added a guard that checks every sentence's names and numbers against the facts it cites. The owner's own June examples would fail that guard. When the guard rejects the note twice, or the top fact scores under the quiet threshold, the page shows a code template instead ("You played Ethel Cain 40 times this week, at 3 or more times your usual rate.").
2. The 11-10 "Did you know" card needs a MusicBrainz credits client, up to 30 lookups per load, a web-search fallback, its own caches and a race fix (#61). On 2026-11-12 its first live card linked Ethel Cain to The Drums through a session drummer. The card spec said to show no card before a weak one.

Together the two rounds added about 21,000 lines across 137 files. The owner's verdict: overengineered, and the tab is less useful than before.

## Goals

1. Opus writes the owner's note from the computed week facts, in the June voice: two or three short paragraphs, framing and connecting the week, opinions about records allowed.
2. One simple check before showing the note, in place of the guard.
3. Delete the card and everything that exists only for it.
4. Delete the per-sentence citation format, the question, and the guard.
5. Leave the code smaller than it is today and easy to change.

## Non-goals

- Changing how week facts are computed (dedupe, album runs, returns, tiers, release week, timezone). They stay as shipped.
- Changing Albums to Explore.
- A model-written note for visitors.
- Chart notes (phase 2 of the 11-08 design). Not planned.

## Anti-goals (failure even if it works)

- Text that reads as AI-generated. Every sentence a user sees must pass `~/git/product-ai/01-context/avoid-ai-patterns.md` (owner's private file; the eval carries the checks that matter).
- Wrong listening claims: a number, a played-through album or a return that didn't happen.
- Claims of fact about records that aren't in the week facts (years, band members, who played on what). Opinions about records are welcome; facts about them aren't, because that's where a wrong drummer comes from.
- A note that reads the same every week. The opening and the framing should change with the week.

## Approaches considered

- **A. Keep the facts, let the model write (chosen).** Keep the computed week facts, which fixed the real cause. Let Opus write freely in the owner's voice with one light check. Delete the card, the guard and the question.
- **B. No AI note.** Code-rendered lines only (new, back, played through, dropped off). Always true and cheap, but it gives up the voice the owner asked for.
- **C. Tune what's there.** Loosen the guard and raise the card's bar. Least churn, but it keeps every piece the owner called overengineered.

The owner chose A on 2026-11-13. This reverses one 11-08 decision, "no opinions in the summary." Now that the input is correct, the reason for that ban is mostly gone, and the ban had removed the voice.

## Design

### What the owner sees

```
Your week                                               [↻ Refresh]

<two or three short paragraphs from Opus>

Updated Nov 12, 2026, 4:46 PM. Counts exclude likely duplicate scrobbles.

💿 Albums to Explore
<unchanged>
```

No card and no question. The header, the refresh button and its cooldown, and the footer stay as they are.

### The prompt

Rewrite `packages/services/ai/src/prompts/user-insights-note.ts` (bump `USER_INSIGHTS_PROMPT_VERSION` to `v8`):

- **Input:** the existing prompt view (`renderPromptView`): the week line, the ranked facts and the top artists with tiers. Add top albums if the view lacks them. Pass every ranked fact, not only the top six (cap at 10).
- **Voice:** a friend who follows his scrobbles. Two or three short paragraphs, about 120 to 200 words. Lead with what the week was about. Connect facts when they connect. One opinion about a record is fine, phrased as an opinion.
- **Examples:** the owner's June gold summaries from the v3 prompt (`git show a161ed0:packages/services/ai/src/prompts/user-insights-summary.ts`, `FEW_SHOT_EXAMPLES`), as voice references only. Use the two voice-only examples, not the paired one, whose input block was reconstructed. Remove their em dashes. The prompt says the examples show the voice, and that their artists and numbers aren't this week's.
- **Rules kept, as short positive instructions:**
  - listening claims (counts, days, played-through, returns, firsts) come only from the facts;
  - no facts about records beyond the facts given;
  - no guessing at mood or motive;
  - names are written exactly as given;
  - no negation-contrast and no em dashes.
- **Output:** JSON `{ "note": "<paragraphs separated by blank lines>", "names": ["<every artist and album named>"] }`.

### The check (replaces the guard)

Before the note is shown, code checks two things:

1. Every entry in `names` is in `wf.names` (this week's scrobbled artists and albums plus every fact's entities, so a faded artist named in a fact passes), compared with the existing `norm`/`matchKey` helpers, and appears in `note`. *(Builder's call, settled in design: `wf.names` already exists on cached facts, so no new field is needed.)*
2. Every integer in `note` appears somewhere in the prompt view. Numbers written as words aren't checked.

The model's list of names is self-reported, so a name it leaves out isn't caught. That's accepted: the input is now correct, and wrong names weren't the failure mode once it was. If the check fails, generate once more. If that fails too, show the code line (`renderLine`, second person) and log only the failure type, as today.

The em dash and negation-contrast checks run in the eval, not in production.

### Quiet weeks and visitors

- **Quiet, owner:** the owner's route calls the model whenever the week has 30 or more deduplicated plays, whatever `wf.quiet` says. Under 30, it shows the code line and makes no model call. This only changes the gate in `insights-week.ts`. `QUIET_THRESHOLD` and `wf.quiet` stay as they are in the facts, because they also pick the visitor's line and the fallback sentence, and changing them would mean recomputing facts. *(My call: it keeps week facts untouched as the non-goals say.)* The existing sparse message under `MIN_WEEK_PLAYS` (5) stays.
- **Visitors:** unchanged. They get the code-rendered third-person line.

### Caching and refresh

Unchanged: the note is cached per user under a signature of the facts plus the prompt version, refresh re-pulls recent tracks, and a cached note is reused when the facts haven't changed. The signature may need to cover all the facts the prompt now sees, not only the top six. That's the builder's call.

### What gets deleted

- The card: `apps/web/src/api/internal/insights-card.ts`, `insights-card-route.ts`, `insights-making-of.ts`, the `album-trivia` prompt and its AI config task, the card's page markup and script, and its tests.
- Card-only code in `@listentomore/insights`: `tieback.ts`, `card-albums.ts`, `standout.ts` (if nothing else uses it), and the card keys in `keys.ts`.
- The MusicBrainz credits client: `credits.ts`, `credits-parse.ts`, `credits-types.ts`, their tests, and any changes to `fetch.ts`/`errors.ts` that only the credits client needed. The builder checks this against `git diff a161ed0 -- packages/services/musicbrainz`.
- The guard: `guard.ts`, its tests, `logSafeFailures` and its failure-type lists.
- The question: `chooseQuestion`, question edges on facts if nothing else reads them, the `question` field in the response, and the question KV state.
- The rubric moves out of the production package into `apps/web/scripts/` if the eval still needs it. Otherwise it goes.
- Copy: the card's paragraphs and retention rows on `/privacy`, and any card mention on `/about`. The privacy page must describe what the code does after this change. Its claims trace to `docs/privacy-data-inventory.md`, so update that file too.

Existing card and question KV entries expire on their own. The builder writes a one-off script that deletes their key prefixes in production, and the owner runs it.

### Issues this closes

#61 (card races) and #62 (guard gaps, name-bearing logs, MusicBrainz client) close with the code they're about. #57 and #58 are guard rejections, so they close too.

### The gate before shipping

- Unit tests for the new check and the prompt parser. The existing week-facts tests stay green.
- The eval (`apps/web/scripts/insights-eval.ts`, slimmed to the note) runs the new prompt on all six fixtures in `packages/services/insights/__fixtures__` (three gold weeks, two held-out weeks, the 11-09 live week) and the owner's current week. It prints each note next to the owner's gold summary where one exists. The Siiga example in the prompt is the 2026-06-12 gold, so that week is marked "example in prompt" and the held-out and live weeks carry the decision. *(My call.)* It flags failed checks, em dashes, negation-contrast and any phrase of six or more words copied from the examples.
- **The owner reads the notes and decides.** That's the gate. There's no automatic pass rate.

## Left to the builder

- Plan order. Suggested: delete the card first and ship nothing, then the prompt and check, then copy, then the eval.
- How to parse `names` against played albums with edition suffixes (reuse `matchKey`/`stripEdition`).
- Whether `render.ts` loses templates that nothing calls once the question and card are gone.
- `maxTokens` and effort for the longer note.
