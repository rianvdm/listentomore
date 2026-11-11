// ABOUTME: An error's class for a log line, from an allowlist of the error classes this app and its packages throw.
// ABOUTME: Anything else is 'other': an error's name and message are free text and can carry a name or a key.

/**
 * Error class names a log line may carry. A name is logged only when it is one of these exactly; an error that
 * sets any other name (or a non-Error throw) logs as 'other'.
 */
const KNOWN_ERROR_KINDS: ReadonlySet<string> = new Set([
  // JavaScript and the runtime
  'Error', 'TypeError', 'SyntaxError', 'RangeError', 'AbortError',
  // @listentomore/shared
  'AppError', 'NotFoundError', 'ValidationError', 'ExternalApiError', 'RateLimitError', 'TimeoutError',
  // @listentomore/ai
  'RegionUnsupportedError',
  // @listentomore/musicbrainz
  'MusicBrainzApiError', 'MusicBrainzRateLimitError', 'CreditsCapReached',
  // @listentomore/lastfm, @listentomore/spotify, @listentomore/insights
  'LastfmApiError', 'SpotifyNotFoundError', 'InsightsFetchError',
]);

/**
 * The error's class name when it is a known class, else 'other'. Never the message. `name` is read once and the
 * value checked is the value returned, so a getter that changes between reads cannot pass the check with one value
 * and log another; a getter that throws reads as 'other'.
 */
export function errorKind(error: unknown): string {
  if (!(error instanceof Error)) return 'other';
  let name: unknown;
  try {
    name = error.name;
  } catch {
    return 'other';
  }
  return typeof name === 'string' && KNOWN_ERROR_KINDS.has(name) ? name : 'other';
}
