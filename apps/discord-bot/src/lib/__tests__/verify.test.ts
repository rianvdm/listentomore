import { describe, expect, it } from 'vitest';
import nacl from 'tweetnacl';
import { verifySignature } from '../verify';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function signRequest(timestamp: string, body: string, secret: Uint8Array, publicKey: Uint8Array) {
  const message = new TextEncoder().encode(timestamp + body);
  const keyPair = nacl.sign.keyPair.fromSecretKey(secret);
  const signature = nacl.sign.detached(message, keyPair.secretKey);
  return {
    signature: toHex(signature),
    publicKey: toHex(publicKey),
  };
}

describe('verifySignature', () => {
  const keyPair = nacl.sign.keyPair();
  const publicKeyHex = toHex(keyPair.publicKey);
  const timestamp = '1700000000';
  const body = '{"type":1}';

  it('returns true for a valid signature', () => {
    const { signature } = signRequest(timestamp, body, keyPair.secretKey, keyPair.publicKey);
    expect(verifySignature(signature, timestamp, body, publicKeyHex)).toBe(true);
  });

  it('returns false when the body is tampered', () => {
    const { signature } = signRequest(timestamp, body, keyPair.secretKey, keyPair.publicKey);
    expect(verifySignature(signature, timestamp, '{"type":2}', publicKeyHex)).toBe(false);
  });

  it('returns false when the timestamp is tampered', () => {
    const { signature } = signRequest(timestamp, body, keyPair.secretKey, keyPair.publicKey);
    expect(verifySignature(signature, '1700000001', body, publicKeyHex)).toBe(false);
  });

  it('returns false when verified against a different public key', () => {
    const { signature } = signRequest(timestamp, body, keyPair.secretKey, keyPair.publicKey);
    const otherKey = toHex(nacl.sign.keyPair().publicKey);
    expect(verifySignature(signature, timestamp, body, otherKey)).toBe(false);
  });

  it('returns false for a malformed signature', () => {
    const malformed = '00'.repeat(64);
    expect(verifySignature(malformed, timestamp, body, publicKeyHex)).toBe(false);
  });
});
