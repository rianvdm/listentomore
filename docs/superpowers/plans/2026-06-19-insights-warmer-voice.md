# `/insights` Warmer Voice (few-shot + Claude) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the "Your Week in Music" `/insights` summary for a warmer, music-reacting voice (stance change + hand-authored few-shot examples) and run it on Claude (`claude-sonnet-4-6`) with an A/B route against GPT-5.4 and `claude-opus-4-8`.

**Architecture:** Two parts. **C** adds an `AnthropicClient` (raw `fetch`, mirroring `OpenAIClient`) behind the existing `ChatClient` seam, registers an `anthropic` provider, and switches `getClientForTask` on `config.provider`. **A** rewrites the `userInsightsSummary` prompt: extract a pure `buildUserInsightsMessages` builder, change the persona from analyst→friend, cut the "Do NOT" wall to two structural bans, add hand-authored few-shot, drop the atmosphere framing, and bust the cache key. An internal A/B route runs all three models on the same week's data.

**Tech Stack:** TypeScript, Hono on Cloudflare Workers, Turborepo + pnpm, Vitest.

## Global Constraints

- **Default model for `userInsightsSummary`:** `claude-sonnet-4-6` (Rian's explicit cost/latency call). `claude-opus-4-8` is the A/B ceiling test only.
- **Exact model IDs, no date suffix:** `claude-sonnet-4-6`, `claude-opus-4-8`.
- **`temperature` is rejected (400) on opus-tier** (`claude-opus-4-8`, `claude-opus-4-7`, `claude-fable-5`) — the adapter omits it there; passes it for `claude-sonnet-4-6`.
- **Transport:** raw `fetch`/`fetchWithTimeout`, no `@anthropic-ai/sdk` dependency (mirror `OpenAIClient`).
- **Anthropic auth headers:** `x-api-key`, `anthropic-version: 2023-06-01`, `Content-Type: application/json`. `max_tokens` required. `system` is a top-level param (not a message).
- **Testing infrastructure (important — the AI package has NO test runner):** `@listentomore/ai` only has a `typecheck` script. All unit tests are added as new `describe` blocks in the **web** package's existing `apps/web/src/__tests__/services/ai.test.ts`, importing the units under test from `@listentomore/ai` (the package barrel) and `@listentomore/config`. **Anything a test imports from `@listentomore/ai` must first be re-exported from `packages/services/ai/src/index.ts`.** Use `createMockKV()` and `setupFetchMock([{ pattern, response, options? }])` from `apps/web/src/__tests__/utils/mocks.ts` (`setupFetchMock` mocks `globalThis.fetch` by URL regex and returns the mock fn; `options: { status, ok }` simulates errors; inspect requests via `mockFetch.mock.calls[0][1].body`). The file already does `import { describe, it, expect, vi, beforeEach } from 'vitest';` and imports from `@listentomore/ai` + `../utils/mocks` — **extend those existing import lines, don't add duplicates.** Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/services/ai.test.ts`.
- **Build order:** Tasks 1–7 are fully unblocked. **Task 8 is gated** on the owner's hand-authored examples (worksheet: `~/git/product-ai/05-personal/side-projects/listentomore/2026-06-19-insights-voice-examples-worksheet.md`). The feature is not shippable until Task 8 lands.
- **Commits:** one per task; conventional-commit messages; first names only.

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `packages/config/src/ai.ts` | Modify | Register `AI_PROVIDERS.anthropic`, `RATE_LIMITS.anthropic`; later flip `userInsightsSummary`. |
| `packages/services/ai/src/rate-limit.ts` | Modify | Widen `AIProvider`; use `RATE_LIMITS[provider]` for the limit. |
| `packages/services/ai/src/types.ts` | Modify | Widen `AIResponseMetadata.provider` + `api`. |
| `packages/services/ai/src/anthropic.ts` | Create | `AnthropicClient implements ChatClient`. |
| `packages/services/ai/src/index.ts` | Modify | Export `AnthropicClient` + new prompt symbols; construct/expose `anthropic`; `getClientForTask` switch; `anthropicApiKey`. |
| `packages/services/ai/src/prompts/user-insights-summary.ts` | Modify | Extract `buildUserInsightsMessages`; rewrite prompt; cache-version; few-shot. |
| `packages/services/ai/src/prompts/index.ts` | Modify | Re-export the new prompt symbols. |
| `apps/web/src/types.ts` | Modify | Add `ANTHROPIC_API_KEY` to `Bindings`. |
| `apps/web/src/index.tsx` | Modify | Pass `anthropicApiKey` at both `AIService` sites (`:134`, `:809`). |
| `apps/web/.dev.vars` | Modify | Add `ANTHROPIC_API_KEY` (value provided by owner). |
| `apps/discord-bot/src/index.ts` | Modify | Add `ANTHROPIC_API_KEY` to `Env`; pass `anthropicApiKey` at the `AIService` site (`:75`). |
| `apps/web/src/api/internal/insights.ts` | Modify | Add the A/B debug handler; bust the refresh-delete cache key. |
| `apps/web/src/__tests__/services/ai.test.ts` | Modify | New `describe` blocks (Tasks 1–6, 8). |

---

### Task 1: Anthropic provider config + rate-limiter support

**Files:**
- Modify: `packages/config/src/ai.ts` (`AI_PROVIDERS`, `RATE_LIMITS`)
- Modify: `packages/services/ai/src/rate-limit.ts:12,24`
- Test: `apps/web/src/__tests__/services/ai.test.ts` (new `describe`)

**Interfaces:**
- Produces: `AI_PROVIDERS.anthropic = { baseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-sonnet-4-6' }`; `RATE_LIMITS.anthropic = { requestsPerMinute: 50, tokensPerMinute: 40000 }`; `AIProvider = 'openai' | 'anthropic'`; `new AIRateLimiter(kv, 'anthropic')` reports `maxRequests: 50`.

- [ ] **Step 1: Write the failing test**

Extend the imports in `apps/web/src/__tests__/services/ai.test.ts` to add `AIRateLimiter` (from `@listentomore/ai`) and `createMockKV` (already imported), then append:

```typescript
describe('AIRateLimiter — provider-aware limits', () => {
  it('uses the anthropic rate limit, not openai', async () => {
    const rl = new AIRateLimiter(createMockKV(), 'anthropic');
    const stats = await rl.getStats();
    expect(stats.provider).toBe('anthropic');
    expect(stats.maxRequests).toBe(50);
  });

  it('still reports the openai limit for the openai provider', async () => {
    const rl = new AIRateLimiter(createMockKV(), 'openai');
    expect((await rl.getStats()).maxRequests).toBe(90);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/services/ai.test.ts -t "provider-aware limits"`
Expected: FAIL — `'anthropic'` not assignable to `AIProvider`, and/or `maxRequests` is `90` for both.

- [ ] **Step 3: Add the provider + rate-limit config**

In `packages/config/src/ai.ts`, add the `anthropic` entries:

```typescript
export const AI_PROVIDERS = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5-mini',
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-6',
  },
} as const;
```

```typescript
export const RATE_LIMITS = {
  openai: {
    requestsPerMinute: 90,
    tokensPerMinute: 90000,
  },
  anthropic: {
    requestsPerMinute: 50,
    tokensPerMinute: 40000,
  },
  spotify: {
    requestsPerMinute: 150,
    maxRetries: 2,
    retryDelayMs: 1000,
  },
} as const;
```

- [ ] **Step 4: Make the rate limiter provider-aware**

In `packages/services/ai/src/rate-limit.ts`, widen the type (line 12) and fix the limit lookup (line 24):

```typescript
export type AIProvider = 'openai' | 'anthropic';
```

```typescript
  constructor(
    private cache: KVNamespace,
    private provider: AIProvider
  ) {
    this.cacheKey = `ai:ratelimit:${provider}`;
    this.maxRequests = RATE_LIMITS[provider].requestsPerMinute;
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/services/ai.test.ts -t "provider-aware limits"`
Expected: PASS (both cases).

- [ ] **Step 6: Commit**

```bash
git add packages/config/src/ai.ts packages/services/ai/src/rate-limit.ts apps/web/src/__tests__/services/ai.test.ts
git commit -m "feat(ai): register anthropic provider + make rate limiter provider-aware"
```

---

### Task 2: `AnthropicClient` + metadata type + barrel export

**Files:**
- Modify: `packages/services/ai/src/types.ts:41,45` (`AIResponseMetadata`)
- Create: `packages/services/ai/src/anthropic.ts`
- Modify: `packages/services/ai/src/index.ts` (re-export `AnthropicClient`)
- Test: `apps/web/src/__tests__/services/ai.test.ts` (new `describe`)

**Interfaces:**
- Consumes: `ChatClient`, `ChatCompletionOptions`, `ChatCompletionResponse`, `AIResponseMetadata` from `./types`; `AIRateLimiter` from `./rate-limit`; `fetchWithTimeout` from `@listentomore/shared`; `AI_PROVIDERS` from `@listentomore/config`.
- Produces: `class AnthropicClient implements ChatClient` with `constructor(apiKey: string, rateLimiter?: AIRateLimiter)` and `chatCompletion(options): Promise<ChatCompletionResponse>` (metadata `provider: 'anthropic'`, `api: 'messages'`); re-exported from `@listentomore/ai`.

- [ ] **Step 1: Widen the metadata type**

In `packages/services/ai/src/types.ts`, change the `provider` and `api` fields of `AIResponseMetadata`:

```typescript
  /** Provider that handled the request */
  provider: 'openai' | 'anthropic';
  /** Actual model used (from API response) */
  model: string;
  /** Which API was used */
  api: 'responses' | 'chat_completions' | 'messages';
```

- [ ] **Step 2: Write the failing test**

Extend the test-file imports to add `AnthropicClient` (from `@listentomore/ai`) and `setupFetchMock` (from `../utils/mocks`), then append:

```typescript
describe('AnthropicClient.chatCompletion', () => {
  beforeEach(() => vi.clearAllMocks());

  function lastBody(mockFetch: ReturnType<typeof setupFetchMock>) {
    const init = mockFetch.mock.calls[0][1] as RequestInit;
    return JSON.parse(init.body as string);
  }

  it('extracts the system message to the top-level system param', async () => {
    const mockFetch = setupFetchMock([
      { pattern: /api\.anthropic\.com/, response: { model: 'claude-sonnet-4-6', content: [{ type: 'text', text: 'hi' }] } },
    ]);
    await new AnthropicClient('key').chatCompletion({
      model: 'claude-sonnet-4-6',
      messages: [
        { role: 'system', content: 'You are a friend.' },
        { role: 'user', content: 'My week...' },
      ],
      maxTokens: 1500,
      temperature: 0.8,
    });
    const body = lastBody(mockFetch);
    expect(body.system).toBe('You are a friend.');
    expect(body.messages).toEqual([{ role: 'user', content: 'My week...' }]);
    expect(body.max_tokens).toBe(1500);
    expect(body.temperature).toBe(0.8);
  });

  it('omits temperature for opus-tier models', async () => {
    const mockFetch = setupFetchMock([
      { pattern: /api\.anthropic\.com/, response: { model: 'claude-opus-4-8', content: [{ type: 'text', text: 'x' }] } },
    ]);
    await new AnthropicClient('key').chatCompletion({
      model: 'claude-opus-4-8',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 1500,
      temperature: 0.8,
    });
    expect(lastBody(mockFetch).temperature).toBeUndefined();
  });

  it('maps the response to content + anthropic metadata', async () => {
    setupFetchMock([
      {
        pattern: /api\.anthropic\.com/,
        response: { model: 'claude-sonnet-4-6', content: [{ type: 'text', text: 'warm summary' }], usage: { input_tokens: 100, output_tokens: 50 } },
      },
    ]);
    const res = await new AnthropicClient('key').chatCompletion({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.content).toBe('warm summary');
    expect(res.metadata?.provider).toBe('anthropic');
    expect(res.metadata?.api).toBe('messages');
    expect(res.metadata?.usage).toEqual({ inputTokens: 100, outputTokens: 50, totalTokens: 150 });
  });

  it('throws on a non-200 response', async () => {
    setupFetchMock([
      { pattern: /api\.anthropic\.com/, response: { error: 'bad' }, options: { status: 400, ok: false } },
    ]);
    await expect(
      new AnthropicClient('key').chatCompletion({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toThrow('Anthropic API error');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/services/ai.test.ts -t "AnthropicClient"`
Expected: FAIL — `AnthropicClient` is not exported from `@listentomore/ai`.

- [ ] **Step 4: Write the `AnthropicClient`**

```typescript
// packages/services/ai/src/anthropic.ts
// ABOUTME: Anthropic (Claude) API client mirroring the OpenAIClient shape.
// ABOUTME: Calls POST /v1/messages via raw fetch; no SDK dependency.

import { AI_PROVIDERS } from '@listentomore/config';
import { fetchWithTimeout } from '@listentomore/shared';
import type {
  ChatClient,
  ChatCompletionOptions,
  ChatCompletionResponse,
  AIResponseMetadata,
} from './types';
import type { AIRateLimiter } from './rate-limit';

const ANTHROPIC_VERSION = '2023-06-01';

// Opus-tier (4.7+) and Fable 5 reject sampling params with a 400.
const MODELS_WITHOUT_TEMPERATURE = [
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-fable-5',
];

export class AnthropicClient implements ChatClient {
  private apiKey: string;
  private baseUrl: string;
  private rateLimiter: AIRateLimiter | null;

  constructor(apiKey: string, rateLimiter?: AIRateLimiter) {
    this.apiKey = apiKey;
    this.baseUrl = AI_PROVIDERS.anthropic.baseUrl;
    this.rateLimiter = rateLimiter ?? null;
  }

  async chatCompletion(
    options: ChatCompletionOptions
  ): Promise<ChatCompletionResponse> {
    if (this.rateLimiter) {
      await this.rateLimiter.acquire();
    }

    // Anthropic takes the system prompt as a top-level param, not a message.
    const systemMessage = options.messages.find((m) => m.role === 'system');
    const conversation = options.messages.filter((m) => m.role !== 'system');

    const body: Record<string, unknown> = {
      model: options.model,
      max_tokens: options.maxTokens ?? 1500,
      messages: conversation.map((m) => ({ role: m.role, content: m.content })),
    };
    if (systemMessage) {
      body.system = systemMessage.content;
    }
    // Only send temperature where the model supports it.
    if (
      options.temperature !== undefined &&
      !MODELS_WITHOUT_TEMPERATURE.some((m) => options.model.startsWith(m))
    ) {
      body.temperature = options.temperature;
    }

    const response = await fetchWithTimeout(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      timeout: 'slow', // 30 seconds for AI
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[Anthropic] API error: ${response.status} - ${errorBody}`);
      throw new Error(`Anthropic API error: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      model: string;
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const content = data.content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');

    const metadata: AIResponseMetadata = {
      provider: 'anthropic',
      model: data.model,
      api: 'messages',
      usage: data.usage
        ? {
            inputTokens: data.usage.input_tokens ?? null,
            outputTokens: data.usage.output_tokens ?? null,
            totalTokens:
              (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0) ||
              null,
          }
        : undefined,
    };

    return { content, metadata };
  }
}
```

- [ ] **Step 5: Re-export from the barrel**

In `packages/services/ai/src/index.ts`, add the re-export next to the existing `export { OpenAIClient } from './openai';`:

```typescript
export { AnthropicClient } from './anthropic';
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/services/ai.test.ts -t "AnthropicClient"`
Expected: PASS (4 cases). Then `pnpm typecheck` — PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/services/ai/src/anthropic.ts packages/services/ai/src/types.ts packages/services/ai/src/index.ts apps/web/src/__tests__/services/ai.test.ts
git commit -m "feat(ai): add AnthropicClient (raw fetch, ChatClient impl)"
```

---

### Task 3: Wire `AnthropicClient` into `AIService` + all call sites

**Files:**
- Modify: `packages/services/ai/src/index.ts` (import `getTaskConfig`, `AIServiceConfig`, constructor, `getClientForTask`)
- Modify: `apps/web/src/types.ts:27` (add `ANTHROPIC_API_KEY`)
- Modify: `apps/web/src/index.tsx:134,809` (pass `anthropicApiKey`)
- Modify: `apps/discord-bot/src/index.ts:35,75` (Env + construction)
- Modify: `apps/web/.dev.vars` (add `ANTHROPIC_API_KEY` — value provided by owner)
- Test: `apps/web/src/__tests__/services/ai.test.ts` (new `describe`)

**Interfaces:**
- Consumes: `AnthropicClient` (Task 2); `getTaskConfig`, `AITask` from `@listentomore/config`.
- Produces: `AIService.anthropic: AnthropicClient` (public); `AIServiceConfig.anthropicApiKey: string`; `getClientForTask(task)` returns `this.anthropic` when `getTaskConfig(task).provider === 'anthropic'`, else `this.openai`.

- [ ] **Step 1: Write the failing test**

Extend the imports to add `AIService` (from `@listentomore/ai`). Append:

```typescript
describe('AIService.getClientForTask', () => {
  function makeService() {
    return new AIService({ openaiApiKey: 'o', anthropicApiKey: 'a', cache: createMockKV() });
  }

  it('returns the OpenAI client for an openai-provider task', () => {
    const ai = makeService();
    expect(ai.getClientForTask('artistSummary')).toBe(ai.openai);
  });

  it('exposes a constructed anthropic client', () => {
    const ai = makeService();
    expect(ai.anthropic).toBeInstanceOf(AnthropicClient);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/services/ai.test.ts -t "getClientForTask"`
Expected: FAIL — `AIServiceConfig` has no `anthropicApiKey` / `ai.anthropic` undefined.

- [ ] **Step 3: Wire the client into `AIService`**

In `packages/services/ai/src/index.ts`:

**Modify the existing config import line** `import type { AITask } from '@listentomore/config';` to import the value `getTaskConfig` too (it becomes a regular import with an inline type):

```typescript
import { getTaskConfig, type AITask } from '@listentomore/config';
```

Add the client import next to the existing `import { OpenAIClient } from './openai';`:

```typescript
import { AnthropicClient } from './anthropic';
```

Extend the config and class:

```typescript
export interface AIServiceConfig {
  openaiApiKey: string;
  anthropicApiKey: string;
  cache: KVNamespace;
}
```

```typescript
export class AIService {
  public readonly openai: OpenAIClient;
  public readonly anthropic: AnthropicClient;
  public readonly cache: AICache;
  public readonly kv: KVNamespace;
  public readonly openaiRateLimiter: AIRateLimiter;
  public readonly anthropicRateLimiter: AIRateLimiter;

  constructor(config: AIServiceConfig) {
    this.openaiRateLimiter = new AIRateLimiter(config.cache, 'openai');
    this.anthropicRateLimiter = new AIRateLimiter(config.cache, 'anthropic');
    this.openai = new OpenAIClient(config.openaiApiKey, this.openaiRateLimiter);
    this.anthropic = new AnthropicClient(
      config.anthropicApiKey,
      this.anthropicRateLimiter
    );
    this.cache = new AICache(config.cache);
    this.kv = config.cache;
  }

  /**
   * Get the appropriate client for a task based on config.provider.
   */
  getClientForTask(task: AITask): ChatClient {
    const { provider } = getTaskConfig(task);
    return provider === 'anthropic' ? this.anthropic : this.openai;
  }
  // ...rest of the class unchanged
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/services/ai.test.ts -t "getClientForTask"`
Expected: PASS (both cases).

- [ ] **Step 5: Update the three `AIService` construction sites + bindings**

`apps/web/src/types.ts` — add to the `Bindings` interface (next to `OPENAI_API_KEY` at line 27):

```typescript
  ANTHROPIC_API_KEY: string;
```

`apps/web/src/index.tsx` — read each `new AIService({ ... })` site first, then add **only** the `anthropicApiKey` line, keeping the surrounding fields. At `:134` the env handle is `c.env`; at `:809` it is `env`:

```typescript
    // site ~134
    new AIService({
      openaiApiKey: c.env.OPENAI_API_KEY,
      anthropicApiKey: c.env.ANTHROPIC_API_KEY,
      cache: c.env.CACHE,
    })
```

```typescript
    // site ~809
    const ai = new AIService({
      openaiApiKey: env.OPENAI_API_KEY,
      anthropicApiKey: env.ANTHROPIC_API_KEY,
      cache: env.CACHE,
    });
```

`apps/discord-bot/src/index.ts` — add `ANTHROPIC_API_KEY: string;` to the `Env` interface (next to `OPENAI_API_KEY` at line 35), and add `anthropicApiKey: env.ANTHROPIC_API_KEY,` at the `new AIService({ ... })` site (line 75). Read the site first; keep its existing `cache:` field as-is.

`apps/web/.dev.vars` — add a line (the owner supplies the real value):

```
ANTHROPIC_API_KEY=sk-ant-...
```

**Owner action (cannot be automated):** put the real key in `apps/web/.dev.vars`, and set the prod secret: `cd apps/web && npx wrangler secret put ANTHROPIC_API_KEY`. (The discord-bot only needs its own `ANTHROPIC_API_KEY` secret if it ever runs an anthropic-provider task — none today.)

- [ ] **Step 6: Typecheck the whole repo**

Run: `pnpm typecheck`
Expected: PASS — no missing-property errors at any `AIService` site.

- [ ] **Step 7: Commit**

```bash
git add packages/services/ai/src/index.ts apps/web/src/types.ts apps/web/src/index.tsx apps/discord-bot/src/index.ts apps/web/.dev.vars apps/web/src/__tests__/services/ai.test.ts
git commit -m "feat(ai): wire AnthropicClient into AIService + provider-based client selection"
```

---

### Task 4: Extract `buildUserInsightsMessages` (behavior-preserving)

**Files:**
- Modify: `packages/services/ai/src/prompts/user-insights-summary.ts`
- Modify: `packages/services/ai/src/prompts/index.ts` + `packages/services/ai/src/index.ts` (re-export `buildUserInsightsMessages`)
- Test: `apps/web/src/__tests__/services/ai.test.ts` (new `describe`)

**Interfaces:**
- Produces: `export function buildUserInsightsMessages(listeningData: ListeningData): ChatMessage[]` — returns `[systemMessage, userMessage]`; re-exported from `@listentomore/ai`. Moves the familiar/new annotation + slicing out of `generateUserInsightsSummary`, which now calls the builder.

- [ ] **Step 1: Write the failing test**

Extend imports to add `buildUserInsightsMessages` (from `@listentomore/ai`). Add a shared `sample` fixture (module scope, reused by Tasks 5/8) and the block:

```typescript
const insightsSample = {
  weeklyPlayCount: 73,
  topArtists: [
    { name: 'Siiga', playcount: 39 },
    { name: 'Celer', playcount: 39 },
  ],
  topAlbums: [{ name: 'Nostalgia Burns', artist: 'Siiga', playcount: 39 }],
  recentTracks: [{ name: 'Videotape', artist: 'Radiohead' }],
  historicalArtists: [{ name: 'Celer' }, { name: 'Nils Frahm' }],
};

describe('buildUserInsightsMessages', () => {
  it('returns a system message and a user message', () => {
    const msgs = buildUserInsightsMessages(insightsSample);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].role).toBe('user');
  });

  it('annotates familiar vs new against the 6-month rotation', () => {
    const user = buildUserInsightsMessages(insightsSample)[1].content;
    expect(user).toContain('Celer: 39 plays (familiar)');
    expect(user).toContain('Siiga: 39 plays (new for them)');
  });

  it('includes the weekly play count and a named album', () => {
    const user = buildUserInsightsMessages(insightsSample)[1].content;
    expect(user).toContain('73');
    expect(user).toContain('Nostalgia Burns by Siiga');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/services/ai.test.ts -t "buildUserInsightsMessages"`
Expected: FAIL — not exported from `@listentomore/ai`.

- [ ] **Step 3: Extract the builder (preserve current prompt text)**

In `packages/services/ai/src/prompts/user-insights-summary.ts`, add `ChatMessage` to the existing type import, and export a builder holding the **current** system + user prompt (verbatim move — no wording change yet):

```typescript
import type { ChatClient, ChatMessage, AIResponseMetadata } from '../types';
```

```typescript
const SYSTEM_PROMPT =
  "You're a friend who pays attention to what people listen to. When someone shares their week, you find the one thing that's actually interesting about it — not the obvious summary, but the pattern they might not have noticed themselves. You know their usual rotation and what's new for them. You write like a person, not a report: one sharp observation, specific and earned.";

/**
 * Build the chat messages for the weekly insights summary.
 * Pure — no cache, no client. Shared by generate + the A/B route.
 */
export function buildUserInsightsMessages(
  listeningData: ListeningData
): ChatMessage[] {
  const {
    topArtists,
    topAlbums,
    recentTracks,
    weeklyPlayCount,
    historicalArtists,
  } = listeningData;

  const historicalNames = new Set(
    historicalArtists.map((a) => a.name.toLowerCase())
  );
  const annotatedArtists = topArtists.map((a) => ({
    ...a,
    isRegular: historicalNames.has(a.name.toLowerCase()),
  }));

  const topArtistsSlice = annotatedArtists.slice(0, 5);
  const topAlbumsSlice = topAlbums.slice(0, 5);
  const recentTracksSlice = recentTracks.slice(0, 30);

  const userPrompt = `Here's someone's listening from the past week. Find the one thing about it that's genuinely interesting — the pattern a friend who knows their taste would call out, not a recap.

Total plays this week: ${weeklyPlayCount}

Top artists this week:
${topArtistsSlice.map((a) => `- ${a.name}: ${a.playcount} plays${a.isRegular ? ' (familiar)' : ' (new for them)'}`).join('\n')}

Top albums this week:
${topAlbumsSlice.map((a) => `- ${a.name} by ${a.artist}: ${a.playcount} plays`).join('\n')}

Recent tracks (most recent first):
${recentTracksSlice.map((t) => `- ${t.name} — ${t.artist}`).join('\n') || '- (none on record)'}

Their rotation over the past 6 months: ${historicalArtists.map((a) => a.name).join(', ') || 'none on record'}

Things worth looking for — pick ONE, don't try to cover everything:
- An obsession: one artist or album eating the week
- A rabbit hole: a thread from one artist, scene, or era to another
- A return: coming back to something they hadn't played in a while
- A break: stepping outside their usual rotation
- A mood: the week has a clear temperature, even across different artists
- A contrast: the gap between what they're usually into and what this week actually was

Write 2 to 3 short paragraphs in second person. Give the observation room to breathe: set it up, show the evidence in the tracks and albums, land the point. Name specific artists, albums, or tracks. Use the familiar/new flags.

Open with a direct observation — something concrete that's actually in their week. Do NOT open with a rhetorical hook ("The interesting thing is...", "What stands out is...", "Here's what's notable..."). Do NOT open with "Based on your listening" or "This week you listened to." Start in the scene, not above it.

You can be a little writerly if the observation earns it, but no clichés, no recommendations. If the week is genuinely unremarkable — mostly their usual rotation without much variation — say that plainly, then find the small thing that's still worth noting.`;

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];
}
```

Then replace the inline prompt construction inside `generateUserInsightsSummary` so it calls the builder (delete the now-duplicated annotation/slice/`prompt` block):

```typescript
  const config = getTaskConfig('userInsightsSummary');
  const messages = buildUserInsightsMessages(listeningData);

  const response = await client.chatCompletion({
    model: config.model,
    messages,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    reasoning: config.reasoning,
    verbosity: config.verbosity,
  });
```

- [ ] **Step 4: Re-export the builder**

In `packages/services/ai/src/prompts/index.ts`, ensure `buildUserInsightsMessages` is re-exported from `./user-insights-summary` (add it to the existing export list). Then in `packages/services/ai/src/index.ts`, add `buildUserInsightsMessages` to the existing `export { ... } from './prompts';` block (next to `generateUserInsightsSummary`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/services/ai.test.ts -t "buildUserInsightsMessages"`
Expected: PASS (3 cases). Then `pnpm --filter @listentomore/web test` — full suite green (no regressions). Then `pnpm typecheck` — PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/services/ai/src/prompts/user-insights-summary.ts packages/services/ai/src/prompts/index.ts packages/services/ai/src/index.ts apps/web/src/__tests__/services/ai.test.ts
git commit -m "refactor(ai): extract pure buildUserInsightsMessages from the insights summary"
```

---

### Task 5: Rewrite the prompt (warmer voice) + bust the cache key

**Files:**
- Modify: `packages/services/ai/src/prompts/user-insights-summary.ts`
- Modify: `packages/services/ai/src/prompts/index.ts` + `packages/services/ai/src/index.ts` (re-export `USER_INSIGHTS_PROMPT_VERSION`)
- Modify: `apps/web/src/api/internal/insights.ts:119` (versioned refresh-delete)
- Test: `apps/web/src/__tests__/services/ai.test.ts` (new `describe`)

**Interfaces:**
- Produces: `export const USER_INSIGHTS_PROMPT_VERSION = 'v2'` (re-exported from `@listentomore/ai`); the cache key for this task becomes `ai:userInsightsSummary:<username>:v2`. The system persona reacts to the *music*; the user prompt carries the two structural bans, an example slot, and no atmosphere framing.

- [ ] **Step 1: Write the failing tests**

Extend imports to add `USER_INSIGHTS_PROMPT_VERSION`, `generateUserInsightsSummary` (from `@listentomore/ai`) and `AICache` (already imported). Append:

```typescript
describe('warmer-voice prompt', () => {
  it('persona reacts to the music, not the listener', () => {
    const system = buildUserInsightsMessages(insightsSample)[0].content;
    expect(system.toLowerCase()).toContain('opinions about');
    expect(system).not.toContain('pattern they might not have noticed');
  });

  it('bans the not-X-but-Y construction and caps em dashes', () => {
    const user = buildUserInsightsMessages(insightsSample)[1].content;
    expect(user).toContain('less like X, more like Y');
    expect(user.toLowerCase()).toContain('em dash');
  });

  it('drops the atmosphere-seeding language', () => {
    const user = buildUserInsightsMessages(insightsSample)[1].content;
    expect(user).not.toContain('clear temperature');
  });

  it('exposes a prompt version for cache busting', () => {
    expect(USER_INSIGHTS_PROMPT_VERSION).toBe('v2');
  });
});

describe('generateUserInsightsSummary cache key', () => {
  it('reads and writes the versioned cache key', async () => {
    const mockKV = createMockKV();
    const cache = new AICache(mockKV);
    setupFetchMock([
      { pattern: /api\.anthropic\.com/, response: { model: 'claude-sonnet-4-6', content: [{ type: 'text', text: 'warm' }], usage: { input_tokens: 1, output_tokens: 1 } } },
    ]);
    await generateUserInsightsSummary('Bordesak', insightsSample, new AnthropicClient('k'), cache);
    expect(mockKV.get).toHaveBeenCalledWith('ai:userInsightsSummary:bordesak:v2', 'json');
    expect(mockKV.put).toHaveBeenCalledWith(
      'ai:userInsightsSummary:bordesak:v2',
      expect.any(String),
      expect.any(Object)
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/services/ai.test.ts -t "warmer-voice prompt"`
Expected: FAIL — old persona present, no bans, no version export, unversioned cache key.

- [ ] **Step 3: Rewrite the persona + user prompt**

Replace `SYSTEM_PROMPT`:

```typescript
const SYSTEM_PROMPT =
  "You're a friend who pays attention to what people listen to. When someone shows you their week, you react to the music itself — you have opinions about records and songs, the ones you love, the ones that surprised you, the stuff you'd text them about. You know their usual rotation and what's new for them. You're not analyzing them; you're talking about the music with someone whose taste you know.";
```

Add the example-slot constant **above** the builder (placeholder until Task 8):

```typescript
// Hand-authored gold-standard examples in the owner's voice. Filled in Task 8
// from the worksheet. Until then this is a single neutral placeholder so the
// structure compiles and the bans/voice are exercised by tests.
const FEW_SHOT_EXAMPLES = `Here are a couple of summaries in the right voice (one with the data it came from, then two on their own):

[PLACEHOLDER — replace with the owner's hand-authored examples in Task 8]`;
```

Replace the instruction tail of `userPrompt` (everything from "Things worth looking for" onward) with the new instructions + example slot. Keep the data blocks above it exactly:

```typescript
Their rotation over the past 6 months: ${historicalArtists.map((a) => a.name).join(', ') || 'none on record'}

${FEW_SHOT_EXAMPLES}

Now write theirs. 2 to 3 short paragraphs, second person. React to the music with at least one real opinion about a song or record — not a description of the listener. Name specific artists, albums, or tracks, and use the familiar/new flags. If the week is mostly their usual rotation, say so plainly, then find the small thing still worth noting.

Hard rules:
- Never use "not X — but Y", "it isn't X, it's Y", or "less like X, more like Y" anywhere. This is the move to avoid.
- At most 3 em dashes in the whole thing.
- No clichés, no recommendations, no mood/atmosphere adjectives standing in for an actual observation.`;
```

Add the version export at the top of the module:

```typescript
export const USER_INSIGHTS_PROMPT_VERSION = 'v2';
```

Version the cache get/set inside `generateUserInsightsSummary`:

```typescript
  const cached = await cache.get<UserInsightsSummaryResult>(
    'userInsightsSummary',
    normalizedUsername,
    USER_INSIGHTS_PROMPT_VERSION
  );
  if (cached) {
    return cached;
  }
```

```typescript
  await cache.set(
    'userInsightsSummary',
    [normalizedUsername, USER_INSIGHTS_PROMPT_VERSION],
    { content: result.content }
  );
```

- [ ] **Step 4: Re-export the version + version the refresh-delete**

In `packages/services/ai/src/prompts/index.ts` re-export `USER_INSIGHTS_PROMPT_VERSION` from `./user-insights-summary`; in `packages/services/ai/src/index.ts` add it to the `export { ... } from './prompts';` block.

In `apps/web/src/api/internal/insights.ts`, import the version and update the delete at line 119:

```typescript
import { USER_INSIGHTS_PROMPT_VERSION } from '@listentomore/ai';
```

```typescript
    await ai.cache.delete(
      'userInsightsSummary',
      username.toLowerCase(),
      USER_INSIGHTS_PROMPT_VERSION
    );
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/services/ai.test.ts -t "warmer-voice prompt"` then `-t "cache key"`
Expected: PASS. Then `pnpm typecheck` — PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/services/ai/src/prompts/user-insights-summary.ts packages/services/ai/src/prompts/index.ts packages/services/ai/src/index.ts apps/web/src/api/internal/insights.ts apps/web/src/__tests__/services/ai.test.ts
git commit -m "feat(insights): warmer music-reacting persona + structural bans + cache bust"
```

---

### Task 6: Flip `userInsightsSummary` to Claude

**Files:**
- Modify: `packages/config/src/ai.ts` (`userInsightsSummary` block)
- Test: `apps/web/src/__tests__/services/ai.test.ts` (new `describe`)

**Interfaces:**
- Produces: `getTaskConfig('userInsightsSummary')` → `{ provider: 'anthropic', model: 'claude-sonnet-4-6', temperature: 0.8, maxTokens: 1500, cacheTtlDays: 1 }`; `getClientForTask('userInsightsSummary')` returns the anthropic client.

- [ ] **Step 1: Write the failing test**

Extend imports to add `getTaskConfig` (from `@listentomore/config`). Append:

```typescript
describe('userInsightsSummary provider flip', () => {
  it('is configured for anthropic sonnet', () => {
    const cfg = getTaskConfig('userInsightsSummary');
    expect(cfg.provider).toBe('anthropic');
    expect(cfg.model).toBe('claude-sonnet-4-6');
    expect(cfg.temperature).toBe(0.8);
  });

  it('routes the task to the anthropic client', () => {
    const ai = new AIService({ openaiApiKey: 'o', anthropicApiKey: 'a', cache: createMockKV() });
    expect(ai.getClientForTask('userInsightsSummary')).toBe(ai.anthropic);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/services/ai.test.ts -t "provider flip"`
Expected: FAIL — provider still `'openai'`, model `gpt-5.4`.

- [ ] **Step 3: Flip the config**

In `packages/config/src/ai.ts`, replace the `userInsightsSummary` block (drops `verbosity` — OpenAI-only):

```typescript
  userInsightsSummary: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    maxTokens: 1500,
    temperature: 0.8,
    cacheTtlDays: 1,
  },
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/services/ai.test.ts -t "provider flip"`
Expected: PASS. Then `pnpm typecheck` — PASS (`satisfies Record<string, AITaskConfig>` holds).

- [ ] **Step 5: Commit**

```bash
git add packages/config/src/ai.ts apps/web/src/__tests__/services/ai.test.ts
git commit -m "feat(insights): route userInsightsSummary to claude-sonnet-4-6"
```

---

### Task 7: Internal A/B debug route

**Files:**
- Modify: `apps/web/src/api/internal/insights.ts` (new handler `GET /insights-ab`)

**Interfaces:**
- Consumes: `getUserWithInsightsAccess` (existing in the file), `buildUserInsightsMessages` from `@listentomore/ai`, `c.get('ai')`.
- Produces: `GET /api/internal/insights-ab?username=X` → `{ data: { gpt54, sonnet46, opus48 } }`, cache-bypassed, owner/privacy-gated. Throwaway scaffolding.

> **Testing note:** there is no existing internal-route test harness (the internal handlers rely on middleware-set context: `c.get('ai')`, `c.get('db')`, `c.get('currentUser')`). Building a context mock for a route that gets deleted is not worth it — this route is verified **manually** in Task 8 Step 5 against `pnpm dev`. No automated test for this task.

- [ ] **Step 1: Add the A/B handler**

In `apps/web/src/api/internal/insights.ts`, add the builder import and a handler after the existing `/user-insights-summary` route:

```typescript
import { buildUserInsightsMessages } from '@listentomore/ai';
```

```typescript
// Throwaway A/B comparison route for issue #32 — delete after picking a model.
app.get('/insights-ab', requireSessionAuth, async (c) => {
  const username = c.req.query('username');
  if (!username) {
    return c.json({ error: 'Missing username parameter' }, 400);
  }

  const accessResult = await getUserWithInsightsAccess(c, username);
  if ('error' in accessResult) {
    return c.json({ error: accessResult.error }, accessResult.status as 403 | 404);
  }
  const { lastfm } = accessResult;

  try {
    const [topArtists, topAlbums, recentTracks, historicalArtists] = await Promise.all([
      lastfm.getTopArtists('7day', 5).catch(() => []),
      lastfm.getTopAlbums('7day', 5).catch(() => []),
      lastfm.recentTracks.getRecentTracks(30).catch(() => []),
      lastfm.getTopArtists('6month', 20).catch(() => []),
    ]);

    const totalPlays = topArtists.reduce((sum, a) => sum + a.playcount, 0);
    if (totalPlays < MIN_PLAYS_THRESHOLD) {
      return c.json({ data: null, sparse: true });
    }

    const messages = buildUserInsightsMessages({
      topArtists: topArtists.map((a) => ({ name: a.name, playcount: a.playcount })),
      topAlbums: topAlbums.map((a) => ({ name: a.name, artist: a.artist, playcount: a.playcount })),
      recentTracks: recentTracks.map((t) => ({ name: t.name, artist: t.artist })),
      weeklyPlayCount: totalPlays,
      historicalArtists: historicalArtists.map((a) => ({ name: a.name })),
    });

    const ai = c.get('ai') as AIService;
    const variants = [
      { key: 'gpt54', client: ai.openai, model: 'gpt-5.4', temperature: undefined as number | undefined },
      { key: 'sonnet46', client: ai.anthropic, model: 'claude-sonnet-4-6', temperature: 0.8 },
      { key: 'opus48', client: ai.anthropic, model: 'claude-opus-4-8', temperature: undefined as number | undefined },
    ];

    const results = await Promise.all(
      variants.map((v) =>
        v.client
          .chatCompletion({ model: v.model, messages, maxTokens: 1500, temperature: v.temperature })
          .then((r) => [v.key, r.content] as const)
          .catch((e) => [v.key, `ERROR: ${e instanceof Error ? e.message : String(e)}`] as const)
      )
    );

    return c.json({ data: Object.fromEntries(results) });
  } catch (error) {
    console.error('insights-ab error:', error);
    return c.json({ error: 'Failed to generate A/B insights' }, 500);
  }
});
```

> The route is on the same `app` that `apps/web/src/api/internal/index.ts` already mounts — no new mount needed. Confirm `AIService` is already imported in this file (it is — used for the existing summary route).

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/api/internal/insights.ts
git commit -m "feat(insights): add throwaway A/B debug route for model comparison"
```

---

### Task 8: Slot the hand-authored few-shot examples ⚠️ GATED on the worksheet

**Files:**
- Modify: `packages/services/ai/src/prompts/user-insights-summary.ts` (`FEW_SHOT_EXAMPLES`)
- Test: `apps/web/src/__tests__/services/ai.test.ts` (extend the prompt `describe`)

**Interfaces:**
- Consumes: the owner's 2–3 gold-standard summaries from the worksheet.
- Produces: `FEW_SHOT_EXAMPLES` populated with **one full input→output pair** (one real week's data trimmed to production shape — top-5 artists with familiar/new flags, top-5 albums, recent tracks, 20 historical, `Total plays this week: N` = sum of the top-5 — then the owner's gold summary) **plus two voice-only summaries**.

> **Do not start until the owner has written the examples.** The only human-gated task.

- [ ] **Step 1: Write the failing test (extend the warmer-voice describe)**

```typescript
it('embeds the hand-authored gold examples', () => {
  const user = buildUserInsightsMessages(insightsSample)[1].content;
  // Substitute exact distinctive phrases the owner wrote:
  expect(user).toContain('<distinctive phrase from gold example 1>');
  expect(user).toContain('<distinctive phrase from gold example 2>');
  expect(user).not.toContain('[PLACEHOLDER');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @listentomore/web exec vitest run src/__tests__/services/ai.test.ts -t "embeds the hand-authored"`
Expected: FAIL — placeholder still present.

- [ ] **Step 3: Fill `FEW_SHOT_EXAMPLES`**

Replace the placeholder with the hybrid block: the paired example's input block mirrors the production `ListeningData` shape (top-5 artists with `(familiar)`/`(new for them)` flags, top-5 albums, recent tracks, the 20-artist rotation, `Total plays this week: N`), then the owner's gold summary, then two more gold summaries under a "more in the right voice" header. Pick a distinctive week (new-obsession or jazz-rabbit-hole) for the pair.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @listentomore/web test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Owner verification (manual)**

With the real `ANTHROPIC_API_KEY` set, run `pnpm dev` and hit `GET /api/internal/insights-ab?username=bordesak` (logged in as the owner) on 3–4 real weeks. Confirm the `sonnet46` output reads warm, reacts to the music with an opinion, uses no "not X / less-like-X-more-like-Y", stays ≤ 3 em dashes. Compare against `gpt54` and `opus48`.

- [ ] **Step 6: Commit**

```bash
git add packages/services/ai/src/prompts/user-insights-summary.ts apps/web/src/__tests__/services/ai.test.ts
git commit -m "feat(insights): slot hand-authored few-shot examples into the prompt"
```

---

## Post-implementation cleanup (after the model decision)

- Once a model is chosen and verified, **delete the A/B route** (`/insights-ab` handler) — it's scaffolding.
- If GPT-5.4 wins, the revert is one line: `userInsightsSummary.provider` → `'openai'`, `model` → `'gpt-5.4'`, restore `temperature`/`verbosity`. The `AnthropicClient` stays, dormant.

## Self-Review

**Spec coverage:** Persona rewrite → T5 ✓. Cut "Do NOT" wall to two bans → T5 ✓. Hybrid few-shot → T8 (gated) ✓. Drop atmosphere framing → T5 ✓. Config flip → T6 ✓. Cache-bust across get/set/delete → T5 ✓. `AnthropicClient` → T2 ✓. `AI_PROVIDERS`/`RATE_LIMITS`/rate-limiter fix → T1 ✓. Metadata widening → T2 ✓. Service wiring + switch + 3 sites + 2 Env types + `.dev.vars` → T3 ✓. A/B route → T7 ✓. Acceptance verification → T8 Step 5 ✓.

**Placeholder scan:** Only intentional placeholder is `FEW_SHOT_EXAMPLES` (T5 ships a marked stub; T8 fills from the human artifact — the one gated task). No "TBD"/"add error handling"/"similar to Task N".

**Type consistency:** `AIProvider` widened (T1) before `RATE_LIMITS[provider]` / `new AIRateLimiter(_, 'anthropic')`. `AIResponseMetadata.provider`/`api` widened (T2) before the client sets `'anthropic'`/`'messages'`. Every symbol a web test imports from `@listentomore/ai` is re-exported from the barrel in the same task that introduces it (`AnthropicClient` T2; `buildUserInsightsMessages` T4; `USER_INSIGHTS_PROMPT_VERSION` T5). `anthropicApiKey` added to `AIServiceConfig` (T3) before all three call sites pass it.

**Test-infra check:** all tests live in `apps/web/src/__tests__/services/ai.test.ts` (the AI package has no runner); imports from `@listentomore/ai`/`@listentomore/config`/`../utils/mocks`; `setupFetchMock`/`createMockKV` per the existing file's pattern; run via the web filter.
