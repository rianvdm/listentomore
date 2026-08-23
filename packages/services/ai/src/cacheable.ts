// ABOUTME: Decides whether an AI response is fit to store in the KV cache.
// ABOUTME: Rejects budget-truncated fragments and empty bodies before they stick.

import type { AITask } from '@listentomore/config';
import type { AIResponseMetadata } from './types';

/**
 * Should this response be written to the AI cache?
 *
 * Cache TTLs here run 1-180 days, so a bad response is not a bad page view —
 * it is a bad page for months. Two failures are worth spending a cache miss to
 * avoid, and both arrive as an HTTP 200:
 *
 *  - **Truncated.** The model ran out of output budget mid-sentence. On
 *    GPT-5.x this is usually reasoning tokens eating the budget, so the prose
 *    can be far shorter than `maxTokens` and still be cut off. See the
 *    `maxTokens` note in packages/config/src/ai.ts.
 *  - **Empty.** Budget exhausted before any prose was emitted at all, which
 *    yields `content: ''` and would render as a blank section.
 *
 * Callers that skip the write simply regenerate on the next request. That is
 * the right trade: these tasks are cheap, and the alternative is a fragment
 * pinned in KV for the full TTL.
 *
 * @param content  The text extracted from the response.
 * @param metadata Response metadata from the client (may be undefined in tests).
 * @param task     Task name, for the log line.
 * @param params   Cache key params, for the log line.
 */
export function isCacheableResponse(
  content: string,
  metadata: AIResponseMetadata | undefined,
  task: AITask,
  ...params: string[]
): boolean {
  const label = `${task}:${params.join(':')}`;

  if (metadata?.truncated) {
    console.warn(
      `[AICache] Refusing to cache truncated ${label} ` +
      `(${content.length} chars, ${metadata.usage?.reasoningTokens ?? '?'} reasoning tokens). ` +
      `Will regenerate on next request.`
    );
    return false;
  }

  if (content.trim().length === 0) {
    console.warn(`[AICache] Refusing to cache empty response for ${label}.`);
    return false;
  }

  return true;
}
