# Public API v1 Plan

## Overview

Redesign the public API to focus on **AI-powered insights** and **cross-platform streaming links** - the unique value ListenToMore provides. Remove raw Spotify/Last.fm passthrough endpoints and replace them with a simpler, search-first API.

**Key principle:** Users should never need to know Spotify IDs. Album endpoints use precise artist+album parameters; artist/genre endpoints use simple text search.

**Migration:** Since there are no external API users yet, we'll implement the new endpoints at `/api/v1/` and remove the old `/api/` endpoints entirely. Existing API keys will continue to work.

---

## Current State

### Endpoints to Remove
These are thin wrappers that users can get directly from Spotify/Last.fm:
- `GET /api/spotify/search`
- `GET /api/spotify/album/:id`
- `GET /api/spotify/artist/:id`
- `GET /api/lastfm/recent`
- `GET /api/lastfm/top-albums`
- `GET /api/lastfm/top-artists`
- `GET /api/lastfm/loved`

### Endpoints to Keep/Enhance
These provide unique value:
- AI summaries (artist, album, genre)
- AI recommendations
- Cross-platform streaming links

---

## New API Endpoints (`/api/v1/`)

Album endpoints use separate `artist` and `album` parameters for precise matching (leveraging existing internal search). Artist/genre endpoints use `?q=` for simpler queries.

**Authentication:** Existing API keys work unchanged. Same rate limits apply (standard: 60 req/min, premium: 300 req/min).

### Albums

#### Search & Get Album Details
```
GET /api/v1/album?artist=:artist&album=:album
```

Returns album metadata + AI summary + streaming links in one call.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `artist` | string | Yes | Artist name |
| `album` | string | Yes | Album name |
| `include` | string | No | Comma-separated: `summary`, `links`, `tracks` (default: all) |

**Example:**
```bash
curl -H "X-API-Key: your_key" \
  "https://listentomore.com/api/v1/album?artist=radiohead&album=ok%20computer"
```

**Response:**
```json
{
  "data": {
    "id": "6dVIqQ8qmQ5GBnJ9shOYGE",
    "name": "OK Computer",
    "artist": "Radiohead",
    "artistId": "4Z8W4fKeB5YxbusRsdQVPb",
    "releaseDate": "1997-05-28",
    "genres": ["alternative rock", "art rock"],
    "image": "https://i.scdn.co/image/...",
    "tracks": [
      { "number": 1, "name": "Airbag", "duration": 287880 }
    ],
    "summary": {
      "content": "OK Computer is Radiohead's third studio album...[1]",
      "citations": ["https://en.wikipedia.org/wiki/OK_Computer"]
    },
    "links": {
      "spotify": "https://open.spotify.com/album/6dVIqQ8qmQ5GBnJ9shOYGE",
      "appleMusic": "https://music.apple.com/us/album/ok-computer/1097861387",
      "youtube": "https://www.youtube.com/playlist?list=..."
    }
  }
}
```

**Internal flow:**
1. Search Spotify for album matching query
2. Fetch album details (parallel with step 3-4)
3. Fetch AI summary from cache or generate
4. Fetch streaming links from cache or resolve
5. Return combined response

#### Album Recommendations
```
GET /api/v1/album/recommendations?artist=:artist&album=:album
```

Returns AI-generated album recommendations based on a source album.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `artist` | string | Yes | Artist name |
| `album` | string | Yes | Album name |
| `limit` | number | No | Number of recommendations (default: 5, max: 10) |

**Example:**
```bash
curl -H "X-API-Key: your_key" \
  "https://listentomore.com/api/v1/album/recommendations?artist=radiohead&album=kid%20a"
```

**Response:**
```json
{
  "data": {
    "source": {
      "id": "6GjwtEZcfenmOf6l18N7T7",
      "name": "Kid A",
      "artist": "Radiohead"
    },
    "recommendations": {
      "content": "If you enjoy Kid A, you might like:\n\n1. **Amnesiac** by Radiohead...[1]\n2. **Vespertine** by Björk...[2]",
      "citations": ["https://...", "https://..."]
    }
  }
}
```

---

### Artists

#### Search & Get Artist Details
```
GET /api/v1/artist?q=:query
```

Returns artist metadata + AI summary.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `q` | string | Yes | Artist search query |
| `include` | string | No | Comma-separated: `summary`, `albums` (default: all) |

**Example:**
```bash
curl -H "X-API-Key: your_key" \
  "https://listentomore.com/api/v1/artist?q=radiohead"
```

**Response:**
```json
{
  "data": {
    "id": "4Z8W4fKeB5YxbusRsdQVPb",
    "name": "Radiohead",
    "genres": ["alternative rock", "art rock", "electronic"],
    "image": "https://i.scdn.co/image/...",
    "summary": {
      "content": "Radiohead is a British rock band formed in 1985...[1]",
      "citations": ["https://en.wikipedia.org/wiki/Radiohead"]
    },
    "topAlbums": [
      { "name": "OK Computer", "id": "6dVIqQ8qmQ5GBnJ9shOYGE" },
      { "name": "Kid A", "id": "6GjwtEZcfenmOf6l18N7T7" }
    ],
    "similarArtists": [
      { "name": "Portishead", "id": "..." }
    ]
  }
}
```

---

### Genres

#### Get Genre Details
```
GET /api/v1/genre?q=:query
```

Returns AI-generated genre summary.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `q` | string | Yes | Genre name (e.g., "shoegaze", "post-punk") |

**Example:**
```bash
curl -H "X-API-Key: your_key" \
  "https://listentomore.com/api/v1/genre?q=shoegaze"
```

**Response:**
```json
{
  "data": {
    "name": "Shoegaze",
    "slug": "shoegaze",
    "summary": {
      "content": "Shoegaze is a subgenre of alternative rock that emerged in the UK...[1]",
      "citations": ["https://en.wikipedia.org/wiki/Shoegaze"]
    },
    "relatedGenres": ["dream pop", "noise pop", "post-rock"]
  }
}
```

---

### Streaming Links

#### Get Cross-Platform Links
```
GET /api/v1/links?artist=:artist&album=:album
```

Returns streaming links for an album.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `artist` | string | Yes | Artist name |
| `album` | string | Yes | Album name |

**Example:**
```bash
curl -H "X-API-Key: your_key" \
  "https://listentomore.com/api/v1/links?artist=radiohead&album=ok%20computer"
```

**Response:**
```json
{
  "data": {
    "source": {
      "id": "6dVIqQ8qmQ5GBnJ9shOYGE",
      "name": "OK Computer",
      "artist": "Radiohead"
    },
    "links": {
      "spotify": "https://open.spotify.com/album/6dVIqQ8qmQ5GBnJ9shOYGE",
      "appleMusic": "https://music.apple.com/us/album/ok-computer/1097861387",
      "youtube": "https://www.youtube.com/playlist?list=...",
      "youtubeMusic": "https://music.youtube.com/playlist?list=..."
    },
    "confidence": {
      "appleMusic": 0.98,
      "youtube": 0.85
    }
  }
}
```

---

### Chat (Keep as-is)
```
POST /api/v1/ask
```

The Rick Rubin AI chatbot. No changes needed.

---

## Implementation Notes

### Search Resolution Strategy

**Album endpoints** (require `artist` + `album` params):
1. Use existing precise search logic (`/api/internal/search-album-by-artist`)
2. Searches Spotify for `album:X artist:Y`
3. Returns 404 if no match found

**Artist endpoints** (use `q` param):
1. Search Spotify for artist name
2. Take first result (artist search is usually unambiguous)

**Genre endpoints** (use `q` param):
1. Normalize genre name to slug
2. Look up in AI cache or generate summary

### Caching

All responses benefit from existing cache layers:
- Spotify data: 30 days
- AI summaries: 120-180 days
- Streaming links: 30 days

### Authentication

All `/api/v1/*` endpoints require the `X-API-Key` header. Uses existing middleware:

```typescript
// Existing requireAuth() middleware applies to all v1 routes
app.use('/api/v1/*', requireAuth());
```

**Key validation flow:**
1. Extract `X-API-Key` header
2. Look up key in D1 database (`api_keys` table)
3. Check key is active and not expired
4. Apply rate limit based on tier
5. Reject with 401 if invalid, 429 if rate limited

**No changes needed** - existing API key infrastructure works as-is.

### Rate Limiting

Keep existing tiers:
- Standard: 60 req/min
- Premium: 300 req/min

Rate limit headers included in responses:
- `X-RateLimit-Limit` - Max requests per minute
- `X-RateLimit-Remaining` - Requests left in window
- `X-RateLimit-Reset` - Unix timestamp when limit resets

### Error Handling

```json
{
  "error": "No album found",
  "query": "asdfghjkl",
  "suggestions": ["Did you mean..."]  // optional, if partial matches exist
}
```

---

## Implementation Plan

### Step 1: Add New Endpoints
- Add `/api/v1/*` routes in `apps/web/src/index.tsx`
- Reuse existing internal logic (search-album-by-artist, AI services, streaming-links)
- Apply existing API key middleware and rate limiting

### Step 2: Remove Old Endpoints
- Remove `/api/spotify/*` routes
- Remove `/api/lastfm/*` routes
- Remove `/api/ai/*` routes (replaced by combined v1 endpoints)
- Remove `/api/streaming-links/*` routes
- Keep `/api/auth/keys` for admin key creation
- Keep `/api/cache` for premium cache management

### Step 3: Update Documentation
- Update `docs/API.md` with new v1 endpoints
- Update README API section

---

## Future Enhancements

### Track Links
Extend streaming-links to support individual tracks:
```
GET /api/v1/links/track?artist=radiohead&track=paranoid%20android
```

### Playlist Generation
AI-generated playlist based on seed albums:
```
POST /api/v1/playlist
{
  "seeds": [
    { "artist": "radiohead", "album": "ok computer" },
    { "artist": "portishead", "album": "dummy" }
  ],
  "mood": "melancholic",
  "length": 20
}
```

### Artist Recommendations
Similar to album recommendations:
```
GET /api/v1/artist/recommendations?q=radiohead
```

---

## Summary

| Old Endpoint | New v1 Endpoint | Notes |
|--------------|-----------------|-------|
| `GET /api/spotify/search` | **Removed** | Use v1 endpoints directly |
| `GET /api/spotify/album/:id` | `GET /api/v1/album?artist=X&album=Y` | Precise search, includes AI + links |
| `GET /api/spotify/artist/:id` | `GET /api/v1/artist?q=X` | Text search, includes AI |
| `GET /api/lastfm/*` | **Removed** | Use Last.fm API directly |
| `GET /api/ai/album-detail` | `GET /api/v1/album?artist=X&album=Y` | Combined with metadata + links |
| `GET /api/ai/artist-summary` | `GET /api/v1/artist?q=X` | Combined with metadata |
| `GET /api/ai/genre-summary` | `GET /api/v1/genre?q=X` | Same, cleaner path |
| `GET /api/streaming-links/album/:id` | `GET /api/v1/links?artist=X&album=Y` | Precise search instead of ID |
| `POST /api/ai/ask` | `POST /api/v1/ask` | No change |
| *New* | `GET /api/v1/album/recommendations?artist=X&album=Y` | AI album recommendations |

The new API is simpler (6 endpoints instead of 15+), more powerful (combined responses), and uses precise artist+album matching for reliable results. Existing API keys continue to work.
