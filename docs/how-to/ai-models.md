# AI Models Configuration Guide

This guide covers how to configure AI tasks, switch between providers, and use OpenAI models with features like web search and reasoning.

## Overview

ListenToMore uses two AI providers:

| Provider | Best For | Models |
|----------|----------|--------|
| **Perplexity** | Web-grounded responses with citations (artist info, album details, genres) | `sonar` |
| **OpenAI** | Creative tasks, reasoning, web search, coding | `gpt-5.2`, `gpt-5-mini`, `gpt-5-nano`, `gpt-4.1` |

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

### Choosing a Model for ListenToMore Tasks

| Use Case | Recommended Model | Why |
|----------|-------------------|-----|
| Web-grounded summaries (artist, album, genre) | `gpt-5-mini` + `webSearch: true` | Good quality at 7x lower cost than gpt-5.2 |
| Short descriptions (artist sentence) | `gpt-5-nano` + `webSearch: true` | Fastest, cheapest for simple lookups |
| Complex AI chat (ListenAI) | `gpt-5.2` | Best reasoning for conversational AI |
| User insights analysis | `gpt-5.2` | Complex multi-step analysis of listening data |
| Random facts, simple generation | `gpt-5-mini` | No web search needed, cost-effective |
| Image generation prompts | `gpt-5-nano` | Simple creative task |

---

## Switching Providers for a Task

To change which provider/model a task uses, edit `AI_TASKS` in `packages/config/src/ai.ts`:

```typescript
export const AI_TASKS = {
  artistSummary: {
    provider: 'perplexity',  // Change to 'openai' to switch
    model: 'sonar',          // Update model accordingly
    maxTokens: 1000,
    temperature: 0.5,
    cacheTtlDays: 180,
  },
  // ...
};
```

### Example: Switch artistSummary to OpenAI with Web Search

```typescript
artistSummary: {
  provider: 'openai',
  model: 'gpt-5-mini',       // or 'gpt-5.2' for best quality
  maxTokens: 1000,
  temperature: 0.5,           // Only works when reasoning is not set
  cacheTtlDays: 180,
  webSearch: true,             // Enable web search (Responses API)
  // Optional OpenAI-specific options:
  // reasoning: 'low',         // 'none' | 'low' | 'medium' | 'high' | 'xhigh'
  // verbosity: 'medium',      // 'low' | 'medium' | 'high'
},
```

### Provider Comparison

| Feature | Perplexity | OpenAI (Chat Completions) | OpenAI (Responses API) |
|---------|------------|---------------------------|------------------------|
| Web search | Always on | Via `gpt-5-search-api` model | Via `web_search` tool |
| Citations | Built-in (`return_citations`) | Via annotations | Via annotations |
| Domain filtering | N/A | N/A | `filters.allowed_domains` |
| Reasoning control | N/A | `reasoning_effort` param | `reasoning.effort` param |
| Verbosity control | N/A | `verbosity` param | `text.verbosity` param |
| Temperature | Yes | Yes (some models) | Only when reasoning is `none` |

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

GPT-5.2 (and other GPT-5 family models) support web search via the **Responses API** using the `web_search` tool.

To enable, add `webSearch: true` to the task config:

```typescript
artistSummary: {
  provider: 'openai',
  model: 'gpt-5-mini',
  webSearch: true,        // Enables web_search tool
  maxTokens: 1000,
  cacheTtlDays: 180,
},
```

The OpenAI client will automatically:
1. Use the Responses API instead of Chat Completions
2. Include the `web_search` tool in the request
3. Parse citations from response annotations
4. Normalize citation format to match Perplexity's `{ content, citations }` output

**Web search limitations:**
- Not supported with `gpt-5` at `minimal` reasoning, or with `gpt-4.1-nano`
- Limited to 128K context window (even with models that have larger windows)
- Incurs additional cost: $10.00 per 1K search calls + search content tokens at model rates

**Web search features (Responses API only):**
- **Domain filtering:** Restrict results to specific domains via `filters.allowed_domains`
- **User location:** Refine results by geography (country, city, region, timezone)
- **Sources:** View all URLs consulted via the `sources` field (superset of citations)

### API Selection Logic

Our `OpenAIClient` automatically routes requests to the appropriate API:

| Condition | API Used |
|-----------|----------|
| `webSearch: true` or GPT-5.x model | Responses API (`POST /v1/responses`) |
| GPT-4.x model without web search | Chat Completions API (`POST /v1/chat/completions`) |

The Responses API provides better performance with GPT-5 models because it can pass chain-of-thought (CoT) between turns, leading to fewer generated reasoning tokens and higher cache hit rates.

---

## Adding a New AI Task

Follow these steps to add a new AI-powered feature.

### Step 1: Add Task Config

Edit `packages/config/src/ai.ts`:

```typescript
export const AI_TASKS = {
  // ... existing tasks

  albumRecommendations: {
    provider: 'perplexity',  // or 'openai'
    model: 'sonar',
    maxTokens: 1000,
    temperature: 0.5,
    cacheTtlDays: 30,
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
|----------|---------|
| `OPENAI_API_KEY` | GPT models, image generation, web search |
| `PERPLEXITY_API_KEY` | Web-grounded responses (sonar) |
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
     provider: 'openai',      // was 'perplexity'
     model: 'gpt-5-mini',     // was 'sonar'
     webSearch: true,          // replaces Perplexity's built-in search
     // ... rest unchanged
   },
   ```

2. The prompt files need no changes if using the `ChatClient` abstraction
3. Citation format is compatible between providers (both normalize to `{ content, citations }`)
4. No frontend changes needed -- `transformCitations()` and `renderCitations()` work with both
