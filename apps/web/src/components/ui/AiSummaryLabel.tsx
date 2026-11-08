// ABOUTME: Small label shown above an AI-written summary on public album, artist and genre pages.
// ABOUTME: Links to the About page section that explains how the site and its summaries are built.

export function AiSummaryLabel() {
  return (
    <p class="ai-summary-label text-muted">
      <a href="/about#how-its-built">AI-written summary</a>
    </p>
  );
}
