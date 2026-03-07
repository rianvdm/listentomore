// Shared client-side JavaScript utilities
// These are exported as strings to be included in inline <script> tags
// Note: Markdown parsing is handled by the 'marked' library loaded via CDN in Layout.tsx

/**
 * enrichLinks - Enriches search links with Spotify IDs for direct navigation
 * Call this after inserting HTML with artist/album search links
 * Note: Uses internalFetch() which is defined in Layout.tsx and includes the auth token
 */
export const enrichLinksScript = `
function enrichLinks(containerId) {
  var container = document.getElementById(containerId);
  if (!container) return;

  // Enrich artist links
  var artistLinks = container.querySelectorAll('a[href^="/artist?q="]');
  artistLinks.forEach(function(link) {
    var href = link.getAttribute('href');
    var match = href.match(/\\/artist\\?q=([^&]+)/);
    if (!match) return;

    var query = match[1];
    internalFetch('/api/internal/search?q=' + query + '&type=artist')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.data && data.data[0] && data.data[0].id) {
          link.setAttribute('href', '/artist/' + data.data[0].id);
        }
      })
      .catch(function() { /* keep original search link */ });
  });

  // Enrich album links
  var albumLinks = container.querySelectorAll('a[href^="/album?q="]');
  albumLinks.forEach(function(link) {
    // Prefer data attributes for precise field-filter search
    var artist = link.getAttribute('data-artist');
    var album = link.getAttribute('data-album');
    
    var fetchUrl;
    if (artist && album) {
      // Use precise search with field filters
      fetchUrl = '/api/internal/search-album-by-artist?artist=' + encodeURIComponent(artist) + '&album=' + encodeURIComponent(album);
    } else {
      // Fall back to natural query search
      var href = link.getAttribute('href');
      var match = href.match(/\\/album\\?q=([^&]+)/);
      if (!match) return;
      fetchUrl = '/api/internal/search?q=' + match[1] + '&type=album';
    }

    internalFetch(fetchUrl)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.data && data.data[0] && data.data[0].id) {
          link.setAttribute('href', '/album/' + data.data[0].id);
        }
      })
      .catch(function() { /* keep original search link */ });
  });
}
`;

/**
 * enrichAlbumMentions - Finds "Album by Artist" in bold text and converts to links
 * Pattern: <strong>Album Name by Artist Name</strong>
 * First wraps in search link, then enriches with Spotify ID
 * Note: Uses internalFetch() which is defined in Layout.tsx and includes the auth token
 */
export const enrichAlbumMentionsScript = `
function enrichAlbumMentions(containerId) {
  var container = document.getElementById(containerId);
  if (!container) return;

  // Find all <strong> tags that might contain "Album by Artist" pattern
  var strongTags = container.querySelectorAll('strong');
  var albumsToEnrich = [];

  strongTags.forEach(function(strong) {
    var text = strong.textContent || '';
    // Match "Album Name by Artist Name" pattern
    var match = text.match(/^(.+?)\\s+by\\s+(.+)$/i);
    if (match && match[1] && match[2]) {
      var albumName = match[1].trim();
      var artistName = match[2].trim();
      var searchQuery = artistName + ' ' + albumName;

      // Wrap the strong tag content in a link
      var link = document.createElement('a');
      link.href = '/album?q=' + encodeURIComponent(searchQuery);
      link.textContent = text;
      strong.textContent = '';
      strong.appendChild(link);

      albumsToEnrich.push({
        link: link,
        artist: artistName,
        album: albumName
      });
    }
  });

  // Enrich with Spotify IDs (using precise field-filter search)
  albumsToEnrich.forEach(function(item) {
    internalFetch('/api/internal/search-album-by-artist?artist=' + encodeURIComponent(item.artist) + '&album=' + encodeURIComponent(item.album))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.data && data.data[0] && data.data[0].id) {
          item.link.href = '/album/' + data.data[0].id;
        }
      })
      .catch(function() { /* keep search link */ });
  });
}
`;

/**
 * Combined utility scripts - include all common functions
 */
export const clientUtilsScript = enrichLinksScript + enrichAlbumMentionsScript;
