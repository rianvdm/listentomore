# Performance Improvements

*Identified 2026-03-07 via automated codebase review*

Ranked by impact. Items 1–3 are the highest-leverage changes.

---

## 1. N+1 Last.fm fetches in `/user-recommendations`

**File:** `apps/web/src/api/internal/user.ts:100–121`
**Impact:** ~1s extra latency on cold cache for any user recommendations request

The loop over `topArtists` (up to 5) awaits `getArtistDetail()` sequentially. Each call is a separate Last.fm API roundtrip when KV is cold.

```ts
// Before
for (const topArtist of topArtists) {
  const artistDetail = await userLastfm.getArtistDetail(topArtist.name);
  // ...
}

// After
const artistDetails = await Promise.all(
  topArtists.map(a => userLastfm.getArtistDetail(a.name))
);
for (let i = 0; i < topArtists.length; i++) {
  const artistDetail = artistDetails[i];
  // ...
}
```

The calls are independent and all results are cached per-artist in KV, so re-ordering is safe.

---

## 2. Redundant `spotifyStreaming.getAlbum()` in `/api/v1/album`

**File:** `apps/web/src/api/v1/album.ts:34,47`
**Impact:** Extra Spotify API call on every album request with a cold `spotifyStreaming` cache

`spotify.getAlbum(searchResult.id)` is fetched at line 34 into `albumData`. Then inside the `Promise.all` at line 47, `spotifyStreaming.getAlbum(searchResult.id)` is called again. The two clients use different KV key prefixes (keyed to their `clientId`), so the second call always misses the first client's cache.

The `spotifyStreaming` client exists for rate-limit isolation — a valid reason — but the *data* doesn't need to be fetched again. `albumData` already contains all the fields needed by `StreamingLinksService.albumMetadataFromSpotify()`:

```ts
// Before
const albumForLinks = await spotifyStreaming.getAlbum(searchResult.id);
const metadata = StreamingLinksService.albumMetadataFromSpotify({
  id: albumForLinks.id,
  name: albumForLinks.name,
  artists: albumForLinks.artistIds.map(...),
  total_tracks: albumForLinks.tracks,
  release_date: albumForLinks.releaseDate,
  external_ids: albumForLinks.upc ? { upc: albumForLinks.upc } : undefined,
});

// After — reuse already-fetched albumData
const metadata = StreamingLinksService.albumMetadataFromSpotify({
  id: albumData.id,
  name: albumData.name,
  artists: albumData.artistIds.map(...),
  total_tracks: albumData.tracks,
  release_date: albumData.releaseDate,
  external_ids: albumData.upc ? { upc: albumData.upc } : undefined,
});
```

This eliminates the second Spotify call while preserving rate-limit isolation at the auth level.

---

## 3. Sequential Spotify searches in `searchAlbumByArtist`

**File:** `packages/services/spotify/src/search.ts:203–237`
**Impact:** Doubled Spotify API latency for any album with special chars, accents, or edition suffixes

When the field-filter query (`artist:"X" album:"Y"`) returns results that fail the name-similarity check, a fallback natural query is issued sequentially. These two queries are independent and could run in parallel.

```ts
// After
const [fieldResults, naturalResults] = await Promise.all([
  this.search(`artist:"${artist}" album:"${album}"`, 'album', 5),
  this.search(`${artist} ${album}`, 'album', 5),
]);

const fieldFilterMatch = fieldResults.length > 0
  ? this.pickBestAlbumMatch(fieldResults, album, artist)
  : null;

const naturalMatch = naturalResults.length > 0
  ? this.pickBestAlbumMatch(naturalResults, album, artist)
  : null;

// Prefer field-filter match if it's good, otherwise natural
const goodFieldMatch = fieldFilterMatch && this.isAlbumNameMatch(fieldFilterMatch.name, album);
if (goodFieldMatch) return fieldFilterMatch;
if (naturalMatch && this.isAlbumNameMatch(naturalMatch.name, album)) return naturalMatch;
return fieldFilterMatch || naturalMatch;
```

Note: this trades one extra Spotify call on the *happy path* (field filter succeeds) for faster latency on the *unhappy path*. Acceptable if the unhappy path is frequent (it is — any non-ASCII album name hits it).

---

## 4. Per-recommendation artist Spotify search is redundant

**File:** `apps/web/src/api/internal/insights.ts:254–264`
**Impact:** Halves the number of Spotify calls during insights enrichment (up to 10 fewer calls)

Each recommendation fires two Spotify searches: one for the album, one for the artist. `AlbumSearchResult` already includes `artistIds: string[]`, so the artist Spotify ID is available from the album search result.

```ts
// Before
const albumResults = await spotify.search.search(`${rec.artistName} ${rec.albumName}`, 'album', 1);
// ... later ...
const artistResults = await spotify.search.search(rec.artistName, 'artist', 1);
artistSpotifyId = artistResults[0].id;

// After — read artistIds from album result
if (albumResults.length > 0) {
  const album = albumResults[0];
  spotifyId = album.id;
  albumArt = album.image;
  artistSpotifyId = album.artistIds[0] ?? null; // already present
}
```

---

## 5. Username resolution always makes two D1 reads on display-name paths

**File:** `apps/web/src/api/internal/user.ts:20–22` and `apps/web/src/api/internal/insights.ts:25–27`
**Impact:** Extra D1 HTTP roundtrip (~10 ms) on every request where the URL uses a display username

Both `getUserWithPrivacyCheck` and the equivalent in insights.ts try `getUserByLastfmUsername` first, then fall back to `getUserByUsername`. When accessed by display name, this is always two sequential D1 queries.

```ts
// Before
let user = await db.getUserByLastfmUsername(username);
if (!user) {
  user = await db.getUserByUsername(username);
}

// After — single query with OR, prioritise lastfm_username match in app code
const user = await db.getUserByEitherUsername(username);
// SQL: SELECT * FROM users
//   WHERE LOWER(lastfm_username) = LOWER(?) OR LOWER(username) = LOWER(?)
//   ORDER BY CASE WHEN LOWER(lastfm_username) = LOWER(?) THEN 0 ELSE 1 END
//   LIMIT 1
```

Also consolidates the duplicated logic between `user.ts` and `insights.ts`.

---

## 6. Session validation makes two sequential D1 reads on every authenticated request

**File:** `apps/web/src/utils/session.ts:62–79`
**Impact:** ~20 ms extra latency on every page load or API call by a logged-in user

`validateSession` fetches the session, then fetches the user as a separate query — two D1 HTTP calls in sequence on every request through `sessionMiddleware`.

```ts
// Before
const session = await db.getSessionByToken(tokenHash);
// ...
return db.getUser(session.user_id);

// After — single JOIN query
// SELECT users.* FROM sessions
//   JOIN users ON sessions.user_id = users.id
//   WHERE sessions.token_hash = ?
//     AND sessions.expires_at > datetime('now')
```

---

## 7. Spotify search cache key omits `limit`

**File:** `packages/services/spotify/src/search.ts:109`
**Impact:** Incorrect cached results when the same query is used with different `limit` values

Cache key is `spotify:search:${type}:${query}` — `limit` is not included. A 1-result and 6-result search for the same query share a key. Whichever runs first determines what the other gets.

```ts
// Before
const cacheKey = `spotify:search:${type}:${query}`;

// After
const cacheKey = `spotify:search:${type}:${query}:${limit}`;
```

---

## 8. `AIRateLimiter` sleeps inside request handlers

**File:** `packages/services/ai/src/rate-limit.ts:37–59`
**Impact:** Burns the Worker's 30 s wall-clock limit on rate-limit cooldown

`acquire()` sleeps up to 30 s and retries recursively when the rate limit is hit. This is appropriate in a cron job but not in a request handler — it blocks the Worker for the duration of the sleep.

**Fix:** Return an error immediately when in cooldown; let the client receive HTTP 429 and retry. Move the sleep-and-retry pattern to the cron/background worker only.
