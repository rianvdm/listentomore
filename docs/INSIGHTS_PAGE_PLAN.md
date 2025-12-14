# Insights Page Feature Plan

A new user profile page that analyzes recent listening history (7 days) and uses AI to provide personalized summaries and album recommendations.

**URL:** `/u/:username/insights`

---

## Table of Contents

1. [Feature Overview](#feature-overview)
2. [GPT-5.2 Model Selection](#gpt-52-model-selection)
3. [Implementation Options](#implementation-options)
4. [Recommended Approach](#recommended-approach)
5. [Technical Implementation](#technical-implementation)
6. [Design Decisions](#design-decisions)
7. [Implementation Checklist](#implementation-checklist)

---

## Feature Overview

### Core Functionality

- **Input:** User's 7-day listening history from Last.fm (recent tracks, top artists, top albums)
- **Output:** AI-generated insights with:
  1. A brief summary/analysis of listening patterns
  2. Album recommendations based on recent listening
  3. Clickable artist/album links enriched with Spotify IDs

### User Experience Goals

- Fast initial page load (progressive loading pattern)
- **Deeply personalized** - reference specific artists, albums, and listening patterns
- Actionable recommendations with direct links to album/artist pages
- Fresh insights that reflect current listening habits
- **Album cards with cover art** - visual, engaging recommendations
- **Refresh capability** - users can regenerate insights (rate-limited to once per 5 minutes)

---

## GPT-5.2 Model Selection

Based on web search results, GPT-5.2 introduces three model tiers:

| Model | API Name | Best For | Reasoning |
|-------|----------|----------|-----------|
| **GPT-5.2 Instant** | `gpt-5.2-chat-latest` | Speed, daily tasks | No reasoning overhead |
| **GPT-5.2 Thinking** | `gpt-5.2` | Complex analysis | Configurable reasoning |
| **GPT-5.2 Pro** | `gpt-5.2-pro` | Most capable | Extended reasoning |

### Recommendation: GPT-5.2 Thinking (`gpt-5.2`)

**Why:**
- Configurable reasoning effort (can use `low` or `medium` for balance)
- Web search capability via Responses API for grounded recommendations
- Good balance of intelligence and latency for personalized insights
- Available in both Responses API and Chat Completions API

**Configuration:**
```typescript
// packages/config/src/ai.ts
userInsights: {
  provider: 'openai',
  model: 'gpt-5.2',
  maxTokens: 2000,
  temperature: 1,  // Ignored when reasoning is set
  cacheTtlDays: 1, // Short cache - insights should be fresh
  reasoning: 'low',
  verbosity: 'medium',
  webSearch: true, // For grounded album recommendations
},
```

### Alternative: GPT-5.2 Instant for Speed

If latency is critical and insights don't need deep reasoning:
```typescript
userInsights: {
  provider: 'openai',
  model: 'gpt-5.2-chat-latest',
  maxTokens: 1500,
  temperature: 0.7,
  cacheTtlDays: 1,
  // No reasoning/verbosity - not supported
},
```

---

## Implementation Options

### Option A: Single AI Call (Simple)

One prompt that generates both summary and recommendations.

**Pros:**
- Simpler implementation
- Single API call = lower cost
- Cohesive narrative

**Cons:**
- Longer response time
- All-or-nothing failure mode
- Harder to cache separately

**Flow:**
```
[Page Load] → [Fetch 7-day data] → [Single AI call] → [Render all]
```

### Option B: Split AI Calls (Progressive)

Separate calls for summary and recommendations, loaded progressively.

**Pros:**
- Summary appears faster (smaller response)
- Can cache recommendations separately (longer TTL)
- Partial success possible
- Better perceived performance

**Cons:**
- More complex
- Two API calls = higher cost
- Need to coordinate context between calls

**Flow:**
```
[Page Load] → [Fetch 7-day data] → [AI Summary (fast)] → [Render summary]
                                 → [AI Recommendations] → [Render recs]
```

### Option C: Hybrid with Pre-computation

Generate insights on a schedule (e.g., daily) and cache aggressively.

**Pros:**
- Instant page loads
- Predictable costs
- No cold-start latency

**Cons:**
- Insights may be stale
- Requires cron job infrastructure
- Storage overhead

**Flow:**
```
[Cron: Daily] → [For each active user] → [Generate & cache insights]
[Page Load] → [Read from cache] → [Render immediately]
```

---

## Recommended Approach

### **Option B: Split AI Calls with Progressive Loading**

This aligns with existing patterns in the codebase (see `stats.tsx`, `recommendations.tsx`) and provides the best user experience.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    /u/:username/insights                         │
├─────────────────────────────────────────────────────────────────┤
│  UserProfileHeader (static)                                      │
│  UserProfileNav (insights tab active)                            │
├─────────────────────────────────────────────────────────────────┤
│  🧠 Listening Summary                                            │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ [Loading...] → AI-generated summary of 7-day patterns       ││
│  │ "You've been exploring indie rock this week, with heavy     ││
│  │ rotation of Radiohead and The National..."                  ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  💿 Albums You Might Like                                        │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ [Loading...] → Album cards with:                            ││
│  │ - Album art (from Spotify)                                  ││
│  │ - Album name (linked to /album/{spotifyId})                 ││
│  │ - Artist name (linked to /artist/{spotifyId})               ││
│  │ - Brief AI explanation                                      ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
1. Page Handler (handleUserInsights)
   ├── Fetch user from DB
   ├── Check privacy
   ├── Generate internal token
   └── Return shell HTML

2. Client-side JS (progressive loading)
   ├── Fetch /api/internal/user-insights-summary
   │   ├── Get 7-day listening data (top artists, albums, recent tracks)
   │   ├── Call GPT-5.2 with listening context
   │   └── Return markdown summary
   │
   └── Fetch /api/internal/user-insights-recommendations
       ├── Get 7-day top artists/albums
       ├── Call GPT-5.2 with web search for recommendations
       ├── Parse album/artist mentions
       ├── Enrich with Spotify IDs
       └── Return structured recommendations
```

---

## Technical Implementation

### 1. Add AI Task Config

```typescript
// packages/config/src/ai.ts

userInsightsSummary: {
  provider: 'openai',
  model: 'gpt-5.2',
  maxTokens: 800,
  temperature: 1,
  cacheTtlDays: 1, // 24 hours cache
  reasoning: 'low',
  verbosity: 'low',
},

userInsightsRecommendations: {
  provider: 'openai',
  model: 'gpt-5.2',
  maxTokens: 1500,
  temperature: 1,
  cacheTtlDays: 1, // 24 hours cache
  reasoning: 'low',
  verbosity: 'medium',
  webSearch: true, // For verifying album availability
},
```

### 2. Create Prompt Files

#### Summary Prompt (`packages/services/ai/src/prompts/user-insights-summary.ts`)

```typescript
const prompt = `Analyze this user's listening activity from the past 7 days and write a brief, engaging summary (2-3 sentences max).

Top Artists (by play count):
${topArtists.map(a => `- ${a.name}: ${a.playcount} plays`).join('\n')}

Top Albums:
${topAlbums.map(a => `- ${a.name} by ${a.artist}: ${a.playcount} plays`).join('\n')}

Recent Tracks:
${recentTracks.slice(0, 10).map(t => `- ${t.name} by ${t.artist}`).join('\n')}

Write in second person ("You've been..."). Be conversational and deeply personal.
Mention SPECIFIC artists and albums by name - make it feel like you really know their taste.
Note any interesting patterns (genre shifts, artist deep-dives, mood patterns).
Do NOT recommend anything - just summarize patterns.`;
```

#### Recommendations Prompt (`packages/services/ai/src/prompts/user-insights-recommendations.ts`)

```typescript
const prompt = `Based on this user's recent 7-day listening, recommend 3-4 albums they should check out.

Their top artists: ${topArtists.map(a => a.name).join(', ')}
Their top albums: ${topAlbums.map(a => `${a.name} by ${a.artist}`).join(', ')}

Requirements:
- Recommend albums by DIFFERENT artists than their top artists
- Albums must be available on Spotify (verify via web search)
- Include a mix of: one classic/essential, one recent release, one deeper cut
- Format each as: **{{Album Name by Artist Name}}**: One sentence why

Use [[Artist Name]] for artist links and {{Album Name by Artist Name}} for album links.
Do NOT include preamble or closing remarks.`;
```

### 3. Create Internal API Endpoints

```typescript
// apps/web/src/api/internal/insights.ts

app.get('/user-insights-summary', async (c) => {
  const username = c.req.query('username');
  const refresh = c.req.query('refresh') === 'true';
  // ... privacy check (owner only for private profiles), get lastfm service
  
  // Check refresh rate limit (5 min cooldown per user)
  if (refresh) {
    const lastRefresh = await c.env.CACHE.get(`insights-refresh:${username}`);
    if (lastRefresh) {
      const elapsed = Date.now() - parseInt(lastRefresh);
      if (elapsed < 5 * 60 * 1000) {
        return c.json({ error: 'Please wait before refreshing again', cooldown: Math.ceil((5 * 60 * 1000 - elapsed) / 1000) }, 429);
      }
    }
    // Clear cache and set refresh timestamp
    await c.env.CACHE.delete(`user-insights-summary:${username}`);
    await c.env.CACHE.put(`insights-refresh:${username}`, Date.now().toString(), { expirationTtl: 300 });
  }
  
  const [topArtists, topAlbums, recentTracks] = await Promise.all([
    lastfm.getTopArtists('7day', 5),
    lastfm.getTopAlbums('7day', 5),
    lastfm.recentTracks.getRecentTracks(20),
  ]);
  
  // Check for sparse listening data
  const totalPlays = topArtists.reduce((sum, a) => sum + a.playcount, 0);
  if (totalPlays < 5) {
    return c.json({ 
      data: null, 
      sparse: true,
      message: "Looks like you've been taking a break from music this week! 🎧 Get back to listening and check back soon for personalized insights."
    });
  }
  
  const ai = c.get('ai');
  const summary = await ai.getUserInsightsSummary(topArtists, topAlbums, recentTracks);
  
  return c.json({ data: summary });
});

app.get('/user-insights-recommendations', async (c) => {
  const username = c.req.query('username');
  const refresh = c.req.query('refresh') === 'true';
  // ... privacy check, sparse data check (same as summary)
  
  // If refresh, clear recommendations cache too
  if (refresh) {
    await c.env.CACHE.delete(`user-insights-recommendations:${username}`);
  }
  
  // Returns structured array of album recommendations:
  // [{ albumName, artistName, reason, spotifyId, albumArt }]
  // Spotify enrichment happens server-side for album cards
});
```

### 4. Create Page Component

Follow the pattern from `stats.tsx` and `recommendations.tsx`:

```typescript
// apps/web/src/pages/user/insights.tsx

export function UserInsightsPage({ username, lastfmUsername, internalToken, currentUser, isOwner }) {
  return (
    <Layout title={`Insights for ${username}`} internalToken={internalToken} currentUser={currentUser}>
      <UserProfileHeader username={username} lastfmUsername={lastfmUsername} />
      <UserProfileNav username={username} activePage="insights" />
      
      <main>
        <section>
          <div class="section-header">
            <h2>🧠 Your Week in Music</h2>
            {isOwner && (
              <button id="refresh-btn" class="button button-small button-secondary" disabled>
                ↻ Refresh
              </button>
            )}
          </div>
          <div id="insights-summary">
            <p class="text-muted"><span class="loading-inline">Analyzing your listening...</span></p>
          </div>
          
          <h2 style={{ marginTop: '3em' }}>💿 Albums to Explore</h2>
          <div id="insights-recommendations">
            <div class="loading-container">
              <span class="spinner">↻</span>
              <span class="loading-text">Finding recommendations...</span>
            </div>
          </div>
        </section>
      </main>
      
      <script dangerouslySetInnerHTML={{ __html: `
        ${enrichLinksScript}
        ${enrichAlbumMentionsScript}
        
        var isOwner = ${isOwner};
        var refreshCooldown = 0;
        
        function loadInsights(refresh) {
          var refreshParam = refresh ? '&refresh=true' : '';
          
          // Show loading states
          document.getElementById('insights-summary').innerHTML = 
            '<p class="text-muted"><span class="loading-inline">Analyzing your listening...</span></p>';
          document.getElementById('insights-recommendations').innerHTML = 
            '<div class="loading-container"><span class="spinner">↻</span><span class="loading-text">Finding recommendations...</span></div>';
          
          // Fetch summary
          internalFetch('/api/internal/user-insights-summary?username=${username}' + refreshParam)
            .then(r => r.json())
            .then(data => {
              if (data.sparse) {
                document.getElementById('insights-summary').innerHTML = 
                  '<p class="text-muted fun-message">' + data.message + '</p>';
                document.getElementById('insights-recommendations').innerHTML = 
                  '<p class="text-muted">Listen to more music to unlock personalized recommendations!</p>';
                return;
              }
              if (data.error) throw new Error(data.error);
              document.getElementById('insights-summary').innerHTML = 
                marked.parse(data.data.content);
              enrichLinks('insights-summary');
            })
            .catch(err => {
              document.getElementById('insights-summary').innerHTML = 
                '<p class="text-muted">Unable to generate insights right now. Please try again later.</p>';
            });
          
          // Fetch recommendations (parallel)
          internalFetch('/api/internal/user-insights-recommendations?username=${username}' + refreshParam)
            .then(r => r.json())
            .then(data => {
              if (data.sparse || !data.data || data.data.length === 0) return;
              renderAlbumCards(data.data);
            })
            .catch(err => {
              document.getElementById('insights-recommendations').innerHTML = 
                '<p class="text-muted">Unable to load recommendations.</p>';
            });
        }
        
        // Render album cards with cover art
        function renderAlbumCards(albums) {
          var container = document.getElementById('insights-recommendations');
          var html = '<div class="album-cards">';
          albums.forEach(function(album) {
            var albumHref = album.spotifyId ? '/album/' + album.spotifyId : '/album?q=' + encodeURIComponent(album.artistName + ' ' + album.albumName);
            var artistHref = album.artistSpotifyId ? '/artist/' + album.artistSpotifyId : '/artist?q=' + encodeURIComponent(album.artistName);
            html += '<div class="album-card">';
            html += '<a href="' + albumHref + '">';
            if (album.albumArt) {
              html += '<img src="' + album.albumArt + '" alt="' + album.albumName + '" class="album-card-image" loading="lazy" />';
            } else {
              html += '<div class="album-card-image placeholder-image"><span class="spinner">↻</span></div>';
            }
            html += '</a>';
            html += '<div class="album-card-content">';
            html += '<a href="' + albumHref + '" class="album-card-title">' + album.albumName + '</a>';
            html += '<a href="' + artistHref + '" class="album-card-artist">' + album.artistName + '</a>';
            html += '<p class="album-card-reason">' + album.reason + '</p>';
            html += '</div></div>';
          });
          html += '</div>';
          container.innerHTML = html;
        }
        
        // Refresh button logic (owner only)
        if (isOwner) {
          var refreshBtn = document.getElementById('refresh-btn');
          refreshBtn.disabled = false;
          refreshBtn.addEventListener('click', function() {
            if (refreshCooldown > 0) return;
            refreshBtn.disabled = true;
            refreshBtn.textContent = 'Refreshing...';
            
            loadInsights(true);
            
            // Start 5-minute cooldown
            refreshCooldown = 300;
            var interval = setInterval(function() {
              refreshCooldown--;
              if (refreshCooldown <= 0) {
                clearInterval(interval);
                refreshBtn.disabled = false;
                refreshBtn.textContent = '↻ Refresh';
              } else {
                refreshBtn.textContent = '↻ ' + Math.floor(refreshCooldown / 60) + ':' + String(refreshCooldown % 60).padStart(2, '0');
              }
            }, 1000);
          });
        }
        
        // Initial load
        loadInsights(false);
      ` }} />
    </Layout>
  );
}
```

### 5. Update Navigation

```typescript
// apps/web/src/components/layout/UserProfileNav.tsx

interface UserProfileNavProps {
  username: string;
  activePage: 'stats' | 'recommendations' | 'insights'; // Add 'insights'
}

// Add new tab:
<a href={`/u/${username}/insights`} 
   class={`profile-nav-link${activePage === 'insights' ? ' active' : ''}`}>
  Insights
</a>
```

### 6. Register Route

```typescript
// apps/web/src/index.tsx

import { handleUserInsights } from './pages/user/insights';
app.get('/u/:username/insights', handleUserInsights);
```

---

## Album/Artist Link Enrichment

The existing `enrichLinksScript` from `client-scripts.ts` handles this pattern:

1. AI generates links like `/album?q=Artist+Album` with `data-artist` and `data-album` attributes
2. Client-side JS calls `/api/internal/search-album-by-artist` to get Spotify ID
3. Link href is updated to `/album/{spotifyId}`

For the recommendations, we can either:
- **Option 1:** Return raw AI text and use `enrichAlbumMentionsScript` to find and link mentions
- **Option 2:** Parse AI response server-side and return structured data with Spotify IDs pre-enriched

**Recommendation:** Option 2 for recommendations (structured data), Option 1 for summary (natural text).

---

## Design Decisions

The following decisions have been made for this feature:

### 1. Caching Strategy ✅

- **Both summary and recommendations:** Cache for **24 hours** per user
- **Refresh button:** Users can manually refresh insights (rate-limited to **once per 5 minutes**)
- Cache keys: `user-insights-summary:{username}`, `user-insights-recommendations:{username}`
- Refresh cooldown tracked via: `insights-refresh:{username}` (5 min TTL)

### 2. Empty State Handling ✅

- **Threshold:** < 5 total plays in 7 days triggers sparse data state
- **Fun message:** "Looks like you've been taking a break from music this week! 🎧 Get back to listening and check back soon for personalized insights."
- **No fallback** to 30-day data - keep it focused on the week

### 3. Rate Limiting ✅

- Refresh button has **5-minute cooldown** per user
- Button shows countdown timer when on cooldown
- Server-side enforcement via KV cache key

### 4. Privacy ✅

- **Private profiles:** Insights page only visible to the profile owner
- Same pattern as other profile pages - check `profile_visibility` and `currentUser.id === user.id`

### 5. Error Handling ✅

- **No model fallback** - fail gracefully with user-friendly message
- "Unable to generate insights right now. Please try again later."
- Partial success allowed (summary can succeed even if recommendations fail)

### 6. Feature Availability ✅

- **Available to all users** immediately
- No beta flag or premium gating

### 7. Personalization ✅

- **Deep personalization** - prompts explicitly mention specific artists/albums by name
- Reference listening patterns, genre tendencies, artist deep-dives
- Future enhancement: historical comparison ("more jazz than usual") would require storing snapshots

### 8. Album Cards UI ✅

- **Album cards with cover art** - visual, engaging layout
- Progressive loading with spinner placeholders for images
- Responsive grid layout (works on mobile)
- Each card shows: album art, album name (linked), artist name (linked), AI reason
- Spotify IDs enriched server-side before returning to client

---

## Implementation Checklist

### Config (packages/config/src/)
- [ ] Add `userInsightsSummary` task to `ai.ts`
- [ ] Add `userInsightsRecommendations` task to `ai.ts`
- [ ] Add `userInsights` cache config to `cache.ts` (24hr TTL, 5min refresh cooldown)

### AI Service (packages/services/ai/)
- [ ] Create `src/prompts/user-insights-summary.ts`
- [ ] Create `src/prompts/user-insights-recommendations.ts`
- [ ] Export new prompts from `src/prompts/index.ts`
- [ ] Add `getUserInsightsSummary()` to `AIService` class
- [ ] Add `getUserInsightsRecommendations()` to `AIService` class

### API (apps/web/src/api/internal/)
- [ ] Create `insights.ts` with endpoints:
  - `GET /user-insights-summary` (with refresh param, rate limiting, sparse check)
  - `GET /user-insights-recommendations` (with Spotify enrichment for album cards)
- [ ] Mount insights routes in `index.ts`

### Page (apps/web/src/pages/user/)
- [ ] Create `insights.tsx` with:
  - Progressive loading for summary and recommendations
  - Album cards with cover art
  - Refresh button (owner only) with 5-min cooldown timer
  - Sparse data fun message
  - Graceful error handling
- [ ] Update `UserProfileNav` component with insights tab

### Routes & Docs
- [ ] Register `/u/:username/insights` route in `index.tsx`
- [ ] Add URL pattern to `CLAUDE.md` documentation

### Testing
- [ ] Test with active user (lots of listening data)
- [ ] Test with sparse user (< 5 plays)
- [ ] Test with new user (no data)
- [ ] Test private profile (owner vs visitor)
- [ ] Test refresh button cooldown
- [ ] Test mobile layout for album cards

---

---

## CSS for Album Cards

Add to existing styles:

```css
.album-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1.5rem;
  margin-top: 1.5rem;
}

.album-card {
  display: flex;
  gap: 1rem;
  padding: 1rem;
  background: var(--card-bg);
  border-radius: 8px;
  transition: transform 0.2s;
}

.album-card:hover {
  transform: translateY(-2px);
}

.album-card-image {
  width: 80px;
  height: 80px;
  border-radius: 4px;
  object-fit: cover;
  flex-shrink: 0;
}

.album-card-content {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
}

.album-card-title {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.album-card-artist {
  color: var(--text-muted);
  font-size: 0.9rem;
}

.album-card-reason {
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin-top: 0.25rem;
  line-height: 1.4;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.section-header h2 {
  margin: 0;
}

.fun-message {
  font-size: 1.1rem;
  padding: 2rem;
  text-align: center;
}

@media (max-width: 600px) {
  .album-cards {
    grid-template-columns: 1fr;
  }
}
```

---

## Alternative Ideas Considered

### Idea: "Listening Mood" Analysis
Analyze tempo, energy, valence of top tracks to describe emotional patterns. Requires Spotify audio features API.

### Idea: "Discovery Score"
Calculate how much new music vs. familiar music the user listened to. Gamification element.

### Idea: "Genre Journey"
Visualize genre distribution over the week. More visual, less AI-dependent.

### Idea: "Listening Streaks"
Track consecutive days of listening, highlight artist/album streaks.

These could be future enhancements to the Insights page.

---

## References

- Existing patterns: `apps/web/src/pages/user/stats.tsx`, `recommendations.tsx`
- AI configuration: `packages/config/src/ai.ts`
- Link enrichment: `apps/web/src/utils/client-scripts.ts`
- Internal API pattern: `apps/web/src/api/internal/user.ts`
- GPT-5.2 docs: https://platform.openai.com/docs/models/gpt-5.2
