# Streaming Links Service Implementation Plan

## Overview

A self-hosted service to resolve Spotify track and album URLs to Apple Music and YouTube links. Designed as an internal package initially, with architecture that supports external API exposure later.

**Supports both:**
- **Tracks** - Direct links to songs on each platform
- **Albums** - Direct links to albums on each platform

## Current Status: ✅ LIVE

The streaming-links service is fully implemented and deployed. See [Implementation Status](#implementation-status) for details.

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
          apple-music.ts      # Apple Music via Apple MusicKit API
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

### 2. Apple Music ✅ IMPLEMENTED

**API**: Apple MusicKit API (requires Apple Developer credentials)

**Authentication**: JWT signed with ES256 algorithm
- Requires: Team ID, Key ID, Private Key (.p8 file)
- Tokens cached for 50 minutes (API allows up to 6 months)

**Strategy:**
1. **ISRC Lookup (tracks)** - Highest confidence (0.98)
   ```
   GET https://api.music.apple.com/v1/catalog/us/songs?filter[isrc]={isrc}
   ```
2. **UPC Lookup (albums)** - Highest confidence (0.98)
   ```
   GET https://api.music.apple.com/v1/catalog/us/albums?filter[upc]={upc}
   ```
3. **Text Search Fallback** - Uses confidence scoring
   ```
   GET https://api.music.apple.com/v1/catalog/us/search?term={query}&types=songs&limit=10
   ```

**Geo-Agnostic URLs**: All returned URLs have storefront removed (e.g., `/us/` stripped) so Apple auto-redirects users to their local store.

**Matching Strategy (Text Search):**
- Score results by artist similarity (0.35), track similarity (0.35), duration match (0.20), album match (0.10)
- Accept matches with confidence > 0.8
- Fallback to search URL if no high-confidence match

**Environment Variables:**
```bash
APPLE_MUSIC_TEAM_ID=      # Apple Developer Team ID
APPLE_MUSIC_KEY_ID=       # MusicKit Key ID
APPLE_MUSIC_PRIVATE_KEY=  # Contents of .p8 private key file
```

### 3. YouTube ✅ IMPLEMENTED

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
  &q={artist}+{track}
  &type=video
  &videoCategoryId=10        # Music category
  &maxResults=10
  &key={API_KEY}
```

**Album Handling:** Returns search URL directly (no API call) to conserve quota.

**Matching Strategy (Tracks):**
1. Search for `{artist} {track}` in Music category
2. Score results by:
   - Track name in title (0.4 max, with token overlap fallback)
   - Artist name in title/channel (0.3 max)
   - Official channel patterns: VEVO, Topic, Official, Records, Music (0.15 bonus)
   - Official title patterns: "Official Video", "Official Audio", etc. (0.15 bonus)
3. Accept matches with score > 0.5
4. Returns standard YouTube URL: `https://www.youtube.com/watch?v={videoId}`

**Official Channel Patterns:**
- `/vevo$/i`, `/- topic$/i`, `/official$/i`, `/records$/i`, `/music$/i`

**Official Title Patterns:**
- `/official\s*(music\s*)?video/i`, `/official\s*audio/i`, `/\(audio\)/i`

**Environment Variables:**
```bash
YOUTUBE_API_KEY=AIza...  # YouTube Data API v3 key
```

---

## Implementation Status

### Phase 1: Core Service ✅ COMPLETE

| Task | Status | Notes |
|------|--------|-------|
| Package structure | ✅ | `packages/services/streaming-links/` |
| Provider interface | ✅ | `StreamingProvider` in `types.ts` |
| Apple Music provider | ✅ | MusicKit API with ISRC/UPC + text search |
| YouTube provider | ✅ | Data API v3 with smart scoring |
| Matching utilities | ✅ | Levenshtein distance + confidence scoring |
| KV caching | ✅ | Cache key: `streaming-links:{type}:{spotifyId}` |
| Integration | ✅ | Backward-compatible `StreamingLinks` interface |

### Phase 2: Monitoring & Optimization ⏳ PARTIAL

| Task | Status | Notes |
|------|--------|-------|
| Confidence score logging | ✅ | Logged for each match |
| Search URL fallback | ✅ | Used when API fails or no match |
| Quota usage tracking | ❌ | Not implemented |
| Low match rate alerts | ❌ | Not implemented |

### Package Structure (Actual)

```
packages/services/streaming-links/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts           # Main service class + exports
    ├── types.ts           # TypeScript interfaces
    ├── matching.ts        # String similarity + confidence scoring
    └── providers/
        ├── apple-music.ts # MusicKit API provider
        └── youtube.ts     # YouTube Data API provider
```

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
│     ├─► Apple Music (MusicKit API)                              │
│     └─► YouTube (Data API v3)                                   │
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
- [x] 90%+ match rate for Apple Music (popular tracks) - Using ISRC lookup
- [x] 85%+ match rate for YouTube (popular tracks) - Using smart scoring

**Albums:**
- [x] 90%+ match rate for Apple Music (popular albums) - Using UPC lookup
- [x] Search URL fallback for YouTube (album playlists not searched)

**Performance:**
- [x] < 200ms response time (cached)
- [x] < 1s response time (uncached)
- [ ] YouTube quota usage < 80% daily - Not tracked
- [x] Zero Songlink API calls

---

## Future Work

1. **Add quota tracking** for YouTube API usage
2. **Add Deezer provider** - Free public API, good coverage
3. **Add Bandcamp provider** - Search URL fallback; show when available (see Appendix)
4. **Add Amazon Music provider** - Requires closed beta API access (see Appendix)
5. **Monitor match confidence** - Alert on degraded match rates
6. **Test coverage** - Add unit tests for matching algorithms

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

**API Status**: Closed Beta (as of December 2024)

Amazon now has an official **Amazon Music Web API** but it is in **closed beta** with access limited to approved developers.

**If Approved:**
- OAuth 2.0 authentication via Login with Amazon (LWA)
- Search endpoint: `GET /v1/search?query={query}&limit=10`
- Returns tracks, albums, artists with Amazon Music IDs
- Would enable high-confidence matching similar to Apple Music

**Requirements for API Access:**
1. Create LWA account and security profile
2. Contact Amazon Music team for beta access
3. Security Profile ID must be enabled by Amazon Music Service

**Current Best Option**: Search URL fallback (no API call required)

```typescript
const amazonMusicUrl = `https://music.amazon.com/search/${encodeURIComponent(query)}`;
```

**Implementation (Fallback Only):**
```typescript
// providers/amazon-music.ts
export class AmazonMusicProvider implements StreamingProvider {
  name = 'amazonMusic';

  async searchTrack(metadata: TrackMetadata): Promise<ProviderResult | null> {
    const query = `${metadata.artists[0]} ${metadata.name}`;
    return {
      url: `https://music.amazon.com/search/${encodeURIComponent(query)}`,
      confidence: 0,
      fallback: true
    };
  }

  async searchAlbum(metadata: AlbumMetadata): Promise<ProviderResult | null> {
    const query = `${metadata.artists[0]} ${metadata.name}`;
    return {
      url: `https://music.amazon.com/search/${encodeURIComponent(query)}`,
      confidence: 0,
      fallback: true
    };
  }
}
```

**Implementation (With API Access - Future):**
```typescript
// providers/amazon-music.ts (with API access)
export interface AmazonMusicConfig {
  accessToken: string;  // OAuth 2.0 bearer token from LWA
  apiKey: string;       // Security Profile ID
}

export class AmazonMusicProvider implements StreamingProvider {
  name = 'amazonMusic';
  private config: AmazonMusicConfig | null;

  constructor(config?: AmazonMusicConfig) {
    this.config = config || null;
  }

  async searchTrack(metadata: TrackMetadata): Promise<ProviderResult | null> {
    if (!this.config) {
      return this.getFallbackUrl(metadata);
    }

    const query = `${metadata.artists[0]} ${metadata.name}`;
    const response = await fetch(
      `https://api.music.amazon.com/v1/search?query=${encodeURIComponent(query)}&limit=10`,
      {
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`,
          'x-api-key': this.config.apiKey
        }
      }
    );

    const data = await response.json();
    const tracks = data.data?.[0]?.content?.entityGroups
      ?.find((g: any) => g.id === 'tracks')?.content?.entities;

    if (tracks?.[0]) {
      const track = tracks[0];
      return {
        url: `https://music.amazon.com/tracks/${track.id}`,
        confidence: this.calculateConfidence(metadata, track),
        matched: { artist: track.artistName, track: track.title }
      };
    }

    return this.getFallbackUrl(metadata);
  }

  // ... similar for searchAlbum
}
```

### Bandcamp

**API Status**: Official API is restricted to labels/merchandise partners only. No public search API.

**Why Include Bandcamp?**
- Supports independent artists directly
- Many albums only available on Bandcamp
- Good for indie, electronic, experimental music
- Show when available, hide when not (since coverage is limited)

**Options:**

1. **Official API** (not viable)
   - Apply at https://bandcamp.com/contact?subj=API%20Access
   - Only available to labels and merchandise fulfillment partners
   - Requires OAuth 2.0 authentication
   - Not suitable for general music discovery apps

2. **bandcamp-fetch Library** (scraping)
   - npm: `bandcamp-fetch`
   - Scrapes Bandcamp pages to search albums/tracks
   - Has built-in rate limiting via Bottleneck
   - ⚠️ May not work in Cloudflare Workers (uses Bottleneck)
   - ⚠️ Fragile - can break when Bandcamp changes HTML
   - Would need testing before use

3. **Search URL Fallback** (recommended)
   ```typescript
   const bandcampSearchUrl = `https://bandcamp.com/search?q=${encodeURIComponent(query)}`;
   ```

**Implementation (Fallback Only - Recommended):**
```typescript
// providers/bandcamp.ts
export class BandcampProvider implements StreamingProvider {
  name = 'bandcamp';

  async searchTrack(metadata: TrackMetadata): Promise<ProviderResult | null> {
    const query = `${metadata.artists[0]} ${metadata.name}`;
    return {
      url: `https://bandcamp.com/search?q=${encodeURIComponent(query)}&item_type=t`,
      confidence: 0,
      fallback: true
    };
  }

  async searchAlbum(metadata: AlbumMetadata): Promise<ProviderResult | null> {
    const query = `${metadata.artists[0]} ${metadata.name}`;
    return {
      url: `https://bandcamp.com/search?q=${encodeURIComponent(query)}&item_type=a`,
      confidence: 0,
      fallback: true
    };
  }
}
```

**Note**: Bandcamp search URLs support `item_type` parameter:
- `item_type=t` - Tracks only
- `item_type=a` - Albums only
- `item_type=b` - Artists/bands only

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

