// ABOUTME: Shape check for Spotify IDs (22 base62 characters).
// ABOUTME: Lets routes reject legacy slug URLs without calling the Spotify API.

const SPOTIFY_ID_PATTERN = /^[0-9A-Za-z]{22}$/;

/**
 * True when the value has the shape of a Spotify ID.
 * Does not prove the ID exists; Spotify is the authority on that.
 */
export function isSpotifyId(id: string): boolean {
  return SPOTIFY_ID_PATTERN.test(id);
}
