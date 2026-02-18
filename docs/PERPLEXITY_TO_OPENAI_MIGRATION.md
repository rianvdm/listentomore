# Perplexity to OpenAI Migration Plan

Replace all Perplexity API calls with OpenAI GPT-5.2 (web search + citations) to consolidate on a single AI provider.

## Background

Currently, ListenToMore uses **Perplexity** (`sonar` model) for 5 web-grounded tasks that need citations, and **OpenAI** for everything else. Both providers already normalize to the same `{ content: string, citations: string[] }` interface via our `ChatClient` abstraction, making this migration straightforward.

### Target Model: GPT-5.2

We're migrating to **GPT-5.2** (`gpt-5.2`), OpenAI's flagship model with:
- **Web search support** via the Responses API
- **Reasoning effort levels:** `none` (default), `low`, `medium`, `high`, `xhigh`
- **400K context window**, 128K max output tokens
- **Pricing:** $1.75/1M input, $14/1M output + $10/1K web search calls
- **Knowledge cutoff:** August 31, 2025

GPT-5.2 with `reasoning: 'none'` provides fast, low-latency responses. For factual web searches where accuracy matters, `reasoning: 'low'` is recommended.

### Tasks Currently on Perplexity

| Task | Function | What It Does | Citations |
|------|----------|--------------|-----------|
| `artistSummary` | `generateArtistSummary` | Detailed artist biography with genres, albums, similar artists | Yes |
| `albumDetail` | `generateAlbumDetail` | Album history, genre summary, critical reception | Yes |
| `genreSummary` | `generateGenreSummary` | Genre history, musical elements, pioneering artists, seminal albums | Yes |
| `artistSentence` | `generateArtistSentence` | Short (<38 words) plain-text artist description | No (stripped) |
| `albumRecommendations` | `generateAlbumRecommendations` | 3 similar album recommendations with descriptions | Yes |

### Why This Works Without Frontend Changes

Both `PerplexityClient` and `OpenAIClient` implement the `ChatClient` interface and return `{ content, citations }`. The OpenAI client already handles web search citations by:
1. Extracting `url_citation` annotations from Responses API output
2. Deduplicating URLs into the `citations[]` array
3. Returning the same format Perplexity uses (prompts instruct models to use `[N]` markers)

The client-side `transformCitations()` and `renderCitations()` functions are provider-agnostic.

**Verified:** Unit tests in `apps/web/src/__tests__/services/ai.test.ts` confirm:
- OpenAI Responses API citations are extracted from `url_citation` annotations
- Duplicate URLs are deduplicated correctly
- `metadata.features.webSearchUsed` indicates whether search was invoked
- The `web_search` tool is sent when `webSearch: true` is configured

---

## Migration Steps

### 1. Update Task Config (`packages/config/src/ai.ts`)

Change `provider` and `model` for 5 tasks. Add `webSearch: true` to enable OpenAI's web search tool.

```typescript
// BEFORE
artistSummary: {
  provider: 'perplexity',
  model: 'sonar',
  maxTokens: 1500,
  temperature: 0.5,
  cacheTtlDays: 180,
},

// AFTER
artistSummary: {
  provider: 'openai',
  model: 'gpt-5.2',
  maxTokens: 1500,
  temperature: 1,
  cacheTtlDays: 180,
  webSearch: true,
  reasoning: 'low',      // 'low' recommended for factual accuracy; 'none' for speed
  verbosity: 'medium',   // Controls output length
},
```

#### GPT-5.2 Parameter Reference

| Parameter | GPT-5.2 Values | Notes |
|-----------|----------------|-------|
| `reasoning` | `'none'` (default), `'low'`, `'medium'`, `'high'`, `'xhigh'` | Use `'low'` for factual web searches; `'none'` for fastest responses |
| `verbosity` | `'low'`, `'medium'`, `'high'` | Controls output length; `'medium'` is default |
| `temperature` | Only works with `reasoning: 'none'` | Ignored when reasoning is set to any other level |
| `webSearch` | `true` / `false` | Web search is supported at all reasoning levels including `'none'` |

**Model Comparison:**

| Model | Reasoning Levels | Default | Web Search | Best For |
|-------|------------------|---------|------------|----------|
| `gpt-5.2` | none, low, medium, high, xhigh | `none` | Yes | Complex reasoning, broad knowledge, tool calling |
| `gpt-5-mini` | minimal, low, medium, high | `medium` | Yes (requires `low`+) | Cost-optimized, balanced |
| `gpt-5-nano` | minimal, low, medium, high | `medium` | Limited | High-throughput, simple tasks |

> **Recommendation:** Use `reasoning: 'low'` for web search tasks. This provides a good balance between speed and accuracy for factual lookups. The model will "think" briefly before searching, improving result quality.
>
> For `artistSentence` (short descriptions), `reasoning: 'none'` with `verbosity: 'low'` is fine since it's a simple task.

> **Tip:** There's a commented-out `genreSummary` config at line ~123 in `packages/config/src/ai.ts` that can be used for testing a single task before full migration.

**Complete configs for all 5 tasks:**

```typescript
artistSummary: {
  provider: 'openai',
  model: 'gpt-5.2',
  maxTokens: 1500,
  temperature: 1,
  cacheTtlDays: 180,
  webSearch: true,
  reasoning: 'low',
  verbosity: 'medium',
},

albumDetail: {
  provider: 'openai',
  model: 'gpt-5.2',
  maxTokens: 1500,
  temperature: 1,
  cacheTtlDays: 120,
  webSearch: true,
  reasoning: 'low',
  verbosity: 'medium',
},

genreSummary: {
  provider: 'openai',
  model: 'gpt-5.2',
  maxTokens: 1500,
  temperature: 1,
  cacheTtlDays: 180,
  webSearch: true,
  reasoning: 'low',
  verbosity: 'medium',
},

artistSentence: {
  provider: 'openai',
  model: 'gpt-5.2',
  maxTokens: 150,
  temperature: 1,
  cacheTtlDays: 180,
  webSearch: true,
  reasoning: 'none',    // Fast, short output - no reasoning needed
  verbosity: 'low',     // Keep it brief
},

albumRecommendations: {
  provider: 'openai',
  model: 'gpt-5.2',
  maxTokens: 1000,
  temperature: 1,
  cacheTtlDays: 30,
  webSearch: true,
  reasoning: 'low',
  verbosity: 'medium',
},
```

### 2. Update AIService Class (`packages/services/ai/src/index.ts`)

Make `perplexityApiKey` optional or remove it:

```typescript
// BEFORE
interface AIServiceConfig {
  openaiApiKey: string;
  perplexityApiKey: string;
  cache: KVNamespace;
}

// AFTER
interface AIServiceConfig {
  openaiApiKey: string;
  perplexityApiKey?: string;  // Optional, for gradual migration
  cache: KVNamespace;
}
```

If removing Perplexity entirely:
- Remove `this.perplexity` client instantiation
- Remove `this.perplexityRateLimiter`
- Update `getClientForTask()` to only return `this.openai`

### 3. Remove or Deprecate PerplexityClient (`packages/services/ai/src/perplexity.ts`)

Options:
- **Delete the file** if fully committing to OpenAI-only
- **Keep it dormant** if you want the option to switch back

If deleting, also remove its export from the package index.

### 4. Update Rate Limiter Config (`packages/config/src/ai.ts`)

Remove the `perplexity` entry from `RATE_LIMITS` and consider increasing the OpenAI limit:

```typescript
// BEFORE
export const RATE_LIMITS = {
  openai: { requestsPerMinute: 60 },
  perplexity: { requestsPerMinute: 30 },
};

// AFTER
export const RATE_LIMITS = {
  openai: { requestsPerMinute: 90 },  // Increased to handle former Perplexity traffic
};
```

### 5. Clean Up Types

**`packages/config/src/ai.ts`:**
```typescript
// Update ReasoningEffort to include GPT-5.2's 'xhigh' level
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

// Update the comment to document GPT-5.2:
/**
 * Reasoning effort levels for GPT-5 models (Responses API only)
 * - GPT-5.2: 'none' (default) | 'low' | 'medium' | 'high' | 'xhigh'
 * - GPT-5.1: 'none' (default) | 'low' | 'medium' | 'high'
 * - GPT-5/gpt-5-mini: 'minimal' | 'low' | 'medium' (default) | 'high'
 */
```

**`packages/services/ai/src/types.ts`:**
```typescript
// Optional: narrow provider type
type AIProvider = 'openai';  // was 'openai' | 'perplexity'

// Optional: remove Perplexity-specific option
// Remove SearchContextSize type and searchContextSize from ChatCompletionOptions
```

### 6. Remove Environment Variables (6 files)

| File | Change |
|------|--------|
| `apps/web/src/types.ts` | Remove `PERPLEXITY_API_KEY` from `Bindings` type |
| `apps/web/wrangler.toml` | Remove `PERPLEXITY_API_KEY` secret comment |
| `apps/web/src/index.tsx` | Remove `perplexityApiKey: c.env.PERPLEXITY_API_KEY` from AIService constructor (~2 places: middleware + CRON) |
| `apps/discord-bot/src/index.ts` | Remove `PERPLEXITY_API_KEY` from `Env` type and AIService constructor |
| `apps/discord-bot/wrangler.toml` | Remove `PERPLEXITY_API_KEY` secret comment |
| `.dev.vars` | Remove `PERPLEXITY_API_KEY` |

Then delete the production secrets:
```bash
cd apps/web && npx wrangler secret delete PERPLEXITY_API_KEY
cd apps/discord-bot && npx wrangler secret delete PERPLEXITY_API_KEY
```

### 7. Update Database Schema (`packages/db/src/schema.ts`)

Remove `'perplexity'` from the `RateLimit.service` union type:

```typescript
// BEFORE
service: 'discogs' | 'spotify' | 'openai' | 'perplexity';

// AFTER
service: 'discogs' | 'spotify' | 'openai';
```

The seed data in `001_initial.sql` (`INSERT ... ('perplexity', 30)`) is harmless and can stay, or add a cleanup migration.

### 8. Update Documentation (3 files)

| File | Changes |
|------|---------|
| `CLAUDE.md` | Remove Perplexity from env vars tables, update AI model table, update rate limit notes |
| `docs/how-to/ai-models.md` | Already updated -- remove Perplexity provider row if fully removing |
| `README.md` | Remove Perplexity from tech stack / features list |

### 9. Update Tests

File: `apps/web/src/__tests__/services/ai.test.ts`

**Already done:** OpenAI client tests have been added to verify web search citation handling:
- `OpenAIClient > Responses API with web search > extracts citations from url_citation annotations`
- `OpenAIClient > Responses API with web search > deduplicates repeated citation URLs`
- `OpenAIClient > Responses API with web search > handles response with no web search`
- `OpenAIClient > Responses API with web search > sends web_search tool when webSearch option is true`

Optional cleanup: Remove or update tests that reference Perplexity-specific behavior if removing the client entirely.

---

## Files Changed Summary

| Category | Files | Action |
|----------|-------|--------|
| **Config** | `packages/config/src/ai.ts` | Switch 5 tasks to OpenAI, remove Perplexity rate limits |
| **Service** | `packages/services/ai/src/index.ts` | Remove/optional Perplexity client |
| **Service** | `packages/services/ai/src/perplexity.ts` | Delete or deprecate |
| **Service** | `packages/services/ai/src/types.ts` | Narrow types |
| **Service** | `packages/services/ai/src/rate-limit.ts` | Remove Perplexity limiter (if needed) |
| **Web types** | `apps/web/src/types.ts` | Remove `PERPLEXITY_API_KEY` |
| **Web init** | `apps/web/src/index.tsx` | Remove Perplexity key from constructor (2 places) |
| **Web config** | `apps/web/wrangler.toml` | Remove secret comment |
| **Bot types** | `apps/discord-bot/src/index.ts` | Remove from Env + constructor |
| **Bot config** | `apps/discord-bot/wrangler.toml` | Remove secret comment |
| **DB** | `packages/db/src/schema.ts` | Remove `'perplexity'` from union |
| **Docs** | `CLAUDE.md`, `README.md`, `docs/how-to/ai-models.md` | Update references |
| **Tests** | `apps/web/src/__tests__/services/ai.test.ts` | Update mocks |

**Total: ~13-15 files modified, 1 file deleted, 0 new files**

---

## What Does NOT Change

These files need **zero modifications**:

- **Prompt files** (`packages/services/ai/src/prompts/*.ts`) -- They accept `ChatClient`, not a specific provider
- **Internal API endpoints** (`apps/web/src/api/internal/*.ts`) -- They return `{ content, citations }` regardless of provider
- **Public API endpoints** (`apps/web/src/api/v1/*.ts`) -- Same passthrough
- **Page components** (`apps/web/src/pages/**/*.tsx`) -- Citation rendering is provider-agnostic
- **Client-side scripts** (`apps/web/src/utils/client-scripts.ts`) -- `transformCitations()` and `renderCitations()` work with any `[N]` + `citations[]` format
- **CSS** (`apps/web/src/styles/globals.ts`) -- Citation styling unchanged
- **Discord bot commands** -- They call `AIService` methods which route through `getClientForTask()`

---

## Risks and Considerations

### Quality

- Perplexity's `sonar` has web search baked into the model at training time. OpenAI's web search is a tool call the model decides to invoke.
- OpenAI might occasionally skip web search when it "knows" the answer, resulting in no citations. Prompt engineering can mitigate this (e.g., "Always search the web for current information").
- Response style/tone may differ slightly. Cached content will continue serving until TTL expires (30-180 days), so the transition will be gradual.

### Cost

**GPT-5.2 Pricing (per 1M tokens):**
- Input: $1.75
- Cached input: $0.175 (10x cheaper)
- Output: $14.00
- Web search: $10.00 per 1K tool calls ($0.01/call)

| Scenario | Estimated Cost (per 1K requests) |
|----------|----------------------------------|
| Perplexity `sonar` | ~$1-2 (varies by plan) |
| OpenAI `gpt-5.2` + web search | ~$1.75 input + $14 output per 1M tokens + $10 per 1K searches |

**Example calculation for `artistSummary`:**
- ~500 input tokens × 1K requests = 500K tokens = $0.875
- ~1000 output tokens × 1K requests = 1M tokens = $14.00
- 1K web search calls = $10.00
- **Total: ~$24.88 per 1K uncached requests**

The web search tool call cost ($0.01/call) is fixed per search. For heavily cached content (120-180 day TTLs), the actual cost impact is much lower since most requests are served from cache with no API calls.

### Rate Limits

Current: Perplexity at 30 req/min + OpenAI at 60 req/min (separate pools).
After: All traffic through OpenAI. Increase OpenAI rate limit to 90+ req/min to compensate.

### Cache Invalidation

No immediate action needed. Existing Perplexity-generated cached content will continue serving until TTL expiration. New requests will use OpenAI. To force fresh OpenAI content:

```bash
# Clear specific cached content types
curl -X DELETE "https://listentomore.com/api/cache?type=artistSummary&artist=radiohead" \
  -H "X-API-Key: YOUR_PREMIUM_KEY"
```

Or clear KV keys matching `ai:artistSummary:*`, `ai:albumDetail:*`, `ai:genreSummary:*`, `ai:artistSentence:*`, `ai:albumRecommendations:*`.

---

## Verification Checklist

After migration, verify:

- [ ] `pnpm typecheck` passes with no errors
- [ ] `pnpm build` succeeds
- [ ] `pnpm test` passes
- [ ] Artist pages load with AI summaries and citations render correctly
- [ ] Album pages load with AI details and recommendations with citations
- [ ] Genre pages load with AI summaries and citations
- [ ] Discord bot `/whois`, `/whatis`, `/listento` commands work
- [ ] Cache reads work (second request for same content is fast)
- [ ] No references to `PERPLEXITY_API_KEY` remain in codebase (except archived docs)
- [ ] Production secrets are deleted via `wrangler secret delete`
