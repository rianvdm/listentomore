// Session management utilities for cookie-based authentication

import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Database, User } from '@listentomore/db';

const SESSION_COOKIE = 'ltm_session';
const SESSION_DURATION = 30 * 24 * 60 * 60; // 30 days in seconds

/**
 * Hash a token using SHA-256
 */
async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Create a new session for a user and set the session cookie
 */
export async function createSession(
  c: Context,
  userId: string,
  db: Database
): Promise<void> {
  const token = crypto.randomUUID();
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DURATION * 1000).toISOString();

  await db.createSession({
    id: crypto.randomUUID(),
    user_id: userId,
    token_hash: tokenHash,
    user_agent: c.req.header('User-Agent') || null,
    ip_address: c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || null,
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

/**
 * Validate the session cookie and return the user if valid
 */
export async function validateSession(
  c: Context,
  db: Database
): Promise<User | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;

  const tokenHash = await hashToken(token);
  const session = await db.getSessionByToken(tokenHash);

  if (!session) {
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return null;
  }

  // Check if session is expired
  if (new Date(session.expires_at) < new Date()) {
    await db.deleteSession(session.id);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return null;
  }

  // Update last_active_at (fire and forget)
  db.updateSessionActivity(session.id);

  return db.getUser(session.user_id);
}

/**
 * Destroy the current session and clear the cookie
 */
export async function destroySession(
  c: Context,
  db: Database
): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const tokenHash = await hashToken(token);
    await db.deleteSessionByToken(tokenHash);
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}
