# AI Models Configuration Guide

This guide covers how to configure AI tasks, switch between providers, and use OpenAI models with web search.

## Overview

ListenToMore uses **OpenAI** for most AI tasks and **Anthropic** for the weekly insights summary:

| Provider | Best For | Models |
|----------|----------|--------|
| **OpenAI** | Web search, reasoning, chat, generation | `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5-nano` |
| **Anthropic** | Warm, voice-driven long-form writing | `claude-sonnet-5` |

All AI configuration lives in `packages/config/src/ai.ts`.

---

## Current Model Lineup

GPT-5.6 ships as three fixed tiers (Sol / Terra / Luna) rather than one model with
capability dials. Nothing here needs Sol.

| Model | Best For | Reasoning Efforts | Pricing (per 1M tokens) |
|-------|----------|-------------------|------------------------|
| `gpt-5.6-terra` | Default for cached and reasoning-heavy tasks | `none`, `low`, `medium` (default), `high`, `xhigh`, `max` | $2.00 in / $12.00 out |
| `gpt-5.6-luna` | Cheap tier — uncached, high-volume tasks | `none`, `low`, `medium` (default), `high`, `xhigh`, `max` | $0.20 in / $1.20 out |
| `gpt-5-nano` | Legacy — still used by playlist cover prompts | `minimal`, `low`, `medium` (default), `high` | $0.05 in / $0.40 out |
| `claude-sonnet-5` | Weekly insights summary | adaptive thinking (no effort set) | $3.00 in / $15.00 out |

The Terra/Luna split here is about **caching, not capability**. Tasks that cache
for months cost almost nothing regardless of tier, so they take the better model;
uncached tasks pay per call, so they take the cheap one. Luna measured no less
accurate than Terra on a small sample of artist-fact prompts, so treat it as a
live option rather than a downgrade.

Both 5.6 tiers default to **medium** reasoning effort, so even a short generation
spends ~75–100 reasoning tokens before it starts writing. Set `reasoning: 'none'`
on a task to buy that latency back.

### Choosing a Model

| Use Case | Current Model | Why |
|----------|---------------|-----|
| Web-grounded summaries (artist, album, genre) | `gpt-5.6-terra` | Cached 120–180 days, so the better tier costs almost nothing |
| Short descriptions (artist sentence) | `gpt-5.6-terra` | Same — heavily cached, web-grounded |
| Album recommendations | `gpt-5.6-terra` | Web search plus judgement about what to recommend |
| Complex AI chat (ListenAI) | `gpt-5.6-terra` | Reasoning + conversational quality, low latency |
| User insights summary | `claude-sonnet-5` | Warmer voice, follows the few-shot exemplars closely |
| User insights recommendations | `gpt-5.6-terra` | Multi-step analysis over listening history |
| Random facts, simple generation | `gpt-5.6-luna` | Uncached, so every call is billed — the one task where the Terra rate would bite |
| Playlist cover prompts | `gpt-5-nano` | High-throughput, minimal reasoning needed |

---

## Task Configuration

All task configs live in `packages/config/src/ai.ts` under `AI_TASKS`. To change a model, edit the `model` field:

```typescript
export const AI_TASKS = {
  artistSummary: {
    provider: 'openai',
    model: 'gpt-5.6-luna',
    maxTokens: 1500,
    temperature: 1,
    cacheTtlDays: 180,
    webSearch: false,
  },
  // ...
} as const satisfies Record<string, AITaskConfig>;
```

### Routing

All `gpt-5.x` models route to the **Responses API** automatically. The `shouldUseResponsesApi()` method in `openai.ts` handles this — any model starting with `gpt-5` goes to the Responses API, which supports web search, reasoning, and verbosity controls.

| Feature | `gpt-5.6-*` (Responses API) |
|---------|----------------------------|
| Web search | Via `web_search` tool |
| Reasoning control | `reasoning.effort` param |
| Verbosity control | `text.verbosity` param |
| Temperature | Only when reasoning is `none` |

### Web Search

Set `webSearch: true` in the task config to give the model access to the `web_search` tool. The model decides whether to search based on the query. Prompts for web-grounded tasks include the instruction "Always search the web for the latest information" to encourage searching for potentially recent/unknown content.

**Note:** No citations are extracted or displayed. Web search results are incorporated directly into the model's response text.

### Reasoning Effort

Controls how many reasoning tokens the model generates:

| Setting | Use Case | Notes |
|---------|----------|-------|
| `none` | No reasoning, temperature works | Fastest — set this explicitly if latency matters |
| `low` | Light reasoning | Fast |
| `medium` | Standard reasoning | **Default for gpt-5.6-terra / gpt-5.6-luna** |
| `high` | Complex multi-step planning | Slow |
| `xhigh` | Deeper reasoning | Slower |
| `max` | Maximum reasoning depth | Slowest, gpt-5.6 only |

**Important:** `temperature`, `top_p`, and `logprobs` only work when reasoning effort is `none`.

### Verbosity

Controls output length:

| Setting | Use Case |
|---------|----------|
| `low` | Concise answers |
| `medium` | Balanced detail (default) |
| `high` | Thorough explanations |

---

## Adding a New AI Task

### Step 1: Add Task Config

Edit `packages/config/src/ai.ts`:

```typescript
export const AI_TASKS = {
  // ...existing tasks

  myNewTask: {
    provider: 'openai',
    model: 'gpt-5.6-terra',
    maxTokens: 1000,
    temperature: 1,
    cacheTtlDays: 30,
    webSearch: true,       // optional
    reasoning: 'low',      // optional
    verbosity: 'medium',   // optional
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

Required in `apps/web/wrangler.toml` (secrets):

| Variable | Purpose |
|----------|--------|
| `OPENAI_API_KEY` | GPT models, web search |
| `INTERNAL_API_SECRET` | Signing internal API tokens |
