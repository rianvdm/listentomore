# Listen To More API Documentation

The Listen To More API provides programmatic access to music discovery features including Spotify catalog search, Last.fm listening data, and AI-powered music summaries.

**Base URL:** `https://listentomore.com`

## Authentication

All API requests require authentication via the `X-API-Key` header.

```bash
curl -H "X-API-Key: your_api_key" https://listentomore.com/api/spotify/search?q=radiohead&type=artist
```

### Rate Limits

| Tier | Rate Limit | Description |
|------|------------|-------------|
| Standard | 60 req/min | Default tier for new API keys |
| Premium | 300 req/min | Higher limits, access to admin endpoints |

Rate limit headers are included in all responses:
- `X-RateLimit-Limit` - Maximum requests per minute
- `X-RateLimit-Remaining` - Requests remaining in current window
- `X-RateLimit-Reset` - Unix timestamp when the limit resets
- `X-RateLimit-Tier` - Your API key tier

---

## Endpoints

### Spotify

#### Search
Search the Spotify catalog for tracks, albums, or artists.

```
GET /api/spotify/search?q=:query&type=:type
```

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `q` | string | Yes | Search query |
| `type` | string | Yes | One of: `track`, `album`, `artist` |

**Example:**
```bash
curl -H "X-API-Key: your_key" \
  "https://listentomore.com/api/spotify/search?q=ok%20computer&type=album"
```

**Response:**
```json
{
  "data": [
    {
      "id": "6dVIqQ8qmQ5GBnJ9shOYGE",
      "name": "OK Computer",
      "artist": "Radiohead",
      "image": "https://i.scdn.co/image/...",
      "url": "https://open.spotify.com/album/6dVIqQ8qmQ5GBnJ9shOYGE"
    }
  ]
}
```

#### Get Album
Get detailed information about a specific album.

```
GET /api/spotify/album/:id
```

**Example:**
```bash
curl -H "X-API-Key: your_key" \
  "https://listentomore.com/api/spotify/album/6dVIqQ8qmQ5GBnJ9shOYGE"
```

**Response:**
```json
{
  "data": {
    "id": "6dVIqQ8qmQ5GBnJ9shOYGE",
    "name": "OK Computer",
    "artist": "Radiohead",
    "artistIds": ["4Z8W4fKeB5YxbusRsdQVPb"],
    "releaseDate": "1997-05-21",
    "tracks": 12,
    "genres": ["alternative rock", "art rock"],
    "image": "https://i.scdn.co/image/...",
    "url": "https://open.spotify.com/album/6dVIqQ8qmQ5GBnJ9shOYGE",
    "label": "XL Recordings",
    "popularity": 82,
    "trackList": [
      { "number": 1, "name": "Airbag", "duration": 283000 }
    ]
  }
}
```

#### Get Artist
Get detailed information about a specific artist.

```
GET /api/spotify/artist/:id
```

**Example:**
```bash
curl -H "X-API-Key: your_key" \
  "https://listentomore.com/api/spotify/artist/4Z8W4fKeB5YxbusRsdQVPb"
```

---

### Last.fm

All Last.fm endpoints require a `username` parameter.

#### Recent Tracks
Get a user's recently played tracks.

```
GET /api/lastfm/recent?username=:username
```

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `username` | string | Yes | Last.fm username |
| `limit` | number | No | Number of tracks (default: 50) |

**Example:**
```bash
curl -H "X-API-Key: your_key" \
  "https://listentomore.com/api/lastfm/recent?username=rj"
```

#### Top Albums
Get a user's most played albums.

```
GET /api/lastfm/top-albums?username=:username&period=:period
```

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `username` | string | Yes | Last.fm username |
| `period` | string | No | Time period: `7day`, `1month`, `3month`, `6month`, `12month`, `overall` |
| `limit` | number | No | Number of albums (default: 50) |

#### Top Artists
Get a user's most played artists.

```
GET /api/lastfm/top-artists?username=:username&period=:period
```

**Parameters:** Same as Top Albums.

#### Loved Tracks
Get a user's loved/favorited tracks.

```
GET /api/lastfm/loved?username=:username
```

---

### AI

AI endpoints use Perplexity and OpenAI to generate music insights. Responses are cached for efficiency.

#### Artist Summary
Get an AI-generated summary of an artist including history, genres, and similar artists.

```
GET /api/ai/artist-summary?name=:artistName
```

**Example:**
```bash
curl -H "X-API-Key: your_key" \
  "https://listentomore.com/api/ai/artist-summary?name=Radiohead"
```

**Response:**
```json
{
  "data": {
    "summary": "Radiohead is a British rock band formed in 1985...[1] They are known for...[2]",
    "citations": [
      "https://en.wikipedia.org/wiki/Radiohead",
      "https://www.allmusic.com/artist/radiohead"
    ]
  }
}
```

#### Album Detail
Get an AI-generated analysis of an album including history, genres, and critical reception.

```
GET /api/ai/album-detail?artist=:artistName&album=:albumName
```

**Example:**
```bash
curl -H "X-API-Key: your_key" \
  "https://listentomore.com/api/ai/album-detail?artist=Radiohead&album=OK%20Computer"
```

#### Genre Summary
Get an AI-generated overview of a music genre including history, characteristics, and key artists.

```
GET /api/ai/genre-summary?genre=:genreName
```

**Example:**
```bash
curl -H "X-API-Key: your_key" \
  "https://listentomore.com/api/ai/genre-summary?genre=shoegaze"
```

#### Artist Sentence
Get a brief one-sentence description of an artist.

```
GET /api/ai/artist-sentence?name=:artistName
```

#### Random Fact
Get a random AI-generated music fact.

```
GET /api/ai/random-fact
```

#### Ask (Chat)
Ask the music AI chatbot a question.

```
POST /api/ai/ask
Content-Type: application/json

{
  "question": "What albums should I listen to if I like OK Computer?"
}
```

#### Playlist Cover
Generate AI artwork for a playlist.

```
POST /api/ai/playlist-cover/prompt
Content-Type: application/json

{
  "playlistName": "Late Night Coding",
  "tracks": ["Radiohead - Everything In Its Right Place", "Boards of Canada - Roygbiv"]
}
```

```
POST /api/ai/playlist-cover/image
Content-Type: application/json

{
  "prompt": "A dreamy, abstract visualization..."
}
```

---

### Cache Management

These endpoints require a **premium-tier** API key.

#### List Cache Keys
List cached entries by prefix.

```
GET /api/cache?prefix=:prefix&limit=:limit
```

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `prefix` | string | No | Key prefix to filter (default: `ai:`) |
| `limit` | number | No | Max keys to return (default: 50, max: 100) |

**Available prefixes:**
- `ai:albumDetail` - Album AI summaries
- `ai:artistSummary` - Artist AI summaries
- `ai:genreSummary` - Genre AI summaries
- `spotify:album` - Spotify album data
- `spotify:artist` - Spotify artist data
- `songlink:` - Streaming link data

**Example:**
```bash
curl -H "X-API-Key: your_premium_key" \
  "https://listentomore.com/api/cache?prefix=ai:albumDetail&limit=10"
```

**Response:**
```json
{
  "keys": [
    { "name": "ai:albumDetail:radiohead:ok computer", "expiration": "2025-06-15T00:00:00.000Z" }
  ],
  "count": 1,
  "complete": true
}
```

#### Delete Cache Entry
Clear a specific cache entry to force regeneration.

```
DELETE /api/cache?type=:type&...params
```

**Types and parameters:**

| Type | Parameters | Example |
|------|------------|---------|
| `albumDetail` | `artist`, `album` | `?type=albumDetail&artist=radiohead&album=ok%20computer` |
| `artistSummary` | `artist` | `?type=artistSummary&artist=radiohead` |
| `genreSummary` | `genre` | `?type=genreSummary&genre=shoegaze` |
| `spotify:album` | `id` | `?type=spotify:album&id=6dVIqQ8qmQ5GBnJ9shOYGE` |
| `spotify:artist` | `id` | `?type=spotify:artist&id=4Z8W4fKeB5YxbusRsdQVPb` |

**Example:**
```bash
curl -X DELETE -H "X-API-Key: your_premium_key" \
  "https://listentomore.com/api/cache?type=albumDetail&artist=radiohead&album=ok%20computer"
```

**Response:**
```json
{
  "message": "Cache entry deleted",
  "key": "ai:albumDetail:radiohead:ok computer",
  "deleted": true
}
```

---

## Error Handling

All errors return JSON with an `error` field:

```json
{
  "error": "Error type",
  "message": "Detailed error message"
}
```

**Common HTTP Status Codes:**

| Code | Description |
|------|-------------|
| 400 | Bad Request - Missing or invalid parameters |
| 401 | Unauthorized - Invalid or missing API key |
| 403 | Forbidden - Insufficient permissions (wrong tier/scope) |
| 429 | Too Many Requests - Rate limit exceeded |
| 500 | Internal Server Error - Something went wrong |

---

## Getting an API Key

API keys are currently issued manually. Contact the site administrator to request access.

Once issued, keep your API key secure and never expose it in client-side code.
