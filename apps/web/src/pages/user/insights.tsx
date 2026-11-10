// ABOUTME: User insights page at /u/:username/insights: the week note (owner) or visitor line, and album picks.
// ABOUTME: The client script renders the summary response as text only; no HTML from the response is parsed.

import type { Context } from 'hono';
import { Layout } from '../../components/layout';
import { UserProfileNav } from '../../components/layout/UserProfileNav';
import { UserProfileHeader } from '../../components/layout/UserProfileHeader';
import type { Database, User } from '@listentomore/db';

interface UserInsightsPageProps {
  username: string;
  lastfmUsername: string;
  profileImage?: string;
  bio?: string | null;
  internalToken?: string;
  currentUser?: User | null;
  isOwner: boolean;
  profileVisibility?: 'public' | 'private';
}

export function UserInsightsPage({
  username,
  lastfmUsername,
  profileImage,
  bio,
  internalToken,
  currentUser,
  isOwner,
  profileVisibility,
}: UserInsightsPageProps) {
  // Matches the route's header (spec section 4): the owner reads "Your week", a visitor the profile's name.
  const heading = isOwner ? 'Your week' : `${username}'s week`;
  const loadingText = isOwner ? 'Reading your week...' : `Reading ${username}'s week...`;

  return (
    <Layout
      title={`Insights for ${username}`}
      description={`AI-powered listening insights and recommendations for ${username}`}
      url={`https://listentomore.com/u/${username}/insights`}
      internalToken={internalToken}
      currentUser={currentUser}
    >
      <UserProfileHeader username={username} lastfmUsername={lastfmUsername} profileImage={profileImage} bio={bio} />
      <UserProfileNav username={username} activePage="insights" />

      {isOwner && profileVisibility === 'private' && (
        <div class="notice notice-info" style={{ marginBottom: '1.5rem', padding: '1rem', backgroundColor: 'rgba(var(--c-accent-rgb), 0.1)', borderRadius: '8px', textAlign: 'center' }}>
          🔒 Only you can see your profile. Go to <a href="/account">Account Settings</a> to make it public.
        </div>
      )}

      <main>
        <section id="insights">
          <div class="section-header">
            <h2>{heading}</h2>
            {isOwner && (
              <button
                id="refresh-btn"
                class="button button-small button-secondary"
                disabled
              >
                ↻ Refresh
              </button>
            )}
          </div>
          <div id="insights-summary">
            <p class="text-muted">
              <span class="loading-inline">{loadingText}</span>
            </p>
          </div>
          <p id="insights-question" class="insights-question" hidden></p>
          <p id="insights-meta" class="insights-meta text-muted" hidden></p>

          <h2 style={{ marginTop: '3em' }}>💿 Albums to Explore</h2>
          <div id="insights-recommendations">
            <div class="loading-container">
              <span class="spinner">↻</span>
              <span class="loading-text">Finding recommendations...</span>
            </div>
          </div>
        </section>
      </main>

      <script
        dangerouslySetInnerHTML={{
          __html: `
        (function() {
          var username = ${JSON.stringify(username)};
          var isOwner = ${isOwner};
          var loadingText = ${JSON.stringify(loadingText)};
          var refreshCooldown = 0;
          var refreshInterval = null;

          function escapeHtml(str) {
            var div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
          }

          // Replaces the summary with one paragraph of text. Response text only ever goes through textContent.
          function showSummaryText(text, className, innerClassName) {
            var summaryEl = document.getElementById('insights-summary');
            if (!summaryEl) return;
            var p = document.createElement('p');
            p.className = className;
            if (innerClassName) {
              var span = document.createElement('span');
              span.className = innerClassName;
              span.textContent = text;
              p.appendChild(span);
            } else {
              p.textContent = text;
            }
            summaryEl.textContent = '';
            summaryEl.appendChild(p);
          }

          function hideWeekDetails() {
            ['insights-question', 'insights-meta'].forEach(function(id) {
              var el = document.getElementById(id);
              if (el) {
                el.hidden = true;
                el.textContent = '';
              }
            });
          }

          // The pulled time in the viewer's locale and timezone, or '' when the value is not a date.
          function formatPulledAt(iso) {
            var date = new Date(iso);
            if (isNaN(date.getTime())) return '';
            return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
          }

          function renderWeek(week) {
            var summaryEl = document.getElementById('insights-summary');
            if (!summaryEl) return;

            var noteEl = document.createElement('p');
            noteEl.className = 'insights-note';
            noteEl.textContent = week.note;
            if (week.refreshing) {
              // Another request is generating; this is the note last served.
              var updatingEl = document.createElement('span');
              updatingEl.className = 'insights-updating text-muted';
              updatingEl.textContent = 'Updating...';
              noteEl.appendChild(document.createTextNode(' '));
              noteEl.appendChild(updatingEl);
            }
            summaryEl.textContent = '';
            summaryEl.appendChild(noteEl);

            // The route sends a question to the owner only; the page also checks, so a visitor never sees one.
            var questionEl = document.getElementById('insights-question');
            if (questionEl) {
              if (isOwner && week.question) {
                questionEl.textContent = week.question;
                questionEl.hidden = false;
              } else {
                questionEl.textContent = '';
                questionEl.hidden = true;
              }
            }

            var metaEl = document.getElementById('insights-meta');
            if (metaEl) {
              var pulled = formatPulledAt(week.pulledAt);
              metaEl.textContent = (pulled ? 'Updated ' + pulled + '. ' : '') + 'Counts exclude likely duplicate scrobbles.';
              metaEl.hidden = false;
            }
          }

          function loadInsights(refresh) {
            var refreshParam = refresh ? '&refresh=true' : '';

            // Show loading states
            showSummaryText(loadingText, 'text-muted', 'loading-inline');
            hideWeekDetails();
            document.getElementById('insights-recommendations').innerHTML =
              '<div class="loading-container"><span class="spinner">↻</span><span class="loading-text">Finding recommendations...</span></div>';

            // Fetch summary
            internalFetch('/api/internal/user-insights-summary?username=' + encodeURIComponent(username) + refreshParam)
              .then(function(r) { return r.json(); })
              .then(function(data) {
                if (data.sparse) {
                  showSummaryText(data.message, 'text-muted fun-message');
                  document.getElementById('insights-recommendations').innerHTML =
                    '<p class="text-muted text-center">Listen to more music to unlock personalized recommendations!</p>';
                  return;
                }

                if (data.error || !data.data) {
                  throw new Error(data.error || 'Empty insights response');
                }

                renderWeek(data.data);
              })
              .catch(function(err) {
                console.error('Insights summary error:', err);
                showSummaryText('Unable to generate insights right now. Please try again later.', 'text-muted');
                hideWeekDetails();
              });

            // Fetch recommendations (parallel)
            internalFetch('/api/internal/user-insights-recommendations?username=' + encodeURIComponent(username) + refreshParam)
              .then(function(r) { return r.json(); })
              .then(function(data) {
                var recsEl = document.getElementById('insights-recommendations');
                if (!recsEl) return;

                if (data.sparse || !data.data || data.data.length === 0) {
                  // Don't show anything if sparse - summary handles the message
                  if (!data.sparse) {
                    recsEl.innerHTML =
                      '<p class="text-muted text-center">No recommendations available at this time.</p>';
                  }
                  return;
                }

                renderAlbumCards(data.data);
              })
              .catch(function(err) {
                console.error('Insights recommendations error:', err);
                var el = document.getElementById('insights-recommendations');
                if (el) {
                  el.innerHTML =
                    '<p class="text-muted text-center">Unable to load recommendations.</p>';
                }
              });
          }

          // Render album cards with cover art
          function renderAlbumCards(albums) {
            var container = document.getElementById('insights-recommendations');
            if (!container) return;

            var html = '<div class="album-cards">';
            albums.forEach(function(album) {
              var albumHref = album.spotifyId
                ? '/album/' + album.spotifyId
                : '/album?q=' + encodeURIComponent(album.artistName + ' ' + album.albumName);
              var artistHref = album.artistSpotifyId
                ? '/artist/' + album.artistSpotifyId
                : '/artist?q=' + encodeURIComponent(album.artistName);

              html += '<div class="album-card">';
              html += '<a href="' + albumHref + '" class="album-card-image-link">';
              if (album.albumArt) {
                html += '<img src="' + album.albumArt + '" alt="' + escapeHtml(album.albumName) + '" class="album-card-image" loading="lazy" onerror="this.onerror=null;this.src=\\'https://file.elezea.com/noun-no-image.png\\'"/>';
              } else {
                html += '<div class="album-card-image placeholder-image"></div>';
              }
              html += '</a>';
              html += '<div class="album-card-content">';
              html += '<a href="' + albumHref + '" class="album-card-title">' + escapeHtml(album.albumName) + '</a>';
              html += '<a href="' + artistHref + '" class="album-card-artist">' + escapeHtml(album.artistName) + '</a>';
              html += '<p class="album-card-reason">' + escapeHtml(album.reason) + '</p>';
              html += '</div></div>';
            });
            html += '</div>';
            container.innerHTML = html;
          }

          // Start cooldown timer display
          function startCooldownTimer(seconds) {
            var refreshBtn = document.getElementById('refresh-btn');
            if (!refreshBtn || seconds <= 0) return;

            refreshCooldown = seconds;
            refreshBtn.disabled = true;

            if (refreshInterval) clearInterval(refreshInterval);
            refreshInterval = setInterval(function() {
              refreshCooldown--;
              if (refreshCooldown <= 0) {
                clearInterval(refreshInterval);
                refreshBtn.disabled = false;
                refreshBtn.textContent = '↻ Refresh';
              } else {
                var mins = Math.floor(refreshCooldown / 60);
                var secs = String(refreshCooldown % 60).padStart(2, '0');
                refreshBtn.textContent = '↻ ' + mins + ':' + secs;
              }
            }, 1000);

            // Show initial countdown
            var mins = Math.floor(refreshCooldown / 60);
            var secs = String(refreshCooldown % 60).padStart(2, '0');
            refreshBtn.textContent = '↻ ' + mins + ':' + secs;
          }

          // Refresh button logic (owner only)
          if (isOwner) {
            var refreshBtn = document.getElementById('refresh-btn');
            if (refreshBtn) {
              // Check server-side cooldown on page load
              internalFetch('/api/internal/user-insights-cooldown?username=' + encodeURIComponent(username))
                .then(function(r) { return r.json(); })
                .then(function(data) {
                  if (data.canRefresh) {
                    refreshBtn.disabled = false;
                  } else {
                    startCooldownTimer(data.cooldownSeconds);
                  }
                })
                .catch(function() {
                  // If check fails, enable button (server will enforce anyway)
                  refreshBtn.disabled = false;
                });

              refreshBtn.addEventListener('click', function() {
                if (refreshCooldown > 0) return;

                refreshBtn.disabled = true;
                refreshBtn.textContent = 'Refreshing...';

                loadInsights(true);

                // Start 5-minute cooldown after refresh
                startCooldownTimer(300);
              });
            }
          }

          // Initial load
          loadInsights(false);
        })();
      `,
        }}
      />

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          margin-bottom: 1rem;
        }

        .section-header h2 {
          margin: 0;
        }

        .insights-question {
          font-style: italic;
        }

        .insights-meta,
        .insights-updating {
          font-size: 14px;
        }

        .fun-message {
          font-size: 1.1rem;
          padding: 2rem;
          text-align: center;
        }

        .album-cards {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 1.5rem;
          margin-top: 1.5rem;
        }

        .album-card {
          display: flex;
          gap: 1rem;
          padding: 1rem;
          background: var(--card-bg, #1a1a1a);
          border-radius: 8px;
          transition: transform 0.2s;
        }

        .album-card:hover {
          transform: translateY(-2px);
        }

        .album-card-image-link {
          flex-shrink: 0;
        }

        .album-card-image {
          width: 80px;
          height: 80px;
          border-radius: 4px;
          object-fit: cover;
        }

        .album-card-content {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          min-width: 0;
        }

        .album-card-title {
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          color: var(--text-primary, #fff);
        }

        .album-card-title:hover {
          text-decoration: underline;
        }

        .album-card-artist {
          color: var(--text-muted, #888);
          font-size: 0.9rem;
        }

        .album-card-artist:hover {
          text-decoration: underline;
        }

        .album-card-reason {
          font-size: 0.85rem;
          color: var(--text-secondary, #aaa);
          margin-top: 0.25rem;
          line-height: 1.4;
          margin-bottom: 0;
        }

        .button-small {
          padding: 0.4rem 0.8rem;
          font-size: 0.85rem;
        }

        .button-secondary {
          background: var(--button-secondary-bg, #333);
          color: var(--button-secondary-text, #fff);
        }

        .button-secondary:hover:not(:disabled) {
          background: var(--button-secondary-hover, #444);
        }

        .button-secondary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        @media (max-width: 600px) {
          .album-cards {
            grid-template-columns: 1fr;
          }

          .section-header {
            flex-direction: column;
            align-items: flex-start;
          }
        }
      `,
        }}
      />
    </Layout>
  );
}

// 404 page for user not found
function UserNotFound({ username }: { username: string }) {
  return (
    <Layout title="User Not Found">
      <div class="text-center" style={{ paddingTop: '4rem' }}>
        <h1 style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>User not found</h1>
        <p>
          No user with username "<strong>{username}</strong>" exists in our system.
        </p>
        <p
          style={{
            marginTop: '1rem',
            maxWidth: '500px',
            marginLeft: 'auto',
            marginRight: 'auto',
          }}
        >
          Want to create your own profile?{' '}
          <a href="/login">Sign in with Last.fm</a> to track your listening stats and
          get personalized recommendations.
        </p>
        <p class="mt-2">
          <a href="/stats" class="button">
            Try Another Username
          </a>
        </p>
      </div>
    </Layout>
  );
}

// Private profile page - shown when profile is private and viewer is not owner
function PrivateProfile({
  username,
  currentUser,
}: {
  username: string;
  currentUser?: User | null;
}) {
  return (
    <Layout
      title="Private Profile"
      description="This profile is private"
      currentUser={currentUser}
    >
      <div class="text-center" style={{ paddingTop: '4rem' }}>
        <h1 style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🔒 Private Profile</h1>
        <p>
          <strong>{username}</strong> has chosen to keep their listening insights
          private.
        </p>
        {!currentUser && (
          <p style={{ marginTop: '1.5rem' }}>
            <a href="/login" class="button">
              Sign In
            </a>
          </p>
        )}
      </div>
    </Layout>
  );
}

// Route handler
export async function handleUserInsights(c: Context) {
  const username = c.req.param('username');
  const db = c.get('db') as Database;
  const internalToken = c.get('internalToken') as string;
  const currentUser = c.get('currentUser') as User | null;

  // Look up user by lastfm_username first (canonical), then fall back to username
  let user = await db.getUserByLastfmUsername(username);
  if (!user) {
    user = await db.getUserByUsername(username);
  }

  if (!user || !user.lastfm_username) {
    return c.html(<UserNotFound username={username} />, 404);
  }

  const isOwner = currentUser?.id === user.id;

  // Check privacy - if private and not the owner, show private profile page
  if (user.profile_visibility === 'private' && !isOwner) {
    return c.html(
      <PrivateProfile username={user.lastfm_username} currentUser={currentUser} />
    );
  }

  // Fetch Last.fm user info for profile picture
  let profileImage: string | undefined;
  try {
    const { LastfmService } = await import('@listentomore/lastfm');
    const lastfm = new LastfmService({
      apiKey: c.env.LASTFM_API_KEY,
      username: user.lastfm_username,
      cache: c.env.CACHE,
    });
    const userInfo = await lastfm.getUserInfo();
    profileImage = userInfo.image || undefined;
  } catch (error) {
    console.error('Failed to fetch Last.fm user info:', error);
  }

  return c.html(
    <UserInsightsPage
      username={user.username || user.lastfm_username}
      lastfmUsername={user.lastfm_username}
      profileImage={profileImage}
      bio={user.bio}
      internalToken={internalToken}
      currentUser={currentUser}
      isOwner={isOwner}
      profileVisibility={user.profile_visibility}
    />
  );
}
