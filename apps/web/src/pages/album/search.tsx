// Album search page component
// Accepts q query parameter, searches Spotify

import type { Context } from 'hono';
import { Layout } from '../../components/layout';
import { TrackCard, Input, Button } from '../../components/ui';
import type { SpotifyService } from '@listentomore/spotify';

interface AlbumSearchProps {
  query: string;
  results: Array<{
    id: string;
    name: string;
    artist: string;
    image?: string;
    year?: string;
  }>;
  error?: string;
}

export function AlbumSearchPage({ query, results, error }: AlbumSearchProps) {
  return (
    <Layout title="Search Albums" description="Search for albums on Spotify">
      <h1>💿 Search Albums</h1>

      {/* Search Form */}
      <form id="search-form" action="/album" method="get">
        <Input
          type="text"
          name="q"
          placeholder="Search for an album..."
          value={query}
          style={{ maxWidth: '300px' }}
        />
        <Button type="submit">Search</Button>
      </form>

      {/* Error */}
      {error && (
        <p class="error-message">{error}</p>
      )}

      {/* Results */}
      {query && !error && (
        <div class="section">
          {results.length > 0 ? (
            <>
              <h2 class="section-title">Results for "{query}"</h2>
              <div class="track-grid">
                {results.map((album) => (
                  <TrackCard
                    key={album.id}
                    artist={album.artist}
                    name={album.name}
                    album={album.year}
                    imageUrl={album.image}
                    href={`/album/${album.id}`}
                  />
                ))}
              </div>
            </>
          ) : (
            <p class="text-center text-muted mt-4">
              No albums found for "{query}". Try a different search term.
            </p>
          )}
        </div>
      )}

      {/* Empty State */}
      {!query && (
        <div class="section text-center">
          <p class="text-muted">
            Enter an album name to search.
          </p>
        </div>
      )}
    </Layout>
  );
}

// Route handler
export async function handleAlbumSearch(c: Context) {
  const query = c.req.query('q') || '';
  const spotify = c.get('spotify') as SpotifyService;

  let results: AlbumSearchProps['results'] = [];
  let error: string | undefined;

  if (query) {
    try {
      const searchResults = await spotify.search.search(query, 'album', 12);
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
      query={query}
      results={results}
      error={error}
    />
  );
}
