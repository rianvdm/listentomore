// Artist search page component
// Shows search form and results

import type { Context } from 'hono';
import { Layout } from '../../components/layout';
import { Input, Button } from '../../components/ui';
import type { SpotifyService } from '@listentomore/spotify';

interface ArtistResult {
  id: string;
  name: string;
  image?: string;
  genres: string[];
  followers?: number;
}

interface ArtistSearchProps {
  query: string;
  results: ArtistResult[];
}

export function ArtistSearchPage({ query, results }: ArtistSearchProps) {
  return (
    <Layout title="Search Artists" description="Search for artists on Spotify">
      <h1>Search Artists</h1>

      {/* Search Form */}
      <form action="/artist" method="get" class="search-form">
        <Input
          type="search"
          name="q"
          placeholder="Enter artist name..."
          value={query}
          autofocus
        />
        <Button type="submit">Search</Button>
      </form>

      {/* Results */}
      {query && (
        <div class="section">
          {results.length > 0 ? (
            <>
              <h2 class="section-title">
                Results for "{query}"
              </h2>
              <div class="track-grid">
                {results.map((artist) => (
                  <a href={`/artist/spotify:${artist.id}`} key={artist.id} class="track">
                    {artist.image ? (
                      <img
                        src={artist.image}
                        alt={artist.name}
                        class="track-image"
                        style={{ borderRadius: '50%' }}
                        loading="lazy"
                      />
                    ) : (
                      <div
                        class="track-image"
                        style={{
                          borderRadius: '50%',
                          backgroundColor: 'rgba(var(--c-accent-rgb), 0.2)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '3rem',
                        }}
                      >
                        {artist.name.charAt(0)}
                      </div>
                    )}
                    <div class="track-content">
                      <p class="track-artist">{artist.name}</p>
                      {artist.genres.length > 0 && (
                        <p class="track-name" style={{ fontSize: '13px', opacity: 0.7 }}>
                          {artist.genres.slice(0, 2).join(', ')}
                        </p>
                      )}
                    </div>
                  </a>
                ))}
              </div>
            </>
          ) : (
            <p class="text-center text-muted mt-4">
              No artists found for "{query}". Try a different search term.
            </p>
          )}
        </div>
      )}

      {/* Empty State */}
      {!query && (
        <div class="section text-center">
          <p class="text-muted">
            Enter an artist name to search.
          </p>
        </div>
      )}
    </Layout>
  );
}

// Route handler
export async function handleArtistSearch(c: Context) {
  const query = c.req.query('q') || '';
  const spotify = c.get('spotify') as SpotifyService;

  let results: ArtistResult[] = [];

  if (query) {
    try {
      // SpotifySearch already transforms the results (but doesn't include genres/followers)
      const searchResults = await spotify.search.search(query, 'artist', 12);
      results = searchResults.map((artist) => ({
        id: artist.id,
        name: artist.name,
        image: artist.image || undefined,
        genres: [], // Basic search doesn't include genres
        followers: undefined,
      }));
    } catch (error) {
      console.error('Artist search error:', error);
    }
  }

  return c.html(<ArtistSearchPage query={query} results={results} />);
}
