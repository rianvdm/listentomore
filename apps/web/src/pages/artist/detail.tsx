// Artist detail page component
// Shows artist info, top albums, similar artists, and AI overview using image-text-wrapper layout

import type { Context } from 'hono';
import { Layout } from '../../components/layout';
import type { SpotifyService } from '@listentomore/spotify';
import type { LastfmService } from '@listentomore/lastfm';
import type { AIService } from '@listentomore/ai';

interface ArtistData {
  id: string;
  name: string;
  image?: string;
  genres: string[];
  userPlaycount?: number;
  spotifyUrl: string;
}

interface TopAlbum {
  id: string;
  name: string;
}

interface ArtistDetailProps {
  artist: ArtistData | null;
  topAlbums: TopAlbum[];
  similarArtists: string[];
  aiSummary?: string;
  error?: string;
}

export function ArtistDetailPage({
  artist,
  topAlbums,
  similarArtists,
  aiSummary,
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
  const formattedPlaycount = artist.userPlaycount
    ? new Intl.NumberFormat().format(artist.userPlaycount)
    : '0';

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

              <p>
                <strong>My playcount:</strong> {formattedPlaycount} plays
              </p>

              <p style={{ marginBottom: '0.2em' }}>
                <strong>Popular Albums:</strong>
              </p>
              <ul>
                {topAlbums.length > 0 ? (
                  topAlbums.map((album) => (
                    <li key={album.id}>
                      <a href={`/album/spotify:${album.id}`}>{album.name}</a>
                    </li>
                  ))
                ) : (
                  <li>No albums found</li>
                )}
              </ul>
            </div>
          </div>

          {/* Similar Artists */}
          {similarArtists.length > 0 && (
            <>
              <p style={{ marginBottom: '0.2em' }}>
                <strong>Similar Artists:</strong>
              </p>
              <ul style={{ listStyleType: 'none', paddingLeft: '0', marginTop: '0' }}>
                {similarArtists.map((name) => (
                  <li key={name}>
                    <a href={`/artist?q=${encodeURIComponent(name)}`}>{name}</a>
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* AI Overview */}
          {aiSummary && (
            <>
              <p style={{ marginTop: '1.5em', marginBottom: '0.2em' }}>
                <strong>Overview:</strong>
              </p>
              <div dangerouslySetInnerHTML={{ __html: formatArtistLinks(aiSummary) }} />
            </>
          )}
        </section>
      </main>
    </Layout>
  );
}

// Convert [[Artist Name]] to links and {{Album Name}} to italic
function formatArtistLinks(text: string): string {
  return text
    .replace(/\[\[([^\]]+)\]\]/g, (_, name) => {
      return `<a href="/artist?q=${encodeURIComponent(name)}">${name}</a>`;
    })
    .replace(/\{\{([^}]+)\}\}/g, (_, name) => {
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
  const lastfm = c.get('lastfm') as LastfmService;
  const ai = c.get('ai') as AIService;

  try {
    // Fetch artist data from Spotify
    const artistData = await spotify.getArtist(spotifyId);

    if (!artistData) {
      return c.html(
        <ArtistDetailPage
          artist={null}
          topAlbums={[]}
          similarArtists={[]}
          error="Artist not found"
        />
      );
    }

    const artist: ArtistData = {
      id: artistData.id,
      name: artistData.name,
      image: artistData.image || undefined,
      genres: artistData.genres || [],
      spotifyUrl: artistData.url,
    };

    // Fetch additional data in parallel
    const [lastfmData, topAlbumsData, aiSummary] = await Promise.all([
      // Last.fm for playcount and similar artists
      lastfm.getArtistDetail(artist.name).catch(() => null),
      // Spotify for top albums
      spotify.getArtistAlbums(spotifyId, 3).catch(() => []),
      // AI for overview
      ai.getArtistSummary(artist.name).catch(() => null),
    ]);

    // Add playcount from Last.fm
    if (lastfmData) {
      artist.userPlaycount = lastfmData.userPlaycount;
    }

    // Format top albums
    const topAlbums: TopAlbum[] = topAlbumsData.map((album) => ({
      id: album.id,
      name: album.name,
    }));

    // Get similar artists from Last.fm
    const similarArtists = lastfmData?.similar || [];

    return c.html(
      <ArtistDetailPage
        artist={artist}
        topAlbums={topAlbums}
        similarArtists={similarArtists}
        aiSummary={aiSummary?.text}
      />
    );
  } catch (error) {
    console.error('Artist detail error:', error);
    return c.html(
      <ArtistDetailPage
        artist={null}
        topAlbums={[]}
        similarArtists={[]}
        error="Failed to load artist"
      />
    );
  }
}
