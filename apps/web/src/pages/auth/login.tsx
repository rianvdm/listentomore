// Login page - prompts user to sign in with Last.fm
// URL: /login

import type { Context } from 'hono';
import { Layout } from '../../components/layout';
import type { Bindings, Variables } from '../../types';

interface LoginPageProps {
  error?: string;
  next?: string;
}

function LoginPage({ error, next }: LoginPageProps) {
  const authUrl = next ? `/auth/lastfm?next=${encodeURIComponent(next)}` : '/auth/lastfm';

  return (
    <Layout
      title="Sign In"
      description="Sign in to ListenToMore with your Last.fm account"
    >
      <div class="text-center" style={{ maxWidth: '400px', margin: '4rem auto', padding: '0 1rem' }}>
        <h1 style={{ marginBottom: '1rem' }}>Sign in to ListenToMore</h1>

        <p class="text-muted" style={{ marginBottom: '2rem' }}>
          Connect your Last.fm account to see your listening stats and get personalized recommendations.
        </p>

        {error && (
          <div
            style={{
              padding: '1rem',
              marginBottom: '1.5rem',
              backgroundColor: 'var(--color-error-bg, #fee)',
              border: '1px solid var(--color-error, #c00)',
              borderRadius: '8px',
              color: 'var(--color-error, #c00)',
            }}
          >
            {error === 'no_token' && 'Authentication was cancelled. Please try again.'}
            {error === 'auth_failed' && 'Authentication failed. Please try again.'}
            {error === 'no_secret' && 'Server configuration error. Please contact support.'}
            {!['no_token', 'auth_failed', 'no_secret'].includes(error) && 'An error occurred. Please try again.'}
          </div>
        )}

        <a
          href={authUrl}
          class="button"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            width: '100%',
            padding: '1rem 1.5rem',
            fontSize: '1.1rem',
          }}
        >
          <span style={{ fontSize: '1.3rem' }}>🎵</span>
          Continue with Last.fm
        </a>

        <p class="text-muted" style={{ marginTop: '2rem', fontSize: '0.85rem' }}>
          By signing in, you agree to our{' '}
          <a href="/terms">Terms of Service</a> and{' '}
          <a href="/privacy">Privacy Policy</a>.
        </p>

        <p class="text-muted" style={{ marginTop: '1.5rem', fontSize: '0.85rem' }}>
          Don't have a Last.fm account?{' '}
          <a href="https://www.last.fm/join" target="_blank" rel="noopener noreferrer">
            Create one for free
          </a>
        </p>
      </div>
    </Layout>
  );
}

export function handleLogin(c: Context<{ Bindings: Bindings; Variables: Variables }>) {
  const currentUser = c.get('currentUser');

  // If already logged in, redirect to profile
  if (currentUser) {
    return c.redirect(`/u/${currentUser.username}`);
  }

  const error = c.req.query('error');
  const next = c.req.query('next');

  return c.html(<LoginPage error={error} next={next} />);
}
