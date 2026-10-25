# AI Models Configuration Guide

This guide covers how to configure AI tasks, switch between providers, and use web search with each.

## Overview

ListenToMore runs eight of its nine AI tasks on **Anthropic Claude**. `randomFact` stays on **OpenAI**. Both clients are live: switching a task between providers is a config edit, with no code change.

| Provider | Models | Used for |
|----------|--------|----------|
| **Anthropic** | `claude-opus-5-5`, `claude-sonnet-5-5` | Every task except `randomFact` |
| **OpenAI** | `gpt-5.6-terra`, `gpt-5.6-luna` | `randomFact` (Luna); the switch-back path for the rest |

All AI configuration lives in `packages/config/src/ai.ts`. The comment block above `AI_TASKS` records the measurements behind the current settings.

---

## Current Model Lineup

| Model | Provider | Pricing (per 1M tokens) | Role |
|-------|----------|-------------------------|------|
| `claude-opus-5-5` | Anthropic | $4.00 in / $20.00 out | Long-form and judgement tasks |
| `claude-sonnet-5-5` | Anthropic | $2.00 in / $10.00 out | `listenAi`, the uncached chat the user waits on |
| `gpt-5.6-terra` | OpenAI | $2.00 in / $12.00 out | Switch-back for cached tasks |
| `gpt-5.6-luna` | OpenAI | $0.20 in / $1.20 out | `randomFact`; switch-back for cheap tasks |

Claude web search costs $10 per 1,000 searches. Search results are also billed as input tokens.

### Current Assignments

| Task | Model | Effort | Why |
|------|-------|--------|-----|
| `artistSummary` | `claude-opus-5-5` | low | Long-form, cached 180 days |
| `albumDetail` | `claude-opus-5-5` | low | Long-form with web search, cached 120 days |
| `genreSummary` | `claude-opus-5-5` | low | Long-form, cached 180 days |
| `albumRecommendations` | `claude-opus-5-5` | low | Web search plus judgement about what to recommend |
| `userInsightsSummary` | `claude-opus-5-5` | low | Warm long-form writing that follows the few-shot examples |
| `userInsightsRecommendations` | `claude-opus-5-5` | medium | At low effort it once leaked its filtering notes into the visible output |
| `artistSentence` | `claude-opus-5-5` | low | Short output with web search, cached 180 days. Sonnet 5.5 at low effort shipped visible self-corrections on 2 of 9 eval rows (64-74 words against the 38-word cap) |
| `listenAi` | `claude-sonnet-5-5` | low | Chat; the user waits on it |
| `randomFact` | `gpt-5.6-luna` | default | Uncached hourly cron. Sonnet 5.5 at low effort shipped visible self-corrections as the fact on 2 of 4 runs in the final eval round (461-521 characters against the 300-character limit); Luna was clean |

The `artistSummary`, `albumDetail`, and `genreSummary` prompts carry word caps (180, 350, 350) so Claude's output matches the length GPT produced.

To compare models or settings, run the eval script `apps/web/scripts/ai-eval.ts` (flags: `--label`, `--only`, `--rescore`).

---

## Task Configuration

All task configs live in `packages/config/src/ai.ts` under `AI_TASKS`. To switch a task between providers, edit `provider` and `model` together:

```typescript
export const AI_TASKS = {
  artistSummary: {
    provider: 'openai',          // was 'anthropic'
    model: 'gpt-5.6-terra',      // was 'claude-opus-5-5'
    maxTokens: 2500,
    temperature: 1,
    cacheTtlDays: 180,
    webSearch: false,
    reasoning: 'low',
  },
  // ...
} as const satisfies Record<string, AITaskConfig>;
```

Each API key is needed only by the tasks routed to its provider: `ANTHROPIC_API_KEY` for Anthropic tasks, `OPENAI_API_KEY` for OpenAI tasks. Today both must be set, because `randomFact` runs on OpenAI and every other task on Anthropic.

### Routing

`AIService.getClientForTask()` picks the client from the task's `provider`. Each client maps the shared config fields to its own API:

| Config field | Anthropic (Messages API) | OpenAI (Responses API, `gpt-5.x`) |
|--------------|--------------------------|-----------------------------------|
| `webSearch` | Server-side `web_search_20250305` tool, `max_uses: 5` | `web_search` tool |
| `reasoning` | `output_config.effort`; `none`, `minimal`, or unset map to `low` | `reasoning.effort` |
| `temperature` | Never sent | Only sent when reasoning is `none` |
| `verbosity` | Ignored | `text.verbosity` |
| `maxTokens` | `max_tokens` (includes thinking) | `max_output_tokens` (includes reasoning) |

Anthropic client behavior worth knowing:

- `stop_reason: max_tokens` and `refusal` both mark the response uncacheable.
- A `pause_turn` stop is resumed once automatically. Usage covers both requests; a second `pause_turn` marks the response uncacheable.
- When a response contains search results, only text after the last result is kept, so narration such as "I'll search for..." never reaches the page or the cache.
- Requests with web search use the 60-second timeout tier.
- `max_uses: 5` allows album recommendations to verify the seed album plus three picks (four searches). The newer `web_search_20260209` tool was tried first; its model-written filter scripts crashed while still consuming searches, which produced empty summaries.

OpenAI client behavior: any model starting with `gpt-5` goes to the Responses API (`shouldUseResponsesApi()` in `openai.ts`).

### Web Search

Set `webSearch: true` in the task config to give the model a search tool. The model decides whether to search based on the query. Prompts for web-grounded tasks include the instruction "Always search the web for the latest information" to encourage searching for potentially recent or unknown content.

**Note:** No citations are extracted or displayed. Search results are incorporated directly into the model's response text.

### Reasoning Effort

Controls how many reasoning (GPT) or thinking (Claude) tokens the model spends before writing. These tokens are invisible and count against `maxTokens`.

| Setting | Notes |
|---------|-------|
| `none` | OpenAI: no reasoning, temperature works. Claude: treated as `low` |
| `minimal` | OpenAI `gpt-5` / `gpt-5-mini` only. Claude: treated as `low` |
| `low` | Light reasoning, fast. Used by most tasks |
| `medium` | Default on Opus 5.5 and the GPT-5.6 tiers. Used by `userInsightsRecommendations` |
| `high`, `xhigh`, `max` | Deeper and slower. Claude receives all three unchanged; on OpenAI, `max` exists on GPT-5.6 only |

Set `reasoning` explicitly on every task. On OpenAI, an unset value falls to the model default (`medium` on GPT-5.6), which is slower and spends more tokens. The Anthropic client maps an unset value to `low`.

### Verbosity

OpenAI only. Controls output length: `low` (concise), `medium` (default), `high` (thorough). Claude ignores it, so length on Claude is controlled in the prompt.

---

## Adding a New AI Task

### Step 1: Add Task Config

Edit `packages/config/src/ai.ts`:

```typescript
export const AI_TASKS = {
  // ...existing tasks

  myNewTask: {
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    maxTokens: 2500,
    temperature: 1,
    cacheTtlDays: 30,
    webSearch: true,       // optional
    reasoning: 'low',      // optional
    verbosity: 'low',      // optional, OpenAI only
  },
} as const satisfies Record<string, AITaskConfig>;
```

### Step 2: Add Cache Config

Edit `packages/config/src/cache.ts`:

```typescript
export const CACHE_CONFIG = {
  ai: {
    // ...existing
    myNewTask: { ttlDays: 30 },
  },
};
```

### Step 3: Create Prompt File

Create `packages/services/ai/src/prompts/my-new-task.ts`:

```typescript
import { getTaskConfig } from '@listentomore/config';
import type { ChatClient, AIResponseMetadata } from '../types';
import type { AICache } from '../cache';

export interface MyNewTaskResult {
  content: string;
  metadata?: AIResponseMetadata;
}

export async function generateMyNewTask(
  input: string,
  client: ChatClient,
  cache: AICache
): Promise<MyNewTaskResult> {
  const normalizedInput = input.toLowerCase().trim();

  const cached = await cache.get<MyNewTaskResult>('myNewTask', normalizedInput);
  if (cached) return cached;

  const config = getTaskConfig('myNewTask');

  const response = await client.chatCompletion({
    model: config.model,
    messages: [
      { role: 'system', content: 'You are a music expert.' },
      { role: 'user', content: `Your prompt here about ${input}.` },
    ],
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    reasoning: config.reasoning,
    verbosity: config.verbosity,
    webSearch: config.webSearch,
  });

  const result: MyNewTaskResult = {
    content: response.content,
    metadata: response.metadata,
  };

  await cache.set('myNewTask', [normalizedInput], { content: result.content });

  return result;
}
```

### Step 4: Export from Prompts Index

Edit `packages/services/ai/src/prompts/index.ts`:

```typescript
export {
  generateMyNewTask,
  type MyNewTaskResult,
} from './my-new-task';
```

### Step 5: Add Convenience Method to AIService

Edit `packages/services/ai/src/index.ts`:

```typescript
async getMyNewTask(input: string) {
  const { generateMyNewTask } = await import('./prompts/my-new-task');
  const client = this.getClientForTask('myNewTask');
  return generateMyNewTask(input, client, this.cache);
}
```

### Step 6: Create Internal API Endpoint

Add to `apps/web/src/api/internal/`:

```typescript
app.get('/my-new-task', async (c) => {
  const input = c.req.query('input');
  if (!input) return c.json({ error: 'Missing input parameter' }, 400);

  try {
    const ai = c.get('ai');
    const result = await ai.getMyNewTask(input);
    return c.json({ data: result });
  } catch (error) {
    console.error('my-new-task error:', error);
    return c.json({ error: 'Failed to generate' }, 500);
  }
});
```

### Step 7: Use with Progressive Loading

```typescript
<div id="my-new-task">
  <p class="text-muted">Loading...</p>
</div>
<script dangerouslySetInnerHTML={{ __html: `
  internalFetch('/api/internal/my-new-task?input=' + encodeURIComponent(input))
    .then(r => r.json())
    .then(result => {
      if (result.error) {
        document.getElementById('my-new-task').innerHTML = '<p class="text-muted">Unavailable.</p>';
        return;
      }
      document.getElementById('my-new-task').innerHTML = marked.parse(result.data.content);
    })
    .catch(() => {
      document.getElementById('my-new-task').innerHTML = '<p class="text-muted">Failed to load.</p>';
    });
` }} />
```

**Remember:**
- Pass `internalToken` to Layout for pages using internal APIs
- Use `internalFetch()` (not `fetch()`) for `/api/internal/*` calls
- AI results use markdown; use `marked.parse()` client-side

---

## Environment Variables

Required secrets on both the web Worker (`apps/web/wrangler.toml`) and the Discord bot Worker (`apps/discord-bot/wrangler.toml`):

| Variable | Purpose |
|----------|--------|
| `ANTHROPIC_API_KEY` | Claude models, Claude web search |
| `OPENAI_API_KEY` | GPT models (`randomFact`, and any task switched back to OpenAI) |

The web Worker also needs `INTERNAL_API_SECRET` for signing internal API tokens.
