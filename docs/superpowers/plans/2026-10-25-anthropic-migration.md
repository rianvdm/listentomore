# Anthropic Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run all nine `AI_TASKS` on Claude (Opus 5.5 / Sonnet 5.5) with web search, effort mapping, and robust response parsing in `AnthropicClient`, while keeping the OpenAI client as a config-flip switch-back path and deleting playlist cover generation.

**Architecture:** `AI_TASKS` already routes per task via `provider`; `AIService.getClientForTask()` picks the client. This plan fills three gaps in `AnthropicClient` (web search tool, `reasoning` to `output_config.effort`, no temperature), un-hardwires the random-fact task from `OpenAIClient`, proves quality with a throwaway eval script run against both providers, then flips config and docs. OpenAI code stays and keeps its tests.

**Tech Stack:** TypeScript (strict), Hono on Cloudflare Workers, Turborepo + pnpm, Vitest 2 (`globals: true`, fetch mocked in setup), raw `fetch` via `fetchWithTimeout` (no SDK).

**Spec:** `docs/superpowers/specs/2026-10-25-anthropic-migration-design.md`

## Global Constraints

- Conventions in `AGENTS.md`: `// ABOUTME:` headers, 2-space indent, single quotes, semicolons, `import type`, the `try/catch` + `console.error` pattern.
- No new runtime dependencies. The eval script may use `pnpm dlx tsx`.
- Model IDs exactly `claude-opus-5-5` and `claude-sonnet-5-5` (no date suffixes). Web search tool exactly `{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }` (changed from `web_search_20260209` during eval round 1: the dynamic-filtering variant's filter scripts crashed and consumed `max_uses`, yielding empty summaries; `max_uses` raised from 3 to 5 in eval round 4 because seed + 3 picks needs 4 searches).
- Never send `temperature` for any Claude model. Always send `output_config: { effort }` for Claude; `reasoning` unset, `'none'`, and `'minimal'` all map to `'low'`.
- `anthropic-version` header stays `2023-06-01`.
- Web-search tasks use `fetchWithTimeout` preset `'verySlow'` (60s); others `'slow'` (30s).
- Only `text` content blocks contribute to `content`; join them with `''`.
- `maxTokens` values in `AI_TASKS` are unchanged unless the eval shows truncation (Task 8 fix loop).
- Existing KV entries are left to expire; no purge.
- Commit after every task with the attribution trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

Inputs the spec implies but no existing test exercises, most likely to bite first. Each is pinned to a test in the owning task.

1. A placeholder split across two `text` blocks (`[[Radio` + `head]]`) must survive the join intact. (Task 3)
2. A response whose `content` has only `server_tool_use` / `web_search_tool_result` blocks and no text must return `content: ''`, which `isCacheableResponse()` already refuses. (Task 3)
3. `webSearch: false` or unset must produce a body with no `tools` key at all, not an empty array. (Task 3)
4. `pause_turn` must resume at most once; a second `pause_turn` is returned as a normal response, not looped. (Task 4)
5. A Discord `/ask` or `whois` call goes through the same `AIService`; the bot package must typecheck and build after the flip with no code change. (Task 9)

---

### Task 1: Delete playlist cover generation

**Files:**
- Delete: `packages/services/ai/src/prompts/playlist-cover.ts`
- Modify: `packages/config/src/ai.ts` (remove `playlistCoverPrompt` task, lines ~161-167; remove `IMAGE_GENERATION`, lines ~221-228)
- Modify: `packages/services/ai/src/prompts/index.ts` (remove the playlist-cover export block)
- Modify: `packages/services/ai/src/index.ts` (remove `ImageGenerationOptions`/`ImageGenerationResponse` re-exports at lines 28-29, the `generatePlaylistCover*` and `PlaylistCover*Result` exports at 53-54 and 67-68, and `getPlaylistCoverPrompt` / `getPlaylistCoverImage` methods at 193-208)
- Modify: `packages/services/ai/src/openai.ts` (remove `ImageGenerationOptions`, `ImageGenerationResponse`, and `generateImage()`)
- Test: `apps/web/src/__tests__/services/ai.test.ts`

**Interfaces:**
- Produces: `OpenAIClient` with `chatCompletion()` and `responses()` only. `AI_TASKS` with eight keys.

- [ ] **Step 1: Write the failing test** (append a new `describe('playlist cover removal')` block)

```ts
import { AI_TASKS } from '@listentomore/config';

describe('playlist cover removal', () => {
  it('has no playlist cover task or image generation', () => {
    expect('playlistCoverPrompt' in AI_TASKS).toBe(false);
    expect((new OpenAIClient('k') as unknown as Record<string, unknown>).generateImage).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/services/ai.test.ts -t "playlist cover removal"`
Expected: FAIL (`'playlistCoverPrompt' in AI_TASKS` is true)

- [ ] **Step 3: Delete the code listed under Files.** Also remove the now-unused `'verySlow'` comment reference in `openai.ts` if it only served image generation.

- [ ] **Step 4: Typecheck and run the full web test suite**

Run: `pnpm typecheck && pnpm --filter @listentomore/web test`
Expected: both PASS

- [ ] **Step 5: Commit**

```bash
git add -A packages/config packages/services/ai apps/web/src/__tests__
git commit -m "Remove playlist cover prompt and image generation"
```

---

### Task 2: Effort mapping and no-temperature in `AnthropicClient`

**Files:**
- Modify: `packages/services/ai/src/anthropic.ts`
- Test: `apps/web/src/__tests__/services/ai.test.ts` (`describe('AnthropicClient.chatCompletion')`, lines ~315-406)

**Interfaces:**
- Produces: `export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'` and `export function mapReasoningToEffort(reasoning: ReasoningEffort | undefined): ClaudeEffort` in `anthropic.ts`, re-exported from `packages/services/ai/src/index.ts`. Request body always includes `output_config: { effort }` and never `temperature`.

- [ ] **Step 1: Replace the temperature tests and add effort tests.** Delete `'omits temperature for opus-tier models'` and `'omits temperature for claude-sonnet-5 but keeps it for claude-sonnet-4-6'`. In `'extracts the system message...'` change `expect(body.temperature).toBe(0.8)` to `expect(body.temperature).toBeUndefined()`. Add:

```ts
it('never sends temperature for any Claude model', async () => {
  for (const model of ['claude-sonnet-4-6', 'claude-sonnet-5-5', 'claude-opus-5-5']) {
    const mockFetch = setupFetchMock([
      { pattern: /api\.anthropic\.com/, response: { model, content: [{ type: 'text', text: 'x' }] } },
    ]);
    await new AnthropicClient('key').chatCompletion({
      model, messages: [{ role: 'user', content: 'hi' }], temperature: 0.8,
    });
    expect(lastBody(mockFetch).temperature).toBeUndefined();
  }
});

it('maps reasoning to output_config.effort, defaulting to low', async () => {
  const cases: Array<[ReasoningEffort | undefined, string]> = [
    [undefined, 'low'], ['none', 'low'], ['minimal', 'low'], ['low', 'low'],
    ['medium', 'medium'], ['high', 'high'], ['xhigh', 'xhigh'], ['max', 'max'],
  ];
  for (const [reasoning, effort] of cases) {
    const mockFetch = setupFetchMock([
      { pattern: /api\.anthropic\.com/, response: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'x' }] } },
    ]);
    await new AnthropicClient('key').chatCompletion({
      model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }], reasoning,
    });
    expect(lastBody(mockFetch).output_config).toEqual({ effort });
  }
});

it('ignores verbosity', async () => {
  const mockFetch = setupFetchMock([
    { pattern: /api\.anthropic\.com/, response: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'x' }] } },
  ]);
  await new AnthropicClient('key').chatCompletion({
    model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }], verbosity: 'low',
  });
  const body = lastBody(mockFetch);
  expect(body.text).toBeUndefined();
  expect(body.verbosity).toBeUndefined();
});
```

Import `ReasoningEffort` from `@listentomore/ai` at the top of the test file.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/services/ai.test.ts -t "AnthropicClient"`
Expected: FAIL (`output_config` undefined; temperature still sent for sonnet-4-6)

- [ ] **Step 3: Implement.** In `anthropic.ts`: delete `MODELS_WITHOUT_TEMPERATURE` and the temperature branch; add `mapReasoningToEffort` (a lookup where `none`/`minimal`/`undefined` return `'low'`, everything else passes through); set `body.output_config = { effort: mapReasoningToEffort(options.reasoning) }`. Update the ABOUTME header. Add the re-export to `index.ts`.

- [ ] **Step 4: Run the AnthropicClient tests**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/services/ai.test.ts -t "AnthropicClient"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/services/ai/src apps/web/src/__tests__/services/ai.test.ts
git commit -m "Map reasoning to Claude effort and stop sending temperature"
```

---

### Task 3: Web search tool and text-block extraction

**Files:**
- Modify: `packages/services/ai/src/anthropic.ts`
- Modify: `packages/services/ai/src/types.ts` (extend `AIResponseMetadata.features` with `webSearchRequests?: number | null`)
- Test: `apps/web/src/__tests__/services/ai.test.ts`

**Interfaces:**
- Consumes: `mapReasoningToEffort` from Task 2.
- Produces: request includes `tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }]` only when `options.webSearch === true`. `export function timeoutPresetFor(webSearch: boolean | undefined): TimeoutPreset` in `anthropic.ts` (re-exported from `index.ts`) returns `'verySlow'` when true, else `'slow'`, and `chatCompletion` passes its result to `fetchWithTimeout` (`fetchWithTimeout` strips `timeout` before calling `fetch`, so the test checks the function, not the fetch init). Response parsing: `content` = join of `text` blocks; `metadata.features.webSearchUsed` = any block `type === 'server_tool_use' && name === 'web_search'`; `metadata.features.webSearchRequests` = `usage.server_tool_use?.web_search_requests ?? null`. Internal shape: `interface AnthropicMessagesPayload { model; content: Array<{ type: string; text?: string; name?: string }>; stop_reason?; usage?: { input_tokens?; output_tokens?; server_tool_use?: { web_search_requests?: number } } }`.

- [ ] **Step 1: Write failing tests** (in the `AnthropicClient.chatCompletion` block)

```ts
it('adds the web search tool only when webSearch is true', async () => {
  let mockFetch = setupFetchMock([
    { pattern: /api\.anthropic\.com/, response: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'x' }] } },
  ]);
  await new AnthropicClient('key').chatCompletion({
    model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }], webSearch: true,
  });
  expect(lastBody(mockFetch).tools).toEqual([{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }]);

  mockFetch = setupFetchMock([
    { pattern: /api\.anthropic\.com/, response: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'x' }] } },
  ]);
  await new AnthropicClient('key').chatCompletion({
    model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }], webSearch: false,
  });
  expect('tools' in lastBody(mockFetch)).toBe(false);
});

it('uses the 60s timeout preset for web search tasks', () => {
  expect(timeoutPresetFor(true)).toBe('verySlow');
  expect(timeoutPresetFor(false)).toBe('slow');
  expect(timeoutPresetFor(undefined)).toBe('slow');
});

it('joins only text blocks, preserving a placeholder split across blocks', async () => {
  setupFetchMock([{
    pattern: /api\.anthropic\.com/,
    response: {
      model: 'claude-opus-5-5',
      content: [
        { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'Radiohead' } },
        { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [{ type: 'web_search_result', url: 'https://x', title: 't' }] },
        { type: 'text', text: 'Formed in 1985, [[Radio', citations: [{ type: 'web_search_result_location', url: 'https://x' }] },
        { type: 'text', text: 'head]] released {{OK Computer}}.' },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 900, output_tokens: 120, server_tool_use: { web_search_requests: 1 } },
    },
  }]);
  const res = await new AnthropicClient('key').chatCompletion({
    model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }], webSearch: true,
  });
  expect(res.content).toBe('Formed in 1985, [[Radiohead]] released {{OK Computer}}.');
  expect(res.metadata?.features?.webSearchUsed).toBe(true);
  expect(res.metadata?.features?.webSearchRequests).toBe(1);
});

it('returns empty content when no text blocks are present', async () => {
  setupFetchMock([{
    pattern: /api\.anthropic\.com/,
    response: { model: 'claude-opus-5-5', content: [{ type: 'server_tool_use', id: 's', name: 'web_search', input: {} }], stop_reason: 'end_turn' },
  }]);
  const res = await new AnthropicClient('key').chatCompletion({
    model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }], webSearch: true,
  });
  expect(res.content).toBe('');
  expect(isCacheableResponse(res.content, res.metadata, 'artistSummary', 'x')).toBe(false);
});

it('reports webSearchUsed false when the tool was offered but not called', async () => {
  setupFetchMock([{
    pattern: /api\.anthropic\.com/,
    response: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'plain' }], usage: { input_tokens: 10, output_tokens: 5 } },
  }]);
  const res = await new AnthropicClient('key').chatCompletion({
    model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }], webSearch: true,
  });
  expect(res.metadata?.features?.webSearchUsed).toBe(false);
  expect(res.metadata?.features?.webSearchRequests).toBeNull();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/services/ai.test.ts -t "AnthropicClient"`
Expected: FAIL (`tools` undefined; `features` undefined)

- [ ] **Step 3: Implement** in `anthropic.ts`: add the tool when `options.webSearch`, add `timeoutPresetFor` and use it for the `fetchWithTimeout` call (import `TimeoutPreset` from `@listentomore/shared`), type the payload per Interfaces, filter `type === 'text'` blocks and join with `''`, compute `webSearchUsed` and `webSearchRequests`, set `metadata.features = { webSearchUsed, webSearchRequests, reasoning: <the mapped effort as ReasoningEffort> }`. Add `webSearchRequests?: number | null` to `AIResponseMetadata.features` in `types.ts` with a one-line doc comment. Also set `'listentomore.web_search_requests'` from it in `tracing.ts` next to `web_search_used`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/services/ai.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/services/ai/src apps/web/src/__tests__/services/ai.test.ts
git commit -m "Add server-side web search to the Anthropic client"
```

---

### Task 4: `pause_turn` resume and `refusal` handling

**Files:**
- Modify: `packages/services/ai/src/anthropic.ts`
- Test: `apps/web/src/__tests__/services/ai.test.ts`

**Interfaces:**
- Consumes: payload type and body builder from Task 3.
- Produces: on `stop_reason === 'pause_turn'`, exactly one follow-up POST whose `messages` = original conversation + `{ role: 'assistant', content: <first response content array verbatim> }`, same body otherwise; the second response is parsed as final whatever its `stop_reason`. On `stop_reason === 'refusal'`, `metadata.truncated = true` and a `console.warn` containing `refusal`.

- [ ] **Step 1: Write failing tests.** `setupFetchMock` matches by pattern, so for a two-call sequence use `vi.mocked(globalThis.fetch).mockResolvedValueOnce(...)` twice with `mockFetchResponse` from `../utils/mocks`.

```ts
it('resumes a pause_turn exactly once with the assistant turn appended', async () => {
  const paused = { model: 'claude-opus-5-5', stop_reason: 'pause_turn',
    content: [{ type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'q' } }] };
  const done = { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'final' }] };
  const fetchMock = vi.mocked(globalThis.fetch);
  fetchMock.mockResolvedValueOnce(mockFetchResponse(paused) as Response);
  fetchMock.mockResolvedValueOnce(mockFetchResponse(done) as Response);

  const res = await new AnthropicClient('key').chatCompletion({
    model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }], webSearch: true,
  });
  expect(res.content).toBe('final');
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const second = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
  expect(second.messages).toEqual([
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: paused.content },
  ]);
});

it('does not loop on a second pause_turn', async () => {
  const paused = { model: 'claude-opus-5-5', stop_reason: 'pause_turn', content: [{ type: 'text', text: 'partial' }] };
  const fetchMock = vi.mocked(globalThis.fetch);
  fetchMock.mockResolvedValueOnce(mockFetchResponse(paused) as Response);
  fetchMock.mockResolvedValueOnce(mockFetchResponse(paused) as Response);
  const res = await new AnthropicClient('key').chatCompletion({
    model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }], webSearch: true,
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(res.content).toBe('partial');
});

it('marks a refusal as not cacheable', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  setupFetchMock([{ pattern: /api\.anthropic\.com/,
    response: { model: 'claude-opus-5-5', stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'general_harms' }, content: [] } }]);
  const res = await new AnthropicClient('key').chatCompletion({
    model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }],
  });
  expect(res.metadata?.truncated).toBe(true);
  expect(isCacheableResponse(res.content, res.metadata, 'artistSummary', 'x')).toBe(false);
  expect(warn.mock.calls.some((c) => String(c[0]).includes('refusal'))).toBe(true);
  warn.mockRestore();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/services/ai.test.ts -t "AnthropicClient"`
Expected: FAIL (one fetch call; `truncated` undefined on refusal)

- [ ] **Step 3: Implement.** Extract a private `post(body): Promise<AnthropicMessagesPayload>` so `chatCompletion` can call it twice; on `pause_turn` rebuild `body.messages` and call once more. Set `truncated = stop_reason === 'max_tokens' || stop_reason === 'refusal'` with separate warn messages.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/services/ai.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/services/ai/src/anthropic.ts apps/web/src/__tests__/services/ai.test.ts
git commit -m "Handle pause_turn and refusal stop reasons in the Anthropic client"
```

---

### Task 5: Route random facts through the provider router

**Files:**
- Modify: `packages/services/ai/src/prompts/random-fact.ts:4-5,69-70,151-152`
- Modify: `packages/services/ai/src/index.ts:178-190`
- Test: `apps/web/src/__tests__/services/ai.test.ts` (`describe('AIService.getClientForTask')`)

**Interfaces:**
- Produces: `generateAndStoreFact(client: ChatClient, kv: KVNamespace)` and `generateRandomFact(client: ChatClient, kv: KVNamespace)`; `AIService.getRandomFact()` and `generateAndStoreRandomFact()` call `this.getClientForTask('randomFact')`.

- [ ] **Step 1: Write the failing test**

```ts
it('routes random facts through getClientForTask', async () => {
  const ai = makeService();
  const spy = vi.spyOn(ai, 'getClientForTask');
  setupFetchMock([
    { pattern: /api\.openai\.com/, response: { model: 'm', output_text: 'Did you know...', output: [], usage: {} } },
    { pattern: /api\.anthropic\.com/, response: { model: 'm', content: [{ type: 'text', text: 'Did you know...' }] } },
  ]);
  await ai.generateAndStoreRandomFact();
  expect(spy).toHaveBeenCalledWith('randomFact');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/services/ai.test.ts -t "routes random facts"`
Expected: FAIL (spy not called)

- [ ] **Step 3: Implement.** Change the import and both parameter types in `random-fact.ts` to `ChatClient` (`import type { ChatClient } from '../types'`); in `index.ts` replace `this.openai` with `this.getClientForTask('randomFact')` in both methods and drop the "Always uses OpenAI" comments.

- [ ] **Step 4: Typecheck and test**

Run: `pnpm typecheck && pnpm --filter @listentomore/web test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/services/ai/src
git commit -m "Route random facts through the provider router"
```

---

### Task 6: Eval script

**Files:**
- Create: `apps/web/scripts/ai-eval.ts`
- Create: `apps/web/scripts/ai-eval-inputs.json`
- Modify: `.gitignore` (add `apps/web/eval-output/`)

**Interfaces:**
- Consumes: `AIService`, prompt functions, and `isCacheableResponse` from `@listentomore/ai`; `AI_TASKS` from `@listentomore/config`.
- Produces: `pnpm dlx tsx apps/web/scripts/ai-eval.ts --label <name>` writes `apps/web/eval-output/<label>/<task>.json` (one array of result records per task) and `apps/web/eval-output/<label>/summary.md`. Record shape: `{ task, input, provider, model, content, placeholders: { artists: number; albums: number }, linksProduced: number, violations: string[], truncated: boolean, webSearchUsed: boolean, webSearchRequests: number | null, inputTokens, outputTokens, ms }`. Exit code 1 if any `violations` or `truncated`.

- [ ] **Step 1: Write the inputs file** with exactly: 6 artists (`Radiohead`, `Fela Kuti`, `Harold Budd`, `Little Simz`, `Die Antwoord`, `Sault`), 6 albums as `{ artist, album, year }` (3 released 2025 or later, 3 catalog), 4 genres (`shoegaze`, `amapiano`, `bebop`, `post-punk`), 4 recommendation seeds (artist + album), 2 insights fixtures (copy the shape of `InsightsListeningData` with made-up but plausible data), 4 `listenAi` questions, and `randomFact: 4` runs.

- [ ] **Step 2: Write the script.** Read `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` from `apps/web/.dev.vars` (parse `KEY=value` lines; `process.env` wins if set). Build an `AIService` with an in-memory `KVNamespace` stub (`Map`-backed `get`/`put`/`delete`/`list`) so cache and rate limiter work but nothing is cached between runs. For each input call the matching `AIService` method, time it, and build the record. Checks:
  - `placeholders`: count of `[[...]]` and `{{...}}` in `response.metadata`-adjacent raw content. The prompt functions return post-processed text, so count `](/artist?q=` and `](/album?q=` occurrences as `linksProduced` and flag `violations` if raw `[[` or `{{` survive (unreplaced placeholder).
  - `violations` patterns: `/\]\(https?:\/\//` (external markdown link), `/https?:\/\/\S+/` (raw URL), `/\[\d+\]/` (footnote marker), leading `^#{1,6}\s|^\*\*[^*]+\*\*\s*$` on the first line for summaries (heading or title line), `/^\s*[-*]\s/m` for `artistSummary` (bullets banned), any Markdown for `artistSentence` (`/[*#_\[]/`), length > 300 chars for `randomFact`, fewer than 3 or more than 5 `**` pairs for `userInsightsRecommendations`.
  - `truncated` and `webSearch*` straight from metadata.
  Write `summary.md` as one table per task: input, truncated, violations, links, tokens, ms, then the full content under a heading so Rian can read it.

- [ ] **Step 3: Run the baseline against current config (all OpenAI except insights summary)**

Run: `cd apps/web && pnpm dlx tsx scripts/ai-eval.ts --label openai-baseline`
Expected: exit 0, `eval-output/openai-baseline/summary.md` exists with 30 rows. Record total cost from the Usage pages afterwards; design budget is under $3 for all rounds.

- [ ] **Step 4: Commit the script and inputs (not the output)**

```bash
git add apps/web/scripts/ai-eval.ts apps/web/scripts/ai-eval-inputs.json .gitignore
git commit -m "Add throwaway AI eval script for provider comparison"
```

---

### Task 7: Config flip

**Files:**
- Modify: `packages/config/src/ai.ts` (`AI_PROVIDERS.anthropic.defaultModel`, the `AI_TASKS` comment block lines ~50-110, every task entry)
- Test: `apps/web/src/__tests__/services/ai.test.ts` lines 415, 571-578, 815-832

**Interfaces:**
- Produces: `AI_TASKS` per the spec table. Opus tasks: `artistSummary`, `albumDetail`, `genreSummary`, `albumRecommendations`, `userInsightsSummary`, `userInsightsRecommendations` with `provider: 'anthropic'`, `model: 'claude-opus-5-5'`, `reasoning: 'low'`. Sonnet tasks: `artistSentence`, `listenAi`, `randomFact` with `model: 'claude-sonnet-5-5'`, `reasoning: 'low'`. `temperature` stays in each entry (inert on Claude, satisfies `AITaskConfig`). `webSearch` flags unchanged. `AI_PROVIDERS.anthropic.defaultModel = 'claude-opus-5-5'`.

- [ ] **Step 1: Update tests to the new config.** Import `AI_TASKS` and `type AITask` from `@listentomore/config` if not already present. Line 415: `expect(ai.getClientForTask('artistSummary')).toBe(ai.anthropic)` and add `expect(ai.getClientForTask('listenAi')).toBe(ai.anthropic)`. Lines 571-573: `cfg.model` is `'claude-opus-5-5'`. Add in `'AI task token budgets'`:

```ts
it('every task runs on anthropic with explicit low effort', () => {
  for (const task of Object.keys(AI_TASKS) as AITask[]) {
    expect(getTaskConfig(task).provider).toBe('anthropic');
    expect(getTaskConfig(task).reasoning).toBe('low');
  }
});
it('splits models as designed', () => {
  for (const t of ['artistSentence', 'listenAi', 'randomFact'] as const) expect(getTaskConfig(t).model).toBe('claude-sonnet-5-5');
  for (const t of ['artistSummary', 'albumDetail', 'genreSummary', 'albumRecommendations', 'userInsightsSummary', 'userInsightsRecommendations'] as const) expect(getTaskConfig(t).model).toBe('claude-opus-5-5');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/services/ai.test.ts -t "token budgets|getClientForTask|provider flip"`
Expected: FAIL

- [ ] **Step 3: Flip the config** and rewrite the `AI_TASKS` comment block: replace the GPT-5.6 tier table with a two-provider table (Opus 5.5 $4/$20, Sonnet 5.5 $2/$10, web search $10 per 1,000; GPT-5.6 Terra $2/$12 and Luna $0.20/$1.20 kept as the switch-back row), keep the `maxTokens` reasoning-budget note but say "reasoning or thinking tokens", and state the `none`/`minimal` to `low` mapping. Keep the per-task measurement comments; they're still true of the budget.

- [ ] **Step 4: Typecheck and test**

Run: `pnpm typecheck && pnpm --filter @listentomore/web test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/config/src/ai.ts apps/web/src/__tests__/services/ai.test.ts
git commit -m "Run all AI tasks on Claude Opus 5.5 and Sonnet 5.5"
```

---

### Task 8: Candidate eval run and fix loop

**Files:**
- Modify (only if a check fails): `packages/services/ai/src/anthropic.ts`, `packages/config/src/ai.ts` (`maxTokens` for a failing task), or a prompt file under `packages/services/ai/src/prompts/`

**Interfaces:**
- Consumes: Task 6 script, Task 7 config.

- [ ] **Step 1: Pre-flight.** In `apps/discord-bot`, run `pnpm exec wrangler secret list` and confirm `ANTHROPIC_API_KEY` is present. If not, stop and report; Rian sets it.

- [ ] **Step 2: Run the candidate**

Run: `cd apps/web && pnpm dlx tsx scripts/ai-eval.ts --label claude-r1`
Expected: exit 0. A 400 on the first web-search call naming `web_search` means the org has web search disabled in the Console; stop and report.

- [ ] **Step 3: Fix loop (max three rounds, per spec 8).** For each violation or truncation, in order of preference: client parsing/post-processing, then `maxTokens` or effort for that task, then a prompt edit. After a prompt edit, rerun the baseline too (`--label openai-r<N>`) and confirm no new violations there. Sonnet tasks: raise `maxTokens` first (`artistSentence` to 1000, `listenAi` to 1500 are reasonable); only if truncation persists add a per-task `thinking: { type: 'between_tools' }` branch in the client, with a test mirroring Task 2's effort test. Rerun with `--label claude-r<N>`. Commit after each round: `git commit -m "Eval round N: <what changed>"`. A task still failing after round 3 goes back to `provider: 'openai'` with its previous model, and the summary says why.

- [ ] **Step 4: Hand-off for review.** Present `eval-output/openai-baseline/summary.md` and the final `eval-output/claude-r<N>/summary.md` side by side to Rian. **Do not proceed to Task 9 until Rian approves the output.**

---

### Task 9: Docs, hygiene, and bot build

**Files:**
- Modify: `README.md:19,82,124,159`, `docs/API.md:425`, `docs/how-to/ai-models.md` (whole document), `AGENTS.md` (the `maxTokens` constraint bullet), `apps/web/wrangler.toml` secret comment block (add `ANTHROPIC_API_KEY`), `apps/discord-bot/wrangler.toml` secret comments (add `ANTHROPIC_API_KEY`)
- Modify (local, gitignored): `apps/web/.dev.vars` (remove the `PERPLEXITY_API_KEY` line)

- [ ] **Step 1: Rewrite `docs/how-to/ai-models.md`** so Anthropic is the default provider and OpenAI the live alternative: the model table lists `claude-opus-5-5`, `claude-sonnet-5-5`, `gpt-5.6-terra`, `gpt-5.6-luna`; the Routing section documents both clients' feature mapping (web search tool, effort, temperature rules, `verbosity` ignored on Claude); "switching a task" is a two-field edit example. Remove the playlist cover row. Keep the Adding a New AI Task walkthrough with `provider: 'anthropic'`.

- [ ] **Step 2: Update the remaining lines** listed under Files. README line 19 names Claude with web search; line 82 says "AI clients (Anthropic, OpenAI)"; line 124 lists both keys; line 159 lists both APIs. `docs/API.md:425` says "Powered by Claude". `AGENTS.md`: "reasoning (GPT) or thinking (Claude) tokens".

- [ ] **Step 3: Verify the bot package and the whole repo**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: all PASS, including `@listentomore/discord-bot`.

- [ ] **Step 4: Commit**

```bash
git add README.md docs AGENTS.md apps/web/wrangler.toml apps/discord-bot/wrangler.toml
git commit -m "Document Claude as the default AI provider"
```

---

### Task 10: Branch wrap-up

- [ ] **Step 1: Confirm clean state**

Run: `git status --short && git log --oneline main..HEAD`
Expected: no uncommitted files; one commit per task.

- [ ] **Step 2: Hand off** per superpowers:finishing-a-development-branch. Deploy is manual (`pnpm run deploy`) and is Rian's call. After deploy, watch Workers Observability for `Truncated on`, `Refusing to cache`, `refusal`, and `API error` lines for a day.
