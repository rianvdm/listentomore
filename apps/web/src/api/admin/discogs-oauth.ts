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

// GET /api/auth/discogs/connect - Initiate OAuth flow
app.get('/connect', async (c) => {
  // For now, we use the default user. In a full auth system, this would come from session.
  const db = c.get('db');
  const user = await db.getUser('default');

  if (!user) {
    return c.redirect('/?error=not_authenticated');
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
    // In local dev, use the Host header to get the correct origin
    const host = c.req.header('Host') || '';
    const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1');
    const protocol = isLocalhost ? 'http' : (c.req.header('X-Forwarded-Proto') || 'https');
    const origin = host ? `${protocol}://${host}` : new URL(c.req.url).origin;
    const callbackUrl = `${origin}/api/auth/discogs/callback`;

    const { token, secret } = await oauthService.getRequestToken(callbackUrl);

    // Store request token temporarily in KV (we need the secret for the callback)
    await c.env.CACHE.put(
      `discogs:oauth:request:${token}`,
      JSON.stringify({ secret, userId: user.id }),
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
    return c.redirect('/?error=discogs_auth_cancelled');
  }

  // Retrieve the stored request token data
  const requestDataJson = await c.env.CACHE.get(`discogs:oauth:request:${token}`);
  if (!requestDataJson) {
    return c.redirect('/?error=discogs_auth_expired');
  }

  const requestData = JSON.parse(requestDataJson) as { secret: string; userId: string };

  const consumerKey = c.env.DISCOGS_OAUTH_CONSUMER_KEY;
  const consumerSecret = c.env.DISCOGS_OAUTH_CONSUMER_SECRET;
  const encryptionKey = c.env.OAUTH_ENCRYPTION_KEY;

  if (!consumerKey || !consumerSecret || !encryptionKey) {
    console.error('Discogs OAuth credentials or encryption key not configured');
    return c.redirect('/?error=oauth_not_configured');
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

    // Store OAuth tokens in database
    const db = c.get('db');
    await db.storeOAuthToken({
      userId: requestData.userId,
      provider: 'discogs',
      accessToken: encryptedAccessToken,
      refreshToken: encryptedAccessSecret, // OAuth 1.0a uses token secret instead of refresh token
      tokenType: 'OAuth1',
      providerUserId: identity.id.toString(),
      providerUsername: identity.username,
    });

    // Update user's discogs_username
    await db.updateUser(requestData.userId, {
      discogs_username: identity.username,
    });

    // Clean up temporary request token
    await c.env.CACHE.delete(`discogs:oauth:request:${token}`);

    // Redirect to success page
    return c.redirect('/?success=discogs_connected');
  } catch (error) {
    console.error('Failed to complete Discogs OAuth:', error);
    return c.redirect('/?error=discogs_auth_failed');
  }
});

// POST /api/auth/discogs/disconnect - Disconnect Discogs account
app.post('/disconnect', async (c) => {
  // For now, we use the default user
  const db = c.get('db');
  const user = await db.getUser('default');

  if (!user) {
    return c.json({ error: 'Not authenticated' }, 401);
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
  const db = c.get('db');
  const user = await db.getUser('default');

  if (!user) {
    return c.json({ connected: false, error: 'Not authenticated' });
  }

  const oauthToken = await db.getOAuthToken(user.id, 'discogs');

  return c.json({
    connected: !!oauthToken,
    username: user.discogs_username,
    providerUsername: oauthToken?.provider_username,
  });
});

export const discogsOAuthRoutes = app;
