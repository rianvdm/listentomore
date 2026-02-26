# Spotify February 2026 API Migration Plan

## Overview

Spotify is restricting Development Mode API access effective **March 9, 2026** ([blog post](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security), [changelog](https://developer.spotify.com/documentation/web-api/references/changes/february-2026), [migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)). This document covers the impact on ListenToMore and the migration plan.

**Note:** Apps in **Extended Quota Mode** are not affected. These changes only apply to **Development Mode** apps. If this app moves to Extended Quota Mode, no migration is needed.

---

## Impact Assessment

### Endpoints Used by This Codebase

| Endpoint | Status | Notes |
|----------|--------|-------|
| `GET /v1/albums/{id}` | Still available | Field removals apply |
| `GET /v1/artists/{id}` | Still available | Field removals apply |
| `GET /v1/artists/{id}/albums` | Still available | No changes |
| `GET /v1/artists/{id}/related-artists` | Still available | No changes |
| `GET /v1/search` | Still available | `limit` max reduced from 50 to 10 |
| `POST accounts.spotify.com/api/token` | Still available | No changes |

No endpoints used by this codebase are being removed.

### Search Limit Change

The search endpoint's `limit` parameter max drops from 50 to 10 (default from 20 to 5). This codebase uses `limit=1` and `limit=5` -- both are within the new max. **No changes needed.**

### Removed Fields

#### CRITICAL: `external_ids` (ISRC / UPC / EAN)

The `external_ids` field is removed from Track and Album response objects. This is the **only change that breaks core functionality**.

**Current usage:** ISRC and UPC codes from Spotify feed directly into the Apple Music cross-platform matching pipeline. ISRC is the primary matching mechanism for tracks; UPC is the primary mechanism for albums. Both produce 0.98 confidence scores.

**Affected files:**

| File | Line(s) | Usage |
|------|---------|-------|
| `packages/services/spotify/src/albums.ts` | 47, 120-121 | Extracts UPC/EAN from `data.external_ids` |
| `packages/services/streaming-links/src/index.ts` | 41, 51, 207, 223, 368, 460 | Interfaces + extraction for matching pipeline |
| `apps/web/src/api/v1/links.ts` | 38 | Reconstructs `external_ids` for streaming-links |
| `apps/web/src/api/internal/streaming.ts` | 34 | Reconstructs `external_ids` for streaming-links |
| `apps/web/src/api/v1/album.ts` | 56 | Reconstructs `external_ids` for streaming-links |
| `packages/services/streaming-links/src/providers/apple-music.ts` | 359-403 | Consumes ISRC/UPC for high-confidence matching |

**Without mitigation:** All Apple Music matching degrades to text-based search only, with lower confidence scores and higher false-match rates.

#### LOW IMPACT: Stored but never rendered

These fields are stored in internal types but **never displayed in the UI**:

| Field | Interface | File |
|-------|-----------|------|
| `popularity` | `AlbumDetails`, `ArtistDetails` | `albums.ts:22,118`, `artists.ts:16,87` |
| `followers` | `ArtistDetails` | `artists.ts:15,86` |
| `label` | `AlbumDetails` | `albums.ts:21,117` |

These will start returning `undefined`. Types need updating, tests need adjusting.

#### NO IMPACT: Not referenced in codebase

`available_markets`, `linked_from`, `album_group`, `country` (user), `email` (user), `product` (user).

---

## Migration Strategy

### Approach: MusicBrainz for ISRC/UPC enrichment + Apple Music text search fallback

**Primary:** Add a MusicBrainz service to look up UPC (barcode) for albums and ISRC for tracks, given artist + title metadata from Spotify. This preserves the existing high-confidence ISRC/UPC matching flow with Apple Music.

**Fallback:** When MusicBrainz doesn't have the data (or rate limit is hit), the existing Apple Music text search fallback (`apple-music.ts:376-380,406-411`) already handles this gracefully.

### Why MusicBrainz?

Alternatives were evaluated:

| Source | ISRC | UPC | Free | Auth | Rate Limit | Notes |
|--------|------|-----|------|------|------------|-------|
| **MusicBrainz** | Yes (via recording lookup) | Yes (barcode on releases) | Yes | No key needed | 1 req/sec | Best option: large catalog, community-maintained |
| Apple Music API | Yes (in response) | Yes (in response) | Yes | JWT (already have) | Generous | Already used, but can't use ISRC/UPC to *find* the match -- only extract after text match |
| iTunes Search API | No | Yes (direct lookup) | Yes | None | Undocumented | Archived API, may be discontinued |
| Deezer API | Yes (undocumented) | No | Yes | None | Undocumented | Undocumented ISRC endpoint, unreliable |
| Musicfetch / Soundcharts | Yes | Yes | No (paid) | API key | Varies | Commercial, overkill for this use case |

MusicBrainz is the clear winner: free, no API key, comprehensive catalog (~70M recordings, ~3.7M releases with barcodes), and purpose-built for this kind of metadata lookup.

---

## Implementation Plan

### Phase 1: MusicBrainz Service Package

**Priority:** High  
**Effort:** Medium (~4 new files)

Create `packages/services/musicbrainz/` as a new workspace package.

#### Package structure

```
packages/services/musicbrainz/
  package.json
  tsconfig.json
  src/
    index.ts              # Public API: MusicBrainzService class
    fetch.ts              # Rate-limited fetch wrapper (1 req/sec)
    release-lookup.ts     # Album UPC lookup via release search
    recording-lookup.ts   # Track ISRC lookup via recording search
    types.ts              # MusicBrainz API response types
```

#### API endpoints used

**Album UPC lookup (release search):**
```
GET https://musicbrainz.org/ws/2/release/?query=release:<album> AND artist:<artist>&fmt=json&limit=5
```

Search fields: `release` (album name), `artist` (artist name), `barcode` (UPC/EAN), `date` (release date).

If the search result includes a barcode, use it. Otherwise, do a follow-up lookup:
```
GET https://musicbrainz.org/ws/2/release/<MBID>?fmt=json
```

**Track ISRC lookup (recording search + ISRC include):**
```
GET https://musicbrainz.org/ws/2/recording/?query=recording:<track> AND artist:<artist>&fmt=json&limit=5
```

Then look up the matched recording with ISRCs included:
```
GET https://musicbrainz.org/ws/2/recording/<MBID>?inc=isrcs&fmt=json
```

#### Rate limiting

MusicBrainz requires **max 1 request per second** and a meaningful `User-Agent` header. Exceeding this results in IP blocking.

Approach: KV-backed distributed rate limiter (same pattern as `SpotifyRateLimiter` in `packages/services/spotify/src/rate-limit.ts`), but with a 1-second window instead of per-minute.

Required header:
```
User-Agent: ListenToMore/1.0 (https://listentomore.com)
```

#### Caching

MusicBrainz data is very stable -- barcodes and ISRCs don't change once assigned.

- Cache key: `musicbrainz:release:<normalized-artist>:<normalized-album>` / `musicbrainz:recording:<normalized-artist>:<normalized-track>`
- TTL: 30 days (add to `packages/config/src/cache.ts`)
- Cache the final ISRC/UPC value, not the raw API response

#### MusicBrainz response shape (key fields)

Release search result (JSON):
```json
{
  "releases": [
    {
      "id": "mbid-here",
      "score": 100,
      "title": "Album Name",
      "artist-credit": [{ "name": "Artist Name" }],
      "date": "2020-01-01",
      "barcode": "012345678905",
      "release-group": { "primary-type": "Album" }
    }
  ]
}
```

Recording lookup with ISRCs (JSON):
```json
{
  "id": "mbid-here",
  "title": "Track Name",
  "isrcs": ["USRC11700112", "GBAYE0601498"]
}
```

#### Matching strategy

MusicBrainz search returns fuzzy results with a `score` (0-100). For best results:

1. Filter results to `score >= 80`
2. Prefer results where `release-group.primary-type` is `"Album"` (not `"Single"` or `"Compilation"`)
3. Use name similarity matching (reuse existing `isAlbumNameMatch` pattern from `SpotifySearch`)
4. For albums, prefer results that have a barcode
5. For recordings, prefer results that have ISRCs

---

### Phase 2: Integrate MusicBrainz into Streaming-Links Pipeline

**Priority:** High  
**Effort:** Medium (modify 3-5 existing files)

#### Current data flow

```
Spotify API → AlbumDetails (includes UPC) → albumMetadataFromSpotify() → AlbumMetadata → Apple Music searchAlbum()
                                                                          ↑ UPC here       ↑ tries UPC first, then text
```

#### New data flow

```
Spotify API → AlbumDetails (no UPC) → albumMetadataFromSpotify() → AlbumMetadata (no UPC)
                                                                          ↓
                                                                   MusicBrainz enrichment
                                                                          ↓
                                                                   AlbumMetadata (UPC from MusicBrainz)
                                                                          ↓
                                                                   Apple Music searchAlbum()
                                                                          ↑ tries UPC first, then text
```

#### Changes to `StreamingLinksService`

In `packages/services/streaming-links/src/index.ts`:

1. Add optional `MusicBrainzService` to constructor
2. Add `enrichMetadata()` method:

```typescript
private async enrichAlbumMetadata(metadata: AlbumMetadata): Promise<AlbumMetadata> {
  if (metadata.upc || !this.musicbrainz) return metadata;

  const upc = await this.musicbrainz.getAlbumUpc(
    metadata.artists[0],
    metadata.name
  );

  if (upc) {
    console.log(`[StreamingLinks] Enriched album UPC from MusicBrainz: ${upc}`);
    return { ...metadata, upc };
  }

  console.log(`[StreamingLinks] No UPC found in MusicBrainz for: ${metadata.artists[0]} - ${metadata.name}`);
  return metadata;
}
```

3. Call `enrichMetadata()` before passing to Apple Music in:
   - `getAlbumLinks()` -- main album flow
   - `getTrackLinks()` -- main track flow (for ISRC enrichment)

#### Changes to API endpoints

The three endpoints that reconstruct `external_ids`:
- `apps/web/src/api/v1/links.ts:38`
- `apps/web/src/api/internal/streaming.ts:34`
- `apps/web/src/api/v1/album.ts:56`

These can stay as-is -- they pass `album.upc` through `external_ids`, and if Spotify stops providing it, the enrichment happens at the `StreamingLinksService` level instead.

#### Worker bindings

The `MusicBrainzService` needs access to KV for caching and rate limiting. Pass the existing KV namespace through the service initialization in `apps/web/src/index.tsx` (same pattern as Spotify/Apple Music services).

---

### Phase 3: Improve Apple Music Text Search Fallback

**Priority:** Medium  
**Effort:** Low (minor changes to 1 file)

#### Use Apple Music's ISRC/UPC for confidence validation

In `packages/services/streaming-links/src/providers/apple-music.ts`:

After a text search match, the Apple Music response already includes `isrc` (on songs) and `upc` (on albums). Currently this data is ignored for text-matched results.

Enhancement: Log when text search is used vs. identifier-based matching for monitoring quality impact:

```typescript
// In searchAlbum(), after text match
console.log(`[AppleMusic] Album matched via ${metadata.upc ? 'UPC' : 'text search'}: ${metadata.upc || query}`);
```

This helps track how often MusicBrainz provides data vs. falling back to pure text search.

---

### Phase 4: Clean Up Removed Fields

**Priority:** Low  
**Effort:** Low (type changes + test updates)

#### Type updates

**`packages/services/spotify/src/albums.ts`:**
- `SpotifyAlbumResponse`: make `external_ids`, `popularity`, `label` optional
- `AlbumDetails`: make `popularity` and `label` optional
- Extraction: use optional chaining / nullish coalescing (already done for `external_ids`, add for `popularity`, `label`)

**`packages/services/spotify/src/artists.ts`:**
- `SpotifyArtistResponse`: make `followers`, `popularity` optional
- `ArtistDetails`: make `followers` and `popularity` optional
- Extraction: handle undefined for `data.followers?.total` and `data.popularity`

#### Test updates

**`apps/web/src/__tests__/utils/fixtures.ts`:**
- Add test variants without `popularity`, `followers`, `label`, `external_ids`
- Keep existing fixtures for backward-compat testing

**`apps/web/src/__tests__/services/spotify.test.ts`:**
- Update assertions to handle optional fields
- Add test cases for responses missing removed fields

---

## Timeline

| Phase | Description | Effort | Deadline |
|-------|-------------|--------|----------|
| Phase 1 | MusicBrainz service package | Medium | Before March 9 |
| Phase 2 | Pipeline integration | Medium | Before March 9 |
| Phase 3 | Apple Music fallback improvements | Low | After March 9 (nice-to-have) |
| Phase 4 | Clean up removed fields | Low | After March 9 (nice-to-have) |

**Hard deadline: March 9, 2026** -- existing Development Mode apps are migrated to new restrictions on this date.

Phases 1 and 2 are the critical path. Phases 3 and 4 can be done after the deadline since they improve monitoring and clean up dead code, but don't affect functionality.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| MusicBrainz doesn't have barcode/ISRC for a release | Lower match quality for those albums/tracks | Apple Music text search fallback already works; only confidence score drops |
| MusicBrainz rate limit (1 req/sec) causes slowdowns | Slower streaming link resolution | Aggressive KV caching (30-day TTL) means repeat lookups are instant; rate limiter queues rather than drops |
| MusicBrainz API downtime | No ISRC/UPC enrichment | Fallback to text search; MusicBrainz has good uptime historically |
| MusicBrainz fuzzy search returns wrong release | Wrong UPC, Apple Music matches wrong album | Name similarity validation before accepting a result; prefer high-score matches (>=80) |
| Extended Quota Mode approval makes this unnecessary | Wasted implementation effort | MusicBrainz integration is still valuable as a secondary data source regardless of Spotify mode |

---

## References

- [Spotify February 2026 Changelog](https://developer.spotify.com/documentation/web-api/references/changes/february-2026)
- [Spotify Blog: Update on Developer Access](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security)
- [Spotify Migration Guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)
- [MusicBrainz API Documentation](https://musicbrainz.org/doc/MusicBrainz_API)
- [MusicBrainz API Search](https://musicbrainz.org/doc/MusicBrainz_API/Search)
- [MusicBrainz Rate Limiting](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting)
- [Apple Music API: Filter Songs by ISRC](https://developer.apple.com/documentation/musickit/songfilter/isrc)
