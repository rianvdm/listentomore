// Discord signature verification using Ed25519
import nacl from 'tweetnacl';

/**
 * Convert a hex string to Uint8Array
 */
function hexToUint8(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    arr[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return arr;
}

/**
 * Verify Discord request signature
 * Discord sends Ed25519 signatures that must be verified using the bot's public key
 */
export function verifySignature(
  signature: string,
  timestamp: string,
  body: string,
  publicKey: string
): boolean {
  const message = new TextEncoder().encode(timestamp + body);
  const signatureUint8 = hexToUint8(signature);
  const publicKeyUint8 = hexToUint8(publicKey);

  return nacl.sign.detached.verify(message, signatureUint8, publicKeyUint8);
}
