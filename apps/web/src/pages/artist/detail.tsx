// Artist detail page component
// Loads basic data immediately, then progressively loads AI summary and Last.fm data

import type { Context } from 'hono';
import { Layout } from '../../components/layout';
import type { SpotifyService } from '@listentomore/spotify';

interface ArtistData {
  id: string;
  name: string;
  image?: string;
  genres: string[];
  spotifyUrl: string;
}

interface ArtistDetailProps {
  artist: ArtistData | null;
  error?: string;
}

export function ArtistDetailPage({
  artist,
  error,
}: ArtistDetailProps) {
  if (error || !artist) {
    return (
      <Layout title="Artist Not Found">
        <div class="text-center" style={{ paddingTop: '4rem' }}>
          <h1>Artist Not Found</h1>
          <p class="text-muted">{error || 'The artist you requested could not be found.'}</p>
          <p class="mt-2">
            <a href="/artist" class="button">
              Search Artists
            </a>
          </p>
        </div>
      </Layout>
    );
  }

  const artistImage = artist.image || 'https://file.elezea.com/noun-no-image.png';
  const genre = artist.genres[0] || 'No genres found';

  return (
    <Layout title={artist.name} description={`Learn about ${artist.name} - discography, bio, and more`}>
      {/* Header */}
      <header>
        <h1>{artist.name}</h1>
      </header>

      <main>
        {/* Image + Info Layout */}
        <section class="track_ul2">
          <div class="image-text-wrapper">
            <img
              src={artistImage}
              alt={artist.name}
              style={{ maxWidth: '100%', width: '220px', height: 'auto' }}
            />
            <div class="no-wrap-text">
              <p>
                <strong>Genre:</strong>{' '}
                {genre !== 'No genres found' ? (
                  <a href={`/genre/${encodeURIComponent(genre.toLowerCase().replace(/\s+/g, '-'))}`}>
                    {genre}
                  </a>
                ) : (
                  genre
                )}
              </p>

              {/* Playcount - loaded via JS */}
              <p id="playcount-section">
                <strong>My playcount:</strong>{' '}
                <span class="text-muted">Loading...</span>
              </p>

              {/* Popular Albums - loaded via JS from Last.fm */}
              <div id="popular-albums">
                <p style={{ marginBottom: '0.2em' }}>
                  <strong>Popular Albums:</strong>
                </p>
                <ul>
                  <li class="text-muted">Loading...</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Similar Artists - loaded via JS */}
          <div id="similar-artists"></div>

          {/* AI Overview - loaded via JS */}
          <div id="ai-summary" class="ai-summary">
            <p class="text-muted">Loading AI summary...</p>
          </div>
        </section>
      </main>

      {/* Progressive loading script */}
      <script dangerouslySetInnerHTML={{ __html: `
        (function() {
          var artistName = ${JSON.stringify(artist.name)};
          var artistId = '${artist.id}';

          // Fetch Last.fm data (playcount and similar artists)
          fetch('/api/internal/artist-lastfm?name=' + encodeURIComponent(artistName))
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (data.error) throw new Error(data.error);
              var lastfm = data.data;

              // Update playcount
              var playcount = lastfm.userPlaycount || 0;
              var formatted = new Intl.NumberFormat().format(playcount);
              document.getElementById('playcount-section').innerHTML = '<strong>My playcount:</strong> ' + formatted + ' plays';

              // Update popular albums (from Last.fm)
              if (lastfm.topAlbums && lastfm.topAlbums.length > 0) {
                var html = '<p style="margin-bottom:0.2em"><strong>Popular Albums:</strong></p>';
                html += '<ul>';
                lastfm.topAlbums.forEach(function(albumName) {
                  html += '<li><a href="/album?q=' + encodeURIComponent(artistName + ' ' + albumName) + '">' + albumName + '</a></li>';
                });
                html += '</ul>';
                document.getElementById('popular-albums').innerHTML = html;
              } else {
                document.getElementById('popular-albums').innerHTML = '<p style="margin-bottom:0.2em"><strong>Popular Albums:</strong></p><ul><li>No albums found</li></ul>';
              }

              // Update similar artists (from Last.fm)
              if (lastfm.similar && lastfm.similar.length > 0) {
                var html = '<p><strong>Similar Artists:</strong></p>';
                html += '<ul>';
                lastfm.similar.forEach(function(name) {
                  html += '<li><a href="/artist?q=' + encodeURIComponent(name) + '">' + name + '</a></li>';
                });
                html += '</ul>';
                document.getElementById('similar-artists').innerHTML = html;
              }
            })
            .catch(function(e) {
              console.error('Last.fm error:', e);
              document.getElementById('playcount-section').innerHTML = '<strong>My playcount:</strong> 0 plays';
            });

          // Fetch AI summary
          fetch('/api/internal/artist-summary?name=' + encodeURIComponent(artistName))
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (data.error) throw new Error(data.error);
              var summary = data.data;
              var text = summary.text || summary.summary || '';
              var html = '<p style="margin-top:1.5em;margin-bottom:0.2em"><strong>Overview:</strong></p>';
              html += '<div>' + formatMarkdown(text) + '</div>';
              document.getElementById('ai-summary').innerHTML = html;
            })
            .catch(function(e) {
              console.error('AI summary error:', e);
              document.getElementById('ai-summary').innerHTML = '<p class="text-muted">Unable to load AI summary.</p>';
            });

          function formatMarkdown(text) {
            var result = text
              // Markdown links [text](url) - convert listentomore.com URLs to internal search
              .replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, function(match, linkText, url) {
                // Convert listentomore.com/artist/* URLs to internal search
                if (url.includes('listentomore.com/artist/')) {
                  return '<a href="/artist?q=' + encodeURIComponent(linkText) + '">' + linkText + '</a>';
                }
                // Convert listentomore.com/album/* URLs to internal search
                if (url.includes('listentomore.com/album/')) {
                  return '<a href="/album?q=' + encodeURIComponent(linkText) + '">' + linkText + '</a>';
                }
                // External links open in new tab
                return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + linkText + '</a>';
              })
              // Bold
              .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
              // Italic
              .replace(/\\*(.+?)\\*/g, '<em>$1</em>')
              // Paragraphs - split on double newlines
              .replace(/\\n\\n/g, '</p><p>')
              .replace(/\\n/g, '<br/>');
            // Wrap in paragraph tags
            return '<p>' + result + '</p>';
          }
        })();
      ` }} />
    </Layout>
  );
}

// Route handler - fetches Spotify artist data, albums loaded via JS from Last.fm
export async function handleArtistDetail(c: Context) {
  const idParam = c.req.param('id');

  // Parse spotify:ID format
  let spotifyId = idParam;
  if (idParam.startsWith('spotify:')) {
    spotifyId = idParam.slice(8);
  }

  const spotify = c.get('spotify') as SpotifyService;

  try {
    const artistData = await spotify.getArtist(spotifyId);

    if (!artistData) {
      return c.html(
        <ArtistDetailPage artist={null} error="Artist not found" />
      );
    }

    const artist: ArtistData = {
      id: artistData.id,
      name: artistData.name,
      image: artistData.image || undefined,
      genres: artistData.genres || [],
      spotifyUrl: artistData.url,
    };

    return c.html(<ArtistDetailPage artist={artist} />);
  } catch (error) {
    console.error('Artist detail error:', error);
    return c.html(
      <ArtistDetailPage artist={null} error="Failed to load artist" />
    );
  }
}
