# User Artist Playcount — Design

**Issue:** [#25](https://github.com/rianvdm/listentomore/issues/25)
**Date:** 2026-03-20

## Goal

Show the logged-in user's personal playcount for an artist on the artist detail page. Logged-out users see no change.

## Approach

Piggyback on the existing `/api/internal/artist-lastfm` call. Last.fm's `artist.getInfo` accepts an optional `username` parameter and returns `userplaycount` when provided.

## Changes

1. **`packages/services/lastfm/src/artist-details.ts`** — Add optional `username` param to the `artist.getInfo` API call. Include `userplaycount` in the returned data.

2. **`apps/web/src/api/internal/artist.ts`** — Accept `username` query param on the artist-lastfm endpoint. Pass it through to the service.

3. **`apps/web/src/pages/artist/detail.tsx`** — When `currentUser` exists, pass their Last.fm username in the fetch URL. Render playcount in the metadata area alongside genres.

## Display

* Shown in the metadata section alongside genres (e.g., "42 plays", "0 plays")
* Only rendered when a user is logged in
* Styled consistently with existing metadata elements

## Caching

Cache key must include username when provided, so one user's playcount isn't served to another.
