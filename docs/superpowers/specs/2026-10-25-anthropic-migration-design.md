# Move text generation from OpenAI to Claude

*Design, 2026-10-25. Status: approved by Rian after builder check.*

## Intent

Run every text-generation task on Anthropic models (Claude Opus 5.5 and Claude Sonnet 5.5) while keeping the OpenAI client fully working, so any single task can move back to OpenAI by editing its `AI_TASKS` entry. Rian has $100/month in Anthropic API credits that reset monthly; on current traffic the whole app runs for roughly a quarter of that.

The repo already has the shape for this: `AI_TASKS` carries a `provider` per task, `AIService.getClientForTask()` routes on it, and `AnthropicClient` exists and serves `userInsightsSummary` today. This project closes the gaps that stop the other tasks from flipping.

## Goals

- Every task in `AI_TASKS` runs on Anthropic after the config flip.
- Quality of the cached summaries (artist, album, genre, recommendations) is at least what GPT-5.6 Terra produces today.
- The inline-link convention survives intact: `[[Artist Name]]` and `{{Album Name}}` placeholders arrive clean and get post-processed into search links exactly as now. **This is the failure Rian would mind most.**
- Switching a task between providers stays a config edit: `provider` and `model`, nothing else.

## Non-goals

- Deleting the OpenAI client, its rate limiter, `errors.ts`, or `OPENAI_API_KEY`. They stay, tested, as the switch-back path.
- Adopting the Anthropic SDK. The client stays raw `fetch` like the rest of the services (my call; it keeps the Worker bundle small and matches the existing clients).
- Prompt rewrites for Claude. Prompts stay as they are unless the eval (below) shows a specific problem.
- Streaming, prompt caching, batch API. Volume is far too low to matter.
- Replacing image generation. It is being deleted, not migrated.

## Anti-goals

- A summary cached for 180 days with a broken or missing link placeholder.
- A visible slowdown on the pages people wait on (artist sentence, ListenAI, Discord `/ask`).
- Citation fragments, footnote markers, or raw URLs from web search leaking into the prose.

## Constraints

- Single Worker, Hono, Turborepo, pnpm. Conventions in `AGENTS.md` apply (ABOUTME headers, error pattern, test layout).
- Observed traffic (Workers Observability, 7 days, sampled): about 40 fresh generations, 24 random facts per day from the cron, zero truncations, zero provider errors.
- Anthropic org is on the Scale tier (10,000 RPM, 10M input tokens/min, 2M output tokens/min per model class, verified from response headers 2026-10-25). The existing 50 RPM KV rate limiter can stay as-is.
- Pricing used for estimates: Opus 5.5 $4/$20 per MTok, Sonnet 5.5 $2/$10, web search $10 per 1,000 searches, search results billed as input tokens.

## Decisions

### 1. Model split

| Task | Provider / model | Effort | Why |
|---|---|---|---|
| artistSummary, albumDetail, genreSummary, albumRecommendations, userInsightsSummary, userInsightsRecommendations | `anthropic` / `claude-opus-5-5` | `low` | Cached for days to months; what's on the page matters more than cost |
| artistSentence, listenAi, randomFact | `anthropic` / `claude-sonnet-5-5` | `low` | Someone is waiting, or it's the hourly cron |

`userInsightsSummary` moves from `claude-sonnet-5` to `claude-opus-5-5` to match the other long-form tasks (my call; Rian can keep it on Sonnet if the warmer-voice work in `docs/superpowers/specs/2026-06-19-insights-warmer-voice-design.md` argues otherwise, and the eval covers it).

`maxTokens` values start as they are. They were sized for reasoning plus prose on GPT-5.6, and Claude's thinking tokens count against `max_tokens` the same way. The exception is the Sonnet tasks, which have no Claude measurement behind them: `artistSentence` (400) and `listenAi` (500) are tight for adaptive thinking plus up to three search hops. If the eval shows either truncating, the builder raises `maxTokens` (only generated tokens are billed, so the ceiling is free) and reruns. Only if truncation persists after that may the builder send Sonnet 5.5 `thinking: { type: 'between_tools' }` for that task, which turns thinking off on a non-tool turn; this is a per-task mapping branch, documented next to the effort mapping, and not the default (my call).

### 2. Delete playlist cover generation

Remove `generatePlaylistCoverPrompt`, `generatePlaylistCoverImage`, `prompts/playlist-cover.ts`, the `playlistCoverPrompt` task, the `IMAGE_GENERATION` config, `OpenAIClient.generateImage()`, the `ImageGenerationOptions` / `ImageGenerationResponse` types, the two `AIService` convenience methods, their exports, and any tests. Nothing outside the AI package calls them (verified by grep). Rian is not bringing this back.

### 3. Config vocabulary stays OpenAI-shaped; each client translates

`ReasoningEffort` and `Verbosity` remain the config types. The point is that a provider flip never touches per-task settings.

Anthropic client mapping:

| Config | Claude request |
|---|---|
| `reasoning: 'none'` or `'minimal'` | `output_config: { effort: 'low' }` (Opus 5.5 cannot disable thinking) |
| `reasoning: 'low' \| 'medium' \| 'high' \| 'xhigh' \| 'max'` | same value in `output_config.effort` |
| `reasoning` unset | send `output_config: { effort: 'low' }` anyway, because Opus 5.5 defaults to `medium` and every task here wants `low` (my call; document it next to the mapping) |
| `verbosity` | ignored; the prompts already state length |
| `temperature` | never sent for any Claude model. Replace the `MODELS_WITHOUT_TEMPERATURE` denylist with "omit for all Claude models" since every current model rejects it |
| `webSearch: true` | `tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }]` |

### 4. Web search in the Anthropic client

- Request: add the tool above when `webSearch` is set. `max_uses: 3` is the ceiling per call (my call; `albumRecommendations` is the only task that routinely needs more than one search).
- Response handling: collect **only** `text` blocks, in order, and join them. Ignore `server_tool_use`, `web_search_tool_result`, and `thinking` blocks. Ignore the `citations` array on text blocks; the prose itself must carry no citation markup. Set `features.webSearchUsed` when any `server_tool_use` block has `name: 'web_search'`, and record `usage.server_tool_use.web_search_requests` in metadata for cost visibility.
- `stop_reason: 'pause_turn'`: resend with the assistant turn appended (no extra user message) at most once, then treat as a normal response. Expected to be rare for single-shot prompts.
- `stop_reason: 'refusal'`: log at warn, return the content, mark `truncated: true` so `isCacheableResponse()` refuses to cache it. (Reusing the flag avoids a new field; the log line says "refusal".) No server-side fallback parameter: a refusal on a music summary is rare enough to regenerate next request.
- Timeout: web-search tasks use the `verySlow` (60s) tier of `fetchWithTimeout`; others stay on `slow` (30s). The current 30s is tight for Opus plus three searches.
- Reference: `https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool.md` for block shapes. Verify against the live doc rather than memory; the tool version string above is current as of this design.

### 5. Route the hardwired tasks through the provider router

`generateAndStoreFact` / `generateRandomFact` and the `AIService` methods around them currently take `OpenAIClient`. Change the parameter type to `ChatClient` and have `AIService` pass `getClientForTask('randomFact')`. Same for anything else typed to a concrete client.

### 6. Keep OpenAI as a live switch-back path

- `openai.ts` loses only `generateImage()` and the image types. Chat Completions and Responses paths stay, with their tests.
- `RegionUnsupportedError` stays OpenAI-specific. Anthropic's region block is a different error; a plain `Anthropic API error` is acceptable behaviour for it today.
- Docs must describe both providers as live options, not OpenAI as legacy.

### 7. Rate limiting

Keep both KV rate limiters. Add a `recordRateLimitResponse()` call on a 429 from Anthropic using `retry-after` (the Anthropic client doesn't do this today; the OpenAI one doesn't either, so this is optional polish, builder's call).

### 8. Evaluation before merge (throwaway script)

A script under `scripts/` (gitignored output, committed script is fine) that runs the real prompt functions against both providers for a fixed list covering **all nine tasks**: 6 artists (used for both `artistSummary` and `artistSentence`), 6 albums (3 recent, 3 catalog), 4 genres, 4 recommendation seeds, 2 insights fixtures (summary and recommendations), 4 `listenAi` questions, and 4 `randomFact` runs. For each response it reports:

- placeholder counts (`[[` / `{{`) and whether `replacePlaceholders` produced the expected number of links
- forbidden patterns: raw `http`, `](http`, `[1]`-style markers, leading heading or title line, bullet points where banned
- `truncated`, `webSearchUsed`, tokens, wall time

Run it once against OpenAI (baseline) and once against the new config. Budget: under $3 for all rounds.

**When a check fails** (Rian's decision): the builder fixes and reruns rather than stopping. Allowed fixes, in order of preference: Anthropic client parsing or post-processing; `maxTokens` or effort for the failing task; a prompt edit. Any prompt edit is shared with the OpenAI switch-back path, so the rerun covers both providers and the OpenAI baseline must not regress. Cap at three fix-and-rerun rounds; if a task still fails after three, it stays on OpenAI in this PR and the report says why. Rian reviews one final side-by-side (Claude vs GPT, all tasks) before merge.

### 8a. Existing cache entries

Let them expire (Rian's decision). GPT-written summaries already in KV keep showing until their TTLs run out; only uncached pages get Claude. No purge step, no regeneration spike, no extra cost line.

### 9. Docs and config hygiene

- `README.md`, `docs/how-to/ai-models.md`, `AGENTS.md` (`maxTokens` note: say "reasoning or thinking tokens"), the `AI_TASKS` comment block (replace the GPT-5.6 tier table with a two-provider table), `apps/web/wrangler.toml` secret comments.
- `.dev.vars`: leave `OPENAI_API_KEY`; remove the stale `PERPLEXITY_API_KEY` line. `ANTHROPIC_API_KEY` is already set in both Workers' secrets.
- `apps/discord-bot` needs no change beyond what the shared package does; confirm it builds.

## Left to the builder

- Exact structure of the Anthropic request body builder and response parser; whether to split `anthropic.ts` into request/response helpers.
- Test cases, following the existing `ai.test.ts` patterns (mock `fetch`, assert request body, assert metadata). Must cover: effort mapping including `none` to `low`, temperature omitted, web search tool present only when requested, text-only block extraction with `server_tool_use` and `web_search_tool_result` interleaved, `pause_turn` single resume, `refusal` marked uncacheable, 60s timeout tier for search tasks.
- Order of work. Suggested: delete image gen first (smallest, isolates the diff), then client gaps with tests, then eval script and run, then config flip and docs.

## Pre-flight checks

Two assertions in this document the builder must verify before the config flip:

- `ANTHROPIC_API_KEY` is set as a secret on `listentomore-discord-bot` (`wrangler secret list` in `apps/discord-bot`). The bot's `wrangler.toml` comment block does not list it, and the bot has never made an Anthropic call in production because `userInsightsSummary` is web-only. If missing, set it before deploy.
- Web search is enabled for the org in the Claude Console. The first live eval call with `webSearch: true` confirms it; a 400 naming the tool means it is off.

## Rollout

One PR on `feat/anthropic-migration`. Deploy is manual (`pnpm run deploy`). After deploy, watch Workers Observability for `Truncated on`, `Refusing to cache`, and `API error` lines for a day; the KV cache means bad output would persist, so the eval is the gate, not production.
