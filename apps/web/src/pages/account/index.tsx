// Account settings page
// URL: /account

import type { Context } from 'hono';
import type { User } from '@listentomore/db';
import { Layout } from '../../components/layout';
import type { Bindings, Variables } from '../../types';

interface AccountPageProps {
  user: User;
}

function AccountPage({ user }: AccountPageProps) {
  return (
    <Layout
      title="Account Settings"
      description="Manage your ListenToMore account settings"
      currentUser={user}
    >
      <div style={{ maxWidth: '600px', margin: '2rem auto', padding: '0 1rem' }}>
        <h1>Account Settings</h1>

        {/* Profile Section */}
        <section style={{ marginTop: '2rem' }}>
          <h2 style={{ borderBottom: '1px solid rgba(var(--c-base-rgb), 0.1)', paddingBottom: '0.5rem' }}>
            Profile
          </h2>

          <form method="post" action="/account/profile" style={{ marginTop: '1rem' }}>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>
                Display Name
              </label>
              <input
                type="text"
                name="display_name"
                value={user.display_name || ''}
                placeholder={user.lastfm_username || ''}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  border: '1px solid rgba(var(--c-base-rgb), 0.2)',
                  backgroundColor: 'var(--c-bg)',
                  color: 'var(--c-base)',
                  fontSize: '1rem',
                }}
              />
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>
                Bio
              </label>
              <textarea
                name="bio"
                rows={3}
                placeholder="Tell us about yourself..."
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  border: '1px solid rgba(var(--c-base-rgb), 0.2)',
                  backgroundColor: 'var(--c-bg)',
                  color: 'var(--c-base)',
                  fontSize: '1rem',
                  resize: 'vertical',
                }}
              >
                {user.bio || ''}
              </textarea>
            </div>

            <button type="submit" class="button">
              Save Changes
            </button>
          </form>
        </section>

        {/* Connected Account Section */}
        <section style={{ marginTop: '3rem' }}>
          <h2 style={{ borderBottom: '1px solid rgba(var(--c-base-rgb), 0.1)', paddingBottom: '0.5rem' }}>
            Connected Account
          </h2>

          <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ fontSize: '1.5rem' }}>📻</span>
            <div>
              <strong>Last.fm</strong>
              <p class="text-muted" style={{ margin: '0.25rem 0 0 0' }}>
                Connected as{' '}
                <a href={`https://www.last.fm/user/${user.lastfm_username}`} target="_blank" rel="noopener noreferrer">
                  @{user.lastfm_username}
                </a>
              </p>
            </div>
          </div>
          <p class="text-muted" style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
            Your Last.fm account is used for authentication and cannot be disconnected.
          </p>
        </section>

        {/* Privacy Section */}
        <section style={{ marginTop: '3rem' }}>
          <h2 style={{ borderBottom: '1px solid rgba(var(--c-base-rgb), 0.1)', paddingBottom: '0.5rem' }}>
            Privacy
          </h2>

          <form method="post" action="/account/privacy" style={{ marginTop: '1rem' }}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="profile_visibility"
                  value="public"
                  checked={user.profile_visibility === 'public'}
                  style={{ width: '18px', height: '18px' }}
                />
                <div>
                  <strong>Public</strong>
                  <p class="text-muted" style={{ margin: '0.25rem 0 0 0', fontSize: '0.9rem' }}>
                    Anyone can see your profile and listening stats
                  </p>
                </div>
              </label>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="profile_visibility"
                  value="private"
                  checked={user.profile_visibility === 'private'}
                  style={{ width: '18px', height: '18px' }}
                />
                <div>
                  <strong>Private</strong>
                  <p class="text-muted" style={{ margin: '0.25rem 0 0 0', fontSize: '0.9rem' }}>
                    Only you can see your profile
                  </p>
                </div>
              </label>
            </div>

            <button type="submit" class="button">
              Save Privacy Settings
            </button>
          </form>
        </section>

        {/* Danger Zone */}
        <section style={{ marginTop: '3rem', marginBottom: '3rem' }}>
          <h2 style={{ borderBottom: '1px solid rgba(var(--c-base-rgb), 0.1)', paddingBottom: '0.5rem', color: '#c00' }}>
            Danger Zone
          </h2>

          <p class="text-muted" style={{ marginTop: '1rem' }}>
            Deleting your account will permanently remove all your data from ListenToMore.
            This action cannot be undone.
          </p>

          <button
            type="button"
            id="delete-account-btn"
            style={{
              marginTop: '1rem',
              padding: '0.75rem 1.5rem',
              backgroundColor: 'transparent',
              border: '1px solid #c00',
              color: '#c00',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '1rem',
            }}
          >
            Delete Account
          </button>
        </section>
      </div>

      {/* Delete Account Confirmation Script */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function() {
              var btn = document.getElementById('delete-account-btn');
              if (!btn) return;

              btn.addEventListener('click', function() {
                if (confirm('Are you sure you want to delete your account? This action cannot be undone.')) {
                  var input = prompt('Type DELETE to confirm account deletion:');
                  if (input === 'DELETE') {
                    window.location.href = '/account/delete';
                  }
                }
              });
            })();
          `,
        }}
      />
    </Layout>
  );
}

export async function handleAccount(c: Context<{ Bindings: Bindings; Variables: Variables }>) {
  const currentUser = c.get('currentUser');

  if (!currentUser) {
    return c.redirect('/login?next=/account');
  }

  return c.html(<AccountPage user={currentUser} />);
}

export async function handleAccountProfile(c: Context<{ Bindings: Bindings; Variables: Variables }>) {
  const currentUser = c.get('currentUser');

  if (!currentUser) {
    return c.redirect('/login');
  }

  const formData = await c.req.formData();
  const displayName = formData.get('display_name') as string | null;
  const bio = formData.get('bio') as string | null;

  const db = c.get('db');
  await db.updateUser(currentUser.id, {
    display_name: displayName || currentUser.lastfm_username,
    bio: bio || null,
  });

  return c.redirect('/account');
}

export async function handleAccountPrivacy(c: Context<{ Bindings: Bindings; Variables: Variables }>) {
  const currentUser = c.get('currentUser');

  if (!currentUser) {
    return c.redirect('/login');
  }

  const formData = await c.req.formData();
  const visibility = formData.get('profile_visibility') as 'public' | 'private' | null;

  if (visibility === 'public' || visibility === 'private') {
    const db = c.get('db');
    await db.updateUser(currentUser.id, {
      profile_visibility: visibility,
    });
  }

  return c.redirect('/account');
}

export async function handleAccountDelete(c: Context<{ Bindings: Bindings; Variables: Variables }>) {
  const currentUser = c.get('currentUser');

  if (!currentUser) {
    return c.redirect('/login');
  }

  const db = c.get('db');

  try {
    console.log('[DELETE_USER] Starting user deletion', {
      user_id: currentUser.id,
      username: currentUser.username,
      lastfm_username: currentUser.lastfm_username,
      timestamp: new Date().toISOString(),
    });

    // Delete user sessions first
    console.log('[DELETE_USER] Deleting user sessions', { user_id: currentUser.id });
    await db.deleteUserSessions(currentUser.id);
    console.log('[DELETE_USER] Sessions deleted successfully');

    // Delete user (CASCADE will handle api_keys, searches, discogs data)
    console.log('[DELETE_USER] Deleting user record (CASCADE will delete related data)', {
      user_id: currentUser.id,
    });
    await db.deleteUser(currentUser.id);
    console.log('[DELETE_USER] User record deleted successfully');

    // Clear session cookie
    console.log('[DELETE_USER] Clearing session cookie');
    const { destroySession } = await import('../../utils/session');
    await destroySession(c, db);

    console.log('[DELETE_USER] User deletion completed successfully', {
      user_id: currentUser.id,
      username: currentUser.username,
      timestamp: new Date().toISOString(),
    });

    return c.redirect('/');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[DELETE_USER] User deletion failed', {
      user_id: currentUser.id,
      username: currentUser.username,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
    });

    // Return error page instead of redirect
    return c.html(
      <Layout title="Error" currentUser={currentUser}>
        <div style={{ maxWidth: '600px', margin: '2rem auto', padding: '0 1rem' }}>
          <h1 style={{ color: '#c00' }}>Account Deletion Failed</h1>
          <p>
            We encountered an error while trying to delete your account. Please try again or contact support.
          </p>
          <p class="text-muted" style={{ fontSize: '0.9rem', marginTop: '1rem' }}>
            Error: {errorMessage}
          </p>
          <a href="/account" class="button" style={{ marginTop: '1rem', display: 'inline-block' }}>
            Back to Account Settings
          </a>
        </div>
      </Layout>,
      500
    );
  }
}
