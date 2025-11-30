// Album detail page component
// Shows album info, streaming links, and AI summary using image-text-wrapper layout

import type { Context } from 'hono';
import { Layout } from '../../components/layout';
import type { SpotifyService } from '@listentomore/spotify';
import type { AIService } from '@listentomore/ai';
import type { SonglinkService } from '@listentomore/songlink';

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

interface StreamingLink {
  platform: string;
  url: string;
}

interface AlbumDetailProps {
  album: AlbumData | null;
  aiSummary?: {
    text: string;
    citations?: string[];
  };
  streamingLinks: StreamingLink[];
  error?: string;
}

export function AlbumDetailPage({ album, aiSummary, streamingLinks, error }: AlbumDetailProps) {
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
    >
      {/* Header with linked artist */}
      <header>
        <h1>
          {album.name} by{' '}
          {album.artistId ? (
            <a href={`/artist/spotify:${album.artistId}`}>{album.artist}</a>
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

              <p>
                <strong>Streaming:</strong>
                <br />
                {streamingLinks.length > 0 ? (
                  streamingLinks.map((link) => (
                    <>
                      <a href={link.url} target="_blank" rel="noopener noreferrer">
                        {link.platform} ↗
                      </a>
                      <br />
                    </>
                  ))
                ) : (
                  <a href={album.spotifyUrl} target="_blank" rel="noopener noreferrer">
                    Spotify ↗
                  </a>
                )}
              </p>
            </div>
          </div>

          {/* AI Summary */}
          {aiSummary?.text && (
            <div>
              <p>{aiSummary.text}</p>
              {aiSummary.citations && aiSummary.citations.length > 0 && (
                <div class="citations" style={{ marginTop: '1rem' }}>
                  <h4>Sources</h4>
                  <ul>
                    {aiSummary.citations.map((citation, i) => {
                      let hostname = '';
                      try {
                        hostname = new URL(citation).hostname.replace('www.', '');
                      } catch {
                        hostname = citation;
                      }
                      return (
                        <li key={i}>
                          <span class="citation-number">[{i + 1}]</span>{' '}
                          <a href={citation} target="_blank" rel="noopener noreferrer">
                            {hostname}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>
      </main>
    </Layout>
  );
}

// Route handler
export async function handleAlbumDetail(c: Context) {
  const idParam = c.req.param('id');

  // Parse spotify:ID format
  let spotifyId = idParam;
  if (idParam.startsWith('spotify:')) {
    spotifyId = idParam.slice(8);
  }

  const spotify = c.get('spotify') as SpotifyService;
  const ai = c.get('ai') as AIService;
  const songlink = c.get('songlink') as SonglinkService;

  try {
    // Fetch album data
    const albumData = await spotify.getAlbum(spotifyId);

    if (!albumData) {
      return c.html(<AlbumDetailPage album={null} streamingLinks={[]} error="Album not found" />);
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

    // Fetch AI summary and streaming links in parallel
    const [aiSummary, songlinkData] = await Promise.all([
      ai.getAlbumDetail(album.artist, album.name).catch(() => null),
      songlink.getLinks(album.spotifyUrl).catch(() => null),
    ]);

    // Format streaming links
    const streamingLinks: StreamingLink[] = [];
    if (songlinkData?.linksByPlatform) {
      const platformNames: Record<string, string> = {
        spotify: 'Spotify',
        appleMusic: 'Apple Music',
        youtube: 'YouTube',
        amazonMusic: 'Amazon Music',
        tidal: 'Tidal',
        deezer: 'Deezer',
      };

      // Add Spotify first (from our album data)
      streamingLinks.push({ platform: 'Spotify', url: album.spotifyUrl });

      for (const [platform, data] of Object.entries(songlinkData.linksByPlatform)) {
        if (platform !== 'spotify' && platformNames[platform] && data?.url) {
          streamingLinks.push({
            platform: platformNames[platform],
            url: data.url,
          });
        }
      }

      // Add Songlink page
      if (songlinkData.pageUrl) {
        streamingLinks.push({ platform: 'Songlink', url: songlinkData.pageUrl });
      }
    } else {
      // Fallback to just Spotify
      streamingLinks.push({ platform: 'Spotify', url: album.spotifyUrl });
    }

    return c.html(
      <AlbumDetailPage
        album={album}
        aiSummary={aiSummary ? { text: aiSummary.text, citations: aiSummary.citations } : undefined}
        streamingLinks={streamingLinks}
      />
    );
  } catch (error) {
    console.error('Album detail error:', error);
    return c.html(<AlbumDetailPage album={null} streamingLinks={[]} error="Failed to load album" />);
  }
}
