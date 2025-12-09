// Discogs OAuth 1.0a implementation using Web Crypto API
// Compatible with Cloudflare Workers (no Node.js crypto dependency)

const DISCOGS_REQUEST_TOKEN_URL = 'https://api.discogs.com/oauth/request_token';
const DISCOGS_ACCESS_TOKEN_URL = 'https://api.discogs.com/oauth/access_token';
const DISCOGS_AUTHORIZE_URL = 'https://www.discogs.com/oauth/authorize';
const USER_AGENT = 'ListenToMore/1.0 +https://listentomore.com';

export interface DiscogsOAuthConfig {
  consumerKey: string;
  consumerSecret: string;
}

export interface OAuthTokenPair {
  token: string;
  secret: string;
}

/**
 * Discogs OAuth 1.0a service
 * Implements the three-legged OAuth flow for Discogs
 */
export class DiscogsOAuthService {
  private consumerKey: string;
  private consumerSecret: string;

  constructor(config: DiscogsOAuthConfig) {
    this.consumerKey = config.consumerKey;
    this.consumerSecret = config.consumerSecret;
  }

  /**
   * Step 1: Get a request token from Discogs
   */
  async getRequestToken(callbackUrl: string): Promise<OAuthTokenPair> {
    const oauthParams = {
      oauth_consumer_key: this.consumerKey,
      oauth_nonce: this.generateNonce(),
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_version: '1.0',
      oauth_callback: callbackUrl,
    };

    const signature = await this.generateSignature(
      'POST',
      DISCOGS_REQUEST_TOKEN_URL,
      oauthParams,
      this.consumerSecret,
      '' // No token secret yet
    );

    const authHeader = this.buildAuthHeader({ ...oauthParams, oauth_signature: signature });

    const response = await fetch(DISCOGS_REQUEST_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to get request token: ${response.status} ${text}`);
    }

    const body = await response.text();
    const params = new URLSearchParams(body);

    const token = params.get('oauth_token');
    const secret = params.get('oauth_token_secret');

    if (!token || !secret) {
      throw new Error('Invalid response from Discogs: missing token or secret');
    }

    return { token, secret };
  }

  /**
   * Step 2: Get the authorization URL for the user to visit
   */
  getAuthorizationUrl(requestToken: string): string {
    return `${DISCOGS_AUTHORIZE_URL}?oauth_token=${encodeURIComponent(requestToken)}`;
  }

  /**
   * Step 3: Exchange request token + verifier for access token
   */
  async getAccessToken(
    requestToken: string,
    requestSecret: string,
    verifier: string
  ): Promise<OAuthTokenPair> {
    const oauthParams = {
      oauth_consumer_key: this.consumerKey,
      oauth_nonce: this.generateNonce(),
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_token: requestToken,
      oauth_verifier: verifier,
      oauth_version: '1.0',
    };

    const signature = await this.generateSignature(
      'POST',
      DISCOGS_ACCESS_TOKEN_URL,
      oauthParams,
      this.consumerSecret,
      requestSecret
    );

    const authHeader = this.buildAuthHeader({ ...oauthParams, oauth_signature: signature });

    const response = await fetch(DISCOGS_ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to get access token: ${response.status} ${text}`);
    }

    const body = await response.text();
    const params = new URLSearchParams(body);

    const token = params.get('oauth_token');
    const secret = params.get('oauth_token_secret');

    if (!token || !secret) {
      throw new Error('Invalid response from Discogs: missing access token or secret');
    }

    return { token, secret };
  }

  /**
   * Generate OAuth signature using HMAC-SHA1
   */
  private async generateSignature(
    method: string,
    url: string,
    params: Record<string, string>,
    consumerSecret: string,
    tokenSecret: string
  ): Promise<string> {
    // Sort parameters alphabetically
    const sortedParams = Object.keys(params)
      .sort()
      .map((key) => `${this.percentEncode(key)}=${this.percentEncode(params[key])}`)
      .join('&');

    // Create signature base string
    const signatureBase = [
      method.toUpperCase(),
      this.percentEncode(url),
      this.percentEncode(sortedParams),
    ].join('&');

    // Create signing key
    const signingKey = `${this.percentEncode(consumerSecret)}&${this.percentEncode(tokenSecret)}`;

    // Generate HMAC-SHA1 signature using Web Crypto API
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(signingKey),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    );

    const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(signatureBase));

    // Convert to base64
    return btoa(String.fromCharCode(...new Uint8Array(signatureBytes)));
  }

  /**
   * Build OAuth Authorization header
   */
  private buildAuthHeader(params: Record<string, string>): string {
    const headerParams = Object.keys(params)
      .filter((key) => key.startsWith('oauth_'))
      .sort()
      .map((key) => `${this.percentEncode(key)}="${this.percentEncode(params[key])}"`)
      .join(', ');

    return `OAuth ${headerParams}`;
  }

  /**
   * Generate a random nonce
   */
  private generateNonce(): string {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Percent-encode a string per RFC 3986
   */
  private percentEncode(str: string): string {
    return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  }
}

/**
 * Simple encryption/decryption for OAuth tokens using AES-GCM
 * Uses Web Crypto API for Cloudflare Workers compatibility
 */
export async function encryptToken(token: string, key: string): Promise<string> {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key.padEnd(32, '0').slice(0, 32)), // Ensure 256-bit key
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    encoder.encode(token)
  );

  // Combine IV + ciphertext and encode as base64
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);

  return btoa(String.fromCharCode(...combined));
}

export async function decryptToken(encryptedToken: string, key: string): Promise<string> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  // Decode base64
  const combined = Uint8Array.from(atob(encryptedToken), (c) => c.charCodeAt(0));

  // Extract IV and ciphertext
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key.padEnd(32, '0').slice(0, 32)),
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    ciphertext
  );

  return decoder.decode(decrypted);
}
