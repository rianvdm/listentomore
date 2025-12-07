# Listen To More API

A REST API for music discovery, combining Spotify catalog data with AI-powered insights and cross-platform streaming links.

**Base URL:** `https://listentomore.com`

---

## Table of Contents

- [Authentication](#authentication)
- [Rate Limits](#rate-limits)
- [Endpoints](#endpoints)
  - [Album](#album)
  - [Album Recommendations](#album-recommendations)
  - [Streaming Links](#streaming-links)
  - [Artist](#artist)
  - [Genre](#genre)
  - [Ask (Chat)](#ask-chat)
- [Error Handling](#error-handling)
- [Getting an API Key](#getting-an-api-key)

---

## Authentication

All API requests require the `X-API-Key` header.

```bash
curl -H "X-API-Key: your_api_key" \
  "https://listentomore.com/api/v1/album?artist=radiohead&album=ok%20computer"
```

---

## Rate Limits

| Tier | Requests/Minute | Description |
|------|-----------------|-------------|
| Standard | 60 | Default tier for new API keys |
| Premium | 300 | Higher limits for approved applications |

Rate limit headers are included in all responses:

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Maximum requests per minute |
| `X-RateLimit-Remaining` | Requests remaining in current window |
| `X-RateLimit-Reset` | Unix timestamp when the limit resets |

---

## Endpoints

### Album

Get comprehensive album information including metadata, AI-generated summary, and cross-platform streaming links in a single request.

```
GET /api/v1/album
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `artist` | string | Yes | Artist name |
| `album` | string | Yes | Album name |
| `include` | string | No | Comma-separated list: `summary`, `links`, `tracks`. Default: all |

#### Example Request

```bash
curl -H "X-API-Key: your_key" \
  "https://listentomore.com/api/v1/album?artist=radiohead&album=the%20bends"
```

#### Example Response

```json
{
  "data": {
    "id": "35UJLpClj5EDrhpNIi4DFg",
    "name": "The Bends",
    "artist": "Radiohead",
    "artistId": "4Z8W4fKeB5YxbusRsdQVPb",
    "releaseDate": "1995-03-13",
    "genres": [],
    "image": "https://i.scdn.co/image/ab67616d0000b2739293c743fa542094336c5e12",
    "url": "https://open.spotify.com/album/35UJLpClj5EDrhpNIi4DFg",
    "tracks": [
      {
        "number": 1,
        "name": "Planet Telex",
        "duration": 259200,
        "preview": null,
        "artists": ["Radiohead"]
      },
      {
        "number": 2,
        "name": "The Bends",
        "duration": 246200,
        "preview": null,
        "artists": ["Radiohead"]
      }
    ],
    "summary": {
      "content": "### History and Genres/Styles of *The Bends*\n\n*The Bends* is Radiohead's second studio album, released on March 13, 1995...",
      "citations": [
        "https://www.thecurrent.org/feature/2025/03/13/march-13-in-music-history-radiohead-released-the-bends",
        "https://www.musicmusingsandsuch.com/musicmusingsandsuch/2025/2/8/feature-radioheads-the-bends-at-thirty"
      ]
    },
    "links": {
      "listentomore": "https://listentomore.com/album/35UJLpClj5EDrhpNIi4DFg",
      "spotify": "https://open.spotify.com/album/35UJLpClj5EDrhpNIi4DFg",
      "appleMusic": "https://music.apple.com/album/the-bends/1097862703",
      "youtube": "https://www.youtube.com/results?search_query=Radiohead%20The%20Bends%20album"
    },
    "confidence": {
      "appleMusic": 0.98,
      "youtube": null
    }
  }
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Spotify album ID |
| `name` | string | Album name |
| `artist` | string | Primary artist name |
| `artistId` | string | Spotify artist ID |
| `releaseDate` | string | Release date (YYYY-MM-DD) |
| `genres` | string[] | Album genres (from Spotify) |
| `image` | string | Album artwork URL |
| `url` | string | Spotify album URL |
| `tracks` | object[] | Track listing (if `include=tracks`) |
| `summary.content` | string | AI-generated album summary (Markdown with citations) |
| `summary.citations` | string[] | Source URLs for the summary |
| `links.listentomore` | string | Listen To More album page |
| `links.spotify` | string | Spotify album URL |
| `links.appleMusic` | string \| null | Apple Music URL (if found) |
| `links.youtube` | string \| null | YouTube URL (if found) |
| `confidence.appleMusic` | number \| null | Match confidence (0.98 = UPC match, 0.8+ = text match) |
| `confidence.youtube` | number \| null | Match confidence |

---

### Album Recommendations

Get AI-generated album recommendations based on a source album.

```
GET /api/v1/album/recommendations
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `artist` | string | Yes | Artist name |
| `album` | string | Yes | Album name |

#### Example Request

```bash
curl -H "X-API-Key: your_key" \
  "https://listentomore.com/api/v1/album/recommendations?artist=radiohead&album=ok%20computer"
```

#### Example Response

```json
{
  "data": {
    "source": {
      "id": "6dVIqQ8qmQ5GBnJ9shOYGE",
      "name": "OK Computer",
      "artist": "Radiohead",
      "url": "https://listentomore.com/album/6dVIqQ8qmQ5GBnJ9shOYGE"
    },
    "recommendations": {
      "content": "Based on *OK Computer*, here are albums you might enjoy:\n\n- **Kid A** by Radiohead - The follow-up that pushed even further into electronic experimentation...\n- **Homogenic** by Björk - Shares OK Computer's blend of orchestral elements with electronic production...",
      "citations": [
        "https://www.albumoftheyear.org/ratings/user-highest-rated/all/",
        "https://rateyourmusic.com/list/TheScientist/..."
      ]
    }
  }
}
```

---

### Streaming Links

Get cross-platform streaming links for an album without the full metadata or AI summary.

```
GET /api/v1/links
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `artist` | string | Yes | Artist name |
| `album` | string | Yes | Album name |

#### Example Request

```bash
curl -H "X-API-Key: your_key" \
  "https://listentomore.com/api/v1/links?artist=portishead&album=dummy"
```

#### Example Response

```json
{
  "data": {
    "source": {
      "id": "3539EbNgIdEDGBKkUf4wno",
      "name": "Dummy",
      "artist": "Portishead"
    },
    "links": {
      "listentomore": "https://listentomore.com/album/3539EbNgIdEDGBKkUf4wno",
      "spotify": "https://open.spotify.com/album/3539EbNgIdEDGBKkUf4wno",
      "appleMusic": "https://music.apple.com/album/dummy/1440649507",
      "youtube": "https://www.youtube.com/playlist?list=OLAK5uy_..."
    },
    "confidence": {
      "appleMusic": 0.98,
      "youtube": 0.85
    }
  }
}
```

#### Confidence Scores

| Score | Meaning |
|-------|---------|
| `0.98` | UPC/barcode match (most reliable) |
| `0.80-0.95` | Text search match with metadata validation |
| `null` | No confident match; URL may be a search fallback |

---

### Artist

Get artist information with AI-generated summary and top albums.

```
GET /api/v1/artist
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `q` | string | Yes | Artist name to search |
| `include` | string | No | Comma-separated: `summary`, `sentence`, `albums`. Default: all |

#### Example Request

```bash
curl -H "X-API-Key: your_key" \
  "https://listentomore.com/api/v1/artist?q=radiohead"
```

#### Example Response

```json
{
  "data": {
    "id": "4Z8W4fKeB5YxbusRsdQVPb",
    "name": "Radiohead",
    "genres": ["Art Rock", "Alternative Rock"],
    "image": "https://i.scdn.co/image/ab6761610000e5eb4104fbd80f1f795728abbd59",
    "url": "https://listentomore.com/artist/4Z8W4fKeB5YxbusRsdQVPb",
    "spotifyUrl": "https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb",
    "summary": {
      "content": "**Radiohead** is an English rock band formed in Abingdon, Oxfordshire, in 1985...[1] The band consists of Thom Yorke (vocals, guitar, piano), brothers Jonny Greenwood (lead guitar, keyboards) and Colin Greenwood (bass), Ed O'Brien (guitar, backing vocals), and Philip Selway (drums)...",
      "citations": [
        "https://en.wikipedia.org/wiki/Radiohead",
        "https://www.allmusic.com/artist/radiohead"
      ]
    },
    "sentence": "They are an English alternative rock band known for their experimental sound, blending electronic, art rock, and ambient influences. Similar artists include Portishead, Massive Attack, and Björk.",
    "topAlbums": [
      { "name": "OK Computer", "playcount": 235835672 },
      { "name": "In Rainbows", "playcount": 230324611 },
      { "name": "The Bends", "playcount": 163130748 },
      { "name": "Kid A", "playcount": 111207700 },
      { "name": "Pablo Honey", "playcount": 85040849 }
    ]
  }
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Spotify artist ID |
| `name` | string | Artist name |
| `genres` | string[] | Artist genres |
| `image` | string | Artist image URL |
| `url` | string | Listen To More artist page |
| `spotifyUrl` | string | Spotify artist URL |
| `summary.content` | string | AI-generated artist summary (Markdown) |
| `summary.citations` | string[] | Source URLs |
| `sentence` | string | Short one-sentence artist description (~38 words) |
| `topAlbums` | object[] | Top albums by play count (from Last.fm) |

---

### Genre

Get AI-generated information about a music genre.

```
GET /api/v1/genre
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `q` | string | Yes | Genre name (e.g., "shoegaze", "trip hop") |

#### Example Request

```bash
curl -H "X-API-Key: your_key" \
  "https://listentomore.com/api/v1/genre?q=shoegaze"
```

#### Example Response

```json
{
  "data": {
    "name": "shoegaze",
    "slug": "shoegaze",
    "url": "https://listentomore.com/genre/shoegaze",
    "summary": {
      "content": "**Shoegaze** is a subgenre of alternative rock that emerged in the United Kingdom during the late 1980s...[1] The name comes from the tendency of musicians to stare at their effects pedals during performances. Key characteristics include heavily distorted guitars, obscured vocals, and a wall of sound production style...",
      "citations": [
        "https://en.wikipedia.org/wiki/Shoegaze",
        "https://www.allmusic.com/style/shoegaze"
      ]
    }
  }
}
```

---

### Ask (Chat)

Chat with the music AI assistant. Powered by OpenAI GPT-4.

```
POST /api/v1/ask
```

#### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `question` | string | Yes | Your question about music |

#### Example Request

```bash
curl -X POST \
  -H "X-API-Key: your_key" \
  -H "Content-Type: application/json" \
  -d '{"question": "What albums should I listen to if I like OK Computer?"}' \
  "https://listentomore.com/api/v1/ask"
```

#### Example Response

```json
{
  "data": {
    "question": "What albums should I listen to if I like OK Computer?",
    "answer": "If you enjoy OK Computer, I'd recommend exploring these albums:\n\n1. **Kid A** by Radiohead - The natural next step, where the band pushed further into electronic territory.\n\n2. **Homogenic** by Björk - Shares OK Computer's blend of organic and electronic sounds with an operatic edge.\n\n3. **The Moon & Antarctica** by Modest Mouse - Expansive, existential rock with similar thematic depth.\n\n4. **Lift Your Skinny Fists Like Antennas to Heaven** by Godspeed You! Black Emperor - Epic post-rock that captures the same sense of technological unease.\n\n5. **69 Love Songs** by The Magnetic Fields - Different sonically, but shares the ambitious scope and clever songwriting."
  }
}
```

---

## Error Handling

All errors return JSON with an `error` field and appropriate HTTP status code.

### Error Response Format

```json
{
  "error": "Error type",
  "message": "Detailed error message",
  "details": "Additional context (development only)"
}
```

### HTTP Status Codes

| Code | Description |
|------|-------------|
| `400` | Bad Request - Missing or invalid parameters |
| `401` | Unauthorized - Invalid or missing API key |
| `404` | Not Found - Album/artist not found |
| `429` | Too Many Requests - Rate limit exceeded |
| `500` | Internal Server Error - Something went wrong |

### Example Error Responses

**Missing parameters:**
```json
{
  "error": "Missing required parameters: artist and album"
}
```

**Album not found:**
```json
{
  "error": "Album not found",
  "artist": "radiohead",
  "album": "nonexistent album"
}
```

**Rate limited:**
```json
{
  "error": "Rate limit exceeded",
  "message": "Too many requests. Please wait before making more requests."
}
```

---

## Getting an API Key

API keys are currently issued manually. To request access:

1. **Open an issue** on the [GitHub repository](https://github.com/rianvdm/listentomore)
2. **Email:** elezea.com/contact

Include a brief description of how you plan to use the API.

**Important:** Keep your API key secure and never expose it in client-side code.

---

## Caching

Responses are cached to improve performance and reduce load on upstream services:

| Data Type | Cache Duration |
|-----------|---------------|
| Album metadata | 30 days |
| Artist metadata | 30 days |
| AI summaries | 120-180 days |
| Streaming links | 30 days |

Cached responses are indistinguishable from fresh responses. If you need to force a refresh of cached data, contact the administrator.

---

## Changelog

### v1.0.0 (December 2025)

Initial public API release with:
- Album details with AI summaries and streaming links
- Album recommendations
- Cross-platform streaming links
- Artist details with AI summaries
- Genre information
- Chat endpoint
