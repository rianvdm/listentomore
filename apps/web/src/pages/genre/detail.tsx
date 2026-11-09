// ABOUTME: Genre detail page: the AI-written genre summary loads progressively for signed-in users.
// ABOUTME: With PUBLIC_CACHED_SUMMARIES on, a cached summary is server-rendered for every visitor.

import type { Context } from 'hono';
import type { AIService } from '@listentomore/ai';
import type { User } from '@listentomore/db';
import { Layout } from '../../components/layout';
import { AiSummaryLabel, SignInCTA, SignInGate } from '../../components/ui';
import { isCuratedGenre, slugToDisplayName } from '../../data/genres';
import { aiContentClientScript, enrichLinksScript } from '../../utils/client-scripts';
import { loadPublicSummary, publicSummariesEnabled } from '../../utils/public-summaries';

interface GenreDetailProps {
  displayName: string;
  slug: string;
  internalToken?: string;
  currentUser?: User | null;
  // Sanitised HTML from the cached AI summary; null when the flag is off, the cache misses, or the reply is a fallback.
  summaryHtml?: string | null;
  // PUBLIC_CACHED_SUMMARIES is on; the client script labels a summary it fetches only then.
  publicSummaries?: boolean;
}

// Server-rendered cached summary when present, otherwise the placeholder the client script replaces.
function GenreSummarySection({ html }: { html?: string | null }) {
  return (
    <section class="ai-summary" id="genre-summary">
      {html ? (
        <>
          <AiSummaryLabel />
          <div dangerouslySetInnerHTML={{ __html: html }} />
        </>
      ) : (
        <div class="loading-container">
          <span class="spinner">↻</span>
          <span class="loading-text">Generating summary...</span>
        </div>
      )}
    </section>
  );
}

export function GenreDetailPage({
  displayName,
  slug,
  internalToken,
  currentUser,
  summaryHtml,
  publicSummaries = false,
}: GenreDetailProps) {
  const currentPath = `/genre/${slug}`;
  const summaryRendered = Boolean(summaryHtml);

  return (
    <Layout
      title={displayName}
      description={`Learn about the history, musical elements, and seminal albums of ${displayName} music`}
      url={`https://listentomore.com/genre/${slug}`}
      noindex={!isCuratedGenre(slug)}
      internalToken={internalToken}
      currentUser={currentUser}
    >
      <header>
        <h1>{displayName}</h1>
      </header>

      <main>
        {/* AI Summary: cached content is public; generating it needs a login */}
        {!currentUser && summaryRendered ? (
          <>
            <GenreSummarySection html={summaryHtml} />
            <SignInCTA currentPath={currentPath} variant="personal" />
          </>
        ) : (
          <SignInGate currentUser={currentUser ?? null} currentPath={currentPath}>
            <GenreSummarySection html={summaryHtml} />
          </SignInGate>
        )}

        {/* Back Link */}
        <section class="text-center" style={{ marginTop: '2em' }}>
          <p>
            <a href="/genre" class="text-muted">← Browse all genres</a>
          </p>
        </section>
      </main>

      {/* Progressive loading script */}
      <script dangerouslySetInnerHTML={{ __html: `
        ${enrichLinksScript}
        ${aiContentClientScript(publicSummaries)}

        window.__AI_SUMMARY_RENDERED__ = ${summaryRendered};

        (function() {
          // A server-rendered summary, shown to any visitor, only needs its search links enriched
          if (window.__AI_SUMMARY_RENDERED__) {
            enrichLinks('genre-summary');
            return;
          }

          // Generating a summary needs a login, so logged-out visitors fetch nothing
          if (!window.__IS_AUTHENTICATED__) return;

          var genreName = ${JSON.stringify(displayName)};

          // Fetch genre summary
          internalFetch('/api/internal/genre-summary?name=' + encodeURIComponent(genreName), { cache: 'no-store' })
            .then(function(r) {
              if (!r.ok) throw new Error('HTTP ' + r.status);
              return r.json();
            })
            .then(function(data) {
              if (data.error) throw new Error(data.error);
              var summary = data.data;
              var content = summary.content || summary.text || '';

              // The model's "no information" reply is not a summary, so it gets no label
              if (isAiFallback(content)) {
                document.getElementById('genre-summary').innerHTML = '<p class="text-muted">Summary not available for this genre.</p>';
                return;
              }

              var html = aiSummaryLabel + marked.parse(content);

              document.getElementById('genre-summary').innerHTML = html;

              // Enrich links: artist/album search links -> direct Spotify links
              enrichLinks('genre-summary');
            })
            .catch(function(e) {
              console.error('Genre summary error:', e, 'Genre:', genreName);
              var msg = e.message || 'Please try again later.';
              document.getElementById('genre-summary').innerHTML = '<p class="text-muted">Unable to load genre information for "' + genreName + '". ' + msg + '</p>';
            });
        })();
      ` }} />
    </Layout>
  );
}

// Route handler: the cached AI summary when public summaries are on (never a model call); otherwise loaded via JS
export async function handleGenreDetail(c: Context) {
  const slug = c.req.param('slug');
  const displayName = slugToDisplayName(slug);
  const internalToken = c.get('internalToken') as string;
  const currentUser = c.get('currentUser') as User | null;

  // The client sends the display name to the generator, so that is the key it wrote.
  const publicSummaries = publicSummariesEnabled(c.env);
  let summaryHtml: string | null = null;
  if (publicSummaries) {
    const ai = c.get('ai') as AIService;
    summaryHtml = await loadPublicSummary(() => ai.getCachedGenreSummary(displayName), 'genre');
  }

  return c.html(
    <GenreDetailPage
      displayName={displayName}
      slug={slug}
      internalToken={internalToken}
      currentUser={currentUser}
      summaryHtml={summaryHtml}
      publicSummaries={publicSummaries}
    />
  );
}
