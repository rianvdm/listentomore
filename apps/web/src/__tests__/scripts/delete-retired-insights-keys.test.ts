// ABOUTME: Tests for the pure helpers behind scripts/delete-retired-insights-keys.ts: the retired
// ABOUTME: KV prefixes and parsing a `wrangler kv key list` reply into key names.

import { describe, it, expect } from 'vitest';
import {
  RETIRED_PREFIXES,
  parseKeyList,
  wranglerFailureMessage,
} from '../../../scripts/delete-retired-insights-keys-lib';

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

describe('wranglerFailureMessage', () => {
  const key = 'insights:card:alice';

  /** An execFile rejection whose every text field carries a key name. */
  function failure(code: unknown, signal: unknown = null): Error {
    return Object.assign(new Error(`Command failed: npx wrangler kv key get ${key}\n${key} not found`), {
      code,
      signal,
      stdout: `✘ [ERROR] Key ${key} not found`,
      stderr: `A request to the Cloudflare API failed for ${key}`,
    });
  }

  it('names the operation, prefix and exit code without any wrangler text', () => {
    const message = wranglerFailureMessage('bulk delete', 'insights:card:', failure(1));
    expect(message).toBe('wrangler bulk delete failed for insights:card: (exit code 1)');
    expect(message).not.toContain(key);
  });

  it('reports a signal or a Node error code instead of an exit code', () => {
    expect(wranglerFailureMessage('list', 'insights:trivia:', failure(null, 'SIGTERM'))).toBe(
      'wrangler list failed for insights:trivia: (signal SIGTERM)'
    );
    expect(wranglerFailureMessage('list', 'insights:trivia:', failure('ENOENT'))).toBe(
      'wrangler list failed for insights:trivia: (ENOENT)'
    );
  });

  it('drops a code or signal that is not a plain token', () => {
    for (const error of [failure(key), failure(null, key), new Error(key), key, null]) {
      const message = wranglerFailureMessage('list', 'insights:card:', error);
      expect(message).toBe('wrangler list failed for insights:card: (unknown status)');
    }
  });
});

describe('RETIRED_PREFIXES', () => {
  it('ends every prefix in a colon, so a prefix never matches a longer family name', () => {
    for (const prefix of RETIRED_PREFIXES) {
      expect(prefix.endsWith(':')).toBe(true);
    }
  });
});
