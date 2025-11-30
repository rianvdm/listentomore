// Album detail page component
// Shows album info, AI summary, and streaming links

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
  releaseDate?: string;
  totalTracks: number;
  genres: string[];
  spotifyUrl: string;
  tracks: Array<{
    number: number;
    name: string;
    duration: string;
  }>;
}

interface AlbumDetailProps {
  album: AlbumData | null;
  aiSummary?: {
    text: string;
    citations?: string[];
  };
  streamingLinks?: Array<{
    platform: string;
    url: string;
  }>;
  error?: string;
}

export function AlbumDetailPage({ album, aiSummary, streamingLinks, error }: AlbumDetailProps) {
  if (error || !album) {
    return (
      <Layout title="Album Not Found">
        <div class="text-center" style={{ paddingTop: '4rem' }}>
          <h1>Album Not Found</h1>
          <p class="text-muted">{error || 'The album you requested could not be found.'}</p>
          <p class="mt-2">
            <a href="/album" class="button">Search Albums</a>
          </p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={`${album.name} by ${album.artist}`} description={`Listen to ${album.name} by ${album.artist}`}>
      {/* Album Header */}
      <div class="detail-header">
        {album.image && (
          <img src={album.image} alt={album.name} class="detail-image" />
        )}
        <div class="detail-info">
          <h1 class="detail-title">{album.name}</h1>
          <p class="detail-subtitle">
            <a href={album.artistId ? `/artist/spotify:${album.artistId}` : '#'}>{album.artist}</a>
          </p>
          <p class="detail-meta">
            {album.releaseDate && `Released ${album.releaseDate}`}
            {album.totalTracks && ` · ${album.totalTracks} tracks`}
          </p>

          {/* Genre Tags */}
          {album.genres.length > 0 && (
            <div class="genre-tags">
              {album.genres.map((genre) => (
                <a href={`/genre/${encodeURIComponent(genre.toLowerCase().replace(/\s+/g, '-'))}`} class="genre-tag">
                  {genre}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Streaming Links */}
      {streamingLinks && streamingLinks.length > 0 && (
        <div class="section">
          <h3>Listen on</h3>
          <div class="streaming-links">
            {streamingLinks.map((link) => (
              <a href={link.url} target="_blank" rel="noopener noreferrer" class="streaming-link">
                {link.platform}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* AI Summary */}
      {aiSummary?.text && (
        <div class="section">
          <h3>About this album</h3>
          <div class="card">
            <p>{aiSummary.text}</p>
            {aiSummary.citations && aiSummary.citations.length > 0 && (
              <div class="mt-2">
                <p class="text-muted footnote">Sources:</p>
                <ul style={{ fontSize: '12px', opacity: 0.7 }}>
                  {aiSummary.citations.map((citation, i) => (
                    <li key={i}>
                      <a href={citation} target="_blank" rel="noopener noreferrer">
                        {new URL(citation).hostname}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Track List */}
      {album.tracks.length > 0 && (
        <div class="section">
          <h3>Tracks</h3>
          <table>
            <tbody>
              {album.tracks.map((track) => (
                <tr key={track.number}>
                  <td style={{ width: '30px', opacity: 0.5 }}>{track.number}</td>
                  <td>{track.name}</td>
                  <td style={{ width: '60px', textAlign: 'right', opacity: 0.5 }}>{track.duration}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Spotify Embed */}
      <div class="section">
        <iframe
          src={`https://open.spotify.com/embed/album/${album.id}?utm_source=generator&theme=0`}
          width="100%"
          height="352"
          frameBorder="0"
          allowFullScreen
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy"
          class="spotify-iframe"
        />
      </div>
    </Layout>
  );
}

// Format duration from ms to mm:ss
function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
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
    // Fetch album data (already transformed by SpotifyAlbums)
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
      releaseDate: albumData.releaseDate,
      totalTracks: albumData.tracks,
      genres: albumData.genres || [],
      spotifyUrl: albumData.url,
      tracks: albumData.trackList.map((track) => ({
        number: track.number,
        name: track.name,
        duration: formatDuration(track.duration),
      })),
    };

    // Fetch AI summary and streaming links in parallel
    const [aiSummary, songlinkData] = await Promise.all([
      ai.getAlbumDetail(album.artist, album.name).catch(() => null),
      songlink.getLinks(album.spotifyUrl).catch(() => null),
    ]);

    // Format streaming links
    const streamingLinks: AlbumDetailProps['streamingLinks'] = [];
    if (songlinkData?.linksByPlatform) {
      const platformNames: Record<string, string> = {
        spotify: 'Spotify',
        appleMusic: 'Apple Music',
        youtube: 'YouTube',
        youtubeMusic: 'YouTube Music',
        amazonMusic: 'Amazon Music',
        tidal: 'Tidal',
        deezer: 'Deezer',
        soundcloud: 'SoundCloud',
      };

      for (const [platform, data] of Object.entries(songlinkData.linksByPlatform)) {
        if (platformNames[platform] && data?.url) {
          streamingLinks.push({
            platform: platformNames[platform],
            url: data.url,
          });
        }
      }
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
    return c.html(<AlbumDetailPage album={null} error="Failed to load album" />);
  }
}
