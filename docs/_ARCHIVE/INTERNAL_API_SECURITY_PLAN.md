# Internal API Security Implementation Plan

## Problem

All `/api/internal/*` endpoints are currently publicly accessible without authentication or rate limiting. These endpoints are intended for progressive loading (client-side JS fetching data after page render) but can be abused by anyone.

### Exposed Endpoints

| Endpoint | Risk Level | External API Cost |
|----------|------------|-------------------|
| `/api/internal/album-summary` | **High** | Perplexity API |
| `/api/internal/artist-summary` | **High** | Perplexity API |
| `/api/internal/genre-summary` | **High** | Perplexity API |
| `/api/internal/artist-sentence` | **High** | Perplexity API |
| `/api/internal/user-recommendations` | **High** | Perplexity API |
| `/api/internal/streaming-links` | Medium | YouTube Data API (100/day quota) |
| `/api/internal/songlink` | Medium | Songlink rate limits |
| `/api/internal/search` | Low | Spotify API (free) |
| `/api/internal/artist-lastfm` | Low | Last.fm API (free) |
| `/api/internal/user-*` | Low | Last.fm API (free) |

### Current Code (vulnerable)

```typescript
// apps/web/src/index.tsx - lines 140-143
// Skip auth for internal endpoints (used by page progressive loading)
if (c.req.path.startsWith('/api/internal/')) {
  return next();
}
```

---

## Solution: Signed Request Tokens

### How It Works

1. **Page Render**: Server generates a short-lived signed token (HMAC-SHA256)
2. **Token Embedded**: Token is included in the rendered HTML
3. **Client Request**: JavaScript sends token in header with fetch requests
4. **Server Validation**: Middleware validates signature and expiry

### Why This Is Secure

Even though the token is visible in page source:
- **Short-lived**: Expires in 5 minutes (configurable)
- **Cryptographically signed**: Cannot be forged without server secret
- **Fresh per page load**: Each render generates a new token
- **Useless to harvest**: By the time an attacker extracts it, it's likely expired

### Performance Impact

| Operation | Time | Frequency |
|-----------|------|-----------|
| Generate token (HMAC-SHA256) | ~0.1ms | Once per page render |
| Validate token (HMAC-SHA256) | ~0.1ms | Per internal API call |

Negligible compared to actual API calls (100-3000ms).

---

## Implementation Details

### 1. Environment Setup

Add signing secret to `wrangler.toml` secrets list:

```toml
# Note: Secrets should be set with `wrangler secret put`:
# - INTERNAL_API_SECRET (for signing internal API tokens)
```

Generate and set the secret:
```bash
# Generate a secure random secret
openssl rand -hex 32

# Set it in Cloudflare
npx wrangler secret put INTERNAL_API_SECRET
```

Add to `.dev.vars` for local development:
```
INTERNAL_API_SECRET=your-dev-secret-here
```

Add to bindings type:
```typescript
// apps/web/src/index.tsx
type Bindings = {
  // ... existing bindings
  INTERNAL_API_SECRET: string;
};
```

### 2. Token Utilities

Create `apps/web/src/utils/internal-token.ts`:

```typescript
const TOKEN_EXPIRY_SECONDS = 300; // 5 minutes

interface TokenPayload {
  exp: number; // Expiry timestamp
  iat: number; // Issued at timestamp
}

/**
 * Generate a signed token for internal API requests
 */
export async function generateInternalToken(secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = {
    iat: now,
    exp: now + TOKEN_EXPIRY_SECONDS,
  };

  const payloadBase64 = btoa(JSON.stringify(payload));
  const signature = await sign(payloadBase64, secret);

  return `${payloadBase64}.${signature}`;
}

/**
 * Validate a signed token
 * Returns true if valid, false if invalid or expired
 */
export async function validateInternalToken(
  token: string,
  secret: string
): Promise<boolean> {
  try {
    const [payloadBase64, signature] = token.split('.');

    if (!payloadBase64 || !signature) {
      return false;
    }

    // Verify signature
    const expectedSignature = await sign(payloadBase64, secret);
    if (signature !== expectedSignature) {
      return false;
    }

    // Check expiry
    const payload: TokenPayload = JSON.parse(atob(payloadBase64));
    const now = Math.floor(Date.now() / 1000);

    if (payload.exp < now) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * HMAC-SHA256 signature using Web Crypto API
 */
async function sign(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

### 3. Middleware

Create internal API auth middleware in `apps/web/src/middleware/internal-auth.ts`:

```typescript
import type { Context, Next } from 'hono';
import { validateInternalToken } from '../utils/internal-token';

const INTERNAL_TOKEN_HEADER = 'X-Internal-Token';

export function internalAuthMiddleware() {
  return async (c: Context, next: Next) => {
    const token = c.req.header(INTERNAL_TOKEN_HEADER);

    if (!token) {
      return c.json({ error: 'Missing internal token' }, 401);
    }

    const secret = c.env.INTERNAL_API_SECRET;
    const isValid = await validateInternalToken(token, secret);

    if (!isValid) {
      return c.json({ error: 'Invalid or expired token' }, 401);
    }

    await next();
  };
}
```

### 4. Update Main App

In `apps/web/src/index.tsx`:

```typescript
import { generateInternalToken } from './utils/internal-token';
import { internalAuthMiddleware } from './middleware/internal-auth';

// Add to Variables type
type Variables = {
  // ... existing
  internalToken: string;
};

// In the service initialization middleware, generate token
app.use('*', async (c, next) => {
  // ... existing service initialization

  // Generate internal API token for this request
  const internalToken = await generateInternalToken(c.env.INTERNAL_API_SECRET);
  c.set('internalToken', internalToken);

  await next();
});

// Replace the current internal endpoint bypass with auth middleware
app.use('/api/internal/*', internalAuthMiddleware());
```

### 5. Update Page Components

Each page that uses internal APIs needs to receive and use the token.

**Option A: Pass token to each page component**

```typescript
// In route handler
export async function handleAlbumDetail(c: Context) {
  const internalToken = c.get('internalToken');
  // ... rest of handler
  return c.html(<AlbumDetailPage album={album} internalToken={internalToken} />);
}

// In component
<script dangerouslySetInnerHTML={{ __html: `
  var internalToken = '${internalToken}';

  fetch('/api/internal/streaming-links?spotifyId=' + albumId + '&type=album', {
    headers: { 'X-Internal-Token': internalToken }
  })
  // ...
` }} />
```

**Option B: Embed token in a global script (cleaner)**

Create a layout-level script that sets the token:

```typescript
// In Layout component
export function Layout({ children, internalToken, ...props }) {
  return (
    <html>
      <head>
        {/* ... */}
        {internalToken && (
          <script dangerouslySetInnerHTML={{ __html: `
            window.__INTERNAL_TOKEN__ = '${internalToken}';
          ` }} />
        )}
      </head>
      {/* ... */}
    </html>
  );
}
```

Create a helper function for internal fetches:

```typescript
// Embed this in pages that need internal API access
const internalFetchScript = `
  function internalFetch(url, options = {}) {
    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'X-Internal-Token': window.__INTERNAL_TOKEN__
      }
    });
  }
`;
```

Then update all internal fetch calls:
```typescript
// Before
fetch('/api/internal/streaming-links?...')

// After
internalFetch('/api/internal/streaming-links?...')
```

### 6. Update All Pages Using Internal APIs

Pages that need updating:

| File | Internal APIs Used |
|------|-------------------|
| `pages/album/detail.tsx` | streaming-links, album-summary |
| `pages/artist/detail.tsx` | artist-summary, artist-sentence, artist-lastfm |
| `pages/genre/detail.tsx` | genre-summary |
| `pages/user/stats.tsx` | user-listens, user-recent-track, user-top-artists, user-top-albums |
| `pages/user/recommendations.tsx` | user-recommendations, songlink |
| `pages/artist/search.tsx` | search |
| `pages/album/search.tsx` | search |

---

## Files to Modify

### New Files
- `apps/web/src/utils/internal-token.ts` - Token generation/validation
- `apps/web/src/middleware/internal-auth.ts` - Auth middleware

### Modified Files
- `apps/web/wrangler.toml` - Add secret to list
- `apps/web/.dev.vars` - Add dev secret
- `apps/web/src/index.tsx` - Add middleware, generate token, pass to pages
- `apps/web/src/components/layout.tsx` - Embed token in HTML
- `apps/web/src/pages/album/detail.tsx` - Use internalFetch
- `apps/web/src/pages/artist/detail.tsx` - Use internalFetch
- `apps/web/src/pages/genre/detail.tsx` - Use internalFetch
- `apps/web/src/pages/user/stats.tsx` - Use internalFetch
- `apps/web/src/pages/user/recommendations.tsx` - Use internalFetch
- `apps/web/src/pages/artist/search.tsx` - Use internalFetch
- `apps/web/src/pages/album/search.tsx` - Use internalFetch

---

## Testing

### Local Testing

1. Start dev server: `pnpm dev`
2. Visit a page with internal API calls (e.g., `/album/6dVIqQ8qmQ5GBnJ9shOYGE`)
3. Verify internal APIs work (check Network tab, console)
4. Try calling internal API directly without token:
   ```bash
   curl http://localhost:8788/api/internal/streaming-links?spotifyId=abc&type=album
   # Should return 401
   ```
5. Verify with valid token it works (extract from page source)

### Production Testing

After deployment:
1. Verify pages load correctly with all progressive data
2. Verify direct API calls without token are rejected
3. Verify old tokens (> 5 min) are rejected

---

## Rollback Plan

If issues arise, the change can be reverted by:

1. Removing the `internalAuthMiddleware()` from the middleware chain
2. Re-adding the auth bypass for internal endpoints:
   ```typescript
   if (c.req.path.startsWith('/api/internal/')) {
     return next();
   }
   ```

---

## Future Enhancements

1. **Rate limiting on top of auth**: Even with tokens, add IP-based rate limits as defense in depth
2. **Token refresh**: For long-lived pages, implement token refresh before expiry
3. **Scope tokens**: Limit tokens to specific endpoints or resources
4. **Logging**: Track invalid token attempts for security monitoring
