# AI Models Configuration Guide

This guide covers how to configure AI tasks, switch between providers, and use the latest OpenAI models with features like web search.

## Overview

ListenToMore uses two AI providers:

| Provider | Best For | Models |
|----------|----------|--------|
| **Perplexity** | Web-grounded responses with citations (artist info, album details, genres) | `sonar` |
| **OpenAI** | Creative tasks, reasoning, coding | `gpt-5.1`, `gpt-5-mini`, `gpt-5-nano`, `gpt-4.1` |

All AI configuration lives in `packages/config/src/ai.ts`.

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
  model: 'gpt-5.1',
  maxTokens: 1000,
  temperature: 0.5,        // Only works with reasoning: 'none'
  cacheTtlDays: 180,
  // OpenAI-specific options (see GPT-5.1 section below)
  reasoning: 'none',       // 'none' | 'low' | 'medium' | 'high'
  verbosity: 'medium',     // 'low' | 'medium' | 'high'
  webSearch: true,         // Enable web search (Responses API only)
},
```

### Provider Comparison

| Feature | Perplexity | OpenAI (Chat Completions) | OpenAI (Responses API) |
|---------|------------|---------------------------|------------------------|
| Web search | Always on | Not available | Via `web_search` tool |
| Citations | Built-in | Via annotations | Via annotations |
| Reasoning control | N/A | N/A | `reasoning.effort` |
| Verbosity control | N/A | N/A | `text.verbosity` |
| Temperature | Yes | Yes (some models) | Only with `reasoning: 'none'` |

---

## GPT-5.1 Configuration

GPT-5.1 is OpenAI's latest flagship model with configurable reasoning and web search capabilities.

### Model Variants

| Model | Best For | Notes |
|-------|----------|-------|
| `gpt-5.1` | Complex reasoning, broad world knowledge | Default reasoning: `none` |
| `gpt-5.1-codex-max` | Agentic coding tasks | Supports `xhigh` reasoning |
| `gpt-5-mini` | Cost-optimized reasoning and chat | Balanced speed/capability |
| `gpt-5-nano` | High-throughput, simple tasks | Classification, extraction |
| `gpt-4.1` | Non-reasoning, large context (1M tokens) | No reasoning overhead |

### Reasoning Effort

Controls how many reasoning tokens the model generates before responding:

| Setting | Use Case | Latency |
|---------|----------|---------|
| `none` | Low-latency interactions (default for 5.1) | Fastest |
| `low` | Light reasoning | Fast |
| `medium` | Standard reasoning | Moderate |
| `high` | Complex multi-step planning | Slowest |

**Important:** `temperature`, `top_p`, and `logprobs` only work when `reasoning: 'none'`.

```typescript
// For latency-sensitive tasks
albumDetail: {
  provider: 'openai',
  model: 'gpt-5.1',
  reasoning: 'none',      // Skip reasoning for speed
  verbosity: 'medium',
  maxTokens: 1000,
  cacheTtlDays: 120,
},

// For complex analysis
listenAi: {
  provider: 'openai',
  model: 'gpt-5.1',
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
| `high` | Thorough explanations, verbose code |

### Web Search

GPT-5.1 supports web search via the **Responses API** (not Chat Completions).

To enable, add `webSearch: true` to the task config:

```typescript
artistSummary: {
  provider: 'openai',
  model: 'gpt-5.1',
  webSearch: true,        // Enables web_search tool
  reasoning: 'none',
  maxTokens: 1000,
  cacheTtlDays: 180,
},
```

The OpenAI client will automatically:
1. Use the Responses API instead of Chat Completions
2. Include the `web_search` tool
3. Parse citations from response annotations

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
import type { PerplexityClient } from '../perplexity';
import type { AICache } from '../cache';

export interface AlbumRecommendationsResult {
  content: string;
  citations: string[];
}

export async function generateAlbumRecommendations(
  artistName: string,
  albumName: string,
  client: PerplexityClient,
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
    return generateAlbumRecommendations(artistName, albumName, this.perplexity, this.cache);
  }
}
```

### Step 6: Create Internal API Endpoint

Edit `apps/web/src/index.tsx`:

```typescript
app.get('/api/internal/album-recommendations', async (c) => {
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
      var html = marked.parse(result.data.content);
      result.data.citations.forEach((url, i) => {
        html = html.replace(
          new RegExp('\\\\[' + (i+1) + '\\\\]', 'g'),
          '<sup><a href="' + url + '" target="_blank">[' + (i+1) + ']</a></sup>'
        );
      });
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

---

## Environment Variables

Required in `apps/web/wrangler.toml` (secrets):

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | GPT models, image generation |
| `PERPLEXITY_API_KEY` | Web-grounded responses |
| `INTERNAL_API_SECRET` | Signing internal API tokens |

---

## Migration Guide

### From Perplexity to OpenAI GPT-5.1

1. Update `ai.ts` config:
   ```typescript
   artistSummary: {
     provider: 'openai',      // was 'perplexity'
     model: 'gpt-5.1',        // was 'sonar'
     webSearch: true,         // replaces Perplexity's built-in search
     reasoning: 'none',       // for speed
     // ... rest unchanged
   },
   ```

2. The prompt file needs no changes if using the AIService abstraction
3. Citations format is compatible between providers

### From GPT-4.1 to GPT-5.1

Per OpenAI's guidance: use `gpt-5.1` with `reasoning: 'none'` as a drop-in replacement with improved intelligence.

```typescript
// Before
model: 'gpt-4.1',

// After
model: 'gpt-5.1',
reasoning: 'none',  // Matches gpt-4.1 behavior
```
