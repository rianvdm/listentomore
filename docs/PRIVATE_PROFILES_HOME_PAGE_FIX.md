# Private Profiles: Home Page Fix Plan

## Problem

Private profiles currently appear in the "What users are listening to" section on the home page. Users who set their profile to private expect their listening activity to be hidden from public view.

## Root Cause

The CRON job that pre-warms the user listens cache fetches **all users** with a Last.fm username, without filtering by `profile_visibility`:

**File:** `packages/db/src/index.ts` (line 39-44)
```typescript
async getAllUsersWithLastfm(): Promise<User[]> {
  const result = await this.db
    .prepare('SELECT * FROM users WHERE lastfm_username IS NOT NULL')
    .all<User>();
  return result.results;
}
```

**Called from:** `apps/web/src/index.tsx` (line 566)
```typescript
const users = await db.getAllUsersWithLastfm();
```

## Solution

### Option A: Filter at Database Level (Recommended)

Create a new database method that only returns public users:

**File:** `packages/db/src/index.ts`

Add new method:
```typescript
async getPublicUsersWithLastfm(): Promise<User[]> {
  const result = await this.db
    .prepare(
      `SELECT * FROM users 
       WHERE lastfm_username IS NOT NULL 
       AND profile_visibility = 'public'`
    )
    .all<User>();
  return result.results;
}
```

**File:** `apps/web/src/index.tsx`

Update CRON job (around line 566):
```typescript
// Before
const users = await db.getAllUsersWithLastfm();

// After
const users = await db.getPublicUsersWithLastfm();
```

### Option B: Filter at Application Level

Keep the existing query but filter in the CRON job:

**File:** `apps/web/src/index.tsx`

Update CRON job (around line 566):
```typescript
const allUsers = await db.getAllUsersWithLastfm();
const users = allUsers.filter(u => u.profile_visibility === 'public');
```

## Recommendation

**Option A** is preferred because:
1. More efficient - filters at database level, reducing data transfer
2. Cleaner separation of concerns
3. Reusable method for other features that need public users only

## Implementation Steps

1. [ ] Add `getPublicUsersWithLastfm()` method to `packages/db/src/index.ts`
2. [ ] Update CRON job in `apps/web/src/index.tsx` to use new method
3. [ ] Test locally with a mix of public/private profiles
4. [ ] Deploy and verify private profiles no longer appear on home page

## Testing

1. Create or update a test user with `profile_visibility = 'private'`
2. Run the CRON job locally or wait for next scheduled run
3. Verify the private user does NOT appear in the "What users are listening to" section
4. Verify public users still appear correctly

## Files to Modify

| File | Change |
|------|--------|
| `packages/db/src/index.ts` | Add `getPublicUsersWithLastfm()` method |
| `apps/web/src/index.tsx` | Update CRON to call new method |

## Estimated Effort

~15 minutes implementation + testing
