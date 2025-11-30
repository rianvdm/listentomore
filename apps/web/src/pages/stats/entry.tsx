// Stats entry page - prompts user to enter Last.fm username
// URL: /stats

import type { Context } from 'hono';
import { Layout } from '../../components/layout';

function StatsEntryPage() {
  return (
    <Layout
      title="My Stats"
      description="View your real-time listening statistics from Last.fm"
    >
      <header>
        <h1>View Your Listening Stats</h1>
      </header>

      <main>
        <section id="lastfm-stats" class="text-center">
          <p style={{ maxWidth: '500px', margin: '0 auto 2rem' }}>
            Enter your Last.fm username to see your real-time listening statistics,
            including recent tracks, top artists, and top albums.
          </p>

          <form action="/stats/lookup" method="get" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
            <input
              type="text"
              name="username"
              placeholder="Your Last.fm username"
              class="input"
              style={{ maxWidth: '300px', width: '100%' }}
              required
            />
            <button type="submit" class="button">
              View Stats
            </button>
          </form>

          <p style={{ marginTop: '2rem', fontSize: '0.9rem' }} class="text-muted">
            Don't have a Last.fm account?{' '}
            <a href="https://www.last.fm/join" target="_blank" rel="noopener noreferrer">
              Create one for free
            </a>{' '}
            and start tracking your listening habits.
          </p>
        </section>
      </main>
    </Layout>
  );
}

// Route handler
export function handleStatsEntry(c: Context) {
  return c.html(<StatsEntryPage />);
}

// Lookup handler - redirects to user stats page
export function handleStatsLookup(c: Context) {
  const username = c.req.query('username')?.trim();

  if (!username) {
    return c.redirect('/stats');
  }

  return c.redirect(`/u/${encodeURIComponent(username)}`);
}
