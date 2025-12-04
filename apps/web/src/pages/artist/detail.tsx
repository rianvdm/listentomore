// Artist detail page component
// Loads basic data immediately, then progressively loads AI summary and Last.fm data

import type { Context } from 'hono';
import { Layout } from '../../components/layout';
import type { SpotifyService } from '@listentomore/spotify';
import { enrichLinksScript, renderCitationsScript, transformCitationsScript } from '../../utils/client-scripts';

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
  internalToken?: string;
}

export function ArtistDetailPage({
  artist,
  error,
  internalToken,
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

  return (
    <Layout
      title={artist.name}
      description={`Learn about ${artist.name} - discography, bio, and more`}
      image={artistImage}
      url={`https://listentomore.com/artist/${artist.id}`}
      internalToken={internalToken}
    >
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
              onerror="this.onerror=null;this.src='https://file.elezea.com/noun-no-image.png'"
            />
            <div class="no-wrap-text">
              {/* Genre - loaded via JS from Last.fm tags */}
              <p id="genre-section">
                <strong>Genre:</strong>{' '}
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
        ${enrichLinksScript}
        ${transformCitationsScript}
        ${renderCitationsScript}

        (function() {
          var artistName = ${JSON.stringify(artist.name)};
          var artistId = '${artist.id}';

          // Tags to filter out (not real genres)
          var excludedTags = ['seen live', 'live', 'favorite', 'favorites', 'favourite', 'favourites',
            'female vocalists', 'male vocalists', 'singer-songwriter', 'under 2000 listeners',
            'spotify', 'albums i own', 'my favorite', 'check out', 'vinyl', 'cd'];

          function isRealGenre(tag) {
            var lower = tag.toLowerCase();
            return !excludedTags.some(function(excluded) { return lower.includes(excluded); });
          }

          // Fetch Last.fm data (playcount, genres, and similar artists)
          internalFetch('/api/internal/artist-lastfm?name=' + encodeURIComponent(artistName), { cache: 'no-store' })
            .then(function(r) {
              if (!r.ok) throw new Error('HTTP ' + r.status);
              return r.json();
            })
            .then(function(data) {
              if (data.error) throw new Error(data.error);
              var lastfm = data.data;

              // Update genres from Last.fm tags
              if (lastfm.tags && lastfm.tags.length > 0) {
                var realGenres = lastfm.tags.filter(isRealGenre).slice(0, 3);
                if (realGenres.length > 0) {
                  var genreHtml = '<strong>Genre:</strong> ';
                  genreHtml += realGenres.map(function(genre) {
                    var slug = genre.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                    return '<a href="/genre/' + slug + '">' + genre + '</a>';
                  }).join(' | ');
                  document.getElementById('genre-section').innerHTML = genreHtml;
                } else {
                  document.getElementById('genre-section').innerHTML = '<strong>Genre:</strong> Unknown';
                }
              } else {
                document.getElementById('genre-section').innerHTML = '<strong>Genre:</strong> Unknown';
              }

              // Update popular albums (from Last.fm, enriched with Spotify IDs)
              if (lastfm.topAlbums && lastfm.topAlbums.length > 0) {
                // Show with search links first (instant)
                var html = '<p style="margin-bottom:0.2em"><strong>Popular Albums:</strong></p>';
                html += '<ul>';
                lastfm.topAlbums.forEach(function(albumName) {
                  html += '<li><a href="/album?q=' + encodeURIComponent(artistName + ' ' + albumName) + '">' + albumName + '</a></li>';
                });
                html += '</ul>';
                document.getElementById('popular-albums').innerHTML = html;

                // Enrich with Spotify IDs for direct links (using precise field-filter search)
                Promise.all(lastfm.topAlbums.map(function(albumName) {
                  return internalFetch('/api/internal/search-album-by-artist?artist=' + encodeURIComponent(artistName) + '&album=' + encodeURIComponent(albumName))
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                      if (data.data && data.data[0]) {
                        return { name: albumName, id: data.data[0].id };
                      }
                      return { name: albumName, id: null };
                    })
                    .catch(function() { return { name: albumName, id: null }; });
                })).then(function(enrichedAlbums) {
                  var html = '<p style="margin-bottom:0.2em"><strong>Popular Albums:</strong></p>';
                  html += '<ul>';
                  enrichedAlbums.forEach(function(album) {
                    var href = album.id ? '/album/' + album.id : '/album?q=' + encodeURIComponent(artistName + ' ' + album.name);
                    html += '<li><a href="' + href + '">' + album.name + '</a></li>';
                  });
                  html += '</ul>';
                  document.getElementById('popular-albums').innerHTML = html;
                });
              } else {
                document.getElementById('popular-albums').innerHTML = '<p style="margin-bottom:0.2em"><strong>Popular Albums:</strong></p><ul><li>No albums found</li></ul>';
              }

              // Update similar artists (from Last.fm, enriched with Spotify IDs)
              if (lastfm.similar && lastfm.similar.length > 0) {
                // Show loading state first
                var html = '<p><strong>Similar Artists:</strong></p>';
                html += '<ul>';
                lastfm.similar.forEach(function(name) {
                  html += '<li><a href="/artist?q=' + encodeURIComponent(name) + '">' + name + '</a></li>';
                });
                html += '</ul>';
                document.getElementById('similar-artists').innerHTML = html;

                // Enrich with Spotify IDs for direct links
                Promise.all(lastfm.similar.map(function(name) {
                  return internalFetch('/api/internal/search?q=' + encodeURIComponent(name) + '&type=artist')
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                      if (data.data && data.data[0]) {
                        return { name: name, id: data.data[0].id };
                      }
                      return { name: name, id: null };
                    })
                    .catch(function() { return { name: name, id: null }; });
                })).then(function(enrichedArtists) {
                  var html = '<p><strong>Similar Artists:</strong></p>';
                  html += '<ul>';
                  enrichedArtists.forEach(function(artist) {
                    var href = artist.id ? '/artist/' + artist.id : '/artist?q=' + encodeURIComponent(artist.name);
                    html += '<li><a href="' + href + '">' + artist.name + '</a></li>';
                  });
                  html += '</ul>';
                  document.getElementById('similar-artists').innerHTML = html;
                });
              }
            })
            .catch(function(e) {
              console.error('Last.fm error:', e);
              document.getElementById('genre-section').innerHTML = '<strong>Genre:</strong> Unknown';
            });

          // Fetch AI summary
          internalFetch('/api/internal/artist-summary?name=' + encodeURIComponent(artistName), { cache: 'no-store' })
            .then(function(r) {
              if (!r.ok) throw new Error('HTTP ' + r.status);
              return r.json();
            })
            .then(function(data) {
              if (data.error) throw new Error(data.error);
              var summary = data.data;
              var text = summary.text || summary.summary || '';
              var html = '<p style="margin-top:1.5em;margin-bottom:0.2em"><strong>Overview:</strong></p>';
              html += '<div>' + transformCitations(marked.parse(text), summary.citations) + '</div>';
              html += renderCitations(summary.citations);

              document.getElementById('ai-summary').innerHTML = html;

              // Enrich artist/album links in the summary with Spotify IDs
              enrichLinks('ai-summary');
            })
            .catch(function(e) {
              console.error('AI summary error:', e);
              document.getElementById('ai-summary').innerHTML = '<p class="text-muted">Unable to load AI summary.</p>';
            });
        })();
      ` }} />
    </Layout>
  );
}

// Route handler - fetches Spotify artist data, albums loaded via JS from Last.fm
export async function handleArtistDetail(c: Context) {
  const spotifyId = c.req.param('id');
  const spotify = c.get('spotify') as SpotifyService;
  const internalToken = c.get('internalToken') as string;

  try {
    const artistData = await spotify.getArtist(spotifyId);

    if (!artistData) {
      return c.html(
        <ArtistDetailPage artist={null} error="Artist not found" internalToken={internalToken} />
      );
    }

    const artist: ArtistData = {
      id: artistData.id,
      name: artistData.name,
      image: artistData.image || undefined,
      genres: artistData.genres || [],
      spotifyUrl: artistData.url,
    };

    return c.html(<ArtistDetailPage artist={artist} internalToken={internalToken} />);
  } catch (error) {
    console.error('Artist detail error:', error);
    return c.html(
      <ArtistDetailPage artist={null} error="Failed to load artist" internalToken={internalToken} />
    );
  }
}
