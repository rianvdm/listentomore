# AI Provider Abstraction Plan

> **Status**: ALL PHASES COMPLETE - One-line provider switching now available!
>
> **Goal**: Enable switching AI providers (Perplexity ↔ OpenAI) for any task with a one-line config change in `packages/config/src/ai.ts`.
>
> **Related docs**:
> - `docs/gpt-docs.md` - OpenAI GPT-5.1 features (reasoning, verbosity, web search)
> - `docs/gpt-reasoning-migration.md` - OpenAI Responses API migration guide
> - `docs/how-to/ai-models.md` - User-facing guide for AI configuration
>
> **Files modified**:
> - `packages/services/ai/src/types.ts` - Common `ChatClient` interface
> - `packages/services/ai/src/openai.ts` - Responses API support, implements `ChatClient`
> - `packages/services/ai/src/perplexity.ts` - Implements `ChatClient`
> - `packages/services/ai/src/index.ts` - `getClientForTask()` routing, exports types
> - `packages/config/src/ai.ts` - Added `reasoning`, `verbosity`, `webSearch` optional fields to `AITaskConfig`
> - `packages/services/ai/src/prompts/*.ts` - All prompt files use `ChatClient` interface and pass config options

---

## Current Implementation Status

### What's Live (as of 2025-12-07)

**Full Provider Abstraction Complete:**
- All AI tasks can be switched between providers with a one-line config change in `ai.ts`
- `AIService.getClientForTask()` routes to the correct client based on config
- All prompt files use the generic `ChatClient` interface
- GPT-5.1 options (`reasoning`, `verbosity`, `webSearch`) configurable per task

**Provider routing:**
- `artistSummary` → Perplexity (configurable)
- `albumDetail` → Perplexity (configurable)
- `genreSummary` → Perplexity (configurable)
- `artistSentence` → Perplexity (configurable)
- `albumRecommendations` → Perplexity (configurable)
- `listenAi` → OpenAI (configurable)
- `randomFact` → OpenAI only (uses KV storage)
- `playlistCoverPrompt` → OpenAI only (image generation)

**How to switch a task's provider:**
```typescript
// In packages/config/src/ai.ts
export const AI_TASKS = {
  artistSummary: {
    provider: 'openai',  // Changed from 'perplexity'
    model: 'gpt-5-mini',
    maxTokens: 1000,
    temperature: 0.5,
    cacheTtlDays: 180,
    webSearch: true,     // Enable OpenAI web search
  },
  // ...
};
```

**Now configurable per task:**
- `reasoning?: 'minimal' | 'low' | 'medium' | 'high'` - GPT-5.1 reasoning effort
- `verbosity?: 'low' | 'medium' | 'high'` - GPT-5.1 output verbosity
- `webSearch?: boolean` - Enable OpenAI web search (Responses API)

### Implementation Notes

**Key discovery during implementation:**
- The `output_text` helper in Responses API can be `null` even when content exists
- Content must be extracted from `output[].content[].text` as fallback
- The `parseResponsesResult()` method handles both cases

**Routing logic in `OpenAIClient.shouldUseResponsesApi()`:**
```typescript
const isGpt5 = model.startsWith('gpt-5');
const hasResponsesFeatures = Boolean(options.webSearch || options.reasoning || options.verbosity);
return isGpt5 || hasResponsesFeatures;
```

---

This document outlines the changes needed to:
1. Migrate OpenAI from Chat Completions API to Responses API
2. Create an abstraction layer enabling one-line provider switching via `ai.ts` config

---

## Current State

### Architecture

```
ai.ts (config)           → Defines provider/model per task
    ↓
AIService                → Hardcodes which client to call per method
    ↓
Prompt files             → Hardcode client type in function signature
    ↓
OpenAIClient             → Uses Chat Completions API
PerplexityClient         → Uses Chat Completions API
```

### Problems

1. **Three places to change** when switching providers:
   - `packages/config/src/ai.ts` - config
   - `packages/services/ai/src/index.ts` - AIService method
   - `packages/services/ai/src/prompts/*.ts` - prompt file

2. **OpenAI Chat Completions limitations**:
   - No web search support for GPT-4.1/5.1
   - No reasoning effort control
   - No verbosity control
   - No chain-of-thought passing between turns

3. **Incompatible client interfaces**:
   - `OpenAIClient.chatCompletion()` and `PerplexityClient.chatCompletion()` have similar but not identical signatures
   - No shared interface

---

## Target State

### Architecture

```
ai.ts (config)           → Defines provider/model/options per task (SINGLE SOURCE OF TRUTH)
    ↓
AIService                → Reads config, routes to correct client automatically
    ↓
Prompt files             → Use generic ChatClient interface
    ↓
OpenAIClient             → Uses Responses API (with fallback to Chat Completions)
PerplexityClient         → Uses Chat Completions API (unchanged)
```

### Benefits

- **One-line provider switch**: Change `provider` in `ai.ts`, everything else adapts
- **GPT-5.1 features**: Web search, reasoning effort, verbosity
- **Type safety**: Single interface ensures compatibility
- **Future-proof**: Easy to add new providers (Claude, Gemini, etc.)

---

## Phase 1: OpenAI Responses API Migration

### Key Differences from Chat Completions

From OpenAI's migration guide (`docs/gpt-reasoning-migration.md`):

| Feature | Chat Completions | Responses API |
|---------|------------------|---------------|
| Endpoint | `/v1/chat/completions` | `/v1/responses` |
| Input format | `messages: [...]` array | `input` (string or array) + `instructions` |
| Output access | `choices[0].message.content` | `output_text` helper |
| Output structure | `choices` array | `output` array of typed Items |
| Storage | Stored by default (new accounts) | Stored by default (`store: false` to disable) |
| Multi-turn | Manual context management | `previous_response_id` for chaining |
| Web search | Not available | `tools: [{ type: 'web_search' }]` |
| Structured output | `response_format` | `text.format` |

### Response Structure

```json
{
  "id": "resp_...",
  "output_text": "The response text...",
  "output": [
    { "type": "reasoning", "content": [], "summary": [] },
    { "type": "web_search_call", "id": "...", "status": "completed" },
    {
      "type": "message",
      "status": "completed",
      "content": [
        {
          "type": "output_text",
          "text": "The response text...",
          "annotations": [
            { "type": "url_citation", "url": "https://...", "title": "..." }
          ]
        }
      ]
    }
  ]
}
```

### 1.1 Update OpenAIClient

**File**: `packages/services/ai/src/openai.ts`

Add a new method for Responses API alongside existing Chat Completions:

```typescript
export interface ResponsesOptions {
  model: string;
  /** User input - can be string or messages array */
  input: string | Array<{ role: string; content: string }>;
  /** System-level instructions (replaces system message) */
  instructions?: string;
  reasoning?: { effort: 'minimal' | 'low' | 'medium' | 'high' };
  text?: { verbosity: 'low' | 'medium' | 'high' };
  tools?: Array<{ type: 'web_search' }>;
  maxOutputTokens?: number;
  temperature?: number;  // Only works when reasoning is not enabled
  /** Disable storage for ZDR compliance */
  store?: boolean;
}

export interface ResponsesResult {
  content: string;
  citations: string[];
}

export class OpenAIClient {
  // Existing method - keep for backwards compatibility
  async chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResponse>;

  // New method for Responses API
  async responses(options: ResponsesOptions): Promise<ResponsesResult> {
    await this.checkRateLimit();

    const body: Record<string, unknown> = {
      model: options.model,
      input: options.input,
      store: options.store ?? false,  // Default to not storing for privacy
    };

    // System instructions (cleaner than system message in array)
    if (options.instructions) {
      body.instructions = options.instructions;
    }

    // Add reasoning if specified (GPT-5.1 feature)
    if (options.reasoning) {
      body.reasoning = options.reasoning;
    }

    // Add verbosity if specified (GPT-5.1 feature)
    if (options.text) {
      body.text = options.text;
    }

    // Add tools (web_search, etc.)
    if (options.tools?.length) {
      body.tools = options.tools;
    }

    // Temperature only works when reasoning is not enabled
    if (options.temperature !== undefined && !options.reasoning) {
      body.temperature = options.temperature;
    }

    if (options.maxOutputTokens) {
      body.max_output_tokens = options.maxOutputTokens;
    }

    const response = await fetchWithTimeout(`${this.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      timeout: 'slow',
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[OpenAI Responses] API error: ${response.status} - ${errorBody}`);
      throw new Error(`OpenAI Responses API error: ${response.statusText}`);
    }

    const data = await response.json();
    return this.parseResponsesResult(data);
  }

  private parseResponsesResult(data: {
    output_text?: string;
    output?: Array<{
      type: string;
      content?: Array<{
        type: string;
        text?: string;
        annotations?: Array<{ type: string; url?: string; title?: string }>;
      }>;
    }>;
  }): ResponsesResult {
    const result: ResponsesResult = {
      content: data.output_text || '',
      citations: [],
    };

    // Extract citations from annotations in message items
    if (data.output) {
      for (const item of data.output) {
        if (item.type === 'message' && item.content) {
          for (const block of item.content) {
            if (block.annotations) {
              for (const annotation of block.annotations) {
                if (annotation.type === 'url_citation' && annotation.url) {
                  result.citations.push(annotation.url);
                }
              }
            }
          }
        }
      }
    }

    return result;
  }
}
```

### 1.2 When to Use Responses API

Per OpenAI: **"Responses is recommended for all new projects."**

Benefits over Chat Completions:
- **Better performance**: 3% improvement on SWE-bench with GPT-5
- **Lower costs**: 40-80% better cache utilization
- **Web search**: Built-in `web_search` tool
- **Reasoning control**: `reasoning.effort` parameter
- **Cleaner API**: `instructions` + `input` separation

Use Chat Completions only for:
- Legacy compatibility with older models
- Specific features not yet in Responses (audio - coming soon)

### 1.3 Model Detection

Determine which API to use based on model:

```typescript
// In OpenAIClient
private shouldUseResponsesApi(model: string, options: ChatCompletionOptions): boolean {
  // Use Responses API for:
  // 1. GPT-5.x models (reasoning support)
  // 2. Any request with webSearch enabled
  // 3. Any request with reasoning/verbosity options

  const isGpt5 = model.startsWith('gpt-5');
  const hasResponsesFeatures = options.webSearch || options.reasoning || options.verbosity;

  return isGpt5 || hasResponsesFeatures;
}
```

### 1.3 Environment Variables

No new variables needed - uses existing `OPENAI_API_KEY`.

---

## Phase 2: Common Client Interface

### 2.1 Create Types File

**File**: `packages/services/ai/src/types.ts`

```typescript
import type { ReasoningEffort, Verbosity } from '@listentomore/config';

/**
 * Common message format for both providers
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Common options for chat completion
 */
export interface ChatCompletionOptions {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;

  // Provider-specific options (ignored if not applicable)
  returnCitations?: boolean;     // Perplexity
  reasoning?: ReasoningEffort;   // OpenAI GPT-5.1
  verbosity?: Verbosity;         // OpenAI GPT-5.1
  webSearch?: boolean;           // OpenAI Responses API
}

/**
 * Common response format
 */
export interface ChatCompletionResponse {
  content: string;
  citations: string[];  // Empty array if none
}

/**
 * Common interface that both clients implement
 */
export interface ChatClient {
  chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResponse>;
}
```

### 2.2 Update OpenAIClient

**File**: `packages/services/ai/src/openai.ts`

```typescript
import type { ChatClient, ChatCompletionOptions, ChatCompletionResponse } from './types';

export class OpenAIClient implements ChatClient {
  async chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResponse> {
    // Determine which API to use
    if (this.shouldUseResponsesApi(options.model, options)) {
      return this.chatCompletionViaResponses(options);
    }
    return this.chatCompletionViaChatCompletions(options);
  }

  private async chatCompletionViaResponses(options: ChatCompletionOptions): Promise<ChatCompletionResponse> {
    // Convert messages to single input string for Responses API
    const input = this.messagesToInput(options.messages);

    const result = await this.responses({
      model: options.model,
      input,
      reasoning: options.reasoning ? { effort: options.reasoning } : undefined,
      text: options.verbosity ? { verbosity: options.verbosity } : undefined,
      tools: options.webSearch ? [{ type: 'web_search' }] : undefined,
      maxOutputTokens: options.maxTokens,
      temperature: options.temperature,
    });

    return {
      content: result.content,
      citations: result.citations || [],
    };
  }

  private async chatCompletionViaChatCompletions(options: ChatCompletionOptions): Promise<ChatCompletionResponse> {
    // Existing Chat Completions implementation
    // ...
  }

  /**
   * Convert messages array to Responses API format.
   * Responses API separates instructions (system) from input (user) at top level.
   */
  private convertMessagesToResponsesFormat(messages: ChatMessage[]): {
    instructions?: string;
    input: string | Array<{ role: string; content: string }>;
  } {
    const systemMsg = messages.find(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');

    // If only one user message, use simple string input
    if (otherMessages.length === 1 && otherMessages[0].role === 'user') {
      return {
        instructions: systemMsg?.content,
        input: otherMessages[0].content,
      };
    }

    // For multi-turn, pass messages array (Responses API accepts both)
    return {
      instructions: systemMsg?.content,
      input: otherMessages,
    };
  }
}
```

### 2.3 Update PerplexityClient

**File**: `packages/services/ai/src/perplexity.ts`

```typescript
import type { ChatClient, ChatCompletionOptions, ChatCompletionResponse } from './types';

export class PerplexityClient implements ChatClient {
  async chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResponse> {
    // Existing implementation, but ensure return type matches interface
    // Perplexity ignores: reasoning, verbosity, webSearch (always has web search)
    // ...
  }
}
```

---

## Phase 3: Update AIService

### 3.1 Add Client Routing

**File**: `packages/services/ai/src/index.ts`

```typescript
import { AI_TASKS, type AITask } from '@listentomore/config';
import type { ChatClient } from './types';

export class AIService {
  public readonly openai: OpenAIClient;
  public readonly perplexity: PerplexityClient;
  public readonly cache: AICache;

  /**
   * Get the appropriate client for a task based on config
   */
  getClientForTask(task: AITask): ChatClient {
    const config = AI_TASKS[task];
    return config.provider === 'openai' ? this.openai : this.perplexity;
  }

  /**
   * Generate album recommendations (provider determined by config)
   */
  async getAlbumRecommendations(artistName: string, albumName: string) {
    const { generateAlbumRecommendations } = await import('./prompts/album-recommendations');
    const client = this.getClientForTask('albumRecommendations');
    return generateAlbumRecommendations(artistName, albumName, client, this.cache);
  }

  // Update ALL other methods similarly...
}
```

### 3.2 Update All Convenience Methods

Each method needs to use `getClientForTask()`:

```typescript
async getArtistSummary(artistName: string) {
  const { generateArtistSummary } = await import('./prompts/artist-summary');
  const client = this.getClientForTask('artistSummary');
  return generateArtistSummary(artistName, client, this.cache);
}

async getAlbumDetail(artistName: string, albumName: string) {
  const { generateAlbumDetail } = await import('./prompts/album-detail');
  const client = this.getClientForTask('albumDetail');
  return generateAlbumDetail(artistName, albumName, client, this.cache);
}

async getGenreSummary(genreName: string) {
  const { generateGenreSummary } = await import('./prompts/genre-summary');
  const client = this.getClientForTask('genreSummary');
  return generateGenreSummary(genreName, client, this.cache);
}

async getArtistSentence(artistName: string) {
  const { generateArtistSentence } = await import('./prompts/artist-sentence');
  const client = this.getClientForTask('artistSentence');
  return generateArtistSentence(artistName, client, this.cache);
}

// Note: Some tasks are OpenAI-only (image generation, random facts with KV)
// These don't need routing
```

---

## Phase 4: Update Prompt Files

### 4.1 Change Client Types

Update each prompt file to use the generic interface:

**Before** (`album-recommendations.ts`):
```typescript
import type { PerplexityClient } from '../perplexity';

export async function generateAlbumRecommendations(
  artistName: string,
  albumName: string,
  client: PerplexityClient,
  cache: AICache
)
```

**After**:
```typescript
import type { ChatClient } from '../types';

export async function generateAlbumRecommendations(
  artistName: string,
  albumName: string,
  client: ChatClient,
  cache: AICache
)
```

### 4.2 Files to Update

| File | Current Client | Change To |
|------|---------------|-----------|
| `artist-summary.ts` | `PerplexityClient` | `ChatClient` |
| `album-detail.ts` | `PerplexityClient` | `ChatClient` |
| `genre-summary.ts` | `PerplexityClient` | `ChatClient` |
| `artist-sentence.ts` | `PerplexityClient` | `ChatClient` |
| `album-recommendations.ts` | `PerplexityClient` | `ChatClient` |
| `listen-ai.ts` | `OpenAIClient` | `ChatClient` |

### 4.3 Files That Stay Provider-Specific

Some tasks require provider-specific features and should NOT use the generic interface:

| File | Reason |
|------|--------|
| `random-fact.ts` | Uses KV storage directly, not a chat completion |
| `playlist-cover.ts` | Uses OpenAI image generation (`generateImage`) |

---

## Phase 5: Pass Config Options Through

### 5.1 Update Prompt Files to Use Config

Prompt files should read their config and pass options:

```typescript
import { AI_TASKS } from '@listentomore/config';
import type { ChatClient, ChatCompletionOptions } from '../types';

export async function generateAlbumRecommendations(
  artistName: string,
  albumName: string,
  client: ChatClient,
  cache: AICache
): Promise<AlbumRecommendationsResult> {
  // ... cache check ...

  const config = AI_TASKS.albumRecommendations;

  const options: ChatCompletionOptions = {
    model: config.model,
    messages: [
      { role: 'system', content: '...' },
      { role: 'user', content: prompt },
    ],
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    returnCitations: true,
    // Pass through GPT-5.1 options if configured
    reasoning: config.reasoning,
    verbosity: config.verbosity,
    webSearch: config.webSearch,
  };

  const response = await client.chatCompletion(options);
  // ...
}
```

---

## Implementation Order

### Step 1: Create Types (Low Risk) ✅ COMPLETE
- [x] Create `packages/services/ai/src/types.ts`
- [x] Export from `packages/services/ai/src/index.ts`
- [x] Run typecheck

### Step 2: Update OpenAIClient (Medium Risk) ✅ COMPLETE
- [x] Add `responses()` method for Responses API
- [x] Implement `shouldUseResponsesApi()` detection
- [x] Update `chatCompletion()` to route appropriately
- [x] Implement `ChatClient` interface
- [x] Test with existing tasks (should be no behavior change)

### Step 3: Update PerplexityClient (Low Risk) ✅ COMPLETE
- [x] Implement `ChatClient` interface
- [x] Ensure return type matches
- [x] Test with existing tasks

### Step 4: Update AIService (Medium Risk) ✅ COMPLETE
- [x] Add `getClientForTask()` method
- [x] Update all convenience methods to use it
- [x] Test all endpoints

### Step 5: Update Config & Prompt Files (Medium Risk) ✅ COMPLETE
- [x] Add `reasoning`, `verbosity`, `webSearch` to `AITaskConfig` in `packages/config/src/ai.ts`
- [x] Update each prompt file to use `ChatClient`
- [x] Update to pass config options through
- [x] Test each endpoint

### Step 6: Verify One-Line Switching (Validation) ✅ COMPLETE
- [x] Architecture supports one-line switching
- [x] Types ensure compile-time safety
- [x] All prompt files use `getTaskConfig()` for full `AITaskConfig` type access

---

## Testing Strategy

### Unit Tests
- Test OpenAI Responses API parsing
- Test client routing in AIService
- Test config option pass-through

### Integration Tests
For each AI task, test:
1. Works with Perplexity (current behavior)
2. Works with OpenAI Chat Completions
3. Works with OpenAI Responses API (GPT-5.1)
4. Web search returns citations (when enabled)

### Manual Smoke Tests
```bash
# Test album recommendations with Perplexity (current)
curl https://listentomore.com/api/internal/album-recommendations?artist=radiohead&album=ok+computer

# After switching to OpenAI in config, same call should work
# (change ai.ts, deploy, test again)
```

---

## Rollback Plan

Each phase can be rolled back independently:

1. **Phase 1-2**: Revert OpenAI client changes, keep using Chat Completions
2. **Phase 3-4**: Revert AIService/prompt changes, hardcode clients again
3. **Full rollback**: `git revert` to pre-migration commit

---

## Future Enhancements

Once this abstraction is in place:

1. **Add Claude provider**: Implement `ChatClient` for Anthropic API
2. **Add Gemini provider**: Implement `ChatClient` for Google AI
3. **A/B testing**: Route percentage of traffic to different providers
4. **Fallback chains**: If OpenAI fails, automatically try Perplexity
5. **Cost tracking**: Log provider usage per task for billing analysis

---

## Summary

| Phase | Risk | Effort | Description |
|-------|------|--------|-------------|
| 1 | Medium | 2-3 hours | OpenAI Responses API support |
| 2 | Low | 1 hour | Common ChatClient interface |
| 3 | Medium | 1 hour | AIService routing |
| 4 | Medium | 2 hours | Update all prompt files |
| 5 | Low | 1 hour | Pass config options through |

**Total estimated effort**: 7-8 hours

**End result**: Switching any AI task between providers is a one-line change in `packages/config/src/ai.ts`.
