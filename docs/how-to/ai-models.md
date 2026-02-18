# AI Models Configuration Guide

This guide covers how to configure AI tasks, switch between providers, and use OpenAI models with features like web search and reasoning.

## Overview

ListenToMore uses **OpenAI** as its sole AI provider:

| Provider | Best For | Models |
|----------|----------|--------|
| **OpenAI** | All AI tasks including web search with citations, reasoning, creative tasks | `gpt-5-search-api`, `gpt-5.2`, `gpt-5.1`, `gpt-5-mini` |

All AI configuration lives in `packages/config/src/ai.ts`.

---

## Current OpenAI Model Lineup

OpenAI's current flagship model family is **GPT-5.x**, which unifies reasoning and non-reasoning capabilities into a single model line. The previous o-series (o3, o4-mini) reasoning models are succeeded by the GPT-5 family.

### Frontier Models

| Model | Best For | Context | Reasoning Efforts | Pricing (per 1M tokens) |
|-------|----------|---------|-------------------|------------------------|
| `gpt-5.2` | Complex reasoning, broad world knowledge, agentic tasks | 400K | `none` (default), `low`, `medium`, `high`, `xhigh` | $1.75 in / $14.00 out |
| `gpt-5.1` | Previous flagship; coding and agentic tasks | 1M | `none` (default), `low`, `medium`, `high` | $1.25 in / $10.00 out |
| `gpt-5` | Previous reasoning model | 256K | `minimal`, `low`, `medium` (default), `high` | $1.25 in / $10.00 out |
| `gpt-5-mini` | Cost-optimized reasoning and chat | 1M | `minimal`, `low`, `medium` (default), `high` | $0.25 in / $2.00 out |
| `gpt-5-nano` | High-throughput, simple tasks | 1M | `minimal`, `low`, `medium` (default), `high` | $0.05 in / $0.40 out |
| `gpt-4.1` | Non-reasoning, large context | 1M | N/A | $2.00 in / $8.00 out |

### GPT-5.2 Highlights

GPT-5.2 is OpenAI's newest flagship model (released late 2025). Key differences from GPT-5.1:

- **Default reasoning is `none`** (GPT-5.1 also defaulted to `none`; GPT-5 defaults to `medium`)
- **New `xhigh` reasoning effort** level for maximum reasoning depth
- **Improved instruction following**, accuracy, and token efficiency
- **Better vision and multimodality** capabilities
- **`temperature`, `top_p`, `logprobs` only work when reasoning effort is `none`** -- same as GPT-5.1
- **Knowledge cutoff: August 2025**
- **Supports web search, file search, code interpreter, image generation** tools
- **Concise reasoning summaries** via `reasoning.summary` parameter

### Specialized Search Model

| Model | Best For | API | Notes |
|-------|----------|-----|-------|
| `gpt-5-search-api` | Web-grounded content with reliable citations | Chat Completions | Always searches the web; returns `url_citation` annotations |

`gpt-5-search-api` is OpenAI's dedicated search model. Unlike using `web_search` as a tool with GPT-5.x via the Responses API, this model **reliably returns `url_citation` annotations** in every response. It uses the Chat Completions API with `web_search_options: {}`.

### Choosing a Model for ListenToMore Tasks

| Use Case | Current Model | Why |
|----------|---------------|-----|
| Web-grounded summaries (artist, album, genre) | `gpt-5-search-api` | Reliable citations via Chat Completions |
| Short descriptions (artist sentence) | `gpt-5-search-api` | Web-grounded for accuracy |
| Album recommendations | `gpt-5-search-api` | Web search for current album data |
| Complex AI chat (ListenAI) | `gpt-5.1` | Good reasoning for conversational AI |
| User insights analysis | `gpt-5.2` | Complex multi-step analysis of listening data |
| Random facts, simple generation | `gpt-5-mini` | No web search needed, cost-effective |

---

## Switching Models for a Task

To change which model a task uses, edit `AI_TASKS` in `packages/config/src/ai.ts`:

```typescript
export const AI_TASKS = {
  artistSummary: {
    provider: 'openai',
    model: 'gpt-5-search-api',  // Dedicated search model
    maxTokens: 1500,
    temperature: 1,
    cacheTtlDays: 180,
    webSearch: true,              // Adds web_search_options to request
  },
  // ...
};
```

### Example: Web Search Task (Chat Completions)

```typescript
artistSummary: {
  provider: 'openai',
  model: 'gpt-5-search-api',  // Uses Chat Completions API
  maxTokens: 1500,
  temperature: 1,
  cacheTtlDays: 180,
  webSearch: true,              // Required for gpt-5-search-api
},
```

### Example: Non-Search Task (Responses API)

```typescript
userInsightsSummary: {
  provider: 'openai',
  model: 'gpt-5.2',            // Uses Responses API
  maxTokens: 1000,
  temperature: 1,
  cacheTtlDays: 1,
  reasoning: 'low',             // Responses API feature
  verbosity: 'low',             // Responses API feature
},
```

### API Comparison

| Feature | OpenAI (Chat Completions) | OpenAI (Responses API) |
|---------|---------------------------|------------------------|
| Web search | Via `gpt-5-search-api` model | Via `web_search` tool |
| Citations | Via annotations | Via annotations |
| Domain filtering | N/A | `filters.allowed_domains` |
| Reasoning control | `reasoning_effort` param | `reasoning.effort` param |
| Verbosity control | `verbosity` param | `text.verbosity` param |
| Temperature | Yes (some models) | Only when reasoning is `none` |

---

## GPT-5.2 Configuration

GPT-5.2 is OpenAI's latest flagship model with configurable reasoning, verbosity, and web search capabilities.

### Reasoning Effort

Controls how many reasoning tokens the model generates before responding:

| Setting | Use Case | Latency | Notes |
|---------|----------|---------|-------|
| `none` | No reasoning, temperature works | Fastest | **Default for GPT-5.2 and GPT-5.1** |
| `low` | Light reasoning | Fast | |
| `medium` | Standard reasoning | Moderate | **Default for GPT-5 and GPT-5-mini** |
| `high` | Complex multi-step planning | Slow | |
| `xhigh` | Maximum reasoning depth | Slowest | **GPT-5.2 only** |

**Important:** `temperature`, `top_p`, and `logprobs` only work when reasoning effort is `none`. Requests with any other reasoning effort that include these fields will raise an error.

```typescript
// For latency-sensitive tasks (no reasoning, temperature works)
albumDetail: {
  provider: 'openai',
  model: 'gpt-5.2',
  // reasoning not set = 'none' for gpt-5.2
  verbosity: 'medium',
  maxTokens: 1000,
  cacheTtlDays: 120,
},

// For complex analysis
listenAi: {
  provider: 'openai',
  model: 'gpt-5.2',
  reasoning: 'medium',    // Enable reasoning
  verbosity: 'high',      // Detailed output
  maxTokens: 10000,
  cacheTtlDays: 0,
},
```

### Verbosity

Controls output length:

| Setting | Use Case |
|---------|----------|
| `low` | Concise answers, simple code |
| `medium` | Balanced detail (default) |
| `high` | Thorough explanations, verbose output |

### Web Search

ListenToMore uses `gpt-5-search-api` via the **Chat Completions API** for all web-grounded tasks. This is OpenAI's dedicated search model that always performs web search and reliably returns `url_citation` annotations.

To enable, set `model: 'gpt-5-search-api'` and `webSearch: true`:

```typescript
artistSummary: {
  provider: 'openai',
  model: 'gpt-5-search-api',
  webSearch: true,        // Adds web_search_options: {} to request
  maxTokens: 1500,
  cacheTtlDays: 180,
},
```

The OpenAI client will automatically:
1. Route to Chat Completions API (not Responses API)
2. Add `web_search_options: {}` to the request body
3. Parse `url_citation` annotations from the response
4. Replace inline markdown citation links with numbered `[1]`, `[2]` markers
5. Return `{ content, citations }` for client-side rendering

**Why `gpt-5-search-api` instead of GPT-5.x + Responses API `web_search` tool:**
- GPT-5.x with reasoning enabled uses "agentic search" which returns **empty** `annotations: []`
- Even with `reasoning: 'none'`, annotations from the Responses API are unreliable
- `gpt-5-search-api` via Chat Completions **always** returns `url_citation` annotations
- This is a known issue discussed in the OpenAI developer community

**Web search limitations:**
- `gpt-5-search-api` always searches the web (no conditional search)
- Limited to 128K context window
- Incurs additional cost: search calls + search content tokens at model rates

**Citation flow:**
1. `gpt-5-search-api` returns `message.annotations[]` with `url_citation` objects
2. `OpenAIClient.chatCompletionViaChatCompletions()` extracts URLs and builds a citation map
3. Inline markdown links are replaced with `[1]`, `[2]` markers
4. Client-side `transformCitations(html, citations)` converts markers to clickable superscript links
5. `renderCitations(citations)` renders the numbered source list

### API Selection Logic

Our `OpenAIClient` automatically routes requests to the appropriate API:

| Condition | API Used |
|-----------|----------|
| `gpt-5-search-api` model | Chat Completions API (`POST /v1/chat/completions`) with `web_search_options` |
| GPT-5.x model (or `reasoning`/`verbosity` set) | Responses API (`POST /v1/responses`) |
| Other models | Chat Completions API (`POST /v1/chat/completions`) |

The `shouldUseResponsesApi()` method in `openai.ts` handles this routing. It explicitly returns `false` for `gpt-5-search-api` since that model requires Chat Completions.

The Responses API provides better performance with GPT-5 models for non-search tasks because it can pass chain-of-thought (CoT) between turns, leading to fewer generated reasoning tokens and higher cache hit rates.

---

## Adding a New AI Task

Follow these steps to add a new AI-powered feature.

### Step 1: Add Task Config

Edit `packages/config/src/ai.ts`:

```typescript
export const AI_TASKS = {
  // ... existing tasks

  albumRecommendations: {
    provider: 'openai',
    model: 'gpt-5-search-api',
    maxTokens: 1000,
    temperature: 1,
    cacheTtlDays: 30,
    webSearch: true,
  },
} as const satisfies Record<string, AITaskConfig>;
```

### Step 2: Add Cache Config

Edit `packages/config/src/cache.ts`:

```typescript
export const CACHE_CONFIG = {
  ai: {
    // ... existing
    albumRecommendations: { ttlDays: 30 },
  },
};
```

### Step 3: Create Prompt File

Create `packages/services/ai/src/prompts/album-recommendations.ts`:

```typescript
import { AI_TASKS } from '@listentomore/config';
import type { ChatClient } from '../types';
import type { AICache } from '../cache';

export interface AlbumRecommendationsResult {
  content: string;
  citations: string[];
}

export async function generateAlbumRecommendations(
  artistName: string,
  albumName: string,
  client: ChatClient,
  cache: AICache
): Promise<AlbumRecommendationsResult> {
  // Normalize for cache key consistency
  const normalizedArtist = artistName.toLowerCase().trim();
  const normalizedAlbum = albumName.toLowerCase().trim();

  // Check cache first
  const cached = await cache.get<AlbumRecommendationsResult>(
    'albumRecommendations',
    normalizedArtist,
    normalizedAlbum
  );
  if (cached) return cached;

  const config = AI_TASKS.albumRecommendations;

  const prompt = `Based on the album "${albumName}" by ${artistName}, recommend 5 similar albums...

Include inline citation numbers like [1], [2] to reference sources.
Do NOT start with a preamble or end with follow-up suggestions.`;

  const response = await client.chatCompletion({
    model: config.model,
    messages: [
      { role: 'system', content: 'You are a music expert...' },
      { role: 'user', content: prompt },
    ],
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    returnCitations: true,
  });

  const result: AlbumRecommendationsResult = {
    content: response.content,
    citations: response.citations,
  };

  await cache.set('albumRecommendations', [normalizedArtist, normalizedAlbum], result);

  return result;
}
```

### Step 4: Export from Prompts Index

Edit `packages/services/ai/src/prompts/index.ts`:

```typescript
export {
  generateAlbumRecommendations,
  type AlbumRecommendationsResult,
} from './album-recommendations';
```

### Step 5: Add Convenience Method to AIService

Edit `packages/services/ai/src/index.ts`:

```typescript
export class AIService {
  // ... existing methods

  async getAlbumRecommendations(artistName: string, albumName: string) {
    const { generateAlbumRecommendations } = await import('./prompts/album-recommendations');
    const client = this.getClientForTask('albumRecommendations');
    return generateAlbumRecommendations(artistName, albumName, client, this.cache);
  }
}
```

### Step 6: Create Internal API Endpoint

Add to `apps/web/src/api/internal/`:

```typescript
app.get('/album-recommendations', async (c) => {
  const artist = c.req.query('artist');
  const album = c.req.query('album');

  if (!artist || !album) {
    return c.json({ error: 'Missing artist or album parameter' }, 400);
  }

  try {
    const ai = c.get('ai');
    const result = await ai.getAlbumRecommendations(artist, album);
    return c.json({ data: result });
  } catch (error) {
    console.error('Internal album recommendations error:', error);
    return c.json({ error: 'Failed to generate recommendations' }, 500);
  }
});
```

### Step 7: Use with Progressive Loading

In your page component:

```typescript
<div id="album-recommendations">
  <p class="text-muted">Loading recommendations...</p>
</div>
<script dangerouslySetInnerHTML={{ __html: `
  internalFetch('/api/internal/album-recommendations?artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}')
    .then(r => r.json())
    .then(result => {
      if (result.error) {
        document.getElementById('album-recommendations').innerHTML =
          '<p class="text-muted">Recommendations unavailable.</p>';
        return;
      }
      var html = transformCitations(marked.parse(result.data.content), result.data.citations);
      html += renderCitations(result.data.citations);
      document.getElementById('album-recommendations').innerHTML = html;
    })
    .catch(() => {
      document.getElementById('album-recommendations').innerHTML =
        '<p class="text-muted">Failed to load recommendations.</p>';
    });
` }} />
```

**Remember:**
- Pass `internalToken` to Layout for pages using internal APIs
- Use `internalFetch()` (not `fetch()`) for `/api/internal/*` calls
- AI results use markdown; use `marked.parse()` client-side
- Use `transformCitations()` and `renderCitations()` for citation handling

---

## Environment Variables

Required in `apps/web/wrangler.toml` (secrets):

| Variable | Purpose |
|----------|--------|
| `OPENAI_API_KEY` | GPT models, image generation, web search |
| `INTERNAL_API_SECRET` | Signing internal API tokens |

---

## Migration Guides

### From GPT-5.1 to GPT-5.2

GPT-5.2 is designed as a drop-in replacement for GPT-5.1:

```typescript
// Before
model: 'gpt-5.1',

// After
model: 'gpt-5.2',
```

Key differences:
- GPT-5.2 adds `xhigh` reasoning effort level
- Both default to reasoning effort `none`
- GPT-5.2 has a smaller context window (400K vs 1M) but higher output quality
- `temperature`/`top_p`/`logprobs` still only work at reasoning `none`

### From GPT-5.1 to GPT-5.2 (per OpenAI guidance)

| Current Model | Replacement | Starting Config |
|---------------|-------------|-----------------|
| `gpt-5.1` | `gpt-5.2` | Drop-in replacement with default settings |
| `gpt-5` (with `medium` reasoning) | `gpt-5.2` | Start with `medium` reasoning, tune down if possible |
| `gpt-4.1` | `gpt-5.2` | Use reasoning `none`, tune prompts |
| `gpt-4.1-mini` | `gpt-5-mini` | Tune prompts |
| `gpt-4.1-nano` | `gpt-5-nano` | Tune prompts |

### From Perplexity to OpenAI

See [PERPLEXITY_TO_OPENAI_MIGRATION.md](../PERPLEXITY_TO_OPENAI_MIGRATION.md) for the complete migration plan.

Quick summary:

1. Update `ai.ts` config:
   ```typescript
   artistSummary: {
     provider: 'openai',            // was 'perplexity'
     model: 'gpt-5-search-api',     // was 'sonar'
     webSearch: true,                // adds web_search_options to Chat Completions
     // ... rest unchanged
   },
   ```

2. Use `gpt-5-search-api` (not `gpt-5.2`) for web search tasks -- GPT-5.x Responses API has unreliable citation annotations
3. The prompt files need no changes -- they use the `ChatClient` abstraction
4. Citation format is compatible (`{ content, citations }`) -- `transformCitations()` and `renderCitations()` work unchanged
5. `shouldUseResponsesApi()` in `openai.ts` routes `gpt-5-search-api` to Chat Completions
