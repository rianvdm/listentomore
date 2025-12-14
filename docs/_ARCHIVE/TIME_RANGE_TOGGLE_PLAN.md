# Time Range Toggle for User Stats Page

## Overview

Add a time range selector to the `/u/<username>` page allowing users to view their listening stats across different time periods: **7 days**, **1 month**, and **1 year**.

## Current State

### Page Structure (`/u/<username>`)

The user stats page (`apps/web/src/pages/user/stats.tsx`) currently displays:

1. **Recent Listening** - Most recently played track (no time period)
2. **Top Artists** - Hardcoded to `7day` period
3. **Top Albums** - Hardcoded to `1month` period

Data is loaded progressively via internal API endpoints:
- `/api/internal/user-recent-track` - No period parameter
- `/api/internal/user-top-artists` - Hardcoded `7day`
- `/api/internal/user-top-albums` - Hardcoded `1month`

### Last.fm API Time Periods

The Last.fm API supports these time periods (defined in `TimePeriod` type):

| Period | Description |
|--------|-------------|
| `7day` | Last 7 days |
| `1month` | Last 30 days |
| `3month` | Last 90 days |
| `6month` | Last 180 days |
| `12month` | Last 365 days |
| `overall` | All time |

### Current Caching Strategy

Cache keys include the period parameter:
```
lastfm:topalbums:{username}:{period}:{limit}
lastfm:topartists:{username}:{period}:{limit}
```

TTL: 1 hour for both top albums and top artists (configured in `CACHE_CONFIG.lastfm.topAlbums` and `CACHE_CONFIG.lastfm.topArtists`).

---

## Proposed Feature

### User-Facing Time Periods

Map user-friendly labels to Last.fm API periods:

| UI Label | Last.fm Period | Description |
|----------|----------------|-------------|
| **7 days** | `7day` | Last week |
| **1 month** | `1month` | Last 30 days |
| **1 year** | `12month` | Last 365 days |

**Why these three?**
- **7 days** - Shows current listening habits, what's on repeat right now
- **1 month** - Balanced view of recent favorites
- **1 year** - Longer-term taste, seasonal patterns

We're intentionally excluding `3month`, `6month`, and `overall` to keep the UI simple. These could be added later if users request them.

### UX Design

#### Toggle Placement

Position the toggle **above the Top Artists section**, applying to both Top Artists and Top Albums simultaneously. The Recent Listening section remains unchanged (always shows most recent track).

```
┌─────────────────────────────────────────┐
│ 🎧 Recent Listening                     │
│ Most recently listened to...            │
├─────────────────────────────────────────┤
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │  [7 days]  [1 month]  [1 year]      │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ 👩‍🎤 Top Artists                          │
│ (data for selected period)              │
│                                         │
│ 🏆 Top Albums                           │
│ (data for selected period)              │
├─────────────────────────────────────────┤
│ [View Recommendations →]                │
└─────────────────────────────────────────┘
```

#### Toggle Component Design

Use a segmented button control (pill-style tabs):

```html
<div class="time-toggle">
  <button class="time-toggle-btn active" data-period="7day">7 days</button>
  <button class="time-toggle-btn" data-period="1month">1 month</button>
  <button class="time-toggle-btn" data-period="12month">1 year</button>
</div>
```

**Styling considerations:**
- Matches existing button styles from `components/ui/Button.tsx`
- Active state clearly highlighted
- Mobile-friendly touch targets (min 44px height)
- Smooth transitions between states

#### Copy/Labels

**Section headers update dynamically:**

| Period | Top Artists Header | Top Albums Header |
|--------|-------------------|-------------------|
| 7 days | "Top artists in the past 7 days" | "Top albums in the past 7 days" |
| 1 month | "Top artists in the past month" | "Top albums in the past month" |
| 1 year | "Top artists in the past year" | "Top albums in the past year" |

**Loading states:**
- Show spinner with text: "Loading top artists..." / "Loading top albums..."
- Disable toggle buttons during loading to prevent rapid switching

**Empty states:**
- "No listening data for this period. Try a longer time range!"

#### URL State

**Option A: Query Parameter (Recommended)**
```
/u/bordesak?period=1month
```

Pros:
- Shareable links with specific time period
- Browser back/forward works naturally
- No server-side changes needed for initial render

Cons:
- Slightly longer URLs

**Option B: Client-side only**
- Period stored in JavaScript variable
- Resets to default on page refresh

**Recommendation:** Use query parameter for shareability. Default to `7day` when no parameter is present.

---

## Technical Implementation

### Phase 1: API Changes

#### 1.1 Update Internal API Endpoints

Modify `/api/internal/user-top-artists` and `/api/internal/user-top-albums` to accept a `period` query parameter:

```typescript
// apps/web/src/api/internal/user.ts

app.get('/user-top-artists', async (c) => {
  const username = c.req.query('username');
  const period = c.req.query('period') as TimePeriod || '7day';
  
  // Validate period
  const validPeriods: TimePeriod[] = ['7day', '1month', '3month', '6month', '12month', 'overall'];
  if (!validPeriods.includes(period)) {
    return c.json({ error: 'Invalid period parameter' }, 400);
  }
  
  // ... rest of handler using period variable
  const topArtists = await userLastfm.getTopArtists(period, 6);
  return c.json({ data: topArtists });
});
```

Same pattern for `/user-top-albums`.

### Phase 2: Frontend Changes

#### 2.1 Add Time Toggle Component

Create a new component or add inline to the stats page:

```typescript
// apps/web/src/components/ui/TimeToggle.tsx (optional - could be inline)

interface TimeToggleProps {
  periods: Array<{ value: string; label: string }>;
  activePeriod: string;
  onPeriodChange: (period: string) => void;
}
```

For SSR simplicity, implement as inline HTML with client-side JavaScript enhancement.

#### 2.2 Update Stats Page

```typescript
// apps/web/src/pages/user/stats.tsx

// Add toggle HTML before Top Artists section
<div class="time-toggle-container">
  <div class="time-toggle" id="time-toggle">
    <button class="time-toggle-btn active" data-period="7day">7 days</button>
    <button class="time-toggle-btn" data-period="1month">1 month</button>
    <button class="time-toggle-btn" data-period="12month">1 year</button>
  </div>
</div>

// Update section headers to be dynamic
<h2>👩‍🎤 Top Artists</h2>
<p class="text-center" id="top-artists-subtitle">
  <strong>Top artists in the past 7 days.</strong>
</p>
```

#### 2.3 Client-Side JavaScript

```javascript
(function() {
  var currentPeriod = new URLSearchParams(window.location.search).get('period') || '7day';
  var username = /* from server */;
  
  // Period labels for UI
  var periodLabels = {
    '7day': '7 days',
    '1month': 'month',
    '12month': 'year'
  };
  
  // Initialize toggle state
  function initToggle() {
    var buttons = document.querySelectorAll('.time-toggle-btn');
    buttons.forEach(function(btn) {
      btn.classList.remove('active');
      if (btn.dataset.period === currentPeriod) {
        btn.classList.add('active');
      }
      btn.addEventListener('click', function() {
        if (this.dataset.period !== currentPeriod) {
          switchPeriod(this.dataset.period);
        }
      });
    });
  }
  
  function switchPeriod(period) {
    currentPeriod = period;
    
    // Update URL without reload
    var url = new URL(window.location);
    url.searchParams.set('period', period);
    history.pushState({}, '', url);
    
    // Update toggle UI
    document.querySelectorAll('.time-toggle-btn').forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.period === period);
    });
    
    // Update subtitles
    updateSubtitles(period);
    
    // Show loading states
    showLoading();
    
    // Fetch new data
    fetchData(period);
  }
  
  function updateSubtitles(period) {
    var label = periodLabels[period];
    document.getElementById('top-artists-subtitle').innerHTML = 
      '<strong>Top artists in the past ' + label + '.</strong>';
    document.getElementById('top-albums-subtitle').innerHTML = 
      '<strong>Top albums in the past ' + label + '.</strong>';
  }
  
  function showLoading() {
    document.getElementById('top-artists').innerHTML = 
      '<div class="loading-container"><span class="spinner">↻</span><span class="loading-text">Loading top artists...</span></div>';
    document.getElementById('top-albums').innerHTML = 
      '<div class="loading-container"><span class="spinner">↻</span><span class="loading-text">Loading top albums...</span></div>';
  }
  
  function fetchData(period) {
    // Fetch both in parallel
    Promise.all([
      internalFetch('/api/internal/user-top-artists?username=' + encodeURIComponent(username) + '&period=' + period),
      internalFetch('/api/internal/user-top-albums?username=' + encodeURIComponent(username) + '&period=' + period)
    ]).then(function(responses) {
      return Promise.all(responses.map(function(r) { return r.json(); }));
    }).then(function(results) {
      renderTopArtists(results[0]);
      renderTopAlbums(results[1]);
    }).catch(function(err) {
      console.error('Failed to fetch data:', err);
      // Show error state
    });
  }
  
  // Initialize on page load
  initToggle();
  updateSubtitles(currentPeriod);
  fetchData(currentPeriod);
})();
```

### Phase 3: Styling

Add CSS for the time toggle:

```css
.time-toggle-container {
  text-align: center;
  margin: 2em 0;
}

.time-toggle {
  display: inline-flex;
  background: var(--bg-secondary);
  border-radius: 8px;
  padding: 4px;
  gap: 4px;
}

.time-toggle-btn {
  padding: 8px 16px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--text-secondary);
  transition: all 0.2s ease;
}

.time-toggle-btn:hover {
  color: var(--text-primary);
}

.time-toggle-btn.active {
  background: var(--accent);
  color: white;
}

.time-toggle-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

---

## Caching Considerations

### Current Behavior (No Changes Needed)

The existing caching strategy already handles multiple periods correctly:

```
Cache Key: lastfm:topartists:{username}:{period}:{limit}
Example:   lastfm:topartists:bordesak:7day:6
           lastfm:topartists:bordesak:1month:6
           lastfm:topartists:bordesak:12month:6
```

Each period is cached independently with a 1-hour TTL. This means:

- **First visit with `7day`**: Cache miss → API call → cached for 1 hour
- **Switch to `1month`**: Cache miss → API call → cached for 1 hour
- **Switch back to `7day`**: Cache hit (if within 1 hour)

### Cache Multiplier Effect

With 3 periods, we're caching up to 3x more data per user:

| Before | After |
|--------|-------|
| 2 cache entries per user | 6 cache entries per user |
| (1 artists + 1 albums) | (3 artists + 3 albums) |

**Impact assessment:**
- KV storage: Minimal (~1-2KB per entry)
- KV reads: Slightly higher (users switching periods)
- Last.fm API calls: Same rate (1 hour TTL unchanged)

**No changes needed** - the existing caching strategy scales naturally.

### Optional Optimization: Prefetch Adjacent Periods

For better UX, we could prefetch the adjacent period when a user selects one:

```javascript
// When user selects "1 month", prefetch "7 days" and "1 year" in background
function prefetchAdjacentPeriods(currentPeriod) {
  var periods = ['7day', '1month', '12month'];
  var currentIndex = periods.indexOf(currentPeriod);
  
  // Prefetch neighbors (low priority)
  if (currentIndex > 0) {
    prefetch(periods[currentIndex - 1]);
  }
  if (currentIndex < periods.length - 1) {
    prefetch(periods[currentIndex + 1]);
  }
}
```

**Recommendation:** Skip for MVP. Add if users report slow switching.

---

## Implementation Phases

### Phase 1: API Updates (30 min)
- [ ] Add `period` query parameter to `/api/internal/user-top-artists`
- [ ] Add `period` query parameter to `/api/internal/user-top-albums`
- [ ] Add period validation
- [ ] Test endpoints with different periods

### Phase 2: UI Implementation (1-2 hours)
- [ ] Add time toggle HTML to stats page
- [ ] Add CSS for toggle component
- [ ] Implement client-side JavaScript for:
  - Toggle state management
  - URL query parameter sync
  - Data fetching on period change
  - Loading/error states
- [ ] Update section subtitles dynamically

### Phase 3: Polish (30 min)
- [ ] Test on mobile devices
- [ ] Verify browser back/forward works with URL state
- [ ] Test empty states for each period
- [ ] Ensure toggle is disabled during loading

### Phase 4: Optional Enhancements
- [ ] Add prefetching for adjacent periods
- [ ] Add keyboard navigation for toggle
- [ ] Consider adding to recommendations page

---

## Testing Checklist

- [ ] Toggle switches between all three periods
- [ ] URL updates when period changes
- [ ] Direct URL with `?period=1month` loads correct data
- [ ] Browser back/forward navigates period history
- [ ] Loading states show during data fetch
- [ ] Empty states display correctly
- [ ] Toggle disabled during loading
- [ ] Works on mobile (touch targets, responsive)
- [ ] Private profiles still respect privacy settings
- [ ] Cache keys are correct for each period

---

## Future Considerations

### Additional Periods

If users request more granularity, we could add:
- **3 months** (`3month`)
- **6 months** (`6month`)
- **All time** (`overall`)

This would require expanding the toggle UI (possibly a dropdown for 6+ options).

### Per-Section Periods

Currently, both Top Artists and Top Albums use the same period. We could allow independent selection:

```
Top Artists: [7 days] [1 month] [1 year]
Top Albums:  [7 days] [1 month] [1 year]
```

**Recommendation:** Keep unified for simplicity. Different periods per section adds cognitive load.

### Recommendations Page

The recommendations page (`/u/:username/recommendations`) also uses `7day` for top artists. Consider adding the same toggle there for consistency.

---

## Summary

This feature adds a simple but powerful time range toggle to user stats pages. The implementation is straightforward because:

1. **Last.fm API already supports periods** - No new API integration needed
2. **Caching already handles periods** - Cache keys include period, no changes needed
3. **Progressive loading pattern exists** - Just add period parameter to existing fetches

The main work is UI: adding the toggle component, managing state, and updating the page dynamically.
