// Internal API token utilities
// Generates and validates short-lived HMAC-SHA256 tokens for internal API authentication

const TOKEN_EXPIRY_SECONDS = 300; // 5 minutes

interface TokenPayload {
  exp: number; // Expiry timestamp
  iat: number; // Issued at timestamp
}

/**
 * Import an HMAC-SHA256 key for the given usage.
 */
async function importKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage]
  );
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
  const key = await importKey(secret, 'sign');
  const sigBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadBase64));
  const signature = Array.from(new Uint8Array(sigBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return `${payloadBase64}.${signature}`;
}

/**
 * Validate a signed token.
 * Uses crypto.subtle.verify for constant-time comparison to prevent timing attacks.
 * Returns true if valid and not expired, false otherwise.
 */
export async function validateInternalToken(
  token: string,
  secret: string
): Promise<boolean> {
  try {
    const [payloadBase64, signatureHex] = token.split('.');

    if (!payloadBase64 || !signatureHex) {
      return false;
    }

    // Decode the submitted hex signature back to bytes
    if (signatureHex.length % 2 !== 0) {
      return false;
    }
    const sigBytes = new Uint8Array(signatureHex.length / 2);
    for (let i = 0; i < sigBytes.length; i++) {
      sigBytes[i] = parseInt(signatureHex.slice(i * 2, i * 2 + 2), 16);
    }

    // Verify signature using crypto.subtle.verify — constant-time, no timing oracle
    const key = await importKey(secret, 'verify');
    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      new TextEncoder().encode(payloadBase64)
    );

    if (!isValid) {
      return false;
    }

    // Check expiry (only after signature is confirmed valid)
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
