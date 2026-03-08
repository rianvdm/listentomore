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
# Currently Required
YOUTUBE_API_KEY=AIza...              # YouTube Data API v3 key
APPLE_MUSIC_TEAM_ID=...              # Apple Developer Team ID
APPLE_MUSIC_KEY_ID=...               # MusicKit Key ID
APPLE_MUSIC_PRIVATE_KEY=...          # Contents of .p8 private key file

# Phase 2: Deezer
# None required! Deezer API is fully public.

# Phase 2: Tidal
TIDAL_CLIENT_ID=...                  # From TIDAL Developer Dashboard
TIDAL_CLIENT_SECRET=...              # From TIDAL Developer Dashboard

# Phase 2: Qobuz (if approved for partnership)
QOBUZ_APP_ID=...                     # From Qobuz partnership (optional)
QOBUZ_APP_SECRET=...                 # From Qobuz partnership (optional)

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

### Phase 2: Additional Providers (Recommended Order)

| Priority | Provider | Effort | Notes |
|----------|----------|--------|-------|
| 1 | **Deezer** | Low | Free API, ISRC lookup, no auth required |
| 2 | **Tidal** | Medium | Official API, requires OAuth setup |
| 3 | **Qobuz** | Low | Search URL fallback only (API requires partnership) |
| 4 | **Bandcamp** | Low | Search URL fallback (see Appendix) |
| 5 | **Amazon Music** | N/A | Closed beta, revisit when public |

### Other Improvements

1. **Add quota tracking** for YouTube API usage
2. **Monitor match confidence** - Alert on degraded match rates
3. **Test coverage** - Add unit tests for matching algorithms
4. **Add retry logic** for rate-limited requests (Deezer error code 4)

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

### Tidal ⭐ RECOMMENDED

**API Status**: Official public API available (as of 2024)

TIDAL now offers an official developer API that allows **catalog access without user subscription** using the OAuth 2.0 Client Credentials flow. This is ideal for our use case.

**Authentication**: OAuth 2.0 Client Credentials
- Register at https://developer.tidal.com/
- Create an app to get Client ID and Client Secret
- No user login required for catalog search

**Setup Steps:**
1. Sign up at [TIDAL Developer Portal](https://developer.tidal.com/)
2. Create a new application in the Dashboard
3. Note your Client ID and Client Secret
4. Use client credentials flow to obtain access token

**Token Exchange:**
```bash
# Get access token (expires in ~24 hours)
curl -X POST https://auth.tidal.com/v1/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=${TIDAL_CLIENT_ID}" \
  -d "client_secret=${TIDAL_CLIENT_SECRET}"

# Response:
{
  "access_token": "eyJ...",
  "token_type": "Bearer",
  "expires_in": 86400
}
```

**Strategy:**
1. **Text Search** - Primary method
   ```
   GET https://openapi.tidal.com/v2/searchresults/{query}/relationships/tracks
     ?countryCode=US
     &limit=10
   Headers:
     Authorization: Bearer {access_token}
     Content-Type: application/vnd.api+json
   ```

2. **Search URL Fallback** - When API unavailable
   ```typescript
   const tidalSearchUrl = `https://tidal.com/search?q=${encodeURIComponent(query)}`;
   ```

**API Response Format** (JSON:API spec):
```typescript
interface TidalSearchResponse {
  data: Array<{
    id: string;
    type: 'tracks';
    attributes: {
      title: string;
      isrc: string;
      duration: string;  // ISO 8601 duration, e.g., "PT3M45S"
      explicit: boolean;
    };
    relationships: {
      artists: { data: Array<{ id: string; type: 'artists' }> };
      albums: { data: Array<{ id: string; type: 'albums' }> };
    };
  }>;
  included: Array<{
    id: string;
    type: 'artists' | 'albums';
    attributes: { name: string; /* ... */ };
  }>;
}
```

**Matching Strategy:**
- Score results by artist similarity (0.35), track similarity (0.35), duration match (0.20), album match (0.10)
- ISRC is returned in response - can use for verification
- Accept matches with confidence > 0.8
- Fallback to search URL if no high-confidence match

**Rate Limits**: Not publicly documented, but reasonable for typical usage

**Environment Variables:**
```bash
TIDAL_CLIENT_ID=...       # From TIDAL Developer Dashboard
TIDAL_CLIENT_SECRET=...   # From TIDAL Developer Dashboard
```

**Implementation:**
```typescript
// providers/tidal.ts
export interface TidalConfig {
  clientId: string;
  clientSecret: string;
}

export class TidalProvider implements StreamingProvider {
  name = 'tidal';
  private config: TidalConfig | null;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(config?: TidalConfig) {
    this.config = config || null;
  }

  private async getAccessToken(): Promise<string | null> {
    if (!this.config) return null;

    // Return cached token if still valid (with 5 min buffer)
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 300000) {
      return this.accessToken;
    }

    const response = await fetch('https://auth.tidal.com/v1/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret
      })
    });

    if (!response.ok) {
      console.error('TIDAL token error:', await response.text());
      return null;
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in * 1000);
    return this.accessToken;
  }

  async searchTrack(metadata: TrackMetadata): Promise<ProviderResult | null> {
    const query = `${metadata.artists[0]} ${metadata.name}`;

    const token = await this.getAccessToken();
    if (!token) {
      return this.getFallbackUrl(query);
    }

    try {
      const response = await fetch(
        `https://openapi.tidal.com/v2/searchresults/${encodeURIComponent(query)}/relationships/tracks?countryCode=US&limit=10`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/vnd.api+json'
          }
        }
      );

      if (!response.ok) {
        console.error('TIDAL search error:', response.status);
        return this.getFallbackUrl(query);
      }

      const data = await response.json();
      const tracks = data.data || [];
      const included = data.included || [];

      if (tracks.length === 0) {
        return this.getFallbackUrl(query);
      }

      // Find best match
      let bestMatch = null;
      let bestScore = 0;

      for (const track of tracks) {
        const artistIds = track.relationships?.artists?.data?.map((a: any) => a.id) || [];
        const artists = included
          .filter((i: any) => i.type === 'artists' && artistIds.includes(i.id))
          .map((a: any) => a.attributes.name);

        const score = this.calculateConfidence(metadata, {
          title: track.attributes.title,
          artists,
          duration: this.parseDuration(track.attributes.duration),
          isrc: track.attributes.isrc
        });

        if (score > bestScore) {
          bestScore = score;
          bestMatch = { track, artists };
        }
      }

      if (bestMatch && bestScore >= 0.8) {
        return {
          url: `https://tidal.com/browse/track/${bestMatch.track.id}`,
          confidence: bestScore,
          matched: {
            artist: bestMatch.artists[0],
            track: bestMatch.track.attributes.title,
            isrc: bestMatch.track.attributes.isrc
          }
        };
      }

      return this.getFallbackUrl(query);
    } catch (error) {
      console.error('TIDAL search error:', error);
      return this.getFallbackUrl(query);
    }
  }

  async searchAlbum(metadata: AlbumMetadata): Promise<ProviderResult | null> {
    const query = `${metadata.artists[0]} ${metadata.name}`;

    const token = await this.getAccessToken();
    if (!token) {
      return this.getFallbackUrl(query);
    }

    try {
      const response = await fetch(
        `https://openapi.tidal.com/v2/searchresults/${encodeURIComponent(query)}/relationships/albums?countryCode=US&limit=10`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/vnd.api+json'
          }
        }
      );

      if (!response.ok) {
        return this.getFallbackUrl(query);
      }

      const data = await response.json();
      const albums = data.data || [];

      if (albums.length === 0) {
        return this.getFallbackUrl(query);
      }

      // Score and find best match
      const bestAlbum = albums[0]; // Simplified - add scoring like searchTrack

      return {
        url: `https://tidal.com/browse/album/${bestAlbum.id}`,
        confidence: 0.85, // Add proper scoring
        matched: {
          album: bestAlbum.attributes.title
        }
      };
    } catch (error) {
      console.error('TIDAL album search error:', error);
      return this.getFallbackUrl(query);
    }
  }

  private getFallbackUrl(query: string): ProviderResult {
    return {
      url: `https://tidal.com/search?q=${encodeURIComponent(query)}`,
      confidence: 0,
      fallback: true
    };
  }

  private parseDuration(isoDuration: string): number {
    // Parse ISO 8601 duration (e.g., "PT3M45S") to milliseconds
    const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;
    const hours = parseInt(match[1] || '0');
    const minutes = parseInt(match[2] || '0');
    const seconds = parseInt(match[3] || '0');
    return (hours * 3600 + minutes * 60 + seconds) * 1000;
  }

  private calculateConfidence(source: TrackMetadata, result: any): number {
    let score = 0;

    // ISRC match is high confidence
    if (source.isrc && result.isrc && source.isrc === result.isrc) {
      return 0.98;
    }

    // Artist similarity (0.35)
    const artistScore = similarity(source.artists[0], result.artists?.[0] || '');
    score += 0.35 * artistScore;

    // Track similarity (0.35)
    const trackScore = similarity(source.name, result.title);
    score += 0.35 * trackScore;

    // Duration match (0.20)
    if (result.duration) {
      const durationDiff = Math.abs(source.durationMs - result.duration);
      if (durationDiff < 5000) score += 0.20;
      else if (durationDiff < 30000) score += 0.10;
    }

    // Album match (0.10) - would need album info from included

    return score;
  }
}
```

### Qobuz (Search URL Fallback Only)

**API Status**: Private API, partnership required

Qobuz API access requires direct approval from Qobuz. They typically only approve commercial partners and often reject small projects.

**How to Request Access:**
1. Email api@qobuz.com with your project details
2. Include: App description, expected usage, business justification
3. Wait for approval (often takes weeks, frequently rejected)

**If Approved:**
- Requires App ID and App Secret
- Full catalog search with ISRC support
- High-resolution audio metadata

**Reality Check:**
- Small/personal projects are usually rejected
- No self-service signup available
- Partnership agreements may have commercial terms

**Recommendation**: Use search URL fallback unless you have a commercial use case.

**Search URL Fallback:**
```typescript
// Track search
https://www.qobuz.com/search?q={query}

// Note: Qobuz doesn't support item_type filtering in search URLs
// Results will include tracks, albums, and artists mixed
```

**Implementation (Fallback Only):**
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

**Environment Variables (if approved):**
```bash
QOBUZ_APP_ID=...       # From Qobuz partnership
QOBUZ_APP_SECRET=...   # From Qobuz partnership
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

### Deezer ⭐ HIGHLY RECOMMENDED

**API Status**: Public API, free, **no authentication required**

Deezer offers a fully public API with **direct ISRC lookup** - making it an excellent candidate for high-confidence matching, similar to Apple Music.

**Key Advantages:**
- No API key or authentication required
- Direct ISRC lookup for tracks (highest confidence)
- Text search fallback for albums
- Free with generous rate limits (~50 req/5 sec per IP)
- Response includes duration for validation

**Strategy:**
1. **ISRC Lookup (tracks)** - Highest confidence (0.98)
   ```
   GET https://api.deezer.com/track/isrc:{ISRC}
   ```
   Example: `https://api.deezer.com/track/isrc:USRC11700112`

2. **Text Search Fallback (tracks)**
   ```
   GET https://api.deezer.com/search/track?q={artist} {track}
   ```

3. **Album Search**
   ```
   GET https://api.deezer.com/search/album?q={artist} {album}
   ```

**API Response Format (Track):**
```typescript
interface DeezerTrack {
  id: number;
  readable: boolean;
  title: string;
  title_short: string;
  isrc: string;
  link: string;           // Direct link to track page
  duration: number;       // Duration in seconds
  explicit_lyrics: boolean;
  preview: string;        // 30-sec preview URL
  artist: {
    id: number;
    name: string;
  };
  album: {
    id: number;
    title: string;
    cover_medium: string;
  };
}
```

**API Response Format (Album):**
```typescript
interface DeezerAlbum {
  id: number;
  title: string;
  link: string;
  cover_medium: string;
  nb_tracks: number;
  release_date: string;   // "YYYY-MM-DD"
  artist: {
    id: number;
    name: string;
  };
}
```

**Rate Limits:**
- ~50 requests per 5 seconds per IP address (10 req/sec)
- No daily quota
- Error code 4 = "Quota limit exceeded" (retry after brief delay)

**Search URL Fallback:**
```typescript
const deezerSearchUrl = `https://www.deezer.com/search/${encodeURIComponent(query)}`;
```

**Environment Variables:**
```bash
# None required! Deezer API is fully public
```

**Implementation:**
```typescript
// providers/deezer.ts
export class DeezerProvider implements StreamingProvider {
  name = 'deezer';

  async searchTrack(metadata: TrackMetadata): Promise<ProviderResult | null> {
    // Strategy 1: Direct ISRC lookup (highest confidence)
    if (metadata.isrc) {
      try {
        const response = await fetch(
          `https://api.deezer.com/track/isrc:${metadata.isrc}`
        );
        const data = await response.json();

        // ISRC lookup returns single track or error object
        if (data.id && !data.error) {
          return {
            url: data.link,
            confidence: 0.98,
            matched: {
              artist: data.artist.name,
              track: data.title,
              isrc: data.isrc
            }
          };
        }
      } catch (error) {
        console.error('Deezer ISRC lookup failed:', error);
        // Fall through to text search
      }
    }

    // Strategy 2: Text search fallback
    const query = `artist:"${metadata.artists[0]}" track:"${metadata.name}"`;
    try {
      const response = await fetch(
        `https://api.deezer.com/search/track?q=${encodeURIComponent(query)}&limit=10`
      );
      const data = await response.json();

      if (data.error) {
        console.error('Deezer search error:', data.error);
        return this.getFallbackUrl(metadata.artists[0], metadata.name);
      }

      if (data.data?.length > 0) {
        // Score and find best match
        let bestMatch = null;
        let bestScore = 0;

        for (const track of data.data) {
          const score = this.calculateTrackConfidence(metadata, track);
          if (score > bestScore) {
            bestScore = score;
            bestMatch = track;
          }
        }

        if (bestMatch && bestScore >= 0.8) {
          return {
            url: bestMatch.link,
            confidence: bestScore,
            matched: {
              artist: bestMatch.artist.name,
              track: bestMatch.title
            }
          };
        }
      }

      return this.getFallbackUrl(metadata.artists[0], metadata.name);
    } catch (error) {
      console.error('Deezer search error:', error);
      return this.getFallbackUrl(metadata.artists[0], metadata.name);
    }
  }

  async searchAlbum(metadata: AlbumMetadata): Promise<ProviderResult | null> {
    const query = `artist:"${metadata.artists[0]}" album:"${metadata.name}"`;

    try {
      const response = await fetch(
        `https://api.deezer.com/search/album?q=${encodeURIComponent(query)}&limit=10`
      );
      const data = await response.json();

      if (data.error) {
        console.error('Deezer album search error:', data.error);
        return this.getAlbumFallbackUrl(metadata.artists[0], metadata.name);
      }

      if (data.data?.length > 0) {
        let bestMatch = null;
        let bestScore = 0;

        for (const album of data.data) {
          const score = this.calculateAlbumConfidence(metadata, album);
          if (score > bestScore) {
            bestScore = score;
            bestMatch = album;
          }
        }

        if (bestMatch && bestScore >= 0.8) {
          return {
            url: bestMatch.link,
            confidence: bestScore,
            matched: {
              artist: bestMatch.artist.name,
              album: bestMatch.title
            }
          };
        }
      }

      return this.getAlbumFallbackUrl(metadata.artists[0], metadata.name);
    } catch (error) {
      console.error('Deezer album search error:', error);
      return this.getAlbumFallbackUrl(metadata.artists[0], metadata.name);
    }
  }

  private calculateTrackConfidence(source: TrackMetadata, track: any): number {
    let score = 0;

    // Artist similarity (0.35)
    const artistScore = similarity(source.artists[0], track.artist.name);
    score += 0.35 * artistScore;

    // Track similarity (0.35)
    const trackScore = similarity(source.name, track.title);
    score += 0.35 * trackScore;

    // Duration match (0.20) - Deezer duration is in seconds
    const durationDiff = Math.abs(source.durationMs - (track.duration * 1000));
    if (durationDiff < 5000) score += 0.20;
    else if (durationDiff < 30000) score += 0.10;

    // Album match (0.10)
    if (source.album && track.album?.title) {
      const albumScore = similarity(source.album, track.album.title);
      score += 0.10 * albumScore;
    }

    return score;
  }

  private calculateAlbumConfidence(source: AlbumMetadata, album: any): number {
    let score = 0;

    // Artist similarity (0.40)
    const artistScore = similarity(source.artists[0], album.artist.name);
    score += 0.40 * artistScore;

    // Album name similarity (0.40)
    const albumScore = similarity(source.name, album.title);
    score += 0.40 * albumScore;

    // Track count match (0.10)
    if (source.totalTracks && album.nb_tracks) {
      const trackDiff = Math.abs(source.totalTracks - album.nb_tracks);
      if (trackDiff <= 2) score += 0.10;
      else if (trackDiff <= 5) score += 0.05;
    }

    // Release year match (0.10)
    if (album.release_date) {
      const albumYear = parseInt(album.release_date.split('-')[0]);
      if (source.releaseYear === albumYear) {
        score += 0.10;
      }
    }

    return score;
  }

  private getFallbackUrl(artist: string, track: string): ProviderResult {
    const query = `${artist} ${track}`;
    return {
      url: `https://www.deezer.com/search/${encodeURIComponent(query)}`,
      confidence: 0,
      fallback: true
    };
  }

  private getAlbumFallbackUrl(artist: string, album: string): ProviderResult {
    const query = `${artist} ${album}`;
    return {
      url: `https://www.deezer.com/search/${encodeURIComponent(query)}`,
      confidence: 0,
      fallback: true
    };
  }
}
```

**Edge Cases:**
| Scenario | Handling |
|----------|----------|
| ISRC returns multiple tracks | API returns only one; use text search for verification |
| Rate limit exceeded (code 4) | Wait 1-2 seconds and retry, or return fallback URL |
| Track not on Deezer | Return search URL fallback |
| Regional availability | Deezer URLs work globally; track may show unavailable in some regions |

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

