// Genre detail page component
// Shows genre info with AI-generated summary

import type { Context } from 'hono';
import { Layout } from '../../components/layout';
import type { AIService } from '@listentomore/ai';

interface GenreDetailProps {
  genre: string;
  displayName: string;
  summary?: {
    text: string;
    citations?: string[];
  };
  error?: string;
}

// Convert slug to display name
function slugToDisplayName(slug: string): string {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function GenreDetailPage({ genre, displayName, summary, error }: GenreDetailProps) {
  if (error) {
    return (
      <Layout title="Genre Not Found">
        <div class="text-center" style={{ paddingTop: '4rem' }}>
          <h1>Genre Not Found</h1>
          <p class="text-muted">{error}</p>
          <p class="mt-2">
            <a href="/" class="button">Go Home</a>
          </p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={displayName} description={`Learn about ${displayName} music`}>
      <div class="text-center mb-4">
        <h1>{displayName}</h1>
      </div>

      {/* AI Summary */}
      {summary?.text && (
        <div class="section">
          <div class="card">
            <p>{summary.text}</p>
            {summary.citations && summary.citations.length > 0 && (
              <div class="mt-2">
                <p class="text-muted footnote">Sources:</p>
                <ul style={{ fontSize: '12px', opacity: 0.7, margin: 0, paddingLeft: '1.5rem' }}>
                  {summary.citations.map((citation, i) => (
                    <li key={i}>
                      <a href={citation} target="_blank" rel="noopener noreferrer">
                        {new URL(citation).hostname}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Search for artists in this genre */}
      <div class="section text-center">
        <p>
          <a href={`/artist?q=${encodeURIComponent(displayName)}`} class="button">
            Find {displayName} Artists
          </a>
        </p>
        <p class="mt-2">
          <a href={`/album?q=${encodeURIComponent(displayName)}`} class="button button--secondary">
            Find {displayName} Albums
          </a>
        </p>
      </div>
    </Layout>
  );
}

// Route handler
export async function handleGenreDetail(c: Context) {
  const slug = c.req.param('slug');
  const displayName = slugToDisplayName(slug);

  const ai = c.get('ai') as AIService;

  try {
    const summary = await ai.getGenreSummary(displayName);

    return c.html(
      <GenreDetailPage
        genre={slug}
        displayName={displayName}
        summary={summary ? { text: summary.text, citations: summary.citations } : undefined}
      />
    );
  } catch (error) {
    console.error('Genre detail error:', error);
    return c.html(
      <GenreDetailPage
        genre={slug}
        displayName={displayName}
        error="Failed to load genre information"
      />
    );
  }
}
