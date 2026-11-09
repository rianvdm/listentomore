// ABOUTME: Small label shown above an AI-written summary on public album, artist and genre pages.
// ABOUTME: Links to the About page section that explains how the site and its summaries are built.

import { raw } from 'hono/html';

// One source for the server component and the client scripts that insert a fetched summary.
export const AI_SUMMARY_LABEL_HTML =
  '<p class="ai-summary-label text-muted"><a href="/about#how-its-built">AI-written summary</a></p>';

export function AiSummaryLabel() {
  return raw(AI_SUMMARY_LABEL_HTML);
}
