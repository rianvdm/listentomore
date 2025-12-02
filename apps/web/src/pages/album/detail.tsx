// Album detail page component
// Loads basic data immediately, then progressively loads AI summary and streaming links

import type { Context } from 'hono';
import { Layout } from '../../components/layout';
import type { SpotifyService } from '@listentomore/spotify';
import { renderCitationsScript } from '../../utils/client-scripts';

interface AlbumData {
  id: string;
  name: string;
  artist: string;
  artistId?: string;
  image?: string;
  releaseYear?: string;
  genres: string[];
  spotifyUrl: string;
}

interface AlbumDetailProps {
  album: AlbumData | null;
  error?: string;
}

export function AlbumDetailPage({ album, error }: AlbumDetailProps) {
  if (error || !album) {
    return (
      <Layout title="Album Not Found">
        <div class="text-center" style={{ paddingTop: '4rem' }}>
          <h1>Album Not Found</h1>
          <p class="text-muted">
            {error || 'The album you requested could not be found.'} This either means it's not
            available to stream, or I am doing something wrong with the search.
          </p>
          <p class="mt-2">
            You can also <a href="/album">try the search manually</a> and see if that works.
          </p>
        </div>
      </Layout>
    );
  }

  const albumImage = album.image || 'https://file.elezea.com/noun-no-image.png';

  return (
    <Layout
      title={`${album.name} by ${album.artist}`}
      description={`Listen to ${album.name} by ${album.artist}`}
      image={albumImage}
      url={`https://listentomore.com/album/${album.id}`}
    >
      {/* Header with linked artist */}
      <header>
        <h1>
          {album.name} by{' '}
          {album.artistId ? (
            <a href={`/artist/${album.artistId}`}>{album.artist}</a>
          ) : (
            album.artist
          )}
        </h1>
      </header>

      <main>
        {/* Image + Info Layout */}
        <section class="track_ul2">
          <div class="image-text-wrapper">
            <img
              src={albumImage}
              alt={album.name}
              style={{ maxWidth: '100%', width: '220px', height: 'auto' }}
            />
            <div class="no-wrap-text">
              <p>
                <strong>Released:</strong> {album.releaseYear || 'Unknown'}
              </p>

              {album.genres.length > 0 && (
                <p>
                  <strong>Genres:</strong>{' '}
                  {album.genres.slice(0, 3).map((genre, index) => (
                    <>
                      <a href={`/genre/${encodeURIComponent(genre.toLowerCase().replace(/\s+/g, '-'))}`}>
                        {genre}
                      </a>
                      {index < Math.min(album.genres.length, 3) - 1 ? ' | ' : ''}
                    </>
                  ))}
                </p>
              )}

              {/* Streaming links - loaded via JS */}
              <p>
                <strong>Streaming:</strong>
                <br />
                <span id="streaming-links">
                  <a href={album.spotifyUrl} target="_blank" rel="noopener noreferrer">
                    Spotify ↗
                  </a>
                  <br />
                  <span class="text-muted">Loading more links...</span>
                </span>
              </p>
            </div>
          </div>

          {/* AI Summary - loaded via JS */}
          <div id="ai-summary" class="ai-summary">
            <p class="text-muted">Loading AI summary...</p>
          </div>
        </section>
      </main>

      {/* Progressive loading script */}
      <script dangerouslySetInnerHTML={{ __html: `
        ${renderCitationsScript}

        (function() {
          var albumId = '${album.id}';
          var spotifyUrl = '${album.spotifyUrl}';
          var artistName = ${JSON.stringify(album.artist)};
          var albumName = ${JSON.stringify(album.name)};

          // Fetch streaming links
          fetch('/api/internal/songlink?url=' + encodeURIComponent(spotifyUrl), { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (data.error) throw new Error(data.error);
              var links = data.data;
              var html = '<a href="' + spotifyUrl + '" target="_blank" rel="noopener noreferrer">Spotify ↗</a><br/>';
              if (links.appleUrl) html += '<a href="' + links.appleUrl + '" target="_blank" rel="noopener noreferrer">Apple Music ↗</a><br/>';
              if (links.youtubeUrl) html += '<a href="' + links.youtubeUrl + '" target="_blank" rel="noopener noreferrer">YouTube Music ↗</a><br/>';
              if (links.tidalUrl) html += '<a href="' + links.tidalUrl + '" target="_blank" rel="noopener noreferrer">Tidal ↗</a><br/>';
              if (links.deezerUrl) html += '<a href="' + links.deezerUrl + '" target="_blank" rel="noopener noreferrer">Deezer ↗</a><br/>';
              if (links.pageUrl) html += '<a href="' + links.pageUrl + '" target="_blank" rel="noopener noreferrer">Songlink ↗</a><br/>';
              document.getElementById('streaming-links').innerHTML = html;
            })
            .catch(function(e) {
              console.error('Songlink error:', e);
              // Keep just Spotify link on error
              document.getElementById('streaming-links').innerHTML = '<a href="' + spotifyUrl + '" target="_blank" rel="noopener noreferrer">Spotify ↗</a>';
            });

          // Fetch AI summary
          fetch('/api/internal/album-summary?artist=' + encodeURIComponent(artistName) + '&album=' + encodeURIComponent(albumName), { cache: 'no-store' })
            .then(function(r) {
              if (!r.ok) throw new Error('HTTP ' + r.status);
              return r.json();
            })
            .then(function(data) {
              if (data.error) throw new Error(data.error);
              var summary = data.data;
              var html = '<div>' + marked.parse(summary.content) + '</div>';
              html += renderCitations(summary.citations);
              document.getElementById('ai-summary').innerHTML = html;
            })
            .catch(function(e) {
              console.error('Album summary error:', e);
              document.getElementById('ai-summary').innerHTML = '<p class="text-muted">Unable to load AI summary.</p>';
            });
        })();
      ` }} />
    </Layout>
  );
}

// Route handler - now only fetches Spotify data (fast)
export async function handleAlbumDetail(c: Context) {
  const spotifyId = c.req.param('id');
  const spotify = c.get('spotify') as SpotifyService;

  try {
    // Fetch album data from Spotify (fast)
    const albumData = await spotify.getAlbum(spotifyId);

    if (!albumData) {
      return c.html(<AlbumDetailPage album={null} error="Album not found" />);
    }

    const album: AlbumData = {
      id: albumData.id,
      name: albumData.name,
      artist: albumData.artist,
      artistId: albumData.artistIds[0],
      image: albumData.image || undefined,
      releaseYear: albumData.releaseDate?.split('-')[0],
      genres: albumData.genres || [],
      spotifyUrl: albumData.url,
    };

    return c.html(<AlbumDetailPage album={album} />);
  } catch (error) {
    console.error('Album detail error:', error);
    return c.html(<AlbumDetailPage album={null} error="Failed to load album" />);
  }
}
