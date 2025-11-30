// Genre search/browse page
// URL: /genre

import type { Context } from 'hono';
import { Layout } from '../../components/layout';
import { GENRES, slugToDisplayName, getRandomGenre } from '../../data/genres';

interface GenreSearchPageProps {
  query?: string;
  results?: Array<{ slug: string; displayName: string }>;
}

export function GenreSearchPage({ query, results }: GenreSearchPageProps) {
  const randomGenre = getRandomGenre();

  return (
    <Layout title="Browse Genres" description="Explore music genres and learn about their history">
      <header>
        <h1>Browse Genres</h1>
      </header>

      <main>
        {/* Search Form */}
        <form id="search-form" action="/genre" method="get">
          <input
            type="text"
            name="q"
            class="input"
            placeholder="Search genres..."
            value={query || ''}
            autocomplete="off"
          />
          <button type="submit" class="button">Search</button>
        </form>

        {/* Random Genre Suggestion */}
        {!query && (
          <p class="text-center">
            Or explore a random genre like{' '}
            <a href={`/genre/${randomGenre.slug}`}>
              <strong>{randomGenre.displayName}</strong>
            </a>
          </p>
        )}

        {/* Search Results */}
        {query && results && (
          <section>
            <h2 class="text-center">
              {results.length > 0
                ? `Found ${results.length} genre${results.length === 1 ? '' : 's'}`
                : 'No genres found'}
            </h2>
            {results.length > 0 ? (
              <div class="genre-grid">
                {results.map((genre) => (
                  <a key={genre.slug} href={`/genre/${genre.slug}`} class="genre-card">
                    {genre.displayName}
                  </a>
                ))}
              </div>
            ) : (
              <p class="text-center text-muted">
                Try a different search term or{' '}
                <a href="/genre">browse all genres</a>.
              </p>
            )}
          </section>
        )}

        {/* All Genres (when no search) */}
        {!query && (
          <section>
            <h2 class="text-center">All Genres</h2>
            <div class="genre-grid">
              {GENRES.map((slug) => (
                <a key={slug} href={`/genre/${slug}`} class="genre-card">
                  {slugToDisplayName(slug)}
                </a>
              ))}
            </div>
          </section>
        )}
      </main>
    </Layout>
  );
}

// Route handler
export async function handleGenreSearch(c: Context) {
  const query = c.req.query('q')?.toLowerCase().trim();

  if (!query) {
    return c.html(<GenreSearchPage />);
  }

  // Search genres by matching query against display names
  const results = GENRES
    .map((slug) => ({
      slug,
      displayName: slugToDisplayName(slug),
    }))
    .filter(
      (genre) =>
        genre.displayName.toLowerCase().includes(query) ||
        genre.slug.includes(query)
    );

  return c.html(<GenreSearchPage query={query} results={results} />);
}
