// Genre detail page component
// Shows genre info with AI-generated summary, progressively loaded

import type { Context } from 'hono';
import { Layout } from '../../components/layout';
import { slugToDisplayName } from '../../data/genres';
import { formatMarkdownScript, enrichLinksScript, renderCitationsScript } from '../../utils/client-scripts';

interface GenreDetailProps {
  displayName: string;
}

export function GenreDetailPage({ displayName }: GenreDetailProps) {
  return (
    <Layout
      title={displayName}
      description={`Learn about the history, musical elements, and seminal albums of ${displayName} music`}
    >
      <header>
        <h1>{displayName}</h1>
      </header>

      <main>
        {/* AI Summary - loaded via JS */}
        <section class="ai-summary" id="genre-summary">
          <div class="loading-container">
            <span class="spinner">↻</span>
            <span class="loading-text">Generating summary...</span>
          </div>
        </section>

        {/* Back Link */}
        <section class="text-center" style={{ marginTop: '2em' }}>
          <p>
            <a href="/genre" class="text-muted">← Browse all genres</a>
          </p>
        </section>
      </main>

      {/* Progressive loading script */}
      <script dangerouslySetInnerHTML={{ __html: `
        ${formatMarkdownScript}
        ${enrichLinksScript}
        ${renderCitationsScript}

        (function() {
          var genreName = ${JSON.stringify(displayName)};

          // Fetch genre summary
          fetch('/api/internal/genre-summary?name=' + encodeURIComponent(genreName), { cache: 'no-store' })
            .then(function(r) {
              if (!r.ok) throw new Error('HTTP ' + r.status);
              return r.json();
            })
            .then(function(data) {
              if (data.error) throw new Error(data.error);
              var summary = data.data;
              var content = summary.content || summary.text || '';

              // Format markdown and add citations
              var html = formatMarkdown(content);
              html += renderCitations(summary.citations);

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

// Route handler - fast initial render, AI summary loaded via JS
export async function handleGenreDetail(c: Context) {
  const slug = c.req.param('slug');
  const displayName = slugToDisplayName(slug);

  return c.html(
    <GenreDetailPage displayName={displayName} />
  );
}
