// Formatting utilities for Discord bot

/**
 * Capitalize the first letter of each word
 */
export function capitalizeWords(str: string): string {
  return str.replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Build the album URL using Spotify ID (new format)
 */
export function albumUrl(spotifyId: string): string {
  return `https://listentomore.com/album/${spotifyId}`;
}

/**
 * Build the artist URL using Spotify ID (new format)
 */
export function artistUrl(spotifyId: string): string {
  return `https://listentomore.com/artist/${spotifyId}`;
}

/**
 * Build the genre URL using slug
 */
export function genreUrl(genre: string): string {
  const slug = genre.toLowerCase().replace(/\s+/g, '-');
  return `https://listentomore.com/genre/${encodeURIComponent(slug)}`;
}

/**
 * Format streaming links as a compact line for Discord messages
 */
export function formatStreamingLinks(links: {
  pageUrl?: string;
  spotifyUrl?: string;
  appleUrl?: string;
  deezerUrl?: string;
}): string {
  const parts: string[] = [];

  if (links.pageUrl) parts.push(`[SongLink](${links.pageUrl})`);
  if (links.spotifyUrl) parts.push(`[Spotify](${links.spotifyUrl})`);
  if (links.appleUrl) parts.push(`[Apple Music](${links.appleUrl})`);
  if (links.deezerUrl) parts.push(`[Deezer](${links.deezerUrl})`);

  return parts.join(' • ');
}
