// ABOUTME: Fetch utilities with timeout support for external API calls.
// ABOUTME: Prevents hung requests from holding Worker resources indefinitely.

/**
 * Default timeouts for different service types (in milliseconds)
 */
export const DEFAULT_TIMEOUTS = {
  /** Fast APIs like Spotify, Last.fm (10 seconds) */
  fast: 10_000,
  /** Slower APIs like AI services (30 seconds) */
  slow: 30_000,
  /** Very slow operations like image generation (60 seconds) */
  verySlow: 60_000,
} as const;

export type TimeoutPreset = keyof typeof DEFAULT_TIMEOUTS;

export interface FetchWithTimeoutOptions extends RequestInit {
  /** Timeout in milliseconds, or a preset name */
  timeout?: number | TimeoutPreset;
}

/**
 * Remove the query string and fragment from a URL.
 * Query strings can carry credentials (e.g. Last.fm api_key), which must not reach logs.
 */
function stripQuery(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split(/[?#]/)[0];
  }
}

/**
 * Error thrown when a fetch request times out.
 * The URL is stored and reported without its query string.
 */
export class TimeoutError extends Error {
  public url: string;

  constructor(
    url: string,
    public timeoutMs: number
  ) {
    const safeUrl = stripQuery(url);
    super(`Request to ${safeUrl} timed out after ${timeoutMs}ms`);
    this.url = safeUrl;
    this.name = 'TimeoutError';
  }
}

/**
 * Resolve timeout value from number or preset
 */
function resolveTimeout(timeout: number | TimeoutPreset | undefined): number {
  if (timeout === undefined) {
    return DEFAULT_TIMEOUTS.fast;
  }
  if (typeof timeout === 'number') {
    return timeout;
  }
  return DEFAULT_TIMEOUTS[timeout];
}

/**
 * Fetch with automatic timeout support.
 *
 * Uses AbortController to cancel requests that take too long,
 * preventing hung connections from blocking Worker resources.
 *
 * @example
 * // Using default timeout (10s)
 * const response = await fetchWithTimeout('https://api.example.com/data');
 *
 * @example
 * // Using a preset
 * const response = await fetchWithTimeout('https://api.openai.com/v1/chat', {
 *   timeout: 'slow', // 30 seconds for AI
 *   method: 'POST',
 *   body: JSON.stringify(data),
 * });
 *
 * @example
 * // Using custom timeout
 * const response = await fetchWithTimeout('https://api.example.com/data', {
 *   timeout: 5000, // 5 seconds
 * });
 */
export async function fetchWithTimeout(
  url: string | URL,
  options: FetchWithTimeoutOptions = {}
): Promise<Response> {
  const { timeout, ...fetchOptions } = options;
  const timeoutMs = resolveTimeout(timeout);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url.toString(), {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    // Check if this was an abort due to timeout
    if (error instanceof Error && error.name === 'AbortError') {
      throw new TimeoutError(url.toString(), timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
