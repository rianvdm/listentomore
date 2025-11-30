// User stats page - displays Last.fm listening statistics
// URL: /u/:username

import type { Context } from 'hono';
import { Layout } from '../../components/layout';
import { TrackCard } from '../../components/ui';
import { enrichLinksScript } from '../../utils/client-scripts';
import type { Database } from '@listentomore/db';
import type { TopArtist, TopAlbum, RecentTrack } from '@listentomore/lastfm';

interface UserStatsPageProps {
  username: string;
  lastfmUsername: string;
  recentTrack: RecentTrack | null;
  topArtists: TopArtist[];
  topAlbums: TopAlbum[];
}

export function UserStatsPage({ username, lastfmUsername, recentTrack, topArtists, topAlbums }: UserStatsPageProps) {
  return (
    <Layout
      title={`${username}'s Stats`}
      description={`Real-time listening statistics for ${username}`}
    >
      <header>
        <h1>
          Real-time listening stats for{' '}
          <a href={`https://www.last.fm/user/${lastfmUsername}`} target="_blank" rel="noopener noreferrer">
            {username}
          </a>
        </h1>
      </header>

      <main>
        <section id="lastfm-stats">
          {/* Recent Listening */}
          <h2>🎧 Recent Listening</h2>
          <div id="recent-listening">
            {recentTrack ? (
              <p>
                Most recently listened to{' '}
                <a href={`/album?q=${encodeURIComponent(`${recentTrack.artist} ${recentTrack.album}`)}`}>
                  <strong>{recentTrack.album}</strong>
                </a>
                {' '}by{' '}
                <a href={`/artist?q=${encodeURIComponent(recentTrack.artist)}`}>
                  <strong>{recentTrack.artist}</strong>
                </a>
                .<span id="artist-sentence"></span>
              </p>
            ) : (
              <p class="text-muted">No recent tracks found.</p>
            )}
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
          {topArtists.length > 0 ? (
            <div id="top-artists" class="track-grid">
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
            <div id="top-albums" class="track-grid">
              {topAlbums.map((album) => (
                <TrackCard
                  key={`${album.artist}-${album.name}`}
                  artist={album.name}
                  name={album.artist}
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

      {/* Progressive loading for link enrichment and artist sentence */}
      <script dangerouslySetInnerHTML={{ __html: `
        ${enrichLinksScript}

        (function() {
          // Enrich album and artist links with Spotify IDs
          enrichLinks('recent-listening');
          enrichLinks('top-artists');
          enrichLinks('top-albums');
          ${recentTrack ? `
          // Load artist sentence
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
        <p style={{ marginTop: '1rem', maxWidth: '400px', marginLeft: 'auto', marginRight: 'auto' }}>
          This feature is currently in testing. If you'd like to try it out,{' '}
          <a href="https://elezea.com/contact/" target="_blank" rel="noopener noreferrer">
            get in touch
          </a>{' '}
          and I'll set you up.
        </p>
        <p class="mt-2">
          <a href="/stats" class="button">Try Another Username</a>
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
      username={user.username || user.lastfm_username}
      lastfmUsername={user.lastfm_username}
      recentTrack={recentTrack}
      topArtists={topArtists}
      topAlbums={topAlbums}
    />
  );
}
