# Design: Warmer `/insights` summary voice (few-shot + Claude)

**Issue:** [#32](https://github.com/rianvdm/listentomore/issues/32)
**Date:** 2026-06-19
**Status:** Design — awaiting review

## Problem

The "Your Week in Music" summary on `/insights` reads cold and AI-generated. The prompt is already saturated with anti-AI-pattern prohibitions, so adding more "Do NOT" rules doesn't help — the model evades them and the core stance stays clinical. Two structural causes (not rule gaps):

1. **Stance:** the persona is "an observer who finds the pattern you missed" — an analyst profiling a data-subject, which is inherently cold. Every sentence is *about the listener*, none reacts to the *music*.
2. **Method:** warmth is pursued through a long negative-instruction list, which produces voiceless, hedged prose. Voice is taught by example, not prohibition.

Also: `userInsightsSummary` sets `temperature: 0.7`, but it routes through GPT-5.4 on OpenAI's Responses API, where temperature is effectively pinned to 1 (confirmed by the config's own note at `packages/config/src/ai.ts:60-63`). The warmth dial we think we have is inert.

## Approach (committed in the issue)

**A. Change the stance + teach voice by example.** Rewrite the system persona to a friend reacting to the week, *allowed to have opinions about the music itself*. Replace most of the "Do NOT" list with hand-authored gold-standard few-shot examples in the owner's voice. Keep only the two structural bans the current prompt misses. Drop the atmosphere-seeding "temperature" framing.

**C. Add Claude (Anthropic) as a provider and A/B against GPT-5.4.** Claude writes warmer and follows voice exemplars more faithfully; the rest of the stack is Claude. Default this task to `claude-sonnet-4-6`; test `claude-opus-4-8` as a quality ceiling.

A and C ship together. C has no dependency on the examples, so it can be built in parallel while the examples are authored.

## Decisions

| Decision | Choice | Notes |
|---|---|---|
| Few-shot form | **Hybrid:** 1 full input→output pair + 2 voice-only exemplars | The pair grounds the model in this data shape (using the familiar/new flags, naming real tracks); the 2 voice-only reinforce register cheaply. |
| A/B mechanic | **Internal debug route** `GET /api/internal/insights-ab?username=X` | Runs all three provider/model configs on the same week's data, cache-bypassed, returns them side by side. Removable scaffolding. |
| "Fallback to GPT-5.4" | **Config-switchable only** | Reverting = flip `userInsightsSummary.provider` back to `'openai'`. No runtime try/catch in v1. |
| Default model | `claude-sonnet-4-6` | Rian's explicit cost/latency call for a daily-cached weekly summary; `claude-opus-4-8` is the ceiling test in the A/B route. |
| Anthropic transport | **Raw `fetch` mirroring `OpenAIClient`** (recommended) | The AI layer is deliberately SDK-free (`OpenAIClient` uses raw `fetchWithTimeout`, no `openai` dep). Mirroring it avoids a new dep and matches house style. ⚠️ The `claude-api` skill's default is the official `@anthropic-ai/sdk`; flagged for review — if preferred, swap the adapter internals to the SDK (works in Workers). |

## Architecture

### Part A — Prompt rewrite (`packages/services/ai/src/prompts/user-insights-summary.ts`)

1. **Extract a pure message builder** `buildUserInsightsMessages(listeningData): ChatMessage[]` (exported), returning `[systemMessage, userMessage]` (plus interleaved few-shot example turns). Both the production generate function and the A/B route consume it. This makes the prompt unit-testable and keeps one source of truth.
2. **New system persona:** a friend who pays attention to what someone listens to and *reacts to the music* — allowed to have opinions about songs and records, not just profile the listener.
3. **Cut the "Do NOT" wall** down to the two structural bans the current prompt misses:
   - the "not X / less-like-X-more-like-Y" construction **anywhere** (current prompt only bans it as an *opening*),
   - an **em-dash cap** (≤ 3 per summary).
4. **Few-shot (hybrid):** one full `[example week data] → [gold summary]` pair as prior turns, then 2 standalone gold summaries presented as voice references, then "Now here is THIS week: …". All summaries are hand-authored by the owner. The paired example's *input block* is trimmed to the **production `ListeningData` shape** (top-5 artists with familiar/new flags, top-5 albums, ~30 recent tracks, 20 historical artists, `weeklyPlayCount`).
5. **Drop** the "the week has a clear temperature" line and other atmosphere-seeding language.
6. **Config flip** (`packages/config/src/ai.ts`, `userInsightsSummary`): `provider: 'anthropic'`, `model: 'claude-sonnet-4-6'`, `temperature: 0.8` (now a *live* dial on Sonnet — unlike GPT-5.4). Keep `maxTokens: 1500`, `cacheTtlDays: 1`. Remove `verbosity` (OpenAI-only; ignored by the Anthropic adapter anyway).
7. **Cache-bust:** add a prompt-version token to the cache key so old cold summaries don't linger. The key is built in `AICache.makeKey` as `ai:<task>:<params>`; add a version param (e.g. `'v2'`) to the `cache.get`/`cache.set` calls inside `generateUserInsightsSummary` **and** to the `ai.cache.delete('userInsightsSummary', username)` call at `apps/web/src/api/internal/insights.ts:119`.

### Part C — Anthropic provider

1. **`AnthropicClient implements ChatClient`** (`packages/services/ai/src/anthropic.ts`), mirroring `OpenAIClient`:
   - constructor `(apiKey, rateLimiter?)`; `chatCompletion(options)` → `POST https://api.anthropic.com/v1/messages` via `fetchWithTimeout` (`timeout: 'slow'`).
   - **Extract the system message** from `options.messages` to the top-level `system` param; pass remaining user/assistant turns as `messages`.
   - `maxTokens` → `max_tokens` (required by Anthropic).
   - **Omit `temperature` for opus-tier models** (`claude-opus-4-8`, `claude-opus-4-7`, `claude-fable-5`) — those reject sampling params with a 400. Pass it for `claude-sonnet-4-6`/Haiku. (Guard via a small `MODELS_WITHOUT_TEMPERATURE` set or a `startsWith('claude-opus-4-7'|'-4-8')` check.)
   - Ignore OpenAI-only options (`reasoning`, `verbosity`, `webSearch`).
   - Headers: `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`.
   - Parse `content[0].text`; build `AIResponseMetadata` with `provider: 'anthropic'`, `model` from the response, `api: 'messages'`, `usage` from `usage.input_tokens`/`output_tokens`.
2. **Config** (`packages/config/src/ai.ts`):
   - `AI_PROVIDERS.anthropic = { baseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-sonnet-4-6' }`. Adding this makes `'anthropic'` a valid `AIProvider` automatically (`AIProvider = keyof typeof AI_PROVIDERS`).
   - `RATE_LIMITS.anthropic = { requestsPerMinute: 50, tokensPerMinute: 40000 }` (conservative client-side throttle for a low-volume, daily-cached call; well under any real Anthropic tier — tune later if needed).
3. **Types** (`packages/services/ai/src/types.ts`): widen `AIResponseMetadata.provider` from the literal `'openai'` to `'openai' | 'anthropic'`, and add `'messages'` to the `api` union.
4. **Service wiring** (`packages/services/ai/src/index.ts`):
   - `AIServiceConfig` gains `anthropicApiKey: string`.
   - construct `this.anthropic = new AnthropicClient(config.anthropicApiKey, new AIRateLimiter(config.cache, 'anthropic'))` (the `AIRateLimiter` is already provider-parameterized — `new AIRateLimiter(cache, 'openai')` at `index.ts:82`).
   - `getClientForTask(task)` switches on `getTaskConfig(task).provider` → returns `this.anthropic` or `this.openai`.
   - expose `this.anthropic` publicly (like `this.openai`) so the A/B route can reach it.
5. **Secret/binding:** add `ANTHROPIC_API_KEY` to `apps/web/.dev.vars` and as a `wrangler secret` in prod; thread it into `AIServiceConfig` wherever the `AIService` is constructed (the binding/middleware that builds `c.get('ai')`).

### A/B debug route (`apps/web/src/api/internal/insights.ts`, new handler)

`GET /api/internal/insights-ab?username=X`, gated by `requireSessionAuth` + reusing `getUserWithInsightsAccess` (owner/privacy check). Reuses the exact `ListeningData` assembly from `/user-insights-summary` (`insights.ts:124-156`), calls `buildUserInsightsMessages(data)` once, then runs the messages through three `(client, model)` combos **cache-bypassed**:

- `{ client: ai.openai, model: 'gpt-5.4' }`
- `{ client: ai.anthropic, model: 'claude-sonnet-4-6' }`
- `{ client: ai.anthropic, model: 'claude-opus-4-8' }`

Returns `{ gpt54, sonnet46, opus48 }`. Throwaway scaffolding — delete once the comparison is done. (Bypassing cache = calling `client.chatCompletion({ model, messages, maxTokens: 1500, temperature })` directly, not the cached `generateUserInsightsSummary` helper.)

## Gotchas captured

- **Opus rejects `temperature`** (400) — the adapter must omit it for opus-tier; live on Sonnet. This would have surfaced at A/B time on the opus path.
- **`weeklyPlayCount` is the sum of the top-5 artists' playcounts** (`insights.ts:133`), not the true weekly total — match this when trimming the paired example's input.
- **Historical = `getTopArtists('6month', 20)`** (20, not more); the paired example's rotation list is trimmed to 20.
- **System-message extraction:** Anthropic takes `system` as a top-level param; the adapter pulls it out of the `messages` array (mirror of `OpenAIClient.convertMessagesToResponsesFormat`).
- **Cache key versioning** touches three call sites (get, set, delete) — miss one and stale summaries leak or refresh breaks.

## Testing

- **`buildUserInsightsMessages`** (pure, unit): asserts the new persona is present, the two structural bans appear, the few-shot example summaries are embedded, and the atmosphere-seeding lines are gone. Data-driven: feeds a sample `ListeningData` and checks the familiar/new flags render.
- **`AnthropicClient.chatCompletion`** (unit, mocked fetch): system message extracted to top-level `system`; `maxTokens`→`max_tokens`; **temperature omitted for `claude-opus-4-8`, present for `claude-sonnet-4-6`**; metadata `provider: 'anthropic'`; error path throws on non-200.
- **`getClientForTask`**: returns the anthropic client for a task configured `provider: 'anthropic'`, openai otherwise.
- **Metadata type:** `provider: 'anthropic'` type-checks (widened union).
- A/B route: light smoke (auth gate + shape), not a full integration test.

Follow the repo's Vitest conventions (`globals: true`, tests in `src/__tests__/` mirroring source, mock `globalThis.fetch`).

## Acceptance criteria (from the issue) → how met

- Reads like a friend reacting to the music, ≥1 opinion about a song/album → persona rewrite + few-shot + an opinion in every gold example.
- No "not X — but Y" / "less like X, more like Y" → explicit anywhere-ban + examples that never use it.
- ≤ 3 em dashes → explicit cap + examples that obey it.
- Voice driven by hand-authored few-shot, not a prohibition list → the "Do NOT" wall is cut to two bans; voice comes from examples.
- Runs on Claude with a clean fallback to GPT-5.4 → `provider: 'anthropic'` default; one-line config revert.
- Side-by-side on 3–4 real weeks before shipping → the internal A/B route.

## Out of scope

- The recommendations prompt (`user-insights-recommendations.ts`) — structured output, separate concern; follow-up if wanted.
- Runtime try/catch provider fallback — config-switchable only in v1.

## Open dependency

The few-shot examples must be **hand-authored by the owner** (the model can't invent the voice). Worksheet with the 4 real weeks in prompt-input shape is at `~/git/product-ai/05-personal/side-projects/listentomore/2026-06-19-insights-voice-examples-worksheet.md`. Build can proceed to ~95% (all of C, plus A's structure with placeholder example slots) before the real examples are slotted in.
