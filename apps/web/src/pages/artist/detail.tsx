// ABOUTME: Artist detail page: Spotify data renders immediately, Last.fm data and the AI summary load progressively.
// ABOUTME: With PUBLIC_CACHED_SUMMARIES on, a cached AI summary is server-rendered for every visitor.

import type { Context } from 'hono';
import type { AIService } from '@listentomore/ai';
import type { User } from '@listentomore/db';
import { isSpotifyId } from '@listentomore/shared';
import { SpotifyNotFoundError } from '@listentomore/spotify';
import type { SpotifyService } from '@listentomore/spotify';
import { Layout } from '../../components/layout';
import { AiSummaryLabel, NotFoundPage, RateLimitedPage, SignInCTA, SignInGate } from '../../components/ui';
import { aiContentClientScript, enrichLinksScript } from '../../utils/client-scripts';
import { loadPublicSummary, publicSummariesEnabled } from '../../utils/public-summaries';

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
  currentUser?: User | null;
  // Sanitised HTML from the cached AI summary; null when the flag is off, the cache misses, or the reply is a fallback.
  summaryHtml?: string | null;
  // PUBLIC_CACHED_SUMMARIES is on; the client script labels a summary it fetches only then.
  publicSummaries?: boolean;
}

// Server-rendered cached summary when present, otherwise the placeholder the client script replaces.
function ArtistSummarySection({ html }: { html?: string | null }) {
  return (
    <div id="ai-summary" class="ai-summary">
      {html ? (
        <>
          <p style={{ marginTop: '1.5em', marginBottom: '0.2em' }}>
            <strong>Overview:</strong>
          </p>
          <AiSummaryLabel />
          <div dangerouslySetInnerHTML={{ __html: html }} />
        </>
      ) : (
        <p class="text-muted">Loading AI summary...</p>
      )}
    </div>
  );
}

export function ArtistDetailPage({
  artist,
  error,
  internalToken,
  currentUser,
  summaryHtml,
  publicSummaries = false,
}: ArtistDetailProps) {
  if (error || !artist) {
    return (
      <Layout title="Artist Not Found" currentUser={currentUser}>
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
  const currentPath = `/artist/${artist.id}`;
  const summaryRendered = Boolean(summaryHtml);

  return (
    <Layout
      title={artist.name}
      description={`Learn about ${artist.name} - discography, bio, and more`}
      image={artistImage}
      url={`https://listentomore.com/artist/${artist.id}`}
      internalToken={internalToken}
      currentUser={currentUser}
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

              {/* User playcount - populated via JS for logged-in users */}
              <p id="user-playcount" style={{ display: 'none' }}></p>

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

          {/* AI Overview: cached content is public; generating it needs a login */}
          {!currentUser && summaryRendered ? (
            <>
              <ArtistSummarySection html={summaryHtml} />
              <SignInCTA currentPath={currentPath} variant="personal" />
            </>
          ) : (
            <SignInGate currentUser={currentUser ?? null} currentPath={currentPath}>
              <ArtistSummarySection html={summaryHtml} />
            </SignInGate>
          )}
        </section>
      </main>

      {/* Progressive loading script */}
      <script dangerouslySetInnerHTML={{ __html: `
        ${enrichLinksScript}
        ${aiContentClientScript(publicSummaries)}

        window.__AI_SUMMARY_RENDERED__ = ${summaryRendered};

        (function() {
          var artistName = ${JSON.stringify(artist.name)};
          var artistId = ${JSON.stringify(artist.id)};
          var lastfmUsername = ${currentUser?.lastfm_username ? JSON.stringify(currentUser.lastfm_username) : 'null'};

          // Tags to filter out (not real genres)
          var excludedTags = ['seen live', 'live', 'favorite', 'favorites', 'favourite', 'favourites',
            'female vocalists', 'male vocalists', 'singer-songwriter', 'under 2000 listeners',
            'spotify', 'albums i own', 'my favorite', 'check out', 'vinyl', 'cd'];

          function isRealGenre(tag) {
            var lower = tag.toLowerCase();
            return !excludedTags.some(function(excluded) { return lower.includes(excluded); });
          }

          // Fetch Last.fm data (playcount, genres, and similar artists).
          // The server reads the playcount user from the session cookie.
          var lastfmUrl = '/api/internal/artist-lastfm?name=' + encodeURIComponent(artistName);
          internalFetch(lastfmUrl, { cache: 'no-store' })
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

              // Show user playcount if available
              if (lastfmUsername && lastfm.userplaycount !== undefined) {
                var el = document.getElementById('user-playcount');
                el.innerHTML = '<strong>Your plays:</strong> ' + lastfm.userplaycount.toLocaleString();
                el.style.display = '';
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

          // Server-rendered summary still needs its search links enriched
          if (window.__AI_SUMMARY_RENDERED__) {
            enrichLinks('ai-summary');
          }

          // Fetch AI summary - only for authenticated users, and only when the server didn't render it
          if (window.__IS_AUTHENTICATED__ && !window.__AI_SUMMARY_RENDERED__) {
            internalFetch('/api/internal/artist-summary?spotifyId=' + encodeURIComponent(artistId), { cache: 'no-store' })
              .then(function(r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
              })
              .then(function(data) {
                if (data.error) throw new Error(data.error);
                var summary = data.data;
                var text = summary.text || summary.summary || '';
                // The model's "no information" reply is not a summary, so it gets no label
                if (isAiFallback(text)) {
                  document.getElementById('ai-summary').innerHTML = '<p class="text-muted">AI summary not available for this artist.</p>';
                  return;
                }
                var html = '<p style="margin-top:1.5em;margin-bottom:0.2em"><strong>Overview:</strong></p>';
                html += aiSummaryLabel;
                html += '<div>' + marked.parse(text) + '</div>';

                document.getElementById('ai-summary').innerHTML = html;

                // Enrich artist/album links in the summary with Spotify IDs
                enrichLinks('ai-summary');
              })
              .catch(function(e) {
                console.error('AI summary error:', e);
                document.getElementById('ai-summary').innerHTML = '<p class="text-muted">Unable to load AI summary.</p>';
              });
          }
        })();
      ` }} />
    </Layout>
  );
}

// Route handler: Spotify data, plus the cached AI summary when public summaries are on (never a model call).
// Albums and similar artists load via JS from Last.fm.
export async function handleArtistDetail(c: Context) {
  const spotifyId = c.req.param('id');

  // Legacy slug URLs (e.g. /artist/the-grateful-dead) predate ID-based routes; Spotify 400s them.
  if (!isSpotifyId(spotifyId)) {
    return c.html(<NotFoundPage />, 404);
  }
  const spotify = c.get('spotify') as SpotifyService;
  const internalToken = c.get('internalToken') as string;
  const currentUser = c.get('currentUser') as User | null;

  try {
    const artistData = await spotify.getArtist(spotifyId);

    const artist: ArtistData = {
      id: artistData.id,
      name: artistData.name,
      image: artistData.image || undefined,
      genres: artistData.genres || [],
      spotifyUrl: artistData.url,
    };

    // Same name resolveSpotifyArtist passes to the generator, so the read hits the key it wrote.
    const publicSummaries = publicSummariesEnabled(c.env);
    let summaryHtml: string | null = null;
    if (publicSummaries) {
      const ai = c.get('ai') as AIService;
      summaryHtml = await loadPublicSummary(() => ai.getCachedArtistSummary(artistData.name), 'artist');
    }

    return c.html(
      <ArtistDetailPage
        artist={artist}
        internalToken={internalToken}
        currentUser={currentUser}
        summaryHtml={summaryHtml}
        publicSummaries={publicSummaries}
      />
    );
  } catch (error) {
    // A well-formed ID Spotify doesn't know; 404 so crawlers don't index a soft 404.
    if (error instanceof SpotifyNotFoundError) {
      return c.html(
        <ArtistDetailPage artist={null} error="Artist not found" internalToken={internalToken} currentUser={currentUser} />,
        404
      );
    }

    console.error('Artist detail error:', error);

    // Check for rate limiting (429)
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('429')) {
      return c.html(<RateLimitedPage type="artist" />, 503);
    }

    return c.html(
      <ArtistDetailPage artist={null} error="Failed to load artist" internalToken={internalToken} currentUser={currentUser} />
    );
  }
}
