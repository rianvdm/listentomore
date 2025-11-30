// Shared client-side JavaScript utilities
// These are exported as strings to be included in inline <script> tags

/**
 * formatMarkdown - Converts markdown text to HTML
 * Handles: headers, bold, italic, links, bullet points, paragraphs
 */
export const formatMarkdownScript = `
function formatMarkdown(text) {
  if (!text) return '';

  var result = text
    // Headers (must be before other processing)
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h4>$1</h4>')
    // Convert listentomore.com artist URLs to local search
    .replace(/\\[([^\\]]+)\\]\\(https:\\/\\/listentomore\\.com\\/artist\\/[^)]+\\)/g, function(match, name) {
      return '[' + name + '](/artist?q=' + encodeURIComponent(name) + ')';
    })
    // Convert listentomore.com album URLs to local search
    .replace(/\\[([^\\]]+)\\]\\(https:\\/\\/listentomore\\.com\\/album\\/[^)]+\\)/g, function(match, name) {
      return '[' + name + '](/album?q=' + encodeURIComponent(name) + ')';
    })
    // Markdown links [text](url)
    .replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, function(match, linkText, url) {
      if (url.startsWith('/')) {
        return '<a href="' + url + '">' + linkText + '</a>';
      }
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + linkText + '</a>';
    })
    // Bullet points: - text (must be before bold/italic to preserve content)
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Bold + italic
    .replace(/\\*\\*\\*(.+?)\\*\\*\\*/g, '<strong><em>$1</em></strong>')
    // Bold
    .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
    // Italic - single asterisks (after bold is processed, only italic remains)
    .replace(/\\*([^*\\n]+)\\*/g, '<em>$1</em>')
    // Wrap consecutive <li> in <ul>
    .replace(/(<li>[\\s\\S]*?<\\/li>\\n?)+/g, function(match) {
      return '<ul>' + match.replace(/\\n/g, '') + '</ul>';
    })
    // Double newlines = new paragraph
    .replace(/\\n\\n/g, '</p><p>')
    // Single newlines = line break
    .replace(/\\n/g, '<br/>');

  // Wrap in paragraph tags
  result = '<p>' + result + '</p>';

  // Clean up empty paragraphs and formatting artifacts
  result = result
    .replace(/<p><h([34])>/g, '<h$1>')
    .replace(/<\\/h([34])><\\/p>/g, '</h$1>')
    .replace(/<p><ul>/g, '<ul>')
    .replace(/<\\/ul><\\/p>/g, '</ul>')
    .replace(/<p><\\/p>/g, '')
    .replace(/<br\\/><ul>/g, '</p><ul>')
    .replace(/<\\/ul><br\\/>/g, '</ul><p>')
    .replace(/<p><br\\/>/g, '<p>')
    .replace(/<br\\/><\\/p>/g, '</p>');

  return result;
}
`;

/**
 * enrichLinks - Enriches search links with Spotify IDs for direct navigation
 * Call this after inserting HTML with artist/album search links
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
    fetch('/api/internal/search?q=' + query + '&type=artist')
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
    var href = link.getAttribute('href');
    var match = href.match(/\\/album\\?q=([^&]+)/);
    if (!match) return;

    var query = match[1];
    fetch('/api/internal/search?q=' + query + '&type=album')
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
 * renderCitations - Renders citation links from AI responses
 */
export const renderCitationsScript = `
function renderCitations(citations) {
  if (!citations || citations.length === 0) return '';

  var html = '<div class="citations"><h4>Sources</h4><ul>';
  citations.forEach(function(url) {
    var hostname = url;
    try { hostname = new URL(url).hostname.replace('www.', ''); } catch(e) {}
    html += '<li><a href="' + url + '" target="_blank" rel="noopener noreferrer">' + hostname + '</a></li>';
  });
  html += '</ul></div>';
  return html;
}
`;

/**
 * enrichAlbumMentions - Finds "Album by Artist" in bold text and converts to links
 * Pattern: <strong>Album Name by Artist Name</strong>
 * First wraps in search link, then enriches with Spotify ID
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
        query: searchQuery
      });
    }
  });

  // Enrich with Spotify IDs
  albumsToEnrich.forEach(function(item) {
    fetch('/api/internal/search?q=' + encodeURIComponent(item.query) + '&type=album')
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
export const clientUtilsScript = formatMarkdownScript + enrichLinksScript + renderCitationsScript + enrichAlbumMentionsScript;
