// Account page - sign up or manage connected services
// For new users: shows sign-up options (Discogs OAuth)
// For existing users: shows connected services management

import type { Context } from 'hono';
import type { Bindings, Variables } from '../../types';
import { Layout } from '../../components/layout';

interface AccountPageProps {
  internalToken: string;
  error?: string;
  success?: string;
}

function AccountPage({ internalToken, error, success }: AccountPageProps) {
  return (
    <Layout
      title="Create Your Profile"
      description="Sign up for ListenToMore by connecting your music services"
      internalToken={internalToken}
    >
      <header>
        <h1>Create Your Profile</h1>
      </header>

      <main>
        {error && (
          <div class="alert alert-error" style={{ marginBottom: '1.5rem' }}>
            {error === 'username_taken' && 'That username is already taken. Please try a different Discogs account.'}
            {error === 'oauth_failed' && 'Failed to connect to Discogs. Please try again.'}
            {error === 'oauth_cancelled' && 'Sign up was cancelled.'}
            {!['username_taken', 'oauth_failed', 'oauth_cancelled'].includes(error) && `Error: ${error}`}
          </div>
        )}

        {success && (
          <div class="alert alert-success" style={{ marginBottom: '1.5rem' }}>
            {success === 'account_created' && 'Your account has been created! Welcome to ListenToMore.'}
          </div>
        )}

        <section style={{ maxWidth: '500px', margin: '0 auto' }}>
          <p style={{ marginBottom: '2rem', textAlign: 'center' }}>
            Connect a music service to create your ListenToMore profile and start tracking your collection.
          </p>

          <div class="auth-options" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Discogs - enabled */}
            <a
              href="/api/auth/discogs/signup"
              class="button"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                padding: '1rem 1.5rem',
                fontSize: '1.1rem',
              }}
            >
              <span style={{ fontSize: '1.3rem' }}>💿</span>
              Sign up with Discogs
            </a>

            {/* Last.fm - disabled for now */}
            <button
              class="button-secondary"
              disabled
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                padding: '1rem 1.5rem',
                fontSize: '1.1rem',
                opacity: 0.5,
                cursor: 'not-allowed',
              }}
            >
              <span style={{ fontSize: '1.3rem' }}>📻</span>
              Sign up with Last.fm (coming soon)
            </button>
          </div>

          <p class="text-muted text-center" style={{ marginTop: '2rem', fontSize: '0.9rem' }}>
            Already have an account? Go to{' '}
            <a href="/stats">your stats page</a> to manage your profile.
          </p>
        </section>
      </main>
    </Layout>
  );
}

export async function handleAccount(c: Context<{ Bindings: Bindings; Variables: Variables }>) {
  const internalToken = c.get('internalToken');
  const error = c.req.query('error');
  const success = c.req.query('success');

  return c.html(
    <AccountPage
      internalToken={internalToken}
      error={error}
      success={success}
    />
  );
}
