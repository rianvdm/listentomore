// URL slug utilities with stable ID-based URLs

/**
 * Generate a URL-safe slug from a name
 * Used for genres and display purposes
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '-') // Spaces to hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-|-$/g, ''); // Trim leading/trailing hyphens
}

/**
 * Generate album URL using Spotify ID
 */
export function albumUrl(spotifyId: string): string {
  return `/album/${spotifyId}`;
}

/**
 * Generate artist URL using Spotify ID
 */
export function artistUrl(spotifyId: string): string {
  return `/artist/${spotifyId}`;
}

/**
 * Generate genre URL (slugified name)
 */
export function genreUrl(genre: string): string {
  return `/genre/${generateSlug(genre)}`;
}

/**
 * Check if a URL is external (should use <a> instead of Link)
 */
export function isExternalUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}
