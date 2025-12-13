# Discogs Collection Integration Plan

## 🚀 Current Status: Sign-up Flow Live

**Last Updated:** 2025-12-13

### ✅ What's Working:
- **OAuth 1.0a flow** - Connect/disconnect Discogs accounts
- **Collection sync** - 1,497 releases in ~30 seconds
- **Stats display** - Basic stats on `/u/:username/discogs`
- **Enrichment via queues** - Background processing working
- **Production deployment** - All infrastructure functional
- **UUID Migration** - ✅ Complete (Migration 006)
- **Sign-up Flow** - ✅ Complete (Priority 1)

### ✅ UUID Migration Complete (2025-12-13)

Migration 006 successfully converted all user IDs from username-based to UUID-based.

**What was done:**
- 14 users migrated to UUID-based IDs
- All FK references updated (`oauth_tokens`, `searches`, `discogs_releases`, `discogs_sync_state`, `api_keys`)
- `_user_id_migration` table preserved for rollback reference
- `createUser()` and `isUsernameAvailable()` methods added to Database class
- `username` field now required (NOT NULL) in schema

**Rollback plan (if needed):**
1. Use `_user_id_migration` table to map `new_id → old_id`
2. D1 has point-in-time recovery via Cloudflare dashboard
3. Query: `SELECT * FROM _user_id_migration` to see mappings

### ✅ Priority 1: Account Page & Sign-up Flow Complete (2025-12-13)

**What was implemented:**
- Created `/account` page for new user sign-up
- Added `/api/auth/discogs/signup` route
- Modified OAuth callback to handle signup flow
- Fixed username availability check to prevent conflicts with existing Discogs usernames
- Fixed user lookup to support Discogs-only users
- Added welcome message for new sign-ups

**URLs:**
- Sign-up: https://listentomore.com/account
- Discogs stats: https://listentomore.com/u/:username/discogs

---

### 🚧 Next Steps (Alpha UX Fixes):

**Priority 2: Sync UX Improvements** ← NEXT
- Show loading spinner during initial sync after OAuth connect
- Display "Syncing your collection..." message on redirect
- Auto-refresh page when sync completes
- Style the sync/enrich buttons properly

**Priority 3: Enrichment Progress**
- Show enrichment progress bar on page load (already polling)
- Ensure enrichment kicks off automatically after sync

---

## Quick Reference

### Key Files
| File | Purpose |
|------|---------|
| `apps/web/src/pages/account/discogs.tsx` | Discogs management page |
| `apps/web/src/pages/user/stats.tsx` | User stats page (`/u/:username`) |
| `apps/web/src/api/admin/discogs-oauth.ts` | OAuth routes |
| `apps/web/src/api/internal/discogs.ts` | Internal APIs |
| `packages/services/discogs/` | Discogs service package |

### API Routes
| Route | Method | Purpose |
|-------|--------|---------|
| `/api/auth/discogs/connect` | GET | Start OAuth flow |
| `/api/auth/discogs/callback` | GET | OAuth callback |
| `/api/auth/discogs/disconnect` | POST | Disconnect account |
| `/api/internal/discogs-stats` | GET | Get collection stats |
| `/api/internal/discogs-sync` | POST | Trigger sync |
| `/api/internal/discogs-enrich` | POST | Trigger enrichment |

### Production Data
- **User:** bordesak (UUID: `21f67178c64bf648a635e46935ee61c1`) → elezea-records on Discogs
- **Releases:** 1,497 synced
- **Cache key:** `discogs:collection:21f67178c64bf648a635e46935ee61c1` (uses UUID now)

---

## Priority 1: Account Page & Sign-up Flow

### Goal
Create a central `/account` page where new users can sign up by connecting their Discogs account. This creates their user profile and `/u/:username` page.

### Current State
- No sign-up flow exists
- Users must already exist in the database to use `/u/:username/discogs`
- OAuth flow works but requires pre-existing user

### Implementation

#### 1.1 Create `/account` Page

**File:** `apps/web/src/pages/account/index.tsx`

```tsx
// Account page - sign up or manage connected services
export function AccountPage({ currentUser, internalToken }) {
  return (
    <Layout title="Account" internalToken={internalToken}>
      <header>
        <h1>Your Account</h1>
      </header>

      <main>
        {currentUser ? (
          // Logged in - show connected services
          <ConnectedServicesSection user={currentUser} />
        ) : (
          // Not logged in - show sign up options
          <SignUpSection />
        )}
      </main>
    </Layout>
  );
}

function SignUpSection() {
  return (
    <section>
      <h2>Create Your Profile</h2>
      <p>Connect a music service to create your ListenToMore profile.</p>
      
      <div class="auth-options">
        {/* Discogs - enabled */}
        <a href="/api/auth/discogs/signup" class="button">
          📀 Sign up with Discogs
        </a>
        
        {/* Last.fm - disabled for now */}
        <button class="button-secondary" disabled>
          📻 Sign up with Last.fm (coming soon)
        </button>
      </div>
    </section>
  );
}
```

#### 1.2 Create Sign-up OAuth Route

**File:** `apps/web/src/api/admin/discogs-oauth.ts` - Add new route

```typescript
// GET /api/auth/discogs/signup - Sign up via Discogs OAuth
app.get('/signup', async (c) => {
  // Similar to /connect but creates a new user
  // 1. Start OAuth flow
  // 2. On callback, create user with discogs_username as username
  // 3. Redirect to /u/:username
});
```

**Key difference from `/connect`:**
- `/connect` requires existing user (passed via `?username=`)
- `/signup` creates a new user from Discogs identity

#### 1.3 Modify OAuth Callback for Sign-up

In the callback, check if this is a sign-up flow:

```typescript
app.get('/callback', async (c) => {
  // ... existing OAuth token exchange ...
  
  const requestData = JSON.parse(requestDataJson);
  
  if (requestData.isSignup) {
    // Create new user
    const newUser = await db.createUser({
      username: identity.username, // Use Discogs username
      discogs_username: identity.username,
    });
    
    // Store OAuth tokens for new user
    await db.storeOAuthToken({
      userId: newUser.id,
      provider: 'discogs',
      // ... tokens ...
    });
    
    // Sync collection in background
    ctx.waitUntil(syncAndEnrich(newUser.id, identity.username));
    
    // Redirect to new user's page
    return c.redirect(`/u/${newUser.username}?welcome=true`);
  }
  
  // ... existing connect flow ...
});
```

#### 1.4 Route Registration

**File:** `apps/web/src/index.tsx`

```typescript
import { handleAccount } from './pages/account';

app.get('/account', handleAccount);
```

### Acceptance Criteria
- [ ] `/account` page renders sign-up options
- [ ] "Sign up with Discogs" starts OAuth flow
- [ ] New user created with Discogs username
- [ ] User redirected to `/u/:username` after sign-up
- [ ] Collection sync starts automatically
- [ ] Last.fm button shows "coming soon" (disabled)

---

## Priority 2: Sync UX Improvements

### Goal
Show clear feedback during initial collection sync after OAuth connect.

### Current State
- OAuth callback triggers sync via `waitUntil()`
- User redirected to `/u/:username/discogs?success=discogs_connected`
- Page shows "Collection not synced yet" until sync completes
- No loading indicator during sync

### Implementation

#### 2.1 Add Sync Status to Redirect

Pass sync status in URL:

```typescript
// In OAuth callback
return c.redirect(`/u/${username}/discogs?success=discogs_connected&syncing=true`);
```

#### 2.2 Show Sync Progress on Page

**File:** `apps/web/src/pages/account/discogs.tsx`

Add sync status detection and polling:

```tsx
// Check URL params for sync status
const urlParams = new URLSearchParams(window.location.search);
const isSyncing = urlParams.get('syncing') === 'true';

if (isSyncing) {
  // Show syncing message
  showSyncingState();
  
  // Poll for completion
  pollSyncStatus();
}

function showSyncingState() {
  statsEl.innerHTML = `
    <div class="sync-progress">
      <span class="spinner">↻</span>
      <p><strong>Syncing your collection...</strong></p>
      <p class="text-muted">This usually takes 30-60 seconds.</p>
    </div>
  `;
}

function pollSyncStatus() {
  const interval = setInterval(async () => {
    const result = await internalFetch('/api/internal/discogs-stats?username=' + username);
    const data = await result.json();
    
    if (!data.error) {
      // Sync complete - refresh page
      clearInterval(interval);
      window.location.href = window.location.pathname + '?success=sync_complete';
    }
  }, 3000); // Poll every 3 seconds
}
```

#### 2.3 Style the Buttons

Add proper button styling to match site theme:

```css
/* In global styles or component */
.button-secondary {
  background: var(--bg-secondary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  padding: 0.75rem 1.5rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 1rem;
}

.button-secondary:hover {
  background: var(--bg-hover);
}

.button-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

### Acceptance Criteria
- [ ] After OAuth connect, page shows "Syncing your collection..."
- [ ] Spinner animates during sync
- [ ] Page auto-refreshes when sync completes
- [ ] Buttons have consistent styling
- [ ] Sync/Enrich buttons match site theme

---

## Priority 3: Enrichment Auto-Start

### Goal
Ensure enrichment kicks off automatically after sync completes.

### Current State
- Enrichment queued via `DISCOGS_QUEUE` in OAuth callback ✅
- Queue consumer processes enrichment ✅
- Progress polling works on page ✅
- Status shows on `/u/:username/discogs` page ✅

### Verification
This should already be working. Verify:

1. After OAuth connect, check queue message sent
2. Check queue consumer logs for processing
3. Verify enrichment progress updates in KV

### If Not Working
Check `wrangler.toml` for queue binding:

```toml
[[queues.producers]]
queue = "discogs-enrichment"
binding = "DISCOGS_QUEUE"

[[queues.consumers]]
queue = "discogs-enrichment"
max_batch_size = 1
max_retries = 3
```

---

## Future Phases (Deferred)

### Phase 4: Stats Dashboard (`/u/:username/collection`)
- Dedicated collection stats page with charts
- Genre/format/year distribution visualizations
- Using Chart.js v4

### Phase 5: Full Collection List (`/u/:username/collection/all`)
- Filterable, searchable collection browser
- Pagination (25 per page)
- Sort by date added, artist name

### Phase 6: Last.fm Sign-up
- Enable Last.fm OAuth for sign-up
- Connect Last.fm to existing accounts

---

## Reference: Completed Work

<details>
<summary>Click to expand completed implementation details</summary>

### Phase 1: OAuth Foundation ✅
- OAuth 1.0a flow implemented
- Token encryption working
- Production secrets configured

### Phase 2: Collection Sync ✅
- Full collection fetch (paginated)
- KV caching with 6-hour TTL
- Stats calculation

### Enrichment via Queues ✅
- Queue producer in OAuth callback
- Queue consumer for background processing
- Progress tracking in KV

### Key Files Created
- `packages/services/discogs/` - Service package
- `apps/web/src/api/admin/discogs-oauth.ts` - OAuth routes
- `apps/web/src/api/internal/discogs.ts` - Internal APIs
- `apps/web/src/pages/account/discogs.tsx` - Discogs page

</details>

---

## Archived Reference Material

<details>
<summary>Click to expand original planning documentation (for historical reference)</summary>

The original planning document contained detailed sections on:

- **Previous Implementation Analysis** - How the old 3-worker system worked
- **Proposed Architecture** - System design diagrams and patterns
- **Data Model & Storage** - KV cache structure and D1 schema
- **Discogs OAuth Integration** - OAuth 1.0a flow details
- **Collection Sync Strategy** - Sync algorithm and background jobs
- **API Design** - Internal API route specifications
- **UI Components & Pages** - Page layouts and component structure
- **Code Organization** - File structure and hygiene guidelines
- **Rate Limiting & Caching** - Discogs API limits and cache TTLs
- **Chart Library Decision** - Why Chart.js v4 was chosen
- **Background Processing** - Cloudflare Queues implementation

All of this has been implemented. See the key files listed in Quick Reference above.

For the full original planning document, check git history:
```bash
git show main:docs/DISCOGS_COLLECTION_PLAN.md
```

</details>

