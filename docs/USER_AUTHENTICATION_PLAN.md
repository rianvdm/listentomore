# User Authentication Implementation Plan

## Executive Summary

This document outlines the plan to add user accounts to ListenToMore using **Last.fm as the sole authentication provider**. Users sign up by connecting their Last.fm account, which automatically links their listening data. This approach is simpler than multi-provider OAuth and aligns with the app's core purpose.

**Key changes from previous version:**
- Removed Spotify/Discogs OAuth (can add later if needed)
- Removed email+password authentication (complexity not worth it for MVP)
- Simplified to Last.fm Web Authentication only
- Clearer UX flow with `/account` replacing `/stats`

---

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Goals & Non-Goals](#goals--non-goals)
3. [Recommended UX Flow](#recommended-ux-flow)
4. [URL Structure](#url-structure)
5. [Navigation Changes](#navigation-changes)
6. [Database Schema Changes](#database-schema-changes)
7. [Last.fm Web Authentication](#lastfm-web-authentication)
8. [Session Management](#session-management)
9. [API Changes](#api-changes)
10. [UI/UX Designs](#uiux-designs)
11. [Implementation Phases](#implementation-phases)

---

## Current State Analysis

### What Exists

**Database (D1):**
- `users` table with: `id` (UUID), `username`, `email`, `lastfm_username`, `discogs_username`, `spotify_connected`, `created_at`, `updated_at`
- `api_keys` table with full key management
- User IDs now support UUIDs

**Current User Flow:**
- `/stats` - Anyone enters any Last.fm username
- `/u/{username}` - Shows stats if user exists in DB with `lastfm_username`
- No login/signup - users created manually via SQL

**What's Missing:**
- User registration flow
- Session management (cookies)
- "Logged in" state in UI
- Account settings page
- Privacy controls

---

## Goals & Non-Goals

### Goals

1. **Single sign-on with Last.fm** - Users authenticate via Last.fm, no passwords to manage
2. **Account page** - Replace `/stats` with `/account` for logged-in users
3. **Profile page** - `/u/{username}` shows user's stats (public or private)
4. **Privacy controls** - Users can make their profile public/private
5. **Clean navigation** - Show avatar/username when logged in

### Non-Goals (MVP)

- Spotify/Discogs OAuth (future enhancement)
- Email+password authentication
- Social features (following, friends)
- Premium subscriptions
- Multi-factor authentication

---

## Recommended UX Flow

### The Core Insight

The best UX for a music stats app is **"Sign in with Last.fm"** as the only auth method. This is because:

1. **Every user already has Last.fm** - That's the whole point of the app
2. **No passwords to manage** - Reduces friction and security burden
3. **Instant data access** - Account creation = data connection in one step
4. **Familiar pattern** - Users expect "Sign in with X" for single-purpose apps

### User Journey

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           VISITOR (NOT LOGGED IN)                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Nav: [Brand] [Albums] [Artists] [About] [Sign In]                          │
│                                                                             │
│  • Can browse albums, artists, genres                                       │
│  • Can view PUBLIC user profiles at /u/{username}                           │
│  • Cannot see private profiles                                              │
│  • "Sign In" button in nav → /login                                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              /login PAGE                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                        Sign in to ListenToMore                              │
│                                                                             │
│         Connect your Last.fm account to see your listening stats            │
│         and get personalized recommendations.                               │
│                                                                             │
│              ┌─────────────────────────────────────────┐                    │
│              │  🎵  Continue with Last.fm              │                    │
│              └─────────────────────────────────────────┘                    │
│                                                                             │
│         By signing in, you agree to our Terms and Privacy Policy            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         LAST.FM AUTH FLOW                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Redirect to Last.fm authorization page                                  │
│  2. User approves ListenToMore access                                       │
│  3. Last.fm redirects back with token                                       │
│  4. We fetch user's Last.fm username                                        │
│  5. Create or update user in DB                                             │
│  6. Create session, set cookie                                              │
│  7. Redirect to /account (new users) or /u/{username} (returning)           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           LOGGED IN USER                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Nav: [Brand] [Albums] [Artists] [About] [👤 Avatar ▼]                      │
│                                                  │                          │
│                                                  ├─ My Profile              │
│                                                  ├─ Account Settings        │
│                                                  └─ Sign Out                │
│                                                                             │
│  • Full access to all features                                              │
│  • /u/{username} shows their stats                                          │
│  • /account shows settings (privacy, etc.)                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## URL Structure

| URL | Purpose | Auth Required |
|-----|---------|---------------|
| `/login` | Sign in page with Last.fm button | No |
| `/auth/lastfm` | Initiates Last.fm auth flow | No |
| `/auth/lastfm/callback` | Handles Last.fm callback | No |
| `/auth/logout` | Destroys session, redirects to / | Yes |
| `/account` | Account settings (privacy, etc.) | Yes |
| `/u/{username}` | Public profile page | No (respects privacy) |
| `/u/{username}/recommendations` | AI recommendations | No (respects privacy) |

**Removed:**
- `/stats` - No longer needed; users sign in to see their own stats
- `/stats/lookup` - Removed; no arbitrary username lookup

---

## Navigation Changes

### Current Navigation
```
[Brand] [Albums] [Artists] [Stats] [Discord] [About] [🌙]
```

### New Navigation (Logged Out)
```
[Brand] [Albums] [Artists] [About] [Sign In] [🌙]
```

### New Navigation (Logged In)
```
[Brand] [Albums] [Artists] [About] [👤 ▼] [🌙]
                                    │
                                    ├─ My Profile
                                    ├─ Account Settings  
                                    └─ Sign Out
```

**Changes:**
- Remove "Stats" link (replaced by account flow)
- Remove "Discord" link (move to About page or footer)
- Add "Sign In" button for logged-out users
- Add user dropdown with avatar for logged-in users

---

## Database Schema Changes

### Migration 005: Add Authentication Fields

```sql
-- Migration: 005_user_auth.sql
-- Simplified auth fields for Last.fm-only authentication

-- Session key from Last.fm (for API calls on user's behalf)
ALTER TABLE users ADD COLUMN lastfm_session_key TEXT;

-- Profile fields
ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users ADD COLUMN avatar_url TEXT;
ALTER TABLE users ADD COLUMN bio TEXT;

-- Privacy: 'public' (anyone), 'private' (only owner)
ALTER TABLE users ADD COLUMN profile_visibility TEXT DEFAULT 'public';

-- Timestamps
ALTER TABLE users ADD COLUMN last_login_at TEXT;
ALTER TABLE users ADD COLUMN login_count INTEGER DEFAULT 0;

-- Index for Last.fm username lookups (already exists, but ensure it's there)
CREATE INDEX IF NOT EXISTS idx_users_lastfm ON users(lastfm_username);
```

### Migration 006: User Sessions Table

```sql
-- Migration: 006_sessions.sql
-- Simple session management for cookie-based auth

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT,
  ip_address TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  last_active_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
```

### Updated TypeScript Interfaces

```typescript
// packages/db/src/schema.ts

export interface User {
  id: string;  // UUID
  username: string;  // URL-safe identifier (lowercase lastfm username)
  email: string | null;
  
  // Last.fm connection
  lastfm_username: string;  // Required for auth
  lastfm_session_key: string | null;  // For authenticated Last.fm API calls
  
  // Profile
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  profile_visibility: 'public' | 'private';
  
  // Legacy fields (keep for now)
  discogs_username: string | null;
  spotify_connected: number;
  
  // Timestamps
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  login_count: number;
}

export interface Session {
  id: string;
  user_id: string;
  token_hash: string;
  user_agent: string | null;
  ip_address: string | null;
  created_at: string;
  expires_at: string;
  last_active_at: string;
}
```

---

## Last.fm Web Authentication

Last.fm uses a **Web Authentication** flow (not OAuth 2.0). It's simpler but different:

### How Last.fm Auth Works

1. **Get API Key & Secret** - Register app at https://www.last.fm/api/account/create
2. **Redirect to Last.fm** - User authorizes on Last.fm's site
3. **Callback with Token** - Last.fm redirects back with a temporary token
4. **Exchange for Session Key** - Call `auth.getSession` to get permanent session key
5. **Store Session Key** - Use for authenticated API calls

### Required Environment Variables

```
LASTFM_API_KEY=your_api_key          # Already have this
LASTFM_SHARED_SECRET=your_secret     # Need to add this
```

### Implementation

```typescript
// apps/web/src/pages/auth/lastfm.tsx

const LASTFM_AUTH_URL = 'https://www.last.fm/api/auth/';

// Step 1: Redirect to Last.fm
export function handleLastfmAuth(c: Context) {
  const callbackUrl = `${c.req.url.split('/auth')[0]}/auth/lastfm/callback`;
  const authUrl = `${LASTFM_AUTH_URL}?api_key=${c.env.LASTFM_API_KEY}&cb=${encodeURIComponent(callbackUrl)}`;
  return c.redirect(authUrl);
}

// Step 2: Handle callback
export async function handleLastfmCallback(c: Context) {
  const token = c.req.query('token');
  if (!token) {
    return c.redirect('/login?error=no_token');
  }

  // Step 3: Exchange token for session key
  const sig = md5(`api_key${c.env.LASTFM_API_KEY}methodauth.getSessiontoken${token}${c.env.LASTFM_SHARED_SECRET}`);
  
  const response = await fetch(
    `https://ws.audioscrobbler.com/2.0/?method=auth.getSession&api_key=${c.env.LASTFM_API_KEY}&token=${token}&api_sig=${sig}&format=json`
  );
  
  const data = await response.json();
  
  if (data.error) {
    return c.redirect('/login?error=auth_failed');
  }

  const { name: lastfmUsername, key: sessionKey } = data.session;

  // Step 4: Create or update user
  const db = c.get('db');
  let user = await db.getUserByLastfmUsername(lastfmUsername);
  
  if (!user) {
    // New user - create account
    user = await db.createUser({
      id: crypto.randomUUID(),
      username: lastfmUsername.toLowerCase(),
      lastfm_username: lastfmUsername,
      lastfm_session_key: sessionKey,
      profile_visibility: 'public',
    });
  } else {
    // Returning user - update session key and login time
    await db.updateUser(user.id, {
      lastfm_session_key: sessionKey,
      last_login_at: new Date().toISOString(),
      login_count: user.login_count + 1,
    });
  }

  // Step 5: Create app session
  await createSession(c, user.id, db);

  // Redirect to profile (or account for new users)
  return c.redirect(`/u/${user.username}`);
}
```

### MD5 Signature Helper

Last.fm requires MD5 signatures (legacy API):

```typescript
// utils/md5.ts
// Use a lightweight MD5 implementation for Cloudflare Workers
import { md5 } from 'js-md5';  // or implement with crypto.subtle

export function lastfmSignature(params: Record<string, string>, secret: string): string {
  const sorted = Object.keys(params).sort();
  const str = sorted.map(k => `${k}${params[k]}`).join('') + secret;
  return md5(str);
}
```

---

## Session Management

### Cookie-Based Sessions

```typescript
// utils/session.ts
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

const SESSION_COOKIE = 'ltm_session';
const SESSION_DURATION = 30 * 24 * 60 * 60; // 30 days

export async function createSession(c: Context, userId: string, db: Database): Promise<void> {
  const token = crypto.randomUUID();
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DURATION * 1000).toISOString();

  await db.createSession({
    id: crypto.randomUUID(),
    user_id: userId,
    token_hash: tokenHash,
    user_agent: c.req.header('User-Agent'),
    ip_address: c.req.header('CF-Connecting-IP'),
    expires_at: expiresAt,
  });

  setCookie(c, SESSION_COOKIE, token, {
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: SESSION_DURATION,
  });
}

export async function validateSession(c: Context, db: Database): Promise<User | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;

  const tokenHash = await hashToken(token);
  const session = await db.getSessionByToken(tokenHash);

  if (!session || new Date(session.expires_at) < new Date()) {
    deleteCookie(c, SESSION_COOKIE);
    return null;
  }

  return db.getUser(session.user_id);
}

export async function destroySession(c: Context, db: Database): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const tokenHash = await hashToken(token);
    await db.deleteSessionByToken(tokenHash);
  }
  deleteCookie(c, SESSION_COOKIE);
}

async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}
```

### Session Middleware

```typescript
// middleware/session.ts
import { createMiddleware } from 'hono/factory';
import { validateSession } from '../utils/session';

export const sessionMiddleware = createMiddleware(async (c, next) => {
  const db = c.get('db');
  const user = await validateSession(c, db);
  
  c.set('currentUser', user);
  c.set('isAuthenticated', !!user);
  
  await next();
});
```

### Updated Variables Type

```typescript
// types.ts
export interface Variables {
  // ... existing
  currentUser: User | null;
  isAuthenticated: boolean;
}
```

---

## API Changes

### New Routes

```
GET  /login                    - Login page with Last.fm button
GET  /auth/lastfm              - Initiates Last.fm auth redirect
GET  /auth/lastfm/callback     - Handles Last.fm callback
GET  /auth/logout              - Destroys session, redirects to /

GET  /account                  - Account settings (requires auth)
POST /account/profile          - Update display name, bio
POST /account/privacy          - Update profile visibility
POST /account/delete           - Delete account

GET  /u/:username              - Profile page (respects privacy)
GET  /u/:username/recommendations - Recommendations (respects privacy)
```

### Removed Routes

```
GET  /stats                    - Remove (replaced by /login flow)
GET  /stats/lookup             - Remove (no arbitrary lookup)
```

### Auth Middleware

```typescript
// middleware/require-auth.ts
export const requireAuth = createMiddleware(async (c, next) => {
  if (!c.get('isAuthenticated')) {
    return c.redirect('/login?next=' + encodeURIComponent(c.req.path));
  }
  await next();
});
```

### Privacy Check for Profile Routes

```typescript
// In /u/:username handler
const targetUser = await db.getUserByUsername(username);
const currentUser = c.get('currentUser');

if (!targetUser) {
  return c.html(<NotFoundPage />);
}

// Check privacy
if (targetUser.profile_visibility === 'private') {
  if (!currentUser || currentUser.id !== targetUser.id) {
    return c.html(<PrivateProfilePage />);
  }
}

// Render profile
return c.html(<ProfilePage user={targetUser} isOwner={currentUser?.id === targetUser.id} />);
```

---

## UI/UX Designs

### `/login` - Sign In Page

```
┌─────────────────────────────────────────────────┐
│                                                 │
│           Sign in to ListenToMore               │
│                                                 │
│   Connect your Last.fm account to see your      │
│   listening stats and get personalized          │
│   recommendations.                              │
│                                                 │
│   ┌─────────────────────────────────────────┐   │
│   │  🎵  Continue with Last.fm              │   │
│   └─────────────────────────────────────────┘   │
│                                                 │
│   By signing in, you agree to our               │
│   Terms of Service and Privacy Policy           │
│                                                 │
└─────────────────────────────────────────────────┘
```

### `/account` - Account Settings

```
┌─────────────────────────────────────────────────┐
│  Account Settings                               │
│                                                 │
│  ═══════════════════════════════════════════   │
│                                                 │
│  PROFILE                                        │
│                                                 │
│  Display Name                                   │
│  ┌──────────────────────────────────────────┐  │
│  │ Rian                                     │  │
│  └──────────────────────────────────────────┘  │
│                                                 │
│  Bio                                            │
│  ┌──────────────────────────────────────────┐  │
│  │ Music lover from Cape Town               │  │
│  └──────────────────────────────────────────┘  │
│                                                 │
│  [Save Changes]                                 │
│                                                 │
│  ═══════════════════════════════════════════   │
│                                                 │
│  CONNECTED ACCOUNT                              │
│                                                 │
│  📻 Last.fm        Connected as @bordesak      │
│                    (Cannot disconnect - used    │
│                     for authentication)         │
│                                                 │
│  ═══════════════════════════════════════════   │
│                                                 │
│  PRIVACY                                        │
│                                                 │
│  Profile Visibility                             │
│  ○ Public - Anyone can see your profile        │
│  ● Private - Only you can see your profile     │
│                                                 │
│  ═══════════════════════════════════════════   │
│                                                 │
│  DANGER ZONE                                    │
│                                                 │
│  [Delete Account]                               │
│  This will permanently delete your account.     │
│                                                 │
└─────────────────────────────────────────────────┘
```

### `/u/{username}` - Profile Page

**Owner viewing their profile:**
```
┌─────────────────────────────────────────────────┐
│  [Avatar]  Rian (@bordesak)    [Account Settings]│
│            "Music lover from Cape Town"          │
│                                                 │
│  ───────────────────────────────────────────   │
│                                                 │
│  🎧 Recent Listening                            │
│  [Track info...]                                │
│                                                 │
│  👩‍🎤 Top Artists (7 Days)                       │
│  [Grid of artists...]                           │
│                                                 │
│  🏆 Top Albums (30 Days)                        │
│  [Grid of albums...]                            │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Private profile (non-owner):**
```
┌─────────────────────────────────────────────────┐
│                                                 │
│            🔒 Private Profile                   │
│                                                 │
│  This user has chosen to keep their listening   │
│  stats private.                                 │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

## Profile Privacy

### Visibility Levels

| Level | Description |
|-------|-------------|
| `public` | Anyone can view the profile |
| `private` | Only the owner can view |

(Removed `unlisted` for simplicity - can add later if needed)

### Implementation

```typescript
function canViewProfile(targetUser: User, currentUser: User | null): boolean {
  if (targetUser.profile_visibility === 'public') return true;
  if (targetUser.profile_visibility === 'private') {
    return currentUser?.id === targetUser.id;
  }
  return false;
}
```

---

## Migration Strategy

### Existing Users

The database has existing users created manually with `lastfm_username` set. When they sign in via Last.fm auth:

1. The callback checks if a user with that `lastfm_username` already exists
2. If yes, update their `lastfm_session_key` and log them in
3. If no, create a new user

This means existing users automatically get "claimed" when they sign in with their Last.fm account.

### Migration SQL

```sql
-- Set defaults for existing users
UPDATE users SET
  profile_visibility = 'public',
  display_name = lastfm_username
WHERE profile_visibility IS NULL;
```

---

## Implementation Phases

### Phase 1: Database & Session Foundation

1. Create migration 005 (auth fields) and 006 (sessions table)
2. Implement session utilities (`createSession`, `validateSession`, `destroySession`)
3. Add session middleware to inject `currentUser` into context
4. Update `Variables` type with `currentUser` and `isAuthenticated`

**Deliverable:** Session infrastructure ready, no visible changes yet

### Phase 2: Last.fm Authentication

1. Add `LASTFM_SHARED_SECRET` to environment
2. Create `/login` page with "Continue with Last.fm" button
3. Implement `/auth/lastfm` redirect handler
4. Implement `/auth/lastfm/callback` to exchange token and create session
5. Implement `/auth/logout` to destroy session

**Deliverable:** Users can sign in and out via Last.fm

### Phase 3: Navigation & Account Page

1. Update `NavBar` to show auth state (Sign In vs Avatar dropdown)
2. Create `/account` page with profile settings and privacy controls
3. Implement profile update and privacy toggle endpoints
4. Remove `/stats` route (redirect to `/login` or `/account`)

**Deliverable:** Full auth UX with account management

### Phase 4: Profile Privacy

1. Add privacy check to `/u/:username` route
2. Create `PrivateProfilePage` component
3. Update internal APIs to respect privacy settings
4. Add "Account Settings" link on own profile

**Deliverable:** Privacy controls working end-to-end

---

## Environment Variables

| Variable | Purpose | Status |
|----------|---------|--------|
| `LASTFM_API_KEY` | Last.fm API calls | Already have |
| `LASTFM_SHARED_SECRET` | Last.fm auth signatures | **Need to add** |

---

## Open Questions

1. **Reserved usernames**: Should we block `admin`, `api`, `account`, etc.?
2. **Existing users**: Auto-claim on first Last.fm login (recommended)
3. **Profile URL**: Keep `/u/{username}` (recommended)
4. **Account deletion**: Soft delete or hard delete?

---

## Conclusion

This simplified plan focuses on **Last.fm as the sole authentication provider**, removing the complexity of multi-provider OAuth and password management. The key benefits:

- **Simpler implementation** - One auth flow instead of four
- **Better UX** - Users already have Last.fm accounts
- **No password liability** - No passwords to store or breach
- **Instant data connection** - Auth = data access in one step

The phased approach allows incremental delivery while maintaining backwards compatibility with existing user profiles.
