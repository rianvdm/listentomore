# Streaming Links Service Implementation Plan

## Overview

A self-hosted service to resolve Spotify track and album URLs to Apple Music and YouTube Music links. Designed as an internal package initially, with architecture that supports external API exposure later.

**Supports both:**
- **Tracks** - Direct links to songs on each platform
- **Albums** - Direct links to albums on each platform

## Why Build This?

- **Songlink rate limits** causing issues in production
- **Control over caching** - can cache aggressively since music metadata rarely changes
- **Reduced dependencies** - no third-party service for core functionality
- **Cost** - free with current usage patterns

---

## Architecture

```
packages/
  services/
    streaming-links/          # New service package
      src/
        index.ts              # Main service class
        providers/
          base.ts             # Base provider interface
          spotify.ts          # Extract ISRC + metadata from Spotify
          apple-music.ts      # Apple Music via iTunes Search API
          youtube.ts          # YouTube Music via Data API v3
        types.ts              # Shared types
        matching.ts           # Fuzzy matching utilities
```

### Integration

Lives in `packages/services/streaming-links`, called directly from existing web worker. Uses same KV namespace for caching. No additional infrastructure needed.

---

## Platform Strategies

### 1. Spotify (Source)

**API**: Official Spotify Web API (free tier)

**What we extract (Track):**
```typescript
{
  type: "track",
  id: "4iV5W9uYEdYUVa79Axb7Rh",
  isrc: "USRC11700112",        // International Standard Recording Code
  name: "Track Name",
  artists: ["Artist Name"],
  album: "Album Name",
  durationMs: 234000,
  releaseDate: "2017-03-03"
}
```

**What we extract (Album):**
```typescript
{
  type: "album",
  id: "4LH4d3cOWNNsVw41Gqt2kv",
  upc: "886445635843",         // Universal Product Code (album equivalent of ISRC)
  name: "Album Name",
  artists: ["Artist Name"],
  totalTracks: 12,
  releaseDate: "2017-03-03"
}
```

**Rate Limits**: ~180 requests/minute - plenty for our needs

### 2. Apple Music

**API**: iTunes Search API (free, no auth required)

**Track Search:**
```
GET https://itunes.apple.com/search?term={artist}+{track}&entity=song&limit=10
```

**Album Search:**
```
GET https://itunes.apple.com/search?term={artist}+{album}&entity=album&limit=10
```

**Why iTunes Search API:**
- Free, no authentication
- No rate limits (reasonable use)
- Stable for 10+ years
- Returns Apple Music URLs

**Matching Strategy (Tracks):**
1. Search by `"{artist}" "{track}"` (quoted for exact matching)
2. Score results by:
   - Artist name similarity (Levenshtein distance)
   - Track name similarity
   - Duration match (within 5 seconds)
   - Album name match (bonus)
3. Accept matches with confidence > 0.8
4. Return Apple Music URL from best match

**Matching Strategy (Albums):**
1. Search by `"{artist}" "{album}"`
2. Score results by:
   - Artist name similarity
   - Album name similarity
   - Track count match (bonus)
   - Release year match (bonus)
3. Accept matches with confidence > 0.8

**Example Track Response:**
```json
{
  "results": [{
    "trackId": 1440913665,
    "trackName": "Bohemian Rhapsody",
    "artistName": "Queen",
    "collectionName": "Greatest Hits",
    "trackViewUrl": "https://music.apple.com/us/album/bohemian-rhapsody/1440913608?i=1440913665",
    "trackTimeMillis": 354320
  }]
}
```

**Example Album Response:**
```json
{
  "results": [{
    "collectionId": 1440913608,
    "collectionName": "Greatest Hits",
    "artistName": "Queen",
    "collectionViewUrl": "https://music.apple.com/us/album/greatest-hits/1440913608",
    "trackCount": 17,
    "releaseDate": "1981-10-26T07:00:00Z"
  }]
}
```

### 3. YouTube Music

**API**: YouTube Data API v3

**Authentication**: API Key (free tier)

**Quota**: 10,000 units/day
- Search request = 100 units
- **Effective limit**: 100 searches/day uncached
- With 30-day cache: supports ~3,000 unique items/month

**Track Search:**
```
GET https://www.googleapis.com/youtube/v3/search
  ?part=snippet
  &q={artist}+{track}+audio
  &type=video
  &videoCategoryId=10        # Music category
  &key={API_KEY}
```

**Album Search:**
```
GET https://www.googleapis.com/youtube/v3/search
  ?part=snippet
  &q={artist}+{album}+full+album
  &type=playlist
  &key={API_KEY}
```

**Matching Strategy (Tracks):**
1. Search for `{artist} {track} audio` in Music category
2. Filter for videos from official artist channels or known music aggregators (Topic channels, VEVO)
3. Prefer videos with "Official Audio" or "Official Music Video" in title
4. Return YouTube Music URL: `https://music.youtube.com/watch?v={videoId}`

**Matching Strategy (Albums):**
1. Search for `{artist} {album} full album` as playlist
2. Prefer playlists from official artist channels or Topic channels
3. Verify track count roughly matches
4. Return YouTube Music URL: `https://music.youtube.com/playlist?list={playlistId}`
5. **Fallback**: If no playlist found, return search URL

**Topic Channels**: YouTube auto-generates "Artist - Topic" channels with clean audio versions and album playlists. These are ideal matches.

**Example Track Response:**
```json
{
  "items": [{
    "id": { "videoId": "fJ9rUzIMcZQ" },
    "snippet": {
      "title": "Queen – Bohemian Rhapsody (Official Video Remastered)",
      "channelTitle": "Queen Official",
      "channelId": "UCiMhD4jzUqG-IgPzUmmytRQ"
    }
  }]
}
```

**Example Album Response:**
```json
{
  "items": [{
    "id": { "playlistId": "OLAK5uy_m6AGzVPVKw" },
    "snippet": {
      "title": "A Night at the Opera",
      "channelTitle": "Queen - Topic",
      "channelId": "UCiMhD4jzUqG-IgPzUmmytRQ"
    }
  }]
}
```

---

## Implementation Phases

### Phase 1: Core Service

**Goal**: Working service with Apple Music + YouTube Music

**Tasks:**

1. **Create package structure**
   ```
   packages/services/streaming-links/
   ├── package.json
   ├── tsconfig.json
   └── src/
       ├── index.ts
       ├── types.ts
       ├── matching.ts
       └── providers/
           ├── base.ts
           ├── apple-music.ts
           └── youtube.ts
   ```

2. **Implement provider interface**
   ```typescript
   interface StreamingProvider {
     name: string;
     searchTrack(metadata: TrackMetadata): Promise<ProviderResult | null>;
     searchAlbum(metadata: AlbumMetadata): Promise<ProviderResult | null>;
   }
   ```

3. **Implement iTunes Search provider**
   - Query construction with proper encoding
   - Response parsing
   - Confidence scoring

4. **Implement YouTube Data API provider**
   - API key management via environment
   - Query construction optimized for music
   - Topic channel preference
   - Quota tracking

5. **Implement matching utilities**
   - Levenshtein distance for fuzzy string matching
   - Duration comparison with tolerance
   - Confidence score calculation

6. **Add caching layer**
   - KV cache with 30-day TTL
   - Cache key: `streaming-links:{type}:{spotifyId}`

7. **Create internal API endpoint**
   - `GET /api/internal/streaming-links?spotifyId={id}&type={track|album}`

8. **Integration**
   - Add to service initialization middleware
   - Replace Songlink calls in existing pages

### Phase 2: Monitoring & Optimization

**Goal**: Production-ready with observability

**Tasks:**
- Add quota usage tracking for YouTube API
- Log match confidence scores
- Alert on low match rates
- Add fallback to search URLs when API quota exhausted

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        Request Flow                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Input: Spotify track/album ID                               │
│                                                                  │
│  2. Check Cache (KV)                                            │
│     └─► Cache hit? Return immediately                           │
│                                                                  │
│  3. Get Spotify Metadata                                        │
│     └─► ISRC, artist, title, album, duration                    │
│                                                                  │
│  4. Query Providers (parallel)                                  │
│     ├─► Apple Music (iTunes Search API)                         │
│     └─► YouTube Music (Data API v3)                             │
│                                                                  │
│  5. Score & Validate Matches                                    │
│     └─► Confidence threshold: 0.8                               │
│                                                                  │
│  6. Cache Results (KV, 30 days TTL)                             │
│                                                                  │
│  7. Return Response                                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## API Design

### Internal Endpoint

```typescript
// GET /api/internal/streaming-links?spotifyId={id}&type=track

// Success Response
{
  "success": true,
  "data": {
    "appleMusic": {
      "url": "https://music.apple.com/us/album/bohemian-rhapsody/1440913608?i=1440913665",
      "confidence": 0.95,
      "matched": {
        "artist": "Queen",
        "track": "Bohemian Rhapsody"
      }
    },
    "youtube": {
      "url": "https://music.youtube.com/watch?v=fJ9rUzIMcZQ",
      "confidence": 0.92,
      "matched": {
        "title": "Queen – Bohemian Rhapsody (Official Video Remastered)",
        "channel": "Queen Official"
      }
    }
  },
  "source": {
    "artist": "Queen",
    "track": "Bohemian Rhapsody",
    "isrc": "GBUM71029604"
  },
  "cached": false
}

// Partial match (YouTube quota exhausted)
{
  "success": true,
  "data": {
    "appleMusic": {
      "url": "https://music.apple.com/...",
      "confidence": 0.95
    },
    "youtube": {
      "url": "https://music.youtube.com/search?q=Queen+Bohemian+Rhapsody",
      "confidence": 0,
      "fallback": true
    }
  }
}
```

### Service Interface

```typescript
interface StreamingLinksService {
  getTrackLinks(spotifyId: string): Promise<StreamingLinksResult>;
  getAlbumLinks(spotifyId: string): Promise<StreamingLinksResult>;
  getQuotaStatus(): Promise<QuotaStatus>;
  clearCache(spotifyId: string, type: 'track' | 'album'): Promise<void>;
}

interface StreamingLinksResult {
  appleMusic: PlatformLink | null;
  youtube: PlatformLink | null;
  source: TrackMetadata | AlbumMetadata;
  cached: boolean;
}

interface PlatformLink {
  url: string;
  confidence: number;      // 0-1, where 1 is perfect match
  fallback?: boolean;      // true if using search URL
  matched?: {
    [key: string]: string; // What we matched against
  };
}

interface TrackMetadata {
  type: 'track';
  id: string;
  isrc: string;
  name: string;
  artists: string[];
  album: string;
  durationMs: number;
}

interface AlbumMetadata {
  type: 'album';
  id: string;
  upc?: string;
  name: string;
  artists: string[];
  totalTracks: number;
  releaseYear: number;
}

interface QuotaStatus {
  youtube: {
    used: number;
    limit: number;
    resetsAt: string;
  };
}
```

---

## Matching Algorithm

### Track Confidence Scoring

```typescript
function calculateTrackConfidence(source: TrackMetadata, result: SearchResult): number {
  const weights = {
    artist: 0.35,
    track: 0.35,
    duration: 0.20,
    album: 0.10
  };

  let score = 0;

  // Artist similarity (normalized Levenshtein)
  score += weights.artist * similarity(source.artist, result.artist);

  // Track similarity
  score += weights.track * similarity(source.track, result.track);

  // Duration match (within 5 seconds = 1.0, within 30 seconds = 0.5)
  const durationDiff = Math.abs(source.durationMs - result.durationMs);
  if (durationDiff < 5000) score += weights.duration * 1.0;
  else if (durationDiff < 30000) score += weights.duration * 0.5;

  // Album match (bonus, not required)
  if (source.album && result.album) {
    score += weights.album * similarity(source.album, result.album);
  }

  return score;
}
```

### Album Confidence Scoring

```typescript
function calculateAlbumConfidence(source: AlbumMetadata, result: SearchResult): number {
  const weights = {
    artist: 0.40,
    album: 0.40,
    trackCount: 0.10,
    releaseYear: 0.10
  };

  let score = 0;

  // Artist similarity
  score += weights.artist * similarity(source.artist, result.artist);

  // Album name similarity
  score += weights.album * similarity(source.name, result.name);

  // Track count match (within 2 = 1.0, within 5 = 0.5)
  if (source.totalTracks && result.trackCount) {
    const trackDiff = Math.abs(source.totalTracks - result.trackCount);
    if (trackDiff <= 2) score += weights.trackCount * 1.0;
    else if (trackDiff <= 5) score += weights.trackCount * 0.5;
  }

  // Release year match
  if (source.releaseYear === result.releaseYear) {
    score += weights.releaseYear * 1.0;
  }

  return score;
}
```

### Edge Cases

| Scenario | Type | Handling |
|----------|------|----------|
| Remix/cover with same name | Track | Duration check filters most |
| Live vs studio version | Track | Prefer studio (shorter duration) |
| Regional variations | Both | Accept any region's URL |
| Various Artists albums | Track | Match on track + primary artist |
| Deluxe/Remaster editions | Album | Prefer closest track count match |
| Compilation albums | Album | Lower confidence, may return search URL |
| No results found | Both | Return search URL as fallback |

---

## Environment Variables

```bash
# Required
YOUTUBE_API_KEY=AIza...              # YouTube Data API v3 key

# Optional (for monitoring)
YOUTUBE_QUOTA_ALERT_THRESHOLD=8000   # Alert when quota usage exceeds this
```

---

## Cost Analysis

| Service | Cost | Daily Limit | With 30-day Cache |
|---------|------|-------------|-------------------|
| iTunes Search API | Free | Unlimited | Unlimited |
| YouTube Data API | Free | 100 searches | ~3,000 tracks/month |
| Cloudflare KV | Free tier | 100k reads, 1k writes | Plenty |

**Total: $0/month** for typical usage patterns.

**If you exceed YouTube quota:**
- Apply for quota increase (usually granted for legitimate use)
- Fall back to search URLs for overflow
- Consider YouTube Data API paid tier ($0.00 for first 10k units)

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| iTunes API changes | Low | High | Stable 10+ years; fallback to search URLs |
| YouTube quota exceeded | Medium | Low | Fallback to search URLs; request increase |
| Poor match accuracy | Low | Medium | Confidence threshold; manual review of low scores |
| Topic channel unavailable | Low | Low | Fall back to official uploads or search |

---

## Success Criteria

**Tracks:**
- [ ] 90%+ match rate for Apple Music (popular tracks)
- [ ] 85%+ match rate for YouTube Music (popular tracks)

**Albums:**
- [ ] 90%+ match rate for Apple Music (popular albums)
- [ ] 70%+ match rate for YouTube Music (album playlists found)

**Performance:**
- [ ] < 200ms response time (cached)
- [ ] < 1s response time (uncached)
- [ ] YouTube quota usage < 80% daily
- [ ] Zero Songlink API calls

---

## Next Steps

1. Create `packages/services/streaming-links` package
2. Implement iTunes Search provider + matching (tracks & albums)
3. Implement YouTube Data API provider (tracks & albums)
4. Add KV caching
5. Create internal endpoint
6. Test with 50 sample tracks + 50 sample albums
7. Integrate into track and album detail pages
8. Remove Songlink dependency

---

## Appendix A: Adding Future Providers

The provider architecture makes adding new platforms straightforward. Each provider implements the same interface:

```typescript
interface StreamingProvider {
  name: string;
  searchTrack(metadata: TrackMetadata): Promise<ProviderResult | null>;
  searchAlbum(metadata: AlbumMetadata): Promise<ProviderResult | null>;
}
```

### Tidal

**API Status**: No public API. Options:

1. **Partnership Application**
   - Apply at https://developer.tidal.com/
   - Typically requires business justification
   - If approved, provides full API access with ISRC search

2. **Unofficial API** (use at own risk)
   ```typescript
   // Requires authentication token
   GET https://api.tidal.com/v1/search
     ?query={artist}+{track}
     &types=TRACKS
     &countryCode=US
   ```
   - Tokens can be obtained via OAuth device flow
   - May break without notice

3. **Search URL Fallback**
   ```typescript
   const tidalSearchUrl = `https://tidal.com/search?q=${encodeURIComponent(query)}`;
   ```

**Implementation:**
```typescript
// providers/tidal.ts
export class TidalProvider implements StreamingProvider {
  name = 'tidal';

  async searchTrack(metadata: TrackMetadata): Promise<ProviderResult | null> {
    const query = `${metadata.artists[0]} ${metadata.name}`;
    // If you have API access, search via API here
    return {
      url: `https://tidal.com/search?q=${encodeURIComponent(query)}`,
      confidence: 0,
      fallback: true
    };
  }

  async searchAlbum(metadata: AlbumMetadata): Promise<ProviderResult | null> {
    const query = `${metadata.artists[0]} ${metadata.name}`;
    return {
      url: `https://tidal.com/search?q=${encodeURIComponent(query)}`,
      confidence: 0,
      fallback: true
    };
  }
}
```

### Qobuz

**API Status**: Private API, partnership required.

1. **Partnership Application**
   - Apply at https://www.qobuz.com/partners
   - Often rejected for small projects
   - If approved, full ISRC-based search available

2. **Search URL Fallback**
   ```typescript
   const qobuzSearchUrl = `https://www.qobuz.com/search?q=${encodeURIComponent(query)}`;
   ```

**Implementation:**
```typescript
// providers/qobuz.ts
export class QobuzProvider implements StreamingProvider {
  name = 'qobuz';

  async searchTrack(metadata: TrackMetadata): Promise<ProviderResult | null> {
    const query = `${metadata.artists[0]} ${metadata.name}`;
    return {
      url: `https://www.qobuz.com/search?q=${encodeURIComponent(query)}`,
      confidence: 0,
      fallback: true
    };
  }

  async searchAlbum(metadata: AlbumMetadata): Promise<ProviderResult | null> {
    const query = `${metadata.artists[0]} ${metadata.name}`;
    return {
      url: `https://www.qobuz.com/search?q=${encodeURIComponent(query)}`,
      confidence: 0,
      fallback: true
    };
  }
}
```

### Amazon Music

**API Status**: No public search API.

- Amazon Product Advertising API exists but doesn't cover Amazon Music streaming
- Best option is search URL fallback

```typescript
const amazonMusicUrl = `https://music.amazon.com/search/${encodeURIComponent(query)}`;
```

### Deezer

**API Status**: Public API, free, no auth required for search.

```
GET https://api.deezer.com/search?q={artist}+{track}
```

**This is actually a great candidate for Phase 2** - free, documented, and reliable.

**Implementation:**
```typescript
// providers/deezer.ts
export class DeezerProvider implements StreamingProvider {
  name = 'deezer';

  async searchTrack(metadata: TrackMetadata): Promise<ProviderResult | null> {
    const query = `artist:"${metadata.artists[0]}" track:"${metadata.name}"`;
    const response = await fetch(
      `https://api.deezer.com/search?q=${encodeURIComponent(query)}`
    );
    const data = await response.json();

    if (data.data?.[0]) {
      const track = data.data[0];
      return {
        url: track.link, // https://www.deezer.com/track/123
        confidence: this.calculateConfidence(metadata, track),
        matched: { artist: track.artist.name, track: track.title }
      };
    }
    return null;
  }

  async searchAlbum(metadata: AlbumMetadata): Promise<ProviderResult | null> {
    const query = `artist:"${metadata.artists[0]}" album:"${metadata.name}"`;
    const response = await fetch(
      `https://api.deezer.com/search/album?q=${encodeURIComponent(query)}`
    );
    const data = await response.json();

    if (data.data?.[0]) {
      const album = data.data[0];
      return {
        url: album.link, // https://www.deezer.com/album/123
        confidence: this.calculateConfidence(metadata, album),
        matched: { artist: album.artist.name, album: album.title }
      };
    }
    return null;
  }
}
```

### SoundCloud

**API Status**: Public API available but requires registration.

- Apply at https://developers.soundcloud.com/
- Free tier available
- Good for indie/electronic music not on major platforms

### Adding a New Provider Checklist

1. Create `providers/{name}.ts` implementing `StreamingProvider`
2. Add provider to `StreamingLinksService` initialization
3. Add environment variables for any API keys
4. Update types to include new platform in `StreamingLinksResult`
5. Add caching for new provider responses
6. Update API response documentation
7. Test with sample tracks across genres

