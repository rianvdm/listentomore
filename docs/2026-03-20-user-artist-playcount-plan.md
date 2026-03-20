# User Artist Playcount Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the logged-in user's personal Last.fm playcount on the artist detail page.

**Architecture:** Pass the logged-in user's Last.fm username through the existing `/api/internal/artist-lastfm` endpoint to the `artist.getInfo` API call. Last.fm returns `userplaycount` when `username` is provided. Render it in the metadata section alongside genres.

**Tech Stack:** Hono, TypeScript, Last.fm API, Cloudflare Workers

---

### Task 1: Add username param to Last.fm artist detail service

**Files:**
- Modify: `packages/services/lastfm/src/artist-detail.ts`
- Modify: `packages/services/lastfm/src/index.ts`

- [ ] **Step 1: Add `userplaycount` to the `ArtistDetail` interface**

In `packages/services/lastfm/src/artist-detail.ts`, add optional field:

```typescript
export interface ArtistDetail {
  name: string;
  url: string;
  image: string | null;
  tags: string[];
  similar: string[];
  bio: string;
  userplaycount?: number;  // <-- add this
}
```

- [ ] **Step 2: Add optional `username` param to `getArtistDetail`**

Change the method signature and URL construction:

```typescript
async getArtistDetail(artistName: string, username?: string): Promise<ArtistDetail> {
```

Append username to the API URL when provided:

```typescript
let url = `${LASTFM_API_BASE}/?method=artist.getInfo&artist=${encodeURIComponent(artistName)}&api_key=${encodeURIComponent(this.config.apiKey)}&format=json&autocorrect=1`;
if (username) {
  url += `&username=${encodeURIComponent(username)}`;
}
```

- [ ] **Step 3: Include username in cache key when provided**

The shared artist data should stay cached normally. When username is provided, use a separate cache key:

```typescript
const cacheKey = username
  ? `lastfm:artistDetail:${artistName.toLowerCase().trim()}:user:${username.toLowerCase()}`
  : `lastfm:artistDetail:${artistName.toLowerCase().trim()}`;
```

- [ ] **Step 4: Extract userplaycount from response**

In the result construction, add:

```typescript
const userplaycount = username && artist.stats?.userplaycount
  ? parseInt(artist.stats.userplaycount, 10)
  : undefined;

const result: ArtistDetail = {
  name: artist.name,
  url: artist.url,
  image: artist.image?.find((img) => img.size === 'extralarge')?.['#text'] || null,
  tags: filteredTags,
  similar: artist.similar?.artist?.slice(0, 3).map((a) => a.name) || [],
  bio: artist.bio?.content || '',
  ...(userplaycount !== undefined && { userplaycount }),
};
```

- [ ] **Step 5: Update convenience method in LastfmService**

In `packages/services/lastfm/src/index.ts`, update:

```typescript
async getArtistDetail(artistName: string, username?: string) {
  return this.artistDetails.getArtistDetail(artistName, username);
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/services/lastfm/src/artist-detail.ts packages/services/lastfm/src/index.ts
git commit -m "feat: add username param to artist detail for user playcount (#25)"
```

---

### Task 2: Pass username through the API route

**Files:**
- Modify: `apps/web/src/api/internal/artist.ts`

- [ ] **Step 1: Accept and pass username query param**

In the `/artist-lastfm` handler, read the username param and pass it through:

```typescript
app.get('/artist-lastfm', async (c) => {
  const name = c.req.query('name');
  const username = c.req.query('username');

  if (!name) {
    return c.json({ error: 'Missing name parameter' }, 400);
  }

  try {
    const lastfm = c.get('lastfm');
    const [artistDetail, topAlbums] = await Promise.all([
      lastfm.getArtistDetail(name, username || undefined),
      lastfm.getArtistTopAlbums(name, 3),
    ]);
    return c.json({
      data: {
        ...artistDetail,
        topAlbums: topAlbums.map((a) => a.name),
      },
    });
  } catch (error) {
    console.error('Internal lastfm artist error:', error);
    return c.json({ error: 'Failed to fetch Last.fm data' }, 500);
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/api/internal/artist.ts
git commit -m "feat: pass username to artist-lastfm endpoint (#25)"
```

---

### Task 3: Render playcount on the artist page

**Files:**
- Modify: `apps/web/src/pages/artist/detail.tsx`

- [ ] **Step 1: Pass username in the fetch URL**

In the progressive loading script, inject the current user's Last.fm username and append it to the fetch URL. After the `artistId` variable declaration (~line 109), add:

```javascript
var lastfmUsername = ${currentUser?.lastfm_username ? JSON.stringify(currentUser.lastfm_username) : 'null'};
```

Update the fetch URL:

```javascript
var lastfmUrl = '/api/internal/artist-lastfm?name=' + encodeURIComponent(artistName);
if (lastfmUsername) {
  lastfmUrl += '&username=' + encodeURIComponent(lastfmUsername);
}
internalFetch(lastfmUrl, { cache: 'no-store' })
```

- [ ] **Step 2: Add a playcount placeholder in the HTML**

After the genre-section paragraph (~line 78), add:

```tsx
{/* User playcount - populated via JS for logged-in users */}
<p id="user-playcount" style={{ display: 'none' }}></p>
```

- [ ] **Step 3: Render the playcount in the JS callback**

In the `.then(function(data) { ... })` callback for the Last.fm fetch, after updating genres, add:

```javascript
// Show user playcount if available
if (lastfmUsername && lastfm.userplaycount !== undefined) {
  var count = lastfm.userplaycount;
  var el = document.getElementById('user-playcount');
  el.innerHTML = '<strong>Your plays:</strong> ' + count.toLocaleString();
  el.style.display = '';
}
```

- [ ] **Step 4: Build and verify**

```bash
cd apps/web && pnpm build
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/artist/detail.tsx
git commit -m "feat: show user playcount on artist page for logged-in users (#25)"
```
