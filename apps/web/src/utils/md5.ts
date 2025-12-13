// MD5 implementation for Last.fm API signatures
// Last.fm requires MD5 for API method signatures (legacy API)

/**
 * Simple MD5 implementation for Cloudflare Workers
 * Based on the MD5 algorithm specification
 */
export function md5(input: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);

  // Initialize variables
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  // Pre-processing: adding padding bits
  const originalLength = data.length;
  const bitLength = originalLength * 8;

  // Append "1" bit and padding zeros
  const paddingLength = (56 - ((originalLength + 1) % 64) + 64) % 64;
  const paddedLength = originalLength + 1 + paddingLength + 8;
  const padded = new Uint8Array(paddedLength);
  padded.set(data);
  padded[originalLength] = 0x80;

  // Append original length in bits as 64-bit little-endian
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);

  // Per-round shift amounts
  const s = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];

  // Pre-computed constants
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) {
    K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000);
  }

  // Process each 64-byte chunk
  for (let offset = 0; offset < paddedLength; offset += 64) {
    const M = new Uint32Array(16);
    for (let j = 0; j < 16; j++) {
      M[j] = view.getUint32(offset + j * 4, true);
    }

    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;

    for (let i = 0; i < 64; i++) {
      let F: number;
      let g: number;

      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }

      F = (F + A + K[i] + M[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + ((F << s[i]) | (F >>> (32 - s[i])))) >>> 0;
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  // Convert to hex string (little-endian)
  const toHex = (n: number) =>
    [0, 8, 16, 24]
      .map((shift) => ((n >>> shift) & 0xff).toString(16).padStart(2, '0'))
      .join('');

  return toHex(a0) + toHex(b0) + toHex(c0) + toHex(d0);
}

/**
 * Generate Last.fm API signature
 * Signature = md5(sorted_params_concatenated + shared_secret)
 */
export function lastfmSignature(params: Record<string, string>, secret: string): string {
  const sorted = Object.keys(params).sort();
  const str = sorted.map((k) => `${k}${params[k]}`).join('') + secret;
  return md5(str);
}
