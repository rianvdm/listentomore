# User Authentication Implementation Plan

## Executive Summary

This document outlines the plan to add registered/authenticated user support to ListenToMore. Currently, the app operates as a "bring your own Last.fm username" service with no user accounts. This plan covers database schema changes, authentication flows, security considerations, and UI/UX changes to support proper user registration, login, and personalized experiences.

---

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Goals & Non-Goals](#goals--non-goals)
3. [Database Schema Changes](#database-schema-changes)
4. [Authentication Strategy](#authentication-strategy)
5. [Session Management](#session-management)
6. [Security Considerations](#security-considerations)
7. [API Changes](#api-changes)
8. [UI/UX Changes](#uiux-changes)
9. [Profile Privacy Controls](#profile-privacy-controls)
10. [Migration Strategy](#migration-strategy)
11. [Implementation Phases](#implementation-phases)

---

## Current State Analysis

### What Exists

**Database (D1):**
- `users` table with: `id`, `username`, `email`, `lastfm_username`, `discogs_username`, `spotify_connected`, `created_at`, `updated_at`
- `api_keys` table with full key management (hash, tier, scopes, rate limits)
- `searches` table for per-user search history
- User IDs are now standardized to lowercase usernames (migration 004)

**Authentication:**
- API key system for `/api/v1/*` endpoints (X-API-Key header)
- HMAC-signed internal tokens for `/api/internal/*` (5-minute TTL)
- Admin secret for `/api/auth/keys` endpoint
- No user login/signup - users are created manually via SQL

**User Pages:**
- `/u/{username}` - Public stats page (Last.fm data)
- `/u/{username}/recommendations` - AI recommendations based on listening
- `/stats` - Entry point where anyone can enter any Last.fm username

### What's Missing

- User registration (signup flow)
- Password-based or OAuth login
- Session management (cookies, tokens)
- "Logged in" state in UI
- User settings/preferences page
- Account management (change password, delete account)
- Privacy controls (public vs. private profiles)

---

## Goals & Non-Goals

### Goals

1. Allow users to register accounts and claim their username
2. Enable login via OAuth (Spotify, Last.fm) and/or email+password
3. Provide personalized dashboard for logged-in users
4. Let users control privacy (public/private profile)
5. Enable users to manage their connected services (Last.fm, Spotify, Discogs)
6. Support account deletion (GDPR compliance)

### Non-Goals (for initial implementation)

- Social features (following, friends)
- User-generated content (playlists, reviews)
- Premium subscriptions or payments
- Mobile app authentication
- Multi-factor authentication (2FA)

---

## Database Schema Changes

### Migration 004.5: Convert User IDs to UUIDs (PREREQUISITE)

**Why this is needed:** The current schema uses `id = lowercase(username)` which was derived from Last.fm usernames. This creates a problem when users can sign up via different services (Discogs, Last.fm, Spotify) where usernames differ. We need stable UUIDs for user IDs.

**Current state:**
- `users.id` = lowercase username (e.g., `bordesak`, `draklef`)
- Foreign keys in `searches`, `discogs_releases`, `oauth_tokens`, `discogs_sync_state` reference this

**Target state:**
- `users.id` = UUID (e.g., `a1b2c3d4e5f6...`)
- `users.username` = user-chosen or service-derived username (for URLs)

```sql
-- Migration: Convert user IDs from username to UUID
-- File: packages/db/src/migrations/004.5_uuid_user_ids.sql
-- MUST RUN BEFORE any other auth migrations

-- Step 1: Add new UUID column and populate
ALTER TABLE users ADD COLUMN new_id TEXT;
UPDATE users SET new_id = lower(hex(randomblob(16)));

-- Step 2: Ensure username column has current id values
UPDATE users SET username = id WHERE username IS NULL;

-- Step 3: Update foreign keys in related tables
-- Note: SQLite doesn't support ALTER COLUMN, so we need to recreate tables
-- or use a more complex migration strategy

-- For oauth_tokens (already has proper FK)
UPDATE oauth_tokens SET user_id = (
  SELECT new_id FROM users WHERE users.id = oauth_tokens.user_id
);

-- For searches
UPDATE searches SET user_id = (
  SELECT new_id FROM users WHERE users.id = searches.user_id
) WHERE user_id != 'default';

-- For discogs_releases  
UPDATE discogs_releases SET user_id = (
  SELECT new_id FROM users WHERE users.id = discogs_releases.user_id
) WHERE user_id != 'default';

-- For discogs_sync_state
UPDATE discogs_sync_state SET user_id = (
  SELECT new_id FROM users WHERE users.id = discogs_sync_state.user_id
) WHERE user_id != 'default';

-- Step 4: Swap id columns
-- SQLite approach: Create new table, copy data, drop old, rename
-- (Full implementation depends on exact constraints needed)

-- Step 5: Update indexes
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
```

**Important:** This migration must be tested carefully in a dev environment first. Consider:
1. Backup production database before running
2. Update all code that assumes `id = username`
3. Update `Database` class methods that create users

---

### Migration 005: Add Authentication Fields

```sql
-- Migration: Add authentication fields to users table
-- File: packages/db/src/migrations/005_user_auth.sql

-- Add auth-related columns to users table
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN auth_provider TEXT DEFAULT 'email';
-- auth_provider: 'email', 'spotify', 'lastfm', 'discord'

ALTER TABLE users ADD COLUMN oauth_provider_id TEXT;
-- External ID from OAuth provider (Spotify user ID, Last.fm username, etc.)

ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN email_verification_token TEXT;
ALTER TABLE users ADD COLUMN email_verification_expires TEXT;

ALTER TABLE users ADD COLUMN password_reset_token TEXT;
ALTER TABLE users ADD COLUMN password_reset_expires TEXT;

ALTER TABLE users ADD COLUMN display_name TEXT;
-- User-chosen display name (username is for URLs)

ALTER TABLE users ADD COLUMN avatar_url TEXT;
-- Profile picture (from OAuth or uploaded)

ALTER TABLE users ADD COLUMN bio TEXT;
-- Short user bio/description

ALTER TABLE users ADD COLUMN profile_visibility TEXT DEFAULT 'public';
-- 'public', 'private', 'unlisted'

ALTER TABLE users ADD COLUMN last_login_at TEXT;
ALTER TABLE users ADD COLUMN login_count INTEGER DEFAULT 0;

-- Index for OAuth lookups
CREATE INDEX IF NOT EXISTS idx_users_oauth ON users(auth_provider, oauth_provider_id);
CREATE INDEX IF NOT EXISTS idx_users_email_verified ON users(email) WHERE email_verified = 1;
```

### Migration 006: User Sessions Table

```sql
-- Migration: Add sessions table for authentication
-- File: packages/db/src/migrations/006_sessions.sql

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Session token (stored hashed in DB, raw in cookie)
  token_hash TEXT NOT NULL UNIQUE,

  -- Device/context info
  user_agent TEXT,
  ip_address TEXT,
  device_name TEXT,  -- User-friendly name like "Chrome on macOS"

  -- Lifecycle
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  last_active_at TEXT DEFAULT (datetime('now')),
  revoked_at TEXT  -- NULL = active
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
```

### Migration 007: OAuth Tokens Table

```sql
-- Migration: Add OAuth tokens table for connected services
-- File: packages/db/src/migrations/007_oauth_tokens.sql

CREATE TABLE IF NOT EXISTS oauth_tokens (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  provider TEXT NOT NULL,  -- 'spotify', 'lastfm', 'discogs'

  -- Token storage (encrypted)
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,

  -- Token metadata
  token_type TEXT DEFAULT 'Bearer',
  scope TEXT,  -- Space-separated scopes
  expires_at TEXT,

  -- Provider-specific user info
  provider_user_id TEXT,
  provider_username TEXT,

  -- Lifecycle
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_user_provider ON oauth_tokens(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_oauth_provider ON oauth_tokens(provider);
```

### Updated User TypeScript Interface

```typescript
// packages/db/src/schema.ts

export interface User {
  id: string;
  username: string;
  email: string | null;

  // Authentication
  password_hash: string | null;
  auth_provider: 'email' | 'spotify' | 'lastfm' | 'discord';
  oauth_provider_id: string | null;
  email_verified: number;
  email_verification_token: string | null;
  email_verification_expires: string | null;
  password_reset_token: string | null;
  password_reset_expires: string | null;

  // Profile
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  profile_visibility: 'public' | 'private' | 'unlisted';

  // Connected services (legacy fields)
  lastfm_username: string | null;
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
  device_name: string | null;
  created_at: string;
  expires_at: string;
  last_active_at: string;
  revoked_at: string | null;
}

export interface OAuthToken {
  id: string;
  user_id: string;
  provider: 'spotify' | 'lastfm' | 'discogs';
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  token_type: string;
  scope: string | null;
  expires_at: string | null;
  provider_user_id: string | null;
  provider_username: string | null;
  created_at: string;
  updated_at: string;
}
```

---

## Authentication Strategy

### Primary: OAuth with Spotify

Spotify OAuth is recommended as the primary auth method because:
1. All users have Spotify (it's the core data source)
2. No passwords to manage or leak
3. Immediate access to user's Spotify data
4. Trusted, familiar login flow

**Flow:**
1. User clicks "Sign in with Spotify"
2. Redirect to Spotify OAuth consent screen
3. Spotify redirects back with authorization code
4. Exchange code for access/refresh tokens
5. Fetch Spotify user profile (id, display_name, email, images)
6. Create or login user, store encrypted tokens

### Secondary: Email + Password

For users who prefer not to use OAuth:

**Registration Flow:**
1. User enters email, username, password
2. Hash password with Argon2id (via Web Crypto API or cf-argon2 binding)
3. Create user with `email_verified = 0`
4. Send verification email with signed token
5. User clicks link, verify token, set `email_verified = 1`

**Login Flow:**
1. User enters email and password
2. Lookup user by email
3. Verify password hash
4. Create session, set cookie

### Password Hashing

On Cloudflare Workers, use the `crypto.subtle` API with PBKDF2 or use a Wasm-based Argon2 library:

```typescript
// utils/password.ts
const ITERATIONS = 100_000;
const HASH_LENGTH = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const hash = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    HASH_LENGTH * 8
  );

  // Return as base64: salt:hash
  const saltB64 = btoa(String.fromCharCode(...salt));
  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
  return `${saltB64}:${hashB64}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltB64, expectedHashB64] = stored.split(':');
  const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const hash = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    HASH_LENGTH * 8
  );

  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
  return hashB64 === expectedHashB64;
}
```

---

## Session Management

### Cookie-Based Sessions

Use HTTP-only, secure cookies for session management:

```typescript
// utils/session.ts
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

const SESSION_COOKIE = 'ltm_session';
const SESSION_DURATION = 30 * 24 * 60 * 60; // 30 days in seconds

export async function createSession(
  c: Context,
  userId: string,
  db: Database
): Promise<string> {
  // Generate random session token
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(tokenBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Hash token for storage
  const tokenHash = await hashToken(token);

  // Calculate expiry
  const expiresAt = new Date(Date.now() + SESSION_DURATION * 1000).toISOString();

  // Store session in DB
  await db.createSession({
    userId,
    tokenHash,
    userAgent: c.req.header('User-Agent') || null,
    ipAddress: c.req.header('CF-Connecting-IP') || null,
    expiresAt,
  });

  // Set cookie
  setCookie(c, SESSION_COOKIE, token, {
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: SESSION_DURATION,
  });

  return token;
}

export async function validateSession(
  c: Context,
  db: Database
): Promise<User | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;

  const tokenHash = await hashToken(token);
  const session = await db.getSessionByToken(tokenHash);

  if (!session || session.revoked_at || new Date(session.expires_at) < new Date()) {
    deleteCookie(c, SESSION_COOKIE);
    return null;
  }

  // Update last_active_at (fire and forget)
  db.updateSessionActivity(session.id);

  return db.getUser(session.user_id);
}

export async function destroySession(c: Context, db: Database): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const tokenHash = await hashToken(token);
    await db.revokeSessionByToken(tokenHash);
  }
  deleteCookie(c, SESSION_COOKIE);
}

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
```

### Session Middleware

Add middleware to inject `currentUser` into all route handlers:

```typescript
// middleware/session.ts
import { createMiddleware } from 'hono/factory';
import { validateSession } from '../utils/session';

export const sessionMiddleware = createMiddleware(async (c, next) => {
  const db = c.get('db');
  const user = await validateSession(c, db);

  c.set('currentUser', user);  // null if not logged in
  c.set('isAuthenticated', !!user);

  await next();
});
```

Update `Variables` type:

```typescript
// types.ts
export interface Variables {
  // ... existing
  currentUser: User | null;
  isAuthenticated: boolean;
}
```

---

## Security Considerations

### Password Security

1. **Hashing**: Use PBKDF2 with 100k iterations minimum (or Argon2id if available)
2. **Salt**: 16 bytes random per password
3. **Comparison**: Use constant-time comparison to prevent timing attacks
4. **Requirements**: Minimum 8 characters, no maximum (beyond reason)

### Session Security

1. **Token Length**: 32 bytes (256 bits) of cryptographic randomness
2. **Storage**: Only store SHA-256 hash in database
3. **Cookie Flags**: `HttpOnly`, `Secure`, `SameSite=Lax`
4. **Expiration**: 30 days default, with sliding expiration on activity
5. **Revocation**: Track `revoked_at` to invalidate sessions

### OAuth Security

1. **State Parameter**: Use CSRF token in OAuth state
2. **Token Encryption**: Encrypt access/refresh tokens in DB with KMS or env secret
3. **Scope Minimization**: Request only necessary OAuth scopes
4. **Token Refresh**: Automatically refresh expired tokens

### CSRF Protection

For forms that modify data, implement CSRF protection:

```typescript
// utils/csrf.ts
export async function generateCsrfToken(sessionId: string, secret: string): Promise<string> {
  const data = `${sessionId}:${Date.now()}`;
  const signature = await sign(data, secret);
  return `${data}:${signature}`;
}

export async function verifyCsrfToken(
  token: string,
  sessionId: string,
  secret: string
): Promise<boolean> {
  const [storedSessionId, timestamp, signature] = token.split(':');

  // Check session matches
  if (storedSessionId !== sessionId) return false;

  // Check not expired (1 hour)
  if (Date.now() - parseInt(timestamp) > 3600000) return false;

  // Verify signature
  const data = `${storedSessionId}:${timestamp}`;
  const expectedSig = await sign(data, secret);
  return signature === expectedSig;
}
```

### Rate Limiting

Add rate limiting for auth endpoints:

| Endpoint | Limit | Window |
|----------|-------|--------|
| POST /auth/login | 5 attempts | 15 minutes |
| POST /auth/register | 3 attempts | 1 hour |
| POST /auth/forgot-password | 3 attempts | 1 hour |
| POST /auth/verify-email | 5 attempts | 15 minutes |

### Account Security

1. **Email Verification**: Required for password reset
2. **Password Reset**: Time-limited tokens (1 hour), single-use
3. **Session Management**: UI to view/revoke active sessions
4. **Audit Log**: Track login attempts, password changes

---

## API Changes

### New Auth Endpoints

```
POST /auth/register          - Create new account (email/password)
POST /auth/login             - Login with email/password
POST /auth/logout            - Destroy current session
GET  /auth/me                - Get current user info

GET  /auth/oauth/spotify     - Initiate Spotify OAuth
GET  /auth/oauth/spotify/callback  - Handle Spotify callback
GET  /auth/oauth/lastfm      - Initiate Last.fm OAuth (if supported)
GET  /auth/oauth/lastfm/callback

POST /auth/forgot-password   - Request password reset email
POST /auth/reset-password    - Reset password with token
POST /auth/verify-email      - Verify email with token
POST /auth/resend-verification

GET  /account/sessions       - List active sessions
DELETE /account/sessions/:id - Revoke a session
DELETE /account              - Delete account (with confirmation)

PATCH /account/profile       - Update display name, bio, avatar
PATCH /account/privacy       - Update profile visibility
PATCH /account/password      - Change password (requires current)
PATCH /account/email         - Change email (requires verification)

POST /account/connect/spotify   - Connect Spotify to existing account
POST /account/connect/lastfm    - Connect Last.fm
DELETE /account/connect/spotify - Disconnect Spotify
DELETE /account/connect/lastfm  - Disconnect Last.fm
```

### Auth Middleware Updates

```typescript
// middleware/require-auth.ts
export const requireAuth = createMiddleware(async (c, next) => {
  if (!c.get('isAuthenticated')) {
    // For pages, redirect to login
    if (c.req.header('Accept')?.includes('text/html')) {
      return c.redirect('/login?next=' + encodeURIComponent(c.req.path));
    }
    // For API, return 401
    return c.json({ error: 'Authentication required' }, 401);
  }
  await next();
});

// middleware/require-owner.ts (for user-specific resources)
export const requireOwner = (paramName: string = 'username') =>
  createMiddleware(async (c, next) => {
    const currentUser = c.get('currentUser');
    const requestedUsername = c.req.param(paramName);

    if (!currentUser || currentUser.username !== requestedUsername) {
      return c.json({ error: 'Not authorized' }, 403);
    }
    await next();
  });
```

### Internal API Updates

The internal APIs (`/api/internal/*`) should also check authentication for user-specific data:

```typescript
// Example: User recommendations should only be viewable by owner if profile is private
app.get('/user-recommendations', async (c) => {
  const username = c.req.query('username');
  const currentUser = c.get('currentUser');
  const targetUser = await db.getUserByUsername(username);

  if (!targetUser) {
    return c.json({ error: 'User not found' }, 404);
  }

  // Check privacy
  if (targetUser.profile_visibility === 'private') {
    if (!currentUser || currentUser.id !== targetUser.id) {
      return c.json({ error: 'This profile is private' }, 403);
    }
  }

  // ... continue with recommendations
});
```

---

## UI/UX Changes

### Navigation Updates

**Current Navigation:**
```
[Brand] [Albums] [Artists] [Stats] [Discord] [About] [Theme Toggle]
```

**Logged Out:**
```
[Brand] [Albums] [Artists] [Discover] [About] [Sign In] [Theme Toggle]
```

**Logged In:**
```
[Brand] [Albums] [Artists] [Discover] [About] [Avatar/Username ▼] [Theme Toggle]
                                              └─ My Profile
                                              └─ My Stats
                                              └─ Settings
                                              └─ Sign Out
```

### New Pages

#### `/login` - Login Page

```
┌─────────────────────────────────────────────────┐
│                  Sign In                        │
│                                                 │
│  ┌──────────────────────────────────────────┐  │
│  │  🎵 Continue with Spotify                │  │
│  └──────────────────────────────────────────┘  │
│                                                 │
│  ─────────────── or ────────────────           │
│                                                 │
│  Email                                          │
│  ┌──────────────────────────────────────────┐  │
│  │ you@example.com                          │  │
│  └──────────────────────────────────────────┘  │
│                                                 │
│  Password                                       │
│  ┌──────────────────────────────────────────┐  │
│  │ ••••••••                                 │  │
│  └──────────────────────────────────────────┘  │
│                                                 │
│  [Sign In]              Forgot password?        │
│                                                 │
│  Don't have an account? Sign up                 │
└─────────────────────────────────────────────────┘
```

#### `/register` - Registration Page

```
┌─────────────────────────────────────────────────┐
│               Create Account                    │
│                                                 │
│  ┌──────────────────────────────────────────┐  │
│  │  🎵 Sign up with Spotify                 │  │
│  └──────────────────────────────────────────┘  │
│                                                 │
│  ─────────────── or ────────────────           │
│                                                 │
│  Username (for your profile URL)                │
│  ┌──────────────────────────────────────────┐  │
│  │ musicfan                                 │  │
│  └──────────────────────────────────────────┘  │
│  listentomore.com/u/musicfan                   │
│                                                 │
│  Email                                          │
│  ┌──────────────────────────────────────────┐  │
│  │ you@example.com                          │  │
│  └──────────────────────────────────────────┘  │
│                                                 │
│  Password                                       │
│  ┌──────────────────────────────────────────┐  │
│  │ ••••••••                                 │  │
│  └──────────────────────────────────────────┘  │
│  8+ characters                                  │
│                                                 │
│  [Create Account]                               │
│                                                 │
│  Already have an account? Sign in               │
└─────────────────────────────────────────────────┘
```

#### `/account` - Account Settings (replaces `/stats`)

```
┌─────────────────────────────────────────────────┐
│  Account Settings                               │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │  Profile                                │   │
│  │  Connected Services                     │   │
│  │  Privacy                                │   │
│  │  Security                               │   │
│  │  Danger Zone                            │   │
│  └─────────────────────────────────────────┘   │
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
│  CONNECTED SERVICES                             │
│                                                 │
│  🎵 Spotify        Connected as @bordesak      │
│                    [Disconnect]                 │
│                                                 │
│  📻 Last.fm        Connected as @bordesak      │
│                    [Disconnect]                 │
│                                                 │
│  💿 Discogs        Not connected               │
│                    [Connect]                    │
│                                                 │
│  ═══════════════════════════════════════════   │
│                                                 │
│  PRIVACY                                        │
│                                                 │
│  Profile Visibility                             │
│  ○ Public - Anyone can see your profile        │
│  ○ Unlisted - Only people with the link        │
│  ○ Private - Only you can see your profile     │
│                                                 │
│  ═══════════════════════════════════════════   │
│                                                 │
│  SECURITY                                       │
│                                                 │
│  Password                                       │
│  Last changed: Never                            │
│  [Change Password]                              │
│                                                 │
│  Active Sessions                                │
│  Chrome on macOS (current)  [This device]      │
│  Safari on iPhone           [Revoke]           │
│                                                 │
│  ═══════════════════════════════════════════   │
│                                                 │
│  DANGER ZONE                                    │
│                                                 │
│  [Delete Account]                               │
│  This will permanently delete your account      │
│  and all associated data.                       │
│                                                 │
└─────────────────────────────────────────────────┘
```

#### `/u/{username}` - Public Profile (Updated)

For logged-in user viewing their own profile, add edit button:

```
┌─────────────────────────────────────────────────┐
│  [Avatar]  Rian (@bordesak)           [Edit]   │
│            "Music lover from Cape Town"         │
│                                                 │
│  ───────────────────────────────────────────   │
│                                                 │
│  Now Playing                                    │
│  [Track info...]                                │
│                                                 │
│  Top Artists (7 Days)                           │
│  [Grid of artists...]                           │
│                                                 │
│  Top Albums (30 Days)                           │
│  [Grid of albums...]                            │
│                                                 │
└─────────────────────────────────────────────────┘
```

For private profiles viewed by non-owners:

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

### Remove `/stats` Entry Page

The current `/stats` page allows anyone to enter any Last.fm username. This should be:

1. **Removed** as a public entry point
2. **Replaced** with a "My Stats" link for logged-in users
3. **Legacy URLs** (`/u/{username}`) still work for public/unlisted profiles

Users should no longer be able to look up arbitrary Last.fm usernames - they should connect their own Last.fm account.

**Alternative:** Keep the stats lookup but require login to use it. This prevents scraping while still allowing discovery.

---

## Profile Privacy Controls

### Visibility Levels

| Level | Description | Who Can View |
|-------|-------------|--------------|
| `public` | Fully public | Anyone on the internet |
| `unlisted` | Hidden from search | Anyone with direct link |
| `private` | Completely private | Only the account owner |

### Implementation

```typescript
// Check visibility in route handlers
async function canViewProfile(targetUser: User, currentUser: User | null): boolean {
  switch (targetUser.profile_visibility) {
    case 'public':
      return true;
    case 'unlisted':
      return true;  // Anyone with the link can view
    case 'private':
      return currentUser?.id === targetUser.id;
    default:
      return false;
  }
}

// In profile route
app.get('/u/:username', async (c) => {
  const targetUser = await db.getUserByUsername(c.req.param('username'));
  const currentUser = c.get('currentUser');

  if (!targetUser) {
    return c.html(<NotFoundPage />);
  }

  if (!await canViewProfile(targetUser, currentUser)) {
    return c.html(<PrivateProfilePage />);
  }

  // Render normal profile
  return c.html(<ProfilePage user={targetUser} isOwner={currentUser?.id === targetUser.id} />);
});
```

### What's Hidden on Private Profiles

- Listening stats (recent tracks, top artists, top albums)
- Recommendations
- Connected services
- Bio and display name

### What's Always Visible

- Username (for shareable URLs)
- That the account exists (vs. 404)

---

## Migration Strategy

### Existing Users

The database has 6 existing users created manually. These need to be migrated:

```sql
-- Mark existing users as verified (grandfathered in)
UPDATE users SET
  email_verified = 1,
  auth_provider = 'legacy',
  profile_visibility = 'public'
WHERE created_at < '2025-01-01';
```

For these users to log in, they'll need to:
1. Use "Forgot Password" flow to set a password, OR
2. Use "Connect with Spotify" to link their account

### Data Migration Script

```typescript
// scripts/migrate-users.ts
async function migrateExistingUsers(db: Database) {
  const users = await db.getAllUsers();

  for (const user of users) {
    // If they have lastfm_username, use it as default display_name
    const displayName = user.lastfm_username || user.username;

    await db.updateUser(user.id, {
      display_name: displayName,
      auth_provider: 'legacy',
      email_verified: 1,  // Trust existing users
      profile_visibility: 'public',  // Default to current behavior
    });
  }
}
```

### Claiming Usernames

Since usernames are already in the database, new registrations must check availability:

```typescript
async function isUsernameAvailable(username: string, db: Database): Promise<boolean> {
  // Case-insensitive check
  const existing = await db.getUserByUsername(username);
  return !existing;
}
```

For existing users with Last.fm usernames who haven't "claimed" their account, we may need a verification flow (e.g., "Prove you own this Last.fm account").

---

## Implementation Phases

### Phase 1: Foundation (Database + Core Auth)

**Duration: 1-2 sprints**

1. Create database migrations (005, 006, 007)
2. Implement password hashing utilities
3. Implement session management utilities
4. Add session middleware
5. Update `Variables` and `User` types
6. Add `currentUser` to all route contexts

**Deliverables:**
- Database schema ready for auth
- Session utilities working
- All existing pages continue to work (no breaking changes)

### Phase 2: OAuth Authentication

**Duration: 1 sprint**

1. Implement Spotify OAuth flow
2. Create `/auth/oauth/spotify` and callback routes
3. Implement OAuth token storage and encryption
4. Add "Sign in with Spotify" button
5. Handle user creation for new OAuth users
6. Handle account linking for existing users

**Deliverables:**
- Users can sign in with Spotify
- New users created on first OAuth login
- Existing users can link Spotify

### Phase 3: Email/Password Authentication

**Duration: 1 sprint**

1. Implement registration flow
2. Implement login flow
3. Add email verification (optional initially)
4. Add password reset flow
5. Create login/register pages

**Deliverables:**
- Users can register with email/password
- Users can log in with email/password
- Password reset works

### Phase 4: Account Management UI

**Duration: 1-2 sprints**

1. Create account settings page
2. Implement profile editing
3. Implement privacy controls
4. Implement connected services management
5. Implement session management UI
6. Add account deletion flow

**Deliverables:**
- Full account settings page
- Users can manage their profile
- Users can control privacy
- Users can delete their account

### Phase 5: Navigation & UX Updates

**Duration: 1 sprint**

1. Update navigation for logged in/out states
2. Add user dropdown menu
3. Remove `/stats` public entry (or gate behind auth)
4. Add "Edit" buttons on own profile
5. Implement private profile view
6. Polish and responsive design

**Deliverables:**
- Navigation shows auth state
- Clean UX for all auth states
- Private profiles work correctly

### Phase 6: Security Hardening

**Duration: 1 sprint**

1. Add CSRF protection to all forms
2. Add rate limiting to auth endpoints
3. Implement audit logging
4. Add session activity monitoring
5. Security review and testing
6. Documentation

**Deliverables:**
- All security measures in place
- Rate limiting working
- Audit log capturing events
- Security documentation

---

## Environment Variables

New secrets needed:

| Variable | Purpose |
|----------|---------|
| `SESSION_SECRET` | Sign session tokens |
| `OAUTH_ENCRYPTION_KEY` | Encrypt OAuth tokens in DB |
| `SPOTIFY_OAUTH_CLIENT_ID` | Spotify OAuth (different from API) |
| `SPOTIFY_OAUTH_CLIENT_SECRET` | Spotify OAuth secret |
| `RESEND_API_KEY` | Email sending (for verification, reset) |

---

## Open Questions

1. **Username reservation**: Should we reserve common usernames (admin, api, etc.)?
2. **Email requirement**: Is email required, or optional for OAuth users?
3. **Last.fm OAuth**: Does Last.fm support OAuth, or only API keys?
4. **Discogs OAuth**: Should we support Discogs OAuth for collection sync?
5. **Email provider**: Use Resend, SendGrid, or Cloudflare Email Workers?
6. **Profile URL format**: Keep `/u/{username}` or change to `/@{username}`?
7. **Data portability**: Should users be able to export their data?
8. **Existing users**: How to handle the 6 existing manual users?

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Password breach | High | Use strong hashing, rate limit, audit logging |
| OAuth token theft | High | Encrypt tokens, use short-lived access tokens |
| Session hijacking | High | HttpOnly cookies, secure flag, short TTL option |
| Account takeover | High | Email verification, password strength requirements |
| CSRF attacks | Medium | CSRF tokens on all state-changing forms |
| Username squatting | Low | Rate limit registration, email verification |
| GDPR compliance | Medium | Account deletion, data export |

---

## Success Metrics

- **Registration conversion**: % of visitors who complete registration
- **Login success rate**: % of login attempts that succeed
- **OAuth adoption**: % of users using OAuth vs. email/password
- **Session retention**: Average session length
- **Account deletion rate**: % of users who delete accounts (lower is better)
- **Support tickets**: Auth-related issues reported

---

## Conclusion

This plan outlines a comprehensive approach to adding user authentication to ListenToMore. The phased implementation allows for incremental delivery while maintaining backwards compatibility. The focus on OAuth (especially Spotify) reduces password management burden while providing a seamless user experience for a music-focused application.

Key decisions to make before implementation:
1. Primary OAuth provider priority (Spotify recommended)
2. Whether to require email verification
3. How to handle existing manual users
4. Whether to keep public Last.fm lookup feature
