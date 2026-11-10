// Last.fm authentication handlers
// Implements Last.fm Web Authentication flow

import type { Context } from 'hono';
import type { Database } from '@listentomore/db';
import type { Bindings, Variables } from '../../types';
import { lastfmSignature } from '../../utils/md5';
import { readRef } from '../../utils/referral';
import { createSession } from '../../utils/session';

const LASTFM_AUTH_URL = 'https://www.last.fm/api/auth/';
const LASTFM_API_URL = 'https://ws.audioscrobbler.com/2.0/';

const SITE_ORIGIN = 'https://listentomore.com';

// ASCII control characters. URL parsers strip tabs and newlines, so '/\t/evil.example' would become '//evil.example'.
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

/**
 * Validate that a redirect target is a safe relative path on this origin.
 * Rejects absolute and protocol-relative URLs, backslashes (browsers read '/\evil.example'
 * as '//evil.example') and control characters, then confirms the path resolves to this origin.
 */
export function isSafeRedirect(url: string): boolean {
  if (!url.startsWith('/') || url.startsWith('//')) return false;
  if (url.includes('\\') || CONTROL_CHARS.test(url)) return false;
  try {
    return new URL(url, SITE_ORIGIN).origin === SITE_ORIGIN;
  } catch {
    return false;
  }
}

/**
 * Step 1: Redirect to Last.fm for authorization
 * GET /auth/lastfm
 */
export function handleLastfmAuth(c: Context<{ Bindings: Bindings; Variables: Variables }>) {
  const apiKey = c.env.LASTFM_API_KEY;

  if (!c.env.LASTFM_SHARED_SECRET) {
    console.error('LASTFM_SHARED_SECRET not configured');
    return c.redirect('/login?error=no_secret');
  }

  // Preserve 'next' and 'ref' through the OAuth flow on the callback URL.
  // Only a safe relative 'next' and a known 'ref' are forwarded.
  const callbackParams = new URLSearchParams();
  const next = c.req.query('next');
  if (next && isSafeRedirect(next)) callbackParams.set('next', next);
  const ref = readRef(c.req.queries('ref'));
  if (ref) callbackParams.set('ref', ref);

  const callbackQuery = callbackParams.toString();
  const callbackUrl = `${new URL(c.req.url).origin}/auth/lastfm/callback${callbackQuery ? `?${callbackQuery}` : ''}`;
  const authParams = new URLSearchParams({ api_key: apiKey, cb: callbackUrl });

  return c.redirect(`${LASTFM_AUTH_URL}?${authParams}`);
}

/**
 * Step 2: Handle callback from Last.fm
 * GET /auth/lastfm/callback
 */
export async function handleLastfmCallback(c: Context<{ Bindings: Bindings; Variables: Variables }>) {
  const token = c.req.query('token');
  // Validate next is a safe relative path to prevent open redirect.
  const nextRaw = c.req.query('next') || '/';
  const next = isSafeRedirect(nextRaw) ? nextRaw : '/';
  const signupRef = readRef(c.req.queries('ref'));

  if (!token) {
    return c.redirect('/login?error=no_token');
  }

  const apiKey = c.env.LASTFM_API_KEY;
  const sharedSecret = c.env.LASTFM_SHARED_SECRET;

  if (!sharedSecret) {
    console.error('LASTFM_SHARED_SECRET not configured');
    return c.redirect('/login?error=no_secret');
  }

  // Step 3: Exchange token for session key
  const params = {
    api_key: apiKey,
    method: 'auth.getSession',
    token: token,
  };

  const sig = lastfmSignature(params, sharedSecret);

  const response = await fetch(
    `${LASTFM_API_URL}?method=auth.getSession&api_key=${apiKey}&token=${token}&api_sig=${sig}&format=json`
  );

  if (!response.ok) {
    console.error('Last.fm auth.getSession failed:', response.status);
    return c.redirect('/login?error=auth_failed');
  }

  const data = await response.json() as {
    session?: { name: string; key: string };
    error?: number;
    message?: string;
  };

  if (data.error || !data.session) {
    console.error('Last.fm auth error:', data.message || 'Unknown error');
    return c.redirect('/login?error=auth_failed');
  }

  const { name: lastfmUsername, key: sessionKey } = data.session;

  // Step 4: Create or update user
  const db = c.get('db') as Database;
  let user = await db.getUserByLastfmUsername(lastfmUsername);

  if (!user) {
    // New user - create account
    // Use lowercase lastfm username as the username for URL consistency
    const username = lastfmUsername.toLowerCase();

    // Fetch user info from Last.fm for avatar
    let avatarUrl: string | null = null;
    try {
      const userInfoResponse = await fetch(
        `${LASTFM_API_URL}?method=user.getinfo&user=${encodeURIComponent(lastfmUsername)}&api_key=${apiKey}&format=json`
      );
      if (userInfoResponse.ok) {
        const userInfo = await userInfoResponse.json() as {
          user?: { image?: Array<{ '#text': string; size: string }> };
        };
        // Get the largest image
        const images = userInfo.user?.image || [];
        const largeImage = images.find((img) => img.size === 'extralarge') || images[images.length - 1];
        if (largeImage && largeImage['#text']) {
          avatarUrl = largeImage['#text'];
        }
      }
    } catch (error) {
      console.error('Failed to fetch Last.fm user info:', error);
    }

    user = await db.createUser({
      id: crypto.randomUUID(),
      username,
      lastfm_username: lastfmUsername,
      lastfm_session_key: sessionKey,
      display_name: lastfmUsername,
      avatar_url: avatarUrl || undefined,
      profile_visibility: 'public',
      signup_ref: signupRef ?? undefined,
    });

    console.log(`Created new user: ${username} (Last.fm: ${lastfmUsername})`);

    // Send Discord notification for new signups.
    // Use ctx.waitUntil() so the fetch is not dropped when the response is sent.
    if (c.env.DISCORD_WEBHOOK_URL) {
      const webhookPayload = {
        content: signupRef
          ? `🎉 New signup: **${username}** (via ${signupRef}) — https://listentomore.com/u/${username}`
          : `🎉 New signup: **${username}** — https://listentomore.com/u/${username}`,
      };
      console.log('[DISCORD_WEBHOOK] Sending new signup notification', {
        username,
        lastfm_username: lastfmUsername,
        webhook_url: c.env.DISCORD_WEBHOOK_URL.substring(0, 50) + '...',
        payload: webhookPayload,
      });

      c.executionCtx.waitUntil(
        fetch(c.env.DISCORD_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(webhookPayload),
        })
          .then(res => {
            if (res.ok) {
              console.log('[DISCORD_WEBHOOK] New signup notification sent successfully', {
                username,
                status: res.status,
              });
            } else {
              console.error('[DISCORD_WEBHOOK] New signup notification failed', {
                username,
                status: res.status,
                statusText: res.statusText,
              });
            }
          })
          .catch(err => {
            console.error('[DISCORD_WEBHOOK] New signup notification error', {
              username,
              error: err instanceof Error ? err.message : String(err),
            });
          })
      );
    } else {
      console.log('[DISCORD_WEBHOOK] DISCORD_WEBHOOK_URL not configured, skipping new signup notification');
    }
  } else {
    // Returning user - update session key, login time, and refresh avatar if missing
    const updateData: Record<string, unknown> = {
      lastfm_session_key: sessionKey,
      last_login_at: new Date().toISOString(),
      login_count: (user.login_count || 0) + 1,
    };

    // Fetch avatar if not set
    if (!user.avatar_url) {
      try {
        const userInfoResponse = await fetch(
          `${LASTFM_API_URL}?method=user.getinfo&user=${encodeURIComponent(lastfmUsername)}&api_key=${apiKey}&format=json`
        );
        if (userInfoResponse.ok) {
          const userInfo = await userInfoResponse.json() as {
            user?: { image?: Array<{ '#text': string; size: string }> };
          };
          const images = userInfo.user?.image || [];
          const largeImage = images.find((img) => img.size === 'extralarge') || images[images.length - 1];
          if (largeImage && largeImage['#text']) {
            updateData.avatar_url = largeImage['#text'];
          }
        }
      } catch (error) {
        console.error('Failed to fetch Last.fm user info:', error);
      }
    }

    // Set display_name if not set
    if (!user.display_name) {
      updateData.display_name = lastfmUsername;
    }

    await db.updateUser(user.id, updateData);

    console.log(`User logged in: ${user.username} (Last.fm: ${lastfmUsername})`);

    // Send Discord notification for first-time account claims (existing users).
    // Use ctx.waitUntil() so the fetch is not dropped when the response is sent.
    if ((user.login_count || 0) === 0 && c.env.DISCORD_WEBHOOK_URL) {
      const username = user.username; // Capture for async callbacks
      const webhookPayload = {
        content: `🔗 Account claimed: **${username}** — https://listentomore.com/u/${username}`
      };
      console.log('[DISCORD_WEBHOOK] Sending account claim notification', {
        username,
        lastfm_username: lastfmUsername,
        webhook_url: c.env.DISCORD_WEBHOOK_URL.substring(0, 50) + '...',
        payload: webhookPayload,
      });

      c.executionCtx.waitUntil(
        fetch(c.env.DISCORD_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(webhookPayload),
        })
          .then(res => {
            if (res.ok) {
              console.log('[DISCORD_WEBHOOK] Account claim notification sent successfully', {
                username,
                status: res.status,
              });
            } else {
              console.error('[DISCORD_WEBHOOK] Account claim notification failed', {
                username,
                status: res.status,
                statusText: res.statusText,
              });
            }
          })
          .catch(err => {
            console.error('[DISCORD_WEBHOOK] Account claim notification error', {
              username,
              error: err instanceof Error ? err.message : String(err),
            });
          })
      );
    }
  }

  // Step 5: Create app session
  await createSession(c, user.id, db);

  // Redirect to profile or the original destination
  // Use lastfm_username for profile URL (canonical identifier)
  const redirectUrl = next !== '/' ? next : `/u/${user.lastfm_username}`;
  return c.redirect(redirectUrl);
}

/**
 * Logout handler - destroys session and redirects to home
 * GET /auth/logout
 */
export async function handleLogout(c: Context<{ Bindings: Bindings; Variables: Variables }>) {
  const { destroySession } = await import('../../utils/session');
  const db = c.get('db') as Database;

  await destroySession(c, db);

  return c.redirect('/');
}
