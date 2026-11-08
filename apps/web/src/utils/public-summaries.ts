// ABOUTME: Server-side rendering of cached AI summaries for logged-out visitors, behind a feature flag.
// ABOUTME: Refuses empty, non-string and "not enough information" replies so they are never published.

import { marked } from 'marked';

const NOT_ENOUGH_INFORMATION = 'Not enough information available';

/** True only when the PUBLIC_CACHED_SUMMARIES var is exactly the string 'true'. */
export function publicSummariesEnabled(env: { PUBLIC_CACHED_SUMMARIES?: string } | undefined): boolean {
  return env?.PUBLIC_CACHED_SUMMARIES === 'true';
}

/**
 * Renders a cached Markdown summary to HTML with marked's defaults, matching the client's marked.parse.
 * Returns null when there is nothing worth publishing. Cached values come from KV JSON without a
 * runtime type check, so non-string input is refused too.
 */
export function renderPublicSummary(markdown: string | null): string | null {
  if (typeof markdown !== 'string') return null;
  if (markdown.trim() === '' || markdown.includes(NOT_ENOUGH_INFORMATION)) return null;
  return marked.parse(markdown, { async: false });
}
