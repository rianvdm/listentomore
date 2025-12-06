// ABOUTME: Reusable error page component for different error states
// ABOUTME: Includes rate-limited variant with retry suggestion

import { Layout } from '../layout';

interface ErrorPageProps {
  title: string;
  message: string;
  suggestion?: string;
  searchUrl?: string;
  searchLabel?: string;
}

export function ErrorPage({ title, message, suggestion, searchUrl, searchLabel }: ErrorPageProps) {
  return (
    <Layout title={title}>
      <div class="text-center" style={{ paddingTop: '4rem' }}>
        <h1>{title}</h1>
        <p class="text-muted">{message}</p>
        {suggestion && <p class="text-muted">{suggestion}</p>}
        {searchUrl && (
          <p class="mt-2">
            <a href={searchUrl} class="button">
              {searchLabel || 'Search'}
            </a>
          </p>
        )}
      </div>
    </Layout>
  );
}

export function RateLimitedPage({ type }: { type: 'album' | 'artist' }) {
  const searchUrl = type === 'album' ? '/album' : '/artist';
  const typeLabel = type === 'album' ? 'Album' : 'Artist';

  return (
    <ErrorPage
      title="Temporarily Unavailable"
      message={`We're experiencing high traffic and can't load this ${type} right now.`}
      suggestion="Please try again in a minute or two."
      searchUrl={searchUrl}
      searchLabel={`Search ${typeLabel}s`}
    />
  );
}
