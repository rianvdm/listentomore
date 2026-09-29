// ABOUTME: 404 page shared by the app-wide notFound handler and detail routes.
// ABOUTME: Detail routes use it for IDs that can't be valid Spotify IDs (legacy slug URLs).

import { Layout } from '../layout';

export function NotFoundPage() {
  return (
    <Layout title="Page Not Found">
      <div class="text-center" style={{ paddingTop: '4rem' }}>
        <h1 style={{ fontSize: '4rem', marginBottom: '0.5rem' }}>404</h1>
        <p>The page you're looking for doesn't exist.</p>
        <p class="mt-2">
          <a href="/" class="button">
            Go Home
          </a>
        </p>
      </div>
    </Layout>
  );
}
