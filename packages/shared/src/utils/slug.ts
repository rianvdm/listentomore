// URL slug utilities with stable ID-based URLs

/**
 * Generate a display-friendly slug from a name
 * Used for SEO-friendly display, not for routing
 */
export function generateDisplaySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '-') // Spaces to hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-|-$/g, ''); // Trim leading/trailing hyphens
}

/**
 * Generate album URL using Spotify ID (stable, never breaks)
 */
export function albumUrl(spotifyId: string): string {
  return `/album/spotify:${spotifyId}`;
}

/**
 * Generate artist URL using Spotify ID (stable, never breaks)
 */
export function artistUrl(spotifyId: string): string {
  return `/artist/spotify:${spotifyId}`;
}

/**
 * Generate genre URL (slugified name)
 */
export function genreUrl(genre: string): string {
  return `/genre/${generateDisplaySlug(genre)}`;
}

/**
 * Parse Spotify ID from URL parameter
 * Returns null if not a valid spotify: prefixed ID
 */
export function parseSpotifyId(param: string): string | null {
  if (param.startsWith('spotify:')) {
    return param.slice(8);
  }
  return null;
}

/**
 * Check if a URL is external (should use <a> instead of Link)
 */
export function isExternalUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}
