// HTTP utilities for consistent responses and caching

export interface CacheOptions {
  maxAge: number;
  staleWhileRevalidate?: number;
}

const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/**
 * Create a JSON response with standard headers
 */
export function jsonResponse<T>(
  data: T,
  status: number = 200,
  cacheOptions?: CacheOptions
): Response {
  const headers: Record<string, string> = { ...DEFAULT_HEADERS };

  if (cacheOptions) {
    const cacheControl = cacheOptions.staleWhileRevalidate
      ? `public, max-age=${cacheOptions.maxAge}, stale-while-revalidate=${cacheOptions.staleWhileRevalidate}`
      : `public, max-age=${cacheOptions.maxAge}`;
    headers['Cache-Control'] = cacheControl;
  }

  return new Response(JSON.stringify(data), { status, headers });
}

/**
 * Handle CORS preflight requests
 */
export function corsResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...DEFAULT_HEADERS,
      'Access-Control-Max-Age': '86400',
    },
  });
}

/**
 * Wrap a handler with CORS support
 */
export function withCors(
  handler: (request: Request) => Promise<Response>
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    if (request.method === 'OPTIONS') {
      return corsResponse();
    }
    const response = await handler(request);
    // Add CORS headers to response
    const headers = new Headers(response.headers);
    Object.entries(DEFAULT_HEADERS).forEach(([key, value]) => {
      if (!headers.has(key)) {
        headers.set(key, value);
      }
    });
    return new Response(response.body, {
      status: response.status,
      headers,
    });
  };
}

/**
 * Generate ETag from content
 */
export async function generateETag(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `"${hashHex.slice(0, 16)}"`;
}
