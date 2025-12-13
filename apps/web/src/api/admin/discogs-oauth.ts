// Discogs OAuth routes
// Handles the OAuth 1.0a flow for connecting Discogs accounts

import { Hono } from 'hono';
import type { Bindings, Variables } from '../../types';
import {
  DiscogsOAuthService,
  DiscogsService,
  encryptToken,
} from '@listentomore/discogs';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/**
 * Run initial enrichment batches in background
 * Limited to 1 batch due to Cloudflare Workers 30-second CPU time limit
 * Remaining enrichment continues via cron or manual trigger
 */
async function runInitialEnrichment(
  discogs: DiscogsService,
  userId: string
): Promise<void> {
  // Only process 1 batch in waitUntil due to Workers CPU time limits
  // Each batch takes ~55 seconds (50 releases * 1.1s rate limit delay)
  // Remaining batches will be processed by cron or manual trigger
  const result = await discogs.enrichBatch(userId);

  if (!result) {
    console.log(`[Discogs Enrichment] No enrichment service available`);
    return;
  }

  console.log(
    `[Discogs Enrichment] Initial batch: processed ${result.processed}, remaining ${result.remaining}, errors ${result.errors}`
  );

  if (result.remaining > 0) {
    console.log(
      `[Discogs Enrichment] ${result.remaining} releases remaining - will continue via cron or manual trigger`
    );
  } else {
    console.log(`[Discogs Enrichment] Complete for user ${userId}`);
  }
}

// GET /api/auth/discogs/signup - Sign up via Discogs OAuth (creates new user)
app.get('/signup', async (c) => {
  const consumerKey = c.env.DISCOGS_OAUTH_CONSUMER_KEY;
  const consumerSecret = c.env.DISCOGS_OAUTH_CONSUMER_SECRET;

  if (!consumerKey || !consumerSecret) {
    console.error('Discogs OAuth credentials not configured');
    return c.redirect('/account?error=oauth_not_configured');
  }

  try {
    const oauthService = new DiscogsOAuthService({
      consumerKey,
      consumerSecret,
    });

    // Determine callback URL based on request
    const url = new URL(c.req.url);
    const isLocalDev = !c.env.ENVIRONMENT || c.env.ENVIRONMENT !== 'production';
    const isLocalhostUrl = url.hostname === 'localhost' || url.hostname === '127.0.0.1';

    let callbackUrl: string;
    if (isLocalDev || isLocalhostUrl) {
      const port = url.port || '8788';
      callbackUrl = `http://localhost:${port}/api/auth/discogs/callback`;
    } else {
      callbackUrl = `https://listentomore.com/api/auth/discogs/callback`;
    }

    console.log('[Discogs OAuth Signup] callbackUrl:', callbackUrl);

    const { token, secret } = await oauthService.getRequestToken(callbackUrl);

    // Store request token with isSignup flag
    await c.env.CACHE.put(
      `discogs:oauth:request:${token}`,
      JSON.stringify({ secret, isSignup: true }),
      { expirationTtl: 600 } // 10 minutes
    );

    // Redirect user to Discogs authorization page
    const authUrl = oauthService.getAuthorizationUrl(token);
    return c.redirect(authUrl);
  } catch (error) {
    console.error('Failed to initiate Discogs OAuth signup:', error);
    return c.redirect('/account?error=oauth_failed');
  }
});

// GET /api/auth/discogs/connect - Initiate OAuth flow (for existing users)
app.get('/connect', async (c) => {
  // Get username from query parameter
  const username = c.req.query('username');

  if (!username) {
    return c.redirect('/?error=missing_username');
  }

  const db = c.get('db');
  const user = await db.getUserByUsername(username);

  if (!user) {
    return c.redirect(`/?error=user_not_found&username=${username}`);
  }

  const consumerKey = c.env.DISCOGS_OAUTH_CONSUMER_KEY;
  const consumerSecret = c.env.DISCOGS_OAUTH_CONSUMER_SECRET;

  if (!consumerKey || !consumerSecret) {
    console.error('Discogs OAuth credentials not configured');
    return c.redirect('/?error=oauth_not_configured');
  }

  try {
    const oauthService = new DiscogsOAuthService({
      consumerKey,
      consumerSecret,
    });

    // Determine callback URL based on request
    // Wrangler dev mode sets Host to production domain due to routes config,
    // so we check the actual URL and ENVIRONMENT to detect local dev
    const url = new URL(c.req.url);
    const isLocalDev = !c.env.ENVIRONMENT || c.env.ENVIRONMENT !== 'production';
    const isLocalhostUrl = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    
    let callbackUrl: string;
    if (isLocalDev || isLocalhostUrl) {
      // Local development - use localhost
      const port = url.port || '8788';
      callbackUrl = `http://localhost:${port}/api/auth/discogs/callback`;
    } else {
      // Production
      callbackUrl = `https://listentomore.com/api/auth/discogs/callback`;
    }

    console.log('[Discogs OAuth] isLocalDev:', isLocalDev, 'callbackUrl:', callbackUrl);

    const { token, secret } = await oauthService.getRequestToken(callbackUrl);

    // Store request token temporarily in KV (we need the secret for the callback)
    await c.env.CACHE.put(
      `discogs:oauth:request:${token}`,
      JSON.stringify({ secret, userId: user.id, username: user.username }),
      { expirationTtl: 600 } // 10 minutes
    );

    // Redirect user to Discogs authorization page
    const authUrl = oauthService.getAuthorizationUrl(token);
    return c.redirect(authUrl);
  } catch (error) {
    console.error('Failed to initiate Discogs OAuth:', error);
    return c.redirect('/?error=oauth_failed');
  }
});

// GET /api/auth/discogs/callback - Handle OAuth callback from Discogs
app.get('/callback', async (c) => {
  const token = c.req.query('oauth_token');
  const verifier = c.req.query('oauth_verifier');
  const denied = c.req.query('denied');

  // User cancelled authorization
  if (denied || !token || !verifier) {
    return c.redirect('/account?error=oauth_cancelled');
  }

  // Retrieve the stored request token data
  const requestDataJson = await c.env.CACHE.get(`discogs:oauth:request:${token}`);
  if (!requestDataJson) {
    return c.redirect('/account?error=discogs_auth_expired');
  }

  const requestData = JSON.parse(requestDataJson) as {
    secret: string;
    isSignup?: boolean;
    userId?: string;
    username?: string;
  };

  const consumerKey = c.env.DISCOGS_OAUTH_CONSUMER_KEY;
  const consumerSecret = c.env.DISCOGS_OAUTH_CONSUMER_SECRET;
  const encryptionKey = c.env.OAUTH_ENCRYPTION_KEY;

  if (!consumerKey || !consumerSecret || !encryptionKey) {
    console.error('Discogs OAuth credentials or encryption key not configured');
    return c.redirect('/account?error=oauth_not_configured');
  }

  try {
    const oauthService = new DiscogsOAuthService({
      consumerKey,
      consumerSecret,
    });

    // Exchange request token for access token
    const { token: accessToken, secret: accessSecret } = await oauthService.getAccessToken(
      token,
      requestData.secret,
      verifier
    );

    // Create a Discogs service with the new access token to get user identity
    const discogsService = new DiscogsService({
      accessToken,
      accessTokenSecret: accessSecret,
      consumerKey,
      consumerSecret,
      cache: c.env.CACHE,
    });

    const identity = await discogsService.collection.getIdentity();

    // Encrypt tokens before storing
    const encryptedAccessToken = await encryptToken(accessToken, encryptionKey);
    const encryptedAccessSecret = await encryptToken(accessSecret, encryptionKey);

    const db = c.get('db');
    let userId: string;
    let username: string;

    // Handle signup flow - create new user
    if (requestData.isSignup) {
      // Check if username is available
      const isAvailable = await db.isUsernameAvailable(identity.username);
      if (!isAvailable) {
        console.log(`[Discogs Signup] Username ${identity.username} already taken`);
        await c.env.CACHE.delete(`discogs:oauth:request:${token}`);
        return c.redirect('/account?error=username_taken');
      }

      // Create new user with Discogs username
      console.log(`[Discogs Signup] Creating new user: ${identity.username}`);
      const newUser = await db.createUser({
        username: identity.username,
        discogs_username: identity.username,
      });

      userId = newUser.id;
      username = newUser.username;
      console.log(`[Discogs Signup] Created user ${username} with ID ${userId}`);
    } else {
      // Existing connect flow
      if (!requestData.userId || !requestData.username) {
        console.error('Missing userId or username in connect flow');
        return c.redirect('/account?error=invalid_state');
      }
      userId = requestData.userId;
      username = requestData.username;

      // Update user's discogs_username
      await db.updateUser(userId, {
        discogs_username: identity.username,
      });
    }

    // Store OAuth tokens in database
    await db.storeOAuthToken({
      userId,
      provider: 'discogs',
      accessToken: encryptedAccessToken,
      refreshToken: encryptedAccessSecret, // OAuth 1.0a uses token secret instead of refresh token
      tokenType: 'OAuth1',
      providerUserId: identity.id.toString(),
      providerUsername: identity.username,
    });

    // Clean up temporary request token
    await c.env.CACHE.delete(`discogs:oauth:request:${token}`);

    // Trigger initial collection sync in background
    const ctx = c.executionCtx;
    ctx.waitUntil(
      (async () => {
        try {
          console.log(`[Discogs] Starting initial sync for user ${userId}`);
          const result = await discogsService.syncCollection(userId, identity.username);
          console.log(`[Discogs] Initial sync complete: ${result.releaseCount} releases`);

          // Set last sync timestamp
          await c.env.CACHE.put(
            `discogs:last-sync:${userId}`,
            Date.now().toString(),
            { expirationTtl: 86400 }
          );

          // Queue background enrichment
          if (c.env.DISCOGS_QUEUE) {
            console.log(`[Discogs] Queuing background enrichment for user ${userId}`);
            await c.env.DISCOGS_QUEUE.send({
              type: 'enrich-collection',
              userId,
              discogsUsername: identity.username,
            });
          } else {
            console.log(`[Discogs] Queue not available, running inline enrichment`);
            await runInitialEnrichment(discogsService, userId);
          }
        } catch (error) {
          console.error(`[Discogs] Initial sync failed for user ${userId}:`, error);
        }
      })()
    );

    // Redirect to user's page
    if (requestData.isSignup) {
      // New user - redirect to their stats page with welcome message
      return c.redirect(`/u/${username}?welcome=true`);
    } else {
      // Existing user - redirect to Discogs page
      return c.redirect(`/u/${username}/discogs?success=discogs_connected`);
    }
  } catch (error) {
    console.error('Failed to complete Discogs OAuth:', error);
    return c.redirect('/account?error=oauth_failed');
  }
});

// POST /api/auth/discogs/disconnect - Disconnect Discogs account
app.post('/disconnect', async (c) => {
  const username = c.req.query('username');

  if (!username) {
    return c.json({ error: 'Missing username' }, 400);
  }

  const db = c.get('db');
  const user = await db.getUserByUsername(username);

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  try {
    // Delete OAuth token from database
    await db.deleteOAuthToken(user.id, 'discogs');

    // Clear discogs_username from user
    await db.updateUser(user.id, { discogs_username: null });

    // Clear cached collection
    await c.env.CACHE.delete(`discogs:collection:${user.id}`);

    return c.json({ success: true, message: 'Discogs account disconnected' });
  } catch (error) {
    console.error('Failed to disconnect Discogs:', error);
    return c.json({ error: 'Failed to disconnect Discogs account' }, 500);
  }
});

// GET /api/auth/discogs/status - Check Discogs connection status
app.get('/status', async (c) => {
  const username = c.req.query('username');

  if (!username) {
    return c.json({ connected: false, error: 'Missing username' });
  }

  const db = c.get('db');
  const user = await db.getUserByUsername(username);

  if (!user) {
    return c.json({ connected: false, error: 'User not found' });
  }

  const oauthToken = await db.getOAuthToken(user.id, 'discogs');

  return c.json({
    connected: !!oauthToken,
    username: user.discogs_username,
    providerUsername: oauthToken?.provider_username,
  });
});

export const discogsOAuthRoutes = app;
