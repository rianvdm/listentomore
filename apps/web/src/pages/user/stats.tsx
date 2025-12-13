// User stats page - displays Last.fm listening statistics
// URL: /u/:username

import type { Context } from 'hono';
import { Layout } from '../../components/layout';
import { enrichLinksScript } from '../../utils/client-scripts';
import type { Database, User } from '@listentomore/db';
import { LastfmService } from '@listentomore/lastfm';

interface UserStatsPageProps {
  username: string;
  lastfmUsername: string;
  profileImage?: string;
  internalToken?: string;
  currentUser?: User | null;
}

export function UserStatsPage({ username, lastfmUsername, profileImage, internalToken, currentUser }: UserStatsPageProps) {
  return (
    <Layout
      title={`${username}'s Stats`}
      description={`Real-time listening statistics for ${username}`}
      url={`https://listentomore.com/u/${username}`}
      image={profileImage}
      internalToken={internalToken}
      currentUser={currentUser}
    >
      <header>
        <h1>
          Real-time listening stats for{' '}
          <a href={`https://www.last.fm/user/${lastfmUsername}`} target="_blank" rel="noopener noreferrer">
            {username}
          </a>
        </h1>

        {/* Centered Profile Picture */}
        {profileImage && (
          <div style={{ textAlign: 'center', margin: '2em 0' }}>
            <img
              src={profileImage}
              alt={`${username}'s profile`}
              style={{
                width: '150px',
                height: '150px',
                borderRadius: '50%',
                objectFit: 'cover'
              }}
            />
          </div>
        )}
      </header>

      <main>
        <section id="lastfm-stats">
          {/* Recent Listening */}
          <h2>🎧 Recent Listening</h2>
          <div id="recent-listening">
            <p class="text-muted">
              <span class="loading-inline">Loading recent tracks...</span>
            </p>
          </div>

          {/* Recommendations Link */}
          <p class="text-center" style={{ marginTop: '2em' }}>
            <a href={`/u/${username}/recommendations`} class="button">
              View Recommendations →
            </a>
          </p>

          {/* Top Artists */}
          <h2>👩‍🎤 Top Artists</h2>
          <p class="text-center">
            <strong>Top artists in the past 7 days.</strong>
          </p>
          <div id="top-artists">
            <div class="loading-container">
              <span class="spinner">↻</span>
              <span class="loading-text">Loading top artists...</span>
            </div>
          </div>

          {/* Top Albums */}
          <h2 style={{ marginTop: '4em' }}>🏆 Top Albums</h2>
          <p class="text-center">
            <strong>Top albums in the past 30 days.</strong>
          </p>
          <div id="top-albums">
            <div class="loading-container">
              <span class="spinner">↻</span>
              <span class="loading-text">Loading top albums...</span>
            </div>
          </div>
        </section>
      </main>

      {/* Progressive loading for stats data - 3 parallel fetches */}
      <script dangerouslySetInnerHTML={{ __html: `
        ${enrichLinksScript}

        (function() {
          var username = ${JSON.stringify(username)};

          // Fetch recent track (fastest - renders first)
          internalFetch('/api/internal/user-recent-track?username=' + encodeURIComponent(username))
            .then(function(r) { return r.json(); })
            .then(function(result) {
              var recentEl = document.getElementById('recent-listening');
              if (!recentEl) return;

              if (result.error) {
                recentEl.innerHTML = '<p class="text-muted">Failed to load recent track.</p>';
                return;
              }

              var track = result.data;
              if (track) {
                recentEl.innerHTML = '<p>Most recently listened to ' +
                  '<a href="/album?q=' + encodeURIComponent(track.artist + ' ' + track.album) + '" data-artist="' + escapeHtml(track.artist) + '" data-album="' + escapeHtml(track.album) + '">' +
                  '<strong>' + escapeHtml(track.album) + '</strong></a> by ' +
                  '<a href="/artist?q=' + encodeURIComponent(track.artist) + '">' +
                  '<strong>' + escapeHtml(track.artist) + '</strong></a>.' +
                  '<span id="artist-sentence"></span></p>';
                enrichLinks('recent-listening');
                fetchArtistSentence(track.artist);
              } else {
                recentEl.innerHTML = '<p class="text-muted">No recent tracks found.</p>';
              }
            })
            .catch(function(err) {
              console.error('Failed to load recent track:', err);
              var el = document.getElementById('recent-listening');
              if (el) el.innerHTML = '<p class="text-muted">Failed to load recent track.</p>';
            });

          // Fetch top artists (parallel)
          internalFetch('/api/internal/user-top-artists?username=' + encodeURIComponent(username))
            .then(function(r) { return r.json(); })
            .then(function(result) {
              var artistsEl = document.getElementById('top-artists');
              if (!artistsEl) return;

              if (result.error) {
                artistsEl.innerHTML = '<p class="text-center text-muted">Failed to load top artists.</p>';
                return;
              }

              var topArtists = result.data;
              if (topArtists && topArtists.length > 0) {
                artistsEl.innerHTML = renderTrackGrid(topArtists.map(function(artist) {
                  return {
                    title: artist.name,
                    subtitle: artist.playcount + ' plays',
                    image: artist.image,
                    href: '/artist?q=' + encodeURIComponent(artist.name)
                  };
                }));
                enrichLinks('top-artists');
              } else {
                artistsEl.innerHTML = '<p class="text-center text-muted">No listening data for this period.</p>';
              }
            })
            .catch(function(err) {
              console.error('Failed to load top artists:', err);
              var el = document.getElementById('top-artists');
              if (el) el.innerHTML = '<p class="text-center text-muted">Failed to load top artists.</p>';
            });

          // Fetch top albums (parallel)
          internalFetch('/api/internal/user-top-albums?username=' + encodeURIComponent(username))
            .then(function(r) { return r.json(); })
            .then(function(result) {
              var albumsEl = document.getElementById('top-albums');
              if (!albumsEl) return;

              if (result.error) {
                albumsEl.innerHTML = '<p class="text-center text-muted">Failed to load top albums.</p>';
                return;
              }

              var topAlbums = result.data;
              if (topAlbums && topAlbums.length > 0) {
                albumsEl.innerHTML = renderTrackGrid(topAlbums.map(function(album) {
                  return {
                    title: album.name,
                    subtitle: album.artist,
                    extra: album.playcount + ' plays',
                    image: album.image,
                    href: '/album?q=' + encodeURIComponent(album.artist + ' ' + album.name),
                    dataArtist: album.artist,
                    dataAlbum: album.name
                  };
                }));
                enrichLinks('top-albums');
              } else {
                albumsEl.innerHTML = '<p class="text-center text-muted">No listening data for this period.</p>';
              }
            })
            .catch(function(err) {
              console.error('Failed to load top albums:', err);
              var el = document.getElementById('top-albums');
              if (el) el.innerHTML = '<p class="text-center text-muted">Failed to load top albums.</p>';
            });

          function escapeHtml(str) {
            var div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
          }

          function renderTrackGrid(items) {
            var html = '<div class="track-grid">';
            items.forEach(function(item) {
              var dataAttrs = '';
              if (item.dataArtist && item.dataAlbum) {
                dataAttrs = ' data-artist="' + escapeHtml(item.dataArtist) + '" data-album="' + escapeHtml(item.dataAlbum) + '"';
              }
              html += '<a href="' + item.href + '"' + dataAttrs + '>';
              html += '<div class="track">';
              if (item.image) {
                html += '<img src="' + item.image + '" alt="' + escapeHtml(item.title) + '" class="track-image" loading="lazy" onerror="this.onerror=null;this.src=\\'https://file.elezea.com/noun-no-image.png\\'"/>';
              } else {
                html += '<div class="track-image placeholder-image"></div>';
              }
              html += '<div class="track-content">';
              html += '<p class="track-artist">' + escapeHtml(item.title) + '</p>';
              html += '<p class="track-name">' + escapeHtml(item.subtitle) + '</p>';
              if (item.extra) {
                html += '<p class="track-album">' + escapeHtml(item.extra) + '</p>';
              }
              html += '</div></div></a>';
            });
            html += '</div>';
            return html;
          }

          function fetchArtistSentence(artistName) {
            internalFetch('/api/internal/artist-sentence?name=' + encodeURIComponent(artistName))
              .then(function(r) { return r.json(); })
              .then(function(data) {
                if (data.error) throw new Error(data.error);
                var el = document.getElementById('artist-sentence');
                if (el && data.data && data.data.sentence) {
                  el.textContent = ' ' + data.data.sentence;
                }
              })
              .catch(function(e) {
                console.error('Artist sentence error:', e);
              });
          }
        })();
      ` }} />
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
        <p style={{ marginTop: '1rem', maxWidth: '500px', marginLeft: 'auto', marginRight: 'auto' }}>
          Want to create your own profile?{' '}
          <a href="/login">Sign in with Last.fm</a> to track your listening stats and get personalized recommendations.
        </p>
        <p class="mt-2">
          <a href="/stats" class="button">Try Another Username</a>
        </p>
      </div>
    </Layout>
  );
}

// Private profile page - shown when profile is private and viewer is not owner
function PrivateProfile({ username, currentUser }: { username: string; currentUser?: User | null }) {
  return (
    <Layout
      title="Private Profile"
      description="This profile is private"
      currentUser={currentUser}
    >
      <div class="text-center" style={{ paddingTop: '4rem' }}>
        <h1 style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🔒 Private Profile</h1>
        <p>
          <strong>{username}</strong> has chosen to keep their listening stats private.
        </p>
        {!currentUser && (
          <p style={{ marginTop: '1.5rem' }}>
            <a href="/login" class="button">Sign In</a>
          </p>
        )}
      </div>
    </Layout>
  );
}

// Route handler - returns shell immediately, data loaded progressively via JS
export async function handleUserStats(c: Context) {
  const username = c.req.param('username');
  const db = c.get('db') as Database;
  const internalToken = c.get('internalToken') as string;

  // Look up user by lastfm_username first (canonical), then fall back to username
  let user = await db.getUserByLastfmUsername(username);
  if (!user) {
    user = await db.getUserByUsername(username);
  }

  if (!user || !user.lastfm_username) {
    return c.html(<UserNotFound username={username} />, 404);
  }

  // Get current logged-in user for nav and privacy check
  const currentUser = c.get('currentUser') as User | null;

  // Check privacy - if private and not the owner, show private profile page
  if (user.profile_visibility === 'private') {
    if (!currentUser || currentUser.id !== user.id) {
      return c.html(
        <PrivateProfile
          username={user.lastfm_username}
          currentUser={currentUser}
        />
      );
    }
  }

  // Fetch Last.fm user info for profile picture
  let profileImage: string | undefined;
  try {
    const lastfm = new LastfmService({
      apiKey: c.env.LASTFM_API_KEY,
      username: user.lastfm_username,
      cache: c.env.CACHE,
    });
    const userInfo = await lastfm.getUserInfo();
    profileImage = userInfo.image || undefined;
  } catch (error) {
    console.error('Failed to fetch Last.fm user info:', error);
    // Continue without profile image - will use default
  }

  // Return shell immediately - data loaded via /api/internal/user-stats
  return c.html(
    <UserStatsPage
      username={user.username || user.lastfm_username}
      lastfmUsername={user.lastfm_username}
      profileImage={profileImage}
      internalToken={internalToken}
      currentUser={currentUser}
    />
  );
}
