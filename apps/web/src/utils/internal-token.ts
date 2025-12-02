// Internal API token utilities
// Generates and validates short-lived HMAC-SHA256 tokens for internal API authentication

const TOKEN_EXPIRY_SECONDS = 300; // 5 minutes

interface TokenPayload {
  exp: number; // Expiry timestamp
  iat: number; // Issued at timestamp
}

/**
 * Generate a signed token for internal API requests
 */
export async function generateInternalToken(secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = {
    iat: now,
    exp: now + TOKEN_EXPIRY_SECONDS,
  };

  const payloadBase64 = btoa(JSON.stringify(payload));
  const signature = await sign(payloadBase64, secret);

  return `${payloadBase64}.${signature}`;
}

/**
 * Validate a signed token
 * Returns true if valid, false if invalid or expired
 */
export async function validateInternalToken(
  token: string,
  secret: string
): Promise<boolean> {
  try {
    const [payloadBase64, signature] = token.split('.');

    if (!payloadBase64 || !signature) {
      return false;
    }

    // Verify signature
    const expectedSignature = await sign(payloadBase64, secret);
    if (signature !== expectedSignature) {
      return false;
    }

    // Check expiry
    const payload: TokenPayload = JSON.parse(atob(payloadBase64));
    const now = Math.floor(Date.now() / 1000);

    if (payload.exp < now) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * HMAC-SHA256 signature using Web Crypto API
 */
async function sign(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
