// ABOUTME: Tests for the pure helpers behind scripts/delete-retired-insights-keys.ts: the retired
// ABOUTME: KV prefixes and parsing a `wrangler kv key list` reply into key names.

import { describe, it, expect } from 'vitest';
import { RETIRED_PREFIXES, parseKeyList } from '../../../scripts/delete-retired-insights-keys-lib';

describe('parseKeyList', () => {
  it('returns the key names from a wrangler kv key list reply', () => {
    expect(parseKeyList('[{"name":"insights:card:a"}]')).toEqual(['insights:card:a']);
  });

  it('returns an empty list for an empty reply array', () => {
    expect(parseKeyList('[]')).toEqual([]);
  });

  it('throws on wrangler error text', () => {
    expect(() => parseKeyList('✘ [ERROR] 404')).toThrow();
  });

  it('throws on JSON that is not an array of named entries', () => {
    expect(() => parseKeyList('{"name":"insights:card:a"}')).toThrow();
    expect(() => parseKeyList('[{"key":"insights:card:a"}]')).toThrow();
    expect(() => parseKeyList('[null]')).toThrow();
  });
});

describe('RETIRED_PREFIXES', () => {
  it('ends every prefix in a colon, so a prefix never matches a longer family name', () => {
    for (const prefix of RETIRED_PREFIXES) {
      expect(prefix.endsWith(':')).toBe(true);
    }
  });
});
