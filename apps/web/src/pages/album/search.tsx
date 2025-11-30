// Album search page component
// Accepts album and artist query parameters, searches Spotify

import type { Context } from 'hono';
import { Layout } from '../../components/layout';
import { TrackCard, Input, Button } from '../../components/ui';
import type { SpotifyService } from '@listentomore/spotify';

interface AlbumSearchProps {
  albumQuery: string;
  artistQuery: string;
  results: Array<{
    id: string;
    name: string;
    artist: string;
    image?: string;
    year?: string;
  }>;
  error?: string;
}

export function AlbumSearchPage({ albumQuery, artistQuery, results, error }: AlbumSearchProps) {
  const hasQuery = albumQuery || artistQuery;

  return (
    <Layout title="Search Albums" description="Search for albums on Spotify">
      <h1>💿 Search Albums</h1>

      {/* Search Form - Two inputs like original */}
      <form id="search-form" action="/album" method="get">
        <Input
          type="text"
          name="album"
          placeholder="Enter album name..."
          value={albumQuery}
          style={{ maxWidth: '200px' }}
        />
        <Input
          type="text"
          name="artist"
          placeholder="Enter artist name..."
          value={artistQuery}
          style={{ maxWidth: '200px' }}
        />
        <Button type="submit">Search</Button>
      </form>

      {/* Error */}
      {error && (
        <p class="error-message">{error}</p>
      )}

      {/* Results */}
      {hasQuery && !error && (
        <div class="section">
          {results.length > 0 ? (
            <>
              <h2 class="section-title">
                Results for "{[albumQuery, artistQuery].filter(Boolean).join(' by ')}"
              </h2>
              <div class="track-grid">
                {results.map((album) => (
                  <TrackCard
                    key={album.id}
                    artist={album.artist}
                    name={album.name}
                    album={album.year}
                    imageUrl={album.image}
                    href={`/album/spotify:${album.id}`}
                  />
                ))}
              </div>
            </>
          ) : (
            <p class="text-center text-muted mt-4">
              No albums found for "{[albumQuery, artistQuery].filter(Boolean).join(' by ')}". Try a different search term.
            </p>
          )}
        </div>
      )}

      {/* Empty State */}
      {!hasQuery && (
        <div class="section text-center">
          <p class="text-muted">
            Enter an album name and/or artist name to search.
          </p>
        </div>
      )}
    </Layout>
  );
}

// Route handler
export async function handleAlbumSearch(c: Context) {
  // Support both single query param and separate album/artist params
  const albumQuery = c.req.query('album') || '';
  const artistQuery = c.req.query('artist') || '';
  const legacyQuery = c.req.query('q') || '';

  // Use legacy 'q' param if no album/artist specified
  const searchAlbum = albumQuery || legacyQuery;
  const searchArtist = artistQuery;

  const spotify = c.get('spotify') as SpotifyService;

  let results: AlbumSearchProps['results'] = [];
  let error: string | undefined;

  if (searchAlbum || searchArtist) {
    try {
      // Build Spotify search query
      let spotifyQuery = '';
      if (searchAlbum && searchArtist) {
        spotifyQuery = `album:"${searchAlbum}" artist:${searchArtist}`;
      } else if (searchAlbum) {
        spotifyQuery = searchAlbum;
      } else if (searchArtist) {
        spotifyQuery = `artist:${searchArtist}`;
      }

      // SpotifySearch already transforms the results
      const searchResults = await spotify.search.search(spotifyQuery, 'album', 12);
      results = searchResults.map((album) => ({
        id: album.id,
        name: album.name,
        artist: album.artist,
        image: album.image || undefined,
        year: album.releaseDate?.split('-')[0],
      }));
    } catch (err) {
      console.error('Album search error:', err);
      error = 'Search failed. Please try again.';
    }
  }

  return c.html(
    <AlbumSearchPage
      albumQuery={searchAlbum}
      artistQuery={searchArtist}
      results={results}
      error={error}
    />
  );
}
