// ABOUTME: Typed errors raised by the Spotify clients.
// ABOUTME: Lets callers tell "Spotify has no such album/artist" (a 404) from transient failures.

/**
 * Spotify answered 404 for this album or artist ID.
 */
export class SpotifyNotFoundError extends Error {
  constructor(
    public readonly kind: 'album' | 'artist',
    public readonly id: string
  ) {
    super(`${kind === 'album' ? 'Album' : 'Artist'} not found: ${id}`);
    this.name = 'SpotifyNotFoundError';
  }
}
