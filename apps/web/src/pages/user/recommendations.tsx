// User recommendations page - loved tracks and personalized artist recommendations
// URL: /u/:username/recommendations

import type { Context } from 'hono';
import { Layout } from '../../components/layout';
import { enrichLinksScript } from '../../utils/client-scripts';
import type { Database, User } from '@listentomore/db';
import type { TopArtist, LovedTrack } from '@listentomore/lastfm';

interface UserRecommendationsPageProps {
  username: string;
  lastfmUsername: string;
  lovedTracks: LovedTrack[];
  topArtists: TopArtist[];
  internalToken?: string;
  currentUser?: User | null;
}

export function UserRecommendationsPage({
  username,
  lastfmUsername,
  lovedTracks,
  topArtists,
  internalToken,
  currentUser,
}: UserRecommendationsPageProps) {
  const hasLovedTracks = lovedTracks.length > 0;
  const hasTopArtists = topArtists.length > 0;

  // Get most recent loved track date for display
  const lastUpdated = lovedTracks[0]?.dateLiked || null;

  return (
    <Layout
      title={`Recommendations from ${username}`}
      description={`Music recommendations from ${username} - loved tracks and artist discoveries`}
      url={`https://listentomore.com/u/${username}/recommendations`}
      internalToken={internalToken}
      currentUser={currentUser}
    >
      <header>
        <h1>
          Recommendations from{' '}
          <a href={`/u/${username}`}>{username}</a>
        </h1>
      </header>

      <main>
        <section id="recommendations">
          {/* Loved Tracks Section */}
          <h2>❤️ Recent Favorites</h2>
          <p class="text-center">
            <strong>Tracks {username} recently loved on Last.fm</strong>
            {lastUpdated && (
              <>
                <br />
                <span class="text-muted">Last updated {lastUpdated}</span>
              </>
            )}
          </p>

          {hasLovedTracks ? (
            <div id="loved-tracks" class="track-list">
              {lovedTracks.map((track, index) => (
                <div key={`${track.artist}-${track.title}`} class="track-item" data-index={index}>
                  <div class="track-item-image" id={`loved-image-${index}`}>
                    {track.image ? (
                      <img src={track.image} alt={`${track.title} by ${track.artist}`} loading="lazy" onerror="this.onerror=null;this.src='https://file.elezea.com/noun-no-image.png'" />
                    ) : (
                      <div class="placeholder-image">
                        <span class="spinner">↻</span>
                      </div>
                    )}
                  </div>
                  <div class="track-item-content">
                    <p>
                      <strong>{track.title}</strong> by{' '}
                      <a href={`/artist?q=${encodeURIComponent(track.artist)}`}>{track.artist}</a>
                      <span id={`loved-links-${index}`} class="track-links"></span>
                    </p>
                    <p id={`loved-sentence-${index}`} class="text-muted">
                      <span class="loading-inline">Loading...</span>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p class="text-center text-muted">
              No loved tracks found.{' '}
              <a href={`https://www.last.fm/user/${lastfmUsername}`} target="_blank" rel="noopener noreferrer">
                Love some tracks on Last.fm
              </a>{' '}
              to see them here!
            </p>
          )}

          {/* Discover Artists Section */}
          <h2 style={{ marginTop: '4em' }}>🎵 Discover Similar Artists</h2>
          <p class="text-center">
            <strong>Based on {username}'s recent listening</strong>
          </p>
          {hasTopArtists ? (
            <div id="recommended-artists">
              <div class="loading-container">
                <span class="spinner">↻</span>
                <span class="loading-text">Finding recommendations...</span>
              </div>
            </div>
          ) : (
            <p class="text-center text-muted">
              We need more listening data to generate recommendations.{' '}
              <a href={`https://www.last.fm/user/${lastfmUsername}`} target="_blank" rel="noopener noreferrer">
                Listen to more music on Last.fm
              </a>{' '}
              and check back later!
            </p>
          )}

          {/* Back to Stats */}
          <p class="text-center" style={{ marginTop: '3em' }}>
            <a href={`/u/${username}`} class="button">← Back to Stats</a>
          </p>
        </section>
      </main>

      {/* Progressive loading scripts */}
      <script dangerouslySetInnerHTML={{ __html: `
        ${enrichLinksScript}

        (function() {
          var username = ${JSON.stringify(username)};
          var lovedTracks = ${JSON.stringify(lovedTracks)};

          // Enrich artist links with Spotify IDs
          enrichLinks('loved-tracks');

          // Fetch artist sentences and streaming links for loved tracks
          lovedTracks.forEach(function(track, index) {
            // Fetch artist sentence
            internalFetch('/api/internal/artist-sentence?name=' + encodeURIComponent(track.artist))
              .then(function(r) { return r.json(); })
              .then(function(data) {
                var el = document.getElementById('loved-sentence-' + index);
                if (el && data.data && data.data.sentence) {
                  el.innerHTML = data.data.sentence;
                  el.className = '';
                } else if (el) {
                  el.innerHTML = '';
                }
              })
              .catch(function() {
                var el = document.getElementById('loved-sentence-' + index);
                if (el) el.innerHTML = '';
              });

            // Fetch Spotify track data for image and streaming link
            internalFetch('/api/internal/search?q=' + encodeURIComponent(track.artist + ' ' + track.title) + '&type=track')
              .then(function(r) { return r.json(); })
              .then(function(data) {
                if (data.data && data.data[0]) {
                  var spotifyTrack = data.data[0];

                  // Always try to update image from Spotify (better quality)
                  if (spotifyTrack.image) {
                    var imgEl = document.getElementById('loved-image-' + index);
                    if (imgEl) {
                      imgEl.innerHTML = '<img src="' + spotifyTrack.image + '" alt="' + track.title + ' by ' + track.artist + '" loading="lazy" onerror="this.onerror=null;this.src=\\'https://file.elezea.com/noun-no-image.png\\'"/>';
                    }
                  }

                  // Add Spotify track link
                  if (spotifyTrack.url) {
                    var linksEl = document.getElementById('loved-links-' + index);
                    if (linksEl) {
                      linksEl.innerHTML = ' \\u2022 <a href="' + spotifyTrack.url + '" target="_blank" rel="noopener noreferrer">Listen \\u2197</a>';
                    }
                  }
                }
              })
              .catch(function(err) {
                console.error('Error fetching Spotify data for track:', err);
              });
          });

          // Fetch recommended artists based on top artists
          ${hasTopArtists ? `
          internalFetch('/api/internal/user-recommendations?username=' + encodeURIComponent(username))
            .then(function(res) { return res.json(); })
            .then(function(result) {
              var container = document.getElementById('recommended-artists');
              if (!container) return;

              if (result.error || !result.data || result.data.length === 0) {
                container.innerHTML = '<p class="text-center text-muted">Unable to generate recommendations at this time.</p>';
                return;
              }

              var html = '<div class="track-grid">';
              result.data.forEach(function(artist) {
                var href = artist.id ? '/artist/' + artist.id : '/artist?q=' + encodeURIComponent(artist.name);
                html += '<a href="' + href + '">';
                html += '<div class="track">';
                if (artist.image) {
                  html += '<img src="' + artist.image + '" alt="' + artist.name + '" class="track-image" loading="lazy" onerror="this.onerror=null;this.src=\\'https://file.elezea.com/noun-no-image.png\\'"/>';
                }
                html += '<div class="track-content">';
                html += '<p class="track-artist">' + artist.name + '</p>';
                if (artist.basedOn) {
                  html += '<p class="track-subtitle">Similar to ' + artist.basedOn + '</p>';
                }
                html += '</div></div></a>';
              });
              html += '</div>';
              container.innerHTML = html;
            })
            .catch(function(err) {
              console.error('Failed to load recommendations:', err);
              var container = document.getElementById('recommended-artists');
              if (container) {
                container.innerHTML = '<p class="text-center text-muted">Failed to load recommendations.</p>';
              }
            });
          ` : ''}
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

// Route handler
export async function handleUserRecommendations(c: Context) {
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

  // Create a LastfmService for this user's Last.fm account
  const { LastfmService } = await import('@listentomore/lastfm');
  const lastfm = new LastfmService({
    apiKey: c.env.LASTFM_API_KEY,
    username: user.lastfm_username,
    cache: c.env.CACHE,
  });

  // Fetch loved tracks and top artists in parallel
  const [lovedTracks, topArtists] = await Promise.all([
    lastfm.getLovedTracks(5).catch(() => []),
    lastfm.getTopArtists('7day', 6).catch(() => []),
  ]);

  return c.html(
    <UserRecommendationsPage
      username={user.username || user.lastfm_username}
      lastfmUsername={user.lastfm_username}
      lovedTracks={lovedTracks}
      topArtists={topArtists}
      internalToken={internalToken}
      currentUser={currentUser}
    />
  );
}
