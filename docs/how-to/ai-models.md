# AI Models Configuration Guide

This guide covers how to configure AI tasks, switch between providers, and use OpenAI models with web search.

## Overview

ListenToMore uses **OpenAI** as its sole AI provider:

| Provider | Best For | Models |
|----------|----------|--------|
| **OpenAI** | All AI tasks including web search, reasoning, creative tasks | `gpt-5.4`, `gpt-5-mini`, `gpt-5-nano` |

All AI configuration lives in `packages/config/src/ai.ts`.

---

## Current Model Lineup

| Model | Best For | Context | Reasoning Efforts | Pricing (per 1M tokens) |
|-------|----------|---------|-------------------|------------------------|
| `gpt-5.4` | Flagship — web search, reasoning, all content tasks | 1M+ | `none` (default), `low`, `medium`, `high`, `xhigh` | ~$1.75 in / $14.00 out |
| `gpt-5-mini` | Cost-optimized — simple generation tasks | 1M | `minimal`, `low`, `medium` (default), `high` | $0.25 in / $2.00 out |
| `gpt-5-nano` | High-throughput simple tasks | 1M | `minimal`, `low`, `medium` (default), `high` | $0.05 in / $0.40 out |

### Choosing a Model

| Use Case | Current Model | Why |
|----------|---------------|-----|
| Web-grounded summaries (artist, album, genre) | `gpt-5.4` | Strong web search, great accuracy |
| Short descriptions (artist sentence) | `gpt-5.4` | Web-grounded for accuracy |
| Album recommendations | `gpt-5.4` | Web search for current album data |
| Complex AI chat (ListenAI) | `gpt-5.4` | Reasoning + conversational quality |
| User insights analysis | `gpt-5.4` | Complex multi-step analysis |
| Random facts, simple generation | `gpt-5-mini` | No web search needed, cost-effective |
| Playlist cover prompts | `gpt-5-nano` | High-throughput, minimal reasoning needed |

---

## Task Configuration

All task configs live in `packages/config/src/ai.ts` under `AI_TASKS`. To change a model, edit the `model` field:

```typescript
export const AI_TASKS = {
  artistSummary: {
    provider: 'openai',
    model: 'gpt-5.4',
    maxTokens: 1500,
    temperature: 1,
    cacheTtlDays: 180,
    webSearch: true,
  },
  // ...
} as const satisfies Record<string, AITaskConfig>;
```

### Routing

All `gpt-5.x` models route to the **Responses API** automatically. The `shouldUseResponsesApi()` method in `openai.ts` handles this — any model starting with `gpt-5` goes to the Responses API, which supports web search, reasoning, and verbosity controls.

| Feature | `gpt-5.4` (Responses API) |
|---------|--------------------------|
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
| `none` | No reasoning, temperature works | **Default for gpt-5.4** |
| `low` | Light reasoning | Fast |
| `medium` | Standard reasoning | Moderate |
| `high` | Complex multi-step planning | Slow |
| `xhigh` | Maximum reasoning depth | Slowest, gpt-5.4 only |

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
    model: 'gpt-5.4',
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
