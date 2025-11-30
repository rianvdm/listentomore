// Artist detail page component
// Shows artist info, AI summary, top albums, and related artists

import type { Context } from 'hono';
import { Layout } from '../../components/layout';
import { TrackCard } from '../../components/ui';
import type { SpotifyService } from '@listentomore/spotify';
import type { AIService } from '@listentomore/ai';
import type { LastfmService } from '@listentomore/lastfm';

interface ArtistData {
  id: string;
  name: string;
  image?: string;
  genres: string[];
  followers?: number;
  spotifyUrl: string;
}

interface TopAlbum {
  id: string;
  name: string;
  image?: string;
  year?: string;
}

interface ArtistDetailProps {
  artist: ArtistData | null;
  aiSummary?: {
    text: string;
    formattedText?: string;
  };
  topAlbums?: TopAlbum[];
  error?: string;
}

export function ArtistDetailPage({ artist, aiSummary, topAlbums, error }: ArtistDetailProps) {
  if (error || !artist) {
    return (
      <Layout title="Artist Not Found">
        <div class="text-center" style={{ paddingTop: '4rem' }}>
          <h1>Artist Not Found</h1>
          <p class="text-muted">{error || 'The artist you requested could not be found.'}</p>
          <p class="mt-2">
            <a href="/artist" class="button">Search Artists</a>
          </p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={artist.name} description={`Learn about ${artist.name} - discography, bio, and more`}>
      {/* Artist Header */}
      <div class="detail-header">
        {artist.image ? (
          <img src={artist.image} alt={artist.name} class="detail-image" style={{ borderRadius: '50%' }} />
        ) : (
          <div
            class="detail-image"
            style={{
              borderRadius: '50%',
              backgroundColor: 'rgba(var(--c-accent-rgb), 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '4rem',
            }}
          >
            {artist.name.charAt(0)}
          </div>
        )}
        <div class="detail-info">
          <h1 class="detail-title">{artist.name}</h1>
          {artist.followers && (
            <p class="detail-meta">
              {artist.followers.toLocaleString()} followers on Spotify
            </p>
          )}

          {/* Genre Tags */}
          {artist.genres.length > 0 && (
            <div class="genre-tags">
              {artist.genres.slice(0, 5).map((genre) => (
                <a href={`/genre/${encodeURIComponent(genre.toLowerCase().replace(/\s+/g, '-'))}`} class="genre-tag">
                  {genre}
                </a>
              ))}
            </div>
          )}

          {/* Spotify Link */}
          <div class="mt-2">
            <a href={artist.spotifyUrl} target="_blank" rel="noopener noreferrer" class="button button--secondary">
              Open in Spotify
            </a>
          </div>
        </div>
      </div>

      {/* AI Summary */}
      {aiSummary?.text && (
        <div class="section">
          <h3>About {artist.name}</h3>
          <div class="card">
            {aiSummary.formattedText ? (
              <div dangerouslySetInnerHTML={{ __html: aiSummary.formattedText }} />
            ) : (
              <p>{aiSummary.text}</p>
            )}
          </div>
        </div>
      )}

      {/* Top Albums */}
      {topAlbums && topAlbums.length > 0 && (
        <div class="section">
          <h3>Popular Albums</h3>
          <div class="track-grid">
            {topAlbums.map((album) => (
              <TrackCard
                key={album.id}
                artist={artist.name}
                name={album.name}
                album={album.year}
                imageUrl={album.image}
                href={`/album/spotify:${album.id}`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Spotify Embed */}
      <div class="section">
        <iframe
          src={`https://open.spotify.com/embed/artist/${artist.id}?utm_source=generator&theme=0`}
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

// Convert [[Artist Name]] to links
function formatArtistLinks(text: string): string {
  return text.replace(/\[\[([^\]]+)\]\]/g, (_, name) => {
    const slug = name.toLowerCase().replace(/\s+/g, '-');
    return `<a href="/artist?q=${encodeURIComponent(name)}">${name}</a>`;
  }).replace(/\{\{([^}]+)\}\}/g, (_, name) => {
    return `<em>${name}</em>`;
  });
}

// Route handler
export async function handleArtistDetail(c: Context) {
  const idParam = c.req.param('id');

  // Parse spotify:ID format
  let spotifyId = idParam;
  if (idParam.startsWith('spotify:')) {
    spotifyId = idParam.slice(8);
  }

  const spotify = c.get('spotify') as SpotifyService;
  const ai = c.get('ai') as AIService;

  try {
    // Fetch artist data (already transformed by SpotifyArtists)
    const artistData = await spotify.getArtist(spotifyId);

    if (!artistData) {
      return c.html(<ArtistDetailPage artist={null} error="Artist not found" />);
    }

    const artist: ArtistData = {
      id: artistData.id,
      name: artistData.name,
      image: artistData.image || undefined,
      genres: artistData.genres || [],
      followers: artistData.followers,
      spotifyUrl: artistData.url,
    };

    // Fetch AI summary and top albums in parallel
    const [aiSummary, topAlbumsData] = await Promise.all([
      ai.getArtistSummary(artist.name).catch(() => null),
      spotify.getArtistAlbums(spotifyId, 6).catch(() => []),
    ]);

    // Format top albums (getArtistAlbums returns raw Spotify format)
    const topAlbums: TopAlbum[] = topAlbumsData.map((album) => ({
      id: album.id,
      name: album.name,
      image: album.images[0]?.url,
      year: album.release_date?.split('-')[0],
    }));

    return c.html(
      <ArtistDetailPage
        artist={artist}
        aiSummary={aiSummary ? {
          text: aiSummary.text,
          formattedText: formatArtistLinks(aiSummary.text),
        } : undefined}
        topAlbums={topAlbums}
      />
    );
  } catch (error) {
    console.error('Artist detail error:', error);
    return c.html(<ArtistDetailPage artist={null} error="Failed to load artist" />);
  }
}
