// User stats page - displays Last.fm listening statistics
// URL: /u/:username

import type { Context } from 'hono';
import { Layout } from '../../components/layout';
import { TrackCard } from '../../components/ui';
import type { Database, User } from '@listentomore/db';
import type { TopArtist, TopAlbum, RecentTrack } from '@listentomore/lastfm';

interface UserStatsPageProps {
  user: User;
  recentTrack: RecentTrack | null;
  topArtists: TopArtist[];
  topAlbums: TopAlbum[];
}

export function UserStatsPage({ user, recentTrack, topArtists, topAlbums }: UserStatsPageProps) {
  const displayName = user.username || 'User';

  return (
    <Layout
      title={`${displayName}'s Stats`}
      description={`Real-time listening statistics for ${displayName}`}
    >
      <header>
        <h1>Real-time listening stats</h1>
        <p class="text-center text-muted">
          Listening data for <strong>{displayName}</strong> via Last.fm
        </p>
      </header>

      <main>
        <section id="lastfm-stats">
          {/* Recent Listening */}
          <h2>🎧 Recent Listening</h2>
          {recentTrack ? (
            <p>
              Most recently listened to{' '}
              <strong>{recentTrack.name}</strong> by{' '}
              <a href={`/artist?q=${encodeURIComponent(recentTrack.artist)}`}>
                <strong>{recentTrack.artist}</strong>
              </a>
              .<span id="artist-sentence"></span>
            </p>
          ) : (
            <p class="text-muted">No recent tracks found.</p>
          )}

          {/* Top Artists */}
          <h2>👩‍🎤 Top Artists</h2>
          <p class="text-center">
            <strong>Top artists in the past 7 days.</strong>
          </p>
          {topArtists.length > 0 ? (
            <div class="track-grid">
              {topArtists.map((artist) => (
                <TrackCard
                  key={artist.name}
                  artist={artist.name}
                  name={`${artist.playcount} plays`}
                  imageUrl={artist.image}
                  href={`/artist?q=${encodeURIComponent(artist.name)}`}
                />
              ))}
            </div>
          ) : (
            <p class="text-center text-muted">No listening data for this period.</p>
          )}

          {/* Top Albums */}
          <h2 style={{ marginTop: '4em' }}>🏆 Top Albums</h2>
          <p class="text-center">
            <strong>Top albums in the past 30 days.</strong>
          </p>
          {topAlbums.length > 0 ? (
            <div class="track-grid">
              {topAlbums.map((album) => (
                <TrackCard
                  key={`${album.artist}-${album.name}`}
                  artist={album.artist}
                  name={album.name}
                  album={`${album.playcount} plays`}
                  imageUrl={album.image}
                  href={`/album?q=${encodeURIComponent(`${album.artist} ${album.name}`)}`}
                />
              ))}
            </div>
          ) : (
            <p class="text-center text-muted">No listening data for this period.</p>
          )}
        </section>
      </main>

      {/* Progressive loading for artist sentence */}
      {recentTrack && (
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            var artistName = ${JSON.stringify(recentTrack.artist)};
            fetch('/api/internal/artist-sentence?name=' + encodeURIComponent(artistName))
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
          })();
        ` }} />
      )}
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
          No user with username "<strong>{username}</strong>" exists.
        </p>
        <p class="mt-2">
          <a href="/" class="button">Go Home</a>
        </p>
      </div>
    </Layout>
  );
}

// Route handler
export async function handleUserStats(c: Context) {
  const username = c.req.param('username');
  const db = c.get('db') as Database;

  // Look up user by username
  const user = await db.getUserByUsername(username);

  if (!user || !user.lastfm_username) {
    return c.html(<UserNotFound username={username} />, 404);
  }

  // Create a LastfmService for this user's Last.fm account (with caching)
  const { LastfmService } = await import('@listentomore/lastfm');
  const lastfm = new LastfmService({
    apiKey: c.env.LASTFM_API_KEY,
    username: user.lastfm_username,
    cache: c.env.CACHE,
  });

  // Fetch all data in parallel
  const [recentTracks, topArtists, topAlbums] = await Promise.all([
    lastfm.recentTracks.getRecentTracks(1).catch(() => []),
    lastfm.getTopArtists('7day', 6).catch(() => []),
    lastfm.getTopAlbums('1month', 6).catch(() => []),
  ]);

  const recentTrack = recentTracks[0] || null;

  return c.html(
    <UserStatsPage
      user={user}
      recentTrack={recentTrack}
      topArtists={topArtists}
      topAlbums={topAlbums}
    />
  );
}
