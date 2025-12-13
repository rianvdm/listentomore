// Genre search/browse page
// URL: /genre

import type { Context } from 'hono';
import type { User } from '@listentomore/db';
import { Layout } from '../../components/layout';
import { POPULAR_GENRES, slugToDisplayName, getRandomGenre, displayNameToSlug } from '../../data/genres';

interface GenreSearchProps {
  currentUser?: User | null;
}

export function GenreSearchPage({ currentUser }: GenreSearchProps) {
  const randomGenre = getRandomGenre();

  return (
    <Layout title="Browse Genres" description="Explore music genres and learn about their history" currentUser={currentUser}>
      <header>
        <h1>Browse Genres</h1>
      </header>

      <main>
        {/* Search Form - redirects to genre detail page */}
        <form id="search-form" action="/genre" method="get">
          <input
            type="text"
            name="q"
            class="input"
            placeholder="Search any genre..."
            autocomplete="off"
          />
          <button type="submit" class="button">Search</button>
        </form>

        {/* Random Genre Suggestion */}
        <p class="text-center">
          Or explore a random genre like{' '}
          <a href={`/genre/${randomGenre.slug}`}>
            <strong>{randomGenre.displayName}</strong>
          </a>
        </p>

        {/* Popular Genres */}
        <section>
          <h2 class="text-center">Popular Genres</h2>
          <div class="genre-grid">
            {POPULAR_GENRES.map((slug) => (
              <a key={slug} href={`/genre/${slug}`} class="genre-card">
                {slugToDisplayName(slug)}
              </a>
            ))}
          </div>
        </section>
      </main>
    </Layout>
  );
}

// Route handler
export async function handleGenreSearch(c: Context) {
  const query = c.req.query('q')?.trim();
  const currentUser = c.get('currentUser');

  if (!query) {
    return c.html(<GenreSearchPage currentUser={currentUser} />);
  }

  // Redirect to genre detail page with the search term as slug
  const slug = displayNameToSlug(query);
  return c.redirect(`/genre/${slug}`);
}
