// ABOUTME: Album detail page: Spotify data renders immediately, streaming links and AI content load progressively.
// ABOUTME: With PUBLIC_CACHED_SUMMARIES on, cached AI summary and recommendations are server-rendered for every visitor.

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
import { readRef } from '../../utils/referral';
import type { Ref } from '../../utils/referral';

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
  internalToken?: string;
  currentUser?: User | null;
  // Sanitised HTML from cached AI content; null when the flag is off, the cache misses, or the reply is a fallback.
  summaryHtml?: string | null;
  recommendationsHtml?: string | null;
  // PUBLIC_CACHED_SUMMARIES is on; the client script labels content it fetches only then.
  publicSummaries?: boolean;
  // Validated referrer from ?ref=; tailors the sign-in prompt and is carried into /login.
  signInRef?: Ref | null;
}

// Server-rendered cached content when present, otherwise the placeholder the client script replaces.
function AlbumSummarySection({ html }: { html?: string | null }) {
  return (
    <div id="ai-summary" class="ai-summary">
      {html ? (
        <>
          <AiSummaryLabel />
          <div dangerouslySetInnerHTML={{ __html: html }} />
        </>
      ) : (
        <p class="text-muted">Loading AI summary...</p>
      )}
    </div>
  );
}

function AlbumRecommendationsSection({ html }: { html?: string | null }) {
  return (
    <div id="album-recommendations" class="ai-summary" style={{ marginTop: '2rem' }}>
      <h3>Album Recommendations</h3>
      {html ? (
        <>
          <AiSummaryLabel />
          <div dangerouslySetInnerHTML={{ __html: html }} />
        </>
      ) : (
        <p class="text-muted">Loading recommendations...</p>
      )}
    </div>
  );
}

export function AlbumDetailPage({
  album,
  error,
  internalToken,
  currentUser,
  summaryHtml,
  recommendationsHtml,
  publicSummaries = false,
  signInRef = null,
}: AlbumDetailProps) {
  if (error || !album) {
    return (
      <Layout title="Album Not Found" currentUser={currentUser}>
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
  const currentPath = `/album/${album.id}`;
  const summaryRendered = Boolean(summaryHtml);
  const recommendationsRendered = Boolean(recommendationsHtml);
  // Signed-out visitors from lastfm-mcp already use Last.fm, so their prompt says so and carries the ref.
  const lastfmMcpRef = !currentUser && signInRef === 'lastfm-mcp' ? signInRef : undefined;

  return (
    <Layout
      title={`${album.name} by ${album.artist}`}
      description={`Listen to ${album.name} by ${album.artist}`}
      image={albumImage}
      url={`https://listentomore.com/album/${album.id}`}
      internalToken={internalToken}
      currentUser={currentUser}
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
              onerror="this.onerror=null;this.src='https://file.elezea.com/noun-no-image.png'"
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

          {/* AI Summary + Recommendations: cached content is public; generating it needs a login */}
          {!currentUser && (summaryRendered || recommendationsRendered) ? (
            <>
              {summaryRendered && <AlbumSummarySection html={summaryHtml} />}
              {recommendationsRendered && <AlbumRecommendationsSection html={recommendationsHtml} />}
              {lastfmMcpRef ? (
                <SignInCTA
                  currentPath={currentPath}
                  variant="lastfm-mcp"
                  entity="album"
                  summaryShown
                  signInRef={lastfmMcpRef}
                />
              ) : (
                <SignInCTA currentPath={currentPath} variant="personal" />
              )}
            </>
          ) : (
            <SignInGate
              currentUser={currentUser ?? null}
              currentPath={currentPath}
              variant={lastfmMcpRef ? 'lastfm-mcp' : undefined}
              entity="album"
              signInRef={lastfmMcpRef}
            >
              <AlbumSummarySection html={summaryHtml} />
              <AlbumRecommendationsSection html={recommendationsHtml} />
            </SignInGate>
          )}
        </section>
      </main>

      {/* Progressive loading script */}
      <script dangerouslySetInnerHTML={{ __html: `
        ${enrichLinksScript}
        ${aiContentClientScript(publicSummaries)}

        window.__AI_SUMMARY_RENDERED__ = ${summaryRendered};
        window.__AI_RECS_RENDERED__ = ${recommendationsRendered};

        (function() {
          var albumId = ${JSON.stringify(album.id)};
          var spotifyUrl = ${JSON.stringify(album.spotifyUrl)};
          // AI routes take the Spotify ID, not names: titles in a query string can trip the zone WAF.
          var aiQuery = '?spotifyId=' + encodeURIComponent(albumId);

          // Fetch streaming links
          internalFetch('/api/internal/streaming-links?spotifyId=' + encodeURIComponent(albumId) + '&type=album', { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (data.error) throw new Error(data.error);
              var links = data.data;
              var html = '<a href="' + spotifyUrl + '" target="_blank" rel="noopener noreferrer">Spotify ↗</a><br/>';
              if (links.appleUrl) html += '<a href="' + links.appleUrl + '" target="_blank" rel="noopener noreferrer">Apple Music ↗</a><br/>';
              if (links.songlinkUrl) html += '<a href="' + links.songlinkUrl + '" target="_blank" rel="noopener noreferrer">More services ↗</a><br/>';
              document.getElementById('streaming-links').innerHTML = html;
            })
            .catch(function(e) {
              console.error('Streaming links error:', e);
              // Keep just Spotify link on error
              document.getElementById('streaming-links').innerHTML = '<a href="' + spotifyUrl + '" target="_blank" rel="noopener noreferrer">Spotify ↗</a>';
            });

          // Server-rendered recommendations still need their search links enriched
          if (window.__AI_RECS_RENDERED__) {
            enrichLinks('album-recommendations');
          }

          // AI features - only fetch for authenticated users, and only what the server didn't render
          if (window.__IS_AUTHENTICATED__ && !window.__AI_SUMMARY_RENDERED__) {
            internalFetch('/api/internal/album-summary' + aiQuery, { cache: 'no-store' })
              .then(function(r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
              })
              .then(function(data) {
                if (data.error) throw new Error(data.error);
                var summary = data.data;
                // The model's "no information" reply is not a summary, so it gets no label
                if (isAiFallback(summary.content)) {
                  document.getElementById('ai-summary').innerHTML = '<p class="text-muted">AI summary not available for this album.</p>';
                  return;
                }
                var html = aiSummaryLabel + '<div>' + marked.parse(summary.content) + '</div>';
                document.getElementById('ai-summary').innerHTML = html;
              })
              .catch(function(e) {
                console.error('Album summary error:', e);
                document.getElementById('ai-summary').innerHTML = '<p class="text-muted">Unable to load AI summary.</p>';
              });
          }

          if (window.__IS_AUTHENTICATED__ && !window.__AI_RECS_RENDERED__) {
            internalFetch('/api/internal/album-recommendations' + aiQuery, { cache: 'no-store' })
              .then(function(r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
              })
              .then(function(data) {
                if (data.error) throw new Error(data.error);
                var recommendations = data.data;
                // The model's "no information" reply, in any case
                if (isAiFallback(recommendations.content)) {
                  document.getElementById('album-recommendations').innerHTML = '<h3>Album Recommendations</h3><p class="text-muted">Recommendations not available for this album.</p>';
                  return;
                }
                var html = '<h3>Album Recommendations</h3>';
                html += aiSummaryLabel;
                html += '<div>' + marked.parse(recommendations.content) + '</div>';
                document.getElementById('album-recommendations').innerHTML = html;
                // Enrich links: search links -> direct Spotify ID links
                enrichLinks('album-recommendations');
              })
              .catch(function(e) {
                console.error('Album recommendations error:', e);
                document.getElementById('album-recommendations').innerHTML = '<h3>Album Recommendations</h3><p class="text-muted">Unable to load recommendations.</p>';
              });
          }
        })();
      ` }} />
    </Layout>
  );
}

// Route handler: Spotify data, plus cached AI content when public summaries are on (never a model call)
export async function handleAlbumDetail(c: Context) {
  const spotifyId = c.req.param('id');

  // Legacy slug URLs (e.g. /album/radiohead_pablo-honey) predate ID-based routes; Spotify 400s them.
  if (!isSpotifyId(spotifyId)) {
    return c.html(<NotFoundPage />, 404);
  }
  const spotify = c.get('spotify') as SpotifyService;
  const internalToken = c.get('internalToken') as string;
  const currentUser = c.get('currentUser') as User | null;
  const signInRef = readRef(c.req.queries('ref'));

  try {
    // Fetch album data from Spotify (fast)
    const albumData = await spotify.getAlbum(spotifyId);

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

    // Same names resolveSpotifyAlbum passes to the generators, so the reads hit the keys they wrote.
    const publicSummaries = publicSummariesEnabled(c.env);
    let summaryHtml: string | null = null;
    let recommendationsHtml: string | null = null;
    if (publicSummaries) {
      const ai = c.get('ai') as AIService;
      [summaryHtml, recommendationsHtml] = await Promise.all([
        loadPublicSummary(() => ai.getCachedAlbumDetail(albumData.artist, albumData.name), 'album'),
        loadPublicSummary(
          () => ai.getCachedAlbumRecommendations(albumData.artist, albumData.name),
          'album recommendations'
        ),
      ]);
    }

    return c.html(
      <AlbumDetailPage
        album={album}
        internalToken={internalToken}
        currentUser={currentUser}
        summaryHtml={summaryHtml}
        recommendationsHtml={recommendationsHtml}
        publicSummaries={publicSummaries}
        signInRef={signInRef}
      />
    );
  } catch (error) {
    // A well-formed ID Spotify doesn't know; 404 so crawlers don't index a soft 404.
    if (error instanceof SpotifyNotFoundError) {
      return c.html(
        <AlbumDetailPage album={null} error="Album not found" internalToken={internalToken} currentUser={currentUser} />,
        404
      );
    }

    console.error('Album detail error:', error);

    // Check for rate limiting (429)
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('429')) {
      return c.html(<RateLimitedPage type="album" />, 503);
    }

    return c.html(<AlbumDetailPage album={null} error="Failed to load album" internalToken={internalToken} currentUser={currentUser} />);
  }
}
