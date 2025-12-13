// Artist search page component
// Renders immediately, loads results progressively via client-side JS

import type { Context } from 'hono';
import type { User } from '@listentomore/db';
import { Layout } from '../../components/layout';
import { Input, Button, LoadingSpinner } from '../../components/ui';

interface ArtistSearchProps {
  query: string;
  internalToken?: string;
  currentUser?: User | null;
}

export function ArtistSearchPage({ query, internalToken, currentUser }: ArtistSearchProps) {
  return (
    <Layout title="Search Artists" description="Search for artists on Spotify" internalToken={internalToken} currentUser={currentUser}>
      <h1>🎤 Search Artists</h1>

      {/* Search Form */}
      <form id="search-form" action="/artist" method="get">
        <Input
          type="text"
          name="q"
          placeholder="Enter artist name..."
          value={query}
          autofocus
        />
        <Button type="submit">Search</Button>
      </form>

      {/* Results container - populated by JS */}
      {query ? (
        <div class="section">
          <h2 class="section-title">Results for "{query}"</h2>
          <div id="search-results">
            <LoadingSpinner />
          </div>
        </div>
      ) : (
        <div class="section text-center">
          <p class="text-muted">Enter an artist name to search.</p>
        </div>
      )}

      {/* Progressive loading script */}
      {query && (
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            var query = ${JSON.stringify(query)};
            var container = document.getElementById('search-results');

            internalFetch('/api/internal/search?type=artist&q=' + encodeURIComponent(query))
              .then(function(r) { return r.json(); })
              .then(function(response) {
                if (response.error) throw new Error(response.error);
                var results = response.data || [];

                if (results.length === 0) {
                  container.innerHTML = '<p class="text-center text-muted mt-4">No artists found for "' + query + '". Try a different search term.</p>';
                  return;
                }

                var html = '<div class="track-grid">';
                results.forEach(function(artist) {
                  html += '<a href="/artist/' + artist.id + '" class="track">';
                  if (artist.image) {
                    html += '<img src="' + artist.image + '" alt="' + artist.name.replace(/"/g, '&quot;') + '" class="track-image" style="border-radius:50%;" loading="lazy" onerror="this.onerror=null;this.src=\\'https://file.elezea.com/noun-no-image.png\\'" />';
                  } else {
                    html += '<div class="track-image" style="border-radius:50%;background:rgba(var(--c-accent-rgb),0.2);display:flex;align-items:center;justify-content:center;font-size:3rem;">' + artist.name.charAt(0) + '</div>';
                  }
                  html += '<div class="track-content">';
                  html += '<p class="track-artist">' + artist.name + '</p>';
                  html += '</div></a>';
                });
                html += '</div>';
                container.innerHTML = html;
              })
              .catch(function(e) {
                console.error('Search error:', e);
                container.innerHTML = '<p class="error-message">Search failed. Please try again.</p>';
              });
          })();
        ` }} />
      )}
    </Layout>
  );
}

// Route handler - renders immediately, no API call
export async function handleArtistSearch(c: Context) {
  const query = c.req.query('q') || '';
  const internalToken = c.get('internalToken') as string;
  const currentUser = c.get('currentUser');
  return c.html(<ArtistSearchPage query={query} internalToken={internalToken} currentUser={currentUser} />);
}
